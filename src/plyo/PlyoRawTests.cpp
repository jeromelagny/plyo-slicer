#include "PlyoRawTests.hpp"
#include "PlyoAssistant.hpp"
#include "PlyoAutoSave.hpp"
#include "PlyoCalibration.hpp"
#include "PlyoGuard.hpp"
#include "PlyoProjectFiles.hpp"

#include "libslic3r/Model.hpp"
#include "libslic3r/PrintConfig.hpp"
#include "slic3r/GUI/GUI_App.hpp"
#include "slic3r/GUI/GUI_Factories.hpp"
#include "slic3r/GUI/Jobs/Job.hpp"
#include "slic3r/GUI/Jobs/Worker.hpp"
#include "slic3r/GUI/MainFrame.hpp"
#include "slic3r/GUI/PartPlate.hpp"
#include "slic3r/GUI/Plater.hpp"

#include <boost/log/trivial.hpp>

#include <cstring>
#include <string>
#include <utility>
#include <vector>

namespace Plyo { namespace RawTests {

using Slic3r::GUI::wxGetApp;

namespace {

bool known(const std::string& target) { return target == "max_flow" || target == "vfa" || target == "tolerance"; }

// Vue 3D de l'onglet « Préparer » (comme le fait Orca avant ses calibrations : ses menus ne s'ouvrent que depuis elle).
void ensure_3d_view(Slic3r::GUI::Plater& plater)
{
    if (!plater.is_view3D_shown()) {
        plater.select_view_3D("3D");
        if (Slic3r::GUI::MainFrame* frame = wxGetApp().mainframe)
            frame->select_tab(TAB_ID_PREPARE);
    }
}

// Pièces ajoutées au plateau par le modèle « Test de tolérance Orca » (clé stable de la table d'Orca, jamais son libellé).
size_t add_tolerance_piece(Slic3r::GUI::Plater& plater)
{
    const auto&  models = Slic3r::GUI::MenuFactory::handy_models();
    const size_t before = plater.model().objects.size();
    for (size_t i = 0; i < models.size(); ++i)
        if (std::strcmp(models[i].key, "orca_tolerance_test") == 0) {
            Slic3r::GUI::MenuFactory::load_handy_model(i);
            break;
        }
    const size_t after = plater.model().objects.size();
    return after > before ? after - before : 0;
}

} // namespace

nlohmann::json show_preview()
{
    Slic3r::GUI::Plater*    plater = wxGetApp().plater();
    Slic3r::GUI::MainFrame* frame  = wxGetApp().mainframe;
    if (plater == nullptr || frame == nullptr)
        return {{"ok", false}, {"text", "L'aperçu n'est pas disponible pour l'instant."}};
    frame->select_tab(TAB_ID_PREVIEW);
    const Slic3r::GUI::PartPlate* plate = plater->get_partplate_list().get_curr_plate();
    return {{"ok", true}, {"sliced", plate != nullptr && plate->is_slice_result_valid()}};
}

nlohmann::json refusal(const std::string& target)
{
    const auto refused = [](const char* text) { return nlohmann::json{{"ok", false}, {"text", text}}; };
    if (!known(target))
        return refused("Je ne connais pas ce test.");
    Slic3r::GUI::Plater* plater = wxGetApp().plater();
    if (plater == nullptr || wxGetApp().mainframe == nullptr || plater->printer_technology() != Slic3r::ptFFF)
        return refused("Ce test n'est pas disponible pour cette imprimante.");
    if (plater->is_background_process_slicing())
        return refused("Orca découpe en ce moment : attends la fin de la découpe, puis réessaie.");
    if (AutoSave::sending())
        return refused("Orca envoie ou exporte un fichier en ce moment : attends la fin, puis réessaie.");
    if (Calibration::active() || AutoSave::calibrating())
        return refused("Un test de calibration est déjà sur le plateau : termine-le (ou remets ta pièce) avant d'en lancer un autre.");
    if (AutoSave::modal_open())
        return refused("Orca attend ta réponse dans une fenêtre ouverte : réponds-y d'abord, puis réessaie.");
    if (!plater->get_ui_job_worker().is_idle())
        return refused("Orca est déjà occupé sur le plateau. Réessaie dans un instant.");
    if (ProjectFiles::edits_blocked() || ProjectFiles::opening())
        return refused(ProjectFiles::busy_text());
    return nullptr;
}

void open(const std::string& target, std::function<void(nlohmann::json)> reply)
{
    // La fenêtre d'Orca est modale : elle ne s'ouvre jamais pendant le traitement du message du panneau.
    wxGetApp().CallAfter([target, reply = std::move(reply)]() {
        bool replied = false;
        const auto answer = [&](const nlohmann::json& out) { replied = true; reply(out); };
        guarded("un test d'Orca", [&] {
            nlohmann::json out{{"ok", false}, {"target", target}, {"replaced", false}, {"added", 0}};
            // Rien n'a pu changer depuis la demande ? On revérifie juste avant de lancer.
            if (const nlohmann::json no = refusal(target); !no.is_null()) {
                out["text"] = no["text"];
                answer(out);
                return;
            }
            Slic3r::GUI::Plater&    plater = *wxGetApp().plater();
            Slic3r::GUI::MainFrame& frame  = *wxGetApp().mainframe;
            ensure_3d_view(plater);
            if (target == "tolerance") {
                const bool   others = !plater.model().objects.empty();
                const size_t added  = add_tolerance_piece(plater);
                out["ok"]           = added > 0;
                out["added"]        = added;
                // Orca pose la pièce au centre, par-dessus celle de l'utilisateur : la plaque en cours est organisée (comme le
                // fait Orca pour ses autres modèles pratiques), en une étape annulable.
                if (added > 0 && others) {
                    plater.set_prepare_state(Slic3r::GUI::Job::PREPARE_STATE_MENU);
                    plater.arrange();
                    out["arranged"] = true;
                }
                if (added == 0)
                    out["text"] = "Je n'ai pas pu poser la pièce du test de tolérance sur le plateau.";
                BOOST_LOG_TRIVIAL(info) << "Plyo: test de tolérance d'Orca ajouté au plateau (" << added << " pièce(s))";
                answer(out);
                return;
            }
            // Le test remplace le projet : celui de la conversation est d'abord écrit dans son 3MF. Sinon (écriture
            // impossible), rien n'est lancé. Un fichier de l'utilisateur garde la question d'Orca « enregistrer ? ».
            if (!ProjectFiles::attached().empty() && !ProjectFiles::keeps_project()) {
                out["text"] = "Ta pièce n'a pas pu être mise de côté : je ne lance pas le test. Réessaie dans un instant.";
                answer(out);
                return;
            }
            const int before = project_change_count();
            frame.run_calibration(target == "vfa" ? Slic3r::GUI::CalibKind::VFA : Slic3r::GUI::CalibKind::MaxVolumetric);
            out["ok"]       = true;
            out["replaced"] = project_change_count() != before; // fenêtre validée : Orca a ouvert le projet du test
            BOOST_LOG_TRIVIAL(info) << "Plyo: test d'Orca « " << target << " » " << (out["replaced"].get<bool>() ? "lancé" : "fenêtre fermée sans test");
            answer(out);
        });
        // Erreur inattendue (journalisée par guarded) : le panneau n'attend pas une réponse qui ne viendrait jamais.
        if (!replied)
            reply({{"ok", false}, {"target", target}, {"replaced", false}, {"added", 0},
                   {"text", "Quelque chose s'est mal passé de mon côté en ouvrant ce test. Tu le trouves aussi dans le menu « Calibration » d'Orca."}});
    });
}

}} // namespace Plyo::RawTests
