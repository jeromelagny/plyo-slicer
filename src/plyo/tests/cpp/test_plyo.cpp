// Tests de la logique pure de Plyo (sans wxWidgets ni Orca) : lecture typée des messages, fichiers JSON,
// nettoyage des données enregistrées. Lancés par src/plyo/tests/cpp/run.sh.
#include <catch_amalgamated.hpp>

#include "../../PlyoFiles.hpp"
#include "../../PlyoJson.hpp"
#include "../../PlyoSanitize.hpp"
#include "../../PlyoDiscoveryLogic.hpp"
#include "../../PlyoLimitsLogic.hpp"
#include "../../PlyoCatalogPolicy.hpp"
#include "../../PlyoProfilesLogic.hpp"

#include <boost/filesystem.hpp>
#include <boost/nowide/fstream.hpp>

#include <random>
#include <string>

namespace fs = boost::filesystem;
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
