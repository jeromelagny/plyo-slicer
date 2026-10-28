#include "PlyoLimits.hpp"
#include "PlyoSanitize.hpp"
#include "PlyoStore.hpp"

#include "libslic3r/Preset.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "slic3r/GUI/GUI_App.hpp"

namespace Plyo { namespace Limits {

namespace {

boost::filesystem::path file() { return Store::dir() / "limites.json"; }

Slic3r::PresetBundle& bundle() { return *Slic3r::GUI::wxGetApp().preset_bundle; }

// Plage de buse du profil filament (0 : non renseignée).
std::optional<double> nozzle_range_value(const char* key)
{
    const auto* opt = bundle().filaments.get_edited_preset().config.option<Slic3r::ConfigOptionInts>(key);
    if (opt == nullptr || opt->values.empty() || opt->values.front() <= 0)
        return std::nullopt;
    return static_cast<double>(opt->values.front());
}

} // namespace

std::string machine_key()
{
    return bundle().printers.get_edited_preset().name + " | " + bundle().filaments.get_edited_preset().name;
}

Range current()
{
    Range r;
    r.nozzle_min = nozzle_range_value("nozzle_temperature_range_low");
    r.nozzle_max = nozzle_range_value("nozzle_temperature_range_high");
    const nlohmann::json all = Sanitize::limits(Store::read(file()));
    if (const auto it = all.find(machine_key()); it != all.end()) {
        const Range saved = from_json(*it);
        if (saved.nozzle_min || saved.nozzle_max) { r.nozzle_min = saved.nozzle_min; r.nozzle_max = saved.nozzle_max; }
        r.bed_min = saved.bed_min;
        r.bed_max = saved.bed_max;
    }
    return r;
}

bool set(const nlohmann::json& limits)
{
    nlohmann::json all = Sanitize::limits(Store::read(file()));
    if (limits.is_object() && !limits.empty()) {
        const nlohmann::json one = Sanitize::limits(nlohmann::json{{"x", limits}});
        if (!one.contains("x"))
            return false;
        all[machine_key()] = one["x"];
    } else
        all.erase(machine_key());
    return Store::write(file(), all);
}

}} // namespace Plyo::Limits
