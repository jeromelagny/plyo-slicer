#include "PlyoHabits.hpp"
#include "PlyoProjectLogic.hpp"
#include "PlyoStore.hpp"

namespace Plyo { namespace Habits {

namespace {
boost::filesystem::path path_of() { return Store::dir() / "habits.json"; }
} // namespace

nlohmann::json load() { return ProjectLogic::sanitize_habits(Store::read(path_of())); }

bool save(const nlohmann::json& habits) { return Store::write(path_of(), ProjectLogic::sanitize_habits(habits)); }

}} // namespace Plyo::Habits
