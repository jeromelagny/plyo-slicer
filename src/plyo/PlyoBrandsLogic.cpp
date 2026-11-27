#include "PlyoBrandsLogic.hpp"

#include "PlyoJson.hpp"

#include <algorithm>
#include <map>

namespace Plyo { namespace BrandsLogic {

namespace {

std::string lower(const std::string& s)
{
    std::string out = s;
    for (char& c : out)
        if (c >= 'A' && c <= 'Z')
            c = static_cast<char>(c - 'A' + 'a');
    return out;
}

std::string trim(const std::string& s)
{
    size_t b = 0, e = s.size();
    while (b < e && (s[b] == ' ' || s[b] == '\t'))
        ++b;
    while (e > b && (s[e - 1] == ' ' || s[e - 1] == '\t'))
        --e;
    return s.substr(b, e - b);
}

// « eSUN PLA+ » avec la marque « eSUN » → « PLA+ » ; sinon le nom entier.
std::string short_of(const std::string& label, const std::string& brand)
{
    const std::string l = lower(label), b = lower(trim(brand));
    if (!b.empty() && l.size() > b.size() + 1 && l.compare(0, b.size(), b) == 0 && (label[b.size()] == ' ' || label[b.size()] == '-'))
        return trim(label.substr(b.size() + 1));
    return label;
}

nlohmann::json entry_of(const nlohmann::json& group, const nlohmann::json& range)
{
    return {{"brand", group["brand"]}, {"label", range["label"]}, {"short", range["short"]}, {"preset", range["preset"]}};
}

// Gammes de la marque `brand` dont un des noms (norm) vaut le nom annoncé `name` : nom, nom court, ou marque + nom.
nlohmann::json ranges_named(const nlohmann::json& groups, const std::string& brand, const std::string& name)
{
    const std::string b = norm(brand), n = norm(name);
    nlohmann::json    found = nlohmann::json::array();
    if (b.empty() || n.empty() || !groups.is_array())
        return found;
    // Le nom annoncé peut porter la marque devant (« Creality Hyper PLA ») : on la retire pour comparer.
    const std::string n_bare = n.size() > b.size() && n.compare(0, b.size(), b) == 0 ? n.substr(b.size()) : std::string();
    for (const nlohmann::json& g : groups) {
        if (!g.is_object() || norm(Json::str(g, "brand")) != b)
            continue;
        for (const nlohmann::json& r : Json::arr(g, "ranges")) {
            const std::string label = norm(Json::str(r, "label")), brief = norm(Json::str(r, "short"));
            const bool        same  = n == label || n == brief || b + n == label || (!n_bare.empty() && (n_bare == label || n_bare == brief));
            if (same)
                found.push_back(entry_of(g, r));
        }
    }
    return found;
}

} // namespace

std::string norm(const std::string& text)
{
    std::string out;
    for (const char c : text) {
        if (c == ' ' || c == '\t' || c == '-' || c == '_' || c == '\n' || c == '\r')
            continue;
        out.push_back(c >= 'A' && c <= 'Z' ? static_cast<char>(c - 'A' + 'a') : c);
    }
    return out;
}

std::string range_label(const std::string& preset)
{
    const size_t at = preset.find('@');
    return trim(at == std::string::npos ? preset : preset.substr(0, at));
}

bool is_generic(const std::string& vendor, const std::string& label)
{
    const std::string v = norm(vendor);
    return v.empty() || v == "generic" || norm(label).compare(0, 7, "generic") == 0;
}

nlohmann::json group(const std::vector<Candidate>& candidates, const std::string& printer_brand)
{
    struct Brand
    {
        std::string                        name;
        bool                               with_printer = false;
        std::map<std::string, Candidate>   by_label; // clé norm du nom de la gamme
        std::map<std::string, std::string> labels;
    };
    std::map<std::string, Brand> brands; // clé norm de la marque
    std::vector<std::string>     order;
    for (const Candidate& c : candidates) {
        const std::string vendor = Json::utf8_prefix(trim(c.vendor), MAX_BRAND_BYTES);
        const std::string label  = Json::utf8_prefix(range_label(c.preset), MAX_LABEL_BYTES);
        if (c.preset.empty() || label.empty() || is_generic(vendor, label))
            continue;
        const std::string key = norm(vendor);
        auto [it, added]      = brands.emplace(key, Brand());
        if (added) {
            it->second.name = vendor;
            order.push_back(key);
        }
        Brand& b = it->second;
        b.with_printer = b.with_printer || c.printer_bundle;
        // « Hyper PLA » (profils de l'imprimante) et « Creality Hyper PLA » (bibliothèque) sont la même gamme.
        const std::string lkey = norm(short_of(label, b.name));
        const auto        old  = b.by_label.find(lkey);
        // Même gamme deux fois (profil de l'imprimante et bibliothèque commune) : celui de l'imprimante ; sinon le premier.
        if (old == b.by_label.end() || (c.printer_bundle && !old->second.printer_bundle)) {
            b.by_label[lkey] = c;
            b.labels[lkey]   = label;
        }
    }
    const std::string printer_key = norm(printer_brand);
    auto rank = [&](const Brand& b, const std::string& key) { return !printer_key.empty() && key == printer_key ? 0 : b.with_printer ? 1 : 2; };
    std::stable_sort(order.begin(), order.end(), [&](const std::string& a, const std::string& b) {
        const int ra = rank(brands[a], a), rb = rank(brands[b], b);
        if (ra != rb)
            return ra < rb;
        return lower(brands[a].name) < lower(brands[b].name);
    });
    nlohmann::json out = nlohmann::json::array();
    for (const std::string& key : order) {
        const Brand&             b = brands[key];
        std::vector<std::string> labels;
        for (const auto& [lkey, label] : b.labels)
            labels.push_back(lkey);
        std::sort(labels.begin(), labels.end(), [&](const std::string& x, const std::string& y) {
            return lower(b.labels.at(x)) < lower(b.labels.at(y));
        });
        nlohmann::json ranges = nlohmann::json::array();
        for (const std::string& lkey : labels) {
            const std::string& label = b.labels.at(lkey);
            ranges.push_back({{"preset", b.by_label.at(lkey).preset}, {"label", label}, {"short", short_of(label, b.name)}});
        }
        out.push_back({{"brand", b.name}, {"printer", rank(b, key) < 2}, {"ranges", ranges}});
    }
    return out;
}

nlohmann::json find(const nlohmann::json& groups, const std::string& preset)
{
    if (preset.empty() || !groups.is_array())
        return nlohmann::json::object();
    for (const nlohmann::json& g : groups)
        for (const nlohmann::json& r : Json::arr(g, "ranges"))
            if (Json::str(r, "preset") == preset)
                return entry_of(g, r);
    return nlohmann::json::object();
}

nlohmann::json match(const nlohmann::json& groups, const std::string& brand, const std::string& name)
{
    const nlohmann::json found = ranges_named(groups, brand, name);
    return found.size() == 1 ? found[0] : nlohmann::json::object();
}

nlohmann::json same_range(const nlohmann::json& groups, const std::string& brand, const std::string& range)
{
    return match(groups, brand, range);
}

std::string clean_brand(const std::string& typed)
{
    std::string s;
    for (const char c : typed) {
        const unsigned char u = static_cast<unsigned char>(c);
        if (u < 0x20 || std::string("/\\:*?\"<>|").find(c) != std::string::npos)
            s.push_back(' ');
        else
            s.push_back(c);
    }
    std::string out;
    for (const char c : s)
        if (c != ' ' || (!out.empty() && out.back() != ' '))
            out.push_back(c);
    out = trim(Json::utf8_prefix(trim(out), MAX_BRAND_BYTES));
    size_t chars = 0;
    for (const char c : out)
        if ((static_cast<unsigned char>(c) & 0xC0) != 0x80)
            ++chars;
    return chars < 2 ? std::string() : out;
}

}} // namespace Plyo::BrandsLogic
