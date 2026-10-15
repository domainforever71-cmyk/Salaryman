@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Building astra.exe

echo ============================================
echo   Building astra.exe
echo ============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo ERROR: Python was not found. Install Python 3.11+ and tick "Add Python to PATH".
  goto :fail
)

rem ---- 0. clean old output (and stop a running astra.exe that would lock the file) ----
taskkill /f /im astra.exe >nul 2>nul
if exist "build" rmdir /s /q "build"
if exist "dist" rmdir /s /q "dist"
if exist "astra.exe" del /f /q "astra.exe"
if exist "astra_selftest.txt" del /f /q "astra_selftest.txt"
if exist "astra.exe" (
  echo ERROR: could not delete the old astra.exe - close it and try again.
  goto :fail
)
for /d /r %%D in (__pycache__) do @if exist "%%D" rmdir /s /q "%%D" >nul 2>nul

rem ---- 1. build tools (only installs what is missing; never touches your pinned versions) ----
python -c "import PyInstaller, cryptography, webview, dotenv, flask, flask_sqlalchemy, requests" >nul 2>nul
if errorlevel 1 (
  echo Installing missing build packages...
  python -m pip install --quiet --upgrade pyinstaller cryptography pywebview python-dotenv flask flask-sqlalchemy requests
  if errorlevel 1 (
    echo ERROR: could not install the build packages. Check your internet connection.
    goto :fail
  )
)

rem ---- 2. bake your Cloudflare/Render address into the exe ----
python build_prepare.py
if errorlevel 1 goto :fail

rem ---- 3. sign the release (key stays outside the project) ----
python sign_release.py init
if errorlevel 1 (
  echo ERROR: could not set up your signing key. See the message above.
  goto :fail
)
python sign_release.py sign
if errorlevel 1 (
  echo ERROR: signing failed. See the message above.
  goto :fail
)

rem ---- 4. build ----
python -m PyInstaller --noconfirm --clean --onefile --windowed ^
  --icon="icon.ico" ^
  --add-data "templates;templates" ^
  --add-data "static;static" ^
  --add-data "astra_manifest.json;." ^
  --add-data "astra_manifest.sig;." ^
  --hidden-import cryptography ^
  --hidden-import astra_pubkey ^
  --hidden-import astra_server ^
  --hidden-import integrity ^
  --name "astra" ^
  gui.py
if errorlevel 1 (
  echo ERROR: PyInstaller failed. See the log above.
  goto :fail
)
if not exist "dist\astra.exe" (
  echo ERROR: build failed - dist\astra.exe was not created.
  goto :fail
)
move /y "dist\astra.exe" ".\astra.exe" >nul
rmdir /s /q "dist"
rmdir /s /q "build"

rem ---- 5. test the exe we just built ----
echo.
echo Testing the new astra.exe (signature, window engine, server)...
echo (If your server was asleep this can take up to a minute.)
start "" /wait "%~dp0astra.exe" --selftest
set "TESTCODE=%errorlevel%"
echo.
if exist "astra_selftest.txt" (type "astra_selftest.txt") else echo (no selftest report was written - the exe could not even start)
echo.

if "%TESTCODE%"=="0" (
  echo SUCCESS: astra.exe is built, signed and passed its self-test.
  echo Note: the server address is baked in - no .env is needed next to astra.exe.
  goto :done
)
if "%TESTCODE%"=="4" (
  echo BUILT, BUT THE SERVER DID NOT ANSWER: the exe is fine, your Cloudflare Worker / Render
  echo backend is not reachable. Open the address above in a browser + add /api/ping.
  echo Check Render is running and BACKEND_URL is set in the Worker settings.
  echo You can still test the exe on its own with:   astra.exe --solo
  goto :done
)
echo FAILED: the new astra.exe did not pass its self-test ^(code %TESTCODE%^). Read the report above.
goto :fail

:done
echo.
echo REMEMBER: commit astra_manifest.json, astra_manifest.sig, astra_pubkey.py and astra_server.py
echo to GitHub after a build so the repo matches the exe. Never commit .env or your private key.
pause
exit /b 0

:fail
echo.
echo Build did not complete.
pause
exit /b 1
