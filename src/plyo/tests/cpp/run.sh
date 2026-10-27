#!/bin/bash
# Compile et lance les tests C++ de la logique pure de Plyo (sans wxWidgets ni Orca), en quelques secondes.
# Usage : src/plyo/tests/cpp/run.sh   (depuis n'importe où ; dépendances déjà compilées dans deps/build/<arch>)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
ARCH="${ARCH:-$(uname -m)}"
DEPS="$ROOT/deps/build/$ARCH/OrcaSlicer_dep/usr/local"
OUT="$ROOT/build/$ARCH/plyo-tests"
mkdir -p "$OUT"

CXX="${CXX:-clang++}"
FLAGS=(-std=c++17 -O1 -Wall -Wextra -Werror -isystem "$ROOT/deps_src" -isystem "$ROOT/tests/catch2/extras" -isystem "$DEPS/include")

# Catch2 (≈ 30 s à compiler) n'est compilé qu'une fois.
if [ ! -f "$OUT/catch_amalgamated.o" ]; then
    "$CXX" -std=c++17 -O1 -I"$ROOT/tests/catch2/extras" -c "$ROOT/tests/catch2/extras/catch_amalgamated.cpp" -o "$OUT/catch_amalgamated.o"
fi

"$CXX" "${FLAGS[@]}" \
    "$HERE/test_plyo.cpp" "$ROOT/src/plyo/PlyoFiles.cpp" "$ROOT/src/plyo/PlyoSanitize.cpp" "$ROOT/src/plyo/PlyoDiscoveryLogic.cpp" \
    "$OUT/catch_amalgamated.o" \
    -L"$DEPS/lib" -lboost_filesystem -lboost_nowide \
    -o "$OUT/plyo_tests"

"$OUT/plyo_tests" "$@"
