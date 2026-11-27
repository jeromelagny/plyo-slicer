#include "PlyoSlots.hpp"

#include "PlyoJson.hpp"
#include "PlyoSlotsLogic.hpp"
#include "PlyoStore.hpp"

#include "libslic3r/MaterialType.hpp"

#include <vector>

namespace Plyo { namespace Slots {

namespace {

boost::filesystem::path path_of() { return Store::dir() / "slots.json"; }

std::vector<std::string> known_types()
{
    std::vector<std::string> out;
    for (const Slic3r::MaterialTypeInfo& m : Slic3r::MaterialType::all())
        out.push_back(m.name);
    return out;
}

} // namespace

nlohmann::json manual_get(const std::string& printer_preset)
{
    const nlohmann::json all = SlotsLogic::sanitize_manual(Store::read(path_of()), known_types());
    return SlotsLogic::manual_state(printer_preset.empty() ? nlohmann::json() : Json::any(all, printer_preset.c_str()));
}

nlohmann::json manual_save(const std::string& printer_preset, const nlohmann::json& slots)
{
    bool                 ok  = false;
    const nlohmann::json all = SlotsLogic::manual_with(Store::read(path_of()), printer_preset, slots, known_types(), ok);
    ok = ok && Store::write(path_of(), all);
    return {{"ok", ok}};
}

}} // namespace Plyo::Slots
