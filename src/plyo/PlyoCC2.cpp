// Sous Windows, boost (asio) doit être inclus avant les en-têtes de wxWidgets (même règle que PlyoDiscovery.cpp).
#include "PlyoCC2.hpp"
#include "PlyoCC2Logic.hpp"
#include "PlyoJson.hpp"

#include <boost/asio/connect.hpp>
#include <boost/asio/io_context.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/ip/udp.hpp>
#include <boost/log/trivial.hpp>

#include <chrono>
#include <functional>
#include <mutex>
#include <random>
#include <thread>

namespace Plyo { namespace CC2 {

namespace asio = boost::asio;
using namespace std::chrono_literals;

namespace {

constexpr int MQTT_PORT = 1883;
constexpr auto CONNECT_TIMEOUT = 5s;

// Lecture avec délai : accumule les octets reçus et rend le premier paquet complet. Faux si le délai est dépassé ou si la
// connexion s'est fermée (closed() dit lequel des deux : inutile d'attendre encore une connexion fermée).
class Connection
{
public:
    explicit Connection(asio::io_context& io) : m_io(io), m_socket(io) {}

    bool closed() const { return m_closed; }

    bool connect(const std::string& host, std::string& error)
    {
        boost::system::error_code ec;
        asio::ip::tcp::resolver   resolver(m_socket.get_executor());
        const auto                endpoints = resolver.resolve(host, std::to_string(MQTT_PORT), ec);
        if (ec) {
            error = "Je ne trouve pas l'imprimante sur le réseau.";
            return false;
        }
        // Connexion avec délai : asio::connect attendrait le délai du système (de l'ordre de la minute) si l'imprimante ne répond pas.
        ec = asio::error::would_block;
        asio::async_connect(m_socket, endpoints, [&ec](const boost::system::error_code& result, const asio::ip::tcp::endpoint&) { ec = result; });
        m_io.restart();
        m_io.run_for(CONNECT_TIMEOUT);
        if (!m_io.stopped()) { // délai dépassé : on ferme, puis on laisse le rappel se terminer (il écrit dans `ec`, une variable locale)
            boost::system::error_code ignored;
            m_socket.close(ignored);
            m_io.run();
        }
        if (ec) {
            error = "Je n'arrive pas à joindre le canal de commande de l'imprimante (port 1883). Vérifie que le mode réseau local est activé.";
            return false;
        }
        m_socket.non_blocking(true, ec);
        return true;
    }

    void send(const std::string& bytes)
    {
        boost::system::error_code ec;
        asio::write(m_socket, asio::buffer(bytes), ec);
    }

    bool next_packet(CC2Logic::Packet& out, std::chrono::milliseconds timeout)
    {
        const auto until = std::chrono::steady_clock::now() + timeout;
        while (true) {
            size_t consumed = 0;
            if (CC2Logic::parse_packet(m_buffer, consumed, out)) {
                m_buffer.erase(0, consumed);
                return true;
            }
            if (std::chrono::steady_clock::now() >= until)
                return false;
            char                      chunk[4096];
            boost::system::error_code ec;
            const size_t              n = m_socket.read_some(asio::buffer(chunk), ec);
            if (ec == asio::error::would_block || ec == asio::error::try_again) {
                std::this_thread::sleep_for(50ms);
                continue;
            }
            if (ec) {
                m_closed = true;
                return false;
            }
            m_buffer.append(chunk, n);
        }
    }

private:
    asio::io_context&     m_io;
    asio::ip::tcp::socket m_socket;
    std::string           m_buffer;
    bool                  m_closed = false;
};

// Attend une publication ; `accept` rend vrai quand c'est celle qu'on attend. Ignore les autres paquets.
template<class Accept> bool wait_publish(Connection& c, std::chrono::milliseconds timeout, Accept accept)
{
    const auto until = std::chrono::steady_clock::now() + timeout;
    while (std::chrono::steady_clock::now() < until) {
        CC2Logic::Packet packet;
        if (!c.next_packet(packet, 1000ms)) {
            if (c.closed())
                return false; // sinon cette boucle tournerait à vide jusqu'au délai, à 100 % d'un cœur
            continue;
        }
        std::string topic, payload;
        if (CC2Logic::publish_fields(packet, topic, payload) && accept(topic, payload))
            return true;
    }
    return false;
}

// Session MQTT ouverte et enregistrée auprès de l'imprimante (connexion, abonnement à ses réponses, api_register).
class Session
{
public:
    Session() : m_conn(m_io) {}
    ~Session()
    {
        if (m_open)
            m_conn.send(std::string("\xE0\x00", 2)); // DISCONNECT
    }

    bool open(const std::string& host, const std::string& access_code, const std::string& serial, std::string& error)
    {
        if (serial.empty()) {
            error = "Je ne connais pas le numéro de série de l'imprimante : teste d'abord la connexion.";
            return false;
        }
        if (!m_conn.connect(host, error))
            return false;
        std::random_device rd;
        m_serial = serial;
        m_client = "1_PC_" + std::to_string(1000 + rd() % 9000);
        m_conn.send(CC2Logic::connect_packet(m_client, "elegoo", access_code));
        CC2Logic::Packet ack;
        if (!m_conn.next_packet(ack, 10s) || ack.type != 2 || ack.body.size() < 2) {
            error = "L'imprimante n'a pas répondu à la connexion.";
            return false;
        }
        if (static_cast<unsigned char>(ack.body[1]) != 0) {
            error = "Code d'accès refusé par l'imprimante.";
            return false;
        }
        m_open = true;
        m_conn.send(CC2Logic::subscribe_packet(1, {CC2Logic::topic_api_response(serial, m_client), CC2Logic::topic_register_response(serial, m_client)}));
        m_conn.send(CC2Logic::publish_packet(CC2Logic::topic_api_register(serial), CC2Logic::register_payload(m_client)));
        bool registered = false;
        wait_publish(m_conn, 10s, [&](const std::string& topic, const std::string& payload) {
            if (topic != CC2Logic::topic_register_response(serial, m_client))
                return false;
            registered = CC2Logic::is_register_ok(payload);
            return true;
        });
        if (!registered) {
            error = "L'imprimante n'a pas accepté la connexion (trop de clients connectés ?). Ferme les autres applications reliées à elle, puis réessaie.";
            return false;
        }
        return true;
    }

    bool closed() const { return m_conn.closed(); }

    int next_id() { std::random_device rd; return 1 + static_cast<int>(rd() % 100000); }

    // Publie une demande et attend la réponse que `accept(payload)` reconnaît. Faux si le délai est dépassé.
    template<class Accept> bool request(const std::string& payload, std::chrono::milliseconds timeout, Accept accept)
    {
        m_conn.send(CC2Logic::publish_packet(CC2Logic::topic_api_request(m_serial, m_client), payload));
        return wait_publish(m_conn, timeout, [&](const std::string& topic, const std::string& body) {
            return topic == CC2Logic::topic_api_response(m_serial, m_client) && accept(body);
        });
    }

    // Lit les emplacements du Canvas ; null si l'imprimante ne répond pas.
    nlohmann::json read_canvas()
    {
        const int      id  = next_id();
        nlohmann::json out = nullptr;
        request(CC2Logic::canvas_read_payload(id), 10s, [&](const std::string& body) {
            out = CC2Logic::parse_canvas_reply(body, id);
            return !out.is_null();
        });
        return out;
    }

private:
    asio::io_context m_io;
    Connection       m_conn;
    std::string      m_serial, m_client;
    bool             m_open = false;
};

std::mutex     g_mutex;
nlohmann::json g_plan = nullptr;     // {host, map:[{t, canvas_id, tray_id, type, preset}]} : carte choisie dans Plyo
nlohmann::json g_refused = nullptr;  // {host, serial, filename} : départ refusé avec une carte, relançable sans carte
std::function<void(const std::string&)> g_on_refused;
OrcaState g_orca_state; // couleurs découpées et profils de filament, lus dans Orca au moment du départ

bool send_start(Session& s, const std::string& filename, const nlohmann::json& map, int& code)
{
    const int id = s.next_id();
    return s.request(CC2Logic::start_print_payload(id, filename, map), 90s, [&](const std::string& body) {
        const CC2Logic::StartReply reply = CC2Logic::parse_start_reply(body, id);
        if (reply.matched)
            code = reply.error_code;
        return reply.matched;
    });
}

// Le départ n'a pas été confirmé : la liaison coupée après l'ordre ne veut pas dire que l'impression n'a pas démarré.
std::string unconfirmed_text(const Session& s)
{
    return s.closed() ? "La liaison avec l'imprimante s'est coupée avant sa confirmation : regarde sur son écran si l'impression a démarré."
                      : "L'imprimante n'a pas confirmé le démarrage.";
}

} // namespace

void set_plan(const nlohmann::json& plan)
{
    std::lock_guard<std::mutex> lock(g_mutex);
    g_plan = plan;
}

void clear_plan()
{
    std::lock_guard<std::mutex> lock(g_mutex);
    g_plan = nullptr;
}

void on_orca_state(OrcaState provider)
{
    std::lock_guard<std::mutex> lock(g_mutex);
    g_orca_state = std::move(provider);
}

void on_refused(std::function<void(const std::string&)> callback)
{
    std::lock_guard<std::mutex> lock(g_mutex);
    g_on_refused = std::move(callback);
}

bool start_print(const std::string& host, const std::string& access_code, const std::string& serial, const std::string& filename,
                 std::string& error)
{
    nlohmann::json plan;
    OrcaState      orca_state;
    {
        std::lock_guard<std::mutex> lock(g_mutex);
        plan       = g_plan;
        orca_state = g_orca_state;
        g_refused  = nullptr; // un nouveau départ remplace le précédent refus
    }
    // Les couleurs de la plaque et les profils sont lus maintenant (pas au moment du choix) : la pièce a pu changer.
    std::vector<int>         sliced_t;
    std::vector<std::string> presets;
    const bool               known   = orca_state && orca_state(sliced_t, presets);
    const bool               planned_here = plan.is_object() && Json::str(plan, "host") == host && !Json::arr(plan, "map").empty();
    const nlohmann::json     planned = known ? CC2Logic::map_for_send(plan, host, sliced_t) : nlohmann::json::array();
    auto refused = [&](const std::string& text) {
        error = text;
        std::function<void(const std::string&)> notify;
        {
            std::lock_guard<std::mutex> lock(g_mutex);
            g_refused = {{"host", host}, {"serial", serial}, {"filename", filename}};
            notify    = g_on_refused;
        }
        if (notify)
            notify(text);
        return false;
    };
    try {
        Session s;
        if (!s.open(host, access_code, serial, error))
            return false;
        if (planned_here && !known)
            return refused("Je n'ai pas pu vérifier la pièce dans Orca : l'impression n'a pas démarré. Le fichier est sur l'imprimante : dans Plyo, à l'étape Imprimer, « Démarrer sans carte ».");
        nlohmann::json map = nlohmann::json::array();
        if (!planned.empty()) {
            // Relecture juste avant le départ : on n'envoie jamais une carte qui ne correspond plus à l'imprimante.
            const nlohmann::json        canvas   = s.read_canvas();
            const CC2Logic::MapDecision decision = CC2Logic::decide_map(planned, canvas.is_null() ? nlohmann::json() : Json::arr(canvas, "canvases"), presets);
            if (!decision.refusal.empty())
                return refused(decision.refusal);
            map = decision.map;
        }
        int code = -1;
        if (!send_start(s, filename, map, code)) {
            error = unconfirmed_text(s);
            return false;
        }
        if (code != 0) {
            if (!map.empty())
                return refused("La CC2 a refusé les emplacements choisis (code " + std::to_string(code) + "). Le fichier est sur l'imprimante : dans Plyo, à l'étape Imprimer, « Démarrer sans carte ».");
            error = CC2Logic::error_text(code);
            return false;
        }
        BOOST_LOG_TRIVIAL(info) << "Plyo: impression démarrée sur le CC2 (" << filename << ", " << map.size() << " emplacement(s) choisi(s))";
        return true;
    } catch (const std::exception& e) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: démarrage CC2 en échec : " << e.what();
        error = "Le démarrage de l'impression a échoué.";
        return false;
    }
}

nlohmann::json last_refused()
{
    std::lock_guard<std::mutex> lock(g_mutex);
    return g_refused;
}

void clear_refused()
{
    std::lock_guard<std::mutex> lock(g_mutex);
    g_refused = nullptr;
}

bool start_again_plain(const std::string& profile_host, const std::string& access_code, std::string& error)
{
    nlohmann::json r = last_refused();
    if (const std::string refusal = CC2Logic::plain_start_refusal(r, profile_host); !refusal.empty()) {
        error = refusal;
        return false;
    }
    try {
        Session s;
        if (!s.open(Json::str(r, "host"), access_code, Json::str(r, "serial"), error))
            return false;
        int code = -1;
        if (!send_start(s, Json::str(r, "filename"), nlohmann::json::array(), code)) {
            error = unconfirmed_text(s);
            return false;
        }
        if (code != 0) {
            error = CC2Logic::error_text(code);
            return false;
        }
        std::lock_guard<std::mutex> lock(g_mutex);
        g_refused = nullptr;
        return true;
    } catch (const std::exception& e) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: démarrage CC2 sans carte en échec : " << e.what();
        error = "Le démarrage de l'impression a échoué.";
        return false;
    }
}

nlohmann::json read_canvas(const std::string& host, const std::string& access_code, const std::string& serial, std::string& error)
{
    try {
        Session s;
        if (!s.open(host, access_code, serial, error))
            return nullptr;
        nlohmann::json canvas = s.read_canvas();
        if (canvas.is_null())
            error = "L'imprimante n'a pas donné ses emplacements.";
        return canvas;
    } catch (const std::exception& e) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: lecture du Canvas en échec : " << e.what();
        error = "La lecture des emplacements a échoué.";
        return nullptr;
    }
}

std::string serial_of(const std::string& host)
{
    try {
        asio::io_context        io;
        asio::ip::udp::socket   socket(io);
        boost::system::error_code ec;
        socket.open(asio::ip::udp::v4(), ec);
        if (ec)
            return std::string();
        asio::ip::udp::resolver resolver(io);
        const auto              targets = resolver.resolve(asio::ip::udp::v4(), host, "52700", ec);
        if (ec || targets.empty())
            return std::string();
        const std::string probe = R"({"id":0,"method":7000,"params":{}})";
        socket.send_to(asio::buffer(probe), *targets.begin(), 0, ec);
        socket.non_blocking(true, ec);
        const auto until = std::chrono::steady_clock::now() + 3s;
        char       buf[65536];
        while (std::chrono::steady_clock::now() < until) {
            asio::ip::udp::endpoint from;
            const size_t            n = socket.receive_from(asio::buffer(buf), from, 0, ec);
            if (ec == asio::error::would_block || ec == asio::error::try_again) {
                std::this_thread::sleep_for(50ms);
                continue;
            }
            if (ec)
                return std::string();
            return CC2Logic::serial_from_discovery(std::string(buf, n));
        }
    } catch (const std::exception&) {}
    return std::string();
}

}} // namespace Plyo::CC2
