@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"

if /I "%~1"=="api" goto api
if /I "%~1"=="simulator" goto simulator

if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required. Install Node.js LTS and run this file again.
  pause
  exit /b 1
)

if not defined SIMULATOR_TOKEN (
  for /f %%T in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString() + [guid]::NewGuid().ToString()"') do set "SIMULATOR_TOKEN=%%T"
)

if not defined DB_PASSWORD (
  if defined DB_USER (
    echo DB_PASSWORD is required for the configured DB_USER.
    pause
    exit /b 1
  )
  echo Preparing the local least-privilege database account...
  for /f "delims=" %%P in ('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%deployment\setup-local-db.ps1" -EmitPassword') do set "DB_PASSWORD=%%P"
  if not defined DB_PASSWORD goto failed
  set "DB_USER=powergrid_app"
)
if not defined DB_USER set "DB_USER=powergrid_app"

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js LTS with npm and reopen this file.
  pause
  exit /b 1
)

echo Configuring trusted local HTTPS for this Windows account...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%deployment\setup-local-https.ps1"
if errorlevel 1 goto failed

for %%P in (backend frontend simulator) do (
  if not exist "%ROOT%%%P\node_modules" (
    echo Installing %%P dependencies...
    pushd "%ROOT%%%P"
    call npm install
    if errorlevel 1 (
      popd
      goto failed
    )
    popd
  )
)

echo Building telemetry simulator...
pushd "%ROOT%simulator"
call npm run build
if errorlevel 1 (
  popd
  goto failed
)
popd

echo Starting API and demo telemetry in separate windows...
start "PowerGrid API" "%ComSpec%" /k ""%~f0" api"
start "PowerGrid simulator" "%ComSpec%" /k ""%~f0" simulator"

echo Starting website at https://localhost:5173/
pushd "%ROOT%frontend"
call npm run dev -- --host 127.0.0.1 --strictPort --open
set "RESULT=%ERRORLEVEL%"
popd
exit /b %RESULT%

:api
cd /d "%ROOT%backend"
set "DEMO_MODE=true"
set "PORT=3000"
set "API_HOST=127.0.0.1"
if not defined DB_HOST set "DB_HOST=127.0.0.1"
if not defined DB_PORT set "DB_PORT=3306"
if not defined DB_NAME set "DB_NAME=powergrid_monitor"
if not defined DB_PASSWORD (
  echo DB_PASSWORD is required. Create the least-privilege powergrid_app user; see README.md.
  pause
  exit /b 1
)
set "CORS_ORIGIN=https://localhost:5173,https://127.0.0.1:5173"
call npm run start:dev
exit /b %ERRORLEVEL%

:simulator
cd /d "%ROOT%simulator"
set "API_URL=http://127.0.0.1:3000/api/v1/telemetry"
set "INTERVAL_MS=5000"
call npm run start
exit /b %ERRORLEVEL%

:failed
echo Setup failed. Check the message above, then run start-demo.bat again.
pause
exit /b 1