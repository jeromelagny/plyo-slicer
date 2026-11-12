#include "PlyoOrcaMessagesLogic.hpp"
#include "PlyoJson.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <set>
#include <tuple>

namespace Plyo { namespace OrcaMessagesLogic {

namespace {

bool is_sep(char c) { return c == '/' || c == '\\'; }

// Dernier élément d'un chemin (« x.gcode » pour « /Users/moi/Bureau/x.gcode ») ; le précédent si le chemin finit par un séparateur.
std::string last_part(std::string path)
{
    while (path.size() > 1 && is_sep(path.back()))
        path.pop_back();
    const size_t at = path.find_last_of("/\\");
    return at == std::string::npos ? path : path.substr(at + 1);
}

// Chemin absolu reconnu sans regarder le texte autour : « /a/b », « ~/a », « C:\a », « \\serveur\a ».
bool looks_absolute(const std::string& s)
{
    if (s.size() >= 3 && s[0] == '/' && s.find('/', 1) != std::string::npos)
        return true;
    if (s.size() >= 3 && s[0] == '~' && is_sep(s[1]))
        return true;
    if (s.size() >= 4 && std::isalpha(static_cast<unsigned char>(s[0])) && s[1] == ':' && is_sep(s[2]))
        return true;
    return s.size() >= 3 && s[0] == '\\' && s[1] == '\\';
}

bool ends_with(const std::string& s, const char* suffix)
{
    const size_t n = std::char_traits<char>::length(suffix);
    return s.size() >= n && s.compare(s.size() - n, n, suffix) == 0;
}

// Un mot (suite sans espace) : la ponctuation et les guillemets autour sont gardés, un chemin absolu au milieu est réduit.
std::string shorten_word(const std::string& word)
{
    size_t begin = 0;
    while (begin < word.size()) {
        const unsigned char c = static_cast<unsigned char>(word[begin]);
        if (std::isalnum(c) || c == '/' || c == '\\' || c == '~')
            break;
        ++begin; // guillemets, parenthèses, espace insécable (octets UTF-8 non ASCII)
    }
    std::string middle = word.substr(begin), tail;
    for (bool again = true; again && !middle.empty();) {
        again = false;
        if (std::string(".,;:!?)]\"'").find(middle.back()) != std::string::npos) {
            tail.insert(tail.begin(), middle.back());
            middle.pop_back();
            again = true;
        } else if (ends_with(middle, "\xC2\xBB") || ends_with(middle, "\xC2\xA0")) { // « » » ou espace insécable
            tail.insert(0, middle.substr(middle.size() - 2));
            middle.erase(middle.size() - 2);
            again = true;
        }
    }
    if (!looks_absolute(middle))
        return word;
    return word.substr(0, begin) + last_part(middle) + tail;
}

std::string replace_all(std::string text, const std::string& from, const std::string& to)
{
    if (from.empty())
        return text;
    for (size_t at = text.find(from); at != std::string::npos; at = text.find(from, at + to.size()))
        text.replace(at, from.size(), to);
    return text;
}

} // namespace

std::string clean_text(const std::string& text, const std::vector<std::string>& paths)
{
    std::string out = text;
    // Chemins connus, du plus long au plus court : un dossier suivi d'un séparateur devient « ~/ » (le reste est réduit plus
    // bas), un chemin entier devient son nom.
    std::vector<std::string> known;
    for (std::string p : paths) {
        while (p.size() > 1 && is_sep(p.back()))
            p.pop_back();
        if (p.size() >= 2)
            known.push_back(p);
    }
    std::sort(known.begin(), known.end(), [](const std::string& a, const std::string& b) { return a.size() > b.size(); });
    for (const std::string& p : known) {
        out = replace_all(out, p + "/", "~/");
        out = replace_all(out, p + "\\", "~/");
        out = replace_all(out, p, last_part(p));
    }
    // Caractères de contrôle : un saut de ligne ou une tabulation devient une espace, le reste disparaît.
    std::string flat;
    flat.reserve(out.size());
    for (char ch : out) {
        const unsigned char c = static_cast<unsigned char>(ch);
        if (c == '\n' || c == '\r' || c == '\t')
            flat += ' ';
        else if (c >= 0x20 && c != 0x7F)
            flat += ch;
    }
    // Mot par mot : chemins absolus restants réduits, espaces resserrées.
    std::string result;
    size_t      i = 0;
    while (i < flat.size()) {
        if (flat[i] == ' ') {
            ++i;
            continue;
        }
        const size_t end = flat.find(' ', i);
        const std::string word = flat.substr(i, end == std::string::npos ? std::string::npos : end - i);
        if (!result.empty())
            result += ' ';
        result += shorten_word(word);
        i = end == std::string::npos ? flat.size() : end;
    }
    return Json::utf8_prefix(result, MAX_TEXT);
}

std::string slicing_code(const std::string& type, const SliceFacts& facts)
{
    if (type == "SlicingError" || type == "SlicingErrors") {
        // L'étape restée « commencée » dit où Orca s'est arrêté (PrintObjectSlice.cpp, GCode.cpp, Print.cpp).
        if (facts.step == "posSlice")
            return "no_layers";
        if (facts.step == "psGCodeExport")
            return facts.has_object ? "empty_first_layer" : "nothing_to_print";
        if (facts.step == "psWipeTower")
            return facts.wipe_tower ? "prime_tower" : "print_empty";
        if (facts.step == "psSkirtBrim")
            return "skirt_brim";
    }
    return type.empty() ? std::string("unknown") : type;
}

std::string validate_code(int type, const std::string& opt_key, bool has_object, const ValidateFacts& facts)
{
    switch (type) { // StringExceptionType (PrintBase.hpp)
    case 1: return "filament_bed_type";
    case 2: return "filaments_temp";
    case 3: return "collision_by_object";
    case 4: return "collision";
    case 5: return "layer_height_limit";
    default: break;
    }
    if ((opt_key == "layer_height" || opt_key == "initial_layer_print_height") && facts.over_nozzle)
        return "layer_height_over_nozzle";
    if (opt_key == "spiral_mode" && facts.several_objects)
        return "vase_several_objects";
    if (opt_key.empty() && has_object && facts.too_tall)
        return "object_too_tall";
    return opt_key.empty() ? std::string("validate") : opt_key;
}

std::string step_warning_code(int message_id)
{
    switch (message_id) { // PrintStateBase::SlicingNotificationType (PrintBase.hpp)
    case 1: return "replace_init_empty_layers";
    case 2: return "need_support";
    case 3: return "empty_layers";
    case 4: return "gcode_overlap";
    case 5: return "exclusion_area";
    case 6: return "precise_seam";
    default: return "step_warning";
    }
}

std::string export_kind(const std::string& type)
{
    if (type == "ExportError" || type == "FileIOError" || type == "IOError")
        return "write";
    if (type == "PlaceholderParserError")
        return "gcode_template";
    if (type == "SlicingError" || type == "SlicingErrors")
        return "slicing";
    if (type == "bad_alloc")
        return "memory";
    return "other";
}

double safe_layer_height(double nozzle_mm)
{
    if (!(nozzle_mm > 0) || !std::isfinite(nozzle_mm))
        return 0;
    const double half = std::floor(nozzle_mm * 50 + 1e-6) / 100;
    return std::min(0.3, std::max(0.05, half));
}

nlohmann::json to_json(const std::vector<Issue>& issues)
{
    std::vector<const Issue*>                                                 kept;
    std::set<std::tuple<std::string, std::string, std::string, std::string>> seen;
    for (const Issue& i : issues)
        if (!i.code.empty() && seen.insert({i.source, i.code, i.object_ref, i.text}).second)
            kept.push_back(&i);
    std::stable_partition(kept.begin(), kept.end(), [](const Issue* i) { return i->level == "error"; });
    nlohmann::json out = nlohmann::json::array();
    for (const Issue* i : kept) {
        if (out.size() >= MAX_ISSUES)
            break;
        nlohmann::json j{{"source", i->source}, {"code", i->code}, {"level", i->level == "error" ? "error" : "warning"}, {"text", i->text}};
        if (!i->opt_key.empty())
            j["opt_key"] = i->opt_key;
        if (!i->scope.empty())
            j["scope"] = i->scope;
        if (!i->object_ref.empty())
            j["object_ref"] = i->object_ref;
        if (!i->object_name.empty())
            j["object_name"] = i->object_name;
        if (i->critical)
            j["critical"] = true;
        if (i->fix.is_object())
            j["fix"] = i->fix;
        out.push_back(j);
    }
    return out;
}

bool has_error(const nlohmann::json& issues)
{
    if (!issues.is_array())
        return false;
    return std::any_of(issues.begin(), issues.end(), [](const nlohmann::json& i) { return Json::str(i, "level") == "error"; });
}

}} // namespace Plyo::OrcaMessagesLogic
