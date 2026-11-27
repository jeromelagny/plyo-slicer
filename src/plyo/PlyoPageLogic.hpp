#pragma once

#include <deque>
#include <functional>
#include <string>
#include <utility>
#include <vector>

// Page du panneau assemblée par load_page() (PlyoAssistant.cpp) : scripts insérés à la place de leurs marqueurs, politique de
// sécurité du contenu (CSP) construite d'après l'adresse réelle du service. Sans dépendance à Orca ni à wx (testé par
// src/plyo/tests/cpp).
namespace Plyo { namespace PageLogic {

// Noms des scripts que la page déclare, dans l'ordre : chaque marqueur « <!--plyo-include:nom.js--> » dont le nom n'a que
// des minuscules, des chiffres et des tirets, suivis de « .js ». Un marqueur au nom différent est ignoré (il reste un
// commentaire HTML, sans effet) : jamais de chemin (« ../ ») ni de fichier hors de resources/web/plyo.
std::vector<std::string> include_names(const std::string& page);

// Page du panneau selon la version choisie (clé « ui » des premiers pas) : « v2/index.html » pour « v2 », sinon la page classique.
std::string page_for_ui(const std::string& ui);

// Origine d'une adresse http(s) (« schéma://hôte[:port] », en minuscules, sans chemin), vide si l'adresse n'en est pas
// une ou porte des caractères qui casseraient la politique (espace, « ; », guillemets…).
std::string origin_of(const std::string& url);

// Vrai pour une page de paiement Stripe que le panneau peut ouvrir dans le navigateur (message « open_payment ») : en
// https, sur checkout.stripe.com (paiement) ou billing.stripe.com (portail de l'abonnement), sans port ni caractère de
// contrôle, et de longueur raisonnable. Toute autre adresse est refusée.
bool is_payment_url(const std::string& url);

// Jeton aléatoire (32 caractères hexadécimaux) pour les balises <script> de la page : seules celles qui le portent
// s'exécutent. Nouveau à chaque assemblage.
std::string new_nonce();

// Politique de sécurité du contenu de la page, d'après ce qu'elle charge réellement :
// - scripts : seulement les balises qui portent `nonce` (la page, ses modules, l'adresse du service, le pilote du banc) ;
//   jamais d'attribut « onclick= » ni d'eval ;
// - styles en ligne (balise <style> de la page et du thème d'Orca, attributs style) ;
// - images : photos et vignettes en data: et blob: (jamais d'image distante) ;
// - connexions (fetch) : l'origine du service (`api_url`) et `extra_connect` (banc d'essai seulement), rien d'autre ;
// - ni cadre, ni objet, ni police, ni formulaire envoyé, ni <base>.
// Une adresse de service illisible ne donne aucune connexion permise (le panneau le dit alors comme un service injoignable).
std::string content_security_policy(const std::string& api_url, const std::string& nonce, const std::vector<std::string>& extra_connect = {});

// Assemble la page : la politique (balise <meta> en tête de <head>), « <!--plyo-config--> » remplacé par `config_script`,
// chaque marqueur de include_names() par le contenu du fichier (`read_script(nom)`), et `driver` (pilote du banc, vide hors
// banc) juste avant </body>. Toutes ces balises <script>, et celle de la page elle-même, portent `nonce`. `driver` est le
// texte du script seul, sans balise.
std::string assemble(std::string page, const std::function<std::string(const std::string&)>& read_script, const std::string& config_script,
                     const std::string& driver, const std::string& csp, const std::string& nonce);

// Nœuds retenus par `match` dans un arbre (fenêtres d'un panneau), jusqu'à `max_depth` niveaux sous `root` (1 = enfants
// directs), en largeur, sans récursion : la vue web du panneau est trouvée même si wx l'enveloppe dans une fenêtre de plus,
// et une hiérarchie anormale ne fait pas boucler. `children(n)` rend les enfants de n (un conteneur itérable).
template<class Node, class Children, class Match>
std::vector<Node> find_bounded(Node root, const Children& children, const Match& match, int max_depth)
{
    std::vector<Node>                found;
    std::deque<std::pair<Node, int>> todo{{root, 0}};
    while (!todo.empty()) {
        auto [node, depth] = todo.front();
        todo.pop_front();
        if (depth >= max_depth)
            continue;
        for (Node child : children(node)) {
            if (match(child))
                found.push_back(child);
            todo.emplace_back(child, depth + 1);
        }
    }
    return found;
}

}} // namespace Plyo::PageLogic
