#include "PlyoColoursLogic.hpp"

#include "PlyoJson.hpp"

#include <algorithm>
#include <cctype>
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

}} // namespace Plyo::ColoursLogic
