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
Status read_creality(const std::string& print_host)
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
        while (std::chrono::steady_clock::now() < until && !(fields.contains("state") && fields.contains("printFileName"))) {
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
        return creality_status(fields);
    } catch (const std::exception& e) {
        BOOST_LOG_TRIVIAL(info) << "Plyo: état Creality illisible : " << e.what();
        return Status{"unknown", "", -1};
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

Status read(const std::string& kind, const Slic3r::DynamicPrintConfig& c)
{
    if (kind == "crealityprint")
        return read_creality(c.opt_string("print_host"));
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
        const Status before = read(kind, *config);
        if (before.state == "unknown") {
            post(to_json("unknown", before));
            return;
        }
        Status last = before;
        for (int i = 0; i < 48 && gen == g_generation.load(); ++i) { // 48 × 5 s = 4 min
            std::this_thread::sleep_for(std::chrono::seconds(5));
            last                 = read(kind, *config);
            const std::string v  = verdict(before, last);
            if (v == "started" || v == "busy" || v == "error") {
                post(to_json(v, last));
                return;
            }
        }
        if (gen == g_generation.load())
            post(to_json("timeout", last));
    }).detach();
}

} // namespace Plyo::PrinterStatus
