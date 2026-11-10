#include "PlyoPrinterStatusLogic.hpp"

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

Status creality_status(const nlohmann::json& fields)
{
    Status s{"unknown", "", -1};
    const std::string state = text(fields, "state");
    if (state.empty())
        return s;
    s.state = state == "1" ? "printing" : "idle";
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
    s.file = base_name(text(ps, "filename"));
    return s;
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

} // namespace Plyo::PrinterStatus
