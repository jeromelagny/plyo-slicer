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

#include <boost/filesystem.hpp>
#include <boost/nowide/fstream.hpp>

#include <random>
#include <string>

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
    CHECK(out["values"]["print"] == json{{"layer_height", "0.2"}});
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
    REQUIRE(temperature_cap("nozzle_temperature").has_value());
    CHECK(*temperature_cap("nozzle_temperature") == 320);
    CHECK(*temperature_cap("nozzle_temperature_initial_layer") == 320);
    CHECK(*temperature_cap("hot_plate_temp") == 130);
    CHECK(*temperature_cap("textured_cool_plate_temp_initial_layer") == 130);
    CHECK(*temperature_cap("chamber_temperature") == 130);
    CHECK_FALSE(temperature_cap("layer_height").has_value());
    CHECK_FALSE(temperature_cap("activate_chamber_temp_control").has_value());

    // Filaments techniques légitimes : jamais refusés.
    CHECK(check_temperature_cap("Buse", "nozzle_temperature", 320).ok);
    CHECK(check_temperature_cap("Plateau", "hot_plate_temp", 130).ok);
    CHECK(check_temperature_cap("Plateau", "hot_plate_temp", 0).ok);
    CHECK(check_temperature_cap("Attente", "filament_tower_interface_print_temp", -1).ok);

    const CheckResult nozzle = check_temperature_cap("Buse", "nozzle_temperature", 321);
    CHECK_FALSE(nozzle.ok);
    CHECK(nozzle.text.find("320") != std::string::npos);
    const CheckResult bed = check_temperature_cap("Plateau", "hot_plate_temp", 200);
    CHECK_FALSE(bed.ok);
    CHECK(bed.text.find("130") != std::string::npos);
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
    CHECK(gone.refusal == "L'emplacement 4 n'est plus visible sur le Canvas : l'impression n'a pas démarré. Le fichier est sur l'imprimante : dans Plyo, à l'étape Imprimer, « Démarrer sans carte », ou choisis à nouveau les emplacements.");
    const SlotsLogic::MapDecision same = CC2Logic::decide_map(planned, json::array(), {});
    CHECK(same.refusal == gone.refusal);
    const SlotsLogic::MapDecision none = SlotsLogic::decide_map(planned, json(), {});
    CHECK(none.refusal.find("Je n'ai pas pu relire") == 0);
    CHECK(none.refusal.find("Démarrer sans carte") != std::string::npos);
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
