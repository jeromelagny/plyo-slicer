# Sources Plyo ajoutées à la bibliothèque libslic3r_gui (inclus depuis src/slic3r/CMakeLists.txt,
# après add_library et source_group, car source_group(TREE) n'accepte que des fichiers sous src/slic3r).
set(PLYO_SOURCES
    ${CMAKE_CURRENT_LIST_DIR}/PlyoAssistant.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoAssistant.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoSettingsBridge.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoSettingsBridge.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoSession.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoSession.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoLoginDialog.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoLoginDialog.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoPhoneDialog.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoPhoneDialog.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoMakerWorldWindow.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoMakerWorldWindow.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoMakerWorldImport.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoMakerWorldImport.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCalibration.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCalibration.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoFirstSteps.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoFirstSteps.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoWelcomeDialog.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoWelcomeDialog.hpp
)
target_sources(libslic3r_gui PRIVATE ${PLYO_SOURCES})
source_group(TREE ${CMAKE_CURRENT_LIST_DIR} PREFIX plyo FILES ${PLYO_SOURCES})
