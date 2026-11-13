#include "PlyoConfigRulesLogic.hpp"
#include "PlyoSpoolsLogic.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iomanip>
#include <locale>
#include <optional>
#include <sstream>

namespace Plyo { namespace ConfigRules {

namespace {

constexpr double EPSILON             = 1e-4; // EPSILON d'Orca (libslic3r.h)
constexpr double IRONING_SPACING_MIN = 0.05; // PrintConfig.hpp
constexpr double MIN_VOLUMETRIC      = 0.5;  // check_filament_max_volumetric_speed
constexpr double MAX_XY_COMPENSATION = 2;
constexpr double MAX_ELEPHANT_FOOT   = 1;

const char* const SUFFIX = " Aucune modification appliquée.";

// Première case d'une valeur (« 0.5,0.5 » → « 0.5 »), vide si la clé est absente.
std::string first_of(const Values& state, const std::string& key)
{
    const auto it = state.find(key);
    if (it == state.end())
        return std::string();
    const size_t comma = it->second.find(',');
    return comma == std::string::npos ? it->second : it->second.substr(0, comma);
}

bool has(const Values& state, const std::string& key) { return state.count(key) > 0; }

// Nombre (un « % » final est retiré), absent si illisible ou « nil ».
std::optional<double> number(const Values& state, const std::string& key)
{
    std::string text = first_of(state, key);
    if (!text.empty() && text.back() == '%')
        text.pop_back();
    std::istringstream in(text);
    in.imbue(std::locale::classic());
    double value = 0;
    if (text.empty() || !(in >> value) || !in.eof() || !std::isfinite(value))
        return std::nullopt;
    return value;
}

bool is_on(const Values& state, const std::string& key) { return first_of(state, key) == "1"; }

std::string fr_number(double value)
{
    std::ostringstream out;
    out.imbue(std::locale::classic());
    out << std::setprecision(6) << std::round(value * 1000.) / 1000.;
    std::string s = out.str();
    std::replace(s.begin(), s.end(), '.', ',');
    return s;
}

std::string quoted(const std::string& key, const Title& title) { return "« " + label_of(key, title) + " »"; }

Outcome refuse(const std::string& text) { return {false, "Refusé : " + text + SUFFIX, {}}; }

// Ce que le mode vase exige (ConfigManipulation::update_print_fff_config, réponse « Oui » de sa fenêtre).
struct Need
{
    const char*    key;
    const char*    serialized;
    nlohmann::json value;
};

const std::vector<Need>& spiral_needs()
{
    static const std::vector<Need> needs = {
        {"wall_loops", "1", 1},
        {"top_shell_layers", "0", 0},
        {"sparse_infill_density", "0%", "0%"},
        {"enable_support", "0", false},
        {"enforce_support_layers", "0", 0},
        {"detect_thin_wall", "0", false},
        {"overhang_reverse", "0", false},
        {"timelapse_type", "0", "0"},
        {"enable_wrapping_detection", "0", false},
    };
    return needs;
}

// La valeur exigée est-elle déjà là ? Une clé absente ne compte pas (Orca ne la lirait pas autrement).
bool meets(const Values& state, const Need& need)
{
    if (!has(state, need.key))
        return true;
    // Nombres comparés comme nombres (« 0 » et « 0% » pour le remplissage), le reste comme texte.
    const std::optional<double> now = number(state, need.key), wanted = number(Values{{need.key, need.serialized}}, need.key);
    if (now && wanted)
        return std::abs(*now - *wanted) < 1e-9;
    return first_of(state, need.key) == need.serialized;
}

std::string joined(const std::vector<std::string>& keys, const Title& title)
{
    std::string out;
    for (size_t i = 0; i < keys.size(); ++i)
        out += (i == 0 ? "" : i + 1 == keys.size() ? " et " : ", ") + quoted(keys[i], title);
    return out;
}

// Une passe des règles d'Orca. Rend un refus, ou les compléments (vides si l'état est cohérent).
Outcome one_pass(const Values& state, const std::set<std::string>& requested, bool print_touched, bool filament_touched,
                 bool belt_printer, const Title& title)
{
    Outcome out;
    if (print_touched) {
        if (belt_printer && (number(state, "raft_layers").value_or(0) > 0 || (has(state, "draft_shield") && first_of(state, "draft_shield") != "disabled")))
            return refuse("le radeau et le bouclier contre les courants d'air ne sont pas disponibles sur une imprimante à tapis.");
        if (const auto v = number(state, "layer_height"); v && *v < EPSILON)
            return refuse(quoted("layer_height", title) + " ne peut pas être nulle.");
        if (const auto v = number(state, "initial_layer_print_height"); v && *v < EPSILON)
            return refuse(quoted("initial_layer_print_height", title) + " ne peut pas être nulle.");
        for (const char* key : {"ironing_spacing", "support_ironing_spacing"})
            if (const auto v = number(state, key); v && *v < IRONING_SPACING_MIN)
                return refuse(quoted(key, title) + " doit être d'au moins 0,05 mm, sinon Plyo Slicer le remet à 0,1 mm.");
        for (const char* key : {"xy_hole_compensation", "xy_contour_compensation"})
            if (const auto v = number(state, key); v && std::abs(*v) > MAX_XY_COMPENSATION)
                return refuse(quoted(key, title) + " sert aux petits ajustements de taille (2 mm au plus, dans un sens ou dans l'autre). "
                              "Pour agrandir ou réduire la pièce, utilise plutôt l'échelle.");
        if (const auto v = number(state, "elefant_foot_compensation"); v && *v > MAX_ELEPHANT_FOOT)
            return refuse(quoted("elefant_foot_compensation", title) + " à " + fr_number(*v) +
                          " mm est trop grande (1 mm au plus). Un fort pied d'éléphant vient souvent d'un plateau trop chaud.");

        // Mode vase : Orca exige 1 paroi, aucune couche pleine au-dessus, aucun remplissage, pas de supports…
        if (is_on(state, "spiral_mode")) {
            std::vector<std::string> missing;
            for (const Need& need : spiral_needs())
                if (!meets(state, need))
                    missing.push_back(need.key);
            if (!missing.empty()) {
                const bool conflict = std::any_of(missing.begin(), missing.end(), [&](const std::string& k) { return requested.count(k) > 0; });
                if (requested.count("spiral_mode") && !conflict) {
                    for (const Need& need : spiral_needs())
                        if (std::find(missing.begin(), missing.end(), need.key) != missing.end())
                            out.added.push_back({need.key, "print", need.value, need.serialized, "spiral_mode", "le mode vase l'exige"});
                } else if (requested.count("spiral_mode"))
                    return refuse("le mode vase impose 1 paroi, aucun remplissage, aucune couche pleine au-dessus et pas de supports : il ne va pas avec " +
                                  joined(missing, title) + " demandés dans le même lot.");
                else
                    return refuse("le mode vase est activé et impose 1 paroi, aucun remplissage, aucune couche pleine au-dessus et pas de supports : " +
                                  joined(missing, title) + " ne peut pas changer tant qu'il est actif. Désactive d'abord le mode vase.");
            }
        }

        // Paroi supplémentaire alternée : Orca la refuse avec « Épaisseur verticale de la coque » sur « Tout ».
        if (is_on(state, "alternate_extra_wall") && first_of(state, "ensure_vertical_shell_thickness") == "ensure_all") {
            if (requested.count("alternate_extra_wall") && !requested.count("ensure_vertical_shell_thickness"))
                out.added.push_back({"ensure_vertical_shell_thickness", "print", "ensure_moderate", "ensure_moderate", "alternate_extra_wall",
                                     "la paroi supplémentaire alternée ne marche pas avec le réglage « Tout »"});
            else
                return refuse(quoted("alternate_extra_wall", title) + " ne fonctionne pas quand " + quoted("ensure_vertical_shell_thickness", title) +
                              " est sur « Tout ».");
        }

        // Biseau de couture : sa hauteur de départ reste sous la hauteur de couche (en mm, ou en % de la couche).
        if (has(state, "seam_slope_type") && first_of(state, "seam_slope_type") != "none") {
            const std::optional<double> layer = number(state, "layer_height");
            const std::optional<double> start = number(state, "seam_slope_start_height");
            const bool                  pct   = !first_of(state, "seam_slope_start_height").empty() && first_of(state, "seam_slope_start_height").back() == '%';
            if (layer && start && (pct ? *layer * *start / 100. : *start) >= *layer)
                return refuse(quoted("seam_slope_start_height", title) + " doit rester sous la hauteur de couche (" + fr_number(*layer) +
                              " mm), sinon Plyo Slicer la remet à 0.");
        }

        if (const auto lock = number(state, "infill_lock_depth"), skin = number(state, "skin_infill_depth"); lock && skin && *lock > *skin)
            return refuse(quoted("infill_lock_depth", title) + " doit rester inférieure ou égale à " + quoted("skin_infill_depth", title) + " (" +
                          fr_number(*skin) + " mm), sinon Plyo Slicer la ramène à la moitié.");

        // Peau irrégulière en mode « Extrusion » ou « Combiné » : Orca exige le générateur de parois Arachne.
        if (has(state, "fuzzy_skin_mode") && first_of(state, "fuzzy_skin_mode") != "displacement" && first_of(state, "wall_generator") != "arachne") {
            if (requested.count("fuzzy_skin_mode") && !requested.count("wall_generator"))
                out.added.push_back({"wall_generator", "print", "arachne", "arachne", "fuzzy_skin_mode", "ce mode de peau irrégulière l'exige"});
            else
                return refuse(quoted("fuzzy_skin_mode", title) + " en mode « Extrusion » ou « Combiné » demande le générateur de parois Arachne (" +
                              quoted("wall_generator", title) + ").");
        }
    }
    if (filament_touched) {
        if (const auto v = number(state, "filament_max_volumetric_speed"); v && *v < MIN_VOLUMETRIC)
            return refuse(quoted("filament_max_volumetric_speed", title) + " doit être d'au moins 0,5 mm³/s, sinon Plyo Slicer la remet à 0,5.");
        if (const auto v = number(state, "filament_ironing_spacing"); v && *v < IRONING_SPACING_MIN)
            return refuse(quoted("filament_ironing_spacing", title) + " doit être d'au moins 0,05 mm, sinon Plyo Slicer le remet à 0,1 mm.");
    }
    return out;
}

} // namespace

const std::vector<std::string>& print_keys()
{
    static const std::vector<std::string> keys = {
        "raft_layers", "draft_shield", "layer_height", "initial_layer_print_height", "ironing_spacing", "support_ironing_spacing",
        "xy_hole_compensation", "xy_contour_compensation", "elefant_foot_compensation", "spiral_mode", "wall_loops", "top_shell_layers",
        "sparse_infill_density", "enable_support", "enforce_support_layers", "detect_thin_wall", "overhang_reverse", "timelapse_type",
        "enable_wrapping_detection", "alternate_extra_wall", "ensure_vertical_shell_thickness", "seam_slope_type", "seam_slope_start_height",
        "infill_lock_depth", "skin_infill_depth", "fuzzy_skin_mode", "wall_generator"};
    return keys;
}

const std::vector<std::string>& filament_keys()
{
    static const std::vector<std::string> keys = {"filament_max_volumetric_speed", "filament_ironing_spacing"};
    return keys;
}

Outcome complete(const Values& state, const std::set<std::string>& requested, bool print_touched, bool filament_touched,
                 bool belt_printer, const Title& title)
{
    Outcome out;
    Values  now = state;
    // Un complément peut en déclencher un autre : on repasse jusqu'à un état stable (deux passes suffisent aujourd'hui).
    for (int pass = 0; pass < 4; ++pass) {
        const Outcome step = one_pass(now, requested, print_touched, filament_touched, belt_printer, title);
        if (!step.ok)
            return step;
        if (step.added.empty())
            return out;
        for (const Added& a : step.added) {
            now[a.key] = a.serialized;
            out.added.push_back(a);
        }
    }
    return refuse("ces réglages se contredisent.");
}

Outcome temperature_pairs(const std::vector<PairKeys>& pairs, const std::map<std::string, int>& before,
                          const std::map<std::string, int>& after, const std::set<std::string>& requested, const Title& title)
{
    Outcome out;
    for (const PairKeys& p : pairs) {
        if (!requested.count(p.first) && !requested.count(p.other))
            continue;
        const auto a1 = after.find(p.first), a2 = after.find(p.other);
        if (a1 == after.end() || a2 == after.end() || SpoolsLogic::temperature_pairs_ok({{a1->second, a2->second, p.max_delta}}))
            continue;
        const auto b1 = before.find(p.first), b2 = before.find(p.other);
        const bool was_ok = b1 != before.end() && b2 != before.end() && b1->second > 0 && b2->second > 0 &&
                            SpoolsLogic::temperature_pairs_ok({{b1->second, b2->second, p.max_delta}});
        if (requested.count(p.other) && !requested.count(p.first) && was_ok) {
            const int first = b1->second + (a2->second - b2->second);
            out.added.push_back({p.first, "filament", first, std::to_string(first), p.other, "la première couche suit le changement"});
            continue;
        }
        const std::string gap = "plus de " + std::to_string(p.max_delta) + " °C d'écart entre la première couche et les suivantes : Plyo Slicer refuserait d'enregistrer le profil.";
        if (requested.count(p.first) && !requested.count(p.other))
            return refuse(quoted(p.first, title) + " passerait à " + std::to_string(a1->second) + " °C alors que " + quoted(p.other, title) +
                          " reste à " + std::to_string(a2->second) + " °C, soit " + gap + " Change aussi " + quoted(p.other, title) + ".");
        return refuse(quoted(p.first, title) + " serait à " + std::to_string(a1->second) + " °C et " + quoted(p.other, title) + " à " +
                      std::to_string(a2->second) + " °C, soit " + gap + " Rapproche ces deux valeurs.");
    }
    return out;
}

Verdict verify(const std::map<std::string, Written>& planned, const std::set<std::string>& changed)
{
    Verdict v;
    for (const auto& [key, w] : planned)
        if (w.expected != w.actual)
            v.refused.push_back(key);
    for (const std::string& key : changed)
        if (!planned.count(key))
            v.also.push_back(key);
    return v;
}

std::vector<std::string> retouched(const std::map<std::string, std::string>& after, const std::map<std::string, std::string>& current)
{
    std::vector<std::string> out;
    for (const auto& [key, text] : after) {
        if (text.empty())
            continue;
        const auto it = current.find(key);
        if (it != current.end() && it->second != text)
            out.push_back(key);
    }
    return out;
}

std::vector<std::pair<std::string, std::string>> spiral_leftovers(const Values& current, const Values& reference)
{
    std::vector<std::pair<std::string, std::string>> out;
    for (const Need& need : spiral_needs()) {
        const auto ref = reference.find(need.key);
        if (!has(current, need.key) || ref == reference.end() || !meets(current, need) || meets(reference, need))
            continue;
        out.emplace_back(need.key, ref->second);
    }
    return out;
}

std::vector<std::string> spiral_keys()
{
    std::vector<std::string> out;
    for (const Need& need : spiral_needs())
        out.push_back(need.key);
    return out;
}

std::string label_of(const std::string& key, const Title& title)
{
    if (title) {
        const std::string t = title(key);
        if (!t.empty())
            return t;
    }
    static const std::map<std::string, std::string> FALLBACK = {
        {"timelapse_type", "Mode du timelapse"},
        {"enforce_support_layers", "Couches de supports forcées"},
        {"detect_overhang_wall", "Détection des parois en surplomb"},
    };
    const auto it = FALLBACK.find(key);
    return it == FALLBACK.end() ? key : it->second;
}

}} // namespace Plyo::ConfigRules
