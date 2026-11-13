#include "PlyoDictation.hpp"

// macOS : voir PlyoDictationMac.mm.
#ifndef __APPLE__

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

namespace Plyo { namespace Dictation {

#ifdef _WIN32

bool available() { return true; }

namespace {
// Windows : la saisie vocale s'ouvre par le raccourci Windows + H ; on l'envoie comme si l'utilisateur l'avait tapé.
bool press_windows_h()
{
    INPUT keys[4] = {};
    for (INPUT& key : keys)
        key.type = INPUT_KEYBOARD;
    keys[0].ki.wVk     = VK_LWIN;
    keys[1].ki.wVk     = 'H';
    keys[2].ki.wVk     = 'H';
    keys[2].ki.dwFlags = KEYEVENTF_KEYUP;
    keys[3].ki.wVk     = VK_LWIN;
    keys[3].ki.dwFlags = KEYEVENTF_KEYUP;
    return SendInput(4, keys, sizeof(INPUT)) == 4;
}
} // namespace

bool start() { return press_windows_h(); }
// Le même raccourci met en pause l'écoute quand la saisie vocale est ouverte.
bool stop() { return press_windows_h(); }

const char* platform() { return "windows"; }

#else

bool available() { return false; }
bool start() { return false; }
bool stop() { return false; }
const char* platform() { return "other"; }

#endif

}} // namespace Plyo::Dictation

#endif // !__APPLE__
