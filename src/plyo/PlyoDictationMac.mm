#include "PlyoDictation.hpp"

#import <AppKit/AppKit.h>

namespace Plyo { namespace Dictation {

namespace {
// Action du menu « Édition › Démarrer Dictée » de macOS. Elle n'est pas dans les en-têtes publics d'AppKit : on la cherche
// par son nom et on vérifie à chaque fois que l'application y répond, pour ne rien appeler qui n'existe pas.
SEL start_action() { return NSSelectorFromString(@"startDictation:"); }
// Délai avant de rendre le curseur au champ : assez long pour que macOS voie que le champ l'a perdu.
const double RESTORE_FOCUS_AFTER_S = 0.4;
} // namespace

bool available() { return NSApp != nil && [NSApp respondsToSelector:start_action()]; }

bool start()
{
    if (!available())
        return false;
    return [NSApp sendAction:start_action() to:NSApp from:nil] == YES;
}

// Mesuré sur macOS 26 (journal de DictationIM, « setting dictation stage ») : l'action « stopDictation: » ne coupe pas la
// dictée, elle la relance, comme un second « startDictation: ». Ce qui l'arrête à coup sûr : la fenêtre n'a plus de champ
// actif. On retire donc le curseur au champ, puis on le lui rend un instant plus tard ; macOS coupe l'écoute environ 2 s
// après, et elle ne repart pas quand le curseur revient.
bool stop()
{
    NSWindow* window = NSApp != nil ? [NSApp keyWindow] : nil;
    if (window == nil)
        return false;
    NSResponder* field = [window firstResponder];
    if (![window makeFirstResponder:nil])
        return false;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(RESTORE_FOCUS_AFTER_S * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        // Seulement si rien d'autre n'a pris le curseur entre-temps (clic de l'utilisateur ailleurs).
        if (field != nil && field != window && [window firstResponder] == window)
            [window makeFirstResponder:field];
    });
    return true;
}

const char* platform() { return "mac"; }

}} // namespace Plyo::Dictation
