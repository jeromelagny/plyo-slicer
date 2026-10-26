#include "PlyoFiles.hpp"

#include <boost/filesystem.hpp>
#include <boost/nowide/cstdio.hpp>

#include <cstdio>
#include <memory>

#ifdef _WIN32
#include <io.h>
#else
#include <unistd.h>
#endif

namespace Plyo { namespace Files {

namespace fs = boost::filesystem;

namespace {

struct Closer
{
    void operator()(FILE* f) const { std::fclose(f); }
};
using FilePtr = std::unique_ptr<FILE, Closer>;

bool read_all(const fs::path& path, unsigned long long size, std::string& out)
{
    FilePtr f(boost::nowide::fopen(path.string().c_str(), "rb"));
    if (!f)
        return false;
    out.resize(static_cast<size_t>(size));
    return size == 0 || std::fread(out.data(), 1, out.size(), f.get()) == out.size();
}

// Renomme un fichier abîmé à côté de lui, sans écraser une copie précédente.
fs::path set_aside(const fs::path& path)
{
    boost::system::error_code ec;
    for (int n = 1; n < 1000; ++n) {
        const fs::path kept = path.string() + ".abime-" + std::to_string(n);
        if (fs::exists(kept, ec))
            continue;
        fs::rename(path, kept, ec);
        return ec ? fs::path() : kept;
    }
    return fs::path();
}

bool sync(FILE* f)
{
#ifdef _WIN32
    return _commit(_fileno(f)) == 0;
#else
    return fsync(fileno(f)) == 0;
#endif
}

} // namespace

Loaded read_json(const fs::path& path, unsigned long long max_bytes)
{
    Loaded                    result;
    boost::system::error_code ec;
    if (!fs::exists(path, ec))
        return result;
    const unsigned long long size = fs::file_size(path, ec);
    std::string              text;
    if (!ec && size <= max_bytes && read_all(path, size, text)) {
        nlohmann::json value = nlohmann::json::parse(text, nullptr, false);
        if (!value.is_discarded()) {
            result.status = Status::Ok;
            result.value  = std::move(value);
            return result;
        }
    }
    result.status  = Status::Damaged;
    result.kept_as = set_aside(path);
    return result;
}

bool write_atomic(const fs::path& path, const std::string& text, bool private_file)
{
    const fs::path            tmp = path.string() + ".tmp";
    boost::system::error_code ec;
    fs::create_directories(path.parent_path(), ec);
    {
        FilePtr f(boost::nowide::fopen(tmp.string().c_str(), "wb"));
        if (!f)
            return false;
        // Mode 600 avant d'écrire : un jeton de session n'est jamais lisible par un autre compte, même un instant.
        if (private_file)
            fs::permissions(tmp, fs::owner_read | fs::owner_write, ec);
        const bool written = std::fwrite(text.data(), 1, text.size(), f.get()) == text.size() && std::fflush(f.get()) == 0 && sync(f.get());
        const bool closed  = std::fclose(f.release()) == 0; // fermé avant toute suppression (Windows refuse un fichier ouvert)
        if (!written || !closed) {
            fs::remove(tmp, ec);
            return false;
        }
    }
    // Disque plein ou écriture tronquée : on ne remplace jamais le bon fichier par un fichier incomplet.
    if (fs::file_size(tmp, ec) != text.size() || ec) {
        fs::remove(tmp, ec);
        return false;
    }
    fs::rename(tmp, path, ec);
    return !ec;
}

}} // namespace Plyo::Files
