#include "PlyoIfs.hpp"

#include "PlyoIfsLogic.hpp"

#include "libslic3r/PrintConfig.hpp"
#include "slic3r/Utils/Flashforge.hpp"
#include "slic3r/Utils/PrintHost.hpp"

#include <memory>
#include <vector>

namespace Plyo { namespace Ifs {

nlohmann::json read(const Slic3r::DynamicPrintConfig& config, std::string& error)
{
    try {
        Slic3r::DynamicPrintConfig         copy = config;
        std::unique_ptr<Slic3r::PrintHost> host(Slic3r::PrintHost::get_print_host(&copy));
        const auto*                        flashforge = dynamic_cast<const Slic3r::Flashforge*>(host.get());
        if (flashforge == nullptr) {
            error = "profil sans connexion Flashforge";
            return nullptr;
        }
        std::vector<Slic3r::FlashforgeMaterialSlot> slots;
        bool                                        supports = false;
        wxString                                    message; // peut citer la réponse de la machine : ni journalisé, ni transmis
        if (!flashforge->fetch_material_slots(slots, &supports, message)) {
            error = "pas de réponse exploitable";
            return nullptr;
        }
        std::vector<IfsLogic::Slot> converted;
        for (const Slic3r::FlashforgeMaterialSlot& s : slots)
            converted.push_back({s.slot_id, s.has_filament, s.material_name, s.material_color});
        const bool live = IfsLogic::live_imposable(supports, converted);
        return {{"canvases", IfsLogic::canvases_from_slots(converted)}, {"imposable", live}, {"blocker", live ? std::string() : std::string("poste de matière absent ou numéros inattendus")}};
    } catch (const std::exception&) {
        error = "échec de la lecture";
        return nullptr;
    }
}

}} // namespace Plyo::Ifs
