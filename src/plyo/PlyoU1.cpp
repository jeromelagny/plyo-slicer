#include "PlyoU1.hpp"

#include "PlyoJson.hpp"
#include "PlyoU1Logic.hpp"

#include "libslic3r/PrintConfig.hpp"
#include "slic3r/Utils/Http.hpp"

namespace Plyo { namespace U1 {

nlohmann::json read(const Slic3r::DynamicPrintConfig& config, std::string& error)
{
    try {
        const std::string url = U1Logic::query_url(config.has("print_host") ? config.opt_string("print_host") : std::string());
        if (url.empty()) {
            error = "profil sans adresse";
            return nullptr;
        }
        std::string body;
        bool        ok   = false;
        auto        http = Slic3r::Http::get(url);
        if (config.has("printhost_apikey") && !config.opt_string("printhost_apikey").empty())
            http.header("X-Api-Key", config.opt_string("printhost_apikey"));
        // Délais d'Orca (SnapmakerPrinterAgent::fetch_filament_info).
        http.timeout_connect(5)
            .timeout_max(10)
            .on_complete([&](std::string text, unsigned status) {
                ok   = status == 200;
                body = std::move(text);
            })
            .on_error([](std::string, std::string, unsigned) {})
            .perform_sync();
        if (!ok) {
            error = "pas de réponse";
            return nullptr;
        }
        const nlohmann::json parsed = U1Logic::parse_query(body);
        if (!Json::boolean(parsed, "ok", false)) {
            error = "réponse illisible";
            return nullptr;
        }
        return {{"canvases", parsed["canvases"]}, {"imposable", false}, {"blocker", "la U1 n'a pas de répartition à l'envoi"}};
    } catch (const std::exception&) {
        error = "échec de la lecture";
        return nullptr;
    }
}

}} // namespace Plyo::U1
