#include "PlyoColoursLogic.hpp"

#include "PlyoJson.hpp"

#include <algorithm>
#include <cctype>
#include <cstring>
#include <functional>
#include <map>
#include <set>
#include <utility>

namespace Plyo { namespace ColoursLogic {

const char* const TOO_MANY_TEXT = "Ton projet a déjà 16 couleurs : libère-en une avant d'en ajouter.";

namespace {

const char* const NOTHING = " Rien n'a été modifié.";

std::string upper(std::string s)
{
    for (char& c : s)
        c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    return s;
}

// Une entrée {t, canvas_id, tray_id} entière et positive, sinon rien.
bool entry_of(const nlohmann::json& e, int& t, Slot& slot)
{
    if (!e.is_object())
        return false;
    const nlohmann::json* tv = Json::field(e, "t");
    const nlohmann::json* cv = Json::field(e, "canvas_id");
    const nlohmann::json* sv = Json::field(e, "tray_id");
    if (tv == nullptr || cv == nullptr || sv == nullptr || !tv->is_number_integer() || !cv->is_number_integer() || !sv->is_number_integer())
        return false;
    if (tv->get<long long>() < 0 || tv->get<long long>() >= 1000 || cv->get<long long>() < 0 || cv->get<long long>() >= 1000 ||
        sv->get<long long>() < 0 || sv->get<long long>() >= 1000)
        return false;
    t              = tv->get<int>();
    slot.canvas_id = cv->get<int>();
    slot.tray_id   = sv->get<int>();
    return true;
}

bool same(Slot a, Slot b) { return a.canvas_id == b.canvas_id && a.tray_id == b.tray_id; }

} // namespace

int piece_colour(const Piece& piece)
{
    if (piece.parts.empty())
        return piece.t;
    const int first = piece.parts.front().t;
    for (const Part& p : piece.parts)
        if (p.t != first)
            return -1;
    return first;
}

nlohmann::json to_json(const std::vector<Piece>& pieces)
{
    nlohmann::json out = nlohmann::json::array();
    for (const Piece& p : pieces) {
        const int      t     = piece_colour(p);
        nlohmann::json parts = nlohmann::json::array();
        for (const Part& part : p.parts)
            parts.push_back({{"ref", part.ref}, {"name", part.name}, {"t", part.t}});
        const std::set<int> painted(p.painted.begin(), p.painted.end()); // triées, sans doublon
        out.push_back({{"ref", p.ref}, {"name", p.name}, {"selected", p.selected}, {"t", t}, {"mixed", t < 0}, {"parts", parts},
                       {"painted", nlohmann::json(std::vector<int>(painted.begin(), painted.end()))}, {"splittable", p.splittable}});
    }
    return out;
}

Choice filament_for(const nlohmann::json& canvas, const std::vector<int>& used, int count, Slot wanted, int max_count)
{
    Choice        out;
    std::set<int> taken(used.begin(), used.end());
    taken.insert(0); // le filament du projet : jamais repris pour une autre bobine
    if (canvas.is_array())
        for (const nlohmann::json& e : canvas) {
            int  t = 0;
            Slot s;
            if (!entry_of(e, t, s) || t >= count)
                continue;
            if (same(s, wanted)) {
                out.t = t;
                return out;
            }
            taken.insert(t);
        }
    for (int t = 1; t < count; ++t)
        if (taken.count(t) == 0) {
            out.t = t;
            return out;
        }
    if (count >= max_count) {
        out.refusal = TOO_MANY_TEXT;
        return out;
    }
    out.t   = std::max(count, 0);
    out.add = true;
    return out;
}

nlohmann::json canvas_with(const nlohmann::json& canvas, int t, Slot slot)
{
    std::vector<std::pair<int, Slot>> kept;
    if (canvas.is_array())
        for (const nlohmann::json& e : canvas) {
            int  et = 0;
            Slot s;
            if (entry_of(e, et, s) && et != t && !same(s, slot))
                kept.emplace_back(et, s);
        }
    kept.emplace_back(t, slot);
    std::sort(kept.begin(), kept.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
    nlohmann::json out = nlohmann::json::array();
    for (const auto& [et, s] : kept)
        out.push_back({{"t", et}, {"canvas_id", s.canvas_id}, {"tray_id", s.tray_id}});
    return out;
}

nlohmann::json only_used(const nlohmann::json& canvas, const std::vector<int>& used)
{
    nlohmann::json out = nlohmann::json::array();
    if (canvas.is_array())
        for (const nlohmann::json& e : canvas) {
            int  t = 0;
            Slot s;
            if (entry_of(e, t, s) && std::find(used.begin(), used.end(), t) != used.end())
                out.push_back(e);
        }
    return out;
}

std::string busy_refusal(const Busy& b)
{
    if (b.other_conversation)
        return b.other_conversation_text;
    if (b.job)
        return std::string("Plyo Slicer est déjà occupé sur le plateau. Réessaie dans un instant :") + " rien n'a été modifié.";
    if (b.slicing)
        return std::string("Plyo Slicer découpe la plaque : attends la fin de la découpe, puis change la couleur.") + NOTHING;
    if (b.sending || b.calibrating)
        return std::string("Plyo Slicer envoie ou calibre en ce moment : attends la fin, puis change la couleur.") + NOTHING;
    if (b.modal)
        return std::string("Plyo Slicer attend ta réponse dans une fenêtre ouverte : réponds-y d'abord, puis réessaie.") + NOTHING;
    return {};
}

std::string slot_refusal(const nlohmann::json& state, Slot wanted, const std::string& type, const std::string& color)
{
    const std::string again = " : touche « Vérifier à nouveau », puis choisis à nouveau.";
    if (!Json::boolean(state, "ok", false))
        return std::string("Je n'arrive pas à relire tes bobines : touche « Vérifier à nouveau ».") + NOTHING;
    for (const nlohmann::json& unit : Json::arr(state, "canvases")) {
        if (!Json::boolean(unit, "connected", false) || Json::integer(unit, "canvas_id", -1) != wanted.canvas_id)
            continue;
        for (const nlohmann::json& tray : Json::arr(unit, "trays")) {
            if (Json::integer(tray, "tray_id", -1) != wanted.tray_id)
                continue;
            std::string label = Json::str(tray, "label", 20);
            if (label.empty())
                label = std::to_string(wanted.tray_id + 1);
            const std::string now = Json::str(tray, "type", 30);
            if (upper(now) != upper(type))
                return "La bobine " + label + " contient maintenant du " + (now.empty() ? std::string("?") : now) + again + NOTHING;
            if (upper(Json::str(tray, "color", 16)) != upper(color))
                return "La bobine " + label + " a changé de couleur sur l'imprimante" + again + NOTHING;
            if (Json::boolean(state, "empty_blocks", false) && Json::integer(tray, "status", 1) == 0)
                return "La bobine " + label + " est vide : charge-la, règle-la sur l'écran de l'imprimante, puis touche « Vérifier à nouveau »." + NOTHING;
            return {};
        }
    }
    return std::string("Je ne vois plus cette bobine sur l'imprimante") + again + NOTHING;
}

std::string colour_hex(const std::string& value)
{
    if ((value.size() != 7 && value.size() != 9) || value[0] != '#')
        return {};
    for (size_t i = 1; i < value.size(); ++i)
        if (!std::isxdigit(static_cast<unsigned char>(value[i])))
            return {};
    return upper(value.substr(0, 7));
}

namespace {

// Lecture à plat des balises d'un modèle 3MF : assez pour les matériaux, les objets, leurs composants et le `build`, sans
// construire d'arbre (un modèle peut peser des centaines de Mo, faits surtout de sommets et de triangles).
struct XmlTag
{
    std::string                                      name; // sans préfixe d'espace de noms (« m:colorgroup » → « colorgroup »)
    std::vector<std::pair<std::string, std::string>> attrs;
    bool                                             closing = false, empty = false;
    const std::string* get(const char* key) const
    {
        for (const auto& [k, v] : attrs)
            if (k == key)
                return &v;
        return nullptr;
    }
};

std::string local(const std::string& name)
{
    const size_t colon = name.find(':');
    return colon == std::string::npos ? name : name.substr(colon + 1);
}

std::string unescape(const std::string& s)
{
    if (s.find('&') == std::string::npos)
        return s;
    static const std::pair<const char*, char> ENTITIES[] = {{"&amp;", '&'}, {"&lt;", '<'}, {"&gt;", '>'}, {"&quot;", '"'}, {"&apos;", '\''}};
    std::string out;
    for (size_t i = 0; i < s.size(); ++i) {
        bool done = false;
        if (s[i] == '&')
            for (const auto& [ent, c] : ENTITIES)
                if (s.compare(i, std::strlen(ent), ent) == 0) {
                    out += c;
                    i += std::strlen(ent) - 1;
                    done = true;
                    break;
                }
        if (!done)
            out += s[i];
    }
    return out;
}

// La balise qui commence en `pos` (sur '<') ; `pos` passe après son '>'. Faux en fin de texte ou sur une balise coupée.
// `with_attrs` faux : les attributs ne sont pas lus (sommets).
bool next_tag(const std::string& xml, size_t& pos, XmlTag& tag, const std::function<bool(const std::string&)>& with_attrs)
{
    pos = xml.find('<', pos);
    if (pos == std::string::npos)
        return false;
    tag = XmlTag();
    size_t i = pos + 1;
    if (i < xml.size() && (xml[i] == '?' || xml[i] == '!')) { // déclaration, commentaire, CDATA : sautés
        const size_t end = xml.compare(i, 3, "!--") == 0 ? xml.find("-->", i) : xml.find('>', i);
        if (end == std::string::npos)
            return false;
        pos = end + 1;
        return true;
    }
    if (i < xml.size() && xml[i] == '/') {
        tag.closing = true;
        ++i;
    }
    size_t start = i;
    while (i < xml.size() && !std::isspace(static_cast<unsigned char>(xml[i])) && xml[i] != '>' && xml[i] != '/')
        ++i;
    tag.name             = local(xml.substr(start, i - start));
    const bool read_them = !tag.closing && with_attrs(tag.name);
    while (i < xml.size() && xml[i] != '>') {
        if (xml[i] == '/') {
            tag.empty = true;
            ++i;
            continue;
        }
        if (std::isspace(static_cast<unsigned char>(xml[i]))) {
            ++i;
            continue;
        }
        start = i;
        while (i < xml.size() && xml[i] != '=' && xml[i] != '>' && !std::isspace(static_cast<unsigned char>(xml[i])))
            ++i;
        std::string key = xml.substr(start, i - start);
        while (i < xml.size() && std::isspace(static_cast<unsigned char>(xml[i])))
            ++i;
        if (i >= xml.size() || xml[i] != '=')
            continue;
        ++i;
        while (i < xml.size() && std::isspace(static_cast<unsigned char>(xml[i])))
            ++i;
        if (i >= xml.size() || (xml[i] != '"' && xml[i] != '\''))
            continue;
        const char   quote = xml[i];
        const size_t end   = xml.find(quote, i + 1);
        if (end == std::string::npos)
            return false;
        if (read_them)
            tag.attrs.emplace_back(local(key), unescape(xml.substr(i + 1, end - i - 1)));
        i = end + 1;
    }
    if (i >= xml.size())
        return false;
    pos = i + 1;
    return true;
}

int to_int(const std::string* s, int fallback)
{
    if (s == nullptr || s->empty() || s->size() > 9 || s->find_first_not_of("0123456789") != std::string::npos)
        return fallback;
    return std::stoi(*s);
}

struct ModelObjectInfo
{
    std::string      name;
    int              pid = -1, pindex = -1;
    std::vector<int> components;
    size_t           triangles = 0;
    int              face_pid = -2, face_p = -2; // propriété commune à tous les triangles ; -1 : différente d'un triangle à l'autre
};

} // namespace

FileColours model_colours(const std::string& xml)
{
    std::map<int, std::vector<std::string>> groups; // basematerials ou colorgroup : id → couleurs, dans l'ordre de pindex
    std::map<int, ModelObjectInfo>          objects;
    std::vector<int>                        build;
    int                                     group = -1, object = -1;
    const auto with_attrs = [](const std::string& n) { return n != "vertex"; };
    size_t     pos        = 0;
    XmlTag     tag;
    while (next_tag(xml, pos, tag, with_attrs)) {
        const std::string& n = tag.name;
        if (tag.closing) {
            if (n == "basematerials" || n == "colorgroup")
                group = -1;
            else if (n == "object")
                object = -1;
            continue;
        }
        if (n == "vertex")
            continue;
        if (n == "triangle") {
            if (object < 0)
                continue;
            ModelObjectInfo& o   = objects[object];
            const int        pid = to_int(tag.get("pid"), o.pid), p = to_int(tag.get("p1"), o.pindex);
            if (o.triangles++ == 0) {
                o.face_pid = pid;
                o.face_p   = p;
            } else if (o.face_pid != pid || o.face_p != p)
                o.face_pid = o.face_p = -1;
        } else if (n == "basematerials" || n == "colorgroup") {
            group = to_int(tag.get("id"), -1);
            if (group >= 0)
                groups[group]; // groupe vide connu
            if (tag.empty)
                group = -1;
        } else if ((n == "base" || n == "color") && group >= 0) {
            const std::string* c = tag.get(n == "base" ? "displaycolor" : "color");
            groups[group].push_back(c != nullptr ? colour_hex(*c) : std::string());
        } else if (n == "object") {
            object = to_int(tag.get("id"), -1);
            if (object >= 0) {
                ModelObjectInfo& o = objects[object];
                if (const std::string* name = tag.get("name"))
                    o.name = *name;
                o.pid    = to_int(tag.get("pid"), -1);
                o.pindex = to_int(tag.get("pindex"), o.pid >= 0 ? 0 : -1);
            }
            if (tag.empty)
                object = -1;
        } else if (n == "component" && object >= 0) {
            // Un composant d'un autre fichier du paquet (p:path) n'est pas lu ici : sa couleur reste inconnue.
            const int ref = tag.get("path") != nullptr ? -1 : to_int(tag.get("objectid"), -1);
            objects[object].components.push_back(ref);
        } else if (n == "item") {
            const int id = to_int(tag.get("objectid"), -1);
            if (id >= 0 && std::find(build.begin(), build.end(), id) == build.end())
                build.push_back(id);
        }
    }

    auto colour_of = [&](const ModelObjectInfo& o) -> std::string {
        int pid = o.pid, p = o.pindex;
        if (o.triangles > 0 && o.face_pid != -1) { // tous les triangles portent la même propriété (celle de l'objet par défaut)
            pid = o.face_pid;
            p   = o.face_p < 0 ? 0 : o.face_p;
        }
        const auto g = groups.find(pid);
        return g != groups.end() && p >= 0 && p < static_cast<int>(g->second.size()) ? g->second[p] : std::string();
    };

    FileColours out;
    auto        t_of = [&](const std::string& c) {
        if (c.empty())
            return -1;
        auto it = std::find(out.colours.begin(), out.colours.end(), c);
        if (it != out.colours.end())
            return static_cast<int>(it - out.colours.begin());
        out.colours.push_back(c);
        return static_cast<int>(out.colours.size()) - 1;
    };
    constexpr size_t MAX_PARTS = 100000; // comme Orca : un graphe de composants cyclique ne s'étend pas sans fin
    for (int id : build) {
        const auto top = objects.find(id);
        if (top == objects.end())
            continue;
        FileObject fo;
        fo.name = top->second.name;
        // Parcours en largeur, comme _BBS_3MF_Importer::_generate_current_object_list ; un composant sans couleur prend celle
        // de son parent.
        std::vector<std::pair<int, std::string>> queue = {{id, std::string()}};
        size_t                                   seen  = 0;
        for (size_t q = 0; q < queue.size() && seen < MAX_PARTS; ++q) {
            const auto it = objects.find(queue[q].first);
            if (it == objects.end())
                continue;
            std::string c = colour_of(it->second);
            if (c.empty())
                c = queue[q].second;
            if (!it->second.components.empty()) {
                seen += it->second.components.size();
                for (int child : it->second.components)
                    queue.emplace_back(child, c);
            } else if (it->second.triangles > 0)
                fo.parts.push_back({t_of(c), it->second.name});
        }
        out.objects.push_back(fo);
    }
    if (out.colours.size() > MAX_COLOURS) { // au-delà, Orca n'a pas assez de couleurs de projet : rien n'est repris
        out.colours.clear();
        for (FileObject& o : out.objects)
            for (FilePart& p : o.parts)
                p.t = -1;
    }
    return out;
}

std::vector<std::pair<int, std::string>> colours_to_set(const std::vector<std::string>& file, const std::vector<int>& used_by_file,
                                                        const std::vector<int>& used_by_others)
{
    std::vector<std::pair<int, std::string>> out;
    size_t                                   valid = 0;
    for (const std::string& c : file)
        valid += colour_hex(c).empty() ? 0 : 1;
    if (valid < 2)
        return out;
    const std::set<int> mine(used_by_file.begin(), used_by_file.end());
    for (int t : mine)
        if (t >= 0 && t < static_cast<int>(file.size()) && !colour_hex(file[t]).empty() &&
            std::find(used_by_others.begin(), used_by_others.end(), t) == used_by_others.end())
            out.emplace_back(t, colour_hex(file[t]));
    return out;
}

}} // namespace Plyo::ColoursLogic
