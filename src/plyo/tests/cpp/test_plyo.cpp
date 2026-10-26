// Tests de la logique pure de Plyo (sans wxWidgets ni Orca) : lecture typée des messages, fichiers JSON,
// nettoyage des données enregistrées. Lancés par src/plyo/tests/cpp/run.sh.
#include <catch_amalgamated.hpp>

#include "../../PlyoFiles.hpp"
#include "../../PlyoJson.hpp"
#include "../../PlyoSanitize.hpp"

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
