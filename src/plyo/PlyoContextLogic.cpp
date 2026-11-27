#include "PlyoContextLogic.hpp"
#include "PlyoJson.hpp"

#include <algorithm>
#include <cmath>
#include <set>

namespace Plyo { namespace ContextLogic {

namespace {

// Caractère UTF-8 qui commence à `i` : sa longueur en octets (1 pour un octet isolé ou abîmé) et son point de code.
size_t next_char(const std::string& s, size_t i, unsigned& code)
{
    const unsigned char c = static_cast<unsigned char>(s[i]);
    size_t              n = c < 0x80 ? 1 : (c >> 5) == 0x6 ? 2 : (c >> 4) == 0xE ? 3 : (c >> 3) == 0x1E ? 4 : 1;
    if (i + n > s.size())
        n = 1;
    code = n == 1 ? c : n == 2 ? (c & 0x1F) : n == 3 ? (c & 0x0F) : (c & 0x07);
    for (size_t k = 1; k < n; ++k) {
        const unsigned char d = static_cast<unsigned char>(s[i + k]);
        if ((d & 0xC0) != 0x80) {
            code = c;
            return 1;
        }
        code = (code << 6) | (d & 0x3F);
    }
    return n;
}

// Contrôles C0 et C1, et séparateurs de ligne et de paragraphe (mêmes classes que le service : \p{Cc}, \p{Zl}, \p{Zp}).
bool is_control(unsigned code) { return code < 0x20 || (code >= 0x7F && code <= 0x9F) || code == 0x2028 || code == 0x2029; }

bool is_digits(const std::string& s, size_t max)
{
    if (s.empty() || s.size() > max)
        return false;
    for (const char c : s)
        if (c < '0' || c > '9')
            return false;
    return true;
}

// Code d'un message d'Orca : caractères hors de [A-Za-z0-9_.:-] remplacés par « _ », 60 au plus ; vide s'il n'en reste rien.
std::string issue_code(const std::string& code)
{
    std::string out;
    for (size_t i = 0; i < code.size() && out.size() < 60;) {
        unsigned     c = 0;
        const size_t n = next_char(code, i, c);
        const bool   ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '.' || c == ':' || c == '-';
        out += ok ? static_cast<char>(c) : '_';
        i += n;
    }
    return out.find_first_not_of('_') == std::string::npos ? std::string() : out;
}

// Valeur d'un réglage dans la mémoire : nombre fini, booléen, texte (200) ou null ; sinon null.
nlohmann::json memory_value(const nlohmann::json& v)
{
    if (v.is_boolean() || v.is_null())
        return v;
    if (v.is_number())
        return std::isfinite(v.get<double>()) ? v : nlohmann::json(nullptr);
    if (v.is_string())
        return clip(v.get<std::string>(), 200);
    return nullptr;
}

void put_text(nlohmann::json& out, const char* key, const std::string& value, size_t max)
{
    const std::string text = clip(value, max);
    if (!text.empty())
        out[key] = text;
}

// Fait de l'imprimante : « undefine » (valeur d'Orca pour « non renseigné ») et « nil » ne disent rien.
void put_fact(nlohmann::json& out, const char* key, const std::string& value)
{
    const std::string text = clip(value, 40);
    if (!text.empty() && text != "undefine" && text != "nil")
        out[key] = text;
}

} // namespace

std::string clip(const std::string& text, size_t max_chars)
{
    std::string out;
    size_t      chars   = 0;
    bool        pending = false; // un espace à écrire avant le prochain caractère visible
    for (size_t i = 0; i < text.size() && chars < max_chars;) {
        unsigned     c = 0;
        const size_t n = next_char(text, i, c);
        if (is_control(c) || c == ' ')
            pending = !out.empty();
        else {
            if (pending) {
                if (chars + 1 >= max_chars)
                    break;
                out += ' ';
                ++chars;
                pending = false;
            }
            out.append(text, i, n);
            ++chars;
        }
        i += n;
    }
    return out;
}

bool valid_opt_key(const std::string& key)
{
    if (key.empty() || key.size() > 80 || key[0] < 'a' || key[0] > 'z')
        return false;
    for (const char c : key)
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_'))
            return false;
    return true;
}

nlohmann::json context_extras(const Raw& raw)
{
    nlohmann::json out = nlohmann::json::object();
    put_text(out, "bed_type", raw.bed_type, 60);
    // Une clé mal formée ferait ignorer toute la liste par le service : la liste part entière ou pas du tout.
    std::vector<std::string> keys;
    bool                     valid = true;
    for (const std::string& k : raw.bed_temp_keys) {
        if (!valid_opt_key(k)) {
            valid = false;
            break;
        }
        if (std::find(keys.begin(), keys.end(), k) == keys.end())
            keys.push_back(k);
    }
    if (valid && !keys.empty() && keys.size() <= MAX_BED_KEYS)
        out["bed_temp_keys"] = keys;
    put_text(out, "filament_type", raw.filament_type, 40);
    put_text(out, "filament_vendor", raw.filament_vendor, 60);
    nlohmann::json facts = nlohmann::json::object();
    put_fact(facts, "nozzle_type", raw.nozzle_type);
    put_fact(facts, "extruder_type", raw.extruder_type);
    put_fact(facts, "printer_structure", raw.printer_structure);
    if (!facts.empty())
        out["printer_facts"] = facts;
    return out;
}

nlohmann::json issues_for_ai(const nlohmann::json& issues)
{
    static const std::set<std::string> SOURCES = {"slicing_error", "validate_error", "validate_warning", "step_warning",
                                                  "gcode_check",   "upload_error",   "dialog"};
    nlohmann::json out = nlohmann::json::array();
    if (!issues.is_array())
        return out;
    for (const nlohmann::json& i : issues) {
        if (out.size() >= 10)
            break;
        const std::string source = Json::str(i, "source");
        const std::string level  = Json::str(i, "level");
        const std::string code   = issue_code(Json::str(i, "code"));
        const std::string text   = clip(Json::str(i, "text"), 300);
        if (!SOURCES.count(source) || (level != "error" && level != "warning") || code.empty() || text.empty())
            continue;
        nlohmann::json one{{"source", source}, {"code", code}, {"level", level}, {"text", text}};
        if (const std::string key = Json::str(i, "opt_key"); valid_opt_key(key))
            one["opt_key"] = key;
        if (const std::string ref = Json::str(i, "object_ref"); is_digits(ref, 20))
            one["object_ref"] = ref;
        out.push_back(one);
    }
    return out;
}

nlohmann::json plate_for_ai(const nlohmann::json& plate, const nlohmann::json& facts)
{
    if (!plate.is_object())
        return plate;
    nlohmann::json       out      = plate;
    const nlohmann::json measured = Json::obj(facts, "objects");
    if (out.contains("objects") && out["objects"].is_array())
        for (nlohmann::json& o : out["objects"]) {
            const std::string    ref = Json::str(o, "ref");
            const nlohmann::json m   = ref.empty() ? nlohmann::json::object() : Json::obj(measured, ref.c_str());
            if (const nlohmann::json* s = Json::field(m, "needs_support"); s != nullptr && s->is_boolean())
                o["needs_support"] = *s;
            const double contact = Json::num(m, "contact_mm2", -1);
            if (contact >= 0 && contact <= 1000000)
                o["contact_mm2"] = std::round(contact);
        }
    if (const nlohmann::json* c = Json::field(facts, "conflict"); c != nullptr && c->is_boolean())
        out["conflict"] = *c;
    const nlohmann::json issues = issues_for_ai(Json::arr(plate, "issues"));
    if (issues.empty())
        out.erase("issues");
    else
        out["issues"] = issues;
    return out;
}

nlohmann::json memory_for_ai(const nlohmann::json& memory)
{
    static const std::set<std::string> OUTCOMES = {"pending", "ok", "bad", "unknown"};
    nlohmann::json out = nlohmann::json::array();
    if (!memory.is_array())
        return out;
    for (const nlohmann::json& e : memory) {
        if (out.size() >= 10)
            break;
        const std::string date = clip(Json::str(e, "date"), 40);
        if (date.empty())
            continue;
        nlohmann::json changes = nlohmann::json::array();
        for (const nlohmann::json& c : Json::arr(e, "changes")) {
            const std::string id = Json::str(c, "id");
            if (changes.size() >= 10 || id.empty() || clip(id, 60) != id)
                continue; // identifiant trop long ou abîmé : ce changement ne part pas, jamais la demande entière refusée
            changes.push_back({{"id", id}, {"before", memory_value(Json::any(c, "before"))}, {"after", memory_value(Json::any(c, "after"))}});
        }
        nlohmann::json one{{"date", date}, {"changes", changes}};
        put_text(one, "why", Json::str(e, "why"), 200);
        put_text(one, "note", Json::str(e, "note"), 200);
        put_text(one, "defect", Json::str(e, "defect"), 40);
        if (const std::string outcome = Json::str(e, "outcome"); OUTCOMES.count(outcome))
            one["outcome"] = outcome;
        out.push_back(one);
    }
    return out;
}

std::optional<double> filament_cost(const std::map<size_t, double>& volumes_mm3, const std::vector<double>& density, const std::vector<double>& cost_per_kg)
{
    double total = 0.0;
    bool   used  = false;
    for (const auto& [index, volume] : volumes_mm3) {
        if (!(volume > 0.0))
            continue;
        if (index >= density.size() || index >= cost_per_kg.size() || !(density[index] > 0.0) || !(cost_per_kg[index] > 0.0))
            return std::nullopt;
        total += volume * density[index] * 0.001 * cost_per_kg[index] * 0.001; // mm³ × g/cm³ / 1000 = g ; g × €/kg / 1000 = €
        used = true;
    }
    if (!used || !std::isfinite(total) || total <= 0.0)
        return std::nullopt;
    return total;
}

}} // namespace Plyo::ContextLogic
