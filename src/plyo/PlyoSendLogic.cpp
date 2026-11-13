#include "PlyoSendLogic.hpp"

#include <algorithm>
#include <cctype>
#include <regex>

namespace Plyo { namespace SendLogic {

namespace {

std::string lower(std::string s)
{
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return s;
}

std::string replace_all(std::string text, const std::string& from, const std::string& to)
{
    if (from.empty())
        return text;
    for (size_t at = text.find(from); at != std::string::npos; at = text.find(from, at + to.size()))
        text.replace(at, from.size(), to);
    return text;
}

bool ends_with(const std::string& s, const std::string& suffix)
{
    return s.size() >= suffix.size() && s.compare(s.size() - suffix.size(), suffix.size(), suffix) == 0;
}

// Quatre nombres de 0 à 255 séparés par des points ; faux sinon.
bool ipv4(const std::string& s, int out[4])
{
    int    n = 0;
    size_t i = 0;
    while (n < 4) {
        if (i >= s.size() || !std::isdigit(static_cast<unsigned char>(s[i])))
            return false;
        int    v = 0;
        size_t digits = 0;
        while (i < s.size() && std::isdigit(static_cast<unsigned char>(s[i])) && digits < 4) {
            v = v * 10 + (s[i] - '0');
            ++i;
            ++digits;
        }
        if (digits > 3 || v > 255)
            return false;
        out[n++] = v;
        if (n < 4) {
            if (i >= s.size() || s[i] != '.')
                return false;
            ++i;
        }
    }
    return i == s.size();
}

} // namespace

int http_status(const std::string& message)
{
    // « HTTP 403: Forbidden », en tête du message ou d'une de ses lignes (Orca peut le précéder d'une phrase à lui).
    static const std::regex re(R"((?:^|\n)\s*HTTP ([1-5][0-9][0-9])\b)");
    std::smatch             m;
    if (!std::regex_search(message, m, re))
        return 0;
    return std::stoi(m[1].str());
}

std::string step_of(int last_progress, int hundreds)
{
    if (hundreds > 0)
        return "sent";
    return last_progress > 0 ? "upload" : "connect";
}

std::string failure_code(int http, const std::string& step)
{
    if (http == 401 || http == 403)
        return "auth";
    if (http == 413 || http == 507)
        return "no_space";
    if (http == 400 || http == 409 || http == 415 || http == 422)
        return "file_refused";
    if (http == 404 || http == 405)
        return "not_printer";
    if (http >= 500 && http <= 599)
        return "server_error";
    if (http != 0)
        return "unknown";
    if (step == "connect")
        return "unreachable";
    // Après « 100 % », le fichier est arrivé : c'est le démarrage qui n'a pas été confirmé (Elegoo CC2, par exemple).
    return step == "sent" ? "no_confirmation" : "interrupted";
}

std::string verdict(bool handed, bool error_dialog, bool send_dialog_seen, bool plate_error)
{
    if (handed)
        return "taken";
    if (error_dialog)
        return "refused";
    if (send_dialog_seen)
        return "closed";
    return plate_error ? "not_ready" : "not_started";
}

bool arrived_now(int hundreds) { return hundreds >= 2; }

std::string scrub_network(const std::string& text, const std::vector<std::string>& hosts, const std::vector<std::string>& secrets)
{
    std::string out = text;
    // Les valeurs connues d'abord (une adresse enregistrée peut être un simple nom), les plus longues en premier.
    std::vector<std::string> known_hosts = hosts, known_secrets = secrets;
    const auto by_length = [](const std::string& a, const std::string& b) { return a.size() > b.size(); };
    std::sort(known_secrets.begin(), known_secrets.end(), by_length);
    std::sort(known_hosts.begin(), known_hosts.end(), by_length);
    for (const std::string& s : known_secrets)
        if (s.size() >= 3)
            out = replace_all(out, s, "[code]");
    for (const std::string& h : known_hosts)
        if (h.size() >= 3)
            out = replace_all(out, h, "[adresse]");
    static const std::regex url(R"([A-Za-z][A-Za-z0-9+.\-]*://[^\s"'<>()\[\]]+)");
    static const std::regex v6(R"(\[[0-9A-Fa-f:.%]+\](?::[0-9]{1,5})?)");
    static const std::regex v4(R"(\b[0-9]{1,3}(?:\.[0-9]{1,3}){3}(?::[0-9]{1,5})?\b)");
    static const std::regex mdns(R"(\b[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9\-]+)*\.local\b(?::[0-9]{1,5})?)");
    out = std::regex_replace(out, url, "[adresse]");
    out = std::regex_replace(out, v6, "[adresse]");
    out = std::regex_replace(out, v4, "[adresse]");
    out = std::regex_replace(out, mdns, "[adresse]");
    return out;
}

bool local_host(const std::string& print_host)
{
    std::string h = lower(print_host);
    h.erase(0, h.find_first_not_of(" \t"));
    if (const size_t scheme = h.find("://"); scheme != std::string::npos)
        h = h.substr(scheme + 3);
    h = h.substr(0, h.find_first_of("/?#"));
    if (const size_t at = h.rfind('@'); at != std::string::npos)
        h = h.substr(at + 1);
    if (h.empty())
        return false;
    if (h[0] == '[') { // IPv6 entre crochets, port éventuel après
        const size_t close = h.find(']');
        if (close == std::string::npos)
            return false;
        const std::string v6 = h.substr(1, close - 1);
        return v6 == "::1" || v6.rfind("fe80:", 0) == 0 || v6.rfind("fc", 0) == 0 || v6.rfind("fd", 0) == 0;
    }
    if (std::count(h.begin(), h.end(), ':') > 1) // IPv6 sans crochets : pas de port possible
        return h == "::1" || h.rfind("fe80:", 0) == 0 || h.rfind("fc", 0) == 0 || h.rfind("fd", 0) == 0;
    h = h.substr(0, h.find(':'));
    if (h.empty())
        return false;
    int o[4] = {0, 0, 0, 0};
    if (ipv4(h, o))
        return o[0] == 10 || o[0] == 127 || (o[0] == 172 && o[1] >= 16 && o[1] <= 31) || (o[0] == 192 && o[1] == 168) ||
               (o[0] == 169 && o[1] == 254);
    if (h == "localhost" || ends_with(h, ".local") || ends_with(h, ".local."))
        return true;
    // Nom sans point (« octopi ») : résolu par le réseau de la maison. Un nom avec un point peut être sur internet.
    return h.find('.') == std::string::npos &&
           std::all_of(h.begin(), h.end(), [](unsigned char c) { return std::isalnum(c) || c == '-' || c == '_'; });
}

std::string link_code(bool ok, int http)
{
    if (ok)
        return "ok";
    if (http == 401 || http == 403)
        return "auth";
    if (http == 404 || http == 405)
        return "not_printer";
    return http == 0 ? "unreachable" : "error";
}

}} // namespace Plyo::SendLogic
