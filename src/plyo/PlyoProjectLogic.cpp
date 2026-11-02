#include "PlyoProjectLogic.hpp"

#include "PlyoJson.hpp"

#include <algorithm>
#include <cmath>

namespace Plyo { namespace ProjectLogic {

namespace {

bool has_object(const nlohmann::json& project, const char* key, const char* required)
{
    const nlohmann::json* part = Json::field(project, key);
    if (part == nullptr || !part->is_object())
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
    if (!has_object(project, "filament", "preset"))
        out.push_back("filament");
    if (!has_object(project, "part", "name"))
        out.push_back("part");
    return out;
}

bool complete(const nlohmann::json& project) { return missing(project).empty(); }

std::string refusal(const nlohmann::json& project, const std::string& current_printer, const std::string& current_filament)
{
    const std::vector<std::string> todo = missing(project);
    if (!todo.empty())
        return "Complète d'abord la fiche du projet (imprimante, filament, pièce) : je ne change aucun réglage tant qu'elle est incomplète.";
    if (Json::str(*Json::field(project, "printer"), "preset") != current_printer ||
        Json::str(*Json::field(project, "filament"), "preset") != current_filament)
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
        out["filament"] = o;
    }
    if (const nlohmann::json* a = Json::field(project, "part"); a != nullptr && a->is_object()) {
        nlohmann::json o = nlohmann::json::object();
        text(*a, o, "name");
        out["part"] = o;
    }
    const std::string step = Json::str(project, "step");
    if (step == "slice" || step == "print" || step == "after")
        out["step"] = step;
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
        if (is_temperature_key(key) || !it.value().is_number())
            continue;
        const nlohmann::json range = range_of(key);
        if (!range.is_object())
            continue;
        const double value = it.value().get<double>();
        if (value < Json::num(range, "min", value) || value > Json::num(range, "max", value))
            out.dropped.push_back({{"key", key}, {"reason", "valeur hors de la plage sûre de l'assistant"}});
        else
            out.apply.push_back({{"key", key}, {"value", it.value()}});
    }
    return out;
}

}} // namespace Plyo::ProjectLogic
