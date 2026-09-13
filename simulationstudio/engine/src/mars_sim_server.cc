// Servidor de simulación de MARS.
//
// Prueba de vida de la fase 0: levanta un mundo de Gazebo sin interfaz y lo
// deja corriendo. Todavía no habla con nadie; lo único que demuestra es que
// el entorno compila y enlaza contra Gazebo Jetty.
//
// Uso:
//   mars-sim-server [mundo.sdf] [iteraciones | run]
//
// Sin segundo argumento corre indefinido y arranca EN PAUSA, que es el modo
// real: es el bridge quien decide cuándo empieza el partido. Con un número
// corre esos pasos y sale, que es como se verifica que la física avanza. Con
// `run` corre indefinido y sin pausa, que es lo que hace falta para que un
// suscriptor externo tenga algo que leer.

#include <cstdlib>
#include <iostream>
#include <string>

#include <gz/common/Console.hh>
#include <gz/sim/Server.hh>
#include <gz/sim/ServerConfig.hh>

int main(int argc, char **argv)
{
  const std::string worldFile = (argc > 1) ? argv[1] : "worlds/empty.sdf";

  unsigned int iterations = 0;
  bool paused = true;
  if (argc > 2)
  {
    const std::string mode = argv[2];
    if (mode == "run")
    {
      paused = false;  // iterations queda en 0: indefinido
    }
    else
    {
      iterations = static_cast<unsigned int>(std::strtoul(mode.c_str(), nullptr, 10));
      if (iterations == 0)
      {
        std::cerr << "[mars-sim] invalid second argument: " << mode
                  << " (expected an iteration count or 'run')" << std::endl;
        return EXIT_FAILURE;
      }
      paused = false;
    }
  }

  // Por defecto gz-sim solo muestra errores. Con MARS_VERBOSE=4 salen tambien
  // los gzmsg de los systems, que es la unica forma de ver si un plugin se
  // cargo: si el filename del <plugin> esta mal, gz-sim lo ignora en silencio.
  if (const char *v = std::getenv("MARS_VERBOSE"))
    gz::common::Console::SetVerbosity(std::atoi(v));

  gz::sim::ServerConfig config;
  config.SetSdfFile(worldFile);

  // Sin GUI y sin rendering: la visualización es MARS, que recibe el estado
  // del mundo por NT4 y lo dibuja en su Field3D. Este proceso solo resuelve
  // física.
  config.SetHeadlessRendering(true);

  std::cout << "[mars-sim] world: " << worldFile << "\n"
            << "[mars-sim] iterations: "
            << (iterations ? std::to_string(iterations) : "unbounded")
            << (paused ? " (paused)" : " (running)") << std::endl;

  gz::sim::Server server(config);

  if (!server.Run(/*blocking=*/true, iterations, paused))
  {
    std::cerr << "[mars-sim] the server exited with an error" << std::endl;
    return EXIT_FAILURE;
  }

  std::cout << "[mars-sim] done, iterations run: "
            << server.IterationCount().value_or(0) << std::endl;
  return EXIT_SUCCESS;
}
