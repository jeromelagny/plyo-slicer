#include "PlyoSanitize.hpp"
#include "PlyoJson.hpp"

namespace Plyo { namespace Sanitize {

using nlohmann::json;

json first_steps(const json& stored)
{
    // layout : disposition de la fenêtre (mode Simple, lot 8) ; « advanced » par défaut, pour ne rien changer à qui utilise déjà Plyo.
    // ui : version du panneau, « v2 » par défaut ; « classique » seulement choisi exprès dans le menu (ui_chosen). Un ancien
    // « classique » écrit sans ce choix (valeur par défaut d'avant, enregistrée avec le reste) repasse en v2.
    json s = {{"seen", false}, {"level", nullptr}, {"tour_step", nullptr}, {"greeted", false}, {"share_outcomes", false}, {"layout", "simple"},
              {"layout_chosen", false}, {"ui", "v2"}, {"ui_chosen", false}};
    if (!stored.is_object())
        return s;
    // Barre de réglages repliée pour tout le monde (décision du 2026-11-24) ; la disposition complète seulement décochée exprès
    // dans le menu ⋯ (layout_chosen). Un « advanced » écrit comme valeur par défaut d'avant repasse en « simple ».
    s["layout_chosen"] = Json::boolean(stored, "layout_chosen", false);
    if (s["layout_chosen"] == true && Json::str(stored, "layout", 20) == "advanced")
        s["layout"] = "advanced";
    s["ui_chosen"] = Json::boolean(stored, "ui_chosen", false);
    if (s["ui_chosen"] == true && Json::str(stored, "ui", 20) == "classique")
        s["ui"] = "classique";
    for (const char* key : {"seen", "greeted", "share_outcomes"})
        s[key] = Json::boolean(stored, key, false);
    for (const char* key : {"level", "tour_step"}) {
        const std::string text = Json::str(stored, key, 40);
        if (!text.empty())
            s[key] = text;
    }
    return s;
}

json memory(const json& stored)
{
    json out = json::object();
    if (!stored.is_object())
        return out;
    for (const auto& [machine, list] : stored.items()) {
        json kept = json::array();
        if (list.is_array())
            for (const json& e : list)
                if (e.is_object() && Json::field(e, "changes") != nullptr && e["changes"].is_array())
                    kept.push_back(e);
        out[machine] = kept;
    }
    return out;
}

json limits(const json& stored)
{
    json out = json::object();
    if (!stored.is_object())
        return out;
    for (const auto& [machine, item] : stored.items()) {
        if (!item.is_object())
            continue;
        json   kept = json::object();
        double v[4] = {0, 400, 0, 150};
        bool   ok   = true;
        const char* keys[4] = {"nozzle_min", "nozzle_max", "bed_min", "bed_max"};
        const double top[4] = {400, 400, 150, 150};
        for (int i = 0; i < 4; ++i) {
            const auto it = item.find(keys[i]);
            if (it == item.end() || !it->is_number())
                continue;
            const double x = it->get<double>();
            if (!(x >= 0 && x <= top[i])) {
                ok = false;
                break;
            }
            v[i]       = x;
            kept[keys[i]] = x;
        }
        if (ok && v[0] <= v[1] && v[2] <= v[3] && !kept.empty())
            out[machine] = kept;
    }
    return out;
}

json reliable(const json& stored)
{
    if (!stored.is_object() || Json::str(stored, "machine").empty())
        return json::object();
    json values = json::object();
    const json src = Json::obj(stored, "values");
    // Seuls les réglages du filament : ceux d'impression sont ceux de la pièce d'alors (une version écrite avant le lot 4
    // les contient encore, ils sont ignorés à la lecture : remettre une équerre en mode vase n'est jamais un retour arrière).
    for (const char* scope : {"filament"}) {
        json       kept   = json::object();
        const json scoped = Json::obj(src, scope); // copie nommée : items() d'un temporaire pointerait dans le vide
        for (const auto& [key, value] : scoped.items())
            if (value.is_string())
                kept[key] = value;
        values[scope] = kept;
    }
    return {{"machine", Json::str(stored, "machine")}, {"date", Json::str(stored, "date", 40)}, {"at", Json::str(stored, "at", 40)}, {"values", values}};
}

json journal(const json& stored)
{
    json out = json::array();
    if (stored.is_array())
        for (const json& e : stored)
            if (e.is_object() && !Json::str(e, "conv").empty() && Json::field(e, "parts") != nullptr && e["parts"].is_array())
                out.push_back(e);
    return out;
}

json calibrations(const json& stored)
{
    json out = json::object();
    if (!stored.is_object())
        return out;
    for (const auto& [machine, tests] : stored.items()) {
        if (!tests.is_object())
            continue;
        json kept = json::object();
        for (const auto& [test, item] : tests.items())
            if (item.is_object() && Json::field(item, "value") != nullptr && item["value"].is_number())
                kept[test] = item;
        out[machine] = kept;
    }
    return out;
}

}} // namespace Plyo::Sanitize
