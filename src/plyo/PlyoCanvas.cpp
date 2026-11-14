// Sous Windows, boost (asio, via PlyoCC2.hpp) doit être inclus avant les en-têtes de wxWidgets.
#include "PlyoCanvas.hpp"
#include "PlyoLifetime.hpp"

#include "PlyoCC2.hpp"
#include "PlyoAutoSave.hpp"
#include "PlyoBrands.hpp"
#include "PlyoCanvasLogic.hpp"
#include "PlyoCfs.hpp"
#include "PlyoFirstSteps.hpp"
#include "PlyoIfs.hpp"
#include "PlyoJson.hpp"
#include "PlyoPrinterLink.hpp"
#include "PlyoSend.hpp"
#include "PlyoSlotsLogic.hpp"
#include "PlyoSpoolsLogic.hpp"
#include "PlyoU1.hpp"

#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "PlyoCfsLogic.hpp"
#include "PlyoIfsLogic.hpp"

#include "libslic3r/AppConfig.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/PartPlate.hpp"
#include "slic3r/GUI/Plater.hpp"
#include "slic3r/Utils/PrintHost.hpp"

#include <boost/filesystem/path.hpp>
#include <boost/log/trivial.hpp>

#include <chrono>
#include <future>
#include <memory>
#include <thread>

namespace Plyo { namespace Canvas {

using Slic3r::GUI::wxGetApp;

namespace {

Slic3r::PresetBundle& bundle() { return *wxGetApp().preset_bundle; }

// Tout ceci ne vit que sur le fil principal.
nlohmann::json g_last_read = nullptr;  // {host, ok, imposable, source} de la dernière lecture sur la machine
nlohmann::json g_send_plan = nullptr;  // plan CFS/IFS {host, kind, host_type, model, map}
bool           g_send_busy = false;    // une relecture d'envoi est en cours

std::optional<std::map<std::string, std::string>> g_armed;
bool                                              g_armed_taken = false;

// L'envoi armé ne survit jamais à l'appel à send_gcode_legacy, même si Orca s'arrête avant de le prendre.
class ArmedSend
{
public:
    explicit ArmedSend(std::map<std::string, std::string> info)
    {
        g_armed       = std::move(info);
        g_armed_taken = false;
    }
    ~ArmedSend() { g_armed.reset(); }
    ArmedSend(const ArmedSend&)            = delete;
    ArmedSend& operator=(const ArmedSend&) = delete;
    bool taken() const { return g_armed_taken; }
};

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
std::vector<int> used_filaments(bool with_cursor_changes = true)
{
    std::vector<int> out;
    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    if (plater == nullptr)
        return out;
    Slic3r::GUI::PartPlate* plate = plater->get_partplate_list().get_curr_plate();
    if (plate == nullptr)
        return out;
    for (int e : plate->get_extruders(with_cursor_changes))
        if (e >= 1)
            out.push_back(e - 1);
    return out;
}

// Ce que la découpe a réellement utilisé (statistiques du G-code), à partir de 0 ; vide si inconnu.
std::vector<int> sliced_filaments()
{
    std::vector<int> out;
    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    if (plater == nullptr)
        return out;
    Slic3r::GUI::PartPlate* plate = plater->get_partplate_list().get_curr_plate();
    if (plate == nullptr)
        return out;
    for (int e : plate->get_used_filaments())
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

// Faux seulement pour le premier filament, si l'utilisateur a annulé dans la fenêtre d'Orca (l'onglet Filament le suit).
bool set_preset(size_t idx, const std::string& name) { return FirstSteps::select_filament(name, idx); }

} // namespace

std::string bare_host(const std::string& print_host) { return CanvasLogic::bare_host(print_host); }

void set_project_colour(size_t idx, const std::string& color) { set_colour(idx, color); }

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
        else if (t.kind == "u1")
            r = U1::read(*t.config, error);
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
        Lifetime::post("la lecture des emplacements", [done, out, host = t.host] {
            g_last_read = {{"host", host}, {"ok", Json::boolean(out, "ok", false)}, {"imposable", Json::boolean(out, "imposable", false)}, {"source", Json::str(out, "source")}};
            done(out);
        });
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
        // Marque choisie par l'utilisateur pour cet emplacement : un profil fourni de la matière de l'emplacement, compatible
        // avec cette imprimante (même matière que le générique ci-dessous), sinon refus. Sans marque : le générique, comme avant.
        if (const std::string brand_preset = Json::str(e, "preset", 200); !brand_preset.empty()) {
            const nlohmann::json slot = Brands::for_type(type);
            if (Brands::check(Json::str(slot, "material"), brand_preset).empty())
                return {{"ok", false}, {"text", "Le profil « " + brand_preset + " » ne va pas avec cet emplacement sur cette imprimante : choisis à nouveau sa marque, ou « Je ne sais pas »."}};
            name = brand_preset;
        }
        for (const std::string& candidate : CanvasLogic::profile_types(type)) {
            if (!name.empty())
                break;
            name = FirstSteps::best_filament(candidate);
        }
        if (name.empty())
            return {{"ok", false}, {"text", "Je n'ai pas trouvé de profil " + (type.empty() ? std::string("de filament") : type) + " pour cette imprimante. Choisis un autre emplacement ou un autre filament."}};
        presets.emplace_back(tv->get<size_t>(), name);
    }
    // La bobine en cours garde d'abord ses derniers réglages : sinon Orca demanderait quoi faire de ses modifications.
    if (AutoSave::flush_spool() == SpoolsLogic::Flush::Refuse)
        return {{"ok", false}, {"text", SpoolsLogic::FLUSH_REFUSED_TEXT}};
    // Le premier filament d'abord : c'est le seul choix que l'utilisateur peut annuler, et rien d'autre n'a alors changé.
    // Annulé : le filament en cours n'est pas une bobine, et ses modifications restent telles quelles.
    for (const auto& [t, name] : presets)
        if (t == 0 && !set_preset(t, name))
            return {{"ok", false}, {"text", "Choix annulé : les emplacements et ton filament n'ont pas changé, tes modifications restent en place. Choisis à nouveau quand tu veux : Plyo Slicer te redemandera quoi en faire."}};
    // Profils de marque choisis : Orca les garde au prochain lancement (voir Brands::keep_visible).
    for (size_t i = 0; i < presets.size(); ++i)
        if (!Json::str(entries[i], "preset", 200).empty())
            Brands::keep_visible(presets[i].second);
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
    g_send_plan    = nullptr;
    if (t.kind != "canvas" || !map.is_array() || map.empty()) {
        CC2::clear_plan();
        // CFS/IFS : seulement après une lecture imposable sur la machine. Une saisie manuelle n'arrive jamais ici comme répartition
        // (source: manual → SlotsLogic::plan_allowed faux), la U1 et les machines sans traducteur non plus.
        SlotsLogic::Detection found;
        found.kind      = t.kind;
        found.imposable = t.imposable;
        if (SlotsLogic::plan_allowed(found, g_last_read, t.host))
            if (const nlohmann::json clean = SlotsLogic::clean_send_map(map); !clean.empty())
                g_send_plan = {{"host", t.host}, {"kind", t.kind}, {"host_type", t.host_type}, {"model", t.model}, {"map", clean}};
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
    // Orca qui se ferme : rien n'est lu (le départ avec carte est refusé, comme après 5 s sans réponse).
    if (Lifetime::closing())
        return false;
    Lifetime::post("la lecture des pièces découpées", [promise, read_now] {
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

void clear_plan()
{
    CC2::clear_plan();
    g_send_plan = nullptr;
}

std::optional<std::map<std::string, std::string>> take_armed_send()
{
    if (!wxIsMainThread() || !g_armed)
        return std::nullopt;
    auto info = std::move(g_armed);
    g_armed.reset();
    g_armed_taken = true;
    return info;
}

bool fill_armed_upload(Slic3r::PrintHostUpload& upload, const std::string& file_name, bool use_3mf, int plate_idx)
{
    // Déplacé tel quel de Plater::send_gcode_legacy (mêmes champs, mêmes valeurs, même ordre). Un test de source
    // (test_plyo.cpp, « envoi armé ») vérifie que la branche voisine d'Orca, celle de la fenêtre, n'a pas changé.
    const auto plyo_info = take_armed_send();
    if (!plyo_info)
        return false;
    upload.upload_path   = boost::filesystem::path(file_name);
    upload.post_action   = Slic3r::PrintHostPostUploadAction::StartPrint;
    upload.extended_info = *plyo_info;
    if (use_3mf) // comme la branche d'Orca : le profil AD5X a use_3mf à 1
        upload.extended_info["plateindex"] = std::to_string(plate_idx + 1);
    return true;
}

namespace {

// Fil principal, après la relecture : dernier contrôle, puis l'envoi. Tout refus laisse le plan en place et n'envoie rien.
nlohmann::json finish_send(const Target& t, const nlohmann::json& state)
{
    const auto refuse = [](const std::string& text) { return nlohmann::json{{"ok", false}, {"text", text}}; };
    const std::string nothing = " Rien n'est parti.";
    if (!g_send_plan.is_object() || Json::str(g_send_plan, "host") != t.host || Json::str(g_send_plan, "kind") != t.kind)
        return refuse("Je n'ai plus d'emplacements choisis pour cette imprimante : choisis-les à nouveau." + nothing);

    const std::vector<std::string> ignored;
    const SlotsLogic::DecideOptions opts = SlotsLogic::decide_options(t.kind);
    if (!Json::boolean(state, "ok", false))
        return refuse(SlotsLogic::decide_map(Json::arr(g_send_plan, "map"), nlohmann::json(), ignored, opts).refusal);
    if (!Json::boolean(state, "imposable", false))
        return refuse("Je lis cette imprimante, mais je ne peux pas y imposer les emplacements (" + Json::str(state, "blocker", 80) + ")." + nothing + " Envoie par le bouton de Plyo Slicer, sa fenêtre te laisse choisir.");

    Slic3r::GUI::Plater*    plater = wxGetApp().plater();
    Slic3r::GUI::MainFrame* frame  = wxGetApp().mainframe;
    Slic3r::GUI::PartPlate* plate  = plater != nullptr ? plater->get_partplate_list().get_curr_plate() : nullptr;
    if (frame == nullptr || plate == nullptr || !plate->is_slice_result_valid())
        return refuse("La plaque n'est pas découpée ou sa découpe est périmée : découpe-la, puis relance l'envoi." + nothing);
    plater->apply_background_progress(); // comme FirstSteps::start_print
    if (!plate->is_slice_result_valid() || !plate->is_slice_result_ready_for_print() || !frame->get_enable_print_status())
        return refuse("Plyo Slicer n'est pas prêt à envoyer cette plaque : regarde les messages du plateau, découpe à nouveau au besoin, puis relance l'envoi." + nothing);

    // L'envoi part avec le profil édité, pas forcément celui du plan.
    const Slic3r::DynamicPrintConfig& edited_config = bundle().printers.get_edited_preset().config;
    const Target                      edited        = target_of_config(edited_config);
    SlotsLogic::Detection             edited_found;
    edited_found.kind      = edited.kind;
    edited_found.imposable = edited.imposable;
    if (std::string refusal = SlotsLogic::profile_refusal(g_send_plan, edited_found, edited.host, edited.host_type, edited.model); !refusal.empty())
        return refuse(refusal);

    std::vector<int>         cursor_t;
    std::vector<std::string> presets;
    if (!orca_state(cursor_t, presets))
        return refuse("Je n'ai pas pu vérifier la pièce dans Plyo Slicer." + nothing);
    std::vector<int> plan_t;
    for (const nlohmann::json& e : Json::arr(g_send_plan, "map"))
        plan_t.push_back(static_cast<int>(Json::integer(e, "t", -1)));
    if (std::string refusal = SlotsLogic::used_refusal(used_filaments(false), cursor_t, sliced_filaments(), plan_t); !refusal.empty())
        return refuse(refusal);

    const nlohmann::json planned = SlotsLogic::map_for_send(g_send_plan, t.host, cursor_t);
    if (planned.empty())
        return refuse("Les emplacements choisis ne couvrent plus les couleurs de la pièce : choisis-les à nouveau." + nothing);
    const nlohmann::json        canvases = Json::arr(state, "canvases");
    const SlotsLogic::MapDecision decision = SlotsLogic::decide_map(planned, canvases, presets, opts);
    if (!decision.refusal.empty())
        return refuse(decision.refusal);

    const auto* filament_colour = bundle().project_config.option<Slic3r::ConfigOptionStrings>("filament_colour");
    const int   filament_count  = filament_colour != nullptr ? static_cast<int>(filament_colour->values.size()) : 0;
    if (filament_count != static_cast<int>(presets.size()))
        return refuse("Les filaments du projet ne sont pas cohérents dans Plyo Slicer : recharge le projet, puis relance l'envoi." + nothing);

    // Mêmes clés et mêmes défauts que les fenêtres d'Orca (PrintHostDialogs.hpp) ; un test de source vérifie qu'elles existent encore.
    const auto recent = [](const char* key) { return wxGetApp().app_config->get("recent", key); };
    std::string                        refusal;
    std::map<std::string, std::string> info;
    if (t.kind == "cfs") {
        const std::string self_test = recent("crealityprint_enable_self_test");
        info = CfsLogic::color_match_info(decision.map, canvases, filament_count, !self_test.empty() && self_test != "0", refusal);
    } else {
        const std::string leveling = recent("flashforge_leveling_before_print"), timelapse = recent("flashforge_timelapse_video");
        info = IfsLogic::mapping_info(decision.map, canvases, colours(), leveling.empty() || leveling == "1", timelapse == "1", refusal);
    }
    if (!refusal.empty() || info.empty())
        return refuse(refusal.empty() ? "Je n'ai pas pu préparer la répartition." + nothing : refusal);

    BOOST_LOG_TRIVIAL(info) << "Plyo: envoi avec répartition (" << t.kind << ", " << decision.map.size() << " couleur(s)), marque non validée sur machine";
    bool taken = false;
    try {
        Send::Scope scope; // lot 10 : l'envoi pris par Orca est suivi dans sa file (progression, arrivée, échec)
        ArmedSend   armed(std::move(info));
        plater->send_gcode_legacy(PLATE_CURRENT_IDX, nullptr);
        // Rempli par Plyo, puis réellement confié à la file d'Orca (et pas arrêté avant par une erreur d'Orca).
        taken = armed.taken() && scope.handed();
    } catch (const std::exception& e) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: envoi avec répartition en échec : " << e.what();
    }
    if (!taken)
        return refuse("Plyo Slicer n'a pas lancé l'envoi." + nothing + " Regarde ses messages, puis réessaie.");
    return {{"ok", true}, {"text", "J'envoie le fichier : la répartition part avec. Regarde l'écran de ton imprimante."}};
}

} // namespace

void send_planned(const std::string& printer_preset, std::function<void(nlohmann::json)> done)
{
    const Target t = target_of(printer_preset);
    if ((t.kind != "cfs" && t.kind != "ifs") || !t.imposable || !g_send_plan.is_object() || Json::str(g_send_plan, "host") != t.host) {
        done({{"ok", false}, {"text", "Je n'ai pas d'emplacements à imposer pour cette imprimante : rien n'est parti."}});
        return;
    }
    if (g_send_busy) {
        done({{"ok", false}, {"text", "Un envoi est déjà en préparation : attends sa réponse."}});
        return;
    }
    g_send_busy = true;
    std::thread([t, done = std::move(done)]() {
        const nlohmann::json state = read_unit(t);
        Lifetime::post("l'envoi avec emplacements", [t, state, done] {
            g_send_busy = false;
            done(finish_send(t, state));
        });
    }).detach();
}

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
        Lifetime::post("le départ sans carte", [done, out] { done(out); });
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
