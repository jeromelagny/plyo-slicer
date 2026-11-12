#include "PlyoSelfTest.hpp"
#include "PlyoJson.hpp"
#include "PlyoOrcaMessages.hpp"
#include "PlyoPlateActions.hpp"
#include "PlyoPreflight.hpp"
#include "PlyoProject.hpp"
#include "PlyoSettingsBridge.hpp"

#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/MainFrame.hpp"

#include <boost/log/trivial.hpp>
#include <boost/nowide/cstdlib.hpp>
#include <boost/nowide/fstream.hpp>

#include <wx/toplevel.h>

#include <chrono>
#include <ios>
#include <iterator>
#include <sstream>
#include <string>

namespace Plyo { namespace SelfTest {

namespace {

constexpr std::streamoff MAX_DRIVER_BYTES = 1024 * 1024; // un pilote plus gros est refusé (page du panneau bornée)
constexpr size_t         MAX_LINE_BYTES   = 64 * 1024;   // une ligne du journal du banc au plus

struct Bench
{
    bool        active = false;
    std::string path;   // le pilote (PLYO_SELFTEST)
    std::string script; // son contenu
    std::chrono::steady_clock::time_point start = std::chrono::steady_clock::now();
};

// Lu une seule fois : la variable ne change pas pendant la vie de l'application.
const Bench& bench()
{
    static const Bench b = [] {
        Bench out;
        const char* env = boost::nowide::getenv("PLYO_SELFTEST");
        if (env == nullptr || *env == '\0')
            return out; // hors banc : rien d'autre n'est lu
        out.path = env;
        boost::nowide::ifstream file(out.path, std::ios::binary | std::ios::ate);
        if (!file) {
            BOOST_LOG_TRIVIAL(error) << "Plyo: banc d'essai : pilote illisible (" << out.path << "), banc désactivé";
            return out;
        }
        const std::streamoff size = file.tellg();
        if (size <= 0 || size > MAX_DRIVER_BYTES) {
            BOOST_LOG_TRIVIAL(error) << "Plyo: banc d'essai : pilote vide ou trop gros (" << size << " octets), banc désactivé";
            return out;
        }
        file.seekg(0);
        out.script.assign(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>());
        out.active = true;
        BOOST_LOG_TRIVIAL(warning) << "Plyo: banc d'essai ACTIF, pilote " << out.path;
        return out;
    }();
    return b;
}

// Une ligne JSON ajoutée au journal du banc (<pilote>.log), fichier fermé aussitôt : rien n'est perdu si l'application tombe.
void append_line(const std::string& file_suffix, nlohmann::json line)
{
    if (!line.is_object())
        line = nlohmann::json{{"value", line}};
    line["t_ms"] = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - bench().start).count();
    std::string text = line.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace);
    if (text.size() > MAX_LINE_BYTES)
        text = nlohmann::json({{"t_ms", line["t_ms"]}, {"truncated", Json::utf8_prefix(text, MAX_LINE_BYTES - 200)}}).dump();
    boost::nowide::ofstream out(bench().path + file_suffix, std::ios::binary | std::ios::app);
    out << text << '\n';
    out.flush();
}

// Fenêtres de premier niveau visibles (titre) : le pilote vérifie qu'aucune fenêtre d'Orca ne s'est ouverte.
nlohmann::json shown_windows()
{
    nlohmann::json out = nlohmann::json::array();
    for (wxWindow* w : wxTopLevelWindows)
        if (w != nullptr && w->IsShown())
            out.push_back({{"title", w->GetLabel().utf8_string()}, {"main", w == Slic3r::GUI::wxGetApp().mainframe}});
    return out;
}

// Lectures seules d'un état déjà exposé par Plyo : aucune n'écrit dans Orca ni sur le disque.
nlohmann::json call(const std::string& fn)
{
    if (fn == "snapshot")
        return SettingsBridge::read_snapshot();
    if (fn == "values")
        return SettingsBridge::read_values();
    if (fn == "orca_issues")
        return OrcaMessages::report();
    if (fn == "preflight")
        return Preflight::measure();
    if (fn == "project_state")
        return Project::state();
    if (fn == "plate")
        return PlateActions::context();
    if (fn == "windows")
        return shown_windows();
    return {{"error", "fonction inconnue : " + Json::utf8_prefix(fn, 40)}};
}

} // namespace

bool active() { return bench().active; }

std::string page_script()
{
    if (!active())
        return std::string();
    // Une balise </script> dans le texte du pilote fermerait la nôtre : on la neutralise.
    std::string script = bench().script;
    for (size_t at = script.find("</script"); at != std::string::npos; at = script.find("</script", at + 2))
        script.replace(at, 2, "<\\/");
    return "<script>\n/* PLYO_SELFTEST */\n" + script + "\n</script>\n";
}

bool handle(const std::string& type, const nlohmann::json& data, const std::function<void(const nlohmann::json&)>& send)
{
    if (!active() || type.rfind("selftest_", 0) != 0)
        return false;
    if (type == "selftest_log") {
        append_line(".log", Json::any(data, "entry"));
    } else if (type == "selftest_done") {
        nlohmann::json verdict = Json::any(data, "verdict");
        append_line(".log", {{"step", "verdict"}, {"verdict", verdict}});
        append_line(".verdict", verdict);
        // Même chemin que « Quitter » (MainFrame::Close), forcé : aucune fenêtre de confirmation (projet ou préréglages
        // modifiés) ne peut bloquer la fin du banc.
        Slic3r::GUI::wxGetApp().CallAfter([] {
            if (Slic3r::GUI::MainFrame* frame = Slic3r::GUI::wxGetApp().mainframe)
                frame->Close(true);
        });
    } else if (type == "selftest_call") {
        const std::string fn = Json::str(data, "fn", 40);
        send({{"type", "selftest_result"}, {"request", Json::integer(data, "request", 0)}, {"fn", fn}, {"result", call(fn)}});
    } else
        return false;
    return true;
}

}} // namespace Plyo::SelfTest
