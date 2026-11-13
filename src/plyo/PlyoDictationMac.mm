#include "PlyoDictation.hpp"

#import <AppKit/AppKit.h>

namespace Plyo { namespace Dictation {

namespace {
// Action du menu « Édition › Démarrer Dictée » de macOS. Elle n'est pas dans les en-têtes publics d'AppKit : on la cherche
// par son nom et on vérifie à chaque fois que l'application y répond, pour ne rien appeler qui n'existe pas.
SEL start_action() { return NSSelectorFromString(@"startDictation:"); }
SEL stop_action() { return NSSelectorFromString(@"stopDictation:"); }
} // namespace

bool available() { return NSApp != nil && [NSApp respondsToSelector:start_action()]; }

bool start()
{
    if (!available())
        return false;
    return [NSApp sendAction:start_action() to:NSApp from:nil] == YES;
}

bool stop()
{
    if (NSApp == nil || ![NSApp respondsToSelector:stop_action()])
        return false;
    return [NSApp sendAction:stop_action() to:NSApp from:nil] == YES;
}

const char* platform() { return "mac"; }

}} // namespace Plyo::Dictation
