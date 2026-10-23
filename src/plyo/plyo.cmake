# Sources Plyo ajoutées à la bibliothèque libslic3r_gui (inclus depuis src/slic3r/CMakeLists.txt,
# après add_library et source_group, car source_group(TREE) n'accepte que des fichiers sous src/slic3r).
set(PLYO_SOURCES
    ${CMAKE_CURRENT_LIST_DIR}/PlyoAssistant.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoAssistant.hpp
)
target_sources(libslic3r_gui PRIVATE ${PLYO_SOURCES})
source_group(TREE ${CMAKE_CURRENT_LIST_DIR} PREFIX plyo FILES ${PLYO_SOURCES})
