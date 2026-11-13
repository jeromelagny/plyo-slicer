#!/bin/bash
# Compile et lance les tests C++ de la logique pure de Plyo (sans wxWidgets ni Orca), en quelques secondes.
# Usage : src/plyo/tests/cpp/run.sh   (depuis n'importe où ; dépendances déjà compilées dans deps/build/<arch>)
#         PLYO_DEPS=system src/plyo/tests/cpp/run.sh   (boost installé sur le système, sans compiler les dépendances d'Orca :
#         intégration continue, .github/workflows/plyo_tests.yml)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
ARCH="${ARCH:-$(uname -m)}"
# PLYO_DEPS : préfixe où trouver boost (include/ et lib/) ; « system » : les chemins par défaut du compilateur (paquets du
# système), sans -isystem /usr/include qui casserait les en-têtes de la bibliothèque standard.
DEPS="${PLYO_DEPS:-$ROOT/deps/build/$ARCH/OrcaSlicer_dep/usr/local}"
DEPS_INCLUDE=() DEPS_LIB=()
if [ "$DEPS" != "system" ]; then
    DEPS_INCLUDE=(-isystem "$DEPS/include")
    DEPS_LIB=(-L"$DEPS/lib")
fi
OUT="$ROOT/build/$ARCH/plyo-tests"
mkdir -p "$OUT"

CXX="${CXX:-clang++}"
FLAGS=(-std=c++17 -O1 -Wall -Wextra -Werror -isystem "$ROOT/deps_src" -isystem "$ROOT/tests/catch2/extras" ${DEPS_INCLUDE[@]+"${DEPS_INCLUDE[@]}"})

# Catch2 (≈ 30 s à compiler) n'est compilé qu'une fois.
if [ ! -f "$OUT/catch_amalgamated.o" ]; then
    "$CXX" -std=c++17 -O1 -I"$ROOT/tests/catch2/extras" -c "$ROOT/tests/catch2/extras/catch_amalgamated.cpp" -o "$OUT/catch_amalgamated.o"
fi

"$CXX" "${FLAGS[@]}" \
    "$HERE/test_plyo.cpp" "$ROOT/src/plyo/PlyoFiles.cpp" "$ROOT/src/plyo/PlyoSanitize.cpp" "$ROOT/src/plyo/PlyoMemoryLogic.cpp" "$ROOT/src/plyo/PlyoDiscoveryLogic.cpp" "$ROOT/src/plyo/PlyoCatalogPolicy.cpp" "$ROOT/src/plyo/PlyoProjectLogic.cpp" "$ROOT/src/plyo/PlyoCC2Logic.cpp" "$ROOT/src/plyo/PlyoSlotsLogic.cpp" "$ROOT/src/plyo/PlyoCfsLogic.cpp" "$ROOT/src/plyo/PlyoIfsLogic.cpp" "$ROOT/src/plyo/PlyoU1Logic.cpp" "$ROOT/src/plyo/PlyoCanvasLogic.cpp" "$ROOT/src/plyo/PlyoPrinterStatusLogic.cpp" "$ROOT/src/plyo/PlyoSpoolsLogic.cpp" "$ROOT/src/plyo/PlyoBrandsLogic.cpp" "$ROOT/src/plyo/PlyoOrcaMessagesLogic.cpp" "$ROOT/src/plyo/PlyoConfigRulesLogic.cpp" "$ROOT/src/plyo/PlyoContextLogic.cpp" "$ROOT/src/plyo/PlyoSendLogic.cpp" "$ROOT/src/plyo/PlyoRetouchesLogic.cpp" "$ROOT/src/plyo/PlyoPageLogic.cpp" \
    "$OUT/catch_amalgamated.o" \
    ${DEPS_LIB[@]+"${DEPS_LIB[@]}"} -lboost_filesystem -lboost_nowide \
    -o "$OUT/plyo_tests"

"$OUT/plyo_tests" "$@"
