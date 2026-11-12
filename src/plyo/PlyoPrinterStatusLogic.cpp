#include "PlyoPrinterStatusLogic.hpp"

#include <algorithm>
#include <cctype>
#include <sstream>

namespace Plyo::PrinterStatus {

namespace {

std::string base_name(const std::string& path)
{
    const auto slash = path.find_last_of('/');
    return slash == std::string::npos ? path : path.substr(slash + 1);
}

// Valeur texte ou nombre d'un champ (la Creality envoie « "1" » ou « 1 » selon le champ).
std::string text(const nlohmann::json& j, const char* key)
{
    if (!j.is_object() || !j.contains(key))
        return std::string();
    const nlohmann::json& v = j[key];
    if (v.is_string())
        return v.get<std::string>();
    if (v.is_number_integer())
        return std::to_string(v.get<long long>());
    return std::string();
}

bool clean_dir(const std::string& dir)
{
    return !dir.empty() && dir.front() == '/' && dir.find("..") == std::string::npos && dir.size() < 200;
}

} // namespace

std::string creality_file_dir(const std::string& reply, const std::string& filename)
{
    const nlohmann::json j = nlohmann::json::parse(reply, nullptr, false);
    if (!j.is_object() || !j.contains("retGcodeFileInfo") || !j["retGcodeFileInfo"].is_object())
        return std::string();
    const std::string info = text(j["retGcodeFileInfo"], "fileInfo");
    std::stringstream entries(info);
    std::string       entry;
    while (std::getline(entries, entry, ';')) {
        // « dossier:nom:taille:… » ; le nom peut contenir des espaces mais pas « : ».
        const auto first = entry.find(':');
        if (first == std::string::npos)
            continue;
        const auto second = entry.find(':', first + 1);
        const std::string name = entry.substr(first + 1, second == std::string::npos ? std::string::npos : second - first - 1);
        if (name == filename) {
            const std::string dir = entry.substr(0, first);
            return clean_dir(dir) ? dir : std::string();
        }
    }
    return std::string();
}

const std::map<std::string, std::string>& creality_states()
{
    static const std::map<std::string, std::string> states = {
        {"1", "printing"}, // constaté sur la CR-10 SE pendant une impression
    };
    return states;
}

Status creality_status(const nlohmann::json& fields) { return creality_status(fields, creality_states()); }

Status creality_status(const nlohmann::json& fields, const std::map<std::string, std::string>& states)
{
    Status s{"unknown", "", -1};
    const std::string state = text(fields, "state");
    if (state.empty())
        return s;
    const auto        found   = states.find(state);
    const std::string meaning = found == states.end() ? std::string() : found->second;
    s.state                   = meaning == "printing" || meaning == "paused" || meaning == "error" ? meaning : "idle";
    if (meaning == "finished" || meaning == "cancelled" || meaning == "error")
        s.end = meaning;
    s.file  = base_name(text(fields, "printFileName"));
    const std::string progress = text(fields, "printProgress");
    if (!progress.empty() && progress.find_first_not_of("0123456789") == std::string::npos && progress.size() <= 3)
        s.progress = std::stoi(progress);
    return s;
}

Status moonraker_status(const nlohmann::json& reply)
{
    Status s{"unknown", "", -1};
    if (!reply.is_object() || !reply.contains("result") || !reply["result"].is_object())
        return s;
    const nlohmann::json& r = reply["result"];
    if (!r.contains("status") || !r["status"].is_object() || !r["status"].contains("print_stats") || !r["status"]["print_stats"].is_object())
        return s;
    const nlohmann::json& ps    = r["status"]["print_stats"];
    const std::string     state = text(ps, "state");
    if (state == "printing")
        s.state = "printing";
    else if (state == "paused")
        s.state = "paused";
    else if (state == "error")
        s.state = "error";
    else if (state == "standby" || state == "complete" || state == "cancelled")
        s.state = "idle";
    if (state == "complete")
        s.end = "finished";
    else if (state == "cancelled" || state == "error")
        s.end = state;
    s.file = base_name(text(ps, "filename"));
    return s;
}

std::string creality_status_fields(const nlohmann::json& fields)
{
    if (!fields.is_object())
        return std::string();
    static const char* const wanted[] = {"state", "status", "progress", "err", "printfilename", "job", "pause", "stop", "finish", "complete", "cancel"};
    static const char* const never[]  = {"pass", "pwd", "token", "secret", "key", "auth", "access", "ssid", "time", "temp"};
    std::string              out;
    for (auto it = fields.begin(); it != fields.end(); ++it) {
        std::string name = it.key();
        std::transform(name.begin(), name.end(), name.begin(), [](unsigned char ch) { return char(std::tolower(ch)); });
        const auto has = [&name](const char* part) { return name.find(part) != std::string::npos; };
        if (std::none_of(std::begin(wanted), std::end(wanted), has) || std::any_of(std::begin(never), std::end(never), has))
            continue;
        const nlohmann::json& v = it.value();
        std::string           value;
        if (v.is_string())
            value = v.get<std::string>().size() > 80 ? v.get<std::string>().substr(0, 80) + "…" : v.get<std::string>();
        else if (v.is_number() || v.is_boolean())
            value = v.dump();
        else
            continue; // objets et listes : ni lus ni écrits
        out += (out.empty() ? "" : " ") + it.key() + "=" + value;
    }
    return out;
}

std::string verdict(const Status& before, const Status& now)
{
    if (now.state == "unknown")
        return "unknown";
    if (now.state == "error")
        return "error";
    if (now.state == "printing" || now.state == "paused") {
        const bool same = (before.state == "printing" || before.state == "paused") && before.file == now.file;
        return same ? "busy" : "started";
    }
    return "waiting";
}

std::string end_verdict(const Status& started, const Status& now, int silent_seconds)
{
    if (now.state == "unknown")
        return silent_seconds > LOST_AFTER_SECONDS ? "lost" : "";
    if (now.state == "printing" || now.state == "paused")
        return !now.file.empty() && !started.file.empty() && now.file != started.file ? "unknown_end" : "";
    return now.end.empty() ? "unknown_end" : now.end;
}

} // namespace Plyo::PrinterStatus
