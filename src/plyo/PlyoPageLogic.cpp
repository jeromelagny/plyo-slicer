#include "PlyoPageLogic.hpp"

#include <algorithm>
#include <cctype>
#include <random>
#include <utility>

namespace Plyo { namespace PageLogic {

namespace {

constexpr const char* INCLUDE_OPEN  = "<!--plyo-include:";
constexpr const char* INCLUDE_CLOSE = "-->";
constexpr const char* CONFIG_MARKER = "<!--plyo-config-->";

bool plain_name_char(unsigned char c) { return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-'; }

// « nom.js », ou « dossier/nom.js » (un seul sous-dossier, ex. les scripts de vue de la v2) ; jamais « .. » ni chemin absolu.
bool valid_script_name(const std::string& name)
{
    const std::string ext = ".js";
    if (name.size() <= ext.size() || name.compare(name.size() - ext.size(), ext.size(), ext) != 0)
        return false;
    const std::string stem  = name.substr(0, name.size() - ext.size());
    const size_t      slash = stem.find('/');
    const std::string dir   = slash == std::string::npos ? std::string() : stem.substr(0, slash);
    const std::string file  = slash == std::string::npos ? stem : stem.substr(slash + 1);
    if (slash != std::string::npos && dir.empty())
        return false;
    return !file.empty() && std::all_of(dir.begin(), dir.end(), plain_name_char) && std::all_of(file.begin(), file.end(), plain_name_char);
}

// Une balise « </script » dans un texte inséré fermerait la balise qui l'entoure : « <\/script », identique pour JavaScript.
std::string neutralized(std::string script)
{
    for (size_t at = script.find("</script"); at != std::string::npos; at = script.find("</script", at + 2))
        script.replace(at, 2, "<\\/");
    return script;
}

std::string script_tag(const std::string& nonce, const std::string& body)
{
    return "<script nonce=\"" + nonce + "\">\n" + neutralized(body) + "\n</script>";
}

} // namespace

std::vector<std::string> include_names(const std::string& page)
{
    std::vector<std::string> names;
    const std::string        open = INCLUDE_OPEN;
    for (size_t at = page.find(open); at != std::string::npos; at = page.find(open, at + 1)) {
        const size_t start = at + open.size();
        const size_t end   = page.find(INCLUDE_CLOSE, start);
        if (end == std::string::npos)
            break;
        const std::string name = page.substr(start, end - start);
        if (valid_script_name(name))
            names.push_back(name);
    }
    return names;
}

std::string page_for_ui(const std::string& ui) { return ui == "v2" ? "v2/index.html" : "index.html"; }

std::string origin_of(const std::string& url)
{
    std::string lower(url);
    std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    size_t scheme_end = std::string::npos;
    if (lower.rfind("https://", 0) == 0)
        scheme_end = 8;
    else if (lower.rfind("http://", 0) == 0)
        scheme_end = 7;
    if (scheme_end == std::string::npos)
        return std::string();
    const size_t      host_end = lower.find_first_of("/?#", scheme_end);
    const std::string host     = lower.substr(scheme_end, host_end == std::string::npos ? std::string::npos : host_end - scheme_end);
    // Hôte (nom, IPv4, IPv6 entre crochets) et port : rien qui puisse sortir de la directive (espace, « ; », « ' »…), ni
    // identifiant (« user@ »).
    const bool clean = !host.empty() && std::all_of(host.begin(), host.end(), [](unsigned char c) {
        return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '-' || c == ':' || c == '[' || c == ']';
    });
    if (!clean || host.front() == ':' || host.front() == '.')
        return std::string();
    return lower.substr(0, scheme_end) + host;
}

std::string new_nonce()
{
    std::random_device                 device;
    std::uniform_int_distribution<int> digit(0, 15);
    std::string                        nonce;
    for (int i = 0; i < 32; ++i)
        nonce += "0123456789abcdef"[digit(device)];
    return nonce;
}

std::string content_security_policy(const std::string& api_url, const std::string& nonce, const std::vector<std::string>& extra_connect)
{
    std::string connect;
    if (const std::string origin = origin_of(api_url); !origin.empty())
        connect = origin;
    for (const std::string& extra : extra_connect)
        if (!extra.empty() && extra.find_first_of(" ;,'\"\r\n\t") == std::string::npos)
            connect += (connect.empty() ? "" : " ") + extra;
    // 'wasm-unsafe-eval' : compiler le WebAssembly de manifold-3d (pièces sur mesure) ; jamais d'eval JavaScript.
    return "default-src 'none'; script-src 'nonce-" + nonce + "' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; connect-src " +
           (connect.empty() ? std::string("'none'") : connect) + "; base-uri 'none'; form-action 'none'";
}

std::string assemble(std::string page, const std::function<std::string(const std::string&)>& read_script, const std::string& config_script,
                     const std::string& driver, const std::string& csp, const std::string& nonce)
{
    // La balise <script> de la page elle-même (avant toute insertion : le texte inséré n'est jamais retouché).
    const std::string plain_tag = "<script>";
    const std::string nonce_tag = "<script nonce=\"" + nonce + "\">";
    for (size_t at = page.find(plain_tag); at != std::string::npos; at = page.find(plain_tag, at + nonce_tag.size()))
        page.replace(at, plain_tag.size(), nonce_tag);

    // Un seul passage sur la page d'origine : un marqueur cité dans le texte d'un module inséré n'est jamais remplacé.
    const std::string open = INCLUDE_OPEN, config = CONFIG_MARKER;
    std::string       out;
    for (size_t pos = 0;;) {
        const size_t inc  = page.find(open, pos);
        const size_t conf = page.find(config, pos);
        const size_t next = std::min(inc, conf);
        if (next == std::string::npos) {
            out += page.substr(pos);
            break;
        }
        out += page.substr(pos, next - pos);
        if (next == conf) {
            out += script_tag(nonce, config_script);
            pos = conf + config.size();
            continue;
        }
        const size_t      end  = page.find(INCLUDE_CLOSE, inc + open.size());
        const std::string name = end == std::string::npos ? std::string() : page.substr(inc + open.size(), end - inc - open.size());
        if (valid_script_name(name)) {
            out += script_tag(nonce, read_script(name));
            pos = end + std::string(INCLUDE_CLOSE).size();
        } else { // nom refusé : le marqueur reste un commentaire, sans effet
            out += open;
            pos = inc + open.size();
        }
    }
    page = std::move(out);
    if (!driver.empty()) {
        const size_t body_end = page.rfind("</body>");
        page.insert(body_end == std::string::npos ? page.size() : body_end, script_tag(nonce, "/* PLYO_SELFTEST */\n" + driver) + "\n");
    }
    // La politique en premier dans <head> : elle vaut pour tout ce qui suit (styles, scripts).
    const std::string meta = "<meta http-equiv=\"Content-Security-Policy\" content=\"" + csp + "\">";
    const size_t      head = page.find("<head>");
    page.insert(head == std::string::npos ? 0 : head + 6, "\n" + meta);
    return page;
}

}} // namespace Plyo::PageLogic
