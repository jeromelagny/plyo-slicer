// Sous Windows, boost (asio, via PlyoCC2.hpp) doit être inclus avant les en-têtes de wxWidgets.
#include "PlyoCanvas.hpp"

#include "PlyoCC2.hpp"
#include "PlyoCanvasLogic.hpp"
#include "PlyoCfs.hpp"
#include "PlyoFirstSteps.hpp"
#include "PlyoIfs.hpp"
#include "PlyoJson.hpp"
#include "PlyoPrinterLink.hpp"
#include "PlyoSlotsLogic.hpp"

#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/PartPlate.hpp"
#include "slic3r/GUI/Plater.hpp"

#include <boost/log/trivial.hpp>

#include <chrono>
#include <future>
#include <memory>
#include <thread>

namespace Plyo { namespace Canvas {

using Slic3r::GUI::wxGetApp;

namespace {

Slic3r::PresetBundle& bundle() { return *wxGetApp().preset_bundle; }

// L'imprimante d'un profil et son traducteur (SlotsLogic::detect). Le code d'accès ne sort jamais d'ici.
struct Target
{
    std::string kind = "none"; // canvas, cfs, ifs, u1, none
    bool        imposable = false;
    std::string reason;
    std::string host, code, host_type, model;
    std::shared_ptr<const Slic3r::DynamicPrintConfig> config; // copie : les lectures partent dans un autre fil
};

Target target_of_config(const Slic3r::DynamicPrintConfig& c)
{
    Target                         t;
    const SlotsLogic::PrinterFacts facts = PrinterLink::facts_of(c);
    const SlotsLogic::Detection    found = SlotsLogic::detect(facts);
    t.kind      = found.kind;
    t.imposable = found.imposable;
    t.reason    = found.reason;
    t.host_type = facts.host_type;
    t.model     = facts.printer_model;
    t.host      = c.has("print_host") ? bare_host(c.opt_string("print_host")) : std::string();
    t.code      = c.has("printhost_apikey") ? c.opt_string("printhost_apikey") : std::string();
    t.config    = std::make_shared<const Slic3r::DynamicPrintConfig>(c);
    return t;
}

Target target_of(const std::string& printer_preset)
{
    const Slic3r::Preset* p = bundle().printers.find_preset(printer_preset, false);
    return p != nullptr ? target_of_config(p->config) : Target();
}

// Numéros (à partir de 0) des filaments utilisés par la plaque en cours, y compris les changements de filament posés sur
// le curseur de l'aperçu (true : Orca compte alors les G-codes personnalisés de type ToolChange).
std::vector<int> used_filaments()
{
    std::vector<int> out;
    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    if (plater == nullptr)
        return out;
    Slic3r::GUI::PartPlate* plate = plater->get_partplate_list().get_curr_plate();
    if (plate == nullptr)
        return out;
    for (int e : plate->get_extruders(true))
        if (e >= 1)
            out.push_back(e - 1);
    return out;
}

void set_colour(size_t idx, const std::string& color)
{
    Slic3r::DynamicPrintConfig& cfg = bundle().project_config;
    auto* head = cfg.option<Slic3r::ConfigOptionStrings>("filament_colour");
    if (head == nullptr || idx >= head->values.size() || color.empty())
        return;
    std::unique_ptr<Slic3r::ConfigOptionStrings> new_head(static_cast<Slic3r::ConfigOptionStrings*>(head->clone()));
    new_head->values[idx] = color;
    Slic3r::DynamicPrintConfig change;
    change.set_key_value("filament_colour", new_head.release());
    if (auto* pack = cfg.option<Slic3r::ConfigOptionStrings>("filament_multi_colour"); pack != nullptr && idx < pack->values.size()) {
        auto* new_pack         = static_cast<Slic3r::ConfigOptionStrings*>(pack->clone());
        new_pack->values[idx] = color;
        change.set_key_value("filament_multi_colour", new_pack);
    }
    cfg.apply(change);
    // Comme le sélecteur de couleur d'Orca (PresetComboBox) : la vue et les volumes de purge suivent.
    if (Slic3r::GUI::Plater* plater = wxGetApp().plater()) {
        plater->on_config_change(change);
        wxCommandEvent* evt = new wxCommandEvent(Slic3r::GUI::EVT_FILAMENT_COLOR_CHANGED);
        evt->SetInt(static_cast<int>(idx));
        wxQueueEvent(plater, evt);
    }
}

// Faux seulement pour le premier filament, si l'utilisateur a annulé dans la fenêtre d'Orca.
bool set_preset(size_t idx, const std::string& name)
{
    if (idx == 0)
        return FirstSteps::select_filament(name); // le premier filament suit aussi l'onglet Filament
    bundle().set_filament_preset(idx, name);
    if (Slic3r::GUI::Plater* plater = wxGetApp().plater()) {
        plater->update_project_dirty_from_presets();
        plater->sidebar().update_dynamic_filament_list();
        plater->on_filament_change(idx);
    }
    bundle().export_selections(*wxGetApp().app_config);
    return true;
}

} // namespace

std::string bare_host(const std::string& print_host) { return CanvasLogic::bare_host(print_host); }

std::string translator_of(const Slic3r::DynamicPrintConfig& config, std::string* reason)
{
    const SlotsLogic::Detection found = SlotsLogic::detect(PrinterLink::facts_of(config));
    if (reason != nullptr)
        *reason = found.reason;
    return found.kind == "none" ? std::string() : found.kind;
}

nlohmann::json colours()
{
    nlohmann::json out  = nlohmann::json::array();
    const auto*    head = bundle().project_config.option<Slic3r::ConfigOptionStrings>("filament_colour");
    for (int t : used_filaments()) {
        std::string type;
        if (t < static_cast<int>(bundle().filament_presets.size()))
            if (const Slic3r::Preset* f = bundle().filaments.find_preset(bundle().filament_presets[t], false))
                if (const auto* ft = f->config.option<Slic3r::ConfigOptionStrings>("filament_type"); ft != nullptr && !ft->values.empty())
                    type = ft->values.front();
        const std::string color = head != nullptr && t < static_cast<int>(head->values.size()) ? head->values[t] : std::string();
        out.push_back({{"t", t}, {"color", color}, {"type", type}});
    }
    return out;
}

namespace {

// Lecture réseau du traducteur (hors du fil principal) : l'état commun, sans les couleurs de la plaque.
// Une lecture qui échoue ou une valeur inattendue donnent toujours imposable faux.
nlohmann::json read_unit(const Target& t)
{
    std::string    error;
    nlohmann::json units = nullptr;
    bool           live  = false;
    std::string    blocker;
    if (t.kind == "canvas") {
        const std::string serial = CC2::serial_of(t.host);
        if (!serial.empty()) {
            const nlohmann::json canvas = CC2::read_canvas(t.host, t.code, serial, error);
            if (!canvas.is_null()) {
                units = Json::arr(canvas, "canvases");
                live  = true;
            } else
                BOOST_LOG_TRIVIAL(info) << "Plyo: Canvas illisible : " << error;
        }
    } else if (t.config != nullptr) {
        nlohmann::json r = nullptr;
        if (t.kind == "cfs")
            r = Cfs::read(*t.config, error);
        else if (t.kind == "ifs")
            r = Ifs::read(*t.config, error);
        if (r.is_object()) {
            units   = Json::arr(r, "canvases");
            live    = Json::boolean(r, "imposable", false);
            blocker = Json::str(r, "blocker");
        } else
            BOOST_LOG_TRIVIAL(info) << "Plyo: emplacements illisibles (" << t.kind << ") : " << error; // error ne contient jamais le corps des réponses
    }
    nlohmann::json out = {{"ok", false}, {"reason", "unreachable"}};
    if (units.is_array()) {
        bool any = false;
        for (const nlohmann::json& u : units)
            any = any || (Json::boolean(u, "connected", false) && !Json::arr(u, "trays").empty());
        out = any ? nlohmann::json{{"ok", true}, {"canvases", units}} : nlohmann::json{{"ok", false}, {"reason", "no_canvas"}};
    }
    const bool readable = Json::boolean(out, "ok", false);
    out.update(SlotsLogic::state_fields(t.kind, t.imposable && live && readable));
    if (!blocker.empty())
        out["blocker"] = blocker; // pourquoi on lit sans imposer
    return out;
}

} // namespace

void read(const std::string& printer_preset, std::function<void(nlohmann::json)> done)
{
    const Target t = target_of(printer_preset);
    if (t.kind == "none") {
        done({{"ok", false}, {"reason", t.reason.empty() ? std::string("no_translator") : t.reason}});
        return;
    }
    const nlohmann::json cols = colours();
    std::thread([t, cols, done = std::move(done)]() {
        nlohmann::json out = read_unit(t);
        out["colours"]     = cols;
        wxGetApp().CallAfter([done, out] { done(out); });
    }).detach();
}

nlohmann::json apply(const nlohmann::json& entries)
{
    if (!entries.is_array() || entries.empty())
        return {{"ok", false}, {"text", "Aucun emplacement choisi."}};
    // D'abord trouver tous les profils : rien n'est changé si l'un manque.
    std::vector<std::pair<size_t, std::string>> presets;
    for (const nlohmann::json& e : entries) {
        const nlohmann::json* tv = Json::field(e, "t");
        if (tv == nullptr || !tv->is_number_integer() || tv->get<int>() < 0 || tv->get<size_t>() >= bundle().filament_presets.size())
            return {{"ok", false}, {"text", "Cette couleur n'existe pas dans la pièce. Recharge la pièce, puis choisis à nouveau."}};
        std::string name;
        const std::string type = Json::str(e, "type", 30);
        for (const std::string& candidate : CanvasLogic::profile_types(type))
            if (name = FirstSteps::best_filament(candidate); !name.empty())
                break;
        if (name.empty())
            return {{"ok", false}, {"text", "Je n'ai pas trouvé de profil " + (type.empty() ? std::string("de filament") : type) + " pour cette imprimante. Choisis un autre emplacement ou un autre filament."}};
        presets.emplace_back(tv->get<size_t>(), name);
    }
    // Le premier filament d'abord : c'est le seul choix que l'utilisateur peut annuler, et rien d'autre n'a alors changé.
    for (const auto& [t, name] : presets)
        if (t == 0 && !set_preset(t, name))
            return {{"ok", false}, {"text", "Choix annulé : les emplacements et ton filament n'ont pas changé. Enregistre ou abandonne d'abord tes modifications du filament."}};
    nlohmann::json out = {{"ok", true}, {"presets", nlohmann::json::array()}};
    for (size_t i = 0; i < presets.size(); ++i) {
        if (presets[i].first != 0)
            set_preset(presets[i].first, presets[i].second);
        set_colour(presets[i].first, Json::str(entries[i], "color", 16));
        out["presets"].push_back({{"t", presets[i].first}, {"preset", presets[i].second}});
    }
    return out;
}

void plan(const std::string& printer_preset, const nlohmann::json& map)
{
    const Target t = target_of(printer_preset);
    if (t.kind != "canvas" || !map.is_array() || map.empty()) {
        CC2::clear_plan();
        return;
    }
    nlohmann::json clean = nlohmann::json::array(); // {t, canvas_id, tray_id, type, preset} seulement
    for (const nlohmann::json& e : map)
        if (e.is_object())
            clean.push_back({{"t", Json::any(e, "t")}, {"canvas_id", Json::any(e, "canvas_id")}, {"tray_id", Json::any(e, "tray_id")},
                             {"type", Json::str(e, "type", 30)}, {"preset", Json::str(e, "preset", 200)}});
    CC2::set_plan({{"host", t.host}, {"map", clean}});
}

bool orca_state(std::vector<int>& sliced_t, std::vector<std::string>& presets)
{
    auto read_now = [](std::vector<int>& s, std::vector<std::string>& p) {
        s = used_filaments();
        p = bundle().filament_presets;
    };
    if (wxIsMainThread()) {
        read_now(sliced_t, presets);
        return true;
    }
    using Result = std::pair<std::vector<int>, std::vector<std::string>>;
    auto promise = std::make_shared<std::promise<Result>>();
    auto future  = promise->get_future();
    wxGetApp().CallAfter([promise, read_now] {
        Result r;
        read_now(r.first, r.second);
        promise->set_value(std::move(r));
    });
    if (future.wait_for(std::chrono::seconds(5)) != std::future_status::ready)
        return false;
    Result r = future.get();
    sliced_t = std::move(r.first);
    presets  = std::move(r.second);
    return true;
}

void clear_plan() { CC2::clear_plan(); }

void start_plain(const std::string& printer_preset, std::function<void(nlohmann::json)> done)
{
    const Target t = target_of(printer_preset);
    if (t.kind != "canvas") { // sur les autres marques, le sens d'un départ sans carte n'est pas vérifié
        done({{"ok", false}, {"text", "Je ne peux pas démarrer sans répartition sur cette imprimante : rien n'est parti."}});
        return;
    }
    std::thread([host = t.host, code = t.code, done = std::move(done)]() {
        std::string error;
        const bool  ok = CC2::start_again_plain(host, code, error);
        const nlohmann::json out = {{"ok", ok}, {"text", ok ? std::string("L'impression a démarré ; l'imprimante a choisi les emplacements.") : error}};
        wxGetApp().CallAfter([done, out] { done(out); });
    }).detach();
}

void select_extra(const std::vector<std::pair<int, std::string>>& extra)
{
    for (const auto& [t, name] : extra)
        if (t > 0 && static_cast<size_t>(t) < bundle().filament_presets.size() && bundle().filaments.find_preset(name, false) != nullptr &&
            bundle().filament_presets[t] != name)
            set_preset(static_cast<size_t>(t), name);
}

}} // namespace Plyo::Canvas
