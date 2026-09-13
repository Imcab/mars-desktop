# Motor de simulación de MARS: un servidor de Gazebo headless.
#
# Configurar SIEMPRE con el entorno conda activo. conda pone $CONDA_PREFIX en
# CMAKE_PREFIX_PATH, y de ahí salen los find_package de abajo:
#
#   conda activate mars-sim
#   cmake -S sim/engine -B sim/build -G Ninja
#   cmake --build sim/build
#
# En Windows hace falta además el entorno de MSVC (vcvars64.bat), porque los
# paquetes de conda-forge están construidos con MSVC y no con el compilador
# de conda.
cmake_minimum_required(VERSION 3.22)
project(mars_sim_engine VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# Los plugins de systems/ se cargan como librerías dinámicas en tiempo de
# ejecución; sin esto no son relocatables fuera del árbol de compilación.
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# OJO: los paquetes van SIN el número de versión en el nombre. En Jetty los
# configs de CMake se instalan como `gz-sim-config.cmake` y exportan el target
# `gz-sim::gz-sim`. El esquema `gz-sim10` / `gz-sim10::gz-sim10` murió en
# Ionic. La versión se pide como segundo argumento de find_package, que es lo
# que impide que un `conda update` nos mueva a Kilted sin avisar.
find_package(gz-sim 10 REQUIRED)
find_package(gz-transport 15 REQUIRED)
# El componente de GUI se pide aparte: trae la ventana 3D de Gazebo, que es lo
# que usamos como visor del mundo en vez de escribir uno.
find_package(gz-sim 10 REQUIRED COMPONENTS gui)

# --- Servidor ----------------------------------------------------------
# Ejecutable propio en vez del binario `gz sim` porque necesitamos controlar
# el ciclo de vida desde Tauri: arrancar, pausar y matar la simulación como
# sidecar de la app, no como un proceso suelto.
add_executable(mars-sim-server src/mars_sim_server.cc)

target_link_libraries(mars-sim-server
  PRIVATE
    gz-sim::gz-sim
    gz-transport::gz-transport
)

# --- Systems -----------------------------------------------------------
# Los plugins de gz-sim: librerías dinámicas que el servidor carga en tiempo
# de ejecución según lo que declare el <plugin> del mundo.
add_subdirectory(systems)

# --- Visor -------------------------------------------------------------
# La ventana 3D. Se CONECTA al servidor por gz-transport en vez de cargar el
# mundo ella misma, asi que se puede abrir y cerrar sin tocar la fisica.
add_executable(mars-sim-gui src/mars_sim_gui.cc)
target_link_libraries(mars-sim-gui PRIVATE gz-sim::gz-sim-gui)

install(TARGETS mars-sim-server mars-sim-gui RUNTIME DESTINATION bin)
