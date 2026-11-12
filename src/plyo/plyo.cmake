# Sources Plyo ajoutées à la bibliothèque libslic3r_gui (inclus depuis src/slic3r/CMakeLists.txt,
# après add_library et source_group, car source_group(TREE) n'accepte que des fichiers sous src/slic3r).
set(PLYO_SOURCES
    ${CMAKE_CURRENT_LIST_DIR}/PlyoAssistant.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoAssistant.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoConfig.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoConfig.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoSettingsBridge.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoSettingsBridge.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoSession.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoSession.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoLoginDialog.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoLoginDialog.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoPhoneDialog.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoPhoneDialog.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCalibration.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCalibration.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCalibrationLogic.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCommands.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCommands.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCommandsLogic.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoFirstSteps.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoFirstSteps.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoWelcomeDialog.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoWelcomeDialog.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoHighlight.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoHighlight.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoModelImport.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoModelImport.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoFiles.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoFiles.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoGuard.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoJson.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoSanitize.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoSanitize.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoStore.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoStore.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoConversations.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoConversations.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoDiscovery.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoDiscovery.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoDiscoveryLogic.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoDiscoveryLogic.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoPrinterStatus.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoPrinterStatus.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoPrinterStatusLogic.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoPrinterStatusLogic.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoProject.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoProject.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoProjectLogic.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoProjectLogic.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoJournal.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoJournal.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoHabits.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoHabits.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCC2.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCC2.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCC2Logic.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCC2Logic.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoSlots.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoSlots.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoSlotsLogic.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoSlotsLogic.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCfs.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCfs.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCfsLogic.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCfsLogic.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoIfs.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoIfs.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoIfsLogic.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoIfsLogic.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoU1.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoU1.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoU1Logic.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoU1Logic.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoSpoolsLogic.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoSpoolsLogic.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoSpools.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoSpools.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoAutoSave.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoAutoSave.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoProjectFiles.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoProjectFiles.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoProjectFilesLogic.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCanvas.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCanvas.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCanvasLogic.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCanvasLogic.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCatalog.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCatalog.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCatalogPolicy.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoCatalogPolicy.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoLimits.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoLimits.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoLimitsLogic.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoProfiles.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoProfiles.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoProfilesLogic.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoMemory.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoMemory.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoPlateActions.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoPlateActions.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoPreflight.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoPreflight.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoPrinterLink.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoPrinterLink.hpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoPrinterSetup.cpp
    ${CMAKE_CURRENT_LIST_DIR}/PlyoPrinterSetup.hpp
)
target_sources(libslic3r_gui PRIVATE ${PLYO_SOURCES})

# Adresse du service Plyo compilée dans l'app (remplaçable au lancement par la variable d'environnement PLYO_API_URL).
set(PLYO_API_URL "https://api.getplyo.app" CACHE STRING "Adresse du service Plyo")
set_source_files_properties(${CMAKE_CURRENT_LIST_DIR}/PlyoConfig.cpp PROPERTIES COMPILE_DEFINITIONS "PLYO_API_URL_DEFAULT=\"${PLYO_API_URL}\"")
source_group(TREE ${CMAKE_CURRENT_LIST_DIR} PREFIX plyo FILES ${PLYO_SOURCES})

# Traductions renommées « Plyo Slicer » (les fichiers .po d'Orca ne sont pas modifiés) : voir rebrand_translations.py.
find_program(PLYO_PYTHON3 NAMES python3)
if (PLYO_PYTHON3)
    add_custom_target(plyo_translations ALL
        COMMAND ${PLYO_PYTHON3} ${CMAKE_CURRENT_LIST_DIR}/rebrand_translations.py
                ${CMAKE_SOURCE_DIR}/localization/i18n ${CMAKE_SOURCE_DIR}/resources/i18n ${CMAKE_BINARY_DIR}/plyo-i18n
        COMMENT "Plyo : traductions renommées Plyo Slicer")
endif ()
