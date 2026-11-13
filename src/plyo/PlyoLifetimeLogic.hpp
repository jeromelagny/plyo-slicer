#pragma once

#include <atomic>
#include <functional>
#include <utility>

// Durée de vie : ce qui protège l'application d'un rappel tardif ou d'une sortie par exception. Sans dépendance à Orca ni à
// wx (testé par src/plyo/tests/cpp) ; la partie qui touche à l'application est dans PlyoLifetime.cpp.
namespace Plyo { namespace LifetimeLogic {

// Drapeau « on ferme » commun aux fils de Plyo (recherche d'imprimantes, tests de liaison, lectures d'emplacements…). Une
// fois fermée, la porte ne transmet plus rien : un fil qui finit après la fermeture d'Orca ne rappelle jamais l'application.
// Le rappel transmis revérifie la porte au moment de s'exécuter (la fermeture a pu arriver entre-temps).
class ClosingGate
{
public:
    void close() { m_closing.store(true, std::memory_order_release); }
    bool closing() const { return m_closing.load(std::memory_order_acquire); }

    // Transmet `fn` à `post` (la file du fil principal), sauf si la porte est fermée. Faux si rien n'a été transmis.
    template<class Post> bool post(Post&& poster, std::function<void()> fn) const
    {
        if (closing())
            return false;
        poster([this, fn = std::move(fn)] {
            if (!closing())
                fn();
        });
        return true;
    }

private:
    std::atomic<bool> m_closing{false};
};

// Remet `flag` à faux en sortant du bloc, exception comprise : une fenêtre « une seule à la fois » (connexion, téléphone)
// peut toujours se rouvrir après un échec.
class FlagReset
{
public:
    explicit FlagReset(bool& flag) : m_flag(flag) { m_flag = true; }
    ~FlagReset() { m_flag = false; }
    FlagReset(const FlagReset&)            = delete;
    FlagReset& operator=(const FlagReset&) = delete;

private:
    bool& m_flag;
};

}} // namespace Plyo::LifetimeLogic
