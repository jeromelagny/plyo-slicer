#pragma once

#include <boost/log/trivial.hpp>

#include <exception>

// Une exception qui remonte d'un CallAfter ou d'un callback de vue web ferme Orca (GUI_App::OnExceptionInMainLoop
// relance l'exception). Chaque point d'entrée de Plyo passe donc par guarded() : l'erreur est journalisée, l'application
// continue.
namespace Plyo {

template<class Fn> void guarded(const char* where, Fn&& fn) noexcept
{
    try {
        fn();
    } catch (const std::exception& e) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: erreur dans " << where << " : " << e.what();
    } catch (...) {
        BOOST_LOG_TRIVIAL(error) << "Plyo: erreur inconnue dans " << where;
    }
}

} // namespace Plyo
