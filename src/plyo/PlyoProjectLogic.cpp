#include "PlyoProjectLogic.hpp"

#include "PlyoCatalogPolicy.hpp"
#include "PlyoJson.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>

namespace Plyo { namespace ProjectLogic {

namespace {

bool has_object(const nlohmann::json& project, const char* key, const char* required)
{
    const nlohmann::json* part = Json::field(project, key);
    if (part == nullptr || !part->is_object())
        return false;
    // Valeur reprise du projet précédent et pas encore confirmée : comme si elle manquait.
    const nlohmann::json* proposed = Json::field(*part, "proposed");
    if (proposed != nullptr && proposed->is_boolean() && proposed->get<bool>())
        return false;
    const nlohmann::json* value = Json::field(*part, required);
    return value != nullptr && value->is_string() && !value->get_ref<const std::string&>().empty();
}

// Clés de température d'Orca de la liste blanche de l'assistant.
const char* const NOZZLE_KEYS[] = {"nozzle_temperature", "nozzle_temperature_initial_layer"};
const char* const BED_KEYS[]    = {"hot_plate_temp", "textured_plate_temp", "cool_plate_temp", "eng_plate_temp"};

bool is_temperature_key(const std::string& key)
{
    for (const char* k : NOZZLE_KEYS)
        if (key == k)
            return true;
    for (const char* k : BED_KEYS)
        if (key == k)
            return true;
    return false;
}

} // namespace

std::vector<std::string> missing(const nlohmann::json& project)
{
    std::vector<std::string> out;
    if (!has_object(project, "printer", "preset"))
        out.push_back("printer");
    if (!has_object(project, "part", "name"))
        out.push_back("part");
    if (!has_object(project, "filament", "preset"))
        out.push_back("filament");
    return out;
}

bool complete(const nlohmann::json& project) { return missing(project).empty(); }

bool same_filament(const std::string& project_preset, const std::string& current)
{
    if (project_preset.empty())
        return false;
    if (current == project_preset)
        return true;
    for (const char* suffix : {" (Plyo)", " — "})
        if (current.rfind(project_preset + suffix, 0) == 0)
            return true;
    return false;
}

std::string edit_refusal(const nlohmann::json& project, const std::string& current_printer, const std::string& current_filament)
{
    const std::vector<std::string> todo = missing(project);
    const bool has_printer  = std::find(todo.begin(), todo.end(), "printer") == todo.end();
    const bool has_filament = std::find(todo.begin(), todo.end(), "filament") == todo.end();
    if (has_printer && Json::str(*Json::field(project, "printer"), "preset") != current_printer)
        return "Orca n'est plus sur l'imprimante de ce projet. Remets le projet dans Orca avant de changer des réglages.";
    if (has_filament && !same_filament(Json::str(*Json::field(project, "filament"), "preset"), current_filament))
        return "Orca n'est plus sur le filament de ce projet. Remets le projet dans Orca avant de changer des réglages.";
    return std::string();
}

bool can_restore(const nlohmann::json& project, const std::string& current_printer, const std::string& current_filament)
{
    const std::vector<std::string> todo = missing(project);
    if (std::find(todo.begin(), todo.end(), "printer") != todo.end() || std::find(todo.begin(), todo.end(), "filament") != todo.end())
        return false;
    return Json::str(*Json::field(project, "printer"), "preset") != current_printer ||
           !same_filament(Json::str(*Json::field(project, "filament"), "preset"), current_filament);
}

std::vector<std::string> missing_for(const nlohmann::json& project, bool filament_only)
{
    std::vector<std::string> out = missing(project);
    // Un réglage de l'onglet Filament ne dépend pas de la pièce : « ma pièce d'hier a des fils » se corrige sans elle.
    if (filament_only)
        out.erase(std::remove(out.begin(), out.end(), "part"), out.end());
    return out;
}

std::string refusal(const nlohmann::json& project, const std::string& current_printer, const std::string& current_filament, bool filament_only)
{
    const std::vector<std::string> todo = missing_for(project, filament_only);
    if (!todo.empty()) {
        // « Pour appliquer ça, dis-moi d'abord sur quelle machine, quelle pièce et avec quelle bobine tu imprimes. »
        std::string list;
        for (size_t i = 0; i < todo.size(); ++i) {
            if (i > 0)
                list += i + 1 == todo.size() ? " et " : ", ";
            list += todo[i] == "printer" ? "sur quelle machine" : todo[i] == "part" ? "quelle pièce" : "avec quelle bobine";
        }
        return "Pour appliquer ça, dis-moi d'abord " + list + " tu imprimes.";
    }
    if (Json::str(*Json::field(project, "printer"), "preset") != current_printer ||
        !same_filament(Json::str(*Json::field(project, "filament"), "preset"), current_filament))
        return "Orca n'est plus sur l'imprimante ou le filament de ce projet. Remets le projet dans Orca avant de changer des réglages.";
    return std::string();
}

nlohmann::json sanitize(const nlohmann::json& project)
{
    if (!project.is_object())
        return nullptr;
    auto text = [](const nlohmann::json& src, nlohmann::json& dst, const char* key) {
        const std::string v = Json::str(src, key, 200);
        if (!v.empty())
            dst[key] = v;
    };
    auto number = [](const nlohmann::json& src, nlohmann::json& dst, const char* key) {
        const nlohmann::json* v = Json::field(src, key);
        if (v != nullptr && v->is_number() && std::isfinite(v->get<double>()))
            dst[key] = *v;
    };
    auto flag = [](const nlohmann::json& src, nlohmann::json& dst) {
        const nlohmann::json* v = Json::field(src, "proposed");
        if (v != nullptr && v->is_boolean() && v->get<bool>())
            dst["proposed"] = true;
    };
    nlohmann::json out = {{"printer", nullptr}, {"filament", nullptr}, {"part", nullptr}};
    if (const nlohmann::json* p = Json::field(project, "printer"); p != nullptr && p->is_object()) {
        nlohmann::json o = nlohmann::json::object();
        text(*p, o, "preset");
        text(*p, o, "name");
        flag(*p, o);
        out["printer"] = o;
    }
    if (const nlohmann::json* f = Json::field(project, "filament"); f != nullptr && f->is_object()) {
        nlohmann::json o = nlohmann::json::object();
        text(*f, o, "type");
        text(*f, o, "preset");
        number(*f, o, "nozzle_temp");
        number(*f, o, "bed_temp");
        flag(*f, o);
        // Températures de la bobine vérifiées à l'étape Filament (panneau) : sinon la question est reposée.
        if (const nlohmann::json* v = Json::field(*f, "temps_ok"); v != nullptr && v->is_boolean() && v->get<bool>())
            o["temps_ok"] = true;
        // Bobine du filament 1 (étape Filament) : son id et son nom, rien d'autre.
        if (const nlohmann::json* s = Json::field(*f, "spool"); s != nullptr && s->is_object()) {
            nlohmann::json spool = nlohmann::json::object();
            text(*s, spool, "id");
            text(*s, spool, "name");
            if (spool.contains("id") && spool.contains("name"))
                o["spool"] = spool;
        }
        out["filament"] = o;
    }
    if (const nlohmann::json* a = Json::field(project, "part"); a != nullptr && a->is_object()) {
        nlohmann::json o = nlohmann::json::object();
        text(*a, o, "name");
        out["part"] = o;
    }
    if (const nlohmann::json* in = Json::field(project, "intent"); in != nullptr && in->is_object()) {
        nlohmann::json o = nlohmann::json::object();
        for (const char* key : {"use", "pref", "speed"}) {
            const nlohmann::json* v = Json::field(*in, key);
            if (v != nullptr && v->is_string() && !v->get_ref<const std::string&>().empty() && v->get_ref<const std::string&>().size() <= 20)
                o[key] = *v;
        }
        for (const char* key : {"skipped", "applied"})
            if (const nlohmann::json* v = Json::field(*in, key); v != nullptr && v->is_boolean())
                o[key] = *v;
        out["intent"] = o;
    }
    if (const nlohmann::json* c = Json::field(project, "canvas"); c != nullptr && c->is_array()) {
        nlohmann::json list = nlohmann::json::array();
        for (const nlohmann::json& e : *c) {
            auto whole = [&](const char* key, int lo, int hi) {
                const nlohmann::json* v = Json::field(e, key);
                return v != nullptr && v->is_number_integer() && v->get<int>() >= lo && v->get<int>() <= hi;
            };
            if (!e.is_object() || !whole("t", 0, 15) || !whole("canvas_id", 0, 15) || !whole("tray_id", 0, 15) || list.size() >= 16)
                continue;
            nlohmann::json o = {{"t", e["t"]}, {"canvas_id", e["canvas_id"]}, {"tray_id", e["tray_id"]}};
            text(e, o, "type");
            text(e, o, "color");
            text(e, o, "preset");
            // Numéro affiché et nature de l'emplacement (CFS, IFS, U1, saisie manuelle). Une valeur illisible disparaît.
            text(e, o, "label");
            for (const char* key : {"imposable", "validated"})
                if (const nlohmann::json* v = Json::field(e, key); v != nullptr && v->is_boolean())
                    o[key] = *v;
            const std::string source = Json::str(e, "source"), system = Json::str(e, "system");
            if (source == "printer" || source == "manual")
                o["source"] = source;
            if (system == "canvas" || system == "cfs" || system == "ifs" || system == "u1" || system == "manual")
                o["system"] = system;
            list.push_back(o);
        }
        if (!list.empty())
            out["canvas"] = list;
    }
    if (const std::string adapted = Json::str(project, "adapted", 200); !adapted.empty())
        out["adapted"] = adapted;
    // Réussite dite à l'étape Résultat : elle tient après une réouverture de la conversation.
    if (const nlohmann::json* v = Json::field(project, "success"); v != nullptr && v->is_boolean() && v->get<bool>())
        out["success"] = true;
    // Dernier envoi ou export fait depuis le panneau : sa bobine, l'id de son suivi sur la machine, la fin lue et ce que tu
    // en as dit. Gardé avec la conversation pour que « Oui, c'est réussi » et la question de fin survivent à une fermeture.
    if (const nlohmann::json* s = Json::field(project, "send"); s != nullptr && s->is_object()) {
        nlohmann::json o = nlohmann::json::object();
        if (const nlohmann::json* sp = Json::field(*s, "spool"); sp != nullptr && sp->is_object()) {
            nlohmann::json spool = nlohmann::json::object();
            text(*sp, spool, "id");
            text(*sp, spool, "name");
            if (spool.contains("id") && spool.contains("name"))
                o["spool"] = spool;
        }
        if (const std::string watch = Json::str(*s, "watch", 60); !watch.empty())
            o["watch"] = watch;
        for (const char* key : {"failed", "answered", "marked"})
            if (const nlohmann::json* v = Json::field(*s, key); v != nullptr && v->is_boolean() && v->get<bool>())
                o[key] = true;
        const auto verdict = [](const std::string& v) { return v == "finished" || v == "cancelled" || v == "error"; };
        if (const nlohmann::json* e = Json::field(*s, "end"); e != nullptr && e->is_object() && verdict(Json::str(*e, "verdict"))) {
            nlohmann::json end = {{"verdict", Json::str(*e, "verdict")}};
            text(*e, end, "file");
            o["end"] = end;
        }
        if (const std::string outcome = Json::str(*s, "outcome"); verdict(outcome))
            o["outcome"] = outcome;
        // Lot 4 : la réponse de Résultat pour les corrections de cette impression (« ok » / « bad ») et les entrées de la
        // mémoire qu'elle a marquées (instants « at »), pour qu'un changement d'avis vise les mêmes. Absents avant le lot 4.
        if (const std::string said = Json::str(*s, "corrections_outcome"); said == "ok" || said == "bad")
            o["corrections_outcome"] = said;
        if (const nlohmann::json* c = Json::field(*s, "corrections"); c != nullptr && c->is_array()) {
            nlohmann::json ats = nlohmann::json::array();
            for (const nlohmann::json& at : *c)
                if (at.is_string() && !at.get_ref<const std::string&>().empty() && at.get_ref<const std::string&>().size() <= 40 && ats.size() < 20)
                    ats.push_back(at);
            o["corrections"] = ats;
        }
        out["send"] = o;
    }
    const std::string step = Json::str(project, "step");
    if (step == "slice" || step == "print" || step == "after" || step == "done")
        out["step"] = step;
    // Réglages posés par l'assistant pour ce projet (« print/wall_loops » → dernières valeurs écrites, telles qu'Orca les écrit,
    // et le lot qui les a écrites) : le panneau ne les présente pas comme des modifications manuelles. Gardé même vide : on
    // sait alors qu'il n'y en a pas (une conversation plus ancienne n'a pas ce champ).
    if (const nlohmann::json* a = Json::field(project, "assistant"); a != nullptr && a->is_object()) {
        nlohmann::json o = nlohmann::json::object();
        for (auto it = a->begin(); it != a->end() && o.size() < 300; ++it) {
            if (it.key().empty() || it.key().size() > 120 || !it.value().is_array())
                continue;
            nlohmann::json list = nlohmann::json::array();
            for (const nlohmann::json& e : it.value()) {
                const nlohmann::json* v = Json::field(e, "v");
                const std::string     b = Json::str(e, "b");
                if (list.size() < 5 && v != nullptr && v->is_string() && v->get_ref<const std::string&>().size() <= 200 && !b.empty() && b.size() <= 40)
                    list.push_back({{"v", *v}, {"b", b}});
            }
            if (!list.empty())
                o[it.key()] = list;
        }
        out["assistant"] = o;
    }
    return out;
}

std::vector<std::pair<int, std::string>> extra_filaments(const nlohmann::json& project)
{
    std::vector<std::pair<int, std::string>> out;
    for (const nlohmann::json& e : Json::arr(sanitize(project), "canvas")) {
        const int t = e["t"].get<int>();
        const std::string preset = Json::str(e, "preset");
        if (t > 0 && !preset.empty())
            out.emplace_back(t, preset);
    }
    return out;
}

nlohmann::json first_values(const nlohmann::json& settings)
{
    nlohmann::json out = nlohmann::json::object();
    if (!settings.is_object())
        return out;
    for (auto it = settings.begin(); it != settings.end(); ++it) {
        if (it.value().is_string())
            out[it.key()] = it.value();
        else if (it.value().is_array() && !it.value().empty() && it.value().front().is_string())
            out[it.key()] = it.value().front();
    }
    return out;
}

nlohmann::json sanitize_habits(const nlohmann::json& habits)
{
    nlohmann::json out = {{"machines", nlohmann::json::object()}, {"hidden", nlohmann::json::array()}, {"last", ""}};
    if (!habits.is_object())
        return out;
    if (const nlohmann::json* machines = Json::field(habits, "machines"); machines != nullptr && machines->is_object()) {
        for (auto it = machines->begin(); it != machines->end() && out["machines"].size() < 50; ++it) {
            const nlohmann::json* filament = it.value().is_object() ? Json::field(it.value(), "filament") : nullptr;
            if (filament == nullptr || !filament->is_object() || it.key().empty() || it.key().size() > 200)
                continue;
            const std::string type = Json::str(*filament, "type", 20);
            if (type.empty())
                continue;
            nlohmann::json f = {{"type", type}};
            for (const char* key : {"nozzle_temp", "bed_temp"}) {
                const nlohmann::json* v = Json::field(*filament, key);
                if (v != nullptr && v->is_number() && std::isfinite(v->get<double>()) && v->get<double>() >= 0 && v->get<double>() <= 400)
                    f[key] = *v;
            }
            // Nom de la dernière bobine (« Mes machines ») : un texte court, rien d'autre.
            if (const std::string spool = Json::str(*filament, "spool", 60); !spool.empty())
                f["spool"] = spool;
            out["machines"][it.key()] = {{"filament", f}};
        }
    }
    if (const nlohmann::json* hidden = Json::field(habits, "hidden"); hidden != nullptr && hidden->is_array())
        for (const nlohmann::json& h : *hidden)
            if (h.is_string() && !h.get_ref<const std::string&>().empty() && h.get_ref<const std::string&>().size() <= 200 && out["hidden"].size() < 50)
                out["hidden"].push_back(h);
    out["last"] = Json::str(habits, "last", 200);
    if (const std::string level = Json::str(habits, "level"); level == "short" || level == "detailed")
        out["level"] = level;
    if (const nlohmann::json* m = Json::field(habits, "level_manual"); m != nullptr && m->is_boolean())
        out["level_manual"] = m->get<bool>();
    // Revenu aux explications détaillées après une question de définition : plus de passage automatique en court.
    if (const nlohmann::json* h = Json::field(habits, "level_hold"); h != nullptr && h->is_boolean())
        out["level_hold"] = h->get<bool>();
    if (const nlohmann::json* n = Json::field(habits, "intent_skips"); n != nullptr && n->is_number_integer())
        out["intent_skips"] = std::max<long long>(0, std::min<long long>(100, n->get<long long>()));
    if (const nlohmann::json* a = Json::field(habits, "ask_intent"); a != nullptr && a->is_boolean())
        out["ask_intent"] = a->get<bool>();
    // Réponses aux questions sur la pièce du dernier projet préparé (« Comme la dernière fois », UX-33) : des identifiants
    // courts (lettres, chiffres, « _ »), jamais de texte libre.
    if (const nlohmann::json* li = Json::field(habits, "last_intent"); li != nullptr && li->is_object()) {
        nlohmann::json kept = nlohmann::json::object();
        for (const char* key : {"use", "pref", "speed"}) {
            const std::string v = Json::str(*li, key, 30);
            if (!v.empty() && std::all_of(v.begin(), v.end(), [](unsigned char c) { return std::isalnum(c) || c == '_'; }))
                kept[key] = v;
        }
        if (kept.contains("use"))
            out["last_intent"] = kept;
    }
    // Préréglages d'Orca que l'utilisateur ne veut pas comme bobines : la question n'est plus jamais posée pour eux.
    if (const nlohmann::json* d = Json::field(habits, "spool_declined"); d != nullptr && d->is_array()) {
        nlohmann::json list = nlohmann::json::array();
        for (const nlohmann::json& p : *d)
            if (p.is_string() && !p.get_ref<const std::string&>().empty() && p.get_ref<const std::string&>().size() <= 200 && list.size() < 100)
                list.push_back(p);
        if (!list.empty())
            out["spool_declined"] = list;
    }
    return out;
}

Adaptation adapt_3mf(const nlohmann::json& file_values, const nlohmann::json& project,
                     const std::function<nlohmann::json(const std::string&)>& range_of)
{
    Adaptation out;
    const nlohmann::json* filament = Json::field(project, "filament");
    const nlohmann::json  none     = nlohmann::json::object();
    const nlohmann::json& f        = filament != nullptr ? *filament : none;
    const double          nozzle   = Json::num(f, "nozzle_temp", -1);
    const double          bed      = Json::num(f, "bed_temp", -1);
    if (nozzle >= 0)
        for (const char* k : NOZZLE_KEYS)
            out.apply.push_back({{"key", k}, {"value", nozzle}});
    if (bed >= 0)
        for (const char* k : BED_KEYS)
            out.apply.push_back({{"key", k}, {"value", bed}});

    if (!file_values.is_object())
        return out;
    for (auto it = file_values.begin(); it != file_values.end(); ++it) {
        const std::string key = it.key();
        if (is_temperature_key(key))
            continue;
        const nlohmann::json range = range_of(key);
        if (!range.is_object())
            continue;
        if (!it.value().is_number()) {
            out.apply.push_back({{"key", key}, {"value", it.value()}});
            continue;
        }
        const double value = it.value().get<double>();
        if (value < Json::num(range, "min", value) - Catalog::BOUND_MARGIN || value > Json::num(range, "max", value) + Catalog::BOUND_MARGIN)
            out.dropped.push_back({{"key", key}, {"reason", "valeur hors de la plage sûre de l'assistant"}});
        else
            out.apply.push_back({{"key", key}, {"value", it.value()}});
    }
    return out;
}

bool opens_panel_at_startup(const std::string& level) { return level != "expert"; }

}} // namespace Plyo::ProjectLogic
