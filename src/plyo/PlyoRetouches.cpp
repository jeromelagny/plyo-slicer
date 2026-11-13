#include "PlyoRetouches.hpp"
#include "PlyoAutoSave.hpp"
#include "PlyoCatalog.hpp"
#include "PlyoConfigRulesLogic.hpp"
#include "PlyoConversations.hpp"
#include "PlyoJson.hpp"
#include "PlyoProfiles.hpp"
#include "PlyoRetouchesLogic.hpp"
#include "PlyoSettingsBridge.hpp"
#include "PlyoSpools.hpp"
#include "PlyoStore.hpp"

#include "libslic3r/Preset.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "slic3r/GUI/GUI_App.hpp"

#include <boost/log/trivial.hpp>

#include <algorithm>
#include <chrono>
#include <string>
#include <utility>
#include <vector>

namespace Plyo { namespace Retouches {

namespace {

using Slic3r::Preset;
using Clock = std::chrono::steady_clock;

std::function<void(const nlohmann::json&)> s_listener;

// UX-31 : retouches gardées dans le profil d'impression, pour « Annuler » (nom du profil écrit, valeurs d'avant).
nlohmann::json s_kept_print;
// UX-32 : dernière retouche du filament gardée dans la bobine (une seule « Annuler » à la fois : la plus récente).
nlohmann::json s_spool_kept;
int            s_spool_token = 0;
// UX-36 : valeurs du filament d'un fichier ouvert, non reprises.
nlohmann::json    s_file;
bool              s_file_given = false;
Clock::time_point s_file_at;
constexpr auto    FILE_NOTE_MAX_AGE = std::chrono::minutes(10);

Slic3r::PresetBundle* bundle() { return Slic3r::GUI::wxGetApp().preset_bundle; }

Slic3r::PresetCollection& collection(bool print) { return print ? bundle()->prints : bundle()->filaments; }

const char* scope_of(bool print) { return print ? "print" : "filament"; }

std::string label_of(const std::string& key)
{
    return ConfigRules::label_of(key, [](const std::string& k) { return Catalog::policy().title(k); });
}

boost::filesystem::path pending_path() { return Store::dir() / "retouches-impression.json"; }

void notify(const nlohmann::json& message)
{
    if (s_listener)
        s_listener(message);
}

// Valeurs enregistrées d'aujourd'hui du préréglage choisi (clés du catalogue de la portée).
RetouchesLogic::Values saved_values(bool print)
{
    RetouchesLogic::Values out;
    const Slic3r::DynamicPrintConfig& config = collection(print).get_selected_preset().config;
    for (const std::string& key : Catalog::policy().keys(scope_of(print)))
        if (config.option(key) != nullptr)
            out[key] = config.opt_serialize(key);
    return out;
}

// Nom de la pièce (ou le titre) d'une conversation, tel que le panneau le montre ; "" si inconnue.
std::string project_name(const std::string& conv)
{
    if (conv.empty() || !Conversations::valid_id(conv))
        return std::string();
    const nlohmann::json  c       = Conversations::load(conv);
    const nlohmann::json* project = Json::field(c, "project");
    const nlohmann::json* part    = project != nullptr ? Json::field(*project, "part") : nullptr;
    const std::string     name    = part != nullptr ? Json::str(*part, "name", 200) : std::string();
    return name.empty() ? Json::str(c, "title", 200) : name;
}

// Un lot du pont écrit puis enregistré dans un profil : il ne doit plus être « annulable » par le menu (le fichier du profil
// a déjà ces valeurs). Annulé au contraire si l'enregistrement échoue : rien ne change.
nlohmann::json write_and_save(bool print, const nlohmann::json& values, const std::string& save_as)
{
    nlohmann::json r = SettingsBridge::restore_values({{scope_of(print), values}});
    if (!Json::boolean(r, "ok", false))
        return r;
    const int id = static_cast<int>(Json::integer(r, "undo_id", 0));
    if (id <= 0 && !collection(print).current_is_dirty() && collection(print).get_selected_preset_name() == save_as)
        return {{"ok", true}, {"count", 0}}; // le profil a déjà ces valeurs : rien à écrire
    if (!print && !AutoSave::temperatures_ok(collection(false).get_edited_preset().config)) {
        if (id > 0)
            SettingsBridge::undo_last(id);
        return {{"ok", false}, {"text", "Plyo Slicer refuserait d'enregistrer ces températures dans ta bobine : rien n'a changé."}};
    }
    const Profiles::SaveOutcome saved = Profiles::save_current_as(print, save_as);
    if (saved != Profiles::SaveOutcome::Ok) {
        if (id > 0 && collection(print).current_is_dirty())
            SettingsBridge::undo_last(id);
        return {{"ok", false}, {"text", "Plyo Slicer n'a pas pu enregistrer le profil « " + save_as + " » : rien n'a changé."}};
    }
    if (id > 0)
        SettingsBridge::discard_entry(id);
    return {{"ok", true}, {"count", values.size()}};
}

// Les seules clés d'une retouche : `values` réduit aux clés listées dans `keys`.
nlohmann::json only(const nlohmann::json& values, const std::vector<std::string>& keys)
{
    nlohmann::json out = nlohmann::json::object();
    for (const std::string& k : keys)
        if (values.contains(k))
            out[k] = values[k];
    return out;
}

std::vector<std::string> keys_of(const nlohmann::json& d)
{
    std::vector<std::string> out;
    if (const nlohmann::json* changes = Json::field(d, "changes"); changes != nullptr && changes->is_array())
        for (const nlohmann::json& c : *changes)
            out.push_back(Json::str(c, "key"));
    return out;
}

} // namespace

nlohmann::json diff(bool print)
{
    nlohmann::json out = {{"preset", ""}, {"changes", nlohmann::json::array()}, {"values", nlohmann::json::object()},
                          {"before", nlohmann::json::object()}};
    if (bundle() == nullptr)
        return out;
    Slic3r::PresetCollection& col = collection(print);
    out["preset"]                 = col.get_selected_preset_name();
    if (!col.current_is_dirty())
        return out;
    const Catalog::Policy&            policy = Catalog::policy();
    const Slic3r::DynamicPrintConfig& edited = col.get_edited_preset().config;
    const Slic3r::DynamicPrintConfig& saved  = col.get_selected_preset().config;
    RetouchesLogic::Values            e;
    for (const std::string& key : policy.keys(scope_of(print)))
        if (edited.option(key) != nullptr)
            e[key] = edited.opt_serialize(key);
    const RetouchesLogic::Values s = saved_values(print);
    for (const std::string& key : RetouchesLogic::manual_keys(s, e, SettingsBridge::written_values(print))) {
        if (out["changes"].size() >= RetouchesLogic::MAX_CHANGES)
            break;
        const std::string kind = policy.kind(scope_of(print), key);
        out["changes"].push_back({{"key", key},
                                  {"label", label_of(key)},
                                  {"before", saved.option(key) != nullptr ? SettingsBridge::typed_value_of(saved, key, kind) : nlohmann::json()},
                                  {"after", SettingsBridge::typed_value_of(edited, key, kind)}});
        out["values"][key] = e[key];
        if (s.count(key))
            out["before"][key] = s.at(key);
    }
    return out;
}

void set_listener(std::function<void(const nlohmann::json&)> listener) { s_listener = std::move(listener); }

// ---------- UX-31 : retouches de l'onglet Impression ----------

void capture_print(const std::string& conv)
{
    if (bundle() == nullptr || !bundle()->prints.current_is_dirty())
        return;
    nlohmann::json d = diff(true);
    if (d["changes"].empty())
        return; // seulement des réglages de Plyo (ceux de la pièce) : ils restent avec le projet, sans question
    d["conv"]    = conv;
    d["project"] = project_name(conv);
    const nlohmann::json pending = RetouchesLogic::sanitize_pending(d);
    if (pending.empty())
        return;
    if (!Store::write(pending_path(), pending))
        BOOST_LOG_TRIVIAL(error) << "Plyo: retouches d'impression non gardées pour la question du panneau (écriture impossible)";
    BOOST_LOG_TRIVIAL(info) << "Plyo: " << pending["changes"].size() << " retouche(s) d'impression du profil « " << Json::str(pending, "preset")
                            << " » laissées avec le projet ; le panneau demandera s'il faut les garder";
}

nlohmann::json print_pending() { return RetouchesLogic::sanitize_pending(Store::read(pending_path())); }

nlohmann::json keep_print()
{
    if (bundle() == nullptr)
        return {{"ok", false}, {"text", "Plyo Slicer n'est pas prêt : réessaie dans un instant."}};
    const nlohmann::json      pending = print_pending();
    Slic3r::PresetCollection& prints  = bundle()->prints;
    const std::string         preset  = Json::str(pending, "preset");
    const std::string         refusal = RetouchesLogic::keep_refusal(pending, prints.get_selected_preset_name(), prints.current_is_dirty());
    if (refusal == "empty")
        return {{"ok", false}, {"gone", true}, {"text", "Ces retouches ne sont plus disponibles : rien n'a changé."}};
    if (refusal == "other_preset")
        return {{"ok", false}, {"text", "Plyo Slicer n'est plus sur ton profil d'impression « " + preset + " » : choisis-le dans l'onglet Impression, puis réessaie."}};
    if (refusal == "dirty")
        return {{"ok", false}, {"text", "Ce projet a déjà des réglages d'impression changés (par toi ou par moi) : je ne les mélange pas avec tes retouches d'avant. Je te reposerai la question au prochain nouveau projet."}};
    std::vector<std::string> existing;
    for (const Preset& p : prints)
        existing.push_back(p.name);
    const bool        own  = prints.get_selected_preset().can_overwrite();
    const std::string name = RetouchesLogic::keep_name(preset, own, existing);
    nlohmann::json    r    = write_and_save(true, pending["values"], name);
    if (!Json::boolean(r, "ok", false))
        return r;
    if (Json::integer(r, "count", 0) == 0) {
        dismiss_print();
        return {{"ok", true}, {"text", "Ton profil d'impression « " + name + " » a déjà ces réglages : rien à changer."}, {"name", name}};
    }
    s_kept_print = {{"name", name}, {"before", pending["before"]}};
    boost::system::error_code ec;
    boost::filesystem::remove(pending_path(), ec);
    BOOST_LOG_TRIVIAL(info) << "Plyo: retouches d'impression gardées dans le profil « " << name << " »";
    const std::string text = own ? "C'est gardé dans ton profil d'impression « " + name + " » : tes prochains projets partent de ces réglages."
                                 : "C'est gardé dans « " + name + " », ta copie du profil de Plyo Slicer « " + preset + " » : tes prochains projets partent de ces réglages.";
    return {{"ok", true}, {"text", text}, {"name", name}};
}

void dismiss_print()
{
    boost::system::error_code ec;
    boost::filesystem::remove(pending_path(), ec);
}

nlohmann::json undo_keep_print()
{
    const std::string name = Json::str(s_kept_print, "name");
    if (bundle() == nullptr || name.empty())
        return {{"ok", false}, {"text", "Il n'y a plus rien à annuler ici."}};
    Slic3r::PresetCollection& prints = bundle()->prints;
    if (prints.get_selected_preset_name() != name)
        return {{"ok", false}, {"text", "Plyo Slicer n'est plus sur ton profil « " + name + " » : choisis-le dans l'onglet Impression, puis réessaie."}};
    if (prints.current_is_dirty())
        return {{"ok", false}, {"text", "Ton profil « " + name + " » a d'autres retouches en cours : remets-les comme avant dans l'onglet Impression, puis réessaie."}};
    nlohmann::json r = write_and_save(true, s_kept_print["before"], name);
    if (!Json::boolean(r, "ok", false))
        return r;
    s_kept_print = nlohmann::json();
    return {{"ok", true}, {"text", "Ton profil « " + name + " » a repris ses réglages d'avant."}};
}

// ---------- UX-32 : retouches du filament gardées dans la bobine ----------

void spool_saved(const nlohmann::json& before)
{
    const std::vector<std::string> keys = keys_of(before);
    if (keys.empty())
        return; // rien de retouché à la main (un lot de Plyo a déjà son « Annuler »)
    const nlohmann::json spool = Spools::current();
    const std::string    name  = Json::str(spool, "name").empty() ? Json::str(before, "preset") : Json::str(spool, "name");
    s_spool_kept = {{"token", ++s_spool_token}, {"preset", Json::str(before, "preset")}, {"spool", name},
                    {"values", only(before["values"], keys)}, {"before", only(before["before"], keys)}};
    notify({{"type", "spool_kept"}, {"token", s_spool_token}, {"spool", name}, {"changes", before["changes"]}});
}

void spool_not_saved(const std::string& reason, const std::string& key)
{
    const nlohmann::json spool = Spools::current();
    notify({{"type", "spool_keep_failed"}, {"reason", reason}, {"key", key}, {"label", key.empty() ? std::string() : label_of(key)},
            {"spool", Json::str(spool, "name")}});
}

nlohmann::json undo_spool(int token)
{
    if (bundle() == nullptr || !s_spool_kept.is_object() || Json::integer(s_spool_kept, "token", 0) != token)
        return {{"ok", false}, {"text", "Une retouche plus récente a été gardée depuis : je ne peux annuler que la dernière."}};
    Slic3r::PresetCollection& filaments = bundle()->filaments;
    const std::string         spool     = Json::str(s_spool_kept, "spool");
    const std::string         preset    = Json::str(s_spool_kept, "preset");
    const std::string         refusal   = RetouchesLogic::spool_undo_refusal(s_spool_kept, filaments.get_selected_preset_name(),
                                                                             filaments.current_is_dirty(), saved_values(false));
    if (refusal == "other_spool")
        return {{"ok", false}, {"text", "Plyo Slicer n'est plus sur ta bobine « " + spool + " » : je ne peux pas l'annuler d'ici."}};
    if (refusal == "dirty")
        return {{"ok", false}, {"text", "Ta bobine a un changement pas encore gardé : attends deux secondes, puis réessaie."}};
    if (refusal == "changed")
        return {{"ok", false}, {"text", "Tu as retouché ta bobine depuis : je ne remets pas l'ancienne valeur par-dessus."}};
    nlohmann::json r = write_and_save(false, s_spool_kept["before"], preset);
    if (!Json::boolean(r, "ok", false))
        return r;
    s_spool_kept = nlohmann::json();
    return {{"ok", true}, {"text", "Ta bobine « " + spool + " » a repris ses réglages d'avant."}};
}

// ---------- UX-36 : valeurs du filament d'un fichier ouvert ----------

void capture_file_filament()
{
    s_file       = nlohmann::json();
    s_file_given = false;
    if (bundle() == nullptr || !bundle()->filaments.current_is_dirty())
        return;
    nlohmann::json d = diff(false);
    if (d["changes"].empty())
        return;
    const nlohmann::json spool = Spools::current();
    d["spool"]                 = Json::str(spool, "name").empty() ? Json::str(d, "preset") : Json::str(spool, "name");
    s_file                     = d;
    s_file_at                  = Clock::now();
}

nlohmann::json file_filament()
{
    if (!s_file.is_object() || s_file_given || Clock::now() - s_file_at > FILE_NOTE_MAX_AGE)
        return nlohmann::json::object();
    s_file_given = true;
    return {{"spool", s_file["spool"]}, {"changes", s_file["changes"]}};
}

nlohmann::json take_file_filament()
{
    if (bundle() == nullptr || !s_file.is_object())
        return {{"ok", false}, {"text", "Les réglages de ton fichier ne sont plus disponibles : rouvre-le pour les reprendre."}};
    if (bundle()->filaments.get_selected_preset_name() != Json::str(s_file, "preset"))
        return {{"ok", false}, {"text", "Plyo Slicer n'est plus sur ta bobine « " + Json::str(s_file, "spool") + " » : je ne reprends pas ces réglages sur une autre."}};
    // Les valeurs d'un fichier viennent d'ailleurs : elles passent par les mêmes contrôles que toute modification de
    // l'assistant (catalogue, bornes d'Orca, plage du fabricant, règles d'Orca), sans confirmation implicite. Une valeur
    // refusée est laissée de côté et nommée ; les autres sont reprises en un lot annulable.
    nlohmann::json changes = nlohmann::json::array();
    for (const nlohmann::json& c : s_file["changes"])
        changes.push_back({{"key", Json::str(c, "key")}, {"label", Json::str(c, "label")}, {"value", c.contains("after") ? c["after"] : nlohmann::json()}});
    const std::string print_name    = bundle()->prints.get_edited_preset().name;
    const std::string filament_name = bundle()->filaments.get_edited_preset().name;
    std::string       skipped;
    size_t            skipped_count = 0;
    nlohmann::json    r;
    while (true) {
        if (changes.empty())
            return {{"ok", false},
                    {"text", "Je ne reprends pas les réglages de ton fichier (" + skipped + ") : leurs valeurs sortent de ce que j'accepte pour ta bobine « " +
                                 Json::str(s_file, "spool") + " ». Ses réglages restent en place."}};
        r = SettingsBridge::apply_catalog_changes(changes, print_name, filament_name);
        if (Json::boolean(r, "ok", false))
            break;
        const std::string bad = Json::str(r, "key");
        const auto        it  = std::find_if(changes.begin(), changes.end(), [&bad](const nlohmann::json& c) { return !bad.empty() && Json::str(c, "key") == bad; });
        if (it == changes.end())
            return r; // refus qui ne tient pas à un réglage précis (fenêtre d'Orca ouverte, règle d'Orca) : dit tel quel
        skipped += std::string(skipped.empty() ? "" : ", ") + Json::str(*it, "label");
        ++skipped_count;
        changes.erase(it);
    }
    const size_t n = changes.size();
    r["text"] = std::string("J'ai repris ") + (n > 1 ? std::to_string(n) + " réglages" : "le réglage") + " de filament de ton fichier. " +
                (n > 1 ? "Ils vont" : "Il va") + " dans ta bobine « " + Json::str(s_file, "spool") + " »." +
                (skipped_count == 0 ? std::string()
                                    : " Je n'ai pas repris " + skipped + " : " + (skipped_count > 1 ? "leurs valeurs sortent" : "sa valeur sort") +
                                          " de ce que j'accepte pour cette bobine.");
    s_file = nlohmann::json();
    return r;
}

}} // namespace Plyo::Retouches
