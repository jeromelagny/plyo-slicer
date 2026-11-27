#include "PlyoCfs.hpp"

#include "PlyoCfsLogic.hpp"

#include "libslic3r/PrintConfig.hpp"
#include "slic3r/Utils/CrealityPrint.hpp"
#include "slic3r/Utils/PrintHost.hpp"

#include <memory>

namespace Plyo { namespace Cfs {

nlohmann::json read(const Slic3r::DynamicPrintConfig& config, std::string& error)
{
    try {
        Slic3r::DynamicPrintConfig         copy = config;
        std::unique_ptr<Slic3r::PrintHost> host(Slic3r::PrintHost::get_print_host(&copy));
        const auto*                        creality = dynamic_cast<const Slic3r::CrealityPrint*>(host.get());
        if (creality == nullptr) {
            error = "profil sans connexion Creality";
            return nullptr;
        }
        const std::string model = creality->model_name();
        const std::string body  = creality->query_boxes_info();
        if (body.empty()) {
            error = "pas de réponse";
            return nullptr;
        }
        const nlohmann::json parsed = CfsLogic::parse_boxes(body);
        if (!parsed.value("ok", false)) {
            error = "réponse illisible";
            return nullptr;
        }
        const std::string profile_model = copy.has("printer_model") ? copy.opt_string("printer_model") : std::string();
        const std::string blocker       = CfsLogic::live_blocker(model, profile_model, parsed);
        return {{"canvases", parsed["canvases"]}, {"imposable", blocker.empty()}, {"blocker", blocker}};
    } catch (const std::exception&) {
        error = "échec de la lecture";
        return nullptr;
    }
}

}} // namespace Plyo::Cfs
