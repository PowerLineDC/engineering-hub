cmake_minimum_required(VERSION 3.20)

project(occt_reader LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(OCCT_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../third_party/occt-build/win64/vc14")
set(OCCT_SRC "${CMAKE_CURRENT_SOURCE_DIR}/../../third_party/occt-src/src")
set(OCCT_BIN "${OCCT_ROOT}/bin")
set(OCCT_LIB "${OCCT_ROOT}/lib")

file(GLOB_RECURSE OCCT_INCLUDE_DIRS LIST_DIRECTORIES true "${OCCT_SRC}/*.hxx")
set(OCCT_INCLUDE_PATHS "")
foreach(HEADER ${OCCT_INCLUDE_DIRS})
    get_filename_component(HEADER_DIR "${HEADER}" DIRECTORY)
    list(APPEND OCCT_INCLUDE_PATHS "${HEADER_DIR}")
endforeach()
list(REMOVE_DUPLICATES OCCT_INCLUDE_PATHS)

add_executable(occt-reader main.cpp)
add_executable(occt-xde-reader xde-reader.cpp)

target_include_directories(occt-reader PRIVATE ${OCCT_INCLUDE_PATHS})
target_include_directories(occt-xde-reader PRIVATE ${OCCT_INCLUDE_PATHS})

target_link_libraries(occt-reader PRIVATE
    "${OCCT_LIB}/TKDESTEP.lib"
    "${OCCT_LIB}/TKXSBase.lib"
    "${OCCT_LIB}/TKMesh.lib"
    "${OCCT_LIB}/TKTopAlgo.lib"
    "${OCCT_LIB}/TKGeomAlgo.lib"
    "${OCCT_LIB}/TKGeomBase.lib"
    "${OCCT_LIB}/TKBRep.lib"
    "${OCCT_LIB}/TKG3d.lib"
    "${OCCT_LIB}/TKMath.lib"
    "${OCCT_LIB}/TKernel.lib"
)

target_link_libraries(occt-xde-reader PRIVATE
    "${OCCT_LIB}/TKDESTEP.lib"
    "${OCCT_LIB}/TKDE.lib"
    "${OCCT_LIB}/TKXCAF.lib"
    "${OCCT_LIB}/TKCAF.lib"
    "${OCCT_LIB}/TKLCAF.lib"
    "${OCCT_LIB}/TKXSBase.lib"
    "${OCCT_LIB}/TKMesh.lib"
    "${OCCT_LIB}/TKTopAlgo.lib"
    "${OCCT_LIB}/TKGeomAlgo.lib"
    "${OCCT_LIB}/TKGeomBase.lib"
    "${OCCT_LIB}/TKBRep.lib"
    "${OCCT_LIB}/TKG3d.lib"
    "${OCCT_LIB}/TKMath.lib"
    "${OCCT_LIB}/TKernel.lib"
)

file(GLOB OCCT_RUNTIME_DLLS "${OCCT_BIN}/*.dll")
foreach(OCCT_DLL ${OCCT_RUNTIME_DLLS})
    add_custom_command(TARGET occt-reader POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${OCCT_DLL}"
            "$<TARGET_FILE_DIR:occt-reader>/"
    )
    add_custom_command(TARGET occt-xde-reader POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${OCCT_DLL}"
            "$<TARGET_FILE_DIR:occt-xde-reader>/"
    )
endforeach()
