# Verificacion end-to-end de la simulacion.
#
#   .\sim\verify.ps1
#
# Corre las capas en orden de costo creciente: el contrato (instantaneo), la
# compilacion del motor y del bridge, y el lazo real con fisica de verdad.
# Apto para CI.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$sim = Join-Path $repo "sim"

$condaEnv = $null
foreach ($root in @("$env:USERPROFILE\miniforge3", "$env:LOCALAPPDATA\miniforge3")) {
  $c = Join-Path $root "envs\mars-sim"
  if (Test-Path (Join-Path $c "Library\lib\cmake\gz-sim")) { $condaEnv = $c; break }
}
if (-not $condaEnv) { throw "falta el entorno 'mars-sim' (conda env create -f sim\environment.yml)" }

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }

# --- 1. El contrato ---------------------------------------------------
Step 1 "contrato del protocolo"
$ErrorActionPreference = "Continue"
& "$condaEnv\python.exe" "$sim\protocol\check.py"
if ($LASTEXITCODE -ne 0) { throw "el contrato es inconsistente" }

# --- 2. El motor ------------------------------------------------------
Step 2 "compilando el motor y sus systems"
& "$sim\build.ps1"
foreach ($f in @("mars-sim-server.exe", "MarsLink.dll")) {
  if (-not (Test-Path "$sim\build\$f")) { throw "no se genero $f" }
}

# --- 3. El bridge -----------------------------------------------------
Step 3 "compilando el bridge"
# gz-transport-sys encuentra las libs de C++ por pkg-config.
$env:PKG_CONFIG_PATH = "$condaEnv\Library\lib\pkgconfig"
$env:PATH = "$condaEnv\Library\bin;" + (($env:PATH -split ';' | Where-Object { $_ -and $_ -notmatch 'msys64' }) -join ';')
Push-Location "$sim\bridge"
try {
  cargo build --quiet --bins
  if ($LASTEXITCODE -ne 0) { throw "cargo build fallo" }
  # Cubren el transform de coordenadas y los layouts de struct, que son puros
  # y no necesitan ni motor ni red.
  cargo test --quiet --lib
  if ($LASTEXITCODE -ne 0) { throw "los tests del bridge fallaron" }
} finally { Pop-Location }

# --- 4. El lazo -------------------------------------------------------
Step 4 "lazo completo: comandos -> fisica -> telemetria"
# gz-sim busca los systems propios aqui.
$env:GZ_SIM_SYSTEM_PLUGIN_PATH = "$sim\build"
$srv = Start-Process -FilePath "$sim\build\mars-sim-server.exe" `
  -ArgumentList "worlds\testbot.sdf","run" -WorkingDirectory $sim -PassThru `
  -RedirectStandardOutput "$sim\build\srv.log" -RedirectStandardError "$sim\build\srv.err"
# Leer .Handle no es decorativo: Start-Process -PassThru no cachea el handle
# del proceso, y sin handle cacheado ExitCode queda inaccesible para siempre.
$null = $srv.Handle
Start-Sleep -Seconds 1

$log = "$sim\build\drive.log"
$drv = Start-Process -FilePath "$sim\bridge\target\debug\drive-test.exe" `
  -WorkingDirectory "$sim\bridge" -PassThru `
  -RedirectStandardOutput $log -RedirectStandardError "$sim\build\drive.err"
$null = $drv.Handle

$exited = $drv.WaitForExit(90000)
# WaitForExit con timeout devuelve true pero deja ExitCode sin poblar.
if ($exited) { $drv.WaitForExit() }
$code = if ($exited) { $drv.ExitCode } else { -1 }
Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue
if (-not $exited) { Stop-Process -Id $drv.Id -Force -ErrorAction SilentlyContinue }
# Esperar de verdad a que muera: Stop-Process no bloquea, y un motor del paso 4
# que siga vivo publicaria en los mismos topicos que el del paso 5. Dos
# publicadores en /mars/state/pose no dan error, dan poses que se pisan.
$srv.WaitForExit(10000) | Out-Null

Get-Content $log -Encoding UTF8 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" }
if ($code -ne 0) {
  Get-Content "$sim\build\drive.err" -Encoding UTF8 -ErrorAction SilentlyContinue |
    Where-Object { $_ -notmatch "DynamicFactory" } |
    ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
  throw "el lazo fallo (drive-test exit $code)"
}

# --- 5. NT4 -----------------------------------------------------------
Step 5 "bridge -> NT4, contra el ntcore de WPILib"
# nt-probe hace de SERVIDOR NT4, que es el papel que en simulacion ocupa el
# codigo del robot. Usa la implementacion de referencia a proposito: un test
# escrito por nosotros podria compartir el mismo malentendido del formato de
# cable que el bridge, ntcore no.
& "$condaEnv\python.exe" -c "import ntcore" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "    omitido: falta pyntcore (pip install pyntcore)" -ForegroundColor Yellow
} else {
  $ntLog = "$sim\build\nt.log"
  $ntProbe = Start-Process -FilePath "$condaEnv\python.exe" `
    -ArgumentList "$sim\bridge\nt-probe.py","16","0.5" -WorkingDirectory $sim -PassThru `
    -RedirectStandardOutput $ntLog -RedirectStandardError "$sim\build\nt.err"
  $null = $ntProbe.Handle
  Start-Sleep -Seconds 2

  $srv2 = Start-Process -FilePath "$sim\build\mars-sim-server.exe" `
    -ArgumentList "worlds\testbot.sdf","run" -WorkingDirectory $sim -PassThru `
    -RedirectStandardOutput "$sim\build\srv2.log" -RedirectStandardError "$sim\build\srv2.err"
  $null = $srv2.Handle
  Start-Sleep -Seconds 1

  $bridge = Start-Process -FilePath "$sim\bridge\target\debug\mars-bridge.exe" `
    -ArgumentList "--robot-map","models\testbot\robot-map.json" -WorkingDirectory $sim -PassThru `
    -RedirectStandardOutput "$sim\build\br.log" -RedirectStandardError "$sim\build\br.err"
  $null = $bridge.Handle

  # Conducir en paralelo: una pose estatica no distingue "el bridge funciona"
  # de "el bridge publico una vez y se quedo pegado".
  Start-Sleep -Seconds 2
  $drv2 = Start-Process -FilePath "$sim\bridge\target\debug\drive-test.exe" `
    -WorkingDirectory "$sim\bridge" -PassThru `
    -RedirectStandardOutput "$sim\build\drive2.log" -RedirectStandardError "$sim\build\drive2.err"
  $null = $drv2.Handle

  $ntOk = $ntProbe.WaitForExit(60000)
  if ($ntOk) { $ntProbe.WaitForExit() }
  $ntCode = if ($ntOk) { $ntProbe.ExitCode } else { -1 }
  foreach ($p in @($drv2, $bridge, $srv2, $ntProbe)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }

  Get-Content $ntLog -Encoding UTF8 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" }
  Write-Host "    (probe: salio=$ntOk codigo=$ntCode)" -ForegroundColor DarkGray
  if ($ntCode -ne 0) {
    Get-Content "$sim\build\nt.err" -Encoding UTF8 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Get-Content "$sim\build\br.err" -Encoding UTF8 -ErrorAction SilentlyContinue |
      Where-Object { $_ -notmatch "DynamicFactory" } | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    throw "el bridge fallo contra NT4 (probe exit $ntCode)"
  }
}


# --- 6. El glue del perfil vendor -------------------------------------
Step 6 "lazo de hardware: codigo del robot <-> motor"
# fake-robot hace de codigo del robot: levanta el servidor NT4, publica el duty
# que el vendor aplicaria a cada motor y lee de vuelta lo que devuelve la
# fisica. Es el unico test que cierra el circulo entero; las partes por
# separado ya pasaron en los pasos anteriores.
$robLog = "$sim\build\rob.log"
$rob = Start-Process -FilePath "$condaEnv\python.exe" `
  -ArgumentList "$sim\bridge\fake-robot.py","$sim\models\testbot\robot-map.json","5" `
  -WorkingDirectory $sim -PassThru `
  -RedirectStandardOutput $robLog -RedirectStandardError "$sim\build\rob.err"
$null = $rob.Handle
Start-Sleep -Seconds 2

$srv3 = Start-Process -FilePath "$sim\build\mars-sim-server.exe" `
  -ArgumentList "worlds\testbot.sdf","run" -WorkingDirectory $sim -PassThru `
  -RedirectStandardOutput "$sim\build\srv3.log" -RedirectStandardError "$sim\build\srv3.err"
$null = $srv3.Handle
Start-Sleep -Seconds 1

$br2 = Start-Process -FilePath "$sim\bridge\target\debug\mars-bridge.exe" `
  -ArgumentList "--robot-map","models\testbot\robot-map.json" -WorkingDirectory $sim -PassThru `
  -RedirectStandardOutput "$sim\build\br2.log" -RedirectStandardError "$sim\build\br2.err"
$null = $br2.Handle

$robOk = $rob.WaitForExit(90000)
if ($robOk) { $rob.WaitForExit() }
$robCode = if ($robOk) { $rob.ExitCode } else { -1 }
foreach ($p in @($br2, $srv3, $rob)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }

Get-Content $robLog -Encoding UTF8 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" }
if ($robCode -ne 0) {
  Get-Content "$sim\build\rob.err" -Encoding UTF8 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
  throw "el lazo de hardware fallo (fake-robot exit $robCode)"
}


# --- 7. El swerve con control de posicion -----------------------------
Step 7 "swerve: el motor cierra el lazo de posicion"
# El paso 6 prueba el modo duty en un robot de 4 tracciones. Este prueba el
# modo posicion, que es lo que un motor CAN hace de verdad: el codigo del robot
# manda un angulo y el motor lo persigue a la tasa de la fisica. Sin esto las
# direcciones de un swerve no se sujetan --- 90 N*m sobre 0.008 kg*m2 no los
# gobierna ningun lazo sobre la red.
$robLog2 = "$sim\build\rob2.log"
$rob2 = Start-Process -FilePath "$condaEnv\python.exe" `
  -ArgumentList "$sim\bridge\fake-robot.py","$sim\models\swerve\robot-map.json","4" `
  -WorkingDirectory $sim -PassThru `
  -RedirectStandardOutput $robLog2 -RedirectStandardError "$sim\build\rob2.err"
$null = $rob2.Handle
Start-Sleep -Seconds 2

$srv4 = Start-Process -FilePath "$sim\build\mars-sim-server.exe" `
  -ArgumentList "worlds\swerve.sdf","run" -WorkingDirectory $sim -PassThru `
  -RedirectStandardOutput "$sim\build\srv4.log" -RedirectStandardError "$sim\build\srv4.err"
$null = $srv4.Handle
Start-Sleep -Seconds 1

$br3 = Start-Process -FilePath "$sim\bridge\target\debug\mars-bridge.exe" `
  -ArgumentList "--robot-map","models\swerve\robot-map.json" -WorkingDirectory $sim -PassThru `
  -RedirectStandardOutput "$sim\build\br3.log" -RedirectStandardError "$sim\build\br3.err"
$null = $br3.Handle

$rob2Ok = $rob2.WaitForExit(90000)
if ($rob2Ok) { $rob2.WaitForExit() }
$rob2Code = if ($rob2Ok) { $rob2.ExitCode } else { -1 }
foreach ($p in @($br3, $srv4, $rob2)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }

Get-Content $robLog2 -Encoding UTF8 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" }
if ($rob2Code -ne 0) {
  Get-Content "$sim\build\rob2.err" -Encoding UTF8 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
  throw "el swerve fallo (fake-robot exit $rob2Code)"
}


# --- 8. Simulation Studio: el supervisor y el launcher ----------------
Step 8 "Simulation Studio: arranca la simulacion y la para limpio"
# El Studio es la aplicacion APARTE que gobierna la simulacion; mars-desktop
# solo tiene un boton que la abre. Aqui se prueba su supervisor en modo
# headless: que encuentre sim/ y el entorno conda, que levante motor y bridge
# con el entorno correcto, que se mantengan en pie sin codigo de robot, y que
# al parar no quede nada vivo. Lo ultimo importa mas de lo que parece: un motor
# huerfano publica en los mismos topicos que el siguiente y las poses se pisan.
Push-Location "$sim\app"
try {
  cargo build --quiet
  if ($LASTEXITCODE -ne 0) { throw "no compila MARS Sim" }
} finally { Pop-Location }

& "$sim\app\target\debug\mars-sim-app.exe" --headless 6 2>&1 |
  Where-Object { $_ -notmatch "DynamicFactory" } | ForEach-Object { Write-Host "    $_" }
$appCode = $LASTEXITCODE
if ($appCode -ne 0) { throw "MARS Sim fallo (exit $appCode)" }

# Y que mars-desktop sepa encontrarla: el boton del Sidebar depende de eso.
Push-Location "$repo\src-tauri"
try {
  cargo test --quiet --bin mars-desktop simlauncher
  if ($LASTEXITCODE -ne 0) { throw "el launcher de mars-desktop no encuentra MARS Sim" }
} finally { Pop-Location }
  Write-Host "    launcher de mars-desktop: encuentra MARS Sim" -ForegroundColor DarkGray

Write-Host "`nTODO OK: 8 capas, del contrato a la app de simulacion." -ForegroundColor Green
