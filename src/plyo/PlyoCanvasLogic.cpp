#include "PlyoCanvasLogic.hpp"

#include <cctype>

namespace Plyo { namespace CanvasLogic {

std::string bare_host(const std::string& print_host)
{
    std::string h = print_host;
    if (const size_t scheme = h.find("://"); scheme != std::string::npos)
        h = h.substr(scheme + 3);
    if (const size_t slash = h.find('/'); slash != std::string::npos)
        h.resize(slash);
    if (const size_t colon = h.find(':'); colon != std::string::npos)
        h.resize(colon);
    return h;
}

std::vector<std::string> profile_types(const std::string& type)
{
    size_t b = 0, e = type.size();
    while (b < e && std::isspace(static_cast<unsigned char>(type[b])))
        ++b;
    while (e > b && std::isspace(static_cast<unsigned char>(type[e - 1])))
        --e;
    std::string t;
    for (size_t i = b; i < e; ++i)
        t.push_back(static_cast<char>(std::toupper(static_cast<unsigned char>(type[i]))));
    if (t.empty())
        return {};
    const size_t cut  = t.find_first_of("-+ ");
    const std::string base = cut == std::string::npos ? t : t.substr(0, cut);
    if (base.empty() || base == t)
        return {t};
    return {t, base};
}

}} // namespace Plyo::CanvasLogic
