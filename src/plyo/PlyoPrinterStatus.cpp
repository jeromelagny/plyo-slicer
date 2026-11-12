#include "PlyoPrinterStatus.hpp"

#include "PlyoPrinterStatusLogic.hpp"

#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/Utils/Http.hpp"

#include <boost/asio/connect.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/log/trivial.hpp>

#include <atomic>
#include <chrono>
#include <memory>
#include <thread>

namespace Plyo::PrinterStatus {

namespace {

namespace beast     = boost::beast;
namespace websocket = beast::websocket;
using tcp           = boost::asio::ip::tcp;

std::atomic<int> g_generation{0};

std::string host_type_of(const Slic3r::DynamicPrintConfig& c)
{
    const auto* opt = c.option<Slic3r::ConfigOptionEnum<Slic3r::PrintHostType>>("host_type");
    if (opt == nullptr)
        return std::string();
    if (opt->value == Slic3r::htCrealityPrint)
        return "crealityprint";
    if (opt->value == Slic3r::htMoonraker)
        return "moonraker";
    return "other";
}

// Creality : les messages d'état arrivent d'eux-mêmes sur le WebSocket 9999 ; on fusionne ceux reçus pendant ~3 s.
// `full` : toute la fenêtre de 3 s (suivi de la fin, pour le journal), sinon on s'arrête dès que l'état et le fichier sont là.
// Champs fusionnés ; null si la machine n'a pas répondu.
nlohmann::json read_creality(const std::string& print_host, bool full)
{
    try {
        const std::string host = Slic3r::Http::get_host_from_url(print_host.find("://") == std::string::npos ? "http://" + print_host : print_host);
        boost::asio::io_context              ioc;
        websocket::stream<beast::tcp_stream> ws{ioc};
        tcp::resolver                        resolver{ioc};
        beast::get_lowest_layer(ws).expires_after(std::chrono::seconds(5));
        beast::get_lowest_layer(ws).connect(resolver.resolve(host, "9999"));
        ws.handshake(host + ":9999", "/");
        ws.text(true);
        nlohmann::json fields = nlohmann::json::object();
        const auto     until  = std::chrono::steady_clock::now() + std::chrono::seconds(3);
        while (std::chrono::steady_clock::now() < until && (full || !(fields.contains("state") && fields.contains("printFileName")))) {
            beast::get_lowest_layer(ws).expires_after(std::chrono::seconds(3));
            beast::flat_buffer buf;
            beast::error_code  ec;
            ws.read(buf, ec);
            if (ec)
                break;
            const std::string msg = beast::buffers_to_string(buf.data());
            if (msg.find("heart_beat") != std::string::npos) {
                beast::error_code wr;
                ws.write(boost::asio::buffer(std::string("ok")), wr);
                continue;
            }
            const nlohmann::json j = nlohmann::json::parse(msg, nullptr, false);
            if (j.is_object())
                for (auto it = j.begin(); it != j.end(); ++it)
                    fields[it.key()] = it.value();
        }
        beast::error_code close_ec;
        ws.close(websocket::close_code::normal, close_ec);
        return fields;
    } catch (const std::exception& e) {
        BOOST_LOG_TRIVIAL(info) << "Plyo: état Creality illisible : " << e.what();
        return nlohmann::json();
    }
}

Status read_moonraker(const Slic3r::DynamicPrintConfig& c)
{
    std::string base = c.opt_string("print_host");
    if (base.find("://") == std::string::npos)
        base = "http://" + base;
    while (!base.empty() && base.back() == '/')
        base.pop_back();
    std::string body;
    bool        ok   = false;
    auto        http = Slic3r::Http::get(base + "/printer/objects/query?print_stats");
    if (c.has("printhost_apikey") && !c.opt_string("printhost_apikey").empty())
        http.header("X-Api-Key", c.opt_string("printhost_apikey"));
    http.timeout_connect(4).timeout_max(6)
        .on_complete([&](std::string text, unsigned status) { ok = status == 200; body = std::move(text); })
        .on_error([](std::string, std::string, unsigned) {})
        .perform_sync();
    return ok ? moonraker_status(nlohmann::json::parse(body, nullptr, false)) : Status{"unknown", "", -1};
}

// `logged` : dernière ligne d'état Creality écrite au journal (une ligne par changement, pour apprendre les codes de fin).
Status read(const std::string& kind, const Slic3r::DynamicPrintConfig& c, bool full, std::string& logged)
{
    if (kind == "crealityprint") {
        const nlohmann::json fields = read_creality(c.opt_string("print_host"), full);
        const std::string    line   = creality_status_fields(fields);
        if (!line.empty() && line != logged) {
            BOOST_LOG_TRIVIAL(info) << "Plyo: état Creality : " << line;
            logged = line;
        }
        return fields.is_object() ? creality_status(fields) : Status{"unknown", "", -1};
    }
    if (kind == "moonraker")
        return read_moonraker(c);
    return Status{"unknown", "", -1};
}

nlohmann::json to_json(const std::string& verdict_text, const Status& s)
{
    return {{"verdict", verdict_text}, {"state", s.state}, {"file", s.file}, {"progress", s.progress}};
}

} // namespace

void watch(const std::string& preset, std::function<void(nlohmann::json)> notify)
{
    const Slic3r::Preset* p = Slic3r::GUI::wxGetApp().preset_bundle->printers.find_preset(preset, false);
    const int             gen = ++g_generation;
    auto post = [notify, gen](nlohmann::json r) {
        Slic3r::GUI::wxGetApp().CallAfter([notify, gen, r]() { if (gen == g_generation.load()) notify(r); });
    };
    if (p == nullptr || !p->config.has("print_host") || p->config.opt_string("print_host").empty()) {
        post(to_json("unknown", Status{"unknown", "", -1}));
        return;
    }
    auto              config = std::make_shared<Slic3r::DynamicPrintConfig>(p->config);
    const std::string kind   = host_type_of(*config);
    std::thread([config, kind, post, gen]() {
        // Un nouvel envoi (ou stop()) remplace ce suivi ; Orca qui se ferme l'arrête aussi.
        const auto alive = [gen]() { return gen == g_generation.load() && !Slic3r::GUI::wxGetApp().is_closing(); };
        const auto pause = [&alive](int seconds) {
            for (int i = 0; i < seconds && alive(); ++i)
                std::this_thread::sleep_for(std::chrono::seconds(1));
            return alive();
        };
        std::string  logged;
        const Status before = read(kind, *config, false, logged);
        if (before.state == "unknown") {
            post(to_json("unknown", before));
            return;
        }
        Status last = before;
        bool   started = false;
        for (int i = 0; i < 48 && !started; ++i) { // 48 × 5 s = 4 min
            if (!pause(5))
                return;
            last                = read(kind, *config, false, logged);
            const std::string v = verdict(before, last);
            if (v == "busy" || v == "error") {
                post(to_json(v, last));
                return;
            }
            if (v == "started") {
                post(to_json(v, last));
                started = true;
            }
        }
        if (!started) {
            if (alive())
                post(to_json("timeout", last));
            return;
        }
        // L'impression a démarré : relue toutes les 30 s jusqu'à sa fin, sans limite de durée.
        const Status printing = last;
        auto         answered = std::chrono::steady_clock::now();
        while (pause(END_POLL_SECONDS)) {
            Status now = read(kind, *config, true, logged);
            if (now.state != "unknown")
                answered = std::chrono::steady_clock::now();
            const int silent = int(std::chrono::duration_cast<std::chrono::seconds>(std::chrono::steady_clock::now() - answered).count());
            const std::string v = end_verdict(printing, now, silent);
            if (v.empty())
                continue;
            now.file             = printing.file; // la question de fin parle du fichier envoyé
            nlohmann::json ended = to_json(v, now);
            ended["phase"]       = "end"; // « error » existe aussi au démarrage : le panneau les distingue
            post(ended);
            return;
        }
    }).detach();
}

void stop() { ++g_generation; }

} // namespace Plyo::PrinterStatus
