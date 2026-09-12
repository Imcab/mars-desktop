# Systems de gz-sim: librerías dinámicas que el motor carga en tiempo de
# ejecución, declaradas desde el <plugin> de un mundo.
#
# El nombre del archivo importa: gz-sim busca `MarsLink.dll` (o .so) por el
# atributo filename= del <plugin>, así que la librería NO lleva el prefijo
# `lib` ni sufijo de versión. Por eso PREFIX "".

add_library(MarsLink SHARED MarsLink.cc)

target_link_libraries(MarsLink
  PRIVATE
    gz-sim::gz-sim
    gz-transport::gz-transport
)

set_target_properties(MarsLink PROPERTIES PREFIX "")

# El motor busca los systems junto al ejecutable, para que el binario y sus
# plugins viajen juntos cuando se empaquete como sidecar de Tauri.
set_target_properties(MarsLink PROPERTIES
  LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
)

install(TARGETS MarsLink LIBRARY DESTINATION lib RUNTIME DESTINATION bin)
