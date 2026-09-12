// El mundo: la ventana 3D de la simulación.
//
// Es la GUI de Gazebo, con nuestra configuración de paneles. NO es un visor
// nuestro y eso es deliberado: escena 3D, árbol del mundo, inspector de
// componentes, control de transformación, luces, estadísticas de física y
// control de reproducción ya existen ahí, hechos y probados. Rehacerlos con
// three.js daría un modelo bonito sin física --- exactamente lo que ya hace
// AdvantageScope y lo que NO se quería.
//
// # Por qué es un binario propio y no `gz sim -g`
//
// El CLI `gz` es un script de Ruby, y Ruby no viene en el entorno de conda de
// Windows. `runGui` está documentado justo para esto: "Used when running
// without gz-tools". De paso nos deja fijar nuestra configuración de paneles
// sin depender de lo que el usuario tenga en ~/.gz/sim/gui.config.
//
// # Cómo encuentra el mundo
//
// No lo carga: se CONECTA. gz-sim separa servidor y GUI, y la GUI descubre por
// gz-transport al servidor que ya está corriendo --- nuestro mars-sim-server.
// Por eso hay que arrancar el servidor primero, y por eso mover el robot desde
// el código del robot se ve aquí sin que esta ventana sepa nada de WPILib.
//
// Uso:
//   mars-sim-gui [ruta/gui.config]

#include <cstdlib>
#include <iostream>
#include <string>

#include <gz/common/Console.hh>
#include <gz/sim/gui/Gui.hh>

int main(int argc, char **argv)
{
  if (const char *v = std::getenv("MARS_VERBOSE"))
    gz::common::Console::SetVerbosity(std::atoi(v));

  // Sin configuración explícita, gz-sim usa la de GZ_HOMEDIR/.gz/sim/gui.config,
  // que es la del usuario y puede tener cualquier cosa. Preferimos la nuestra.
  const std::string config = (argc > 1) ? argv[1] : "gui/mars.config";

  std::cout << "[mars-gui] panel layout: " << config << "\n"
            << "[mars-gui] connecting to the simulation server..." << std::endl;

  // El motor de render se deja en nullptr para que valga el del config
  // (ogre2). Forzarlo aqui impediria caer a ogre en equipos cuyo driver no
  // aguante ogre2, que en un equipo de FRC con laptops prestadas pasa.
  return gz::sim::gui::runGui(argc, argv, config.c_str());
}
