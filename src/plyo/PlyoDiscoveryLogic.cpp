#include "PlyoDiscoveryLogic.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdio>
#include <map>
#include <utility>

namespace Plyo { namespace Discovery {

namespace {

// Les quatre octets d'une adresse IPv4 écrite « a.b.c.d » ; rien si elle est mal formée.
std::optional<std::array<int, 4>> octets(const std::string& ip)
{
    std::array<int, 4> o{};
    char               tail = 0;
    if (std::sscanf(ip.c_str(), "%d.%d.%d.%d%c", &o[0], &o[1], &o[2], &o[3], &tail) != 4)
        return std::nullopt;
    for (int v : o)
        if (v < 0 || v > 255)
            return std::nullopt;
    return o;
}

std::string lower(std::string s)
{
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return char(std::tolower(c)); });
    return s;
}

std::string text_of(const nlohmann::json& j, const char* key)
{
    return j.is_object() && j.contains(key) && j[key].is_string() ? j[key].get<std::string>() : std::string();
}

} // namespace

bool is_private_ipv4(const std::string& ip)
{
    const auto o = octets(ip);
    if (!o)
        return false;
    return (*o)[0] == 10 || ((*o)[0] == 172 && (*o)[1] >= 16 && (*o)[1] <= 31) || ((*o)[0] == 192 && (*o)[1] == 168);
}

std::vector<std::string> neighbours(const std::string& local_ip)
{
    std::vector<std::string> out;
    const auto               o = octets(local_ip);
    if (!o || !is_private_ipv4(local_ip))
        return out;
    const std::string prefix = std::to_string((*o)[0]) + "." + std::to_string((*o)[1]) + "." + std::to_string((*o)[2]) + ".";
    for (int last = 1; last <= 254; ++last)
        if (last != (*o)[3])
            out.push_back(prefix + std::to_string(last));
    return out;
}

std::string brand_from_name(const std::string& name)
{
    const std::string n = lower(name);
    // Préfixes des noms donnés par les firmwares (Creality OS : « K1C-1A2B », « Ender-3 V3 KE », « Hi-… »).
    static const std::vector<std::pair<std::string, std::string>> PREFIXES = {
        {"k1", "Creality"},      {"k2", "Creality"},    {"ender", "Creality"},   {"cr-", "Creality"}, {"hi-", "Creality"},
        {"creality", "Creality"}, {"sermoon", "Creality"}, {"neptune", "Elegoo"}, {"elegoo", "Elegoo"},
        {"centauri", "Elegoo"},  {"voron", "Voron"},    {"sovol", "Sovol"},      {"qidi", "Qidi"},    {"x-max", "Qidi"},
        {"x-plus", "Qidi"},      {"adventurer", "Flashforge"}, {"anycubic", "Anycubic"}, {"kobra", "Anycubic"},
        {"snapmaker", "Snapmaker"}, {"prusa", "Prusa"}, {"artillery", "Artillery"},
    };
    for (const auto& [prefix, brand] : PREFIXES)
        if (n.rfind(prefix, 0) == 0)
            return brand;
    return std::string();
}

std::optional<Printer> from_moonraker(const std::string& ip, const std::string& body)
{
    const nlohmann::json j = nlohmann::json::parse(body, nullptr, false);
    if (!j.is_object() || !j.contains("result") || !j["result"].is_object())
        return std::nullopt;
    const nlohmann::json& r = j["result"];
    // Une réponse de Klipper porte au moins son état ou sa version : sinon ce n'est pas Moonraker.
    if (!r.contains("state") && !r.contains("software_version"))
        return std::nullopt;
    Printer p;
    p.ip        = ip;
    p.name      = text_of(r, "hostname");
    p.brand     = brand_from_name(p.name);
    if (p.name.empty())
        p.name = "Imprimante Klipper";
    p.host_type = "moonraker";
    p.host      = ip + ":7125";
    p.priority  = 1;
    return p;
}

std::optional<Printer> from_elegoo_sdcp(const std::string& datagram)
{
    const nlohmann::json j = nlohmann::json::parse(datagram, nullptr, false);
    if (!j.is_object() || !j.contains("Data") || !j["Data"].is_object())
        return std::nullopt;
    const nlohmann::json& d  = j["Data"];
    const std::string     ip = text_of(d, "MainboardIP");
    if (!octets(ip))
        return std::nullopt;
    Printer p;
    p.ip        = ip;
    p.name      = text_of(d, "MachineName");
    if (p.name.empty())
        p.name = text_of(d, "Name");
    if (p.name.empty())
        p.name = "Imprimante Elegoo";
    p.brand     = "Elegoo";
    p.host_type = "elegoolink";
    p.host      = ip;
    p.priority  = 2;
    return p;
}

std::vector<Printer> merge(std::vector<Printer> found)
{
    std::map<std::string, Printer> by_ip;
    for (Printer& p : found) {
        if (p.ip.empty())
            continue;
        auto it = by_ip.find(p.ip);
        if (it == by_ip.end() || p.priority > it->second.priority) {
            // La source plus précise garde un nom ou une marque que seule l'autre connaissait.
            if (it != by_ip.end()) {
                if (p.name.empty())
                    p.name = it->second.name;
                if (p.brand.empty())
                    p.brand = it->second.brand;
            }
            by_ip[p.ip] = std::move(p);
        }
    }
    std::vector<Printer> out;
    for (auto& [ip, p] : by_ip)
        out.push_back(std::move(p));
    std::sort(out.begin(), out.end(), [](const Printer& a, const Printer& b) { return lower(a.name) < lower(b.name); });
    return out;
}

nlohmann::json to_json(const std::vector<Printer>& printers)
{
    nlohmann::json out = nlohmann::json::array();
    for (const Printer& p : printers)
        out.push_back({{"ip", p.ip}, {"name", p.name}, {"brand", p.brand}, {"host_type", p.host_type}, {"host", p.host}});
    return out;
}

}} // namespace Plyo::Discovery
