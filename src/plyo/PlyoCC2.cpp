// Sous Windows, boost (asio) doit être inclus avant les en-têtes de wxWidgets (même règle que PlyoDiscovery.cpp).
#include "PlyoCC2.hpp"
#include "PlyoCC2Logic.hpp"

#include <boost/asio/io_context.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/log/trivial.hpp>

#include <chrono>
#include <random>
#include <thread>

namespace Plyo { namespace CC2 {

namespace asio = boost::asio;
using namespace std::chrono_literals;

namespace {

constexpr int MQTT_PORT = 1883;

// Lecture avec délai : accumule les octets reçus et rend le premier paquet complet. Faux si le délai est dépassé.
class Connection
{
public:
    explicit Connection(asio::io_context& io) : m_socket(io) {}

    bool connect(const std::string& host, std::string& error)
    {
        boost::system::error_code ec;
        asio::ip::tcp::resolver   resolver(m_socket.get_executor());
        const auto                endpoints = resolver.resolve(host, std::to_string(MQTT_PORT), ec);
        if (ec) {
            error = "Je ne trouve pas l'imprimante sur le réseau.";
            return false;
        }
        asio::connect(m_socket, endpoints, ec);
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
            if (ec)
                return false; // connexion fermée
            m_buffer.append(chunk, n);
        }
    }

private:
    asio::ip::tcp::socket m_socket;
    std::string           m_buffer;
};

// Attend une publication ; `accept` rend vrai quand c'est celle qu'on attend. Ignore les autres paquets.
template<class Accept> bool wait_publish(Connection& c, std::chrono::milliseconds timeout, Accept accept)
{
    const auto until = std::chrono::steady_clock::now() + timeout;
    while (std::chrono::steady_clock::now() < until) {
        CC2Logic::Packet packet;
        if (!c.next_packet(packet, 1000ms))
            continue;
        std::string topic, payload;
        if (CC2Logic::publish_fields(packet, topic, payload) && accept(topic, payload))
            return true;
    }
    return false;
}

} // namespace

bool start_print(const std::string& host, const std::string& access_code, const std::string& serial, const std::string& filename,
                 std::string& error)
{
    if (serial.empty()) {
        error = "Je ne connais pas le numéro de série de l'imprimante : teste d'abord la connexion.";
        return false;
    }
    try {
        asio::io_context io;
        Connection       c(io);
        if (!c.connect(host, error))
            return false;

        std::random_device rd;
        const std::string  client = "1_PC_" + std::to_string(1000 + rd() % 9000);
        c.send(CC2Logic::connect_packet(client, "elegoo", access_code));
        CC2Logic::Packet ack;
        if (!c.next_packet(ack, 10s) || ack.type != 2 || ack.body.size() < 2) {
            error = "L'imprimante n'a pas répondu à la connexion.";
            return false;
        }
        if (static_cast<unsigned char>(ack.body[1]) != 0) {
            error = "Code d'accès refusé par l'imprimante.";
            return false;
        }

        c.send(CC2Logic::subscribe_packet(1, {CC2Logic::topic_api_response(serial, client), CC2Logic::topic_register_response(serial, client)}));
        c.send(CC2Logic::publish_packet(CC2Logic::topic_api_register(serial), CC2Logic::register_payload(client)));
        bool registered = false;
        wait_publish(c, 10s, [&](const std::string& topic, const std::string& payload) {
            if (topic != CC2Logic::topic_register_response(serial, client))
                return false;
            registered = CC2Logic::is_register_ok(payload);
            return true;
        });
        if (!registered) {
            error = "L'imprimante n'a pas accepté la connexion (trop de clients connectés ?). Ferme les autres applications reliées à elle, puis réessaie.";
            return false;
        }

        const int id = 1 + static_cast<int>(rd() % 100000);
        c.send(CC2Logic::publish_packet(CC2Logic::topic_api_request(serial, client), CC2Logic::start_print_payload(id, filename)));
        int  code     = -1;
        bool answered = wait_publish(c, 90s, [&](const std::string& topic, const std::string& payload) {
            if (topic != CC2Logic::topic_api_response(serial, client))
                return false;
            const CC2Logic::StartReply reply = CC2Logic::parse_start_reply(payload, id);
            if (!reply.matched)
                return false;
            code = reply.error_code;
            return true;
        });
        c.send(std::string("\xE0\x00", 2)); // DISCONNECT
        if (!answered) {
            error = "L'imprimante n'a pas confirmé le démarrage.";
            return false;
        }
        if (code != 0) {
            error = CC2Logic::error_text(code);
            return false;
        }
        BOOST_LOG_TRIVIAL(info) << "Plyo: impression démarrée sur le CC2 (" << filename << ")";
        return true;
    } catch (const std::exception& e) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: démarrage CC2 en échec : " << e.what();
        error = "Le démarrage de l'impression a échoué.";
        return false;
    }
}

}} // namespace Plyo::CC2
