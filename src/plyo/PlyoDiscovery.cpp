// Sous Windows, boost (asio) doit être inclus avant les en-têtes de wxWidgets (même règle que BonjourDialog.cpp).
#include "slic3r/Utils/Bonjour.hpp"

#include "PlyoDiscovery.hpp"

#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/Utils/CrealityHostDiscovery.hpp"
#include "slic3r/Utils/Flashforge.hpp"
#include "slic3r/Utils/Http.hpp"

#include <boost/asio/io_context.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/ip/udp.hpp>
#include <boost/asio/steady_timer.hpp>
#include <boost/log/trivial.hpp>

#include <atomic>
#include <chrono>
#include <exception>
#include <future>
#include <memory>
#include <mutex>
#include <thread>

namespace Plyo { namespace Discovery {

namespace asio = boost::asio;
using namespace std::chrono_literals;

namespace {

std::atomic<bool> s_running{false};

// Adresse de l'ordinateur sur le réseau de la maison. « Connecter » un socket UDP ne fait que choisir la route :
// aucun paquet ne part vers l'adresse publique utilisée comme repère.
std::string local_ipv4()
{
    asio::io_context      io;
    asio::ip::udp::socket socket(io);
    boost::system::error_code ec;
    socket.connect(asio::ip::udp::endpoint(asio::ip::make_address_v4("8.8.8.8"), 53), ec);
    if (ec)
        return std::string();
    const auto local = socket.local_endpoint(ec);
    return ec ? std::string() : local.address().to_string();
}

// Klipper/Moonraker : on cherche le port 7125 ouvert sur le /24 privé, puis on lit /printer/info.
std::vector<Printer> sweep_moonraker()
{
    std::vector<Printer>     found;
    const std::vector<std::string> ips = neighbours(local_ipv4());
    std::vector<std::string> open;
    const size_t             BATCH = 48; // reste sous la limite de fichiers ouverts de macOS (256 par défaut)
    for (size_t start = 0; start < ips.size(); start += BATCH) {
        asio::io_context io;
        std::vector<std::unique_ptr<asio::ip::tcp::socket>> sockets;
        asio::steady_timer deadline(io, 700ms);
        for (size_t i = start; i < (std::min)(ips.size(), start + BATCH); ++i) { // (std::min) : évite la macro min de Windows
            boost::system::error_code ec;
            const auto address = asio::ip::make_address_v4(ips[i], ec);
            if (ec)
                continue;
            sockets.push_back(std::make_unique<asio::ip::tcp::socket>(io));
            const std::string ip = ips[i];
            sockets.back()->async_connect(asio::ip::tcp::endpoint(address, 7125), [&open, ip](const boost::system::error_code& err) {
                if (!err)
                    open.push_back(ip);
            });
        }
        deadline.async_wait([&sockets](const boost::system::error_code&) {
            for (auto& s : sockets) {
                boost::system::error_code ignored;
                s->close(ignored);
            }
        });
        io.run();
    }
    for (const std::string& ip : open) {
        Slic3r::Http::get("http://" + ip + ":7125/printer/info")
            .timeout_connect(2)
            .timeout_max(3)
            .on_complete([&found, ip](std::string body, unsigned) {
                if (auto p = from_moonraker(ip, body))
                    found.push_back(*p);
            })
            .on_error([](std::string, std::string, unsigned) {})
            .perform_sync();
    }
    return found;
}

// Elegoo (Centauri Carbon, Saturn…) : message « M99999 » diffusé sur le port UDP 3000, chaque imprimante répond.
std::vector<Printer> ask_elegoo()
{
    std::vector<Printer>  found;
    asio::io_context      io;
    asio::ip::udp::socket socket(io);
    boost::system::error_code ec;
    socket.open(asio::ip::udp::v4(), ec);
    if (ec)
        return found;
    socket.set_option(asio::socket_base::broadcast(true), ec);
    socket.non_blocking(true, ec);
    const std::string probe = "M99999";
    socket.send_to(asio::buffer(probe), asio::ip::udp::endpoint(asio::ip::address_v4::broadcast(), 3000), 0, ec);
    if (ec)
        return found;
    const auto until = std::chrono::steady_clock::now() + 2500ms;
    char       buffer[4096];
    while (std::chrono::steady_clock::now() < until) {
        asio::ip::udp::endpoint from;
        const size_t            n = socket.receive_from(asio::buffer(buffer), from, 0, ec);
        if (ec == asio::error::would_block) {
            std::this_thread::sleep_for(50ms);
            continue;
        }
        if (ec)
            break;
        if (auto p = from_elegoo_sdcp(std::string(buffer, n)))
            found.push_back(*p);
    }
    return found;
}

// Creality K2 et suivantes : recherche d'Orca (annonce mDNS propre à Creality).
std::vector<Printer> ask_creality()
{
    std::vector<Printer> found;
    for (const Slic3r::CrealityHost& h : Slic3r::CrealityHostDiscovery::scan(true)) {
        Printer p;
        p.ip        = h.ip;
        p.name      = !h.model_name.empty() ? "Creality " + h.model_name : h.hostname;
        p.brand     = "Creality";
        p.host_type = "crealityprint";
        p.host      = h.ip;
        p.priority  = 3;
        found.push_back(p);
    }
    return found;
}

std::vector<Printer> ask_flashforge()
{
    std::vector<Printer>                            found;
    std::vector<Slic3r::FlashforgeDiscoveredPrinter> printers;
    wxString                                        message;
    if (!Slic3r::Flashforge::discover_printers(printers, message, 4000, 1500, 1))
        return found;
    for (const auto& f : printers) {
        Printer p;
        p.ip        = f.ip_address;
        p.name      = f.name.empty() ? "Imprimante Flashforge" : f.name;
        p.brand     = "Flashforge";
        p.host_type = "flashforge";
        p.host      = f.ip_address;
        p.priority  = 3;
        found.push_back(p);
    }
    return found;
}

// Services annoncés en mDNS (Bonjour) : OctoPrint, et Moonraker quand son annonce est activée.
std::vector<Printer> ask_bonjour(const std::string& service, const std::string& host_type, const std::string& fallback_name, int priority)
{
    struct Shared
    {
        std::mutex           mutex;
        std::vector<Printer> found;
        std::promise<void>   finished;
    };
    auto shared = std::make_shared<Shared>();
    [[maybe_unused]] auto lookup = Slic3r::Bonjour(service) // gardé en vie jusqu'à la fin de l'attente
                      .set_retries(2)
                      .set_timeout(3)
                      .on_reply([shared, host_type, fallback_name, priority](Slic3r::BonjourReply&& reply) {
                          if (!reply.ip.is_v4())
                              return;
                          Printer p;
                          p.ip        = reply.ip.to_string();
                          p.name      = reply.hostname.empty() ? fallback_name : reply.hostname;
                          p.brand     = brand_from_name(p.name);
                          p.host_type = host_type;
                          p.host      = reply.port == 80 ? p.ip : p.ip + ":" + std::to_string(reply.port);
                          p.priority  = priority;
                          std::lock_guard<std::mutex> lock(shared->mutex);
                          shared->found.push_back(p);
                      })
                      .on_complete([shared] {
                          try { shared->finished.set_value(); } catch (const std::future_error&) { /* déjà signalé */ }
                      })
                      .lookup();
    shared->finished.get_future().wait_for(8s);
    std::lock_guard<std::mutex> lock(shared->mutex);
    return shared->found;
}

// Une source qui échoue n'empêche pas les autres de répondre.
template<class F> std::vector<Printer> safely(const char* what, F&& f)
{
    try {
        return f();
    } catch (const std::exception& e) {
        BOOST_LOG_TRIVIAL(warning) << "Plyo: recherche " << what << " en échec : " << e.what();
    } catch (...) {
        BOOST_LOG_TRIVIAL(warning) << "Plyo: recherche " << what << " en échec";
    }
    return {};
}

} // namespace

bool start(std::function<void(std::vector<Printer>)> done)
{
    if (s_running.exchange(true))
        return false;
    std::thread([done = std::move(done)]() {
        auto launch = [](const char* what, auto f) { return std::async(std::launch::async, [what, f] { return safely(what, f); }); };
        std::vector<std::future<std::vector<Printer>>> jobs;
        jobs.push_back(launch("Klipper", sweep_moonraker));
        jobs.push_back(launch("Elegoo", ask_elegoo));
        jobs.push_back(launch("Creality", ask_creality));
        jobs.push_back(launch("Flashforge", ask_flashforge));
        jobs.push_back(launch("OctoPrint", [] { return ask_bonjour("octoprint", "octoprint", "OctoPrint", 2); }));
        jobs.push_back(launch("Moonraker mDNS", [] { return ask_bonjour("moonraker", "moonraker", "Imprimante Klipper", 1); }));
        std::vector<Printer> all;
        for (auto& job : jobs)
            for (Printer& p : job.get())
                all.push_back(std::move(p));
        std::vector<Printer> printers = merge(std::move(all));
        BOOST_LOG_TRIVIAL(info) << "Plyo: recherche d'imprimantes terminée, " << printers.size() << " trouvée(s)";
        Slic3r::GUI::wxGetApp().CallAfter([done, printers]() mutable {
            s_running = false;
            done(std::move(printers));
        });
    }).detach();
    return true;
}

}} // namespace Plyo::Discovery
