#pragma once

#include <nlohmann/json.hpp>

#include <optional>
#include <string>

// Limites données par le fabricant du filament (fiche technique) : bornes strictes sur les températures.
// Sans dépendance à Orca (testé par src/plyo/tests/cpp).
namespace Plyo { namespace Limits {

struct Range
{
    std::optional<double> nozzle_min, nozzle_max, bed_min, bed_max;
};

enum class Verdict { Ok, Below, Above };

// `id` : identifiant Plyo du réglage (nozzle_temp, nozzle_temp_initial, bed_temp, bed_temp_initial) ; les autres sont libres.
inline Verdict check(const std::string& id, double value, const Range& r)
{
    const bool nozzle = id == "nozzle_temp" || id == "nozzle_temp_initial";
    const bool bed    = id == "bed_temp" || id == "bed_temp_initial";
    if (!nozzle && !bed)
        return Verdict::Ok;
    const std::optional<double>& lo = nozzle ? r.nozzle_min : r.bed_min;
    const std::optional<double>& hi = nozzle ? r.nozzle_max : r.bed_max;
    if (lo && value < *lo)
        return Verdict::Below;
    if (hi && value > *hi)
        return Verdict::Above;
    return Verdict::Ok;
}

inline Range from_json(const nlohmann::json& j)
{
    Range r;
    if (!j.is_object())
        return r;
    const auto read = [&](const char* key, std::optional<double>& out) {
        const auto it = j.find(key);
        if (it != j.end() && it->is_number())
            out = it->get<double>();
    };
    read("nozzle_min", r.nozzle_min);
    read("nozzle_max", r.nozzle_max);
    read("bed_min", r.bed_min);
    read("bed_max", r.bed_max);
    return r;
}

inline nlohmann::json to_json(const Range& r)
{
    nlohmann::json j = nlohmann::json::object();
    if (r.nozzle_min) j["nozzle_min"] = *r.nozzle_min;
    if (r.nozzle_max) j["nozzle_max"] = *r.nozzle_max;
    if (r.bed_min) j["bed_min"] = *r.bed_min;
    if (r.bed_max) j["bed_max"] = *r.bed_max;
    return j;
}

}} // namespace Plyo::Limits
