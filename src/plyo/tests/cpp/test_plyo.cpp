// Tests de la logique pure de Plyo (sans wxWidgets ni Orca) : lecture typée des messages, fichiers JSON,
// nettoyage des données enregistrées. Lancés par src/plyo/tests/cpp/run.sh.
#include <catch_amalgamated.hpp>

#include "../../PlyoFiles.hpp"
#include "../../PlyoJson.hpp"
#include "../../PlyoSanitize.hpp"
#include "../../PlyoDiscoveryLogic.hpp"
#include "../../PlyoProjectLogic.hpp"
#include "../../PlyoCC2Logic.hpp"
#include "../../PlyoSlotsLogic.hpp"
#include "../../PlyoCfsLogic.hpp"
#include "../../PlyoIfsLogic.hpp"
#include "../../PlyoU1Logic.hpp"
#include "../../PlyoCanvasLogic.hpp"
#include "../../PlyoLimitsLogic.hpp"
#include "../../PlyoCatalogPolicy.hpp"
#include "../../PlyoProfilesLogic.hpp"
#include "../../PlyoCalibrationLogic.hpp"
#include "../../PlyoCommandsLogic.hpp"
#include "../../PlyoSpoolsLogic.hpp"
#include "../../PlyoProjectFilesLogic.hpp"
#include "../../PlyoOrcaMessagesLogic.hpp"
#include "../../PlyoConfigRulesLogic.hpp"
#include "../../PlyoMemoryLogic.hpp"
#include "../../PlyoContextLogic.hpp"
#include "../../PlyoConversations.hpp"
#include "../../PlyoLifetimeLogic.hpp"
#include "../../PlyoPageLogic.hpp"

#include <boost/filesystem.hpp>
#include <boost/nowide/fstream.hpp>

#include <atomic>
#include <functional>
#include <iterator>
#include <random>
#include <stdexcept>
#include <string>
#include <thread>

#ifndef _WIN32
#include <sys/wait.h>
#include <unistd.h>
#endif

namespace fs = boost::filesystem;
#include <tuple>
using nlohmann::json;

namespace {

fs::path fresh_dir()
{
    fs::path dir = fs::temp_directory_path() / fs::unique_path("plyo-test-%%%%-%%%%");
    fs::create_directories(dir);
    return dir;
}

void write_raw(const fs::path& path, const std::string& text)
{
    boost::nowide::ofstream out(path.string(), std::ios::binary);
    out << text;
}

} // namespace

// --- Lecture typée : jamais d'exception, quelle que soit la forme reçue du panneau ---

TEST_CASE("Json::str ne lève jamais et coupe sans casser un caractère UTF-8")
{
    CHECK(Plyo::Json::str(json{{"type", 1}}, "type").empty());
    CHECK(Plyo::Json::str(json::array(), "type").empty());
    CHECK(Plyo::Json::str(json(nullptr), "type").empty());
    CHECK(Plyo::Json::str(json{{"type", "ready"}}, "type") == "ready");
    // « é » fait 2 octets : couper à 2 octets garde « a » seul plutôt qu'un demi-caractère.
    CHECK(Plyo::Json::str(json{{"t", "aé"}}, "t", 2) == "a");
    CHECK(Plyo::Json::utf8_prefix("Pièce", 3) == "Pi");
}

TEST_CASE("Json::num, integer et boolean retombent sur la valeur par défaut")
{
    const json j = {{"n", "12"}, {"b", 1}, {"i", 7.9}, {"ok", 3.5}};
    CHECK(Plyo::Json::num(j, "n", -1) == -1);
    CHECK(Plyo::Json::num(j, "ok") == 3.5);
    CHECK(Plyo::Json::boolean(j, "b", false) == false);
    CHECK(Plyo::Json::integer(j, "i", 0) == 7);
    CHECK(Plyo::Json::integer(json{{"i", 1e300}}, "i", 4) == 4);
    CHECK(Plyo::Json::num(json(42), "n", 5) == 5);
}

TEST_CASE("Json::obj et arr rendent un conteneur vide sur une forme inattendue")
{
    CHECK(Plyo::Json::obj(json{{"ask", "x"}}, "ask").is_object());
    CHECK(Plyo::Json::arr(json{{"commands", {{"op", "rotate"}}}}, "commands").is_array());
    CHECK(Plyo::Json::arr(json{{"commands", json::array({1, 2})}}, "commands").size() == 2);
}

TEST_CASE("Json : des messages aléatoires ne lèvent jamais d'exception")
{
    std::mt19937 rng(42);
    const auto   random_value = [&](int depth, auto&& self) -> json {
        switch (rng() % (depth > 2 ? 5 : 7)) {
        case 0: return nullptr;
        case 1: return bool(rng() % 2);
        case 2: return int(rng() % 1000) - 500;
        case 3: return double(rng() % 1000) / 7.0;
        case 4: return std::string(rng() % 5, char('a' + rng() % 26));
        case 5: {
            json a = json::array();
            for (unsigned i = 0; i < rng() % 4; ++i) a.push_back(self(depth + 1, self));
            return a;
        }
        default: {
            json o = json::object();
            for (const char* k : {"type", "id", "value", "commands", "ask", "conv", "request", "changes", "seen"})
                if (rng() % 2) o[k] = self(depth + 1, self);
            return o;
        }
        }
    };
    for (int i = 0; i < 5000; ++i) {
        const json m = random_value(0, random_value);
        CHECK_NOTHROW(Plyo::Json::str(m, "type", 40));
        CHECK_NOTHROW(Plyo::Json::integer(m, "request"));
        CHECK_NOTHROW(Plyo::Json::arr(m, "commands"));
        CHECK_NOTHROW(Plyo::Json::obj(m, "ask"));
        CHECK_NOTHROW(Plyo::Sanitize::first_steps(m));
        CHECK_NOTHROW(Plyo::Sanitize::memory(m));
        CHECK_NOTHROW(Plyo::Sanitize::journal(m));
        CHECK_NOTHROW(Plyo::Sanitize::calibrations(m));
    }
}

// --- Fichiers : une lecture ratée ne doit jamais faire écraser les données ---

TEST_CASE("Files::read_json distingue absent, lisible et abîmé, et met l'abîmé de côté")
{
    const fs::path dir  = fresh_dir();
    const fs::path file = dir / "journal.json";

    CHECK(Plyo::Files::read_json(file, 1024).status == Plyo::Files::Status::Missing);

    write_raw(file, "[1,2,3]");
    const auto ok = Plyo::Files::read_json(file, 1024);
    CHECK(ok.status == Plyo::Files::Status::Ok);
    CHECK(ok.value.size() == 3);

    write_raw(file, "[1,2,");
    const auto broken = Plyo::Files::read_json(file, 1024);
    CHECK(broken.status == Plyo::Files::Status::Damaged);
    CHECK_FALSE(fs::exists(file));            // le prochain enregistrement repart d'un fichier neuf…
    CHECK(fs::exists(broken.kept_as));        // …mais l'ancien contenu est gardé à côté
    CHECK(broken.kept_as.parent_path() == dir);

    write_raw(file, std::string(2048, ' ') + "[]");
    CHECK(Plyo::Files::read_json(file, 1024).status == Plyo::Files::Status::Damaged); // trop gros
    fs::remove_all(dir);
}

TEST_CASE("Files::write_atomic écrit tout ou rien, dans un dossier créé au besoin")
{
    const fs::path dir  = fresh_dir();
    const fs::path file = dir / "sous" / "état é.json";
    REQUIRE(Plyo::Files::write_atomic(file, "{\"a\":1}", true));
    CHECK(Plyo::Files::read_json(file, 1024).value == json{{"a", 1}});
    CHECK_FALSE(fs::exists(file.string() + ".tmp"));
    CHECK((fs::status(file).permissions() & (fs::group_read | fs::others_read)) == 0);
    fs::remove_all(dir);
}

// --- Nettoyage des données enregistrées ---

TEST_CASE("Sanitize::first_steps garde seulement les valeurs du bon type")
{
    const json s = Plyo::Sanitize::first_steps({{"seen", "x"}, {"level", "beginner"}, {"tour_step", 3}, {"greeted", true}, {"autre", 1}});
    CHECK(s["seen"] == false);
    CHECK(s["level"] == "beginner");
    CHECK(s["tour_step"].is_null());
    CHECK(s["greeted"] == true);
    CHECK(s["share_outcomes"] == false);
    CHECK_FALSE(s.contains("autre"));
    CHECK(Plyo::Sanitize::first_steps(json::array()) == Plyo::Sanitize::first_steps(json::object()));
}

TEST_CASE("Sanitize::memory écarte les fiches abîmées (anciennes versions) et garde les bonnes")
{
    const json stored = {
        {"Bambu | PLA", json::array({json::array({"date", "2026-10-24"}), json{{"date", "2026-10-25"}, {"changes", json::array()}}})},
        {"Creality | PLA", "pas une liste"},
    };
    const json m = Plyo::Sanitize::memory(stored);
    CHECK(m["Bambu | PLA"].size() == 1);
    CHECK(m["Bambu | PLA"][0]["date"] == "2026-10-25");
    CHECK(m["Creality | PLA"].is_array());
    CHECK(m["Creality | PLA"].empty());
    CHECK(Plyo::Sanitize::memory(json::array()).is_object());
}

TEST_CASE("Sanitize::journal garde les fiches objets avec une conversation")
{
    const json j = Plyo::Sanitize::journal(json::array({json::array({"conv", "c"}), json{{"conv", "c1"}, {"parts", {"a.stl"}}}, json{{"parts", 1}}}));
    REQUIRE(j.size() == 1);
    CHECK(j[0]["conv"] == "c1");
}

TEST_CASE("Sanitize::calibrations garde les tests valides de chaque machine")
{
    const json h = Plyo::Sanitize::calibrations({{"PLA | A1", {{"temperature", {{"value", 215}, {"date", "2026-10-24"}}}, {"flow", "x"}}}, {"autre", 3}});
    CHECK(h["PLA | A1"]["temperature"]["value"] == 215);
    CHECK_FALSE(h["PLA | A1"].contains("flow"));
    CHECK_FALSE(h.contains("autre"));
}

// --- Recherche d'imprimantes : adresses parcourues et lecture des réponses ---

TEST_CASE("Discovery ne parcourt que le /24 privé de l'ordinateur")
{
    using namespace Plyo::Discovery;
    CHECK(is_private_ipv4("192.168.1.20"));
    CHECK(is_private_ipv4("10.0.0.5"));
    CHECK(is_private_ipv4("172.20.3.4"));
    CHECK_FALSE(is_private_ipv4("172.32.0.1"));
    CHECK_FALSE(is_private_ipv4("8.8.8.8"));
    CHECK_FALSE(is_private_ipv4("192.168.1"));
    CHECK_FALSE(is_private_ipv4("192.168.1.300"));
    const auto n = neighbours("192.168.1.20");
    CHECK(n.size() == 253);
    CHECK(n.front() == "192.168.1.1");
    CHECK(n.back() == "192.168.1.254");
    CHECK(std::find(n.begin(), n.end(), "192.168.1.20") == n.end());
    CHECK(neighbours("8.8.8.8").empty());
}

TEST_CASE("Discovery reconnaît Moonraker et refuse les autres réponses")
{
    using namespace Plyo::Discovery;
    const auto k1 = from_moonraker("192.168.1.42", R"({"result":{"state":"ready","hostname":"K1C-1A2B","software_version":"v0.12"}})");
    REQUIRE(k1);
    CHECK(k1->name == "K1C-1A2B");
    CHECK(k1->brand == "Creality");
    CHECK(k1->host_type == "moonraker");
    CHECK(k1->host == "192.168.1.42:7125");
    const auto anon = from_moonraker("192.168.1.43", R"({"result":{"state":"ready"}})");
    REQUIRE(anon);
    CHECK(anon->name == "Imprimante Klipper");
    CHECK(anon->brand.empty());
    CHECK_FALSE(from_moonraker("192.168.1.44", "<html>box</html>"));
    CHECK_FALSE(from_moonraker("192.168.1.44", R"({"result":{"foo":1}})"));
}

TEST_CASE("Discovery lit la réponse UDP 52700 d'une Centauri Carbon 2")
{
    using namespace Plyo::Discovery;
    const auto cc2 = from_elegoo_cc2("192.168.1.29", R"({"id":0,"result":{"host_name":"Centauri Carbon 2","lan_status":1,"machine_model":"Centauri Carbon 2","protocol_version":"1.0.0","sn":"X","token_status":1}})");
    REQUIRE(cc2);
    CHECK(cc2->ip == "192.168.1.29");
    CHECK(cc2->name == "Centauri Carbon 2");
    CHECK(cc2->brand == "Elegoo");
    CHECK(cc2->host_type == "elegoolink");
    CHECK_FALSE(from_elegoo_cc2("192.168.1.29", R"({"id":0,"result":["error_code",1001,"error_message","Hello from UDP Server!"]})"));
    CHECK_FALSE(from_elegoo_cc2("pas une ip", R"({"result":{"host_name":"x"}})"));
    CHECK_FALSE(from_elegoo_cc2("192.168.1.29", "M99999"));
}

TEST_CASE("Discovery lit la réponse SDCP d'une Elegoo")
{
    using namespace Plyo::Discovery;
    const auto cc = from_elegoo_sdcp(R"({"Id":"x","Data":{"Name":"CC","MachineName":"Centauri Carbon","BrandName":"ELEGOO","MainboardIP":"192.168.1.50"}})");
    REQUIRE(cc);
    CHECK(cc->name == "Centauri Carbon");
    CHECK(cc->host_type == "elegoolink");
    CHECK(cc->host == "192.168.1.50");
    CHECK_FALSE(from_elegoo_sdcp(R"({"Data":{"MainboardIP":"pas une ip"}})"));
    CHECK_FALSE(from_elegoo_sdcp("M99999"));
}

TEST_CASE("Discovery garde une entrée par IP, la source la plus précise")
{
    using namespace Plyo::Discovery;
    Printer a{"192.168.1.42", "K1C-1A2B", "Creality", "moonraker", "192.168.1.42:7125", 1};
    Printer b{"192.168.1.42", "", "", "crealityprint", "192.168.1.42", 3};
    Printer c{"192.168.1.7", "Adventurer 5M", "Flashforge", "flashforge", "192.168.1.7", 3};
    const auto m = merge({a, b, c});
    REQUIRE(m.size() == 2);
    CHECK(m[0].name == "Adventurer 5M");
    CHECK(m[1].host_type == "crealityprint");
    CHECK(m[1].name == "K1C-1A2B");
    CHECK(m[1].brand == "Creality");
    CHECK(to_json(m).size() == 2);
}

TEST_CASE("Discovery : nom d'une Creality annoncée en mDNS, sans « K2 » inventé")
{
    using namespace Plyo::Discovery;
    CHECK(creality_mdns_name("F008", "K2 Plus") == "Creality K2 Plus");
    CHECK(creality_mdns_name("F003", "") == "Creality CR-10 SE"); // code lu sur la CR-10 SE de Jérôme (2026-11-10)
    CHECK(creality_mdns_name("F999", "") == "Imprimante Creality");
    CHECK(creality_mdns_name("", "") == "Imprimante Creality");
    Printer unknown{"192.168.1.30", creality_mdns_name("F999", ""), "Creality", "crealityprint", "192.168.1.30", 3};
    CHECK(model_hint(unknown).empty()); // le modèle est demandé, jamais deviné
    Printer cr10{"192.168.1.200", creality_mdns_name("F003", ""), "Creality", "crealityprint", "192.168.1.200", 3};
    CHECK(profile_matches("Creality CR-10 SE", model_hint(cr10)));
}

TEST_CASE("Discovery reconnaît le modèle et le compare au profil")
{
    using namespace Plyo::Discovery;
    Printer k2{"192.168.1.21", "K2-DD52", "Creality", "moonraker", "192.168.1.21:7125", 1};
    CHECK(model_hint(k2) == "k2");
    Printer k2plus{"192.168.1.22", "Creality K2 Plus", "Creality", "crealityprint", "192.168.1.22", 3};
    CHECK(model_hint(k2plus) == "k2 plus");
    Printer ke{"192.168.1.23", "Ender-3 V3 KE-A1B2C3", "Creality", "moonraker", "192.168.1.23:7125", 1};
    CHECK(model_hint(ke) == "ender 3 v3 ke");
    Printer anon{"192.168.1.24", "Imprimante Klipper", "", "moonraker", "192.168.1.24:7125", 1};
    CHECK(model_hint(anon).empty());
    CHECK(profile_matches("Creality K2", "k2"));
    CHECK(profile_matches("Creality Ender-3 V3 KE", "ender 3 v3 ke"));
    CHECK_FALSE(profile_matches("Creality K2 Plus", "k2"));
    CHECK_FALSE(profile_matches("Creality CR-10 SE", "k2"));
    CHECK_FALSE(profile_matches("Creality K2", ""));
}

TEST_CASE("Discovery n'accepte que des connexions locales connues")
{
    using namespace Plyo::Discovery;
    CHECK(allowed_host_type("crealityprint"));
    CHECK_FALSE(allowed_host_type("prusaconnect"));
    CHECK(valid_host("192.168.1.21"));
    CHECK(valid_host("192.168.1.21:7125"));
    CHECK_FALSE(valid_host("8.8.8.8"));
    CHECK_FALSE(valid_host("192.168.1.21:"));
    CHECK_FALSE(valid_host("192.168.1.21:99999"));
    CHECK_FALSE(valid_host("192.168.1.21:80/../x"));
    CHECK_FALSE(valid_host("exemple.com"));
}

// --- Limites du fabricant : bornes strictes sur les températures ---
TEST_CASE("Limits::check : bornes incluses, dehors refusé, autres réglages ignorés")
{
    Plyo::Limits::Range r;
    r.nozzle_min = 225;
    r.nozzle_max = 245;
    r.bed_min    = 60;
    r.bed_max    = 80;
    using V = Plyo::Limits::Verdict;
    CHECK(Plyo::Limits::check("nozzle_temp", 225, r) == V::Ok);
    CHECK(Plyo::Limits::check("nozzle_temp", 245, r) == V::Ok);
    CHECK(Plyo::Limits::check("nozzle_temp", 215, r) == V::Below);
    CHECK(Plyo::Limits::check("nozzle_temp_initial", 250, r) == V::Above);
    CHECK(Plyo::Limits::check("bed_temp", 55, r) == V::Below);
    CHECK(Plyo::Limits::check("bed_temp_initial", 85, r) == V::Above);
    CHECK(Plyo::Limits::check("layer_height", 0.2, r) == V::Ok);
    CHECK(Plyo::Limits::check("nozzle_temp", 100, Plyo::Limits::Range{}) == V::Ok);
}

TEST_CASE("Sanitize::limits garde les plages valides et jette le reste")
{
    const json stored = {{"K2 | TPU", {{"nozzle_min", 225}, {"nozzle_max", 245}, {"bed_min", "chaud"}}},
                         {"inversé", {{"nozzle_min", 245}, {"nozzle_max", 225}}},
                         {"absurde", {{"nozzle_max", 900}}},
                         {"pas un objet", 3}};
    const json out = Plyo::Sanitize::limits(stored);
    REQUIRE(out.contains("K2 | TPU"));
    CHECK(out["K2 | TPU"] == json{{"nozzle_min", 225}, {"nozzle_max", 245}});
    CHECK_FALSE(out.contains("inversé"));
    CHECK_FALSE(out.contains("absurde"));
    CHECK_FALSE(out.contains("pas un objet"));
    CHECK(Plyo::Sanitize::limits(json("n'importe quoi")) == json::object());
}

TEST_CASE("Limits::from_json et to_json font l'aller-retour")
{
    const auto r = Plyo::Limits::from_json(json{{"nozzle_min", 225}, {"bed_max", 80}});
    CHECK(r.nozzle_min.value() == 225);
    CHECK_FALSE(r.nozzle_max.has_value());
    CHECK(Plyo::Limits::to_json(r) == json{{"nozzle_min", 225}, {"bed_max", 80}});
}

// --- Politique du catalogue : ce que l'assistant peut lire et écrire ---
namespace {
Plyo::Catalog::Policy sample_policy()
{
    const json policy = {{"forbidden_patterns", {"gcode", "post_process"}}, {"forbidden_keys", {"filament_type"}},
                         {"confirm_patterns", {"temperature"}}, {"confirm_keys", {"outer_wall_speed"}}};
    const json keys   = {{"print", {{"layer_height", "float"}, {"outer_wall_speed", "float"}}},
                         {"filament", {{"fan_cooling_layer_time", "float"}, {"nozzle_temperature", "int"}, {"filament_start_gcode", "enum"}}},
                         {"titles", {{"layer_height", "Hauteur de couche"}}}};
    return Plyo::Catalog::Policy::from_json(policy, keys);
}
} // namespace

TEST_CASE("Catalog::Policy refuse G-code et identité, même présents dans les clés du catalogue")
{
    const auto p = sample_policy();
    CHECK(p.is_forbidden("machine_start_gcode"));
    CHECK(p.is_forbidden("layer_change_gcode"));
    CHECK(p.is_forbidden("filament_type"));
    CHECK_FALSE(p.is_forbidden("fan_cooling_layer_time"));
    CHECK_FALSE(p.allows("filament", "filament_start_gcode"));
}

TEST_CASE("Catalog::Policy::allows exige la bonne portée et la présence dans le catalogue")
{
    const auto p = sample_policy();
    CHECK(p.allows("filament", "fan_cooling_layer_time"));
    CHECK_FALSE(p.allows("print", "fan_cooling_layer_time"));
    CHECK_FALSE(p.allows("print", "nozzle_diameter"));
    CHECK(p.needs_confirmation("nozzle_temperature"));
    CHECK(p.needs_confirmation("outer_wall_speed"));
    CHECK_FALSE(p.needs_confirmation("layer_height"));
    CHECK(p.keys("filament").size() == 2); // sans la clé G-code
    CHECK(p.title("layer_height") == "Hauteur de couche");
    CHECK(p.title("inconnu").empty());
    CHECK_FALSE(p.allows("titles", "layer_height")); // « titles » n'est pas une portée
}

TEST_CASE("Catalog::typed_value rend le nombre, le booléen, le texte ou null")
{
    using Plyo::Catalog::typed_value;
    CHECK(typed_value("int", "230") == json(230));
    CHECK(typed_value("float", "0.95") == json(0.95));
    CHECK(typed_value("percent", "15%") == json("15%"));
    CHECK(typed_value("percent", "15") == json(15));
    CHECK(typed_value("bool", "1") == json(true));
    CHECK(typed_value("bool", "0") == json(false));
    CHECK(typed_value("enum", "top") == json("top"));
    CHECK(typed_value("float", "nil").is_null());
    CHECK(typed_value("float", "abc").is_null());
}

// --- Vérification d'un changement du catalogue, côté slicer (il fait autorité) ---
namespace {
Plyo::Catalog::OptionInfo info(const std::string& kind, std::optional<double> lo = std::nullopt, std::optional<double> hi = std::nullopt,
                               std::vector<std::string> values = {})
{
    return {kind, lo, hi, std::move(values)};
}
const Plyo::Limits::Range no_limits;
} // namespace

TEST_CASE("Catalog::check_change : type et bornes d'Orca")
{
    using Plyo::Catalog::check_change;
    CHECK(check_change("Temps de couche", info("float", 0, 1000), 20, no_limits, "", false).ok);
    CHECK_FALSE(check_change("Temps de couche", info("float", 0, 1000), 1000000, no_limits, "", false).ok);
    CHECK_FALSE(check_change("Couches", info("int", 1, 10), 4.5, no_limits, "", false).ok);
    CHECK_FALSE(check_change("Couches", info("int", 1, 10), "4", no_limits, "", false).ok);
    CHECK_FALSE(check_change("Pression", info("bool"), "oui", no_limits, "", false).ok);
    CHECK(check_change("Pression", info("bool"), true, no_limits, "", false).ok);
    CHECK(check_change("Lissage", info("enum", {}, {}, {"no ironing", "top"}), "top", no_limits, "", false).ok);
    CHECK_FALSE(check_change("Lissage", info("enum", {}, {}, {"no ironing", "top"}), "partout", no_limits, "", false).ok);
    CHECK_FALSE(check_change("Débit", info("float"), std::nan(""), no_limits, "", false).ok);
}

TEST_CASE("Catalog::check_change : limites du fabricant, avec confirmation explicite")
{
    using Plyo::Catalog::check_change;
    Plyo::Limits::Range r;
    r.nozzle_min = 225;
    r.nozzle_max = 245;
    CHECK_FALSE(check_change("Température de buse", info("int", 0), 215, r, "nozzle_temp", false).ok);
    CHECK(check_change("Température de buse", info("int", 0), 215, r, "nozzle_temp", true).ok);
    CHECK(check_change("Température de buse", info("int", 0), 225, r, "nozzle_temp", false).ok);
    CHECK(check_change("Autre", info("int", 0), 215, r, "", false).ok);
}

TEST_CASE("Catalog::to_serialized écrit la valeur comme Orca la relit")
{
    using Plyo::Catalog::to_serialized;
    CHECK(to_serialized(info("int"), 230) == "230");
    CHECK(to_serialized(info("float"), 0.95) == "0.95");
    CHECK(to_serialized(info("bool"), true) == "1");
    CHECK(to_serialized(info("bool"), false) == "0");
    CHECK(to_serialized(info("percent"), 15) == "15%");
    CHECK(to_serialized(info("percent"), "15%") == "15%");
    CHECK(to_serialized(info("float_or_percent"), 0.4) == "0.4");
    CHECK(to_serialized(info("float_or_percent"), "120%") == "120%");
    CHECK(to_serialized(info("enum"), "top") == "top");
}

TEST_CASE("Catalog::limit_id_of relie les clés de température aux limites du fabricant")
{
    using Plyo::Catalog::limit_id_of;
    CHECK(limit_id_of("nozzle_temperature") == "nozzle_temp");
    CHECK(limit_id_of("nozzle_temperature_initial_layer") == "nozzle_temp_initial");
    CHECK(limit_id_of("textured_plate_temp") == "bed_temp");
    CHECK(limit_id_of("hot_plate_temp_initial_layer") == "bed_temp_initial");
    CHECK(limit_id_of("layer_height").empty());
}

// --- Profils enregistrés par l'assistant ---
TEST_CASE("Profiles::copy_name : copie utilisateur d'un profil système, sans doublon ni nom trop long")
{
    using Plyo::Profiles::copy_name;
    CHECK(copy_name("Generic TPU @K2", {}) == "Generic TPU @K2 (Plyo)");
    CHECK(copy_name("Generic TPU @K2", {"Generic TPU @K2 (Plyo)"}) == "Generic TPU @K2 (Plyo 2)");
    CHECK(copy_name("Generic TPU @K2", {"Generic TPU @K2 (Plyo)", "Generic TPU @K2 (Plyo 2)"}) == "Generic TPU @K2 (Plyo 3)");
    const std::string longest = copy_name(std::string(300, 'a'), {});
    CHECK(longest.size() <= 100);
    CHECK(longest.size() > 60);
    CHECK(longest.substr(longest.size() - 7) == " (Plyo)");
    std::string accents;
    for (int i = 0; i < 80; ++i)
        accents += "é"; // 2 octets chacun : la coupe ne doit jamais tomber au milieu d'un caractère
    const std::string cut = copy_name(accents, {});
    CHECK(cut.size() <= 100);
    CHECK(cut.substr(0, cut.size() - 7).size() % 2 == 0);
}

TEST_CASE("Profiles::file_stem : nom de fichier stable et sûr pour un couple imprimante + filament")
{
    using Plyo::Profiles::file_stem;
    const std::string a = file_stem("Creality K2 0.4 | Generic TPU @K2-all");
    CHECK(a == file_stem("Creality K2 0.4 | Generic TPU @K2-all"));
    CHECK(a != file_stem("Creality K2 0.4 | Generic PLA @K2-all"));
    CHECK(a.size() == 16);
    CHECK(a.find_first_not_of("0123456789abcdef") == std::string::npos);
    CHECK(file_stem("../../etc/passwd").find('/') == std::string::npos);
}

TEST_CASE("Sanitize::reliable ne garde que des réglages sous forme de texte, par portée connue")
{
    const json stored = {{"machine", "K2 | TPU"}, {"date", "2026-10-28"},
                         {"values", {{"print", {{"layer_height", "0.2"}, {"bad", 3}}}, {"filament", {{"fan_max_speed", "100"}}}, {"autre", {{"x", "y"}}}}}};
    const json out = Plyo::Sanitize::reliable(stored);
    CHECK(out["machine"] == "K2 | TPU");
    // ROB-07 : la portée impression d'une version d'avant le lot 4 est ignorée à la lecture (réglages de la pièce d'alors).
    CHECK_FALSE(out["values"].contains("print"));
    CHECK(out["values"]["filament"] == json{{"fan_max_speed", "100"}});
    CHECK_FALSE(out["values"].contains("autre"));
    CHECK(Plyo::Sanitize::reliable(json("n'importe quoi")).empty());
    CHECK(Plyo::Sanitize::reliable(json{{"machine", 3}}).empty());
}

// --- Revue finale : enregistrement vérifié, version fiable prise au bon moment ---
TEST_CASE("Profiles::written_since : un fichier absent, vide ou ancien n'est pas un enregistrement réussi")
{
    using Plyo::Profiles::written_since;
    const fs::path dir = fresh_dir();
    const std::time_t now = std::time(nullptr);
    CHECK_FALSE(written_since(dir / "absent.json", now - 5));
    write_raw(dir / "vide.json", "");
    CHECK_FALSE(written_since(dir / "vide.json", now - 5));
    write_raw(dir / "frais.json", "{}");
    CHECK(written_since(dir / "frais.json", now - 5));
    write_raw(dir / "ancien.json", "{}");
    fs::last_write_time(dir / "ancien.json", now - 3600);
    CHECK_FALSE(written_since(dir / "ancien.json", now - 5));
    fs::remove_all(dir);
}

TEST_CASE("Sanitize::reliable garde l'instant du lot (at) quand il est donné")
{
    const json stored = {{"machine", "K2 | TPU"}, {"date", "2026-10-28"}, {"at", "2026-10-28T11:14:03"}, {"values", {{"print", {{"layer_height", "0.2"}}}}}};
    CHECK(Plyo::Sanitize::reliable(stored)["at"] == "2026-10-28T11:14:03");
    CHECK(Plyo::Sanitize::reliable(json{{"machine", "K2 | TPU"}})["at"] == "");
}

TEST_CASE("Project: les étapes manquantes sont dans l'ordre")
{
    using namespace Plyo::ProjectLogic;
    CHECK(missing(nlohmann::json()) == std::vector<std::string>{"printer", "part", "filament"});
    CHECK(missing(nlohmann::json{{"printer", {{"preset", "A"}}}}) == std::vector<std::string>{"part", "filament"});
    const nlohmann::json full = {{"printer", {{"preset", "A"}}}, {"filament", {{"type", "PLA"}, {"preset", "F"}}}, {"part", {{"name", "p.stl"}}}};
    CHECK(missing(full).empty());
    CHECK(complete(full));
    CHECK_FALSE(complete(nlohmann::json("pas un objet")));
}

TEST_CASE("Project: refus quand la fiche est incomplète ou que le profil d'Orca diverge")
{
    using namespace Plyo::ProjectLogic;
    CHECK_FALSE(refusal(nlohmann::json(), "A", "F").empty());
    const nlohmann::json full = {{"printer", {{"preset", "A"}}}, {"filament", {{"type", "PLA"}, {"preset", "F"}}}, {"part", {{"name", "p.stl"}}}};
    CHECK(refusal(full, "A", "F").empty());
    CHECK_FALSE(refusal(full, "B", "F").empty());
    CHECK_FALSE(refusal(full, "A", "G").empty());
}

TEST_CASE("Project: un réglage de l'onglet Filament n'exige que la machine et la bobine")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json no_part = {{"printer", {{"preset", "A"}}}, {"filament", {{"type", "PLA"}, {"preset", "F"}}}};
    CHECK(missing_for(no_part, true).empty());
    CHECK(missing_for(no_part, false) == std::vector<std::string>{"part"});
    CHECK(refusal(no_part, "A", "F", true).empty());                // « ma pièce d'hier a des fils » : permis sans pièce
    CHECK_FALSE(refusal(no_part, "A", "G", true).empty());          // Orca n'est plus sur la bobine du projet : refusé
    CHECK(refusal(no_part, "A", "F", false) == "Pour appliquer ça, dis-moi d'abord quelle pièce tu imprimes.");
    CHECK(missing_for(nlohmann::json(), true) == std::vector<std::string>{"printer", "filament"});
    CHECK(refusal(nlohmann::json(), "A", "F", true) == "Pour appliquer ça, dis-moi d'abord sur quelle machine et avec quelle bobine tu imprimes.");
    CHECK(refusal(nlohmann::json(), "A", "F") == "Pour appliquer ça, dis-moi d'abord sur quelle machine, quelle pièce et avec quelle bobine tu imprimes.");
    CHECK(refusal(nlohmann::json{{"printer", {{"preset", "A"}}}}, "A", "F", true) == "Pour appliquer ça, dis-moi d'abord avec quelle bobine tu imprimes.");
    // Machine seulement proposée (projet précédent, pas confirmée) : elle manque encore.
    CHECK(missing_for(nlohmann::json{{"printer", {{"preset", "A"}, {"proposed", true}}}, {"filament", {{"preset", "F"}}}}, true) == std::vector<std::string>{"printer"});
}

TEST_CASE("Project: sanitize garde la réussite et le dernier envoi, sans rien d'autre")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json raw = {{"success", true},
                                {"send", {{"spool", {{"id", "s1"}, {"name", "Sunlu PLA+ noir"}, {"path", "/x"}}}, {"watch", "w3-1731400000000"},
                                          {"failed", true}, {"answered", false}, {"marked", "oui"}, {"secret", "SECRET"},
                                          {"end", {{"verdict", "finished"}, {"file", "cube.gcode"}, {"host", "SECRET"}}}, {"outcome", "cancelled"}}}};
    const nlohmann::json clean = sanitize(raw);
    CHECK(clean["success"] == true);
    CHECK(clean["send"]["spool"] == nlohmann::json({{"id", "s1"}, {"name", "Sunlu PLA+ noir"}}));
    CHECK(clean["send"]["watch"] == "w3-1731400000000");
    CHECK(clean["send"]["failed"] == true);
    CHECK_FALSE(clean["send"].contains("answered")); // faux : rien à garder
    CHECK_FALSE(clean["send"].contains("marked"));   // pas un booléen
    CHECK(clean["send"]["end"] == nlohmann::json({{"verdict", "finished"}, {"file", "cube.gcode"}}));
    CHECK(clean["send"]["outcome"] == "cancelled");
    CHECK(clean.dump().find("SECRET") == std::string::npos);
    // Valeurs illisibles : elles disparaissent.
    const nlohmann::json bad = sanitize({{"success", "oui"}, {"send", {{"spool", {{"id", "s1"}}}, {"end", {{"verdict", "boom"}}}, {"outcome", "x"}, {"watch", 12}}}});
    CHECK_FALSE(bad.contains("success"));
    CHECK(bad["send"] == nlohmann::json::object());
    CHECK_FALSE(sanitize({{"send", "x"}}).contains("send"));
    CHECK_FALSE(sanitize({{"success", false}}).contains("success"));
}

TEST_CASE("Project: l'adaptation d'un 3MF impose les températures de la fiche")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json project = {{"filament", {{"type", "PLA"}, {"nozzle_temp", 215}, {"bed_temp", 60}}}};
    const nlohmann::json file    = {{"nozzle_temperature", 250}, {"layer_height", 0.2}, {"outer_wall_speed", 900}};
    auto range_of = [](const std::string& key) -> nlohmann::json {
        if (key == "outer_wall_speed")
            return {{"min", 10}, {"max", 300}};
        if (key == "layer_height")
            return {{"min", 0.05}, {"max", 0.6}};
        return nullptr;
    };
    const Adaptation a = adapt_3mf(file, project, range_of);
    bool nozzle_ok = false, layer_ok = false, speed_applied = false;
    for (const auto& c : a.apply) {
        if (c["key"] == "nozzle_temperature" && c["value"] == 215) nozzle_ok = true;
        if (c["key"] == "layer_height" && c["value"] == 0.2) layer_ok = true;
        if (c["key"] == "outer_wall_speed") speed_applied = true;
    }
    CHECK(nozzle_ok);
    CHECK(layer_ok);
    CHECK_FALSE(speed_applied);
    REQUIRE(a.dropped.size() == 1);
    CHECK(a.dropped[0]["key"] == "outer_wall_speed");
}

TEST_CASE("Project: une température absente du 3MF est imposée par la fiche")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json project = {{"filament", {{"nozzle_temp", 215}, {"bed_temp", 60}}}};
    const Adaptation     a       = adapt_3mf(nlohmann::json::object(), project, [](const std::string&) -> nlohmann::json { return nullptr; });
    bool nozzle = false, bed = false;
    for (const auto& c : a.apply) {
        if (c["key"] == "nozzle_temperature") nozzle = true;
        if (c["key"] == "hot_plate_temp") bed = true;
    }
    CHECK(nozzle);
    CHECK(bed);
}

TEST_CASE("Project: aucun secret ne sort de la logique du projet")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json project = {{"printer", {{"preset", "A"}, {"printhost_apikey", "SECRET"}}},
                                    {"filament", {{"nozzle_temp", 215}, {"bed_temp", 60}, {"printhost_apikey", "SECRET"}}}};
    const Adaptation a = adapt_3mf(nlohmann::json{{"printhost_apikey", "SECRET"}}, project, [](const std::string&) -> nlohmann::json { return nullptr; });
    CHECK(a.apply.dump().find("SECRET") == std::string::npos);
    CHECK(a.dropped.dump().find("SECRET") == std::string::npos);
    CHECK(refusal(project, "B", "F").find("SECRET") == std::string::npos);
}

TEST_CASE("Project: sanitize garde la confirmation des températures de la bobine")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json ok = sanitize({{"filament", {{"type", "PLA"}, {"preset", "Generic PLA"}, {"temps_ok", true}}}});
    CHECK(ok["filament"]["temps_ok"] == true);
    CHECK_FALSE(sanitize({{"filament", {{"preset", "Generic PLA"}, {"temps_ok", false}}}})["filament"].contains("temps_ok"));
    CHECK_FALSE(sanitize({{"filament", {{"preset", "Generic PLA"}, {"temps_ok", "oui"}}}})["filament"].contains("temps_ok"));
}

TEST_CASE("Project: sanitize garde les emplacements du Canvas")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json raw = {{"printer", {{"preset", "Ma CC2"}}},
                                {"canvas", {{{"t", 0}, {"canvas_id", 0}, {"tray_id", 3}, {"type", "PLA"}, {"color", "#7C4C00"}, {"preset", "Generic PLA @ECC2"}, {"secret", "x"}},
                                            {{"t", 1}, {"canvas_id", 0}, {"tray_id", 2}, {"type", "ASA"}, {"color", "#898989"}, {"preset", "Generic ASA @ECC2"}},
                                            {{"t", "2"}, {"canvas_id", 0}, {"tray_id", 1}},           // t illisible : écartée
                                            {{"t", 3}, {"canvas_id", 0}, {"tray_id", -1}},            // emplacement illisible : écartée
                                            {{"t", 40}, {"canvas_id", 0}, {"tray_id", 1}}}}};         // hors limites : écartée
    const nlohmann::json clean = sanitize(raw);
    REQUIRE(clean["canvas"].size() == 2);
    CHECK(clean["canvas"][0] == nlohmann::json({{"t", 0}, {"canvas_id", 0}, {"tray_id", 3}, {"type", "PLA"}, {"color", "#7C4C00"}, {"preset", "Generic PLA @ECC2"}}));
    CHECK(clean["canvas"][1]["preset"] == "Generic ASA @ECC2");
    // Projet d'avant la fonction : pas de clé « canvas ».
    CHECK_FALSE(sanitize({{"printer", {{"preset", "Ma CC2"}}}}).contains("canvas"));
    CHECK_FALSE(sanitize({{"canvas", "n'importe quoi"}}).contains("canvas"));

    const auto extra = extra_filaments(clean);
    REQUIRE(extra.size() == 1);
    CHECK(extra[0].first == 1);
    CHECK(extra[0].second == "Generic ASA @ECC2");
    CHECK(extra_filaments(sanitize({{"printer", {{"preset", "Ma CC2"}}}})).empty());
}

TEST_CASE("Project: sanitize garde le numéro et la nature d'un emplacement (CFS, IFS, U1, saisie manuelle)")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json raw = {{"canvas", {{{"t", 0}, {"canvas_id", 1}, {"tray_id", 0}, {"label", "1A"}, {"imposable", true}, {"source", "printer"}, {"system", "cfs"}},
                                            {{"t", 1}, {"canvas_id", 0}, {"tray_id", 1}, {"label", "2"}, {"imposable", false}, {"source", "manual"}, {"system", "manual"}},
                                            {{"t", 2}, {"canvas_id", 0}, {"tray_id", 2}, {"imposable", "oui"}, {"source", "ailleurs"}, {"system", "autre"}}}}};
    const nlohmann::json clean = sanitize(raw)["canvas"];
    REQUIRE(clean.size() == 3);
    CHECK(clean[0]["label"] == "1A");
    CHECK(clean[0]["imposable"] == true);
    CHECK(clean[0]["system"] == "cfs");
    CHECK(clean[1]["imposable"] == false);
    CHECK(clean[1]["source"] == "manual");
    // Une valeur illisible disparaît ; le panneau traite alors l'entrée comme celles d'un projet ancien de la CC2.
    CHECK_FALSE(clean[2].contains("imposable"));
    CHECK_FALSE(clean[2].contains("source"));
    CHECK_FALSE(clean[2].contains("system"));
    CHECK_FALSE(clean[2].contains("label"));
}

TEST_CASE("Project: sanitize ne garde que les clés connues du projet")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json dirty = {{"printer", {{"preset", "A"}, {"name", "Ma A"}, {"printhost_apikey", "SECRET"}, {"proposed", true}}},
                                  {"filament", {{"type", "PLA"}, {"preset", "F"}, {"nozzle_temp", 215}, {"bed_temp", 60}, {"token", "SECRET"}}},
                                  {"part", {{"name", "p.stl"}, {"path", "/Users/x/p.stl"}}},
                                  {"step", "print"},
                                  {"autre", "SECRET"}};
    const nlohmann::json clean = sanitize(dirty);
    CHECK(clean.dump().find("SECRET") == std::string::npos);
    CHECK(clean["printer"]["preset"] == "A");
    CHECK(clean["printer"]["proposed"] == true);
    CHECK(clean["filament"]["nozzle_temp"] == 215);
    CHECK(clean["part"]["name"] == "p.stl");
    CHECK_FALSE(clean["part"].contains("path"));
    CHECK(clean["step"] == "print");
    CHECK(sanitize(nlohmann::json("x")).is_null());
    CHECK(sanitize(nlohmann::json{{"adapted", "bague.3mf"}})["adapted"] == "bague.3mf"); // 3MF déjà adapté
    CHECK_FALSE(sanitize(nlohmann::json{{"adapted", 12}}).contains("adapted"));
    CHECK(sanitize(nlohmann::json{{"step", "done"}})["step"] == "done"); // visite terminée ou passée
    CHECK_FALSE(sanitize(nlohmann::json{{"step", "model"}}).contains("step"));
}

TEST_CASE("Project: une valeur seulement proposée compte comme non choisie")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json p = {{"printer", {{"preset", "A"}, {"proposed", true}}}, {"filament", {{"preset", "F"}}}, {"part", {{"name", "p.stl"}}}};
    CHECK(missing(p) == std::vector<std::string>{"printer"});
    CHECK_FALSE(refusal(p, "A", "F").empty());
}

TEST_CASE("Project: les réglages d'un 3MF sont lus en première valeur de chaque liste")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json settings = {{"layer_height", "0.2"}, {"nozzle_temperature", nlohmann::json::array({"250", "250"})},
                                     {"enable_support", "1"}, {"vide", nlohmann::json::array()}, {"nombre", 5}};
    const nlohmann::json flat = first_values(settings);
    CHECK(flat["layer_height"] == "0.2");
    CHECK(flat["nozzle_temperature"] == "250");
    CHECK(flat["enable_support"] == "1");
    CHECK_FALSE(flat.contains("vide"));
    CHECK_FALSE(flat.contains("nombre"));
    CHECK(first_values(nlohmann::json("x")).empty());
}

TEST_CASE("Project: un booléen ou un texte d'un 3MF passe tel quel quand la clé est permise")
{
    using namespace Plyo::ProjectLogic;
    auto range_of = [](const std::string& key) -> nlohmann::json {
        if (key == "enable_support" || key == "fill_density")
            return nlohmann::json::object();
        return nullptr;
    };
    const Adaptation a = adapt_3mf({{"enable_support", true}, {"fill_density", "15%"}, {"gcode_secret", "x"}}, nlohmann::json::object(), range_of);
    bool support = false, density = false, secret = false;
    for (const auto& c : a.apply) {
        if (c["key"] == "enable_support" && c["value"] == true) support = true;
        if (c["key"] == "fill_density" && c["value"] == "15%") density = true;
        if (c["key"] == "gcode_secret") secret = true;
    }
    CHECK(support);
    CHECK(density);
    CHECK_FALSE(secret);
}

TEST_CASE("Calibration : une bobine reçoit le résultat dans son propre préréglage")
{
    using namespace Plyo;
    const std::string spool = "Sunlu PLA+ noir — CR-10 SE";
    const std::string sfx   = " (calibré Plyo)";
    // Bobine : le nom ne change pas, jamais de « (calibré Plyo) ».
    CHECK(CalibrationLogic::target_name(true, spool, "Generic PLA", "CR-10 SE", sfx) == spool);
    CHECK(CalibrationLogic::target_name(true, spool, "Generic PLA", "CR-10 SE", sfx).find("calibré") == std::string::npos);
    CHECK(ProjectLogic::same_filament(spool, spool));
    // Hors bobine : le nom d'avant.
    CHECK(CalibrationLogic::target_name(false, "Generic PLA", "Generic PLA", "CR-10 SE", sfx) == "Generic PLA — CR-10 SE (calibré Plyo)");
}

TEST_CASE("Project: le filament copié ou calibré par Plyo reste celui du projet")
{
    using namespace Plyo::ProjectLogic;
    CHECK(same_filament("Generic PLA @ECC2", "Generic PLA @ECC2"));
    CHECK(same_filament("Generic PLA @ECC2", "Generic PLA @ECC2 (Plyo)"));
    CHECK(same_filament("Generic PLA @ECC2", "Generic PLA @ECC2 — Centauri (calibré Plyo)"));
    CHECK_FALSE(same_filament("Generic PLA @ECC2", "Generic PETG @ECC2"));
    CHECK_FALSE(same_filament("Generic PLA @ECC2", "Generic PLA @ECC2 Silk"));
    const nlohmann::json full = {{"printer", {{"preset", "A"}}}, {"filament", {{"preset", "F"}}}, {"part", {{"name", "p.stl"}}}};
    CHECK(refusal(full, "A", "F (Plyo)").empty());
}

TEST_CASE("Project: un réglage fait dans la fiche exige que le profil d'Orca soit celui du projet")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json no_part = {{"printer", {{"preset", "A"}}}, {"filament", {{"preset", "F"}}}};
    CHECK(edit_refusal(no_part, "A", "F").empty());          // la pièce n'est pas encore choisie : permis
    CHECK_FALSE(edit_refusal(no_part, "A", "G").empty());    // Orca est sur un autre filament : refusé
    CHECK_FALSE(edit_refusal(no_part, "B", "F").empty());
    const nlohmann::json only_printer = {{"printer", {{"preset", "A"}}}};
    CHECK(edit_refusal(only_printer, "A", "n'importe quel filament").empty()); // le filament n'est pas encore choisi
    CHECK(edit_refusal(nlohmann::json(), "A", "F").empty());                   // rien de choisi : rien à comparer
}

TEST_CASE("Project: la remise du projet n'est proposée que s'il y a quelque chose à remettre")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json p = {{"printer", {{"preset", "A"}}}, {"filament", {{"preset", "F"}}}};
    CHECK_FALSE(can_restore(p, "A", "F"));
    CHECK(can_restore(p, "B", "F"));
    CHECK(can_restore(p, "A", "G"));
    CHECK_FALSE(can_restore(nlohmann::json(), "A", "F"));
    CHECK_FALSE(can_restore(nlohmann::json{{"printer", {{"preset", "A"}}}}, "B", "F")); // pas de filament à remettre
}

TEST_CASE("CC2: les paquets MQTT font l'aller-retour")
{
    using namespace Plyo::CC2Logic;
    const std::string connect = connect_packet("1_PC_1234", "elegoo", "123456");
    Plyo::CC2Logic::Packet p;
    size_t consumed = 0;
    REQUIRE(parse_packet(connect, consumed, p));
    CHECK(consumed == connect.size());
    CHECK(p.type == 1);
    CHECK(p.body.substr(0, 8) == std::string("\x00\x04MQTT\x04\xC2", 8));

    const std::string long_payload(300, 'x'); // longueur sur deux octets
    const std::string pub = publish_packet("elegoo/SN/api_register", long_payload);
    REQUIRE(parse_packet(pub, consumed, p));
    CHECK(p.type == 3);
    std::string topic, payload;
    REQUIRE(publish_fields(p, topic, payload));
    CHECK(topic == "elegoo/SN/api_register");
    CHECK(payload == long_payload);

    CHECK_FALSE(parse_packet(pub.substr(0, pub.size() - 1), consumed, p)); // paquet incomplet
    CHECK_FALSE(parse_packet("", consumed, p));

    const std::string sub = subscribe_packet(1, {"a/b", "c/d"});
    REQUIRE(parse_packet(sub, consumed, p));
    CHECK(p.type == 8);
    CHECK(static_cast<unsigned char>(sub[0]) == 0x82);
}

TEST_CASE("CC2: les messages de démarrage d'impression")
{
    using namespace Plyo::CC2Logic;
    CHECK(topic_api_request("SN1", "1_PC_1") == "elegoo/SN1/1_PC_1/api_request");
    CHECK(topic_api_response("SN1", "1_PC_1") == "elegoo/SN1/1_PC_1/api_response");
    CHECK(topic_register_response("SN1", "1_PC_1") == "elegoo/SN1/1_PC_1_req/register_response");
    CHECK(topic_api_register("SN1") == "elegoo/SN1/api_register");

    const nlohmann::json reg = nlohmann::json::parse(register_payload("1_PC_1"));
    CHECK(reg["client_id"] == "1_PC_1");
    CHECK(reg["request_id"] == "1_PC_1_req");
    CHECK(is_register_ok(R"({"client_id":"1_PC_1","error":"ok"})"));
    CHECK_FALSE(is_register_ok(R"({"client_id":"1_PC_1","error":"too many clients"})"));
    CHECK_FALSE(is_register_ok("pas du json"));

    const nlohmann::json start = nlohmann::json::parse(start_print_payload(7, "bague.gcode"));
    CHECK(start["id"] == 7);
    CHECK(start["method"] == 1020);
    CHECK(start["params"]["filename"] == "bague.gcode");
    CHECK(start["params"]["storage_media"] == "local");

    CHECK(parse_start_reply(R"({"id":7,"method":1020,"result":{"error_code":0}})", 7).matched);
    CHECK(parse_start_reply(R"({"id":7,"method":1020,"result":{"error_code":0}})", 7).error_code == 0);
    CHECK(parse_start_reply(R"({"id":7,"method":1020,"result":{"error_code":1009}})", 7).error_code == 1009);
    CHECK_FALSE(parse_start_reply(R"({"id":8,"method":1020,"result":{"error_code":0}})", 7).matched); // autre demande
    CHECK_FALSE(parse_start_reply(R"({"id":7,"method":6000,"result":{}})", 7).matched);               // autre méthode
    CHECK(error_text(1009).find("occupée") != std::string::npos);
    CHECK(error_text(1021).find("introuvable") != std::string::npos);
    CHECK_FALSE(error_text(99999).empty());
}

namespace {
// Réponse réelle de la CC2 de Jérôme à la méthode 2005 (2026-11-03), emplacements numérotés 0 à 3.
const char* CC2_CANVAS_REPLY = R"({"id":4,"method":2005,"result":{"canvas_info":{"active_canvas_id":0,"active_tray_id":-1,"auto_refill":false,
 "canvas_list":[{"canvas_id":0,"connected":1,"tray_list":[
  {"brand":"Generic","filament_code":"0x0000","filament_color":"#FCEBD7","filament_name":"PLA","filament_type":"PLA","max_nozzle_temp":230,"min_nozzle_temp":190,"status":0,"tray_id":0},
  {"brand":"Generic","filament_code":"0x0000","filament_color":"#F95D77","filament_name":"PLA","filament_type":"PLA","max_nozzle_temp":230,"min_nozzle_temp":190,"status":1,"tray_id":1},
  {"brand":"Generic","filament_code":"0x0800","filament_color":"#898989","filament_name":"ASA","filament_type":"ASA","max_nozzle_temp":280,"min_nozzle_temp":240,"status":1,"tray_id":2},
  {"brand":"Generic","filament_code":"0x0000","filament_color":"#7c4c00","filament_name":"PLA","filament_type":"PLA","max_nozzle_temp":230,"min_nozzle_temp":190,"status":1,"tray_id":3}]}]},"error_code":0}})";
} // namespace

TEST_CASE("CC2: lecture des emplacements du Canvas (méthode 2005)")
{
    using namespace Plyo::CC2Logic;
    const nlohmann::json ask = nlohmann::json::parse(canvas_read_payload(4));
    CHECK(ask["id"] == 4);
    CHECK(ask["method"] == 2005);
    CHECK(ask["params"] == nlohmann::json::object());

    const nlohmann::json c = parse_canvas_reply(CC2_CANVAS_REPLY, 4);
    REQUIRE(c.is_object());
    CHECK(c["error_code"] == 0);
    REQUIRE(c["canvases"].size() == 1);
    CHECK(c["canvases"][0]["canvas_id"] == 0);
    CHECK(c["canvases"][0]["connected"] == true);
    const nlohmann::json& trays = c["canvases"][0]["trays"];
    REQUIRE(trays.size() == 4);
    CHECK(trays[3]["tray_id"] == 3);
    CHECK(trays[3]["type"] == "PLA");
    CHECK(trays[3]["color"] == "#7C4C00"); // normalisée en majuscules
    CHECK(trays[0]["status"] == 0);
    CHECK(trays[2]["type"] == "ASA");
    CHECK(trays[2]["min_temp"] == 240);
    CHECK(c["active"]["tray_id"] == -1);
    CHECK(parse_canvas_reply(CC2_CANVAS_REPLY, 5).is_null());             // autre demande
    CHECK(parse_canvas_reply(R"({"id":4,"method":1020,"result":{}})", 4).is_null()); // autre méthode
    CHECK(parse_canvas_reply("pas du json", 4).is_null());
    const nlohmann::json bad = parse_canvas_reply(R"({"id":4,"method":2005,"result":{"canvas_info":{"canvas_list":[{"canvas_id":0,"connected":1,"tray_list":[{"tray_id":1,"filament_color":"rouge"}]}]},"error_code":0}})", 4);
    CHECK(bad["canvases"][0]["trays"][0]["color"] == "");                  // couleur illisible → vide
    CHECK(bad["canvases"][0]["trays"][0]["type"] == "");
}

TEST_CASE("CC2: démarrage avec la carte des emplacements")
{
    using namespace Plyo::CC2Logic;
    // Sans carte : exactement le message d'avant (aucun « config »).
    CHECK(start_print_payload(7, "bague.gcode") == start_print_payload(7, "bague.gcode", nlohmann::json::array()));
    CHECK_FALSE(nlohmann::json::parse(start_print_payload(7, "bague.gcode"))["params"].contains("config"));
    const nlohmann::json map = nlohmann::json::array({{{"t", 0}, {"canvas_id", 0}, {"tray_id", 3}}});
    const nlohmann::json start = nlohmann::json::parse(start_print_payload(7, "bague.gcode", map));
    CHECK(start["params"]["filename"] == "bague.gcode");
    CHECK(start["params"]["config"]["slot_map"] == map);
}

TEST_CASE("CC2: sanitize_slot_map refuse toute carte douteuse (tout ou rien)")
{
    using namespace Plyo::CC2Logic;
    const nlohmann::json canvases = parse_canvas_reply(CC2_CANVAS_REPLY, 4)["canvases"];
    const nlohmann::json good = nlohmann::json::array({{{"t", 0}, {"canvas_id", 0}, {"tray_id", 3}}, {{"t", 1}, {"canvas_id", 0}, {"tray_id", 1}}});
    CHECK(sanitize_slot_map(good, canvases) == good);
    // Deux couleurs sur le même emplacement : permis (l'utilisateur l'a choisi).
    const nlohmann::json same = nlohmann::json::array({{{"t", 0}, {"canvas_id", 0}, {"tray_id", 3}}, {{"t", 1}, {"canvas_id", 0}, {"tray_id", 3}}});
    CHECK(sanitize_slot_map(same, canvases) == same);
    CHECK(sanitize_slot_map(nlohmann::json::array({{{"t", 0}, {"canvas_id", 0}, {"tray_id", 3}}, {{"t", 0}, {"canvas_id", 0}, {"tray_id", 1}}}), canvases).empty()); // t en double
    CHECK(sanitize_slot_map(nlohmann::json::array({{{"t", 0}, {"canvas_id", 0}, {"tray_id", 7}}}), canvases).empty());   // emplacement inconnu
    CHECK(sanitize_slot_map(nlohmann::json::array({{{"t", 0}, {"canvas_id", 1}, {"tray_id", 3}}}), canvases).empty());   // unité absente
    CHECK(sanitize_slot_map(nlohmann::json::array({{{"t", -1}, {"canvas_id", 0}, {"tray_id", 3}}}), canvases).empty());  // t négatif
    CHECK(sanitize_slot_map(nlohmann::json::array({{{"t", "0"}, {"canvas_id", 0}, {"tray_id", 3}}}), canvases).empty()); // pas un entier
    nlohmann::json off = canvases;
    off[0]["connected"] = false;
    CHECK(sanitize_slot_map(good, off).empty()); // unité déconnectée
    CHECK(sanitize_slot_map("pas une liste", canvases).empty());
    // Seules les trois clés partent vers l'imprimante.
    const nlohmann::json extra = nlohmann::json::array({{{"t", 0}, {"canvas_id", 0}, {"tray_id", 3}, {"type", "PLA"}}});
    CHECK(sanitize_slot_map(extra, canvases) == nlohmann::json::array({{{"t", 0}, {"canvas_id", 0}, {"tray_id", 3}}}));
}

TEST_CASE("CC2: map_for_send ne sert la carte qu'à la bonne imprimante et aux bonnes couleurs")
{
    using namespace Plyo::CC2Logic;
    const nlohmann::json map  = nlohmann::json::array({{{"t", 0}, {"canvas_id", 0}, {"tray_id", 3}}, {{"t", 2}, {"canvas_id", 0}, {"tray_id", 1}}});
    const nlohmann::json plan = {{"host", "192.168.1.29"}, {"map", map}};
    CHECK(map_for_send(plan, "192.168.1.29", {0, 2}) == map);
    CHECK(map_for_send(plan, "192.168.1.29", {2, 0}) == map);   // ordre indifférent
    CHECK(map_for_send(plan, "192.168.1.30", {0, 2}).empty());  // autre imprimante
    CHECK(map_for_send(plan, "192.168.1.29", {0}).empty());     // pièce découpée avec moins de couleurs
    CHECK(map_for_send(plan, "192.168.1.29", {0, 1, 2}).empty()); // ou plus
    CHECK(map_for_send(nullptr, "192.168.1.29", {0}).empty());
}

TEST_CASE("CC2: decide_map relit le Canvas et refuse une carte qui ne correspond plus")
{
    using namespace Plyo::CC2Logic;
    const nlohmann::json canvases = parse_canvas_reply(CC2_CANVAS_REPLY, 4)["canvases"];
    const nlohmann::json planned  = nlohmann::json::array({{{"t", 0}, {"canvas_id", 0}, {"tray_id", 3}, {"type", "PLA"}, {"preset", "Generic PLA @ECC2"}},
                                                           {{"t", 1}, {"canvas_id", 0}, {"tray_id", 2}, {"type", "ASA"}, {"preset", "Generic ASA @ECC2"}}});
    const std::vector<std::string> presets = {"Generic PLA @ECC2 (Plyo)", "Generic ASA @ECC2"};
    const MapDecision ok = decide_map(planned, canvases, presets);
    CHECK(ok.refusal.empty());
    CHECK(ok.map == nlohmann::json::array({{{"t", 0}, {"canvas_id", 0}, {"tray_id", 3}}, {{"t", 1}, {"canvas_id", 0}, {"tray_id", 2}}}));
    // Relecture impossible.
    CHECK_FALSE(decide_map(planned, nullptr, presets).refusal.empty());
    // L'emplacement 3 contient maintenant du PETG : refus (pas d'impression ASA découpée sur du PETG).
    nlohmann::json petg = canvases;
    petg[0]["trays"][2]["type"] = "PETG";
    const MapDecision changed = decide_map(planned, petg, presets);
    CHECK(changed.map.empty());
    CHECK(changed.refusal.find("emplacement 3") != std::string::npos);
    // La couleur 2 a changé de profil dans Orca depuis le choix : refus.
    CHECK_FALSE(decide_map(planned, canvases, {"Generic PLA @ECC2", "Generic PETG @ECC2"}).refusal.empty());
    // Moins de filaments dans Orca que de couleurs dans la carte : refus.
    CHECK_FALSE(decide_map(planned, canvases, {"Generic PLA @ECC2"}).refusal.empty());
    // Emplacement disparu : refus.
    nlohmann::json gone = canvases;
    gone[0]["trays"].erase(gone[0]["trays"].begin() + 3);
    CHECK_FALSE(decide_map(planned, gone, presets).refusal.empty());
}

TEST_CASE("CC2: map_for_send prend les couleurs découpées de l'appelant, jamais celles gardées dans le plan")
{
    using namespace Plyo::CC2Logic;
    const nlohmann::json map  = nlohmann::json::array({{{"t", 0}, {"canvas_id", 0}, {"tray_id", 3}}, {{"t", 1}, {"canvas_id", 0}, {"tray_id", 1}}});
    const nlohmann::json plan = {{"host", "192.168.1.29"}, {"map", map}, {"sliced_t", {0, 1}}};
    CHECK(map_for_send(plan, "192.168.1.29", {0, 1, 2}).empty()); // la pièce a maintenant 3 couleurs
}

TEST_CASE("CC2: numéro de série lu dans la réponse de découverte")
{
    using namespace Plyo::CC2Logic;
    CHECK(serial_from_discovery(R"({"id":0,"result":{"sn":"ABC123","machine_model":"Centauri Carbon 2"}})") == "ABC123");
    CHECK(serial_from_discovery(R"({"id":0,"result":{}})") == "");
    CHECK(serial_from_discovery("pas du json") == "");
}

TEST_CASE("Canvas: adresse nue et types de profil à essayer")
{
    using namespace Plyo::CanvasLogic;
    CHECK(bare_host("192.168.1.29") == "192.168.1.29");
    CHECK(bare_host("http://192.168.1.29") == "192.168.1.29");
    CHECK(bare_host("http://192.168.1.29:80/") == "192.168.1.29");
    CHECK(bare_host("https://cc2.local:3030/path") == "cc2.local");
    CHECK(bare_host("") == "");
    CHECK(profile_types("PLA") == std::vector<std::string>{"PLA"});
    CHECK(profile_types("pla-cf") == std::vector<std::string>{"PLA-CF", "PLA"});
    CHECK(profile_types(" PETG+ ") == std::vector<std::string>{"PETG+", "PETG"});
    CHECK(profile_types("").empty());
}

TEST_CASE("Habits: sanitize_habits garde les machines, les habitudes de filament et les machines masquées")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json raw = {{"machines", {{"Ma CC2", {{"filament", {{"type", "PLA"}, {"nozzle_temp", 215}, {"bed_temp", 60}, {"secret", "x"}}}, {"printhost_apikey", "SECRET"}}}}},
                                {"hidden", {"Ma K2", 5}}, {"last", "Ma CC2"}, {"autre", "SECRET"}};
    const nlohmann::json clean = sanitize_habits(raw);
    CHECK(clean.dump().find("SECRET") == std::string::npos);
    CHECK(clean["machines"]["Ma CC2"]["filament"]["type"] == "PLA");
    CHECK(clean["machines"]["Ma CC2"]["filament"]["nozzle_temp"] == 215);
    CHECK(clean["hidden"] == nlohmann::json::array({"Ma K2"}));
    CHECK(clean["last"] == "Ma CC2");
}

TEST_CASE("Habits: sanitize_habits plafonne les listes et refuse les températures impossibles")
{
    using namespace Plyo::ProjectLogic;
    nlohmann::json machines = nlohmann::json::object(), hidden = nlohmann::json::array();
    for (int i = 0; i < 80; ++i) {
        machines["m" + std::to_string(i)] = {{"filament", {{"type", "PLA"}, {"nozzle_temp", 215}, {"bed_temp", 60}}}};
        hidden.push_back("h" + std::to_string(i));
    }
    const nlohmann::json clean = sanitize_habits({{"machines", machines}, {"hidden", hidden}});
    CHECK(clean["machines"].size() == 50);
    CHECK(clean["hidden"].size() == 50);
    const nlohmann::json hot = sanitize_habits({{"machines", {{"x", {{"filament", {{"type", "PLA"}, {"nozzle_temp", 900}, {"bed_temp", -5}}}}}}}});
    CHECK_FALSE(hot["machines"]["x"]["filament"].contains("nozzle_temp"));
    CHECK_FALSE(hot["machines"]["x"]["filament"].contains("bed_temp"));
    CHECK(sanitize_habits(nlohmann::json("x")) == nlohmann::json({{"machines", nlohmann::json::object()}, {"hidden", nlohmann::json::array()}, {"last", ""}}));
}

TEST_CASE("Habits: niveau d'explication et questions d'intention")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json clean = sanitize_habits({{"level", "short"}, {"level_manual", true}, {"intent_skips", 2}, {"ask_intent", false}});
    CHECK(clean["level"] == "short");
    CHECK(clean["level_manual"] == true);
    CHECK(clean["intent_skips"] == 2);
    CHECK(clean["ask_intent"] == false);
    const nlohmann::json bad = sanitize_habits({{"level", "expert"}, {"intent_skips", 999}, {"ask_intent", "non"}});
    CHECK_FALSE(bad.contains("level"));
    CHECK(bad["intent_skips"] == 100);
    CHECK_FALSE(bad.contains("ask_intent"));
    // Lot 6 : le retour aux explications détaillées après une question de définition est gardé.
    CHECK(sanitize_habits({{"level", "detailed"}, {"level_hold", true}})["level_hold"] == true);
    CHECK_FALSE(sanitize_habits({{"level_hold", "oui"}}).contains("level_hold"));
}

TEST_CASE("Project: les réponses d'intention sont gardées, et rien d'autre")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json p = sanitize({{"intent", {{"use", "flex"}, {"pref", "balanced"}, {"speed", "normal"}, {"skipped", false}, {"applied", true}, {"secret", "SECRET"}}}});
    CHECK(p["intent"]["use"] == "flex");
    CHECK(p["intent"]["pref"] == "balanced");
    CHECK(p["intent"]["applied"] == true);
    CHECK(p.dump().find("SECRET") == std::string::npos);
    CHECK_FALSE(sanitize({{"intent", {{"use", std::string(300, 'x')}}}})["intent"].contains("use"));
}

// --- Calibration : la pièce de l'utilisateur n'est jamais écrasée ---

TEST_CASE("Calibration: capture_step garde la capture tant qu'il reste un objet du test")
{
    using namespace Plyo::CalibrationLogic;
    const std::vector<size_t> test{10, 11, 12};
    CHECK(capture_step(false, {1, 2}, {}) == CaptureStep::First);
    CHECK(capture_step(false, {}, {}) == CaptureStep::First);
    CHECK(capture_step(true, test, test) == CaptureStep::Keep);
    CHECK(capture_step(true, {}, test) == CaptureStep::Keep);
    // Le cas du rapport : deux carrés supprimés sur le plateau de test, puis passe 2 du débit.
    CHECK(capture_step(true, {10}, test) == CaptureStep::Keep);
    // Plus aucun objet du test (autre projet ouvert, ou plateau de test coupé) : capture en plus, l'ancienne reste.
    CHECK(capture_step(true, {20, 21}, test) == CaptureStep::Replace);
}

TEST_CASE("Calibration: free_capture_path ne rend jamais un fichier existant")
{
    using namespace Plyo::CalibrationLogic;
    const fs::path dir = fresh_dir();
    const fs::path first = free_capture_path(dir);
    CHECK(first.filename().string() == "avant-calibration-1.3mf");
    write_raw(first, "ma piece");
    const fs::path second = free_capture_path(dir);
    CHECK(second.filename().string() == "avant-calibration-2.3mf");
    write_raw(second, "plateau de test");
    write_raw(dir / "avant-calibration-3.3mf", "laissé par une session précédente");
    CHECK(free_capture_path(dir).filename().string() == "avant-calibration-4.3mf");
    boost::nowide::ifstream in(first.string());
    std::string kept;
    std::getline(in, kept);
    CHECK(kept == "ma piece");
    fs::remove(first);
    CHECK(free_capture_path(dir).filename().string() == "avant-calibration-1.3mf"); // une place libre resert
    fs::remove_all(dir);
}

TEST_CASE("Calibration: kept_note signale les pièces gardées sur le disque")
{
    using namespace Plyo::CalibrationLogic;
    CHECK(kept_note({}).empty());
    const std::string note = kept_note({"/plyo/avant-calibration-1.3mf"});
    CHECK(note.find("/plyo/avant-calibration-1.3mf") != std::string::npos);
}

TEST_CASE("CC2: « Démarrer sans carte » n'envoie le code d'accès qu'à l'imprimante qui a refusé")
{
    using Plyo::CC2Logic::plain_start_refusal;
    const nlohmann::json refused = {{"host", "192.168.1.20"}, {"serial", "S"}, {"filename", "a.gcode"}};
    CHECK(plain_start_refusal(refused, "192.168.1.20").empty());
    CHECK_FALSE(plain_start_refusal(refused, "192.168.1.30").empty()); // profil passé sur une autre imprimante
    CHECK_FALSE(plain_start_refusal(refused, "").empty());             // profil sans adresse
    CHECK_FALSE(plain_start_refusal(nullptr, "192.168.1.20").empty()); // refus effacé (nouveau projet)
}

TEST_CASE("Profiles: nom du profil de la connexion, sans jamais écraser un « Ma X » existant")
{
    using Plyo::Profiles::link_profile_name;
    CHECK(link_profile_name("Ma K2", false, {"Ma K2", "K2"}) == "Ma K2"); // profil à soi : mis à jour
    CHECK(link_profile_name("K2", true, {"K2"}) == "Ma K2");
    CHECK(link_profile_name("K2", true, {"K2", "Ma K2"}) == "Ma K2 (Plyo)");
    CHECK(link_profile_name("K2", true, {"K2", "Ma K2", "Ma K2 (Plyo)"}) == "Ma K2 (Plyo 2)");
}

TEST_CASE("Catalog: plafonds Plyo des températures, absolus, cités dans le refus, même confirmés")
{
    using namespace Plyo::Catalog;
    // Mêmes plafonds que le service (whitelist.ts : buse 300 °C, plateau 110 °C ; IA-20) : les plus stricts des deux.
    REQUIRE(temperature_cap("nozzle_temperature").has_value());
    CHECK(*temperature_cap("nozzle_temperature") == 300);
    CHECK(*temperature_cap("nozzle_temperature_initial_layer") == 300);
    CHECK(*temperature_cap("hot_plate_temp") == 110);
    CHECK(*temperature_cap("textured_cool_plate_temp_initial_layer") == 110);
    CHECK(*temperature_cap("chamber_temperature") == 110);
    CHECK_FALSE(temperature_cap("layer_height").has_value());
    CHECK_FALSE(temperature_cap("activate_chamber_temp_control").has_value());

    // Filaments techniques légitimes (PA, PC, PET-CF jusqu'à 300 °C ; ABS/ASA, PC jusqu'à 110 °C au plateau) : jamais refusés.
    CHECK(check_temperature_cap("Buse", "nozzle_temperature", 300).ok);
    CHECK(check_temperature_cap("Plateau", "hot_plate_temp", 110).ok);
    CHECK(check_temperature_cap("Plateau", "hot_plate_temp", 0).ok);
    CHECK(check_temperature_cap("Attente", "filament_tower_interface_print_temp", -1).ok);

    const CheckResult nozzle = check_temperature_cap("Buse", "nozzle_temperature", 301);
    CHECK_FALSE(nozzle.ok);
    CHECK(nozzle.text.find("300") != std::string::npos);
    const CheckResult bed = check_temperature_cap("Plateau", "hot_plate_temp", 111);
    CHECK_FALSE(bed.ok);
    CHECK(bed.text.find("110") != std::string::npos);
    // Autre réglage : pas concerné, quelle que soit la valeur.
    CHECK(check_temperature_cap("Vitesse", "outer_wall_speed", 500).ok);
}

TEST_CASE("Catalog: toutes les températures du catalogue livré ont un plafond")
{
    const fs::path file = fs::path(__FILE__).parent_path() / "../../../../resources/plyo/catalog-keys.json";
    boost::nowide::ifstream in(file.string());
    REQUIRE(in.good());
    const nlohmann::json keys = nlohmann::json::parse(in);
    int checked = 0;
    for (const char* scope : {"print", "filament"})
        for (const auto& [key, kind] : keys.at(scope).items())
            if (key.find("temp") != std::string::npos && kind != "bool") {
                INFO(key);
                CHECK(Plyo::Catalog::temperature_cap(key).has_value());
                ++checked;
            }
    CHECK(checked > 10);
}

TEST_CASE("Commands: seuls les ordres qui créent ou agrandissent peuvent réorganiser la plaque")
{
    using Plyo::CommandsLogic::grows_plate;
    for (const char* op : {"set_copies", "scale", "scale_to_size", "cut_height", "split", "fill_bed", "inch_to_mm"})
        CHECK(grows_plate(op));
    for (const char* op : {"rename", "object_setting", "range_setting", "rotate", "move", "select", "printable", "delete", "center", "drop", "mirror", "lay_flat"})
        CHECK_FALSE(grows_plate(op));
}

TEST_CASE("Commands: un chevauchement déjà là (pièces imbriquées) ne déclenche pas de réorganisation")
{
    using Plyo::CommandsLogic::has_new_overlap;
    const std::set<std::pair<size_t, size_t>> nested{{1, 2}};
    CHECK_FALSE(has_new_overlap({}, {}));
    CHECK_FALSE(has_new_overlap(nested, nested));
    CHECK_FALSE(has_new_overlap(nested, {})); // un chevauchement disparu n'en est pas un nouveau
    CHECK(has_new_overlap(nested, {{1, 2}, {2, 3}})); // une copie posée sur une autre pièce
    CHECK(has_new_overlap({}, {{4, 5}}));              // une coupe : deux morceaux qui se touchent
}

TEST_CASE("Calibration: base de la passe 2 du débit bornée comme la valeur enregistrée")
{
    using Plyo::CalibrationLogic::flow_base_valid;
    CHECK(flow_base_valid(0));   // absente : la passe part du débit du filament
    CHECK(flow_base_valid(0.7));
    CHECK(flow_base_valid(1.3));
    CHECK(flow_base_valid(0.98));
    CHECK_FALSE(flow_base_valid(50));
    CHECK_FALSE(flow_base_valid(1.31));
    CHECK_FALSE(flow_base_valid(0.69));
    CHECK_FALSE(flow_base_valid(-1));
}

TEST_CASE("Catalog: une borne d'Orca en float accepte sa valeur exacte")
{
    using Plyo::Catalog::check_change;
    const double min_f = 0.1f; // 0,100000001… : la valeur 0,1 est juste en dessous
    const double max_f = 0.7f; // 0,699999988… : la valeur 0,7 est juste au-dessus
    CHECK(check_change("Échelle", info("float", min_f), 0.1, no_limits, "", false).ok);
    CHECK(check_change("Échelle", info("float", {}, max_f), 0.7, no_limits, "", false).ok);
    CHECK_FALSE(check_change("Échelle", info("float", min_f), 0.0999, no_limits, "", false).ok);
    CHECK_FALSE(check_change("Échelle", info("float", {}, max_f), 0.7001, no_limits, "", false).ok);
}

TEST_CASE("Project: adapt_3mf accepte la valeur exacte d'une borne d'Orca en float")
{
    using namespace Plyo::ProjectLogic;
    const auto range = [](const std::string&) { return nlohmann::json{{"min", 0.1f}, {"max", 0.7f}}; };
    const Adaptation low = adapt_3mf({{"a", 0.1}, {"b", 0.7}}, nlohmann::json::object(), range);
    CHECK(low.apply.size() == 2);
    CHECK(low.dropped.empty());
    const Adaptation out = adapt_3mf({{"a", 0.0999}, {"b", 0.7001}}, nlohmann::json::object(), range);
    CHECK(out.apply.empty());
    CHECK(out.dropped.size() == 2);
}


// --- Emplacements multi-marques : logique commune ---
// Rien ici ne vient d'une machine : tant que T9, T13, T14, T15 et T17 ne sont pas faits, CFS, IFS et U1 ne sont pas validés.

namespace {
json slots_one_unit(int canvas_id, const std::string& label, int tray_id, const std::string& type, int status)
{
    return json::array({{{"canvas_id", canvas_id}, {"connected", true},
                         {"trays", json::array({{{"tray_id", tray_id}, {"label", label}, {"type", type}, {"status", status}}})}}});
}
} // namespace

TEST_CASE("Slots::decide_map : sans options, exactement les textes de la CC2")
{
    using namespace Plyo;
    const json planned = json::array({{{"t", 0}, {"canvas_id", 0}, {"tray_id", 3}, {"type", "PLA"}, {"preset", ""}}});
    const SlotsLogic::MapDecision gone = SlotsLogic::decide_map(planned, json::array(), {});
    CHECK(gone.refusal == "L'emplacement 4 n'est plus visible sur le Canvas : l'impression n'a pas démarré. Le fichier est sur l'imprimante : dans Plyo, à l'étape Imprimer, « Laisser l'imprimante choisir l'emplacement », ou choisis à nouveau les emplacements.");
    const SlotsLogic::MapDecision same = CC2Logic::decide_map(planned, json::array(), {});
    CHECK(same.refusal == gone.refusal);
    const SlotsLogic::MapDecision none = SlotsLogic::decide_map(planned, json(), {});
    CHECK(none.refusal.find("Je n'ai pas pu relire") == 0);
    CHECK(none.refusal.find("Laisser l'imprimante choisir l'emplacement") != std::string::npos);
}

TEST_CASE("Slots::decide_map : offer_plain faux ne propose jamais « Démarrer sans carte »")
{
    using namespace Plyo;
    SlotsLogic::DecideOptions opts;
    opts.offer_plain = false;
    opts.unit_name   = "la boîte CFS";
    const json planned = json::array({{{"t", 0}, {"canvas_id", 1}, {"tray_id", 0}, {"label", "1A"}, {"type", "PLA"}, {"preset", ""}}});
    for (const json& canvases : {json(), json::array(), slots_one_unit(1, "1A", 0, "PETG", 2)}) {
        const SlotsLogic::MapDecision d = SlotsLogic::decide_map(planned, canvases, {}, opts);
        CHECK_FALSE(d.refusal.empty());
        CHECK(d.refusal.find("sans carte") == std::string::npos);
        CHECK(d.refusal.find("Le fichier est sur l'imprimante") == std::string::npos); // rien n'est parti sur CFS/IFS
        CHECK(d.map.empty());
    }
    CHECK(SlotsLogic::decide_map(planned, json::array(), {}, opts).refusal.find("sur la boîte CFS") != std::string::npos);
}

TEST_CASE("Slots::decide_map : le libellé vient du plan, puis de la lecture, jamais tray_id + 1 s'il en existe un")
{
    using namespace Plyo;
    const json read = slots_one_unit(1, "1A", 0, "PETG", 2);
    const json with_label    = json::array({{{"t", 0}, {"canvas_id", 1}, {"tray_id", 0}, {"label", "1A"}, {"type", "PLA"}, {"preset", ""}}});
    const json without_label = json::array({{{"t", 0}, {"canvas_id", 1}, {"tray_id", 0}, {"type", "PLA"}, {"preset", ""}}});
    CHECK(SlotsLogic::decide_map(with_label, read, {}).refusal.find("L'emplacement 1A contient") == 0);
    CHECK(SlotsLogic::decide_map(without_label, read, {}).refusal.find("L'emplacement 1A contient") == 0);
    CHECK(SlotsLogic::decide_map(with_label, json::array(), {}).refusal.find("L'emplacement 1A n'est plus") == 0);
    // Une lecture IFS : tray_id 2 s'affiche « 2 », pas « 3 ».
    const json ifs = json::array({{{"t", 0}, {"canvas_id", 0}, {"tray_id", 2}, {"type", "PLA"}, {"preset", ""}}});
    CHECK(SlotsLogic::decide_map(ifs, slots_one_unit(0, "2", 2, "PETG", 2), {}).refusal.find("L'emplacement 2 contient") == 0);
}

TEST_CASE("Slots::decide_map : emplacement vide refusé seulement avec empty_blocks")
{
    using namespace Plyo;
    const json planned = json::array({{{"t", 0}, {"canvas_id", 1}, {"tray_id", 0}, {"type", ""}, {"preset", ""}}});
    SlotsLogic::DecideOptions opts;
    opts.empty_blocks = true;
    opts.offer_plain  = false;
    const SlotsLogic::MapDecision blocked = SlotsLogic::decide_map(planned, slots_one_unit(1, "1A", 0, "", 0), {}, opts);
    CHECK(blocked.refusal.find("L'emplacement 1A est vide") == 0);
    CHECK(blocked.map.empty());
    CHECK(SlotsLogic::decide_map(planned, slots_one_unit(1, "1A", 0, "", 2), {}, opts).map.size() == 1);
    // La CC2 garde sa règle : son `status` n'est pas fiable.
    CHECK(SlotsLogic::decide_map(planned, slots_one_unit(1, "1A", 0, "", 0), {}).map.size() == 1);
}

// Choix du traducteur : le tableau du point 5 du plan. Comparaison exacte du modèle.
namespace {
Plyo::SlotsLogic::PrinterFacts facts(const std::string& model, const std::string& host_type, const std::string& agent = "", bool host = true, bool serial = false, bool code = false)
{
    Plyo::SlotsLogic::PrinterFacts f;
    f.printer_model = model;
    f.host_type     = host_type;
    f.printer_agent = agent;
    f.has_host      = host;
    f.has_ff_serial = serial;
    f.has_code      = code;
    return f;
}
} // namespace

TEST_CASE("Slots::detect : Centauri Carbon 2, règle existante")
{
    using namespace Plyo::SlotsLogic;
    CHECK(detect(facts("Elegoo Centauri Carbon 2", "elegoolink")).kind == "canvas");
    CHECK(detect(facts("Elegoo Centauri Carbon 2", "elegoolink")).imposable);
    CHECK(detect(facts("Elegoo Centauri Carbon 2", "elegoolink", "", false)).kind == "none");
    CHECK(detect(facts("Elegoo Centauri Carbon", "elegoolink")).kind == "none");
}

TEST_CASE("Slots::detect : CFS imposable seulement sur la liste blanche, comparaison exacte")
{
    using namespace Plyo::SlotsLogic;
    for (const char* model : {"Creality K2", "Creality K2 Plus"}) {
        const Detection d = detect(facts(model, "crealityprint", "crealityprint"));
        CHECK(d.kind == "cfs");
        CHECK(d.imposable);
    }
    for (const char* model : {"Creality K2 Pro", "Creality K2 SE", "Creality K1C", "Creality Hi", "Creality K1", ""}) {
        const Detection d = detect(facts(model, "crealityprint", "crealityprint"));
        CHECK(d.kind == "cfs");
        CHECK_FALSE(d.imposable);
    }
    // printer_agent seul ne suffit pas : c'est host_type qui décide de la classe qui enverra.
    CHECK(detect(facts("Creality K2", "octoprint", "crealityprint")).kind == "none");
    CHECK(detect(facts("Creality K2", "crealityprint", "", false)).kind == "none");
}

TEST_CASE("Slots::detect : IFS imposable seulement sur une AD5X complète")
{
    using namespace Plyo::SlotsLogic;
    const Detection full = detect(facts("Flashforge AD5X", "flashforge", "", true, true, true));
    CHECK(full.kind == "ifs");
    CHECK(full.imposable);
    for (const auto& [serial, code] : std::vector<std::pair<bool, bool>>{{false, true}, {true, false}, {false, false}}) {
        const Detection d = detect(facts("Flashforge AD5X", "flashforge", "", true, serial, code));
        CHECK(d.kind == "none");
        CHECK_FALSE(d.imposable);
        CHECK(d.reason == "link_incomplete");
    }
    const Detection other = detect(facts("Flashforge Adventurer 5M Pro", "flashforge", "", true, true, true));
    CHECK(other.kind == "ifs");
    CHECK_FALSE(other.imposable);
    CHECK(detect(facts("Flashforge Adventurer 5M Pro", "flashforge")).kind == "none");
    CHECK(detect(facts("Flashforge Adventurer 5M Pro", "flashforge")).reason.empty());
    // Le profil système AD5X est en octoprint : la détection lit le vrai host_type.
    CHECK(detect(facts("Flashforge AD5X", "octoprint", "", true, true, true)).kind == "none");
    CHECK(detect(facts("Flashforge AD5X", "flashforge", "", false, true, true)).kind == "none");
}

TEST_CASE("Slots::detect : U1 jamais imposable ; le reste sans traducteur")
{
    using namespace Plyo::SlotsLogic;
    PrinterFacts u1 = facts("Snapmaker U1", "octoprint", "snapmaker");
    CHECK(detect(u1).kind == "u1");
    CHECK_FALSE(detect(u1).imposable);
    u1.nozzles = {0.4, 0.6};
    CHECK(detect(u1).kind == "u1");
    CHECK_FALSE(detect(u1).imposable);
    CHECK(detect(facts("Snapmaker U1", "octoprint", "moonraker")).kind == "none");
    CHECK(detect(facts("Snapmaker U1", "octoprint", "snapmaker", false)).kind == "none");
    CHECK(detect(facts("Voron 2.4", "moonraker", "moonraker")).kind == "none");
    CHECK_FALSE(detect(facts("Voron 2.4", "moonraker", "moonraker")).imposable);
    CHECK(detect(facts("", "")).kind == "none");
}

// --- CFS (Creality) : lecture. Fixture tirée uniquement du schéma commenté de CrealityPrintAgent.cpp (parse_cfs_response) et de
// CrealityPrintHostSendDialog::init : ce n'est PAS une réponse de machine, à remplacer par la capture de T9. ---
namespace {
const char* const CFS_ORCA_SCHEMA = R"({"boxsInfo":{"materialBoxs":[
  {"id":0,"state":1,"type":1,"materials":[{"id":0,"state":1,"vendor":"marque-a","type":"PLA","name":"nom-a","color":"#0112233"}]},
  {"id":1,"state":1,"type":0,"materials":[
    {"id":0,"state":1,"vendor":"marque-b","type":"PLA","name":"nom-b","color":"#0AABBCC"},
    {"id":1,"state":2,"vendor":"marque-c","type":"PETG","name":"nom-c","color":"#0DDEEFF"},
    {"id":2,"state":0,"vendor":"","type":"","name":"","color":"#0000000"},
    {"id":3,"state":1,"vendor":"","type":"","name":"","color":"#0FFFFFF"}]}]}})";
json cfs_schema_with(const json& boxes) { return json{{"boxsInfo", {{"materialBoxs", boxes}}}}; }
} // namespace

TEST_CASE("Cfs::parse_boxes : garde l'id brut de la boîte et lit le format d'Orca")
{
    using namespace Plyo::CfsLogic;
    const json p = parse_boxes(CFS_ORCA_SCHEMA);
    REQUIRE(p["ok"].get<bool>());
    CHECK(p["box_count"].get<int>() == 1);
    CHECK(p["anomaly"].get<std::string>().empty());
    const json& units = p["canvases"];
    REQUIRE(units.size() == 2);
    CHECK(units[0]["canvas_id"] == 0);
    CHECK(units[0]["box_type"] == 1);
    CHECK(units[0]["connected"] == true);
    CHECK(units[0]["trays"][0]["label"] == "Ext");
    CHECK(units[1]["canvas_id"] == 1); // jamais renuméroté à 0 : start_print prendrait la boîte pour le porte-bobine
    CHECK(units[1]["box_type"] == 0);
    const json& trays = units[1]["trays"];
    REQUIRE(trays.size() == 4);
    CHECK(trays[0]["tray_id"] == 0);
    CHECK(trays[0]["label"] == "1A");
    CHECK(trays[1]["label"] == "1B");
    CHECK(trays[3]["label"] == "1D");
    CHECK(trays[0]["color"] == "#AABBCC"); // #0RRGGBB → #RRGGBB
    CHECK(trays[0]["type"] == "PLA");
    CHECK(trays[0]["brand"] == "marque-b");
    CHECK(trays[0]["name"] == "nom-b");
    CHECK(trays[0]["status"] == 2);
    CHECK(trays[1]["status"] == 2); // state 2 : chargé mais non sélectionné (K2 Plus)
    CHECK(trays[2]["status"] == 0); // state 0
    CHECK(trays[3]["status"] == 0); // ni marque ni type : vide quel que soit state
}

TEST_CASE("Cfs::parse_boxes : boîte inactive déconnectée, champs absents neutres, jamais d'exception")
{
    using namespace Plyo::CfsLogic;
    const json inactive = parse_boxes(cfs_schema_with(json::array({{{"id", 2}, {"state", 0}, {"type", 0}, {"materials", json::array()}}})).dump());
    CHECK(inactive["canvases"][0]["connected"] == false);
    CHECK(inactive["box_count"] == 0);
    for (const char* bad : {"", "{", "null", "[]", "{\"boxsInfo\":3}", "{\"boxsInfo\":{\"materialBoxs\":{}}}"}) {
        const json p = parse_boxes(bad);
        CHECK_FALSE(p["ok"].get<bool>());
        CHECK(p["canvases"].empty());
    }
    // Couleur d'une autre forme : vide, pas devinée ; champs absents : neutres, emplacement vide.
    const json odd = parse_boxes(cfs_schema_with(json::array({{{"id", 1}, {"state", 1}, {"type", 0},
        {"materials", json::array({{{"id", 0}, {"state", 1}, {"vendor", "m"}, {"type", "PLA"}, {"color", "#FF112233"}}, {{"id", 1}}})}}})).dump());
    CHECK(odd["canvases"][0]["trays"][0]["color"] == "");
    CHECK(odd["canvases"][0]["trays"][1]["status"] == 0);
    CHECK(odd["canvases"][0]["trays"][1]["type"] == "");
    // Identifiants inattendus : l'entrée est écartée et le contrôle vivant saura qu'il y a une anomalie.
    for (const json& box : {json{{"state", 1}, {"type", 0}}, json{{"id", "1"}, {"state", 1}, {"type", 0}}, json{{"id", 1}, {"state", 1}, {"type", 7}},
                            json{{"id", 1}, {"state", 1}}, json{{"id", 1}, {"state", 1}, {"type", 0}, {"materials", json::array({{{"id", 26}}})}},
                            json{{"id", 1}, {"state", 1}, {"type", 0}, {"materials", json::array({{{"id", -1}}})}}})
        CHECK_FALSE(parse_boxes(cfs_schema_with(json::array({box})).dump())["anomaly"].get<std::string>().empty());
}

TEST_CASE("Cfs::live_imposable : tout écart baisse vers « lire sans imposer »")
{
    using namespace Plyo::CfsLogic;
    const json good = parse_boxes(CFS_ORCA_SCHEMA);
    CHECK(live_imposable("K2", "Creality K2", good));
    CHECK(live_imposable("K2 Plus", "Creality K2 Plus", good));
    CHECK(live_blocker("K2", "Creality K2", good).empty());
    // Modèle vivant
    for (const char* live : {"K2 Pro", "K1C", "unreachable", "unknown (F999)", ""})
        CHECK_FALSE(live_imposable(live, "Creality K2", good));
    // Modèle vivant incohérent avec le profil
    CHECK_FALSE(live_imposable("K2 Plus", "Creality K2", good));
    CHECK_FALSE(live_imposable("K2", "Creality K2 Plus", good));
    CHECK_FALSE(live_imposable("K2", "Creality K2 Pro", good));
    // Illisible
    CHECK_FALSE(live_imposable("K2", "Creality K2", parse_boxes("{")));
    const json holder = {{"id", 0}, {"state", 1}, {"type", 1}, {"materials", json::array()}};
    const json box1   = {{"id", 1}, {"state", 1}, {"type", 0}, {"materials", json::array()}};
    const json box2   = {{"id", 2}, {"state", 1}, {"type", 0}, {"materials", json::array()}};
    const auto with   = [](const json& boxes) { return parse_boxes(cfs_schema_with(boxes).dump()); };
    CHECK(live_imposable("K2", "Creality K2", with(json::array({holder, box1}))));
    // Une seule boîte active, inactive tolérée
    CHECK(live_imposable("K2", "Creality K2", with(json::array({holder, box1, {{"id", 2}, {"state", 0}, {"type", 0}}}))));
    // Deux boîtes, aucune boîte
    CHECK_FALSE(live_imposable("K2", "Creality K2", with(json::array({holder, box1, box2}))));
    CHECK_FALSE(live_imposable("K2", "Creality K2", with(json::array({holder}))));
    // Porte-bobine absent, ou pas en 0 ; boîte CFS en id 0 (start_print la prendrait pour le porte-bobine)
    CHECK_FALSE(live_imposable("K2", "Creality K2", with(json::array({box1}))));
    CHECK_FALSE(live_imposable("K2", "Creality K2", with(json::array({{{"id", 3}, {"state", 1}, {"type", 1}}, box1}))));
    CHECK_FALSE(live_imposable("K2", "Creality K2", with(json::array({{{"id", 0}, {"state", 1}, {"type", 0}}}))));
    CHECK_FALSE(live_imposable("K2", "Creality K2", with(json::array({holder, {{"id", 0}, {"state", 1}, {"type", 0}}}))));
    // Anomalie de lecture
    CHECK_FALSE(live_imposable("K2", "Creality K2", with(json::array({holder, box1, {{"id", 9}, {"state", 1}, {"type", 7}}}))));
}

// CFS : carte vers extended_info, format de CrealityPrintHostSendDialog::extendedInfo.
TEST_CASE("Cfs::color_match_info : T0 seul, T0+T1, id brut de la boîte")
{
    using namespace Plyo::CfsLogic;
    const json canvases = parse_boxes(CFS_ORCA_SCHEMA)["canvases"];
    std::string refusal;
    auto one = color_match_info(json::array({{{"t", 0}, {"canvas_id", 1}, {"tray_id", 1}}}), canvases, 1, false, refusal);
    CHECK(refusal.empty());
    REQUIRE(one.size() == 2);
    CHECK(one["colorMatch_0"] == "T1A\tPETG\t#DDEEFF\t1\t1");
    CHECK(one["enableSelfTest"] == "0");
    auto two = color_match_info(json::array({{{"t", 1}, {"canvas_id", 1}, {"tray_id", 0}}, {{"t", 0}, {"canvas_id", 1}, {"tray_id", 1}}}), canvases, 2, true, refusal);
    CHECK(refusal.empty());
    CHECK(two["colorMatch_0"] == "T1A\tPETG\t#DDEEFF\t1\t1");
    CHECK(two["colorMatch_1"] == "T1B\tPLA\t#AABBCC\t1\t0");
    CHECK(two["enableSelfTest"] == "1");
}

TEST_CASE("Cfs::color_match_info : jamais de trou dans colorMatch_i (start_print s'arrête au premier absent)")
{
    using namespace Plyo::CfsLogic;
    const json canvases = parse_boxes(CFS_ORCA_SCHEMA)["canvases"];
    std::string refusal;
    auto info = color_match_info(json::array({{{"t", 0}, {"canvas_id", 1}, {"tray_id", 1}}, {{"t", 2}, {"canvas_id", 1}, {"tray_id", 0}}}), canvases, 3, false, refusal);
    CHECK(refusal.empty());
    CHECK(info["colorMatch_0"] == "T1A\tPETG\t#DDEEFF\t1\t1");
    CHECK(info["colorMatch_1"] == "T1B\tPETG\t#DDEEFF\t1\t1"); // inutilisée : même emplacement que la première entrée (décision ouverte 3)
    CHECK(info["colorMatch_2"] == "T1C\tPLA\t#AABBCC\t1\t0");
}

TEST_CASE("Cfs::color_match_info : le porte-bobine seul passe, mêlé à autre chose il est refusé")
{
    using namespace Plyo::CfsLogic;
    const json canvases = parse_boxes(CFS_ORCA_SCHEMA)["canvases"];
    std::string refusal;
    auto alone = color_match_info(json::array({{{"t", 0}, {"canvas_id", 0}, {"tray_id", 0}}}), canvases, 2, false, refusal);
    CHECK(refusal.empty());
    CHECK(alone["colorMatch_0"] == "T1A\tPLA\t#112233\t0\t0");
    CHECK(alone["colorMatch_1"] == "T1B\tPLA\t#112233\t0\t0");
    auto mixed = color_match_info(json::array({{{"t", 0}, {"canvas_id", 0}, {"tray_id", 0}}, {{"t", 1}, {"canvas_id", 1}, {"tray_id", 0}}}), canvases, 2, false, refusal);
    CHECK_FALSE(refusal.empty());
    CHECK(mixed.empty());
}

TEST_CASE("Cfs::color_match_info : tout doute est un refus, sans rien rendre")
{
    using namespace Plyo::CfsLogic;
    const json canvases = parse_boxes(CFS_ORCA_SCHEMA)["canvases"];
    const json t0_ok    = json::array({{{"t", 0}, {"canvas_id", 1}, {"tray_id", 0}}});
    std::string refusal;
    const auto refused = [&](const json& map, const json& units, int count) {
        refusal.clear();
        auto info = color_match_info(map, units, count, false, refusal);
        return !refusal.empty() && info.empty();
    };
    CHECK(refused(json::array(), canvases, 1));                                        // carte vide
    CHECK(refused(t0_ok, canvases, 0));                                                 // aucun filament
    CHECK(refused(t0_ok, canvases, 27));                                                // plus de 26 : T1[ n'existe pas
    CHECK(refused(json::array({{{"t", 1}, {"canvas_id", 1}, {"tray_id", 0}}}), canvases, 1));  // couleur hors du projet
    CHECK(refused(json::array({{{"t", 0}, {"canvas_id", 1}, {"tray_id", 9}}}), canvases, 1));  // emplacement absent de la lecture
    CHECK(refused(json::array({{{"t", 0}, {"canvas_id", 5}, {"tray_id", 0}}}), canvases, 1));  // boîte absente de la lecture
    CHECK(refused(json::array({{{"t", 0}, {"canvas_id", 1}, {"tray_id", 2}}}), canvases, 1));  // type vide
    CHECK(refused(json::array({{{"t", 0}, {"canvas_id", 1}, {"tray_id", 0}}, {{"t", 1}, {"canvas_id", 1}, {"tray_id", 0}}}), canvases, 2)); // deux couleurs, un emplacement
    const auto unit = [](int id, int type, const json& tray) {
        return json::array({{{"canvas_id", id}, {"box_type", type}, {"connected", true}, {"trays", json::array({tray})}}});
    };
    const json ok_tray  = {{"tray_id", 0}, {"type", "PLA"}, {"color", "#112233"}, {"status", 2}};
    CHECK_FALSE(refused(t0_ok, unit(1, 0, ok_tray), 1));
    CHECK(refused(json::array({{{"t", 0}, {"canvas_id", 0}, {"tray_id", 0}}}), unit(0, 0, ok_tray), 1)); // canvas_id 0 qui n'est pas le porte-bobine
    json tab_type = ok_tray, tab_color = ok_tray, no_color = ok_tray, no_status = ok_tray;
    tab_type["type"]   = "PL\tA";
    tab_color["color"] = "#11\t33";
    no_color["color"]  = "";
    no_status["status"] = 0;
    CHECK(refused(t0_ok, unit(1, 0, tab_type), 1));
    CHECK(refused(t0_ok, unit(1, 0, tab_color), 1));
    CHECK(refused(t0_ok, unit(1, 0, no_color), 1));
    CHECK(refused(t0_ok, unit(1, 0, no_status), 1));
    json off = unit(1, 0, ok_tray);
    off[0]["connected"] = false;
    CHECK(refused(t0_ok, off, 1));
}

// --- IFS (Flashforge AD5X) : schéma de Flashforge::parse_material_slots et de FlashforgePrintHostSendDialog::extendedInfo. Ce n'est PAS
// une réponse de machine, à remplacer par la capture de T9. ---
namespace {
std::vector<Plyo::IfsLogic::Slot> ifs_orca_schema()
{
    using Plyo::IfsLogic::Slot;
    return {Slot{1, true, "PLA", "#AABBCC"}, Slot{2, true, "PETG", "#ddeeff"}, Slot{3, false, "", ""}, Slot{4, true, "PLA-CF", "bizarre"}};
}
} // namespace

TEST_CASE("Ifs::canvases_from_slots : une unité, numéro et libellé à partir de 1")
{
    using namespace Plyo::IfsLogic;
    const json units = canvases_from_slots(ifs_orca_schema());
    REQUIRE(units.size() == 1);
    CHECK(units[0]["canvas_id"] == 0);
    CHECK(units[0]["connected"] == true);
    const json& trays = units[0]["trays"];
    REQUIRE(trays.size() == 4);
    CHECK(trays[1]["tray_id"] == 2);
    CHECK(trays[1]["label"] == "2"); // jamais « 3 »
    CHECK(trays[1]["type"] == "PETG");
    CHECK(trays[1]["color"] == "#DDEEFF");
    CHECK(trays[1]["raw_color"] == "#ddeeff");
    CHECK(trays[1]["status"] == 2);
    CHECK(trays[2]["status"] == 0);
    CHECK(trays[3]["color"] == "");
    CHECK(trays[3]["raw_color"] == "bizarre");
    CHECK(canvases_from_slots({}).empty());
    // Numéro impossible : écarté.
    CHECK(canvases_from_slots({Slot{0, true, "PLA", "#AABBCC"}}).empty());
}

TEST_CASE("Ifs::live_imposable : poste de matière annoncé, numéros valables, sinon on lit sans imposer")
{
    using namespace Plyo::IfsLogic;
    CHECK(live_imposable(true, ifs_orca_schema()));
    CHECK_FALSE(live_imposable(false, ifs_orca_schema()));
    CHECK_FALSE(live_imposable(true, {}));
    CHECK_FALSE(live_imposable(true, {Slot{0, true, "PLA", "#AABBCC"}}));
    CHECK_FALSE(live_imposable(true, {Slot{1, true, "PLA", "#AABBCC"}, Slot{1, true, "PETG", "#AABBCC"}}));
    CHECK_FALSE(live_imposable(true, {Slot{-1, true, "PLA", "#AABBCC"}}));
}

TEST_CASE("Ifs::mapping_info : slotId à partir de 1, toolId à partir de 0, trous conservés")
{
    using namespace Plyo::IfsLogic;
    const json canvases = canvases_from_slots(ifs_orca_schema());
    const json tools    = json::array({{{"t", 0}, {"color", "#111111"}, {"type", "PLA"}}, {{"t", 2}, {"color", "#222222"}, {"type", "PETG"}}});
    std::string refusal;
    auto info = mapping_info(json::array({{{"t", 2}, {"canvas_id", 0}, {"tray_id", 2}}, {{"t", 0}, {"canvas_id", 0}, {"tray_id", 1}}}), canvases, tools, true, false, refusal);
    CHECK(refusal.empty());
    CHECK(info["levelingBeforePrint"] == "1");
    CHECK(info["timeLapseVideo"] == "0");
    CHECK(info["useMatlStation"] == "1");
    CHECK(info["gcodeToolCnt"] == "2");
    const json m = json::parse(info["materialMappings"]); // du JSON : upload_local_api fait lui-même le base64
    REQUIRE(m.size() == 2);
    CHECK(m[0] == json{{"toolId", 0}, {"slotId", 1}, {"materialName", "PLA"}, {"toolMaterialColor", "#111111"}, {"slotMaterialColor", "#AABBCC"}});
    CHECK(m[1] == json{{"toolId", 2}, {"slotId", 2}, {"materialName", "PETG"}, {"toolMaterialColor", "#222222"}, {"slotMaterialColor", "#ddeeff"}});
}

TEST_CASE("Ifs::mapping_info : tout doute est un refus, sans rien rendre")
{
    using namespace Plyo::IfsLogic;
    const json canvases = canvases_from_slots(ifs_orca_schema());
    std::string refusal;
    const auto refused = [&](const json& map, const json& tools) {
        refusal.clear();
        auto info = mapping_info(map, canvases, tools, true, false, refusal);
        return !refusal.empty() && info.empty();
    };
    const auto tool = [](int t, const std::string& type) { return json{{"t", t}, {"color", "#111111"}, {"type", type}}; };
    const auto to   = [](int t, int slot) { return json{{"t", t}, {"canvas_id", 0}, {"tray_id", slot}}; };
    CHECK_FALSE(refused(json::array({to(0, 1)}), json::array({tool(0, "PLA")})));
    CHECK(refused(json::array(), json::array({tool(0, "PLA")})));                                    // carte vide
    CHECK(refused(json::array({to(0, 3)}), json::array({tool(0, "PLA")})));                          // emplacement vide
    CHECK(refused(json::array({to(0, 9)}), json::array({tool(0, "PLA")})));                          // absent de la lecture
    CHECK(refused(json::array({to(0, 2)}), json::array({tool(0, "PLA")})));                          // PLA sur PETG
    CHECK(refused(json::array({to(0, 4)}), json::array({tool(0, "PLA")})));                          // découpé en PLA, chargé en PLA-CF
    CHECK(refused(json::array({to(1, 1)}), json::array({tool(0, "PLA")})));                          // couleur hors de la pièce
    CHECK(refused(json::array({to(0, 1), to(1, 1)}), json::array({tool(0, "PLA"), tool(1, "PLA")}))); // même emplacement deux fois
    CHECK(refused(json::array({to(0, 1)}), json::array({{{"t", 0}, {"color", ""}, {"type", "PLA"}}}))); // couleur inconnue
    CHECK(refused(json::array({to(0, 1)}), json::array({{{"t", 0}, {"color", "#111111"}, {"type", ""}}}))); // type inconnu
    CHECK(refused(json::array({to(0, 1), to(0, 2)}), json::array({tool(0, "PLA")})));                // doublon de couleur
}

TEST_CASE("Ifs::same_material : majuscules, seulement lettres et chiffres")
{
    using namespace Plyo::IfsLogic;
    CHECK(same_material("pla", "PLA"));
    CHECK(same_material("PLA-CF", "pla cf"));
    CHECK_FALSE(same_material("PLA-CF", "PLA"));
    CHECK_FALSE(same_material("ASA", "ABS")); // Orca les confond ; ici le doute est un refus
    CHECK_FALSE(same_material("", ""));
    CHECK_FALSE(same_material("---", "---"));
}

// --- AD5X : liaison complète. La série reste côté C++ : jamais dans ce qui part au panneau. ---
TEST_CASE("Discovery : valid_serial, seulement lettres et chiffres, 64 au plus")
{
    using namespace Plyo::Discovery;
    CHECK(valid_serial("SNADVA5MX1234"));
    CHECK(valid_serial(std::string(64, 'a')));
    CHECK_FALSE(valid_serial(""));
    CHECK_FALSE(valid_serial(std::string(65, 'a')));
    CHECK_FALSE(valid_serial("abc 123"));
    CHECK_FALSE(valid_serial("abc\";rm"));
    CHECK_FALSE(valid_serial("é"));
}

TEST_CASE("Discovery : la série survit à la fusion mais ne part jamais au panneau")
{
    using namespace Plyo::Discovery;
    Printer ff;
    ff.ip = "192.168.1.9"; ff.name = "AD5X"; ff.brand = "Flashforge"; ff.host_type = "flashforge"; ff.host = "192.168.1.9"; ff.priority = 3;
    ff.serial = "SERIALSECRET1";
    Printer weak = ff;
    weak.priority = 1; weak.serial = ""; weak.host_type = "moonraker";
    CHECK(merge({weak, ff}).front().serial == "SERIALSECRET1");
    CHECK(merge({ff, weak}).front().serial == "SERIALSECRET1");
    Printer strong = ff;
    strong.priority = 5; strong.serial = "";
    CHECK(merge({ff, strong}).front().serial == "SERIALSECRET1");
    CHECK(merge({strong, ff}).front().serial == "SERIALSECRET1");
    const std::string sent = to_json({ff}).dump();
    CHECK(sent.find("SERIALSECRET1") == std::string::npos);
    CHECK(sent.find("serial") == std::string::npos);
}

TEST_CASE("Slots::link_needs_code : une AD5X avec série demande son code avant le test, sans changer les autres machines")
{
    using namespace Plyo::SlotsLogic;
    CHECK(link_needs_code("flashforge", "Flashforge AD5X", true, false));
    CHECK_FALSE(link_needs_code("flashforge", "Flashforge AD5X", true, true));
    CHECK_FALSE(link_needs_code("flashforge", "Flashforge AD5X", false, false)); // sans série, pas de chemin local : link_incomplete ensuite
    CHECK_FALSE(link_needs_code("flashforge", "Flashforge Adventurer 5M Pro", true, false));
    CHECK_FALSE(link_needs_code("elegoolink", "Flashforge AD5X", true, false));
}

TEST_CASE("Slots::state_fields : ce que le panneau sait d'une lecture, sans faire croire à une validation")
{
    using namespace Plyo::SlotsLogic;
    const json cc2 = state_fields("canvas", true);
    CHECK(cc2["system"] == "canvas");
    CHECK(cc2["source"] == "printer");
    CHECK(cc2["imposable"] == true);
    CHECK(cc2["empty_blocks"] == false);
    CHECK(cc2["start_plain"] == true);
    CHECK(cc2["validated"] == true);
    for (const char* kind : {"cfs", "ifs", "u1"}) {
        const json f = state_fields(kind, true);
        CHECK(f["empty_blocks"] == EMPTY_SLOT_BLOCKS);
        CHECK(f["start_plain"] == false);
        CHECK(f["validated"] == false); // T9, T13, T14, T15, T17 : rien n'est validé tant qu'ils ne sont pas faits
    }
    CHECK(state_fields("cfs", true)["imposable"] == true);
    CHECK(state_fields("cfs", false)["imposable"] == false);
    CHECK(state_fields("u1", true)["imposable"] == false); // la U1 n'impose jamais
    CHECK(state_fields("none", true)["imposable"] == false);
    CHECK(state_fields("bizarre", true)["imposable"] == false);
}

TEST_CASE("Slots::decide_options : la CC2 garde ses textes, les autres ne proposent pas de départ sans carte")
{
    using namespace Plyo::SlotsLogic;
    const DecideOptions cc2 = decide_options("canvas");
    CHECK(cc2.unit_name == "le Canvas");
    CHECK(cc2.offer_plain);
    CHECK_FALSE(cc2.empty_blocks);
    for (const char* kind : {"cfs", "ifs"}) {
        const DecideOptions o = decide_options(kind);
        CHECK_FALSE(o.offer_plain);
        CHECK(o.empty_blocks == EMPTY_SLOT_BLOCKS);
    }
    CHECK(decide_options("cfs").unit_name == "la boîte CFS");
    CHECK(decide_options("ifs").unit_name == "l'IFS");
}

// --- Envoi armé CFS/IFS : contrôles purs avant d'armer ---
TEST_CASE("Slots::used_refusal : le plan, les réglages et la découpe doivent dire la même chose")
{
    using namespace Plyo::SlotsLogic;
    using V = std::vector<int>;
    CHECK(used_refusal(V{0}, V{0}, V{0}, V{0}).empty());
    CHECK(used_refusal(V{0, 2}, V{2, 0}, V{0, 2}, V{2, 0}).empty()); // l'ordre ne compte pas
    CHECK_FALSE(used_refusal(V{}, V{}, V{}, V{}).empty());           // rien de connu : refus
    CHECK_FALSE(used_refusal(V{0}, V{0}, V{}, V{0}).empty());        // découpe sans statistiques : refus
    CHECK_FALSE(used_refusal(V{0}, V{0}, V{0, 1}, V{0}).empty());    // la découpe utilise un filament absent du plan (support, tour)
    CHECK_FALSE(used_refusal(V{0, 1}, V{0, 1}, V{0}, V{0, 1}).empty()); // le réglage prévoit un filament que la découpe n'utilise pas
    CHECK_FALSE(used_refusal(V{0}, V{0}, V{0}, V{1}).empty());       // le plan vise une autre couleur
    if (REFUSE_CURSOR_FILAMENT_CHANGES)
        CHECK_FALSE(used_refusal(V{0}, V{0, 1}, V{0, 1}, V{0, 1}).empty()); // changement posé au curseur : non essayé sur CFS/IFS
    else
        CHECK(used_refusal(V{0}, V{0, 1}, V{0, 1}, V{0, 1}).empty());
}

TEST_CASE("Slots::plan_allowed : un plan CFS/IFS demande une vraie lecture imposable de cette imprimante")
{
    using namespace Plyo::SlotsLogic;
    Detection yes;
    yes.kind      = "cfs";
    yes.imposable = true;
    const json read = {{"host", "192.168.1.5"}, {"ok", true}, {"imposable", true}, {"source", "printer"}};
    CHECK(plan_allowed(yes, read, "192.168.1.5"));
    CHECK_FALSE(plan_allowed(yes, read, "192.168.1.6"));
    CHECK_FALSE(plan_allowed(yes, read, ""));
    CHECK_FALSE(plan_allowed(yes, json(), "192.168.1.5"));
    json bad = read;
    bad["ok"] = false;
    CHECK_FALSE(plan_allowed(yes, bad, "192.168.1.5"));
    bad = read;
    bad["imposable"] = false;
    CHECK_FALSE(plan_allowed(yes, bad, "192.168.1.5"));
    bad = read;
    bad["source"] = "manual"; // une saisie manuelle n'est jamais envoyée comme répartition
    CHECK_FALSE(plan_allowed(yes, bad, "192.168.1.5"));
    Detection no = yes;
    no.imposable = false;
    CHECK_FALSE(plan_allowed(no, read, "192.168.1.5"));
    for (const char* kind : {"u1", "none", "canvas", ""}) {
        Detection other;
        other.kind      = kind;
        other.imposable = true;
        CHECK_FALSE(plan_allowed(other, read, "192.168.1.5"));
    }
}

TEST_CASE("Slots::clean_send_map : carte CFS/IFS complète ou rien")
{
    using namespace Plyo::SlotsLogic;
    const json entry = {{"t", 0}, {"canvas_id", 1}, {"tray_id", 0}, {"label", "1A"}, {"type", "PLA"}, {"preset", "P"}, {"autre", 3}};
    const json clean = clean_send_map(json::array({entry}));
    REQUIRE(clean.size() == 1);
    CHECK(clean[0] == json{{"t", 0}, {"canvas_id", 1}, {"tray_id", 0}, {"label", "1A"}, {"type", "PLA"}, {"preset", "P"}});
    CHECK(clean_send_map(json()).empty());
    CHECK(clean_send_map(json::array()).empty());
    for (const char* key : {"t", "canvas_id", "tray_id", "type", "preset"}) {
        json missing = entry;
        missing.erase(key);
        CHECK(clean_send_map(json::array({entry, missing})).empty());
    }
    json text_t = entry;
    text_t["t"] = "0";
    CHECK(clean_send_map(json::array({text_t})).empty());
}

TEST_CASE("Slots::profile_refusal : l'envoi part avec le profil édité, il doit être celui du plan")
{
    using namespace Plyo::SlotsLogic;
    const json plan = {{"host", "192.168.1.5"}, {"kind", "ifs"}, {"host_type", "flashforge"}, {"model", "Flashforge AD5X"}};
    Detection good;
    good.kind      = "ifs";
    good.imposable = true;
    CHECK(profile_refusal(plan, good, "192.168.1.5", "flashforge", "Flashforge AD5X").empty());
    CHECK_FALSE(profile_refusal(plan, good, "192.168.1.6", "flashforge", "Flashforge AD5X").empty());
    CHECK_FALSE(profile_refusal(plan, good, "192.168.1.5", "octoprint", "Flashforge AD5X").empty());
    CHECK_FALSE(profile_refusal(plan, good, "192.168.1.5", "flashforge", "Flashforge 5M").empty());
    // Série effacée sur le profil édité : link_incomplete, plus de kind ifs.
    Detection incomplete;
    incomplete.reason = "link_incomplete";
    CHECK_FALSE(profile_refusal(plan, incomplete, "192.168.1.5", "flashforge", "Flashforge AD5X").empty());
    Detection not_imposable = good;
    not_imposable.imposable = false;
    CHECK_FALSE(profile_refusal(plan, not_imposable, "192.168.1.5", "flashforge", "Flashforge AD5X").empty());
    CHECK_FALSE(profile_refusal(json(), good, "192.168.1.5", "flashforge", "Flashforge AD5X").empty());
}

// --- U1 (Snapmaker) : lecture sans imposer. Fixture tirée uniquement de SnapmakerPrinterAgent.cpp (tableaux parallèles de
// print_task_config) : ce n'est PAS une réponse de machine, à remplacer par la capture de T17. ---
namespace {
const char* const U1_ORCA_SCHEMA = R"({"result":{"status":{"print_task_config":{
  "filament_exist":[true,true,false,true],
  "filament_type":["PLA","PETG","","pla"],
  "filament_sub_type":["NONE","CF","","SILK"],
  "filament_color_rgba":["AABBCCFF","112233FF","00000000","bad"],
  "filament_vendor":["marque-a","marque-b","","marque-c"]}}}})";
} // namespace

TEST_CASE("U1::parse_query : têtes numérotées à partir de 1, couleur RRGGBBAA, type vide gardé vide")
{
    using namespace Plyo::U1Logic;
    const json p = parse_query(U1_ORCA_SCHEMA);
    REQUIRE(p["ok"].get<bool>());
    REQUIRE(p["canvases"].size() == 1);
    CHECK(p["canvases"][0]["canvas_id"] == 0);
    CHECK(p["canvases"][0]["connected"] == true);
    const json& t = p["canvases"][0]["trays"];
    REQUIRE(t.size() == 4);
    CHECK(t[0]["tray_id"] == 0);
    CHECK(t[0]["label"] == "1");
    CHECK(t[3]["label"] == "4");
    CHECK(t[0]["type"] == "PLA");
    CHECK(t[0]["color"] == "#AABBCC");
    CHECK(t[0]["brand"] == "marque-a");
    CHECK(t[0]["status"] == 2);
    CHECK(t[1]["type"] == "PETG-CF");
    CHECK(t[2]["status"] == 0);
    CHECK(t[2]["type"] == "");
    CHECK(t[3]["type"] == "PLA"); // en majuscules, sous-type ni CF ni GF ignoré
    CHECK(t[3]["color"] == "");   // couleur d'une autre forme : pas devinée
}

TEST_CASE("U1::parse_query : type vide reste vide (pas de « PLA » par défaut), tableaux inégaux neutres, jamais d'exception")
{
    using namespace Plyo::U1Logic;
    const auto parse = [](const json& cfg) { return parse_query(json{{"result", {{"status", {{"print_task_config", cfg}}}}}}.dump()); };
    const json empty_type = parse({{"filament_exist", {true}}, {"filament_type", {""}}});
    CHECK(empty_type["canvases"][0]["trays"][0]["type"] == "");
    CHECK(empty_type["canvases"][0]["trays"][0]["status"] == 2);
    const json uneven = parse({{"filament_exist", {true, true}}, {"filament_type", {"PLA"}}, {"filament_color_rgba", json::array()}, {"filament_sub_type", 3}, {"filament_vendor", {1, 2}}});
    REQUIRE(uneven["canvases"][0]["trays"].size() == 2);
    CHECK(uneven["canvases"][0]["trays"][0]["type"] == "PLA");
    CHECK(uneven["canvases"][0]["trays"][1]["type"] == "");
    CHECK(uneven["canvases"][0]["trays"][1]["color"] == "");
    CHECK(uneven["canvases"][0]["trays"][0]["brand"] == "");
    for (const char* bad : {"", "{", "[]", "null", "{\"result\":{}}", "{\"result\":{\"status\":{\"print_task_config\":3}}}"})
        CHECK_FALSE(parse_query(bad)["ok"].get<bool>());
    CHECK_FALSE(parse({{"filament_exist", json::array()}})["ok"].get<bool>());
    CHECK_FALSE(parse({{"filament_exist", 3}})["ok"].get<bool>());
    const json odd = parse({{"filament_exist", {1, "oui", true}}});
    CHECK(odd["canvases"][0]["trays"][0]["status"] == 0); // autre chose qu'un booléen : vide
    CHECK(odd["canvases"][0]["trays"][2]["status"] == 2);
}

TEST_CASE("U1::query_url : adresse du profil vers la requête d'Orca")
{
    using namespace Plyo::U1Logic;
    const std::string path = "/printer/objects/query?print_task_config&filament_detect";
    CHECK(query_url("192.168.1.8") == "http://192.168.1.8" + path);
    CHECK(query_url("192.168.1.8:7125/") == "http://192.168.1.8:7125" + path);
    CHECK(query_url("http://u1.local/") == "http://u1.local" + path);
    CHECK(query_url("https://u1.local") == "https://u1.local" + path);
    CHECK(query_url("") == "");
}

// --- Saisie manuelle : jamais imposée ---
TEST_CASE("Slots::sanitize_manual : par préréglage, formes inattendues écartées")
{
    using namespace Plyo::SlotsLogic;
    const std::vector<std::string> known = {"PLA", "PETG"};
    const json in = {{"Ma K2", {{"slots", json::array({{{"type", "PLA"}, {"color", "#aabbcc"}, {"secret", "x"}},
                                                       {{"type", "INCONNU"}, {"color", "bleu"}},
                                                       {{"type", ""}, {"color", ""}},
                                                       "pas un objet"})}}},
                     {"Vide", {{"slots", json::array()}}},
                     {"Autre", 3},
                     {"", {{"slots", json::array({{{"type", "PLA"}, {"color", "#000000"}}})}}}};
    const json out = sanitize_manual(in, known);
    CHECK(out.size() == 1);
    REQUIRE(out.contains("Ma K2"));
    const json& slots = out["Ma K2"]["slots"];
    REQUIRE(slots.size() == 3); // ce qui n'est pas un objet est écarté
    CHECK(slots[0] == json{{"type", "PLA"}, {"color", "#AABBCC"}});
    CHECK(slots[1] == json{{"type", ""}, {"color", ""}}); // type inconnu et couleur d'une autre forme : neutres
    CHECK(slots[2] == json{{"type", ""}, {"color", ""}});
    for (const json& bad : {json(), json(3), json::array(), json("x")})
        CHECK(sanitize_manual(bad, known) == json::object());
    json many_slots = json::array();
    for (int i = 0; i < 40; ++i)
        many_slots.push_back({{"type", "PLA"}, {"color", "#000000"}});
    CHECK(sanitize_manual({{"P", {{"slots", many_slots}}}}, known)["P"]["slots"].size() == 16);
    json many_machines = json::object();
    for (int i = 0; i < 80; ++i)
        many_machines["P" + std::to_string(i)] = {{"slots", json::array({{{"type", "PLA"}, {"color", "#000000"}}})}};
    CHECK(sanitize_manual(many_machines, known).size() == 50);
}

TEST_CASE("Slots::manual_state : format commun, jamais imposable, jamais de départ sans carte")
{
    using namespace Plyo::SlotsLogic;
    const json state = manual_state({{"slots", json::array({{{"type", "PLA"}, {"color", "#000000"}}, {{"type", ""}, {"color", ""}}})}});
    CHECK(state["ok"] == true);
    CHECK(state["source"] == "manual");
    CHECK(state["system"] == "manual");
    CHECK(state["imposable"] == false);
    CHECK(state["start_plain"] == false);
    CHECK(state["validated"] == false);
    const json& t = state["canvases"][0]["trays"];
    REQUIRE(t.size() == 2);
    CHECK(t[0]["tray_id"] == 0);
    CHECK(t[0]["label"] == "1");
    CHECK(t[0]["status"] == 2);
    CHECK(t[1]["label"] == "2");
    CHECK(t[1]["status"] == 0);
    const json none = manual_state(json());
    CHECK(none["ok"] == false);
    CHECK(none["reason"] == "no_manual");
    CHECK(none["source"] == "manual");
    CHECK(none["imposable"] == false);
    // Une lecture manuelle retenue ne permet jamais un plan.
    Detection cfs;
    cfs.kind      = "cfs";
    cfs.imposable = true;
    json last = state;
    last["host"] = "192.168.1.5";
    CHECK_FALSE(plan_allowed(cfs, last, "192.168.1.5"));
}

TEST_CASE("Slots::manual_with : ajoute, remplace, retire, refuse la 51e machine")
{
    using namespace Plyo::SlotsLogic;
    const std::vector<std::string> known = {"PLA"};
    const json slot = json::array({{{"type", "PLA"}, {"color", "#000000"}}});
    bool       ok   = false;
    json       all  = manual_with(json(), "P", slot, known, ok);
    CHECK(ok);
    CHECK(all["P"]["slots"].size() == 1);
    all = manual_with(all, "P", json::array({{{"type", ""}, {"color", ""}}, {{"type", "PLA"}, {"color", "#111111"}}}), known, ok);
    CHECK(ok);
    CHECK(all["P"]["slots"].size() == 2);
    all = manual_with(all, "P", json::array(), known, ok);
    CHECK(ok);
    CHECK_FALSE(all.contains("P"));
    all = manual_with(all, "", slot, known, ok);
    CHECK_FALSE(ok);
    json many = json::object();
    for (int i = 0; i < 50; ++i)
        many["P" + std::to_string(i)] = {{"slots", slot}};
    const json full = manual_with(many, "nouvelle", slot, known, ok);
    CHECK_FALSE(ok);
    CHECK_FALSE(full.contains("nouvelle"));
    CHECK(full.size() == 50);
    manual_with(many, "P3", slot, known, ok);
    CHECK(ok); // une machine déjà là reste modifiable
}

TEST_CASE("Project: sanitize garde « validated » seulement s'il est lisible")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json clean = sanitize({{"canvas", {{{"t", 0}, {"canvas_id", 0}, {"tray_id", 0}, {"validated", false}}, {{"t", 1}, {"canvas_id", 0}, {"tray_id", 1}, {"validated", "oui"}}}}})["canvas"];
    REQUIRE(clean.size() == 2);
    CHECK(clean[0]["validated"] == false);
    CHECK_FALSE(clean[1].contains("validated"));
}

TEST_CASE("Calibration : la tour de température reste dans la plage de la matière")
{
    using Plyo::CalibrationLogic::temperature_tower;
    // Plages de MATERIAL_RANGES (plyo-api/src/lib/whitelist.ts) : {famille, types d'Orca, min, max}.
    struct Family { std::vector<std::string> types; int min, max; };
    const std::vector<Family> families = {
        {{"PLA", "PLA-CF", "PLA-AERO"}, 180, 240},
        {{"PETG"}, 210, 260},
        {{"PETG-CF", "PETG-GF"}, 240, 270},
        {{"PCTG"}, 250, 270},
        {{"ABS", "ABS-CF", "ABS-GF", "ASA", "ASA-CF", "ASA-GF", "ASA-AERO"}, 230, 280},
        {{"PC-ABS"}, 250, 280},
        {{"HIPS"}, 220, 260},
        {{"TPU"}, 200, 245},
        {{"PA", "PA-CF", "PA-GF", "PA6", "PA6-CF", "PA6-GF", "PA11", "PA11-CF", "PA11-GF", "PA12", "PA12-CF", "PA12-GF", "PAHT", "PAHT-CF", "PAHT-GF"}, 240, 300},
        {{"PC", "PC-CF", "PC-PBT"}, 250, 300},
        {{"PET-CF"}, 260, 300},
        {{"PVA"}, 195, 250},
    };
    for (const Family& family : families)
        for (const std::string& type : family.types) {
            // Le profil n'a pas son mot à dire pour un type connu : un profil vide ou faux ne change rien.
            const auto tower = temperature_tower(type, 0, 0, 0);
            INFO(type);
            CHECK(tower.refusal.empty());
            CHECK(tower.start > tower.end);
            CHECK(tower.start <= family.max);
            CHECK(tower.end >= family.min);
            CHECK((tower.start - tower.end) % 5 == 0);
        }
    // Les cas signalés : plus de tour 190–230 sous leur plage.
    CHECK(temperature_tower("PETG-CF", 0, 0, 0).end == 240);
    CHECK(temperature_tower("PCTG", 0, 0, 0).end == 250);
    CHECK(temperature_tower("HIPS", 0, 0, 0).end == 220);
    CHECK(temperature_tower("PC-ABS", 0, 0, 0).end == 250);
    // Les tours d'avant ne changent pas.
    CHECK(temperature_tower("PLA", 0, 0, 0).start == 230);
    CHECK(temperature_tower("PLA", 0, 0, 0).end == 190);
    CHECK(temperature_tower("PETG", 0, 0, 0).start == 260);
    CHECK(temperature_tower("ABS", 0, 0, 0).end == 230);
    CHECK(temperature_tower("PA", 0, 0, 0).start == 290);
    CHECK(temperature_tower("PC", 0, 0, 0).start == 300);
    CHECK(temperature_tower("TPU", 0, 0, 0).end == 200);
    // Écriture en minuscules : même type.
    CHECK(temperature_tower("petg-cf", 0, 0, 0).end == 240);
}

TEST_CASE("Calibration : type inconnu : la plage du profil, sinon un refus clair plutôt qu'un test inadapté")
{
    using Plyo::CalibrationLogic::temperature_tower;
    // Limites du profil, ramenées à des pas de 5 °C vers l'intérieur.
    auto t = temperature_tower("POM", 212, 248, 230);
    CHECK(t.refusal.empty());
    CHECK(t.start == 245);
    CHECK(t.end == 215);
    t = temperature_tower("PP", 200, 240, 220);
    CHECK(t.start == 240);
    CHECK(t.end == 200);
    // Refus : profil sans plage, plage inversée, trop étroite ou trop large.
    for (const auto& [low, high, nozzle] : std::vector<std::tuple<int, int, int>>{{0, 0, 220}, {240, 200, 220}, {220, 220, 220}, {219, 226, 220}, {180, 290, 220}}) {
        INFO(low << " " << high);
        t = temperature_tower("POM", low, high, nozzle);
        CHECK_FALSE(t.refusal.empty());
        CHECK(t.start == 0);
    }
    // Hors de ce que le slicer accepte d'enregistrer (170–300 °C) : PEEK, PCL.
    CHECK_FALSE(temperature_tower("PEEK", 350, 460, 380).refusal.empty());
    CHECK_FALSE(temperature_tower("PCL", 130, 170, 150).refusal.empty());
    CHECK_FALSE(temperature_tower("POM", 165, 200, 180).refusal.empty());
    CHECK_FALSE(temperature_tower("POM", 280, 310, 290).refusal.empty());
    // Le profil se contredit (plage par défaut d'Orca, buse réglée à 380 °C) : on ne fait pas confiance à la plage.
    CHECK_FALSE(temperature_tower("PEEK", 190, 240, 380).refusal.empty());
    // Le refus nomme le filament et dit la suite, sans jargon.
    const std::string text = temperature_tower("Bidule", 0, 0, 0).refusal;
    CHECK(text.find("Bidule") != std::string::npos);
    CHECK(text.find("onglet Filament") != std::string::npos);
    CHECK(text.find("rien n'a changé") != std::string::npos);
}

#include "../../PlyoPrinterStatusLogic.hpp"

TEST_CASE("PrinterStatus : dossier d'un fichier dans la liste d'une Creality")
{
    using namespace Plyo::PrinterStatus;
    // Réponse réelle de la CR-10 SE (F003), raccourcie.
    const std::string reply = R"({ "retGcodeFileInfo": { "totalNum": 2, "fileInfo": "\/usr\/data\/printer_data\/gcodes:ouvre canette_PETG_28m47s.gcode:5060725:0.000000:1786838890:0:\/tmp\/a.png;\/usr\/data\/printer_data\/gcodes:obj_1.stl_PLA_45m16s.gcode:2965082:0.000000:1777586916:0:\/tmp\/b.png" } })";
    CHECK(creality_file_dir(reply, "ouvre canette_PETG_28m47s.gcode") == "/usr/data/printer_data/gcodes");
    CHECK(creality_file_dir(reply, "obj_1.stl_PLA_45m16s.gcode") == "/usr/data/printer_data/gcodes");
    CHECK(creality_file_dir(reply, "absent.gcode").empty());
    CHECK(creality_file_dir("pas du json", "x.gcode").empty());
    CHECK(creality_file_dir(R"({"retGcodeFileInfo":{"fileInfo":"../etc:x.gcode:1"}})", "x.gcode").empty()); // dossier qui n'est pas un chemin absolu propre
}

TEST_CASE("PrinterStatus : état d'impression lu, puis verdict après un envoi")
{
    using namespace Plyo::PrinterStatus;
    // Messages réels de la CR-10 SE pendant une impression (champs utiles).
    const Status printing = creality_status({{"state", "1"}, {"printFileName", "/usr/data/printer_data/gcodes/a.gcode"}, {"printProgress", "21"}});
    CHECK(printing.state == "printing");
    CHECK(printing.file == "a.gcode");
    CHECK(printing.progress == 21);
    CHECK(creality_status({{"state", 0}, {"printFileName", ""}}).state == "idle");
    CHECK(creality_status(nlohmann::json::object()).state == "unknown");

    CHECK(moonraker_status({{"result", {{"status", {{"print_stats", {{"state", "printing"}, {"filename", "b.gcode"}}}}}}}}).state == "printing");
    CHECK(moonraker_status({{"result", {{"status", {{"print_stats", {{"state", "standby"}}}}}}}}).state == "idle");
    CHECK(moonraker_status({{"result", {{"status", {{"print_stats", {{"state", "paused"}}}}}}}}).state == "paused");
    CHECK(moonraker_status({{"result", {{"status", {{"print_stats", {{"state", "error"}}}}}}}}).state == "error");
    CHECK(moonraker_status(nlohmann::json()).state == "unknown");

    const Status idle{"idle", "", -1};
    const Status other{"printing", "autre.gcode", 50};
    const Status unknown{"unknown", "", -1};
    CHECK(verdict(idle, printing) == "started");
    CHECK(verdict(other, printing) == "started");   // une autre impression était finie, la nouvelle a pris sa place
    CHECK(verdict(printing, printing) == "busy");   // elle imprimait déjà ce fichier avant l'envoi
    CHECK(verdict(idle, idle) == "waiting");
    CHECK(verdict(idle, Status{"error", "", -1}) == "error");
    CHECK(verdict(unknown, printing) == "started");
    CHECK(verdict(idle, unknown) == "unknown");
}

TEST_CASE("PrinterStatus : fin d'une impression démarrée")
{
    using namespace Plyo::PrinterStatus;
    CHECK(END_POLL_SECONDS == 30);
    CHECK(LOST_AFTER_SECONDS == 600);
    const Status started{"printing", "a.gcode", 3};
    const auto   mr = [](const char* state) {
        return moonraker_status({{"result", {{"status", {{"print_stats", {{"state", state}, {"filename", "a.gcode"}}}}}}}});
    };
    CHECK(end_verdict(started, mr("printing"), 0).empty());
    CHECK(end_verdict(started, mr("paused"), 0).empty());
    CHECK(end_verdict(started, mr("complete"), 0) == "finished");
    CHECK(end_verdict(started, mr("cancelled"), 0) == "cancelled");
    CHECK(end_verdict(started, mr("error"), 0) == "error");
    CHECK(end_verdict(started, mr("standby"), 0) == "unknown_end"); // revenue au repos sans dire comment
    CHECK(verdict(Status{"idle", "", -1}, mr("complete")) == "waiting"); // le démarrage n'est pas changé : une fin n'est pas un départ

    // Creality : seul « 1 » (impression) est connu ; tout autre code à la sortie de l'impression ne dit rien de la fin.
    CHECK(creality_states().size() == 1);
    CHECK(creality_states().at("1") == "printing");
    CHECK(end_verdict(started, creality_status({{"state", "1"}, {"printFileName", "/d/a.gcode"}}), 0).empty());
    CHECK(end_verdict(started, creality_status({{"state", "0"}, {"printFileName", "/d/a.gcode"}}), 0) == "unknown_end");
    CHECK(end_verdict(started, creality_status({{"state", 4}}), 0) == "unknown_end");
    // Un code appris s'ajoute à la table en une ligne : il donne alors sa fin.
    const std::map<std::string, std::string> learned = {{"1", "printing"}, {"4", "finished"}, {"5", "cancelled"}, {"6", "error"}};
    CHECK(end_verdict(started, creality_status({{"state", "4"}}, learned), 0) == "finished");
    CHECK(end_verdict(started, creality_status({{"state", 5}}, learned), 0) == "cancelled");
    CHECK(end_verdict(started, creality_status({{"state", "6"}}, learned), 0) == "error");
    CHECK(end_verdict(started, creality_status({{"state", "7"}}, learned), 0) == "unknown_end");

    // Une autre impression a pris la place de la nôtre : elle est finie, sans savoir comment.
    CHECK(end_verdict(started, Status{"printing", "b.gcode", 1}, 0) == "unknown_end");
    CHECK(end_verdict(started, Status{"printing", "", 40}, 0).empty()); // nom absent de ce message : rien à conclure

    // Plus de réponse : on attend, puis « perdue » au-delà de 10 minutes de silence.
    const Status silent{"unknown", "", -1};
    CHECK(end_verdict(started, silent, 0).empty());
    CHECK(end_verdict(started, silent, 600).empty());
    CHECK(end_verdict(started, silent, 601) == "lost");
}

TEST_CASE("PrinterStatus : une Creality qui sort de l'impression une seule fois ne finit pas le suivi")
{
    using namespace Plyo::PrinterStatus;
    // Deux lectures de suite (30 s d'écart) hors impression avant « unknown_end » : une courte pause ne termine rien.
    CHECK(settle_end("unknown_end", "", true).empty());
    CHECK(settle_end("unknown_end", "unknown_end", true) == "unknown_end");
    CHECK(settle_end("", "unknown_end", true).empty()); // elle a repris
    CHECK(settle_end("finished", "", true) == "finished"); // un code connu est certain
    CHECK(settle_end("lost", "", true) == "lost");
    CHECK(settle_end("unknown_end", "", false) == "unknown_end"); // Moonraker dit lui-même son état
}

TEST_CASE("PrinterStatus : champs d'état Creality écrits dans le journal, sans secret")
{
    using namespace Plyo::PrinterStatus;
    const nlohmann::json fields = {{"state", "1"}, {"printProgress", 21}, {"printFileName", "/d/a.gcode"}, {"nozzleTemp", "200.5"},
                                   {"accessCode", "12345678"}, {"password", "x"}, {"token", "t"}, {"err", {{"errcode", 0}, {"key", 1}}},
                                   {"errCode", 0}, {"printLeftTime", 1200}, {"deviceState", 3}, {"isPaused", false},
                                   {"printJobStatus", std::string(200, 'x')}};
    CHECK(creality_status_fields(fields) == "deviceState=3 errCode=0 isPaused=false printFileName=/d/a.gcode printJobStatus=" + std::string(80, 'x') +
                                                "… printProgress=21 state=1");
    CHECK(creality_status_fields(nlohmann::json()).empty());
    CHECK(creality_status_fields({{"nozzleTemp", 200}}).empty());
}

TEST_CASE("Discovery : modèles appris (code d'une imprimante → modèle du catalogue)")
{
    using namespace Plyo::Discovery;
    CHECK(valid_learned("Creality", "F003", "Creality CR-10 SE"));
    CHECK_FALSE(valid_learned("Creality", "F003; x", "Creality CR-10 SE"));
    CHECK_FALSE(valid_learned("", "F003", "Creality CR-10 SE"));
    CHECK_FALSE(valid_learned("Creality", "F003", "<b>"));
    CHECK_FALSE(valid_learned("Creality", std::string(21, 'F'), "Creality CR-10 SE"));

    // Fichier local : { local: {marque: {code: modèle}}, shared: {…} } ; le choix fait sur cet ordinateur l'emporte.
    const nlohmann::json store = {{"local", {{"Creality", {{"F050", "Creality K1 Max"}}}}},
                                  {"shared", {{"Creality", {{"F050", "Creality K1"}, {"F060", "Creality Hi"}}}}}};
    const auto learned = learned_for(store, "Creality");
    CHECK(learned.at("F050") == "Creality K1 Max");
    CHECK(learned.at("F060") == "Creality Hi");
    CHECK(learned_for(store, "Elegoo").empty());
    CHECK(learned_for(nlohmann::json(), "Creality").empty());

    CHECK(creality_mdns_name("F060", "", learned) == "Creality Hi");
    CHECK(creality_mdns_name("F008", "K2 Plus", learned) == "Creality K2 Plus"); // ce qu'Orca sait passe d'abord
    CHECK(creality_mdns_name("F999", "", learned) == "Imprimante Creality");

    // Table partagée reçue du serveur : seules les lignes valides sont gardées.
    const nlohmann::json shared = shared_from_server({{"models", {{{"brand", "Creality"}, {"code", "F060"}, {"model", "Creality Hi"}},
                                                                 {{"brand", "Creality"}, {"code", "bad code!"}, {"model", "X"}}}}});
    CHECK(shared == nlohmann::json({{"Creality", {{"F060", "Creality Hi"}}}}));
    CHECK(shared_from_server("n'importe quoi").empty());

    Printer withCode{"192.168.1.200", "Imprimante Creality", "Creality", "crealityprint", "192.168.1.200", 3};
    withCode.code = "F003";
    CHECK(to_json({withCode})[0]["code"] == "F003");
}

TEST_CASE("Bobines : nettoyage du nom et clé de comparaison")
{
    using namespace Plyo::SpoolsLogic;
    CHECK(clean_name("  Sunlu  PLA+/noir ") == "Sunlu PLA+ noir");
    CHECK(clean_name("ab") == "");
    CHECK(clean_name("a:b") == "a b");
    CHECK(clean_name("///") == "");
    const std::string long80(80, 'x');
    CHECK(clean_name(long80).size() == 60);
    std::string accents; // « é » fait 2 octets : 40 caractères = 80 octets, coupés à 60 octets = 30 caractères
    for (int i = 0; i < 40; ++i)
        accents += "\xC3\xA9";
    CHECK(clean_name(accents).size() == 60);
    CHECK(key_of("  Sunlu  PLA+ Noir ") == "sunlu pla+ noir");
    CHECK(key_of("sunlu pla+ noir") == key_of("Sunlu  PLA+ Noir"));
}

TEST_CASE("Bobines : nom du préréglage")
{
    using namespace Plyo::SpoolsLogic;
    const std::string base = "Sunlu PLA+ noir \xE2\x80\x94 CR-10 SE";
    CHECK(preset_name("Sunlu PLA+ noir", "CR-10 SE", {}, {}) == base);
    CHECK(preset_name("Sunlu PLA+ noir", "CR-10 SE", {base}, {}) == base + " 2");
    CHECK(preset_name("Sunlu PLA+ noir", "CR-10 SE", {base, base + " 2"}, {}) == base + " 3");
    CHECK(preset_name("Sunlu PLA+ noir", "CR-10 SE", {base}, {base}) == base);
    CHECK(preset_name(std::string(60, 'a'), std::string(80, 'b'), {}, {}).size() <= Plyo::Profiles::MAX_NAME_BYTES);
}

TEST_CASE("Bobines : sanitize")
{
    using namespace Plyo::SpoolsLogic;
    const json raw = {{"spools", {
        {{"id", "a"}, {"name", "Sunlu PLA+ noir"}, {"material", "PLA"},
         {"machines", {{"CR-10 SE", {{"preset", "P1"}, {"last_outcome", "ok"}, {"last_ok_at", "2026-11-01"}}},
                       {"Autre", {{"preset", "P2"}, {"last_outcome", "n'importe"}, {"last_ok_at", "01/11/2026"}}}}}},
        {{"id", "b"}, {"name", "Inconnue"}, {"material", "NYLON"}},
        {{"id", "c"}, {"name", "ab"}, {"material", "PLA"}},
        {{"id", "a"}, {"name", "Doublon d'id"}, {"material", "PETG"}},
        "pas un objet"}}};
    const json out = sanitize(raw);
    REQUIRE(out["spools"].size() == 1);
    const json& s = out["spools"][0];
    CHECK(s["id"] == "a");
    CHECK(s["machines"]["CR-10 SE"]["last_ok_at"] == "2026-11-01");
    CHECK(s["machines"]["Autre"]["last_ok_at"] == "");
    CHECK(s["machines"]["Autre"]["last_outcome"] == "");
    CHECK(sanitize("n'importe quoi") == json({{"spools", json::array()}}));

    json many = {{"spools", json::array()}};
    for (int i = 0; i < 250; ++i)
        many["spools"].push_back({{"id", "i" + std::to_string(i)}, {"name", "Bobine " + std::to_string(i)}, {"material", "ABS"}});
    CHECK(sanitize(many)["spools"].size() == 200);
}

TEST_CASE("Bobines : ajout, filtre par machine, retrouver la bobine d'un préréglage")
{
    using namespace Plyo::SpoolsLogic;
    json reg = sanitize(json::object());
    json r1  = add(reg, "sunlu pla+ noir", "PLA");
    CHECK(r1["created"] == true);
    const std::string id = r1["id"];
    CHECK(!id.empty());
    json r2 = add(r1["reg"], "Sunlu  PLA+ Noir", "PLA");
    CHECK(r2["created"] == false);
    CHECK(r2["id"] == id);
    CHECK(r2["reg"]["spools"].size() == 1);
    CHECK(add(r2["reg"], "x", "PLA")["created"] == false);
    CHECK(add(r2["reg"], "Bobine rouge", "NYLON")["created"] == false);

    json r3 = add(r2["reg"], "Bobine rouge", "PETG");
    CHECK(r3["created"] == true);
    const std::string id2 = r3["id"];
    CHECK(id2 != id);

    json reg2 = r3["reg"];
    reg2["spools"][0]["machines"]["CR-10 SE"] = {{"preset", "P1"}, {"last_outcome", "ok"}, {"last_ok_at", "2026-10-01"}};
    reg2["spools"][1]["machines"]["CR-10 SE"] = {{"preset", ""}, {"last_outcome", "ok"}, {"last_ok_at", "2026-11-05"}};
    reg2 = sanitize(reg2);
    json list = for_machine(reg2, "CR-10 SE");
    REQUIRE(list.size() == 2);
    CHECK(list[0]["id"] == id2);
    CHECK(list[0]["has_preset"] == false);
    CHECK(list[1]["id"] == id);
    CHECK(list[1]["has_preset"] == true);
    CHECK(list[1]["material"] == "PLA");
    CHECK(for_machine(reg2, "Inconnue").size() == 2);
    CHECK(for_machine(reg2, "Inconnue")[0]["last_ok_at"] == "");
    CHECK(spool_of_preset(reg2, "P1") == id);
    CHECK(spool_of_preset(reg2, "P9") == "");
    CHECK(spool_of_preset(reg2, "") == "");
}

TEST_CASE("Bobines : une autre machine ne reprend pas le préréglage d'une machine (vigilance 3)")
{
    using namespace Plyo::SpoolsLogic;
    const json        r   = add(sanitize(json::object()), "Sunlu PLA+ noir", "PLA");
    const std::string id  = r["id"];
    const json        reg = set_preset(r["reg"], id, "Ma Creality CR-10 SE 0.4 nozzle", "Sunlu PLA+ noir \xE2\x80\x94 Creality CR-10 SE");
    CHECK(preset_for(reg, id, "Ma Creality CR-10 SE 0.4 nozzle") == "Sunlu PLA+ noir \xE2\x80\x94 Creality CR-10 SE");
    CHECK(for_machine(reg, "Ma Creality CR-10 SE 0.4 nozzle")[0]["has_preset"] == true);
    // Même bobine, autre machine : rien n'est repris, il faudra partir du profil de la matière de la K2.
    CHECK(for_machine(reg, "Ma Creality K2 0.4 nozzle")[0]["has_preset"] == false);
    CHECK(preset_for(reg, id, "Ma Creality K2 0.4 nozzle") == "");
    CHECK(preset_for(reg, "inconnu", "Ma Creality CR-10 SE 0.4 nozzle") == "");
    // Bobine inconnue ou machine vide : registre inchangé.
    CHECK(set_preset(reg, "inconnu", "K2", "P") == sanitize(reg));
    CHECK(set_preset(reg, id, "", "P") == sanitize(reg));
    // Un nouveau préréglage repart sans résultat : l'ancien ne parlait pas de ces valeurs.
    json done = reg;
    done["spools"][0]["machines"]["Ma Creality CR-10 SE 0.4 nozzle"]["last_outcome"] = "ok";
    done["spools"][0]["machines"]["Ma Creality CR-10 SE 0.4 nozzle"]["last_ok_at"]   = "2026-11-11";
    const json again = set_preset(done, id, "Ma Creality CR-10 SE 0.4 nozzle", "Autre");
    CHECK(again["spools"][0]["machines"]["Ma Creality CR-10 SE 0.4 nozzle"]["last_outcome"] == "");
    CHECK(again["spools"][0]["machines"]["Ma Creality CR-10 SE 0.4 nozzle"]["preset"] == "Autre");
    CHECK(spool_name(again, id) == "Sunlu PLA+ noir");
    CHECK(spool_name(again, "inconnu") == "");
}

TEST_CASE("Bobines : nom noté avant l'enregistrement, repris tel quel après un échec")
{
    using namespace Plyo::SpoolsLogic;
    const std::string printer = "Ma Creality CR-10 SE 0.4 nozzle";
    const json        r       = add(sanitize(json::object()), "Sunlu PLA+ noir", "PLA");
    const std::string id      = r["id"];
    const std::string name    = preset_name("Sunlu PLA+ noir", machine_label(printer), {}, {});
    // Noté « en attente » avant save_preset : pas encore un préréglage de bobine utilisable.
    const json pending = set_preset(r["reg"], id, printer, name, true);
    CHECK(is_pending(pending, id, printer));
    CHECK(preset_for(pending, id, printer) == name);
    CHECK(for_machine(pending, printer)[0]["has_preset"] == false);
    CHECK(spool_of_preset(pending, name) == "");
    // L'enregistrement a échoué après avoir laissé le préréglage dans Orca : le nouvel essai reprend le même nom.
    CHECK(preset_name("Sunlu PLA+ noir", machine_label(printer), {name}, {preset_for(pending, id, printer)}) == name);
    // L'attente survit à la relecture du fichier.
    CHECK(is_pending(sanitize(pending), id, printer));
    // Réussite : l'entrée devient un vrai préréglage de bobine.
    const json done = set_preset(pending, id, printer, name);
    CHECK_FALSE(is_pending(done, id, printer));
    CHECK(for_machine(done, printer)[0]["has_preset"] == true);
    CHECK(spool_of_preset(done, name) == id);
    CHECK_FALSE(is_pending(done, "inconnu", printer));
    CHECK_FALSE(is_pending(done, id, "Autre"));
}

TEST_CASE("Bobines : un préréglage de l'utilisateur devient une bobine sans changer de nom")
{
    using namespace Plyo::SpoolsLogic;
    const std::string printer = "Ma Creality CR-10 SE 0.4 nozzle";
    const json        r       = adopt(sanitize(json::object()), "Mon PLA à moi", "Mon PLA à moi", "PLA", printer);
    CHECK(r["created"] == true);
    const std::string id = r["id"];
    REQUIRE(!id.empty());
    // Inscrit tel quel : pas de nouveau nom « <bobine> — <machine> », et c'est bien une bobine pour l'enregistrement automatique.
    CHECK(preset_for(r["reg"], id, printer) == "Mon PLA à moi");
    CHECK(spool_of_preset(r["reg"], "Mon PLA à moi") == id);
    CHECK_FALSE(is_pending(r["reg"], id, printer));
    CHECK(for_machine(r["reg"], printer)[0]["has_preset"] == true);
    CHECK(spool_name(r["reg"], id) == "Mon PLA à moi");
    // Déjà une bobine : rien ne change.
    const json again = adopt(r["reg"], "Mon PLA à moi", "Autre nom", "PLA", printer);
    CHECK(again["id"] == id);
    CHECK(again["created"] == false);
    CHECK(again["reg"] == sanitize(r["reg"]));
    // Une bobine du même nom a déjà son préréglage sur cette machine : refus, jamais deux préréglages pour une bobine.
    const json clash = adopt(r["reg"], "Copie de mon PLA", "mon pla à moi", "PLA", printer);
    CHECK(clash["id"] == "");
    CHECK(spool_of_preset(clash["reg"], "Copie de mon PLA") == "");
    // Refus : préréglage, machine, nom ou matière manquants.
    CHECK(adopt(sanitize(json::object()), "", "Mon PLA", "PLA", printer)["id"] == "");
    CHECK(adopt(sanitize(json::object()), "Mon PLA", "Mon PLA", "PLA", "")["id"] == "");
    CHECK(adopt(sanitize(json::object()), "Mon PLA", "x", "PLA", printer)["id"] == "");
    CHECK(adopt(sanitize(json::object()), "Mon nylon", "Mon nylon", "PA", printer)["id"] == "");
}

TEST_CASE("Project: sanitize garde la bobine du filament 1 (id et nom seulement)")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json ok = sanitize({{"filament", {{"type", "PLA"}, {"preset", "Sunlu PLA+ noir \xE2\x80\x94 CR-10 SE"}, {"spool", {{"id", "b1"}, {"name", "Sunlu PLA+ noir"}, {"secret", "x"}}}}}});
    CHECK(ok["filament"]["spool"] == nlohmann::json({{"id", "b1"}, {"name", "Sunlu PLA+ noir"}}));
    CHECK_FALSE(sanitize({{"filament", {{"preset", "P"}, {"spool", {{"id", "b1"}}}}}})["filament"].contains("spool"));
    CHECK_FALSE(sanitize({{"filament", {{"preset", "P"}, {"spool", "b1"}}}})["filament"].contains("spool"));
}

TEST_CASE("Habits: préréglages refusés comme bobines, gardés pour ne plus jamais redemander")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json h = sanitize_habits({{"spool_declined", {"Mon PLA à moi", "", 3, std::string(300, 'x')}}});
    CHECK(h["spool_declined"] == nlohmann::json({"Mon PLA à moi"}));
    CHECK_FALSE(sanitize_habits(nlohmann::json::object()).contains("spool_declined"));
}

TEST_CASE("Bobines : nom court de la machine (comme le panneau)")
{
    using namespace Plyo::SpoolsLogic;
    CHECK(machine_label("Ma Creality CR-10 SE 0.4 nozzle") == "Creality CR-10 SE");
    CHECK(machine_label("Creality K2 0.6 Nozzle") == "Creality K2");
    CHECK(machine_label("Elegoo Centauri Carbon 2 0.4 nozzle - Copie") == "Elegoo Centauri Carbon 2");
    CHECK(machine_label("Elegoo Centauri Carbon 2 0.4 nozzle - Copy 2") == "Elegoo Centauri Carbon 2");
    CHECK(machine_label("Ma Creality K2 0.4 nozzle (Plyo)") == "Creality K2");
    CHECK(machine_label("Ma Creality K2 0.4 nozzle (Plyo 2)") == "Creality K2");
    CHECK(machine_label("MyKlipper") == "MyKlipper");
    CHECK(machine_label("Mars 0.4 nozzle") == "Mars");
    CHECK(machine_label("  ") == "");
}

TEST_CASE("Bobines : enregistrement automatique seulement au calme, pour une bobine, hors découpe et envoi")
{
    using namespace Plyo::SpoolsLogic;
    const std::string printer = "Ma Creality CR-10 SE 0.4 nozzle";
    const json        r       = add(sanitize(json::object()), "Sunlu PLA+ noir", "PLA");
    const std::string name    = preset_name("Sunlu PLA+ noir", machine_label(printer), {}, {});
    const json        reg     = set_preset(r["reg"], r["id"], printer, name);

    AutoSaveState s;
    s.filament_dirty = true;
    s.is_spool       = !spool_of_preset(reg, name).empty();
    s.slicing        = false;
    s.sending        = false;
    s.quiet_ms       = 2000;
    s.calibrating    = false;
    // Modifié, bobine, 2 s de calme : on enregistre.
    CHECK(should_save_spool(s));

    // Même état pendant une découpe, ou pendant un envoi : on attend.
    AutoSaveState slicing = s;
    slicing.slicing       = true;
    CHECK_FALSE(should_save_spool(slicing));
    AutoSaveState sending = s;
    sending.sending       = true;
    CHECK_FALSE(should_save_spool(sending));

    // Préréglage hors registre (un préréglage de l'utilisateur, ou une bobine encore « en attente ») : jamais écrasé.
    AutoSaveState other = s;
    other.is_spool      = !spool_of_preset(reg, "Mon PLA à moi").empty();
    CHECK_FALSE(other.is_spool);
    CHECK_FALSE(should_save_spool(other));
    AutoSaveState pending = s;
    pending.is_spool      = !spool_of_preset(set_preset(r["reg"], r["id"], printer, name, true), name).empty();
    CHECK_FALSE(should_save_spool(pending));

    // 1,5 s de calme seulement : l'utilisateur tape peut-être encore.
    AutoSaveState typing = s;
    typing.quiet_ms      = 1500;
    CHECK_FALSE(should_save_spool(typing));

    // Calibration en cours (Plyo ou Orca) : les valeurs du test ne doivent jamais entrer dans la bobine.
    AutoSaveState calibrating = s;
    calibrating.calibrating   = true;
    CHECK_FALSE(should_save_spool(calibrating));

    // Rien de modifié : rien à écrire.
    AutoSaveState clean = s;
    clean.filament_dirty = false;
    CHECK_FALSE(should_save_spool(clean));
}

TEST_CASE("Bobines : écarts de températures que la vérification d'Orca refuserait (sa fenêtre ne doit jamais s'ouvrir)")
{
    using namespace Plyo::SpoolsLogic;
    // Buse : 30 °C d'écart au plus entre la première couche et les suivantes ; plateau : 15 °C.
    CHECK(temperature_pairs_ok({}));
    CHECK(temperature_pairs_ok({{220, 215, 30}, {60, 55, 15}}));
    CHECK(temperature_pairs_ok({{245, 215, 30}})); // 30 tout juste : accepté
    CHECK_FALSE(temperature_pairs_ok({{250, 215, 30}}));
    CHECK_FALSE(temperature_pairs_ok({{220, 215, 30}, {80, 60, 15}}));
    CHECK_FALSE(temperature_pairs_ok({{200, 240, 30}})); // dans les deux sens
    // 0 (ou moins) : réglage coupé, comme chez Orca.
    CHECK(temperature_pairs_ok({{0, 215, 30}, {60, 0, 15}}));
}

TEST_CASE("Bobines : la vérification des températures d'Orca a toujours les mêmes seuils")
{
    // Si Orca change ces seuils, temperature_pairs_ok (et ses appelants) doivent suivre.
    const fs::path          file = fs::path(__FILE__).parent_path() / "../../../../src/slic3r/GUI/Tab.cpp";
    boost::nowide::ifstream in(file.string());
    REQUIRE(in.good());
    const std::string src((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    const size_t      at = src.find("bool Tab::validate_filament_temperature_pairs()");
    REQUIRE(at != std::string::npos);
    const std::string body = src.substr(at, 4000);
    CHECK(body.find("\"nozzle_temperature_initial_layer\", \"nozzle_temperature\", 30}") != std::string::npos);
    CHECK(body.find("temp_pair_rules.push_back({label, first_key, other_key, 15});") != std::string::npos);
    CHECK(body.find("for (int bt = static_cast<int>(btPC); bt < static_cast<int>(btCount); ++bt)") != std::string::npos);
    CHECK(body.find("if (first_temp <= 0 || other_temp <= 0)") != std::string::npos);
    CHECK(body.find("if (delta <= rule.max_delta)") != std::string::npos);
    CHECK(body.find("get_at(0)") != std::string::npos);
}

TEST_CASE("Bobines : résumé de la version réussie, au format « débit 0,88 »")
{
    using namespace Plyo::SpoolsLogic;
    const std::map<std::string, std::string> titles = {
        {"filament_flow_ratio", "Rapport de débit"},
        {"nozzle_temperature", "Buse · Température de la buse"},
        {"nozzle_temperature_initial_layer", "Buse · Température de la buse de couche initiale"},
        {"hot_plate_temp", "Plateau PEI lisse / Plateau haute température · Température du plateau"},
        {"textured_plate_temp", "Plateau PEI texturé · Température du plateau"},
        {"fan_max_speed", "Seuil de vitesse maximale du ventilateur · Vitesse du ventilateur"},
        {"pressure_advance", "Pressure Advance"},
        {"slow_down_layer_time", "Temps de couche"}};

    // Un écart : le débit réussi (0,88) est cité avec une virgule décimale.
    json r = success_summary({{"filament_flow_ratio", "0.95"}, {"nozzle_temperature", "215"}},
                             {{"filament_flow_ratio", "0.88"}, {"nozzle_temperature", "215"}}, titles);
    CHECK(r["differs"] == true);
    CHECK(r["summary"] == "débit 0,88");

    // Aucun écart : rien à proposer.
    r = success_summary({{"filament_flow_ratio", "0.88"}}, {{"filament_flow_ratio", "0.88"}}, titles);
    CHECK(r["differs"] == false);
    CHECK(r["summary"] == "");

    // Quatre écarts : trois cités, les plus parlants d'abord (débit, températures), séparés par une virgule.
    r = success_summary({{"filament_flow_ratio", "0.95"}, {"nozzle_temperature", "220"}, {"nozzle_temperature_initial_layer", "225"},
                         {"slow_down_layer_time", "8"}},
                        {{"filament_flow_ratio", "0.88"}, {"nozzle_temperature", "210"}, {"nozzle_temperature_initial_layer", "215"},
                         {"slow_down_layer_time", "6"}},
                        titles);
    CHECK(r["differs"] == true);
    CHECK(r["summary"] == "débit 0,88, température de buse (première couche) 215 °C, température de buse 210 °C");

    // Tableau d'Orca (plusieurs extrudeurs) : la première valeur. Titre du catalogue sans nom court : sa dernière partie,
    // en minuscule. Deux plateaux au même titre ne sont cités qu'une fois. Un sigle garde ses majuscules.
    r = success_summary({{"fan_max_speed", "100,100"}, {"hot_plate_temp", "65"}, {"textured_plate_temp", "65"}},
                        {{"fan_max_speed", "80,80"}, {"hot_plate_temp", "60"}, {"textured_plate_temp", "55"}}, titles);
    CHECK(r["summary"] == "vitesse du ventilateur 80, température du plateau 60 °C");
    r = success_summary({{"pressure_advance", "0.04"}, {"fan_max_speed", "100"}}, {{"pressure_advance", "0.035"}, {"fan_max_speed", "80"}}, titles);
    CHECK(r["summary"] == "pressure advance 0,035, vitesse du ventilateur 80");
    CHECK(short_title("x", "Plateau PEI texturé") == "plateau PEI texturé");
    CHECK(short_title("x", "") == "x");
    CHECK(short_title("x", "Écart") == "écart");
    // Pourcentage d'Orca : espace avant « % ».
    r = success_summary({{"slow_down_layer_time", "15%"}}, {{"slow_down_layer_time", "12.5%"}}, titles);
    CHECK(r["summary"] == "temps de couche 12,5 %");

    // Clé absente des valeurs d'aujourd'hui (option disparue) ou illisible (« nil ») : ignorée.
    r = success_summary({{"filament_flow_ratio", "0.88"}}, {{"filament_flow_ratio", "0.88"}, {"pressure_advance", "0.04"}}, titles);
    CHECK(r["differs"] == false);
    r = success_summary({{"pressure_advance", "0.04"}}, {{"pressure_advance", "nil"}}, titles);
    CHECK(r["differs"] == true);
    CHECK(r["summary"] == "");
    // Entrées qui ne sont pas des objets : rien.
    CHECK(success_summary(json(), json::array(), titles)["differs"] == false);
}

TEST_CASE("Bobines : fichier de la version envoyée ou réussie, relu prudemment")
{
    using namespace Plyo::SpoolsLogic;
    CHECK(version_stem("b1", "Ma Creality CR-10 SE 0.4 nozzle") == Plyo::Profiles::file_stem("b1|Ma Creality CR-10 SE 0.4 nozzle"));
    CHECK(version_stem("b1", "A") != version_stem("b2", "A"));

    const json ok = sanitize_version({{"spool", "b1"}, {"printer", "P"}, {"date", "2026-11-12"},
                                      {"values", {{"filament_flow_ratio", "0.88"}, {"bad", 3}, {"nozzle_temperature", "215"}}}});
    CHECK(ok["spool"] == "b1");
    CHECK(ok["printer"] == "P");
    CHECK(ok["date"] == "2026-11-12");
    CHECK(ok["values"] == json({{"filament_flow_ratio", "0.88"}, {"nozzle_temperature", "215"}}));
    // Sans bobine, imprimante ou date valable : rien.
    CHECK(sanitize_version({{"printer", "P"}, {"date", "2026-11-12"}, {"values", json::object()}}).empty());
    CHECK(sanitize_version({{"spool", "b1"}, {"date", "2026-11-12"}}).empty());
    CHECK(sanitize_version({{"spool", "b1"}, {"printer", "P"}, {"date", "hier"}}).empty());
    CHECK(sanitize_version(json::array()).empty());
}

TEST_CASE("Bobines : résultat d'impression noté par machine")
{
    using namespace Plyo::SpoolsLogic;
    const json r   = add(sanitize(json::object()), "Sunlu PLA+ noir", "PLA");
    const json reg = set_preset(r["reg"], r["id"], "P", "Sunlu PLA+ noir — P");

    const json ok = set_outcome(reg, r["id"], "P", "ok", "2026-11-12");
    CHECK(for_machine(ok, "P")[0]["last_outcome"] == "ok");
    CHECK(for_machine(ok, "P")[0]["last_ok_at"] == "2026-11-12");
    // Une impression ratée ensuite : « dernière impression ratée », la date de la dernière réussite reste.
    const json bad = set_outcome(ok, r["id"], "P", "bad", "2026-11-13");
    CHECK(for_machine(bad, "P")[0]["last_outcome"] == "bad");
    CHECK(for_machine(bad, "P")[0]["last_ok_at"] == "2026-11-12");
    // Le préréglage est gardé.
    CHECK(preset_for(bad, r["id"], "P") == "Sunlu PLA+ noir — P");
    // Machine sans préréglage, bobine inconnue, résultat inconnu ou date invalide : inchangé.
    CHECK(set_outcome(reg, r["id"], "K2", "ok", "2026-11-12") == sanitize(reg));
    CHECK(set_outcome(reg, "b99", "P", "ok", "2026-11-12") == sanitize(reg));
    CHECK(set_outcome(reg, r["id"], "P", "super", "2026-11-12") == sanitize(reg));
    CHECK(set_outcome(reg, r["id"], "P", "ok", "demain") == sanitize(reg));
    // Un préréglage encore « en attente » n'a pas imprimé : inchangé.
    const json pending = set_preset(r["reg"], r["id"], "P", "Sunlu PLA+ noir — P", true);
    CHECK(set_outcome(pending, r["id"], "P", "ok", "2026-11-12") == sanitize(pending));
}

TEST_CASE("Bobines : la réussite déclarée vise le dernier envoi, pas la bobine choisie depuis")
{
    using namespace Plyo::SpoolsLogic;
    const json pointer = last_sent({{"spool", "b1"}, {"printer", "P"}, {"date", "2026-11-12"}, {"at", "2026-11-12T10:00:00"}, {"x", 1}});
    CHECK(pointer == json({{"spool", "b1"}, {"printer", "P"}, {"date", "2026-11-12"}, {"at", "2026-11-12T10:00:00"}}));
    CHECK(last_sent({{"spool", "b1"}, {"printer", "P"}, {"date", "2026-11-12"}}).empty()); // sans instant
    CHECK(last_sent(json::array()).empty());

    // L'essai de cette bobine sur cette imprimante, écrit par le même envoi : il correspond.
    const json trial = sanitize_version({{"spool", "b1"}, {"printer", "P"}, {"date", "2026-11-12"}, {"at", "2026-11-12T10:00:00"},
                                         {"values", {{"filament_flow_ratio", "0.88"}}}});
    CHECK(trial["at"] == "2026-11-12T10:00:00");
    CHECK(sent_trial_matches(pointer, trial));
    // Essai d'un autre envoi (réécrit depuis, ou plus ancien), d'une autre bobine ou d'une autre imprimante : refusé.
    json other = trial;
    other["at"] = "2026-11-12T11:00:00";
    CHECK_FALSE(sent_trial_matches(pointer, other));
    other       = trial;
    other["spool"] = "b2";
    CHECK_FALSE(sent_trial_matches(pointer, other));
    other         = trial;
    other["printer"] = "K2";
    CHECK_FALSE(sent_trial_matches(pointer, other));
    CHECK_FALSE(sent_trial_matches(json::object(), trial));
    CHECK_FALSE(sent_trial_matches(pointer, json::object()));
}

TEST_CASE("Bobines : le résumé ne cite que des nombres")
{
    using namespace Plyo::SpoolsLogic;
    const std::map<std::string, std::string> titles = {{"filament_flow_ratio", "Rapport de débit"}, {"filament_type", "Type"},
                                                       {"filament_soluble", "Soluble"}, {"filament_notes", "Notes"},
                                                       {"activate_air_filtration", "Filtration"}};
    const std::map<std::string, std::string> kinds  = {{"filament_soluble", "bool"}, {"activate_air_filtration", "bool"},
                                                       {"filament_flow_ratio", "float"}};
    // Texte, texte entre guillemets, booléen d'Orca (« 1 ») : écartés du résumé, mais comptés comme écarts.
    json r = success_summary({{"filament_type", "PETG"}, {"filament_notes", "\"a\""}, {"filament_soluble", "0"}, {"filament_flow_ratio", "0.95"}},
                             {{"filament_type", "PLA"}, {"filament_notes", "\"b\""}, {"filament_soluble", "1"}, {"filament_flow_ratio", "0.88"}},
                             titles, kinds);
    CHECK(r["differs"] == true);
    CHECK(r["summary"] == "débit 0,88");
    r = success_summary({{"activate_air_filtration", "0"}}, {{"activate_air_filtration", "1"}}, titles, kinds);
    CHECK(r["summary"] == "");
    // Nombres négatifs ou entiers : cités.
    r = success_summary({{"filament_flow_ratio", "1"}}, {{"filament_flow_ratio", "-0.5"}}, titles, kinds);
    CHECK(r["summary"] == "débit -0,5");
}

TEST_CASE("Projets : le 3MF de la conversation ne s'écrit qu'attaché, modifié, au repos et après 3 s de calme")
{
    using namespace Plyo::ProjectFilesLogic;
    SaveState s;
    s.attached           = true;
    s.changed_since_save = true;
    s.slicing            = false;
    s.sending            = false;
    s.quiet_ms           = 3000;
    // Calme 3 s et modifié : on écrit.
    CHECK(should_save(s));

    // Pendant une découpe, ou un envoi : on attend (l'export 3MF tourne sur le fil de l'interface).
    SaveState slicing = s;
    slicing.slicing   = true;
    CHECK_FALSE(should_save(slicing));
    SaveState sending = s;
    sending.sending   = true;
    CHECK_FALSE(should_save(sending));

    // Plateau pas rattaché à une conversation (fichier de l'utilisateur, nouvelle conversation pas encore reprise) : jamais.
    SaveState detached = s;
    detached.attached  = false;
    CHECK_FALSE(should_save(detached));

    // 2 s de calme seulement : l'utilisateur tourne peut-être encore la pièce.
    SaveState typing = s;
    typing.quiet_ms  = 2000;
    CHECK_FALSE(should_save(typing));

    // Rien de changé depuis la dernière écriture : rien à écrire.
    SaveState same          = s;
    same.changed_since_save = false;
    CHECK_FALSE(should_save(same));
}

TEST_CASE("Projets : motif d'un 3MF de conversation qui ne peut pas être rouvert")
{
    using namespace Plyo::ProjectFilesLogic;
    CHECK(open_reason(true, 1024, true) == "");
    CHECK(open_reason(false, 0, false) == "absent");
    // Un fichier vide ou illisible (zip abîmé, sans modèle) : abîmé.
    CHECK(open_reason(true, 0, false) == "abime");
    CHECK(open_reason(true, 2048, false) == "abime");
    // Au-delà de la taille maximale : trop gros, même s'il se lirait (il n'est pas ouvert).
    CHECK(open_reason(true, MAX_PROJECT_BYTES + 1, true) == "trop_gros");
    CHECK(open_reason(true, MAX_PROJECT_BYTES + 1, false) == "trop_gros");
    CHECK(open_reason(true, MAX_PROJECT_BYTES, true) == "");
    CHECK(MAX_PROJECT_BYTES == 50ULL * 1024 * 1024);
}

TEST_CASE("Projets : l'empreinte change avec le projet, le plateau ou un réglage")
{
    using namespace Plyo::ProjectFilesLogic;
    const Fingerprint a{1, 7, 12};
    CHECK(a == Fingerprint{1, 7, 12});
    // Nouveau projet : la pile d'annulation repart de 0, le numéro de projet de Plyo la distingue.
    CHECK_FALSE(a == Fingerprint{2, 7, 12});
    CHECK_FALSE(a == Fingerprint{1, 8, 12});
    CHECK_FALSE(a == Fingerprint{1, 7, 13});
}

TEST_CASE("Projets : les 3MF sans conversation sont à effacer")
{
    using namespace Plyo::ProjectFilesLogic;
    const std::vector<std::string> kept  = {"abc-1", "def-2"};
    const std::vector<std::string> files = {"abc-1", "old-9", "def-2", "gone-3"};
    CHECK(orphans(kept, files) == std::vector<std::string>{"old-9", "gone-3"});
    CHECK(orphans({}, {"x"}) == std::vector<std::string>{"x"});
    CHECK(orphans({"x"}, {}).empty());
}

TEST_CASE("ProjectFiles::to_prune : limites séparées pour les projets avec plateau et les simples questions", "[projectfiles]")
{
    using Plyo::ProjectFilesLogic::to_prune;
    // Du plus récent au plus ancien : vrai = projet avec plateau.
    CHECK(to_prune({true, true, false}, 2, 2).empty());
    CHECK(to_prune({true, true, true, false}, 2, 2) == std::vector<size_t>{2});
    // Des questions en série ne font jamais partir un projet avec plateau.
    CHECK(to_prune({false, false, false, true}, 2, 2) == std::vector<size_t>{2});
    CHECK(to_prune({false, true, false, true, true, false}, 2, 2) == std::vector<size_t>{4, 5});
    CHECK(to_prune({}, 30, 30).empty());
}

TEST_CASE("Projets : un plateau qui est un fichier de l'utilisateur n'est jamais attaché à une conversation")
{
    using namespace Plyo::ProjectFilesLogic;
    CHECK(attachable(false, false));
    // Projet ouvert ou enregistré sous un nom par l'utilisateur (Fichier › Ouvrir, Enregistrer sous) : jamais.
    CHECK_FALSE(attachable(true, false));
    // Fichier chargé par l'utilisateur sans nom de projet (3MF publié, géométrie seule) : jusqu'au prochain nouveau projet.
    CHECK_FALSE(attachable(false, true));
}

TEST_CASE("Projets : le plateau quitté se remplace sans question seulement s'il n'a pas bougé depuis l'écriture")
{
    using namespace Plyo::ProjectFilesLogic;
    const Fingerprint kept{3, 10, 40};
    CHECK(plate_unchanged(kept, Fingerprint{3, 10, 40}, false));
    // Le compteur de réglages a pu bouger en vidant les modifications : seuls projet et plateau comptent, plus les préréglages modifiés.
    CHECK(plate_unchanged(kept, Fingerprint{3, 10, 41}, false));
    // Pièce tournée après le départ de la conversation.
    CHECK_FALSE(plate_unchanged(kept, Fingerprint{3, 11, 40}, false));
    // Autre projet.
    CHECK_FALSE(plate_unchanged(kept, Fingerprint{4, 10, 40}, false));
    // Réglage changé dans un onglet d'Orca après le départ.
    CHECK_FALSE(plate_unchanged(kept, Fingerprint{3, 10, 40}, true));
}

TEST_CASE("Projets : aucune écriture du 3MF pendant une découpe, un envoi, une calibration ou une fenêtre")
{
    using namespace Plyo::ProjectFilesLogic;
    CHECK(write_allowed(false, false, false, false));
    CHECK_FALSE(write_allowed(true, false, false, false));
    CHECK_FALSE(write_allowed(false, true, false, false));
    CHECK_FALSE(write_allowed(false, false, true, false));
    CHECK_FALSE(write_allowed(false, false, false, true));
}

TEST_CASE("Projets : une conversation ne prend jamais le plateau d'une autre qui n'est pas encore rangé")
{
    using namespace Plyo::ProjectFilesLogic;
    // Rien en attente, aucun autre plateau à ranger : permis, même si Orca est occupé.
    CHECK(attach_allowed(false, false, false));
    CHECK(attach_allowed(false, false, true));
    // Autre plateau modifié mais Orca libre : il est écrit d'abord, puis permis.
    CHECK(attach_allowed(false, true, false));
    // Autre plateau modifié et Orca occupé (découpe, envoi) : refusé, ses réglages iraient dans la nouvelle conversation.
    CHECK_FALSE(attach_allowed(false, true, true));
    // Départ d'une conversation en attente d'écriture : refusé.
    CHECK_FALSE(attach_allowed(true, false, false));
    CHECK_FALSE(attach_allowed(true, true, true));
}

TEST_CASE("Projets : réglages d'impression du plateau à l'attache d'une conversation")
{
    using namespace Plyo::ProjectFilesLogic;
    // Réglages de la pièce de A (écrite ou perdue) : jamais repris par B.
    CHECK(forget_edits_on_attach(true, "A", "B"));
    // A revient sur son propre plateau (perdu : disque plein, trop lourd) : ses réglages, jamais écrits, restent.
    CHECK_FALSE(forget_edits_on_attach(true, "A", "A"));
    // Réglages qui ne sont pas ceux d'un plateau de conversation : rien à oublier.
    CHECK_FALSE(forget_edits_on_attach(false, "", "B"));
    CHECK_FALSE(forget_edits_on_attach(false, "A", "B"));
    // Propriétaire inconnu : prudence, ils ne passent pas à la conversation qui s'attache.
    CHECK(forget_edits_on_attach(true, "", "B"));
}

TEST_CASE("Projets : départ d'une conversation selon l'écriture de son 3MF")
{
    using namespace Plyo::ProjectFilesLogic;
    // Écrit : départ fait, réglages d'impression oubliés si demandé.
    Leave l = leave_after(WriteResult::Ok, true);
    CHECK(l.detached);
    CHECK(l.forget);
    CHECK_FALSE(l.pending);
    CHECK_FALSE(leave_after(WriteResult::Ok, false).forget);
    // Perdu (trop lourd, disque plein, droits) : le plateau n'est plus gardé, rien n'attend, réglages oubliés si demandé.
    l = leave_after(WriteResult::Lost, true);
    CHECK(l.detached);
    CHECK(l.forget);
    CHECK_FALSE(l.pending);
    // Orca occupé : le départ attend, rien n'est oublié.
    l = leave_after(WriteResult::Busy, true);
    CHECK_FALSE(l.detached);
    CHECK_FALSE(l.forget);
    CHECK(l.pending);
    // Seul un vrai état occupé mérite « occupe ».
    CHECK(BUSY_TEXT == std::string("J’attends qu’Orca ait fini ce qu’il fait (découpe, envoi, test ou fenêtre ouverte) pour ranger le projet d’avant ; réessaie dans un instant."));
}

TEST_CASE("Projets : après « occupe » à l'ouverture, rien ne s'applique au plateau de l'autre conversation")
{
    using namespace Plyo::ProjectFilesLogic;
    // Ouverture refusée parce qu'Orca est occupé : le panneau montre B, le plateau est encore celui d'avant.
    CHECK(pending_open_after("B", "occupe") == "B");
    // Ouverte, ou refusée pour une autre raison (absent, abîmé, annulé) : plus rien n'attend.
    CHECK(pending_open_after("B", "").empty());
    CHECK(pending_open_after("B", "absent").empty());
    CHECK(pending_open_after("B", "annule").empty());
    // Réglages, bobine et pièce bloqués tant qu'un départ ou une ouverture attend.
    CHECK(edits_blocked(true, ""));
    CHECK(edits_blocked(false, "B"));
    CHECK(edits_blocked(true, "B"));
    CHECK_FALSE(edits_blocked(false, ""));
}

TEST_CASE("Projets : un 3MF de l'utilisateur ne fait jamais reculer la bobine")
{
    using namespace Plyo::ProjectFilesLogic;
    // Fichier de l'utilisateur chargé, filament d'une bobine remis en « modifié » par Orca : ces valeurs sont oubliées.
    CHECK(drops_loaded_filament_edits(true, true, true));
    // Pas une bobine (préréglage de l'utilisateur) : ses valeurs restent, Orca demandera comme avant.
    CHECK_FALSE(drops_loaded_filament_edits(true, true, false));
    // Rien de modifié, ou nouveau projet vide : rien à faire.
    CHECK_FALSE(drops_loaded_filament_edits(true, false, true));
    CHECK_FALSE(drops_loaded_filament_edits(false, true, true));
}

TEST_CASE("Projets : les réglages ne sont pris sans question que pour fermer, ouvrir ou commencer un projet")
{
    using namespace Plyo::ProjectFilesLogic;
    const std::vector<std::string> project = {"Closing application", "Creating a new project", "Load project"};
    CHECK(project_question("Closing application", project));
    CHECK(project_question("Creating a new project", project));
    CHECK(project_question("Load project", project));
    // Mise à jour des profils, assistant, déconnexion, paquet de configuration, export, instantané : Orca demande.
    CHECK_FALSE(project_question("Configuration updates", project));
    CHECK_FALSE(project_question("User logged out", project));
    CHECK_FALSE(project_question("Configuration package changed", project));
    CHECK_FALSE(project_question("", project));
    CHECK_FALSE(project_question("Load project", {}));
}

TEST_CASE("Bobines : avant de changer de bobine, la bobine en cours est enregistrée, jamais transférée ni jetée")
{
    using namespace Plyo::SpoolsLogic;
    CHECK(flush_before_switch(false, true, false, true) == Flush::Clean);
    CHECK(flush_before_switch(false, false, true, false) == Flush::Clean);
    CHECK(flush_before_switch(true, true, false, true) == Flush::Save);
    // Pas une bobine : Orca garde la main (sa question), comme avant.
    CHECK(flush_before_switch(true, false, false, true) == Flush::NotSpool);
    // Bobine qu'on ne peut pas écrire maintenant (test en cours, températures refusées par Orca) : on ne change rien.
    CHECK(flush_before_switch(true, true, true, true) == Flush::Refuse);
    CHECK(flush_before_switch(true, true, false, false) == Flush::Refuse);
    CHECK(std::string(FLUSH_REFUSED_TEXT).find("bobine") != std::string::npos);
}

TEST_CASE("Bobines : seul un préréglage relié à un profil d'Orca peut devenir une bobine")
{
    using namespace Plyo::SpoolsLogic;
    CHECK(adoptable_material("PLA", false, false, false, true) == "PLA");
    CHECK(adoptable_material("PETG", false, false, false, true) == "PETG");
    // Sans parent système, Orca avertirait à chaque réouverture du 3MF.
    CHECK(adoptable_material("PLA", false, false, false, false).empty());
    CHECK(adoptable_material("PLA", true, false, false, true).empty());
    CHECK(adoptable_material("PLA", false, true, false, true).empty());
    CHECK(adoptable_material("PLA", false, false, true, true).empty());
    CHECK(adoptable_material("PA", false, false, false, true).empty());
    CHECK(adoptable_material("", false, false, false, true).empty());
}

TEST_CASE("Bobines : une réussite dite ne marque qu'un envoi récent, sans réponse, de la bobine nommée")
{
    using namespace Plyo::SpoolsLogic;
    const json pointer = last_sent({{"spool", "b1"}, {"printer", "P"}, {"date", "2026-11-12"}, {"at", "2026-11-12T10:00:00"}});
    CHECK(sent_refusal(pointer, "b1", "2026-11-12T10:30:00") == "");
    CHECK(sent_refusal(pointer, "b1", "2026-11-14T09:59:59") == ""); // moins de 48 h
    CHECK(SENT_MAX_AGE_HOURS == 48);
    CHECK(sent_refusal(pointer, "b1", "2026-11-14T10:00:01") == "old");
    CHECK(sent_refusal(pointer, "b1", "2026-12-01T10:00:00") == "old");
    CHECK(sent_refusal(pointer, "b1", "2026-11-11T08:00:00") == "old"); // instant dans le futur : horloge douteuse
    CHECK(sent_refusal(pointer, "b1", "pas une date") == "old");
    // Fin de mois et d'année.
    const json eoy = last_sent({{"spool", "b1"}, {"printer", "P"}, {"date", "2026-12-31"}, {"at", "2026-12-31T23:00:00"}});
    CHECK(sent_refusal(eoy, "b1", "2027-01-01T01:00:00") == "");
    CHECK(sent_refusal(eoy, "b1", "2027-01-03T00:00:00") == "old");
    // Autre bobine que celle de la conversation : refusé.
    CHECK(sent_refusal(pointer, "b2", "2026-11-12T10:30:00") == "other");
    CHECK(sent_refusal(pointer, "", "2026-11-12T10:30:00") == "other");
    CHECK(sent_refusal(json::object(), "b1", "2026-11-12T10:30:00") == "none");
    // Envoi déjà déclaré raté : une réussite dite ensuite ne le marque plus.
    const json bad = answered(pointer, "bad");
    CHECK(bad["answered"] == "bad");
    CHECK(last_sent(bad) == bad);
    CHECK(sent_refusal(bad, "b1", "2026-11-12T10:30:00") == "answered");
    CHECK(answered(pointer, "autre") == pointer);
    CHECK(answered(json::object(), "bad").empty());
}

TEST_CASE("Messages d'Orca : le texte montré n'a ni chemin de l'utilisateur ni caractère de contrôle, et reste court")
{
    using namespace Plyo::OrcaMessagesLogic;
    // Le fichier exporté connu : remplacé par son nom, même suivi de « .tmp » ou avec des espaces dans le dossier.
    const std::string file = "/Users/Jérôme Lagny/Desktop/crochet PLA.gcode";
    CHECK(clean_text("Renaming failed. Current path is " + file + ".tmp. Please try again.", {file, "/Users/Jérôme Lagny"}) ==
          "Renaming failed. Current path is crochet PLA.gcode.tmp. Please try again.");
    // Un dossier connu suivi d'un sous-dossier : réduit au nom du fichier.
    CHECK(clean_text("Copie vers /Users/moi/Documents/pieces/x.gcode impossible", {"/Users/moi"}) == "Copie vers x.gcode impossible");
    // Chemins inconnus sans espace (Unix, Windows, réseau), entre guillemets ou en fin de phrase.
    CHECK(clean_text("G-code export to /var/folders/ab/T/plyo.gcode failed.\nIs the disk full?") == "G-code export to plyo.gcode failed. Is the disk full?");
    CHECK(clean_text("Fichier « C:\\Users\\moi\\Bureau\\a.gcode » protégé") == "Fichier « a.gcode » protégé");
    CHECK(clean_text("(\\\\serveur\\partage\\b.gcode)") == "(b.gcode)");
    CHECK(clean_text("Erreur dans ~/plyo/c.3mf.") == "Erreur dans c.3mf.");
    // Ce qui n'est pas un chemin absolu reste tel quel.
    CHECK(clean_text("Mélange PLA/PETG détecté, 1/2 couche") == "Mélange PLA/PETG détecté, 1/2 couche");
    // Contrôles retirés, espaces resserrées, 300 octets au plus sans couper un caractère.
    CHECK(clean_text("  a\t\tb\r\n c\x01" "d\x7F  ") == "a b cd");
    const std::string longer = clean_text(std::string(299, 'x') + "é");
    CHECK(longer.size() == 299);
    CHECK(clean_text(std::string(500, 'y')).size() == MAX_TEXT);
}

TEST_CASE("Messages d'Orca : le code d'une erreur de découpe vient du type et de l'étape, jamais du texte")
{
    using namespace Plyo::OrcaMessagesLogic;
    CHECK(slicing_code("SlicingError", {"posSlice", false, false}) == "no_layers");
    CHECK(slicing_code("SlicingError", {"psGCodeExport", true, false}) == "empty_first_layer");
    CHECK(slicing_code("SlicingErrors", {"psGCodeExport", true, false}) == "empty_first_layer");
    CHECK(slicing_code("SlicingError", {"psGCodeExport", false, false}) == "nothing_to_print");
    CHECK(slicing_code("SlicingError", {"psWipeTower", false, false}) == "print_empty");
    CHECK(slicing_code("SlicingError", {"psWipeTower", false, true}) == "prime_tower");
    CHECK(slicing_code("SlicingError", {"psSkirtBrim", false, false}) == "skirt_brim");
    CHECK(slicing_code("SlicingError", {"", false, false}) == "SlicingError");
    // Les autres types gardent leur nom : l'étape ne change rien.
    CHECK(slicing_code("PlaceholderParserError", {"psGCodeExport", false, false}) == "PlaceholderParserError");
    CHECK(slicing_code("bad_alloc", {"posSlice", false, false}) == "bad_alloc");
    CHECK(slicing_code("", {}) == "unknown");
}

TEST_CASE("Messages d'Orca : le code d'un refus de validation, d'un avertissement d'étape et d'un export")
{
    using namespace Plyo::OrcaMessagesLogic;
    CHECK(validate_code(1, "", false, {}) == "filament_bed_type");
    CHECK(validate_code(3, "", true, {}) == "collision_by_object");
    CHECK(validate_code(4, "", true, {}) == "collision");
    CHECK(validate_code(5, "layer_height", true, {true, false, false}) == "layer_height_limit");
    CHECK(validate_code(0, "layer_height", true, {true, false, false}) == "layer_height_over_nozzle");
    CHECK(validate_code(0, "initial_layer_print_height", true, {true, false, false}) == "layer_height_over_nozzle");
    // Même clé, autre cause (tour de purge et hauteurs différentes) : la clé seule.
    CHECK(validate_code(0, "initial_layer_print_height", true, {false, false, false}) == "initial_layer_print_height");
    CHECK(validate_code(0, "spiral_mode", false, {false, true, false}) == "vase_several_objects");
    CHECK(validate_code(0, "spiral_mode", false, {false, false, false}) == "spiral_mode");
    CHECK(validate_code(0, "", true, {false, false, true}) == "object_too_tall");
    CHECK(validate_code(0, "", false, {false, false, true}) == "validate");
    CHECK(validate_code(0, "enable_prime_tower", false, {}) == "enable_prime_tower");
    CHECK(validate_code(0, "", false, {}) == "validate");
    CHECK(step_warning_code(2) == "need_support");
    CHECK(step_warning_code(3) == "empty_layers");
    CHECK(step_warning_code(5) == "exclusion_area");
    CHECK(step_warning_code(0) == "step_warning");
    CHECK(step_warning_code(42) == "step_warning");
    CHECK(export_kind("ExportError") == "write");
    CHECK(export_kind("FileIOError") == "write");
    CHECK(export_kind("PlaceholderParserError") == "gcode_template");
    CHECK(export_kind("SlicingErrors") == "slicing");
    CHECK(export_kind("bad_alloc") == "memory");
    CHECK(export_kind("RuntimeError") == "other");
    CHECK(safe_layer_height(0.4) == Catch::Approx(0.2));
    CHECK(safe_layer_height(0.2) == Catch::Approx(0.1));
    CHECK(safe_layer_height(0.6) == Catch::Approx(0.3));
    CHECK(safe_layer_height(1.0) == Catch::Approx(0.3));
    CHECK(safe_layer_height(0.0) == 0);
}

namespace {
Plyo::OrcaMessagesLogic::Issue issue(const std::string& source, const std::string& code, const std::string& level, const std::string& text)
{
    Plyo::OrcaMessagesLogic::Issue i;
    i.source = source;
    i.code   = code;
    i.level  = level;
    i.text   = text;
    return i;
}
} // namespace

TEST_CASE("Messages d'Orca : dix au plus, les erreurs d'abord, sans doublon ni champ vide")
{
    using namespace Plyo::OrcaMessagesLogic;
    std::vector<Issue> list;
    for (int i = 0; i < 12; ++i)
        list.push_back(issue("step_warning", "empty_layers", "warning", "avertissement " + std::to_string(i)));
    list.push_back(issue("validate_warning", "enable_support", "warning", "doublon"));
    list.push_back(issue("validate_warning", "enable_support", "warning", "doublon"));
    Issue err = issue("validate_error", "layer_height_over_nozzle", "error", "Layer height cannot exceed nozzle diameter.");
    err.opt_key     = "layer_height";
    err.scope       = "print";
    err.object_ref  = "12";
    err.object_name = "Cube";
    err.fix = {{"key", "layer_height"}, {"value", 0.2}};
    list.push_back(err);
    const json out = to_json(list);
    REQUIRE(out.size() == MAX_ISSUES);
    CHECK(out[0]["code"] == "layer_height_over_nozzle");
    CHECK(out[0]["object_ref"] == "12");
    CHECK(out[0]["scope"] == "print");
    CHECK(out[0]["fix"]["value"] == 0.2);
    CHECK(out[1]["code"] == "empty_layers");
    CHECK(!out[1].contains("opt_key"));
    CHECK(!out[1].contains("object_ref"));
    CHECK(!out[1].contains("fix"));
    CHECK(has_error(out));
    CHECK(!has_error(to_json({list[0]})));
    CHECK(!has_error(json()));
    CHECK(to_json({list[12], list[13]}).size() == 1);
    CHECK(to_json({issue("x", "", "error", "sans code")}).empty());
}

// --- Lot 3 de l'audit : règles d'Orca avant l'écriture, relecture, annulation, dernière barrière ---

namespace {

// État d'un profil d'impression ordinaire (valeurs comme Orca les écrit).
Plyo::ConfigRules::Values plain_print()
{
    return {{"spiral_mode", "0"},           {"wall_loops", "3"},        {"top_shell_layers", "5"},     {"sparse_infill_density", "15%"},
            {"enable_support", "0"},        {"enforce_support_layers", "0"}, {"detect_thin_wall", "0"}, {"overhang_reverse", "0"},
            {"timelapse_type", "0"},        {"enable_wrapping_detection", "0"}, {"alternate_extra_wall", "0"},
            {"ensure_vertical_shell_thickness", "ensure_all"}, {"seam_slope_type", "none"}, {"seam_slope_start_height", "0"},
            {"layer_height", "0.2"},        {"initial_layer_print_height", "0.2"}, {"infill_lock_depth", "1"}, {"skin_infill_depth", "2"},
            {"fuzzy_skin_mode", "displacement"}, {"wall_generator", "classic"}, {"ironing_spacing", "0.1"}, {"support_ironing_spacing", "0.1"},
            {"xy_hole_compensation", "0"},  {"xy_contour_compensation", "0"}, {"elefant_foot_compensation", "0.15"},
            {"raft_layers", "0"},           {"draft_shield", "disabled"}};
}

std::string title_of(const std::string& key) { return key == "spiral_mode" ? "Vase spirale" : key == "wall_loops" ? "Parois" : std::string(); }

const Plyo::ConfigRules::Added* added(const Plyo::ConfigRules::Outcome& o, const std::string& key)
{
    for (const auto& a : o.added)
        if (a.key == key)
            return &a;
    return nullptr;
}

std::string read_source(const std::string& relative)
{
    boost::nowide::ifstream in((fs::path(__FILE__).parent_path() / relative).string());
    REQUIRE(in.good());
    return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

} // namespace

TEST_CASE("Règles d'Orca : le mode vase demandé seul est complété avec tout ce qu'Orca exigerait")
{
    using namespace Plyo::ConfigRules;
    Values state           = plain_print();
    state["spiral_mode"]   = "1";
    const Outcome o        = complete(state, {"spiral_mode"}, true, false, false, title_of);
    REQUIRE(o.ok);
    // Seuls les réglages qui diffèrent : parois, couches du dessus, remplissage (le reste est déjà comme il faut).
    REQUIRE(o.added.size() == 3);
    REQUIRE(added(o, "wall_loops"));
    CHECK(added(o, "wall_loops")->value == 1);
    CHECK(added(o, "wall_loops")->trigger == "spiral_mode");
    CHECK(added(o, "top_shell_layers")->serialized == "0");
    CHECK(added(o, "sparse_infill_density")->value == "0%");
    CHECK(added(o, "enable_support") == nullptr);

    // Supports actifs et timelapse fluide : complétés aussi (le timelapse n'est pas au catalogue : le pont refusera).
    state["enable_support"] = "1";
    state["timelapse_type"] = "1";
    const Outcome more      = complete(state, {"spiral_mode"}, true, false, false, title_of);
    REQUIRE(more.ok);
    CHECK(added(more, "enable_support")->value == false);
    CHECK(added(more, "timelapse_type")->serialized == "0");
}

TEST_CASE("Règles d'Orca : mode vase en conflit avec le lot, ou déjà actif, refusé avec une phrase claire")
{
    using namespace Plyo::ConfigRules;
    Values state         = plain_print();
    state["spiral_mode"] = "1";
    // Le lot demande le mode vase ET 3 parois : Orca changerait l'une ou l'autre.
    const Outcome both = complete(state, {"spiral_mode", "wall_loops"}, true, false, false, title_of);
    CHECK_FALSE(both.ok);
    CHECK(both.text.find("Refusé : le mode vase") == 0);
    CHECK(both.text.find("« Parois »") != std::string::npos);
    CHECK(both.text.find("Aucune modification appliquée.") != std::string::npos);
    // Mode vase déjà actif (cohérent), le lot ajoute des parois.
    state["wall_loops"] = "1"; state["top_shell_layers"] = "0"; state["sparse_infill_density"] = "0%";
    CHECK(complete(state, {"layer_height"}, true, false, false, title_of).ok);
    state["wall_loops"] = "2";
    const Outcome on = complete(state, {"wall_loops"}, true, false, false, title_of);
    CHECK_FALSE(on.ok);
    CHECK(on.text.find("Désactive d'abord le mode vase") != std::string::npos);
    // Onglet Impression non touché : Orca ne relance pas ses contrôles.
    CHECK(complete(state, {"nozzle_temperature"}, false, true, false, title_of).ok);
}

TEST_CASE("Règles d'Orca : peau irrégulière, paroi alternée, biseau, verrouillage, compensations")
{
    using namespace Plyo::ConfigRules;
    Values state             = plain_print();
    state["fuzzy_skin_mode"] = "extrusion";
    const Outcome fuzzy      = complete(state, {"fuzzy_skin_mode"}, true, false, false, title_of);
    REQUIRE(fuzzy.ok);
    CHECK(added(fuzzy, "wall_generator")->value == "arachne");
    // Le lot demande lui-même le générateur classique : refus, rien n'est complété contre lui.
    CHECK_FALSE(complete(state, {"fuzzy_skin_mode", "wall_generator"}, true, false, false, title_of).ok);
    state["wall_generator"] = "arachne";
    CHECK(complete(state, {"fuzzy_skin_mode"}, true, false, false, title_of).added.empty());

    state                        = plain_print();
    state["alternate_extra_wall"] = "1";
    const Outcome alt            = complete(state, {"alternate_extra_wall"}, true, false, false, title_of);
    REQUIRE(alt.ok);
    CHECK(added(alt, "ensure_vertical_shell_thickness")->value == "ensure_moderate");
    CHECK_FALSE(complete(state, {"ensure_vertical_shell_thickness"}, true, false, false, title_of).ok);

    state                            = plain_print();
    state["seam_slope_type"]         = "external";
    state["seam_slope_start_height"] = "0.2";
    CHECK_FALSE(complete(state, {"seam_slope_start_height"}, true, false, false, title_of).ok); // égale à la couche
    state["seam_slope_start_height"] = "0.1";
    CHECK(complete(state, {"seam_slope_start_height"}, true, false, false, title_of).ok);
    state["seam_slope_start_height"] = "100%"; // en % de la couche
    CHECK_FALSE(complete(state, {"seam_slope_start_height"}, true, false, false, title_of).ok);
    state["seam_slope_start_height"] = "50%";
    state["layer_height"]            = "0.08";
    CHECK(complete(state, {"layer_height"}, true, false, false, title_of).ok);

    state                      = plain_print();
    state["infill_lock_depth"] = "3";
    CHECK_FALSE(complete(state, {"infill_lock_depth"}, true, false, false, title_of).ok);
    state                         = plain_print();
    state["xy_hole_compensation"] = "-2.5";
    CHECK(complete(state, {"xy_hole_compensation"}, true, false, false, title_of).text.find("l'échelle") != std::string::npos);
    state                              = plain_print();
    state["elefant_foot_compensation"] = "1.2";
    CHECK_FALSE(complete(state, {"elefant_foot_compensation"}, true, false, false, title_of).ok);
    state                    = plain_print();
    state["ironing_spacing"] = "0.04";
    CHECK_FALSE(complete(state, {"ironing_spacing"}, true, false, false, title_of).ok);
    state                = plain_print();
    state["raft_layers"] = "2";
    CHECK(complete(state, {"raft_layers"}, true, false, false, title_of).ok);
    CHECK_FALSE(complete(state, {"raft_layers"}, true, false, true, title_of).ok); // imprimante à tapis
}

TEST_CASE("Règles d'Orca : débit volumique et espacement du lissage du filament")
{
    using namespace Plyo::ConfigRules;
    CHECK_FALSE(complete({{"filament_max_volumetric_speed", "0"}}, {"filament_max_volumetric_speed"}, false, true, false, title_of).ok);
    CHECK_FALSE(complete({{"filament_max_volumetric_speed", "0.4,0.4"}}, {"filament_max_volumetric_speed"}, false, true, false, title_of).ok);
    CHECK(complete({{"filament_max_volumetric_speed", "0.5"}}, {"filament_max_volumetric_speed"}, false, true, false, title_of).ok);
    CHECK(complete({{"filament_ironing_spacing", "nil"}}, {"nozzle_temperature"}, false, true, false, title_of).ok);
    CHECK_FALSE(complete({{"filament_ironing_spacing", "0.01"}}, {"filament_ironing_spacing"}, false, true, false, title_of).ok);
    // Onglet Filament non touché : rien n'est vérifié.
    CHECK(complete({{"filament_max_volumetric_speed", "0"}}, {"wall_loops"}, true, false, false, title_of).ok);
}

TEST_CASE("Couples de températures : la première couche suit le changement, sinon refus qui dit quoi ajouter")
{
    using namespace Plyo::ConfigRules;
    const std::vector<PairKeys> pairs = {{"nozzle_temperature_initial_layer", "nozzle_temperature", 30}, {"hot_plate_temp_initial_layer", "hot_plate_temp", 15}};
    const auto                  t     = [](const std::string&) { return std::string(); };
    // Plateau 65 / 55 (10 d'écart) ; l'IA baisse les couches suivantes à 45 : écart 20, la première couche suit (55).
    const std::map<std::string, int> before = {{"hot_plate_temp_initial_layer", 65}, {"hot_plate_temp", 55}, {"nozzle_temperature_initial_layer", 220}, {"nozzle_temperature", 215}};
    std::map<std::string, int>       after  = before;
    after["hot_plate_temp"]                 = 45;
    const Outcome follow                    = temperature_pairs(pairs, before, after, {"hot_plate_temp"}, t);
    REQUIRE(follow.ok);
    REQUIRE(follow.added.size() == 1);
    CHECK(follow.added[0].key == "hot_plate_temp_initial_layer");
    CHECK(follow.added[0].value == 55);
    CHECK(follow.added[0].trigger == "hot_plate_temp");
    CHECK(follow.added[0].scope == "filament");
    // Petit changement : écart toujours permis, rien n'est ajouté.
    after["hot_plate_temp"] = 52;
    CHECK(temperature_pairs(pairs, before, after, {"hot_plate_temp"}, t).added.empty());
    // La première couche seule s'éloigne trop : refus qui dit d'ajouter les couches suivantes.
    after                                 = before;
    after["nozzle_temperature_initial_layer"] = 250;
    const Outcome alone                   = temperature_pairs(pairs, before, after, {"nozzle_temperature_initial_layer"}, t);
    CHECK_FALSE(alone.ok);
    CHECK(alone.text.find("Change aussi « nozzle_temperature »") != std::string::npos);
    // Les deux changés et trop loin : refus.
    after["nozzle_temperature"] = 200;
    CHECK_FALSE(temperature_pairs(pairs, before, after, {"nozzle_temperature_initial_layer", "nozzle_temperature"}, t).ok);
    // Couple non touché par le lot : pas vérifié ici (save_applied le couvre).
    after = before;
    after["hot_plate_temp"] = 10;
    CHECK(temperature_pairs(pairs, before, after, {"nozzle_temperature"}, t).ok);
}

TEST_CASE("Relecture après l'écriture : valeurs remises par Orca, réglages changés en plus")
{
    using namespace Plyo::ConfigRules;
    const Verdict v = verify({{"print/spiral_mode", {"1", "0"}}, {"print/layer_height", {"0.2", "0.2"}}},
                             {"print/layer_height", "print/wall_loops", "print/detect_overhang_wall"});
    CHECK(v.refused == std::vector<std::string>{"print/spiral_mode"});
    CHECK(v.also == std::vector<std::string>{"print/detect_overhang_wall", "print/wall_loops"});
    CHECK(verify({{"filament/x", {"1", "1"}}}, {"filament/x"}).also.empty());
}

TEST_CASE("Annulation : un réglage retouché à la main depuis le lot n'est pas écrasé")
{
    using Plyo::ConfigRules::retouched;
    CHECK(retouched({{"filament/nozzle_temperature", "205"}, {"print/wall_loops", "3"}},
                    {{"filament/nozzle_temperature", "210"}, {"print/wall_loops", "3"}}) == std::vector<std::string>{"filament/nozzle_temperature"});
    CHECK(retouched({{"filament/nozzle_temperature", ""}}, {{"filament/nozzle_temperature", "210"}}).empty()); // inconnu : jamais compté
}

TEST_CASE("Règles d'Orca : les conditions recopiées sont toujours celles d'Orca (test de source)")
{
    // Si ce test échoue, Orca a changé une règle qui ouvre une fenêtre pendant l'écriture : mettre PlyoConfigRulesLogic à jour.
    const std::string src  = read_source("../../../../src/slic3r/GUI/ConfigManipulation.cpp");
    const size_t      from = src.find("void ConfigManipulation::update_print_fff_config(");
    const size_t      to   = src.find("void ConfigManipulation::apply_null_fff_config(");
    REQUIRE(from != std::string::npos);
    REQUIRE(to > from);
    const std::string body = src.substr(from, to - from);
    for (const char* needle : {
             "belt_opt->value && (has_raft || has_shield)",
             "if (layer_height < EPSILON)",
             "config->opt_float(\"ironing_spacing\") < IRONING_SPACING_MIN",
             "config->opt_float(\"support_ironing_spacing\") < IRONING_SPACING_MIN",
             "config->option<ConfigOptionFloat>(\"initial_layer_print_height\")->value < EPSILON",
             "abs(config->option<ConfigOptionFloat>(\"xy_hole_compensation\")->value) > 2",
             "abs(config->option<ConfigOptionFloat>(\"xy_contour_compensation\")->value) > 2",
             "config->option<ConfigOptionFloat>(\"elefant_foot_compensation\")->value > 1",
             "config->opt_bool(\"spiral_mode\") &&",
             "! (config->opt_int(\"wall_loops\") == 1 &&",
             "config->opt_int(\"top_shell_layers\") == 0 &&",
             "sparse_infill_density == 0 &&",
             "! config->opt_bool(\"enable_support\") &&",
             "config->opt_int(\"enforce_support_layers\") == 0 &&",
             "! config->opt_bool(\"detect_thin_wall\") &&",
             "! config->opt_bool(\"overhang_reverse\") &&",
             "config->opt_enum<TimelapseType>(\"timelapse_type\") == TimelapseType::tlTraditional &&",
             "!config->opt_bool(\"enable_wrapping_detection\")))",
             "if (config->opt_bool(\"alternate_extra_wall\") &&",
             "(config->opt_enum<EnsureVerticalShellThickness>(\"ensure_vertical_shell_thickness\") == evstAll))",
             "new ConfigOptionEnum<EnsureVerticalShellThickness>(evstModerate)",
             "config->opt_enum<SeamScarfType>(\"seam_slope_type\") != SeamScarfType::None &&",
             "config->get_abs_value(\"seam_slope_start_height\") >= layer_height",
             "if (config->opt_float(\"infill_lock_depth\") > skin_depth)",
             "config->opt_enum<FuzzySkinMode>(\"fuzzy_skin_mode\") != FuzzySkinMode::Displacement && !have_arachne",
             "new ConfigOptionEnum<PerimeterGeneratorType>(PerimeterGeneratorType::Arachne)",
         }) {
        INFO(needle);
        CHECK(body.find(needle) != std::string::npos);
    }
    // Aucune nouvelle fenêtre dans la fonction (une de plus : une règle à reprendre). Le vase a sa propre fenêtre.
    size_t dialogs = 0;
    for (size_t at = body.find("MessageDialog "); at != std::string::npos; at = body.find("MessageDialog ", at + 1))
        ++dialogs;
    CHECK(dialogs == 14); // dont celle de la tour de purge, désactivée par #if 0, et celle du mélange de couleurs (sans changement)
    CHECK(body.find("show_spiral_mode_settings_dialog(is_object_config)") != std::string::npos);

    // Filament : seuls ces deux contrôles tournent dans TabFilament::update (appelé par Tab::load_config).
    CHECK(src.find("if (max_volumetric_speed < 0.5)") != std::string::npos);
    CHECK(src.find("if (!opt->is_nil(i) && values[i] < IRONING_SPACING_MIN)") != std::string::npos);
    const std::string tab   = read_source("../../../../src/slic3r/GUI/Tab.cpp");
    const size_t      fupd  = tab.find("void TabFilament::update()");
    REQUIRE(fupd != std::string::npos);
    const std::string fbody = tab.substr(fupd, 400);
    CHECK(fbody.find("m_config_manipulation.check_filament_max_volumetric_speed(m_config);") != std::string::npos);
    CHECK(fbody.find("m_config_manipulation.check_filament_ironing_spacing(m_config);") != std::string::npos);
    const size_t lc = tab.find("void Tab::load_config(const DynamicPrintConfig& config)");
    REQUIRE(lc != std::string::npos);
    CHECK(tab.substr(lc, 500).find("update();") != std::string::npos);

    // Constantes et noms des choix écrits par les compléments.
    const std::string cfg = read_source("../../../../src/libslic3r/PrintConfig.hpp");
    CHECK(cfg.find("constexpr double IRONING_SPACING_MIN = 0.05;") != std::string::npos);
    const std::string cpp = read_source("../../../../src/libslic3r/PrintConfig.cpp");
    for (const char* needle : {"{ \"ensure_all\",         int(EnsureVerticalShellThickness::evstAll) }",
                               "{ \"ensure_moderate\",            int(EnsureVerticalShellThickness::evstModerate) }",
                               "{ \"arachne\", int(PerimeterGeneratorType::Arachne) }", "{ \"displacement\",   int(FuzzySkinMode::Displacement) }",
                               "{ \"none\",           int(SeamScarfType::None) }", "{\"0\",       tlTraditional}", "{ \"disabled\", dsDisabled }"}) {
        INFO(needle);
        CHECK(cpp.find(needle) != std::string::npos);
    }
}

namespace {
Plyo::Catalog::Policy real_policy()
{
    const std::string policy = read_source("../../../../resources/plyo/policy.json");
    const std::string keys   = read_source("../../../../resources/plyo/catalog-keys.json");
    return Plyo::Catalog::Policy::from_json(json::parse(policy), json::parse(keys));
}
} // namespace

TEST_CASE("Dernière barrière : bornes strictes, jamais levées par une confirmation")
{
    using namespace Plyo::Catalog;
    // Diamètre du filament : 1,5 à 3,1 mm.
    CHECK_FALSE(check_hard("Diamètre", "filament_diameter", info("float", 0), 4.0, 1.75, 0.4).ok);
    CHECK(check_hard("Diamètre", "filament_diameter", info("float", 0), 1.8, 1.75, 0.4).ok);
    // Hauteurs de couche : 75 % de la buse au plus, première couche comprise.
    CHECK_FALSE(check_hard("Couche", "layer_height", info("float", 0), 0.32, 0.2, 0.4).ok);
    CHECK_FALSE(check_hard("Première couche", "initial_layer_print_height", info("float", 0), 0.35, 0.2, 0.4).ok);
    CHECK(check_hard("Première couche", "initial_layer_print_height", info("float", 0), 0.3, 0.2, 0.4).ok);
    CHECK(check_hard("Première couche", "initial_layer_print_height", info("float", 0), 0.5, 0.2, 0).ok); // buse inconnue
    // Températures : buse 170 à 300 °C (sauf -1 de la tour), plateau 0 à 110 °C.
    CHECK_FALSE(check_hard("Buse", "nozzle_temperature", info("int"), 160, 215, 0.4).ok);
    CHECK_FALSE(check_hard("Buse", "nozzle_temperature_initial_layer", info("int"), 305, 215, 0.4).ok);
    CHECK(check_hard("Tour", "filament_tower_interface_print_temp", info("int"), -1, 215, 0.4).ok);
    CHECK_FALSE(check_hard("Plateau", "textured_plate_temp", info("int"), 115, 60, 0.4).ok);
    // « mm ou % » : on reste dans l'unité d'aujourd'hui.
    CHECK_FALSE(check_hard("Largeur", "line_width", info("float_or_percent"), 40, "100%", 0.4).ok);
    CHECK_FALSE(check_hard("Largeur", "line_width", info("float_or_percent"), "40%", 0.42, 0.4).ok);
    CHECK(check_hard("Largeur", "line_width", info("float_or_percent"), "110%", "100%", 0.4).ok);
    CHECK(check_hard("Largeur", "line_width", info("float_or_percent"), 0.45, 0.42, 0.4).ok);
}

TEST_CASE("Dernière barrière : écart maximal comme le service (REL_DELTA, plancher, températures)")
{
    using namespace Plyo::Catalog;
    // Vitesse 200 mm/s : 30 % soit 60.
    CHECK(max_delta("outer_wall_speed", info("float", 1), 200) == Catch::Approx(60));
    CHECK_FALSE(check_delta("Parois externes", "outer_wall_speed", info("float", 1), 3000, 200).ok);
    CHECK(check_delta("Parois externes", "outer_wall_speed", info("float", 1), 250, 200).ok);
    // Entier de plage 0–1000 : plancher de 10.
    CHECK(max_delta("wall_loops", info("int", 0, 1000), 2) == Catch::Approx(10));
    // Pourcentage 0–100 : plancher de 15 points.
    CHECK(max_delta("sparse_infill_density", info("percent", 0, 100), 15) == Catch::Approx(15));
    CHECK_FALSE(check_delta("Remplissage", "sparse_infill_density", info("percent", 0, 100), "50%", "15%").ok);
    // Températures : 15 °C (buse), 10 °C (plateau).
    CHECK(max_delta("nozzle_temperature", info("int", 0, 1500), 215) == Catch::Approx(15));
    CHECK(max_delta("hot_plate_temp", info("int", 0, 300), 60) == Catch::Approx(10));
    // Diamètre : 0,1 mm.
    CHECK(max_delta("filament_diameter", info("float", 0), 1.75) == Catch::Approx(0.1));
    // Débit volumique à 0 depuis 12 : trop loin d'un coup.
    CHECK_FALSE(check_delta("Débit volumique", "filament_max_volumetric_speed", info("float", 0), 0, 12).ok);
    // Valeur actuelle inconnue sans bornes : refus ; avec bornes : permis.
    CHECK_FALSE(check_delta("X", "x", info("float", 0), 3, nullptr).ok);
    CHECK(check_delta("X", "x", info("float", 0, 10), 3, nullptr).ok);
}

TEST_CASE("Dernière barrière : confirmation exigée pour les réglages sensibles et les grands écarts")
{
    using namespace Plyo::Catalog;
    const Policy policy = real_policy();
    // IA-20 : mode vase, impression pièce par pièce et contrôle du caisson passent en confirmation.
    CHECK(requires_confirmation(policy, "spiral_mode"));
    CHECK(requires_confirmation(policy, "print_sequence"));
    CHECK(requires_confirmation(policy, "activate_chamber_temp_control"));
    CHECK(requires_confirmation(policy, "nozzle_temperature"));
    CHECK(requires_confirmation(policy, "filament_flow_ratio"));
    CHECK_FALSE(requires_confirmation(policy, "wall_loops"));

    // Scénario de l'audit : 3000 mm/s sans confirmation, refusé ; « needs_confirmation » dit qu'une confirmation suffirait.
    const Verdict fast = check_barrier(policy, "Vitesse", "outer_wall_speed", info("float", 1), 3000, 200, 0.4, no_limits, false, false);
    CHECK_FALSE(fast.check.ok);
    CHECK(fast.code == "needs_confirmation");
    // Ligne cochée à la main : l'écart est levé.
    CHECK(check_barrier(policy, "Parois", "wall_loops", info("int", 0, 1000), 20, 2, 0.4, no_limits, false, true).check.ok);
    // Réglage sensible : jamais sans confirmation, même un petit pas.
    const Verdict spiral = check_barrier(policy, "Vase", "spiral_mode", info("bool"), true, false, 0.4, no_limits, false, false);
    CHECK_FALSE(spiral.check.ok);
    CHECK(spiral.code == "needs_confirmation");
    CHECK(check_barrier(policy, "Vase", "spiral_mode", info("bool"), true, false, 0.4, no_limits, false, true).check.ok);
    // Borne stricte : la confirmation n'y change rien, et ce n'est pas une affaire de confirmation.
    const Verdict hot = check_barrier(policy, "Buse", "nozzle_temperature", info("int", 0, 1500), 320, 290, 0.4, no_limits, true, true);
    CHECK_FALSE(hot.check.ok);
    CHECK(hot.code.empty());
}

TEST_CASE("Dernière barrière : chaque parcours légitime passe, avec la confirmation qu'il porte")
{
    using namespace Plyo::Catalog;
    const Policy policy = real_policy();
    const auto   pass   = [&](const std::string& key, const OptionInfo& i, const json& value, const json& current, bool confirmed) {
        return check_barrier(policy, key, key, i, value, current, 0.4, no_limits, false, confirmed).check.ok;
    };
    // Questions d'intention (table du panneau, bouton « Appliquer et préparer ») : de 15 % à 50 % de remplissage.
    CHECK_FALSE(pass("sparse_infill_density", info("percent", 0, 100), "50%", "15%", false));
    CHECK(pass("sparse_infill_density", info("percent", 0, 100), "50%", "15%", true));
    CHECK(pass("layer_height", info("float", 0, 1), 0.12, 0.28, true));
    // Carte d'Orca « Mettre la hauteur de couche à 0,2 mm » (de 0,4) et « Désactiver le mode vase » : le bouton annonce la valeur.
    CHECK(pass("layer_height", info("float", 0, 1), 0.2, 0.4, true));
    CHECK(pass("spiral_mode", info("bool"), false, true, true));
    // « Remettre Température de la buse à 215 » après une annulation refusée.
    CHECK(pass("nozzle_temperature", info("int", 0, 1500), 215, 240, true));
    // Adaptation d'un 3MF de l'utilisateur : ses propres valeurs, confirmées par son fichier ; la borne stricte reste.
    CHECK(pass("wall_loops", info("int", 0, 1000), 30, 2, true));
    CHECK_FALSE(pass("layer_height", info("float", 0, 1), 0.36, 0.2, true));
    // Réponse de l'IA, ligne cochée par défaut : petit écart, pas de confirmation nécessaire.
    CHECK(pass("wall_loops", info("int", 0, 1000), 3, 2, false));
}

// --- Correctifs du banc réel : découpe après un réglage, fin de découpe, réglages laissés par le mode vase ---

TEST_CASE("Découpe demandée après un réglage : elle attend que la minuterie d'Orca soit passée, 3 s au plus")
{
    using Plyo::OrcaMessagesLogic::slice_must_wait;
    CHECK(slice_must_wait(true, 0, 3000));      // réglage changé à l'instant : Orca ne l'a pas encore lu
    CHECK(slice_must_wait(true, 2900, 3000));
    CHECK_FALSE(slice_must_wait(true, 3000, 3000)); // attente bornée : on découpe quand même
    CHECK_FALSE(slice_must_wait(false, 0, 3000));   // rien en attente : tout de suite
}

TEST_CASE("Fin de découpe : la minuterie d'Orca en attente n'est pas une autre découpe")
{
    using namespace Plyo::OrcaMessagesLogic;
    CHECK(finish_read(true, false, 0, 12) == FinishRead::Skip);  // « Tout découper » : la plaque suivante parlera
    CHECK(finish_read(true, true, 0, 12) == FinishRead::Skip);
    CHECK(finish_read(false, true, 0, 12) == FinishRead::Retry); // minuterie seule : on relit plus tard, sans abandonner
    CHECK(finish_read(false, true, 11, 12) == FinishRead::Retry);
    CHECK(finish_read(false, true, 12, 12) == FinishRead::Send); // toujours en attente au bout de 3 s : on envoie quand même
    CHECK(finish_read(false, false, 0, 12) == FinishRead::Send);
}

TEST_CASE("Mode vase désactivé : les réglages qu'il avait imposés sont remis à la valeur de référence")
{
    using namespace Plyo::ConfigRules;
    Values reference = plain_print();          // profil : 3 parois, 5 couches du dessus, 15 %
    reference["detect_thin_wall"] = "1";
    Values now = reference;                     // ce que le mode vase a laissé
    now["wall_loops"]            = "1";
    now["top_shell_layers"]      = "0";
    now["sparse_infill_density"] = "0%";
    now["detect_thin_wall"]      = "0";
    const auto out = spiral_leftovers(now, reference);
    REQUIRE(out.size() == 4);
    CHECK(out[0] == std::make_pair(std::string("wall_loops"), std::string("3")));
    CHECK(out[1] == std::make_pair(std::string("top_shell_layers"), std::string("5")));
    CHECK(out[2] == std::make_pair(std::string("sparse_infill_density"), std::string("15%")));
    CHECK(out[3] == std::make_pair(std::string("detect_thin_wall"), std::string("1")));
    // Retouché à la main depuis (2 parois) : ce n'est plus la valeur du mode vase, on n'y touche pas.
    now["wall_loops"] = "2";
    CHECK(spiral_leftovers(now, reference).size() == 3);
    // Le profil lui-même a 0 couche du dessus : rien à remettre pour elle (pas de valeur à inventer).
    reference["top_shell_layers"] = "0";
    for (const auto& [key, text] : spiral_leftovers(now, reference))
        CHECK(key != "top_shell_layers");
    // « 0 » et « 0% » sont le même remplissage nul ; une clé absente de la référence est laissée.
    Values partial = {{"sparse_infill_density", "0"}};
    CHECK(spiral_leftovers(partial, {{"sparse_infill_density", "20%"}}).size() == 1);
    CHECK(spiral_leftovers(partial, {}).empty());
    CHECK(spiral_keys().front() == "wall_loops");
}

TEST_CASE("Project: sanitize garde les réglages posés par l'assistant, bornés, et un relevé vide")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json clean = sanitize({{"assistant", {{"print/wall_loops", {{{"v", "3"}, {"b", "k1:2"}}, {{"v", 3}, {"b", "x"}}, {{"v", "4"}}}},
                                                           {"print/top_shell_layers", "5"},
                                                           {"", {{{"v", "1"}, {"b", "x"}}}}}}});
    REQUIRE(clean.contains("assistant"));
    CHECK(clean["assistant"].size() == 1);
    CHECK(clean["assistant"]["print/wall_loops"] == nlohmann::json::array({{{"v", "3"}, {"b", "k1:2"}}}));
    CHECK(sanitize({{"assistant", nlohmann::json::object()}})["assistant"] == nlohmann::json::object()); // connu et vide
    CHECK_FALSE(sanitize({{"assistant", "oui"}}).contains("assistant"));
    CHECK_FALSE(sanitize(nlohmann::json::object()).contains("assistant")); // conversation ancienne : inconnu
}

// --- Lot 4 de l'audit : retours arrière, réglages réussis, une seule question par impression ---
TEST_CASE("Lot 4 · Sanitize::reliable : ancienne version (deux portées) et nouvelle (filament seul) restent lisibles")
{
    const json old_format = {{"machine", "K2 | PLA"}, {"date", "2026-11-01"}, {"at", "2026-11-01T10:00:00"},
                             {"values", {{"print", {{"spiral_mode", "1"}, {"wall_loops", "1"}}}, {"filament", {{"nozzle_temperature", "215"}}}}}};
    const json a = Plyo::Sanitize::reliable(old_format);
    CHECK(a["values"] == json{{"filament", {{"nozzle_temperature", "215"}}}});
    const json new_format = {{"machine", "K2 | PLA"}, {"date", "2026-11-12"}, {"at", "2026-11-12T09:00:00"},
                             {"values", {{"filament", {{"nozzle_temperature", "210"}, {"filament_flow_ratio", "0.95"}}}}}};
    const json b = Plyo::Sanitize::reliable(new_format);
    CHECK(b["values"]["filament"].size() == 2);
    CHECK(b["at"] == "2026-11-12T09:00:00");
    CHECK(Plyo::Sanitize::reliable(json{{"machine", "K2 | PLA"}})["values"] == json{{"filament", json::object()}});
}

TEST_CASE("Lot 4 · Sanitize::memory garde les changements avec ou sans libellé, clé et unité")
{
    const json stored = {{"K2 | PLA", json::array({
        json{{"date", "2026-11-12"}, {"changes", json::array({json{{"id", "nozzle_temperature"}, {"key", "nozzle_temperature"}, {"label", "Température de buse"}, {"unit", "°C"}, {"before", 220}, {"after", 210}}})}},
        json{{"date", "2026-11-01"}, {"changes", json::array({json{{"id", "sparse_infill_density"}, {"before", "15%"}, {"after", "20%"}}})}},
        json{{"date", "2026-10-01"}, {"changes", json::array({json{{"id", "nozzle_temp"}, {"before", 220}, {"after", 215}}})}}})}};
    const json m = Plyo::Sanitize::memory(stored);
    REQUIRE(m["K2 | PLA"].size() == 3);
    CHECK(m["K2 | PLA"][0]["changes"][0]["label"] == "Température de buse");
    CHECK(m["K2 | PLA"][1]["changes"][0]["after"] == "20%");
}

TEST_CASE("Lot 4 · MemoryLogic::mark_printed : seules les corrections en attente de ce projet, une seule fois")
{
    json list = json::array({
        json{{"at", "2026-11-12T10:00:00"}, {"conv", "c1"}, {"outcome", "pending"}},
        json{{"at", "2026-11-12T09:00:00"}, {"conv", "c2"}, {"outcome", "pending"}},
        json{{"at", "2026-11-11T09:00:00"}, {"conv", "c1"}, {"outcome", "ok"}},
        json{{"at", "2026-11-10T09:00:00"}, {"conv", "c1"}, {"outcome", "pending"}, {"printed", "2026-11-10T12:00:00"}},
        json{{"date", "2026-11-09"}, {"changes", json::array()}}});
    CHECK(Plyo::MemoryLogic::mark_printed(list, "c1", "2026-11-12T11:00:00") == 1);
    CHECK(list[0]["printed"] == "2026-11-12T11:00:00");
    CHECK_FALSE(list[1].contains("printed"));
    CHECK_FALSE(list[2].contains("printed"));
    CHECK(list[3]["printed"] == "2026-11-10T12:00:00"); // déjà rattachée à une impression : inchangée
    CHECK(Plyo::MemoryLogic::mark_printed(list, "c1", "2026-11-12T12:00:00") == 0);
    CHECK(Plyo::MemoryLogic::mark_printed(list, "", "2026-11-12T12:00:00") == 0);
    json bad = "abîmé";
    CHECK(Plyo::MemoryLogic::mark_printed(bad, "c1", "x") == 0);
}

TEST_CASE("Lot 4 · MemoryLogic::mark_result : la réponse de Résultat marque les corrections de cette impression")
{
    json list = json::array({
        json{{"at", "T3"}, {"conv", "c1"}, {"outcome", "pending"}},                    // appliquée pendant l'impression : pas celle-ci
        json{{"at", "T2"}, {"conv", "c1"}, {"outcome", "pending"}, {"printed", "P"}},
        json{{"at", "T1"}, {"conv", "c1"}, {"outcome", "unknown"}, {"printed", "P"}},
        json{{"at", "T0"}, {"conv", "c1"}, {"outcome", "bad"}, {"printed", "P0"}},     // impression d'avant, déjà répondue
        json{{"at", "T9"}, {"conv", "c2"}, {"outcome", "pending"}, {"printed", "P"}}});
    const json marked = Plyo::MemoryLogic::mark_result(list, "c1", "bad", {});
    REQUIRE(marked.size() == 2);
    CHECK(marked[0]["at"] == "T2");
    CHECK(marked[1]["at"] == "T1");
    CHECK(list[0]["outcome"] == "pending");
    CHECK(list[3]["outcome"] == "bad");
    CHECK(list[4]["outcome"] == "pending");
    // Changement d'avis (« Oui » après « Non ») : exactement les entrées marquées par la première réponse.
    const json again = Plyo::MemoryLogic::mark_result(list, "c1", "ok", {"T2", "T1"});
    CHECK(again.size() == 2);
    CHECK(list[1]["outcome"] == "ok");
    CHECK(list[2]["outcome"] == "ok");
    CHECK(list[3]["outcome"] == "bad");
    // Rien à marquer : réponse inconnue, projet absent.
    CHECK(Plyo::MemoryLogic::mark_result(list, "c1", "later", {}).empty());
    CHECK(Plyo::MemoryLogic::mark_result(list, "", "ok", {}).empty());
}

TEST_CASE("Lot 4 · MemoryLogic::with_labels : le titre du catalogue pour un ancien changement, jamais une clé brute")
{
    const auto title = [](const std::string& k) { return k == "nozzle_temperature" ? std::string("Température de buse") : std::string(); };
    const json changes = json::array({json{{"id", "nozzle_temperature"}, {"before", 220}, {"after", 210}},
                                      json{{"id", "nozzle_temperature"}, {"label", "Buse (libellé noté)"}},
                                      json{{"id", "nozzle_temp"}, {"before", 220}, {"after", 215}},
                                      json{{"key", "nozzle_temperature"}, {"id", "x"}}, "abîmé"});
    const json out = Plyo::MemoryLogic::with_labels(changes, title);
    CHECK(out[0]["label"] == "Température de buse");
    CHECK(out[1]["label"] == "Buse (libellé noté)");
    CHECK_FALSE(out[2].contains("label")); // identifiant de l'ancienne liste : le panneau a son libellé
    CHECK(out[3]["label"] == "Température de buse");
    CHECK(out[4] == "abîmé");
    CHECK(Plyo::MemoryLogic::with_labels(json("x"), title) == json::array());
}

TEST_CASE("Lot 4 · Project: sanitize garde la réponse de Résultat pour les corrections, et lit les envois d'avant le lot 4")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json now = sanitize({{"send", {{"watch", "w1"}, {"corrections_outcome", "bad"},
                                                   {"corrections", nlohmann::json::array({"2026-11-12T10:00:00", 3, "", std::string(80, 'x'), "2026-11-12T09:00:00"})}}}});
    CHECK(now["send"]["corrections_outcome"] == "bad");
    CHECK(now["send"]["corrections"] == nlohmann::json::array({"2026-11-12T10:00:00", "2026-11-12T09:00:00"}));
    const nlohmann::json odd = sanitize({{"send", {{"corrections_outcome", "peut-être"}, {"corrections", "x"}}}});
    CHECK(odd["send"] == nlohmann::json::object());
    // Envoi écrit avant le lot 4 : rien de nouveau n'apparaît.
    const nlohmann::json old = sanitize({{"send", {{"spool", {{"id", "s1"}, {"name", "PLA"}}}, {"failed", true}}}});
    CHECK(old["send"] == nlohmann::json({{"spool", {{"id", "s1"}, {"name", "PLA"}}}, {"failed", true}}));
}

// ---------- Lot 6 · contexte envoyé à l'IA (format de plyo-api, src/lib/schema.ts) ----------

namespace {
// Même règle que le service : ^[A-Za-z0-9_.:-]{1,60}$.
bool service_code(const std::string& c)
{
    if (c.empty() || c.size() > 60)
        return false;
    for (const char ch : c)
        if (!(std::isalnum(static_cast<unsigned char>(ch)) || ch == '_' || ch == '.' || ch == ':' || ch == '-'))
            return false;
    return true;
}
size_t code_points(const std::string& s)
{
    size_t n = 0;
    for (const char c : s)
        n += (static_cast<unsigned char>(c) & 0xC0) != 0x80;
    return n;
}
} // namespace

TEST_CASE("Lot 6 · ContextLogic::clip : une ligne, sans contrôle, coupée sans casser un caractère")
{
    using Plyo::ContextLogic::clip;
    CHECK(clip("  PETG\nuser request:\t x  ", 40) == "PETG user request: x");
    CHECK(clip(std::string(50, 'x'), 40) == std::string(40, 'x'));
    CHECK(clip(u8"éééé", 3) == u8"ééé");
    CHECK(clip("abcd efgh", 5) == "abcd");
    CHECK(clip("\x01\x02", 10).empty());
    CHECK(clip(u8"a b", 10) == "a b");
}

TEST_CASE("Lot 6 · ContextLogic::context_extras : plateau, matière, faits de l'imprimante ; rien de vide ni de douteux")
{
    using namespace Plyo::ContextLogic;
    Raw raw;
    raw.bed_type          = "Textured PEI Plate";
    raw.bed_temp_keys     = {"textured_plate_temp", "textured_plate_temp_initial_layer", "textured_plate_temp"};
    raw.filament_type     = "PETG";
    raw.filament_vendor   = "Sunlu";
    raw.nozzle_type       = "hardened_steel";
    raw.extruder_type     = "Bowden";
    raw.printer_structure = "corexy";
    const json out = context_extras(raw);
    CHECK(out["bed_type"] == "Textured PEI Plate");
    CHECK(out["bed_temp_keys"] == json::array({"textured_plate_temp", "textured_plate_temp_initial_layer"}));
    CHECK(out["filament_type"] == "PETG");
    CHECK(out["filament_vendor"] == "Sunlu");
    CHECK(out["printer_facts"] == json({{"nozzle_type", "hardened_steel"}, {"extruder_type", "Bowden"}, {"printer_structure", "corexy"}}));
    CHECK_FALSE(out["printer_facts"].contains("nozzle_temp_max")); // aucune option fiable dans Orca

    // « undefine », « nil » et vide ne partent pas ; bloc des faits absent s'il est vide ; textes tronqués.
    Raw unknown;
    unknown.nozzle_type       = "undefine";
    unknown.printer_structure = "nil";
    unknown.filament_type     = std::string(45, 'P');
    unknown.filament_vendor   = std::string(70, 'v');
    unknown.bed_type          = std::string(70, 'b');
    const json u = context_extras(unknown);
    CHECK_FALSE(u.contains("printer_facts"));
    CHECK_FALSE(u.contains("bed_temp_keys")); // jamais de liste vide
    CHECK(u["filament_type"].get<std::string>().size() == 40);
    CHECK(u["filament_vendor"].get<std::string>().size() == 60);
    CHECK(u["bed_type"].get<std::string>().size() == 60);
    CHECK(context_extras(Raw{}) == json::object());

    // Une clé mal formée ferait ignorer toute la liste au service : elle ne part pas du tout.
    Raw bad;
    bad.bed_temp_keys = {"hot_plate_temp", "Hot plate"};
    CHECK_FALSE(context_extras(bad).contains("bed_temp_keys"));
    bad.bed_temp_keys.assign(13, "");
    for (size_t i = 0; i < 13; ++i)
        bad.bed_temp_keys[i] = "k" + std::to_string(i) + "_plate_temp";
    CHECK_FALSE(context_extras(bad).contains("bed_temp_keys"));
    CHECK(valid_opt_key("hot_plate_temp_initial_layer"));
    CHECK_FALSE(valid_opt_key("1abc"));
    CHECK_FALSE(valid_opt_key(std::string(81, 'a')));
}

TEST_CASE("Lot 6 · ContextLogic::issues_for_ai : chaque message d'Orca respecte le format du service")
{
    using Plyo::ContextLogic::issues_for_ai;
    // Forme réelle produite par OrcaMessagesLogic::to_json (champs du panneau compris).
    std::vector<Plyo::OrcaMessagesLogic::Issue> orca;
    for (int i = 0; i < 12; ++i) {
        Plyo::OrcaMessagesLogic::Issue it;
        it.source = i == 0 ? "slicing_error" : "validate_warning";
        it.code   = i == 0 ? Plyo::OrcaMessagesLogic::slicing_code("Slic3r::SlicingError <x>", {}) : "code_" + std::to_string(i);
        it.level  = i == 0 ? "error" : "warning";
        it.text   = Plyo::OrcaMessagesLogic::clean_text(std::string(400, 'a') + "\nligne 2");
        it.opt_key     = i == 1 ? "Layer height" : "layer_height";
        it.scope       = "print";
        it.object_ref  = i == 2 ? "abc" : "42";
        it.object_name = "Bateau";
        it.fix         = json{{"key", "layer_height"}, {"value", 0.2}};
        orca.push_back(it);
    }
    const json out = issues_for_ai(Plyo::OrcaMessagesLogic::to_json(orca));
    REQUIRE(out.size() == 10);
    for (const json& i : out) {
        CHECK(service_code(i["code"].get<std::string>()));
        CHECK((i["level"] == "error" || i["level"] == "warning"));
        CHECK(code_points(i["text"].get<std::string>()) <= 300);
        CHECK(i["text"].get<std::string>().find('\n') == std::string::npos);
        if (i.contains("object_ref"))
            CHECK(i["object_ref"].get<std::string>().find_first_not_of("0123456789") == std::string::npos);
        if (i.contains("opt_key"))
            CHECK(Plyo::ContextLogic::valid_opt_key(i["opt_key"].get<std::string>()));
        for (const char* gone : {"scope", "object_name", "fix", "critical"})
            CHECK_FALSE(i.contains(gone));
    }
    CHECK(out[0]["code"] == "Slic3r::SlicingError__x_"); // espaces et chevrons remplacés
    CHECK_FALSE(out[1].contains("opt_key"));              // clé mal formée : retirée, le message reste
    CHECK_FALSE(out[2].contains("object_ref"));           // pièce qui n'est pas un identifiant : retirée

    // Entrées invalides ignorées une par une.
    const json mixed = json::array({json{{"source", "other"}, {"code", "a"}, {"level", "error"}, {"text", "t"}},
                                    json{{"source", "dialog"}, {"code", "   "}, {"level", "error"}, {"text", "t"}},
                                    json{{"source", "dialog"}, {"code", "ok"}, {"level", "info"}, {"text", "t"}},
                                    json{{"source", "dialog"}, {"code", "ok"}, {"level", "error"}, {"text", " \n "}},
                                    "texte", json{{"source", "upload_error"}, {"code", "write"}, {"level", "error"}, {"text", "Disque plein."}}});
    const json kept = issues_for_ai(mixed);
    REQUIRE(kept.size() == 1);
    CHECK(kept[0]["code"] == "write");
    CHECK(issues_for_ai("x") == json::array());
}

TEST_CASE("Lot 6 · ContextLogic::plate_for_ai : mesures de la vérification avant impression par pièce, conflit, messages")
{
    using Plyo::ContextLogic::plate_for_ai;
    const json plate = {{"objects", json::array({json{{"ref", "7"}, {"name", "Vase"}, {"size_mm", {20, 20, 150}}},
                                                 json{{"ref", "8"}, {"name", "Cube"}, {"size_mm", {20, 20, 20}}},
                                                 json{{"ref", "9"}, {"name", "Autre plaque"}, {"size_mm", {5, 5, 5}}}})},
                        {"sliced", true},
                        {"issues", json::array({json{{"source", "step_warning"}, {"code", "need_support"}, {"level", "warning"}, {"text", "Supports."}, {"scope", "print"}}})}};
    const json facts = {{"objects", {{"7", {{"needs_support", true}, {"contact_mm2", 40.4}}}, {"8", {{"needs_support", false}, {"contact_mm2", 2e6}}}}},
                        {"conflict", true}};
    const json out = plate_for_ai(plate, facts);
    CHECK(out["objects"][0]["needs_support"] == true);
    CHECK(out["objects"][0]["contact_mm2"] == 40);
    CHECK(out["objects"][1]["needs_support"] == false);
    CHECK_FALSE(out["objects"][1].contains("contact_mm2")); // hors des bornes du service
    CHECK_FALSE(out["objects"][2].contains("needs_support")); // pas sur la plaque mesurée
    CHECK(out["conflict"] == true);
    CHECK_FALSE(out["issues"][0].contains("scope"));
    // Plaque non découpée : pas de conflit ; aucune mesure ; aucun message : la clé disparaît.
    const json bare = plate_for_ai({{"objects", json::array()}, {"sliced", false}, {"issues", json::array()}}, nullptr);
    CHECK_FALSE(bare.contains("conflict"));
    CHECK_FALSE(bare.contains("issues"));
    CHECK(plate_for_ai(nullptr, facts).is_null());
}

TEST_CASE("Lot 6 · ContextLogic::memory_for_ai : défaut de l'essai gardé, champs internes retirés, rien de vide")
{
    using Plyo::ContextLogic::memory_for_ai;
    json changes = json::array();
    for (int i = 0; i < 12; ++i)
        changes.push_back({{"id", "k" + std::to_string(i)}, {"before", i}, {"after", i + 1}, {"label", "Libellé"}, {"unit", "mm"}});
    changes.push_back({{"id", std::string(61, 'x')}, {"before", 1}, {"after", 2}});
    const json memory = json::array({json{{"date", "2026-11-12"}, {"changes", changes}, {"why", "Fils"}, {"at", "2026-11-12T10:00:00"}, {"conv", "c1"},
                                          {"asked", 0}, {"outcome", "pending"}, {"defect", "stringing"}, {"printed", "P"}},
                                     json{{"date", "2026-11-11"}, {"changes", json::array({json{{"id", "nozzle_temperature"}, {"before", 220}, {"after", "nil"}}})},
                                          {"why", ""}, {"defect", ""}, {"outcome", "plus tard"}},
                                     json{{"changes", json::array()}}});
    const json out = memory_for_ai(memory);
    REQUIRE(out.size() == 2); // l'entrée sans date ne part pas
    CHECK(out[0]["defect"] == "stringing");
    CHECK(out[0]["outcome"] == "pending");
    CHECK(out[0]["changes"].size() == 10);
    CHECK(out[0]["changes"][0] == json({{"id", "k0"}, {"before", 0}, {"after", 1}}));
    for (const char* gone : {"at", "conv", "asked", "printed"})
        CHECK_FALSE(out[0].contains(gone));
    CHECK_FALSE(out[1].contains("defect")); // jamais de chaîne vide
    CHECK_FALSE(out[1].contains("why"));
    CHECK_FALSE(out[1].contains("outcome"));
    CHECK(out[1]["changes"][0]["after"] == "nil");
    CHECK(memory_for_ai("abîmé") == json::array());
}

TEST_CASE("Lot 6 · Limits::source_of : provenance des limites dite à l'IA")
{
    using Plyo::Limits::source_of;
    CHECK(source_of(true, true, false) == "user");
    CHECK(source_of(false, true, false) == "profile");
    CHECK(source_of(false, true, true) == "profile"); // cas mixte
    CHECK(source_of(false, false, true) == "user");
    CHECK(source_of(false, false, false).empty());
}

// ---------------------------------------------------------------------------------------------------------------------
// Lot 9 · sentinelles d'Orca : chaque test lit une source d'Orca dont Plyo dépend sans la modifier (titre comparé, séquence
// recopiée, branche voisine d'une accroche). Après une fusion d'Orca, un échec ici dit exactement ce qu'Orca a changé :
// reprendre alors le code Plyo nommé dans le message, puis mettre la sentinelle à jour (docs/plyo/FICHIERS-MODIFIES.md).
// ---------------------------------------------------------------------------------------------------------------------

#include "../../PlyoHooks.hpp"

#include <map>
#include <set>
#include <vector>

namespace {

// Texte de `from` (inclus) jusqu'à `to` (exclu), cherché après `from` ; vide si l'un manque.
std::string between(const std::string& src, const std::string& from, const std::string& to)
{
    const size_t a = src.find(from);
    if (a == std::string::npos)
        return std::string();
    const size_t b = src.find(to, a + from.size());
    return b == std::string::npos ? std::string() : src.substr(a, b - a);
}

size_t count_of(const std::string& text, const std::string& needle)
{
    size_t n = 0;
    for (size_t at = text.find(needle); at != std::string::npos; at = text.find(needle, at + needle.size()))
        ++n;
    return n;
}

// Chaque morceau est présent, dans cet ordre.
void check_in_order(const std::string& where, const std::string& body, const std::vector<std::string>& needles)
{
    INFO(where);
    REQUIRE_FALSE(body.empty());
    size_t at = 0;
    for (const std::string& needle : needles) {
        INFO(needle);
        const size_t found = body.find(needle, at);
        CHECK(found != std::string::npos);
        if (found != std::string::npos)
            at = found + needle.size();
    }
}

std::string trimmed(const std::string& line)
{
    const size_t a = line.find_first_not_of(" \t\r");
    if (a == std::string::npos)
        return std::string();
    return line.substr(a, line.find_last_not_of(" \t\r") - a + 1);
}

// Lignes de code d'un bloc : sans lignes vides, commentaires ni journal.
std::vector<std::string> code_lines(const std::string& body)
{
    std::vector<std::string> out;
    size_t                   start = 0;
    while (start <= body.size()) {
        const size_t      end  = body.find('\n', start);
        const std::string line = trimmed(body.substr(start, end == std::string::npos ? std::string::npos : end - start));
        if (!line.empty() && line.rfind("//", 0) != 0 && line.rfind("BOOST_LOG", 0) != 0)
            out.push_back(line);
        if (end == std::string::npos)
            break;
        start = end + 1;
    }
    return out;
}

// La position est dans un commentaire (// sur la même ligne, ou /* … */ ouvert).
bool in_comment(const std::string& src, size_t pos)
{
    const size_t line_start = src.rfind('\n', pos);
    const size_t from       = line_start == std::string::npos ? 0 : line_start + 1;
    if (src.substr(from, pos - from).find("//") != std::string::npos)
        return true;
    const size_t open  = src.rfind("/*", pos);
    const size_t close = src.rfind("*/", pos);
    return open != std::string::npos && (close == std::string::npos || close < open);
}

std::string read_file(const fs::path& path)
{
    boost::nowide::ifstream in(path.string(), std::ios::binary);
    return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

fs::path repo_root() { return fs::path(__FILE__).parent_path() / ".." / ".." / ".." / ".."; }

// Texte d'un msgid (une seule ligne, sans contexte) dans un catalogue .po ; le msgid lui-même s'il n'est pas traduit.
std::string translated(const std::string& po, const std::string& msgid)
{
    const std::string key = "\nmsgid \"" + msgid + "\"\nmsgstr \"";
    const size_t      at  = po.find(key);
    if (at == std::string::npos)
        return msgid;
    const size_t from = at + key.size();
    const size_t to   = po.find("\"\n", from);
    const std::string text = to == std::string::npos ? std::string() : po.substr(from, to - from);
    return text.empty() ? msgid : text;
}

} // namespace

TEST_CASE("Lot 9 · PlyoHooks.hpp, seul en-tête inclus par Orca, ne tire ni nlohmann, ni boost, ni wx")
{
    const std::string hooks = read_source("../../PlyoHooks.hpp");
    for (const char* banned : {"#include <nlohmann", "#include <boost", "#include <wx", "#include \"slic3r", "#include \"libslic3r"}) {
        INFO(banned);
        CHECK(hooks.find(banned) == std::string::npos);
    }
    // Chaque fichier d'Orca qui appelle Plyo n'inclut que cet en-tête, sur une ligne marquée.
    for (const char* file : {"src/slic3r/GUI/Plater.cpp", "src/slic3r/GUI/MainFrame.cpp", "src/slic3r/GUI/GUI_App.cpp",
                             "src/slic3r/Utils/ElegooLink.cpp", "src/slic3r/Utils/CrealityPrint.cpp"}) {
        INFO(file);
        const std::string src = read_file(repo_root() / file);
        REQUIRE_FALSE(src.empty());
        CHECK(count_of(src, "#include \"plyo/") == 1);
        CHECK(src.find("#include \"plyo/PlyoHooks.hpp\" // PLYO: ") != std::string::npos);
    }
}

TEST_CASE("Lot 9 · sentinelle ARCH-01 : titres de la question « Enregistrer ? » reconnus par Plyo, seulement aux appels attendus")
{
    // Si ce test échoue, Orca a changé, retiré ou réutilisé le titre d'une de ces questions : reprendre la liste de
    // PlyoProjectFiles.cpp (take_preset_changes), sinon Plyo jetterait en silence des réglages d'une autre question.
    const std::vector<std::string> titles = {"Closing application", "Creating a new project", "Load project"};
    CHECK(read_source("../../PlyoProjectFiles.cpp")
              .find("{_u8L(\"Closing application\"), _u8L(\"Creating a new project\"), _u8L(\"Load project\")}") != std::string::npos);

    struct Call
    {
        std::string file, function, caption;
    };
    std::vector<Call>                  calls;
    std::map<std::string, std::string> literal_files; // titre → fichiers où il apparaît (hors src/plyo)
    const fs::path                     src_dir = repo_root() / "src";
    for (fs::recursive_directory_iterator it(src_dir), end; it != end; ++it) {
        const std::string rel = fs::relative(it->path(), src_dir).generic_string();
        if (rel == "plyo") {
            it.disable_recursion_pending();
            continue;
        }
        const std::string ext = it->path().extension().string();
        if (!fs::is_regular_file(it->path()) || (ext != ".cpp" && ext != ".hpp" && ext != ".h" && ext != ".mm"))
            continue;
        const std::string text = read_file(it->path());
        for (const std::string& title : titles)
            for (size_t n = count_of(text, "\"" + title + "\""); n > 0; --n)
                literal_files[title] += rel + ";";
        for (const std::string fn : {"check_and_save_current_preset_changes(", "check_and_keep_current_preset_changes("}) {
            for (size_t at = text.find(fn); at != std::string::npos; at = text.find(fn, at + fn.size())) {
                if (in_comment(text, at))
                    continue;
                const std::string arg = trimmed(text.substr(at + fn.size(), 200));
                if (arg.rfind("const ", 0) == 0)
                    continue; // déclaration ou définition (GUI_App)
                std::string caption;
                if (arg.rfind("_L(\"", 0) == 0)
                    caption = arg.substr(4, arg.find("\")") - 4);
                else {
                    // Variable : sa valeur dans le même fichier (« caption = _L("…") »).
                    const std::string ident = arg.substr(0, arg.find_first_of(",) "));
                    const size_t      def   = text.find(ident + " = _L(\"");
                    caption = def == std::string::npos ? "?" + ident
                                                       : text.substr(def + ident.size() + 7, text.find("\")", def) - def - ident.size() - 7);
                }
                calls.push_back({rel, fn.substr(0, fn.size() - 1), caption});
            }
        }
    }

    // 1. Chaque titre n'apparaît que dans le fichier de son appel, autant de fois que d'appels.
    CHECK(literal_files["Closing application"] == "slic3r/GUI/MainFrame.cpp;");
    CHECK(literal_files["Creating a new project"] == "slic3r/GUI/Plater.cpp;");
    CHECK(literal_files["Load project"] == "slic3r/GUI/Plater.cpp;slic3r/GUI/Plater.cpp;");

    // 2. Les appels qui portent ces titres sont exactement ceux attendus ; les autres ont un titre connu et différent.
    std::multiset<std::string> project_calls;
    std::set<std::string>      other_captions;
    for (const Call& c : calls) {
        INFO(c.file + " " + c.function + " « " + c.caption + " »");
        CHECK(c.caption.rfind('?', 0) != 0); // titre retrouvé (sinon : nouvel appelant à examiner)
        if (std::find(titles.begin(), titles.end(), c.caption) != titles.end())
            project_calls.insert(c.file + " " + c.function + " " + c.caption);
        else
            other_captions.insert(c.caption);
    }
    CHECK(project_calls == std::multiset<std::string>{
                               "slic3r/GUI/MainFrame.cpp check_and_save_current_preset_changes Closing application",
                               "slic3r/GUI/Plater.cpp check_and_keep_current_preset_changes Creating a new project",
                               "slic3r/GUI/Plater.cpp check_and_save_current_preset_changes Load project",
                               "slic3r/GUI/Plater.cpp check_and_save_current_preset_changes Load project"});
    CHECK(other_captions.count("Configuration package changed") == 1); // assistant d'Orca, et PlyoPrinterSetup.cpp

    // 3. Dans aucune langue, le titre d'une autre question ne se traduit comme l'un des trois (comparaison de textes traduits).
    size_t catalogs = 0;
    for (fs::directory_iterator it(repo_root() / "localization" / "i18n"), end; it != end; ++it) {
        if (!fs::is_directory(it->path()))
            continue;
        const fs::path po = it->path() / ("OrcaSlicer_" + it->path().filename().string() + ".po");
        if (!fs::exists(po))
            continue;
        ++catalogs;
        const std::string text = read_file(po);
        std::set<std::string> project_texts;
        for (const std::string& title : titles)
            project_texts.insert(translated(text, title));
        CHECK(project_texts.size() == titles.size());
        for (const std::string& other : other_captions) {
            INFO(po.filename().string() + " : « " + other + " »");
            CHECK(project_texts.count(translated(text, other)) == 0);
        }
    }
    CHECK(catalogs >= 10);

    // 4. L'accroche est la première ligne des deux fonctions d'Orca.
    const std::string app = read_file(repo_root() / "src/slic3r/GUI/GUI_App.cpp");
    for (const char* fn : {"bool GUI_App::check_and_save_current_preset_changes(", "bool GUI_App::check_and_keep_current_preset_changes("}) {
        INFO(fn);
        const size_t at = app.find(fn);
        REQUIRE(at != std::string::npos);
        const size_t open = app.find("{\n", at);
        CHECK(app.substr(open, 90).find("{\n    if (Plyo::ProjectFiles::take_preset_changes(caption)) return true; // PLYO:") == 0);
    }
}

TEST_CASE("Lot 9 · sentinelle ARCH-06 : branche d'Orca voisine de l'envoi armé (send_gcode_legacy)")
{
    // Si ce test échoue, Orca a changé la façon de remplir l'envoi après la fenêtre : reprendre Canvas::fill_armed_upload
    // (PlyoCanvas.cpp), qui remplit les mêmes champs sans la fenêtre.
    const std::string plater = read_file(repo_root() / "src/slic3r/GUI/Plater.cpp");
    const std::string body   = between(plater, "void Plater::send_gcode_legacy(", "int Plater::send_gcode(");
    REQUIRE_FALSE(body.empty());
    // L'accroche : une ligne, juste avant le bloc d'Orca qui ouvre la fenêtre ; avec celle du lot 10 (envoi pris par Orca,
    // sentinelle plus bas), ce sont les seuls appels à Plyo de la fonction.
    CHECK(count_of(body, "Plyo::") == 2);
    CHECK(body.find("    if (!Plyo::Canvas::fill_armed_upload(upload_job.upload_data, default_output_file.filename().string(), use_3mf, "
                    "resolved_plate_idx)) // PLYO: ") != std::string::npos);
    CHECK(between(body, "Plyo::Canvas::fill_armed_upload(", "auto        preset_bundle = wxGetApp().preset_bundle;").find(" // PLYO: ") !=
          std::string::npos);
    check_in_order("send_gcode_legacy : avant l'accroche", body,
                   {"const bool  use_3mf     = use_3mf_opt != nullptr && use_3mf_opt->value;", "upload_job.upload_data.use_3mf = use_3mf;",
                    "const int resolved_plate_idx = plate_idx == PLATE_CURRENT_IDX ? get_partplate_list().get_curr_plate_index() : plate_idx;",
                    "default_output_file = fs::path(Slic3r::fold_utf8_to_ascii(default_output_file.string()));",
                    "default_output_file.replace_extension(\".gcode.3mf\");", "Plyo::Canvas::fill_armed_upload("});
    // Ce que la fenêtre remplit, champ par champ : un champ de plus ou de moins fait échouer le test.
    const std::string filled = between(body, "if (pDlg->ShowModal() != wxID_OK) {", "// Show \"Is printer clean\" dialog");
    CHECK(code_lines(filled) == std::vector<std::string>{
                                    "if (pDlg->ShowModal() != wxID_OK) {",
                                    "return;",
                                    "}",
                                    "config->set_bool(\"open_device_tab_post_upload\", pDlg->switch_to_device_tab());",
                                    "upload_job.switch_to_device_tab    = pDlg->switch_to_device_tab();",
                                    "upload_job.upload_data.upload_path = pDlg->filename();",
                                    "upload_job.upload_data.post_action = pDlg->post_action();",
                                    "upload_job.upload_data.group       = pDlg->group();",
                                    "upload_job.upload_data.storage     = pDlg->storage();",
                                    "upload_job.upload_data.extended_info = pDlg->extendedInfo();",
                                    "if (use_3mf) {",
                                    "const int plateindex = (plate_idx == PLATE_ALL_IDX ? get_partplate_list().get_curr_plate_index() : "
                                    "resolved_plate_idx) + 1;",
                                    "upload_job.upload_data.extended_info[\"plateindex\"] = std::to_string(plateindex);",
                                    "}",
                                    "}"});
    // Le remplissage de Plyo : les mêmes champs, dans le même ordre.
    const std::string canvas = read_source("../../PlyoCanvas.cpp");
    check_in_order("Canvas::fill_armed_upload", between(canvas, "bool fill_armed_upload(", "\n}\n"),
                   {"take_armed_send()", "upload.upload_path   = boost::filesystem::path(file_name);",
                    "upload.post_action   = Slic3r::PrintHostPostUploadAction::StartPrint;", "upload.extended_info = *plyo_info;",
                    "if (use_3mf)", "upload.extended_info[\"plateindex\"] = std::to_string(plate_idx + 1);", "return true;"});
}

TEST_CASE("Lot 9 · sentinelles ARCH-03 : séquences d'Orca recopiées dans Plyo")
{
    // Si un de ces tests échoue, Orca a changé une séquence que Plyo rejoue à l'identique : reprendre la fonction Plyo nommée.
    const fs::path    gui    = repo_root() / "src/slic3r/GUI";
    const std::string plater = read_file(gui / "Plater.cpp");

    SECTION("choix d'un filament : Plater::priv::on_select_preset → FirstSteps::select_filament")
    {
        const std::string fn    = between(plater, "void Plater::priv::on_select_preset(wxCommandEvent &evt)", "\n}\n");
        const std::string block = between(fn, "if (preset_type == Preset::TYPE_FILAMENT) {", "bool select_preset =");
        // Recopié : set_filament_preset, update_project_dirty_from_presets, update_dynamic_filament_list, on_filament_change,
        // export_selections. Non recopié (propre à la liste déroulante) : purge recalculée si le filament de support change,
        // badge de synchronisation AMS.
        CHECK(code_lines(block) == std::vector<std::string>{
                                       "if (preset_type == Preset::TYPE_FILAMENT) {",
                                       "wxGetApp().preset_bundle->set_filament_preset(idx, preset_name);",
                                       "wxGetApp().plater()->update_project_dirty_from_presets();",
                                       "wxGetApp().preset_bundle->export_selections(*wxGetApp().app_config);",
                                       "sidebar->update_dynamic_filament_list();",
                                       "bool flag_is_change = is_support_filament(idx);",
                                       "if (flag != flag_is_change && wxGetApp().app_config->get(\"auto_calculate_flush\") == \"all\") {",
                                       "sidebar->auto_calc_flushing_volumes(idx);",
                                       "}",
                                       "auto select_flag = combo->GetFlag(selection);",
                                       "combo->set_sync_badge(select_flag == (int)PresetComboBox::FilamentAMSType::FROM_AMS);",
                                       "q->on_filament_change(idx);",
                                       "}"});
        const std::string mine = between(read_source("../../PlyoFirstSteps.cpp"), "bool select_filament(const std::string& name, size_t idx)", "\n}\n");
        check_in_order("FirstSteps::select_filament", mine,
                       {"tab->select_preset(name)", "bundle.set_filament_preset(idx, name);", "plater->update_project_dirty_from_presets();",
                        "plater->sidebar().update_dynamic_filament_list();", "plater->on_filament_change(idx);",
                        "bundle.export_selections(*wxGetApp().app_config);"});
        // Une seule copie de la séquence dans Plyo (la calibration remet en bloc les filaments d'avant le test, autre geste).
        size_t copies = 0;
        for (fs::directory_iterator it(repo_root() / "src/plyo"), end; it != end; ++it)
            if (it->path().extension() == ".cpp")
                copies += count_of(read_file(it->path()), "on_filament_change(");
        CHECK(copies == 1);
    }

    SECTION("couleur d'un filament : PresetComboBox::update_ams_color → Canvas::set_colour")
    {
        const std::string combo = read_file(gui / "PresetComboBoxes.cpp");
        const std::string fn    = between(combo, "int PresetComboBox::update_ams_color()", "\n}\n");
        check_in_order("PresetComboBox::update_ams_color", fn,
                       {"new_cfg.set_key_value(\"filament_colour\", color_head);", "new_cfg.set_key_value(\"filament_colour_type\", color_type);",
                        "new_cfg.set_key_value(\"filament_multi_colour\", color_pack);", "cfg->apply(new_cfg);",
                        "wxGetApp().plater()->on_config_change(new_cfg);", "wxCommandEvent *evt = new wxCommandEvent(EVT_FILAMENT_COLOR_CHANGED);",
                        "evt->SetInt(m_filament_idx);", "wxQueueEvent(wxGetApp().plater(), evt);"});
        // Trois clés écrites (filament_colour_type n'est pas recopié par Plyo, qui garde le type de couleur) : une de plus, à reprendre.
        CHECK(count_of(fn, "set_key_value(") == 3);
        const std::string mine = between(read_source("../../PlyoCanvas.cpp"), "void set_colour(size_t idx, const std::string& color)", "\n}\n");
        check_in_order("Canvas::set_colour", mine,
                       {"change.set_key_value(\"filament_colour\"", "change.set_key_value(\"filament_multi_colour\"", "cfg.apply(change);",
                        "plater->on_config_change(change);", "new wxCommandEvent(Slic3r::GUI::EVT_FILAMENT_COLOR_CHANGED);",
                        "evt->SetInt(static_cast<int>(idx));", "wxQueueEvent(plater, evt);"});
    }

    SECTION("fin de l'installation d'une imprimante : GuideFrame::run et GUI_App::run_wizard → PrinterSetup::install")
    {
        const std::string guide = read_file(gui / "WebGuideDialog.cpp");
        const std::string apply = between(guide, "bool GuideFrame::apply_config(", "\n}\n");
        check_in_order("GuideFrame::apply_config", apply,
                       {"wxString header = _L(\"The configuration package is changed in previous Config Guide\");",
                        "wxString caption = _L(\"Configuration package changed\");", "int act_btns = ActionButtons::KEEP|ActionButtons::SAVE;",
                        "wxGetApp().check_and_keep_current_preset_changes(caption, header, act_btns, &apply_keeped_changes)",
                        "preset_bundle->apply_vendor_config("});
        const std::string ok = between(guide, "if (result == wxID_OK) {", "} else if (result == wxID_CANCEL) {");
        CHECK(code_lines(ok) == std::vector<std::string>{"if (result == wxID_OK) {",
                                                         "bool apply_keeped_changes = false;",
                                                         "if (! this->apply_config(app.app_config, app.preset_bundle, app.preset_updater, apply_keeped_changes))",
                                                         "return false;",
                                                         "if (apply_keeped_changes)",
                                                         "app.apply_keeped_preset_modifications();",
                                                         "app.app_config->set_legacy_datadir(false);",
                                                         "app.update_mode();",
                                                         "if (Plater *plater = app.plater())",
                                                         "plater->normalize_bed_types(false);",
                                                         "this->Close();",
                                                         "return true;"});
        const std::string wizard = between(read_file(gui / "GUI_App.cpp"), "bool GUI_App::run_wizard(", "\n}\n");
        check_in_order("GUI_App::run_wizard", wizard,
                       {"bool       res = wizard.run();", "if (res) {", "load_current_presets();", "update_publish_status();",
                        "mainframe->refresh_plugin_tips();"});
        CHECK(code_lines(between(wizard, "if (res) {", "return res;")).size() == 5); // if, trois appels, }
        check_in_order("PrinterSetup::install", read_source("../../PlyoPrinterSetup.cpp"),
                       {"check_and_keep_current_preset_changes(_L(\"Configuration package changed\"), _L(\"The configuration package is changed in previous Config Guide\"),",
                        "Slic3r::GUI::ActionButtons::KEEP | Slic3r::GUI::ActionButtons::SAVE, &keep_changes)", "apply_vendor_config(vendors, filaments, config, true, name, nozzle)",
                        "app.apply_keeped_preset_modifications();", "config->set_legacy_datadir(false);", "app.update_mode();",
                        "plater->normalize_bed_types(false);", "app.load_current_presets();", "app.update_publish_status();",
                        "app.mainframe->refresh_plugin_tips();"});
    }

    SECTION("remise à plat : GizmoObjectManipulation::reset_rotation_value → Commands reset_rotation")
    {
        const std::string manip = read_file(gui / "Gizmos/GizmoObjectManipulation.cpp");
        const std::string fn    = between(manip, "void GizmoObjectManipulation::reset_rotation_value(bool reset_relative)", "\n}\n");
        check_in_order("GizmoObjectManipulation::reset_rotation_value", fn,
                       {"selection.setup_cache();", "} else if (selection.is_single_full_instance()) {",
                        "Geometry::Transformation trafo  = selection.get_first_volume()->get_instance_transformation();", "trafo.reset_rotation();",
                        "const_cast<GLVolume *>(selection.get_volume(idx))->set_instance_transformation(trafo);",
                        "selection.synchronize_unselected_instances(Selection::SyncRotationType::RESET);",
                        "selection.synchronize_unselected_volumes();", "m_glcanvas.do_rotate(L(\"Reset rotation\"));"});
        check_in_order("Commands reset_rotation", between(read_source("../../PlyoCommands.cpp"), "void reset_rotation(int idx)", "\n}\n"),
                       {"sel.is_single_full_instance()", "sel.setup_cache();", "sel.get_first_volume()->get_instance_transformation();",
                        "trafo.reset_rotation();", "->set_instance_transformation(trafo);",
                        "sel.synchronize_unselected_instances(Slic3r::GUI::Selection::SyncRotationType::RESET);",
                        "sel.synchronize_unselected_volumes();", "canvas().do_rotate(\"Reset rotation\");"});
    }

    SECTION("poser sur une face : « Gizmo-Place on Face », reconnu par son texte dans GLCanvas3D::do_rotate")
    {
        // L(s) n'est qu'un repère pour la traduction (s inchangé) : Plyo passe le même texte, non traduit.
        CHECK(read_file(gui / "I18N.hpp").find("#define L(s) s") != std::string::npos);
        check_in_order("GLGizmoFlatten::on_mouse", read_file(gui / "Gizmos/GLGizmoFlatten.cpp"),
                       {"selection.flattening_rotate(m_planes[m_hover_id].normal);", "m_parent.do_rotate(L(\"Gizmo-Place on Face\"));"});
        const std::string rotate = between(read_file(gui / "GLCanvas3D.cpp"), "void GLCanvas3D::do_rotate(const std::string& snapshot_type)", "\n}\n");
        check_in_order("GLCanvas3D::do_rotate", rotate,
                       {"if (snapshot_type == L(\"Gizmo-Place on Face\") && m_selection.get_object_idx() == i) {",
                        "min_zs[{ i, j }] = SINKING_Z_THRESHOLD;"});
        check_in_order("Commands place_on_face", read_source("../../PlyoCommands.cpp"),
                       {"selection().flattening_rotate(planes[plane].normal);", "canvas().do_rotate(\"Gizmo-Place on Face\");"});
    }
}

TEST_CASE("Lot 9 · sentinelle ARCH-04 : « Montre-moi » vise les membres publics m_slice_btn et m_print_btn de MainFrame")
{
    // Si ce test échoue, Orca a déplacé ou rendu privés ces boutons : reprendre Highlight::find_target (PlyoHighlight.cpp).
    const std::string hpp     = read_file(repo_root() / "src/slic3r/GUI/MainFrame.hpp");
    const size_t      members = hpp.find("SideButton* m_slice_btn{ nullptr };");
    REQUIRE(members != std::string::npos);
    CHECK(hpp.find("SideButton* m_print_btn{ nullptr };") != std::string::npos);
    // Section publique ouverte avant ces membres, sans autre section entre les deux.
    const std::string before = hpp.substr(0, members);
    const size_t      pub    = before.rfind("public:");
    REQUIRE(pub != std::string::npos);
    CHECK(before.find("private:", pub) == std::string::npos);
    CHECK(before.find("protected:", pub) == std::string::npos);
    const std::string mine = read_source("../../PlyoHighlight.cpp");
    CHECK(mine.find("frame->m_slice_btn : frame->m_print_btn") != std::string::npos);
    CHECK(mine.find("GetLabel() ==") == std::string::npos); // plus aucun bouton reconnu par son libellé
}

// ---------------------------------------------------------------------------------------------------------------------
// Lot 10 · envoi à l'imprimante et fenêtres d'Orca (PlyoSendLogic, sentinelles de la file d'envoi et des fenêtres)
// ---------------------------------------------------------------------------------------------------------------------

#include "../../PlyoSendLogic.hpp"

TEST_CASE("Lot 10 · code HTTP lu dans le format d'Orca (« HTTP <code>: »), jamais dans une phrase")
{
    using Plyo::SendLogic::http_status;
    CHECK(http_status("HTTP 403: Forbidden") == 403);
    CHECK(http_status("  HTTP 500: Internal Server Error") == 500);
    CHECK(http_status("Error uploading to print host:\nHTTP 401: {\"error\": \"Invalid API key\"}") == 401);
    CHECK(http_status("Erreur lors de l'envoi :\nHTTP 507: Insufficient Storage") == 507);
    CHECK(http_status("Connection timed out. Please check if the printer and computer network are functioning properly") == 0);
    CHECK(http_status("curl:Couldn't connect to server") == 0);
    CHECK(http_status("La réponse HTTP 404 est arrivée") == 0); // pas en tête de ligne : pas le format d'Orca
    CHECK(http_status("HTTP 99: x") == 0);
    CHECK(http_status("") == 0);
}

TEST_CASE("Lot 10 · étape atteinte et famille d'un échec d'envoi")
{
    using namespace Plyo::SendLogic;
    CHECK(step_of(-1, 0) == "connect");
    CHECK(step_of(0, 0) == "connect");
    CHECK(step_of(37, 0) == "upload");
    CHECK(step_of(100, 1) == "sent");
    CHECK(failure_code(401, "connect") == "auth");
    CHECK(failure_code(403, "sent") == "auth");
    CHECK(failure_code(413, "sent") == "no_space");
    CHECK(failure_code(507, "sent") == "no_space");
    CHECK(failure_code(409, "sent") == "file_refused");
    CHECK(failure_code(415, "sent") == "file_refused");
    CHECK(failure_code(404, "connect") == "not_printer");
    CHECK(failure_code(500, "sent") == "server_error");
    CHECK(failure_code(503, "connect") == "server_error");
    CHECK(failure_code(418, "sent") == "unknown");
    CHECK(failure_code(0, "connect") == "unreachable");
    CHECK(failure_code(0, "upload") == "interrupted");
    CHECK(failure_code(0, "sent") == "no_confirmation");
}

TEST_CASE("Lot 10 · verdict d'un envoi du panneau et arrivée du fichier")
{
    using namespace Plyo::SendLogic;
    CHECK(verdict(true, true, true, true) == "taken"); // Orca a pris l'envoi : rien d'autre ne compte
    CHECK(verdict(false, true, true, false) == "refused");
    CHECK(verdict(false, false, true, true) == "closed"); // fenêtre d'envoi vue puis fermée
    CHECK(verdict(false, false, false, true) == "not_ready");
    CHECK(verdict(false, false, false, false) == "not_started");
    CHECK_FALSE(arrived_now(0));
    CHECK_FALSE(arrived_now(1)); // un seul « 100 % » : on attend ARRIVED_QUIET_MS sans erreur
    CHECK(arrived_now(2));
    CHECK(ARRIVED_QUIET_MS >= 1000);
}

TEST_CASE("Lot 10 · aucune adresse du réseau ni code d'accès dans un texte d'Orca montré ou envoyé à l'IA")
{
    using Plyo::SendLogic::scrub_network;
    CHECK(scrub_network("Could not connect to http://192.168.1.42:5000/api/version", {}, {}) == "Could not connect to [adresse]");
    CHECK(scrub_network("Host 10.0.0.7:7125 refused", {}, {}) == "Host [adresse] refused");
    CHECK(scrub_network("Échec vers [fe80::1]:80.", {}, {}) == "Échec vers [adresse].");
    CHECK(scrub_network("octopi.local ne répond pas", {}, {}) == "[adresse] ne répond pas");
    CHECK(scrub_network("Mon-K1C.local:4408 ne répond pas", {}, {}) == "[adresse] ne répond pas");
    CHECK(scrub_network("Printer octopi unreachable, key ABCD1234EF", {"octopi"}, {"ABCD1234EF"}) == "Printer [adresse] unreachable, key [code]");
    CHECK(scrub_network("HTTP 403: Forbidden", {"x"}, {""}) == "HTTP 403: Forbidden"); // valeurs trop courtes ignorées
    CHECK(scrub_network("Tout va bien.", {"192.168.1.42"}, {"secret"}) == "Tout va bien.");
}

TEST_CASE("Lot 10 · la liaison n'est testée que sur le réseau local")
{
    using namespace Plyo::SendLogic;
    for (const char* host : {"192.168.1.20", "http://192.168.1.20:5000", "10.0.0.3:7125", "172.20.1.1", "127.0.0.1:8765", "localhost",
                             "http://octopi.local/", "octopi", "user:mdp@192.168.0.2", "[fe80::1]:80", "169.254.3.4"}) {
        INFO(host);
        CHECK(local_host(host));
    }
    for (const char* host : {"", "8.8.8.8", "https://monimprimante.example.com", "172.32.0.1", "printer.home.net:80", "[2001:db8::1]:80",
                             "http://1.2.3.4/"}) {
        INFO(host);
        CHECK_FALSE(local_host(host));
    }
    CHECK(link_code(true, 0) == "ok");
    CHECK(link_code(false, 401) == "auth");
    CHECK(link_code(false, 404) == "not_printer");
    CHECK(link_code(false, 0) == "unreachable");
    CHECK(link_code(false, 500) == "error");
}

TEST_CASE("Lot 10 · sentinelle : envoi pris par Orca (send_gcode_legacy) et choix Bambu Lab / file d'envoi")
{
    // Si ce test échoue, Orca a changé la fin de send_gcode_legacy ou le choix du bouton « Imprimer la plaque » : reprendre
    // l'accroche Plyo::Send::on_upload_handed (docs/plyo/FICHIERS-MODIFIES.md) ou FirstSteps::start_print.
    const std::string plater = read_file(repo_root() / "src/slic3r/GUI/Plater.cpp");
    const std::string body   = between(plater, "void Plater::send_gcode_legacy(", "int Plater::send_gcode(");
    REQUIRE_FALSE(body.empty());
    CHECK(body.find("    Plyo::Send::on_upload_handed(); // PLYO: ") != std::string::npos);
    // La ligne est la dernière avant l'envoi confié à Orca, après la fenêtre, PrusaConnect et le .gcode.3mf.
    check_in_order("send_gcode_legacy : fin", body,
                   {"if (pDlg->ShowModal() != wxID_OK) {", "Is the printer ready? Is the print sheet in place, empty and clean?",
                    "upload_job.upload_data.source_path = p->m_print_job_data._3mf_path;", "Plyo::Send::on_upload_handed();",
                    "p->export_gcode(fs::path(), false, std::move(upload_job));"});
    const std::string tail = body.substr(body.find("Plyo::Send::on_upload_handed();"));
    CHECK(code_lines(tail).size() == 3); // l'accroche, l'appel à export_gcode, l'accolade de fin
    // Le bouton d'Orca : Bambu Lab ou agents → fenêtre de leur module ; sinon send_gcode_legacy (repris par start_print).
    check_in_order("Plater::priv::on_action_print_plate", between(plater, "void Plater::priv::on_action_print_plate(SimpleEvent&)", "\n}\n"),
                   {"if (preset_bundle.use_bbl_network() || wxGetApp().app_config->get_bool(\"use_printer_agents\")) {",
                    "open_machine_select_dialog(partplate_list.get_curr_plate_index());", "} else {",
                    "q->send_gcode_legacy(PLATE_CURRENT_IDX, nullptr);"});
    check_in_order("FirstSteps::start_print", read_source("../../PlyoFirstSteps.cpp"),
                   {"if (bundle.use_bbl_network() || wxGetApp().app_config->get_bool(\"use_printer_agents\")) {",
                    "wxPostEvent(plater, Slic3r::GUI::SimpleEvent(Slic3r::GUI::EVT_GLTOOLBAR_PRINT_PLATE));", "Send::from_panel(std::move(done));"});
    check_in_order("Send::from_panel", read_source("../../PlyoSend.cpp"), {"plater->send_gcode_legacy(PLATE_CURRENT_IDX, nullptr);"});
}

TEST_CASE("Lot 10 · sentinelle : file d'envoi d'Orca (événements publics, rang des envois, format des erreurs)")
{
    // Si ce test échoue, Orca a changé sa file d'envoi : reprendre src/plyo/PlyoSend.cpp (rang de l'envoi suivi, arrivée,
    // classement des échecs par code HTTP).
    const fs::path    root  = repo_root();
    const std::string hpp   = read_file(root / "src/slic3r/GUI/PrintHostDialogs.hpp");
    for (const char* decl : {"wxDECLARE_EVENT(EVT_PRINTHOST_PROGRESS, PrintHostQueueDialog::Event);",
                             "wxDECLARE_EVENT(EVT_PRINTHOST_ERROR, PrintHostQueueDialog::Event);",
                             "wxDECLARE_EVENT(EVT_PRINTHOST_CANCEL, PrintHostQueueDialog::Event);", "size_t job_id;", "int progress = 0;",
                             "wxString status;", "class PrintHostSendDialog : public GUI::MsgDialog"}) {
        INFO(decl);
        CHECK(hpp.find(decl) != std::string::npos);
    }
    const std::string dlg = read_file(root / "src/slic3r/GUI/PrintHostDialogs.cpp");
    // Une ligne de tableau par envoi, dans l'ordre : le rang d'un envoi est le nombre de lignes avant lui.
    check_in_order("PrintHostQueueDialog", dlg,
                   {"job_list = new wxDataViewListCtrl(this, wxID_ANY);", "void PrintHostQueueDialog::append_job(const PrintHostJob &job)",
                    "job_list->AppendItem(fields, static_cast<wxUIntPtr>(ST_NEW));", "void PrintHostQueueDialog::on_error(Event &evt)",
                    "GUI::show_error(nullptr, errormsg);"});
    const std::string host = read_file(root / "src/slic3r/Utils/PrintHost.cpp");
    CHECK(host.find("return wxString::Format(\"HTTP %u: %s\", status, wxbody);") != std::string::npos);
    check_in_order("PrintHostJobQueue::priv::perform_job", between(host, "void PrintHostJobQueue::priv::perform_job(PrintHostJob the_job)", "\n}\n"),
                   {"emit_progress(0);", "PrintHostJobQueue::upload_job(the_job,", "if (success) {", "emit_progress(100);"});
    check_in_order("PrintHostJobQueue::priv::bg_thread_main", host, {"perform_job(std::move(job));", "remove_source();", "job_id++;"});
    CHECK(host.find("wxQueueEvent(queue_dialog, evt);") != std::string::npos); // posté au fil de l'interface
}

TEST_CASE("Lot 10 · sentinelle : fenêtres de message d'Orca lues par l'observateur")
{
    // Si ce test échoue, Orca a changé ses fenêtres de message : reprendre OrcaWindows (message_kind, dialog_text).
    const fs::path    gui = repo_root() / "src/slic3r/GUI";
    const std::string hpp = read_file(gui / "MsgDialog.hpp");
    for (const char* cls : {"class ErrorDialog : public MsgDialog", "class WarningDialog : public MsgDialog", "class MessageDialog : public MsgDialog",
                            "class RichMessageDialog : public MsgDialog", "class InfoDialog : public MsgDialog"}) {
        INFO(cls);
        CHECK(hpp.find(cls) != std::string::npos);
    }
    const std::string cpp = read_file(gui / "MsgDialog.cpp");
    check_in_order("add_msg_content", between(cpp, "static void add_msg_content(", "\n}\n"),
                   {"wxHtmlWindow* html = new wxHtmlWindow(parent", "wxScrolledWindow *scrolledWindow = new wxScrolledWindow(parent",
                    "Label *wrapped_text = new Label(scrolledWindow", "html->SetPage("});
    CHECK(cpp.find("btn->Bind(wxEVT_BUTTON, [this, btn_id](wxCommandEvent&) { EndModal(btn_id); });") != std::string::npos);
    // show_error ouvre sa fenêtre après coup (CallAfter) : le verdict d'un envoi refusé attend qu'elle s'ouvre.
    check_in_order("show_error", between(read_file(gui / "GUI.cpp"), "void show_error(wxWindow* parent, const wxString& message, bool has_code_excerpts)", "\n}\n"),
                   {"wxGetApp().CallAfter([=] {", "ErrorDialog msg(parent, message, has_code_excerpts);", "msg.ShowModal();"});
    const std::string mine = read_source("../../PlyoOrcaWindows.cpp");
    CHECK(mine.find("dynamic_cast<GUI::PrintHostSendDialog*>(top) != nullptr") != std::string::npos); // la fenêtre d'envoi n'est jamais lue
}

// ---------- Lot 11 : utilisateur confirmé ----------
#include "../../PlyoRetouchesLogic.hpp"

TEST_CASE("RetouchesLogic::manual_keys : seulement les retouches à la main, pas celles de Plyo non retouchées")
{
    using Plyo::RetouchesLogic::manual_keys;
    const Plyo::RetouchesLogic::Values saved  = {{"wall_loops", "2"}, {"outer_wall_speed", "200"}, {"seam_position", "aligned"}};
    const Plyo::RetouchesLogic::Values edited = {{"wall_loops", "3"}, {"outer_wall_speed", "150"}, {"seam_position", "aligned"}, {"new_key", "1"}};
    // outer_wall_speed : écrit par Plyo et pas retouché depuis ; wall_loops : Plyo avait mis 4, retouché ensuite à 3.
    const Plyo::RetouchesLogic::Values plyo = {{"outer_wall_speed", "150"}, {"wall_loops", "4"}};
    CHECK(manual_keys(saved, edited, plyo) == std::vector<std::string>{"new_key", "wall_loops"});
    CHECK(manual_keys(saved, saved, {}).empty());
    CHECK(manual_keys({}, {}, {}).empty());
}

TEST_CASE("RetouchesLogic::sanitize_pending : champs connus, bornés ; rien sans préréglage ni valeur")
{
    using Plyo::RetouchesLogic::sanitize_pending;
    CHECK(sanitize_pending(nlohmann::json()).empty());
    CHECK(sanitize_pending({{"preset", "0.20mm Standard"}}).empty());
    CHECK(sanitize_pending({{"values", {{"wall_loops", "3"}}}}).empty());
    const nlohmann::json p = sanitize_pending({{"preset", "0.20mm Standard"},
                                               {"project", "crochet"},
                                               {"conv", "abc"},
                                               {"extra", "x"},
                                               {"values", {{"wall_loops", "3"}, {"bad", 4}, {"", "1"}}},
                                               {"before", {{"wall_loops", "2"}}},
                                               {"changes", {{{"key", "wall_loops"}, {"label", "Parois"}, {"before", 2}, {"after", 3}},
                                                            {{"key", "inconnue"}, {"label", "?"}},
                                                            "pas un objet"}}});
    REQUIRE_FALSE(p.empty());
    CHECK(p["preset"] == "0.20mm Standard");
    CHECK(p["project"] == "crochet");
    CHECK_FALSE(p.contains("extra"));
    CHECK(p["values"] == nlohmann::json{{"wall_loops", "3"}});
    REQUIRE(p["changes"].size() == 1);
    CHECK(p["changes"][0]["label"] == "Parois");
    CHECK(p["changes"][0]["after"] == 3);
}

TEST_CASE("RetouchesLogic::keep_refusal et keep_name : même profil, sans autre retouche ; copie d'un profil d'Orca")
{
    using namespace Plyo::RetouchesLogic;
    const nlohmann::json p = {{"preset", "0.20mm Standard"}, {"values", {{"wall_loops", "3"}}}};
    CHECK(keep_refusal(p, "0.20mm Standard", false) == "");
    CHECK(keep_refusal(p, "0.16mm Optimal", false) == "other_preset");
    CHECK(keep_refusal(p, "0.20mm Standard", true) == "dirty");
    CHECK(keep_refusal(nlohmann::json::object(), "0.20mm Standard", false) == "empty");
    CHECK(keep_name("Mon profil", true, {}) == "Mon profil");
    CHECK(keep_name("0.20mm Standard @K1C", false, {}) == "0.20mm Standard @K1C (Plyo)");
    CHECK(keep_name("0.20mm Standard @K1C", false, {"0.20mm Standard @K1C (Plyo)"}) == "0.20mm Standard @K1C (Plyo 2)");
}

TEST_CASE("RetouchesLogic::spool_undo_refusal : même bobine, rien retouché depuis")
{
    using Plyo::RetouchesLogic::spool_undo_refusal;
    const nlohmann::json kept = {{"preset", "Sunlu PLA+ noir"}, {"values", {{"filament_flow_ratio", "0.95"}}}};
    CHECK(spool_undo_refusal(kept, "Sunlu PLA+ noir", false, {{"filament_flow_ratio", "0.95"}}) == "");
    CHECK(spool_undo_refusal(kept, "Autre", false, {{"filament_flow_ratio", "0.95"}}) == "other_spool");
    CHECK(spool_undo_refusal(kept, "Sunlu PLA+ noir", true, {{"filament_flow_ratio", "0.95"}}) == "dirty");
    CHECK(spool_undo_refusal(kept, "Sunlu PLA+ noir", false, {{"filament_flow_ratio", "0.9"}}) == "changed");
    CHECK(spool_undo_refusal(nlohmann::json(), "Sunlu PLA+ noir", false, {}) == "other_spool");
}

TEST_CASE("ProjectLogic : habitude « comme la dernière fois » et panneau au lancement selon le niveau")
{
    using namespace Plyo::ProjectLogic;
    const nlohmann::json h = sanitize_habits({{"last_intent", {{"use", "everyday"}, {"pref", "balanced"}, {"speed", "normal"}, {"x", "y"}}}});
    CHECK(h["last_intent"] == nlohmann::json{{"use", "everyday"}, {"pref", "balanced"}, {"speed", "normal"}});
    CHECK_FALSE(sanitize_habits({{"last_intent", {{"pref", "balanced"}}}}).contains("last_intent")); // sans usage : rien
    CHECK(sanitize_habits({{"last_intent", {{"use", "<script>"}, {"speed", "fast"}}}}).contains("last_intent") == false);
    CHECK(opens_panel_at_startup("beginner"));
    CHECK(opens_panel_at_startup("skipped"));
    CHECK(opens_panel_at_startup(""));
    CHECK_FALSE(opens_panel_at_startup("expert"));
}


// --- Lot 12 de l'audit : page du panneau (scripts, CSP), durée de vie, écritures entre instances, lot vérifié sans Orca ---

namespace {

fs::path lot12_root() { return fs::path(__FILE__).parent_path() / ".." / ".." / ".." / ".."; }

std::string lot12_read(const fs::path& path)
{
    boost::nowide::ifstream in(path.string(), std::ios::binary);
    return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

} // namespace

TEST_CASE("Lot 12 · ARCH-11 : les scripts inclus viennent des marqueurs de la page, noms filtrés")
{
    using Plyo::PageLogic::include_names;
    const std::string page = "<!--plyo-include:a.js--><!--plyo-include:../x.js--><!--plyo-include:B.js-->"
                             "<!--plyo-include:style.css--><!--plyo-include:mod-2.js--><!--plyo-include:c.js";
    CHECK(include_names(page) == std::vector<std::string>{"a.js", "mod-2.js"});
    CHECK(include_names("").empty());
}

TEST_CASE("Lot 12 · ARCH-11 : chaque marqueur de la vraie page désigne un fichier du panneau")
{
    const fs::path    web  = lot12_root() / "resources" / "web" / "plyo";
    const std::string page = lot12_read(web / "index.html");
    REQUIRE_FALSE(page.empty());
    const std::vector<std::string> names = Plyo::PageLogic::include_names(page);
    CHECK(names.size() >= 17);
    CHECK(names.size() == count_of(page, "<!--plyo-include:")); // aucun marqueur au nom refusé
    for (const std::string& name : names) {
        INFO(name);
        CHECK(fs::is_regular_file(web / name));
    }
    // Plus de liste en dur côté C++ : la page est la seule liste.
    const std::string cpp = lot12_read(lot12_root() / "src" / "plyo" / "PlyoAssistant.cpp");
    CHECK(cpp.find("\"fiches.js\"") == std::string::npos);
    CHECK(cpp.find("PageLogic::assemble") != std::string::npos);
}

TEST_CASE("Lot 12 · CSP : origine du service, sans chemin ni caractère qui casserait la politique")
{
    using Plyo::PageLogic::origin_of;
    CHECK(origin_of("http://localhost:3000") == "http://localhost:3000");
    CHECK(origin_of("https://api.getplyo.app") == "https://api.getplyo.app");
    CHECK(origin_of("https://API.getplyo.app/v1/?x#y") == "https://api.getplyo.app");
    CHECK(origin_of("http://127.0.0.1:9") == "http://127.0.0.1:9");
    CHECK(origin_of("http://[::1]:3000/api") == "http://[::1]:3000");
    CHECK(origin_of("javascript:alert(1)").empty());
    CHECK(origin_of("file:///etc/passwd").empty());
    CHECK(origin_of("https://").empty());
    CHECK(origin_of("https://user@evil.example").empty());
    CHECK(origin_of("https://a.example; script-src *").empty());
    CHECK(origin_of("https://a.example'").empty());
}

TEST_CASE("Lot 12 · CSP : seulement ce que la page charge, construite d'après l'adresse du service")
{
    using Plyo::PageLogic::content_security_policy;
    const std::string csp = content_security_policy("http://localhost:3000/", "abc123");
    CHECK(csp == "default-src 'none'; script-src 'nonce-abc123'; style-src 'unsafe-inline'; img-src data: blob:; "
                 "connect-src http://localhost:3000; base-uri 'none'; form-action 'none'");
    CHECK(csp.find("unsafe-eval") == std::string::npos);
    CHECK(csp.find("script-src 'unsafe-inline'") == std::string::npos);
    CHECK(csp.find("http:;") == std::string::npos);
    // Adresse illisible : aucune connexion permise (le panneau le vit comme un service injoignable).
    CHECK(content_security_policy("pas une adresse", "n").find("connect-src 'none';") != std::string::npos);
    // Banc d'essai : origines de plus ; une origine qui casserait la directive est ignorée.
    const std::string bench = content_security_policy("http://127.0.0.1:9", "n", {"http://127.0.0.1:*", "x; script-src *"});
    CHECK(bench.find("connect-src http://127.0.0.1:9 http://127.0.0.1:*;") != std::string::npos);
    CHECK(bench.find("script-src *") == std::string::npos);
}

TEST_CASE("Lot 12 · CSP : jeton aléatoire, 32 caractères hexadécimaux, nouveau à chaque page")
{
    const std::string a = Plyo::PageLogic::new_nonce(), b = Plyo::PageLogic::new_nonce();
    CHECK(a.size() == 32);
    CHECK(a.find_first_not_of("0123456789abcdef") == std::string::npos);
    CHECK(a != b);
}

TEST_CASE("Lot 12 · page assemblée : chaque script porte le jeton, la politique ouvre <head>, rien d'autre ne bouge")
{
    using Plyo::PageLogic::assemble;
    const std::string page = "<!doctype html><html><head><meta charset=\"utf-8\"><style>p{}</style></head><body><p>x</p>"
                             "<!--plyo-config--><!--plyo-include:a.js--><!--plyo-include:../b.js--><script>main();</script></body></html>";
    const auto read = [](const std::string& name) {
        return name == "a.js" ? std::string("var s = '</script>'; // <!--plyo-include:a.js-->") : std::string("?");
    };
    const std::string out = assemble(page, read, "window.PLYO_API_URL = \"http://x\";", "B.run();", "CSP", "N1");
    CHECK(out.find("<head>\n<meta http-equiv=\"Content-Security-Policy\" content=\"CSP\"><meta charset") != std::string::npos);
    CHECK(count_of(out, "<script nonce=\"N1\">") == 4); // configuration, a.js, la page, le pilote
    CHECK(count_of(out, "<script>") == 0);
    CHECK(out.find("window.PLYO_API_URL = \"http://x\";") != std::string::npos);
    CHECK(out.find("var s = '<\\/script>';") != std::string::npos);            // « </script » neutralisé
    CHECK(out.find("// <!--plyo-include:a.js-->") != std::string::npos);       // marqueur cité par un module : jamais remplacé
    CHECK(out.find("<!--plyo-include:../b.js-->") != std::string::npos);       // nom refusé : reste un commentaire
    CHECK(out.find("/* PLYO_SELFTEST */\nB.run();") < out.find("</body>"));
    CHECK(out.find("main();") < out.find("PLYO_SELFTEST"));                   // le pilote passe après la page
    CHECK(out.find("<style>p{}</style>") != std::string::npos);
    // Hors banc : pas de pilote.
    CHECK(assemble(page, read, "c", "", "CSP", "N1").find("PLYO_SELFTEST") == std::string::npos);
}

TEST_CASE("Lot 12 · la vraie page assemblée : aucun script sans jeton, aucun attribut d'événement")
{
    const fs::path    web  = lot12_root() / "resources" / "web" / "plyo";
    const std::string page = lot12_read(web / "index.html");
    REQUIRE_FALSE(page.empty());
    const auto        read = [&web](const std::string& name) { return lot12_read(web / name); };
    const std::string csp  = Plyo::PageLogic::content_security_policy("http://127.0.0.1:9", "N");
    const std::string out  = Plyo::PageLogic::assemble(page, read, "window.PLYO_API_URL = \"http://127.0.0.1:9\";", "", csp, "N");
    CHECK(count_of(out, "<script") == count_of(out, "<script nonce=\"N\">"));
    CHECK(count_of(out, "<script nonce=\"N\">") == Plyo::PageLogic::include_names(page).size() + 2);
    CHECK(out.find("<!--plyo-include:") == std::string::npos);
    CHECK(out.find("<!--plyo-config-->") == std::string::npos);
    // La politique interdit les attributs « onclick=… » : la page n'en a aucun (le DOM est construit par le script).
    for (const char* attr : {" onclick=", " onload=", " onerror=", " onchange=", " oninput=", " onsubmit="})
        CHECK(page.find(attr) == std::string::npos);
}

TEST_CASE("Lot 15 · ARCH-17 : la vue web du panneau est cherchée en profondeur, bornée, et son absence est dite")
{
    // Arbre factice : 0 → {1, 2}, 1 → {3}, 3 → {4}, 4 → {5} ; « vues » : 2, 4 et 5.
    const std::map<int, std::vector<int>> tree{{0, {1, 2}}, {1, {3}}, {3, {4}}, {4, {5}}};
    const std::vector<int> none;
    const auto children = [&](int n) -> const std::vector<int>& { auto it = tree.find(n); return it == tree.end() ? none : it->second; };
    const auto view     = [](int n) { return n == 2 || n == 4 || n == 5; };
    using Plyo::PageLogic::find_bounded;
    CHECK(find_bounded(0, children, view, 1) == std::vector<int>{2});          // enfants directs seulement (avant ARCH-17)
    CHECK(find_bounded(0, children, view, 3) == std::vector<int>{2, 4});       // enveloppée deux fois : trouvée
    CHECK(find_bounded(0, children, view, 4) == std::vector<int>{2, 4, 5});
    CHECK(find_bounded(0, children, view, 0).empty());
    // Une hiérarchie qui boucle ne fait pas tourner la recherche sans fin.
    const std::map<int, std::vector<int>> loop{{0, {1}}, {1, {0}}};
    const auto loop_children = [&](int n) -> const std::vector<int>& { return loop.at(n); };
    CHECK(find_bounded(0, loop_children, [](int) { return false; }, 50).empty());
    const std::string cpp = read_file(repo_root() / "src" / "plyo" / "PlyoAssistant.cpp");
    CHECK(cpp.find("PageLogic::find_bounded<wxWindow*>(") != std::string::npos);
    CHECK(cpp.find("BOOST_LOG_TRIVIAL(error) << \"Plyo: aucune vue web trouvée sous le panneau") != std::string::npos);
}

TEST_CASE("Lot 12 · ROB-15 : la porte « on ferme » ne transmet plus rien, même un rappel déjà en file")
{
    Plyo::LifetimeLogic::ClosingGate gate;
    std::vector<std::function<void()>> queue; // la file du fil principal
    const auto poster = [&queue](std::function<void()> fn) { queue.push_back(std::move(fn)); };
    int ran = 0;
    CHECK(gate.post(poster, [&ran] { ++ran; }));
    REQUIRE(queue.size() == 1);
    queue[0]();
    CHECK(ran == 1);
    CHECK(gate.post(poster, [&ran] { ++ran; })); // en file…
    gate.close();                                // …puis Orca se ferme avant qu'il passe
    queue[1]();
    CHECK(ran == 1);
    CHECK_FALSE(gate.post(poster, [&ran] { ++ran; }));
    CHECK(queue.size() == 2);
    CHECK(gate.closing());
}

TEST_CASE("Lot 12 · ROB-15 : un fil qui finit après la fermeture ne rappelle pas l'application")
{
    Plyo::LifetimeLogic::ClosingGate gate;
    std::atomic<int>                 posted{0};
    const auto                       poster = [&posted](std::function<void()>) { ++posted; };
    gate.close();
    std::vector<std::thread> threads;
    for (int i = 0; i < 8; ++i)
        threads.emplace_back([&] { gate.post(poster, [] {}); });
    for (std::thread& t : threads)
        t.join();
    CHECK(posted == 0);
}

TEST_CASE("Lot 12 · ROB-18 : le drapeau « une seule fenêtre » retombe en sortant, exception comprise")
{
    bool open = false;
    {
        const Plyo::LifetimeLogic::FlagReset guard(open);
        CHECK(open);
    }
    CHECK_FALSE(open);
    try {
        const Plyo::LifetimeLogic::FlagReset guard(open);
        throw std::runtime_error("vue web impossible à créer");
    } catch (const std::runtime_error&) {
    }
    CHECK_FALSE(open); // « Se connecter » rouvre la fenêtre
}

TEST_CASE("Lot 12 · ROB-17 : un échec d'enregistrement a sa raison, distincte de « trop longue »")
{
    using Plyo::Conversations::Saved;
    using Plyo::Conversations::reason;
    CHECK(reason(Saved::Ok).empty());
    CHECK(reason(Saved::TooBig) == "too_big");
    CHECK(reason(Saved::WriteFailed) == "write_failed");
    CHECK(reason(Saved::Invalid) == "invalid");
}

TEST_CASE("Lot 12 · ROB-16 : fichier temporaire unique par processus et par écriture, aucun reste")
{
    const fs::path a = Plyo::Files::temp_path_for("/x/memoire.json");
    const fs::path b = Plyo::Files::temp_path_for("/x/memoire.json");
    CHECK(a != b);
    CHECK(a.string().rfind("/x/memoire.json.tmp-", 0) == 0);
    const fs::path dir  = fresh_dir();
    const fs::path file = dir / "memoire.json";
    for (int i = 0; i < 5; ++i)
        REQUIRE(Plyo::Files::write_atomic(file, "{\"n\":" + std::to_string(i) + "}", true));
    size_t files = 0;
    for (const fs::directory_entry& e : fs::directory_iterator(dir)) {
        (void) e;
        ++files;
    }
    CHECK(files == 1);
    fs::remove_all(dir);
}

#ifndef _WIN32
TEST_CASE("Lot 12 · ROB-16 : deux processus qui écrivent le même fichier ne se font jamais échouer, le fichier reste entier")
{
    const fs::path dir  = fresh_dir();
    const fs::path file = dir / "journal.json";
    const std::string mine = "{\"from\":\"parent\",\"pad\":\"" + std::string(20000, 'p') + "\"}";
    const std::string its  = "{\"from\":\"enfant\",\"pad\":\"" + std::string(20000, 'e') + "\"}";
    const pid_t child = fork();
    REQUIRE(child >= 0);
    if (child == 0) { // l'autre instance
        int failed = 0;
        for (int i = 0; i < 150; ++i)
            failed += Plyo::Files::write_atomic(file, its, true) ? 0 : 1;
        _exit(failed == 0 ? 0 : 1);
    }
    int failed = 0;
    for (int i = 0; i < 150; ++i)
        failed += Plyo::Files::write_atomic(file, mine, true) ? 0 : 1;
    int status = 0;
    waitpid(child, &status, 0);
    CHECK(failed == 0);
    CHECK((WIFEXITED(status) && WEXITSTATUS(status) == 0));
    const Plyo::Files::Loaded loaded = Plyo::Files::read_json(file, 1 << 20);
    REQUIRE(loaded.status == Plyo::Files::Status::Ok);
    CHECK((Plyo::Json::str(loaded.value, "from") == "parent" || Plyo::Json::str(loaded.value, "from") == "enfant"));
    size_t files = 0;
    for (const fs::directory_entry& e : fs::directory_iterator(dir)) {
        (void) e;
        ++files;
    }
    CHECK(files == 1); // aucun fichier temporaire laissé
    fs::remove_all(dir);
}

TEST_CASE("Lot 12 · ROB-16 : le verrou d'instance dit qu'une autre instance tient le dossier, et se libère avec elle")
{
    const fs::path dir  = fresh_dir();
    const fs::path lock = dir / "plyo" / ".lock";
    int to_parent[2], to_child[2];
    REQUIRE(pipe(to_parent) == 0);
    REQUIRE(pipe(to_child) == 0);
    const pid_t child = fork();
    REQUIRE(child >= 0);
    if (child == 0) { // la première instance : tient le verrou jusqu'au signal
        Plyo::Files::InstanceLock held(lock);
        const char state = held.state() == Plyo::Files::InstanceLock::State::Owned ? 'o' : 'x';
        if (write(to_parent[1], &state, 1) != 1)
            _exit(2);
        char go = 0;
        if (read(to_child[0], &go, 1) != 1)
            _exit(2);
        _exit(0);
    }
    char state = 0;
    REQUIRE(read(to_parent[0], &state, 1) == 1);
    CHECK(state == 'o');
    {
        const Plyo::Files::InstanceLock second(lock);
        CHECK(second.state() == Plyo::Files::InstanceLock::State::Taken);
    }
    const char go = 'g';
    REQUIRE(write(to_child[1], &go, 1) == 1);
    int status = 0;
    waitpid(child, &status, 0);
    {
        const Plyo::Files::InstanceLock after(lock); // la première s'est arrêtée : le verrou est libre
        CHECK(after.state() == Plyo::Files::InstanceLock::State::Owned);
    }
    for (int fd : {to_parent[0], to_parent[1], to_child[0], to_child[1]})
        close(fd);
    fs::remove_all(dir);
}
#endif

namespace {

Plyo::Catalog::Policy lot12_policy()
{
    const json policy = {{"forbidden_patterns", {"gcode"}}, {"forbidden_keys", json::array()}, {"confirm_patterns", json::array()},
                         {"confirm_keys", {"filament_flow_ratio"}}};
    const json keys = {{"print", {{"layer_height", "float"}, {"wall_loops", "int"}, {"seam_position", "enum"}}},
                       {"filament", {{"nozzle_temperature", "int"}, {"filament_flow_ratio", "float"}}},
                       {"titles", {{"layer_height", "Hauteur de couche"}, {"wall_loops", "Parois"}, {"nozzle_temperature", "Température de buse"}}}};
    return Plyo::Catalog::Policy::from_json(policy, keys);
}

// Profil simulé : ce qu'Orca dirait de chaque clé (absente : l'option n'existe pas dans ce profil).
std::optional<Plyo::Catalog::Probe> lot12_probe(const std::string& scope, const std::string& key)
{
    using Plyo::Catalog::Probe;
    if (scope == "print" && key == "layer_height")
        return Probe{{"float", 0, 1000, {}}, json(0.2), json(0.2)};
    if (scope == "print" && key == "wall_loops")
        return Probe{{"int", 0, 1000, {}}, json(2), json(2)};
    if (scope == "filament" && key == "nozzle_temperature")
        return Probe{{"int", 0, 1500, {}}, json(210), json(210)};
    if (scope == "filament" && key == "filament_flow_ratio")
        return Probe{{"float", 0, 2, {}}, json(0.98), json(0.98)};
    return std::nullopt; // seam_position : au catalogue, mais pas dans ce profil
}

std::string lot12_label(const std::string& key)
{
    const std::string title = lot12_policy().title(key);
    return title.empty() ? key : title;
}

} // namespace

TEST_CASE("Lot 12 · ARCH-16 : un lot valide est prévu en entier, valeur lue comme Orca, valeur d'avant gardée")
{
    std::vector<Plyo::Catalog::Planned> planned;
    const json changes = json::array({{{"key", "layer_height"}, {"value", 0.24}}, {{"key", "nozzle_temperature"}, {"value", 215}, {"label", "Buse"}}});
    const auto bad = Plyo::Catalog::check_lot(lot12_policy(), changes, lot12_probe, lot12_label, 0.4, no_limits, planned);
    REQUIRE_FALSE(bad.has_value());
    REQUIRE(planned.size() == 2);
    CHECK(planned[0].scope == "print");
    CHECK(planned[0].label == "Hauteur de couche"); // sans libellé du panneau : le titre du catalogue
    CHECK(planned[0].text == "0.24");
    CHECK(planned[0].before == json(0.2));
    CHECK(planned[1].scope == "filament");
    CHECK(planned[1].label == "Buse");
    CHECK(planned[1].text == "215");
    CHECK_FALSE(planned[1].confirmed);
}

TEST_CASE("Lot 12 · ARCH-16 : tout ou rien, le premier refus arrête le lot et ne prévoit rien")
{
    using Plyo::Catalog::check_lot;
    const auto policy = lot12_policy();
    std::vector<Plyo::Catalog::Planned> planned;
    const auto run = [&](const json& changes) { return check_lot(policy, changes, lot12_probe, lot12_label, 0.4, no_limits, planned); };

    auto bad = run(json::array());
    REQUIRE(bad.has_value());
    CHECK(bad->text == "Refusé : aucune modification reçue.");

    // Hors catalogue (G-code, imprimante) : refusé sans jamais montrer la clé d'Orca.
    bad = run(json::array({{{"key", "layer_height"}, {"value", 0.24}}, {{"key", "machine_start_gcode"}, {"value", "G28"}}}));
    REQUIRE(bad.has_value());
    CHECK(bad->text == "Refusé : ce réglage ne fait pas partie des réglages que l'assistant peut modifier. Aucune modification appliquée.");
    CHECK(planned.empty());

    bad = run(json::array({{{"key", "wall_loops"}, {"value", 3}}, {{"key", "wall_loops"}, {"value", 3}}}));
    REQUIRE(bad.has_value());
    CHECK(bad->text == "Refusé : « Parois » est demandé deux fois. Aucune modification appliquée.");

    bad = run(json::array({{{"key", "seam_position"}, {"value", "back"}}}));
    REQUIRE(bad.has_value());
    CHECK(bad->text == "Refusé : « seam_position » n'existe pas dans ce profil. Aucune modification appliquée.");
    CHECK(bad->key == "seam_position");

    // Dernière barrière : plafond de température, même confirmé ; type faux.
    bad = run(json::array({{{"key", "nozzle_temperature"}, {"value", 320}, {"confirmed", true}, {"confirmed_outside_range", true}}}));
    REQUIRE(bad.has_value());
    CHECK(bad->key == "nozzle_temperature");
    CHECK(bad->code.empty());
    bad = run(json::array({{{"key", "wall_loops"}, {"value", "trois"}}}));
    REQUIRE(bad.has_value());
    CHECK(bad->key == "wall_loops");
    CHECK(planned.empty());
}

TEST_CASE("Lot 12 · ARCH-16 : réglage sensible ou écart trop grand : une confirmation suffit, et le dit")
{
    using Plyo::Catalog::check_lot;
    const auto policy = lot12_policy();
    std::vector<Plyo::Catalog::Planned> planned;
    auto bad = check_lot(policy, json::array({{{"key", "filament_flow_ratio"}, {"value", 0.95}}}), lot12_probe, lot12_label, 0.4, no_limits, planned);
    REQUIRE(bad.has_value());
    CHECK(bad->code == "needs_confirmation");
    bad = check_lot(policy, json::array({{{"key", "filament_flow_ratio"}, {"value", 0.95}, {"confirmed", true}}}), lot12_probe, lot12_label, 0.4, no_limits, planned);
    CHECK_FALSE(bad.has_value());
    REQUIRE(planned.size() == 1);
    CHECK(planned[0].confirmed);
    // Écart : 2 → 20 parois.
    bad = check_lot(policy, json::array({{{"key", "wall_loops"}, {"value", 20}}}), lot12_probe, lot12_label, 0.4, no_limits, planned);
    REQUIRE(bad.has_value());
    CHECK(bad->code == "needs_confirmation");
    CHECK(planned.empty());
}

TEST_CASE("Lot 12 · ARCH-16 : refused_name ne montre jamais la clé d'Orca")
{
    using Plyo::Catalog::refused_name;
    CHECK(refused_name("layer_height", lot12_label) == "« Hauteur de couche »");
    CHECK(refused_name("seam_position", lot12_label) == "ce réglage");
    CHECK(refused_name("", lot12_label) == "ce réglage");
}
