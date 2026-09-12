# Compila el motor de simulacion en Windows.
#
#   .\sim\build.ps1              configura y compila
#   .\sim\build.ps1 -Clean       borra la cache de CMake antes
#   .\sim\build.ps1 -Smoke       compila y corre 500 pasos de fisica
#
# Existe este script porque el build a mano tiene tres trampas:
#
#  1. MSYS2. Si C:\msys64\ucrt64\bin esta en el PATH, CMake elige su g++ (o
#     peor: compila con cl.exe y enlaza con ld.exe, que falla buscando
#     shell32.lib). Aqui se filtra del PATH.
#
#  2. Expansion de %PATH% en cmd. Poner conda en el PATH DESPUES de llamar a
#     vcvars64.bat no funciona: cmd expande %PATH% al parsear la linea
#     completa, antes de que vcvars corra, y el PATH de MSVC se pierde. Hay
#     que armar el PATH primero y llamar a vcvars al final.
#
#  3. Cache envenenada. Si un configure falla a mitad, CMakeCache.txt queda
#     con el compilador equivocado y los siguientes intentos lo reusan. Ante
#     cualquier error raro: -Clean.
param(
  [switch]$Clean,
  [switch]$Smoke
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$sim  = Join-Path $repo "sim"

# --- Localizar el entorno conda ---------------------------------------
# El orden es el mismo que usa la app (sim/app/src/supervisor.rs): primero lo
# que se pide a mano, luego el entorno que este activo, y solo despues los
# sitios por defecto. CONDA_PREFIX no es un lujo: en CI el entorno lo instala
# setup-miniconda en su propia ruta, y sin esa linea este script no encuentra
# nada aunque el entorno este creado y activado.
$candidatos = @()
if ($env:MARS_CONDA_ENV) { $candidatos += $env:MARS_CONDA_ENV }
if ($env:CONDA_PREFIX)   { $candidatos += $env:CONDA_PREFIX }
foreach ($root in @("$env:USERPROFILE\miniforge3", "$env:LOCALAPPDATA\miniforge3",
                    "$env:USERPROFILE\miniconda3", "$env:USERPROFILE\anaconda3")) {
  $candidatos += (Join-Path $root "envs\mars-sim")
}
$condaEnv = $candidatos |
  Where-Object { $_ -and (Test-Path (Join-Path $_ "Library\lib\cmake\gz-sim")) } |
  Select-Object -First 1
if (-not $condaEnv) {
  throw "No se encontro el entorno 'mars-sim'. Crealo con: conda env create -f sim\environment.yml"
}

# --- Localizar MSVC ---------------------------------------------------
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) { throw "No hay Visual Studio instalado (falta vswhere.exe)." }
$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) { $vsPath = & $vswhere -latest -products * -property installationPath }
$vcvars = Join-Path $vsPath "VC\Auxiliary\Build\vcvars64.bat"
if (-not (Test-Path $vcvars)) { throw "Falta el workload de C++ en Visual Studio (no existe $vcvars)." }

if ($Clean) {
  Remove-Item -Recurse -Force (Join-Path $sim "build\CMakeCache.txt"),
                              (Join-Path $sim "build\CMakeFiles") -ErrorAction SilentlyContinue
  Write-Host "cache de CMake borrada" -ForegroundColor Yellow
}

# Trampa 1: fuera MSYS2. Trampa 2: el PATH se arma antes de vcvars.
$cleanPath = ($env:PATH -split ';' | Where-Object { $_ -and $_ -notmatch 'msys64' }) -join ';'
$prefix = "$(Split-Path -Parent $vswhere);$condaEnv\Library\bin;$condaEnv\Scripts;$cleanPath"

$steps = @(
  "cmake -S `"$sim\engine`" -B `"$sim\build`" -G Ninja -DCMAKE_CXX_COMPILER=cl -DCMAKE_PREFIX_PATH=`"$condaEnv\Library`" -DCMAKE_BUILD_TYPE=Release",
  "cmake --build `"$sim\build`""
)
if ($Smoke) { $steps += "cd /d `"$sim`" && build\mars-sim-server.exe worlds\empty.sdf 500" }

$cmd = "set `"PATH=$prefix`" && call `"$vcvars`" >nul && " + ($steps -join " && ")
# PowerShell 5.1 convierte cada linea de stderr de un .exe en un ErrorRecord.
# Gazebo escribe warnings benignos a stderr (por ejemplo el del descriptor de
# gz-msgs), asi que con ErrorActionPreference=Stop el build "fallaria" sin
# haber fallado. Se baja la guardia y se confia solo en el codigo de salida.
$ErrorActionPreference = "Continue"
cmd /c $cmd
$code = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($code -ne 0) { throw "el build fallo con codigo $code" }
Write-Host "`nOK -> $sim\build\mars-sim-server.exe" -ForegroundColor Green
