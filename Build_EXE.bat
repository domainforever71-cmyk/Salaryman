@echo off
echo Building astra.exe...

if exist "build" rmdir /s /q "build"
if exist "dist" rmdir /s /q "dist"
if exist "astra.exe" del /f /q "astra.exe"

echo Installing signing tools...
python -m pip install --quiet cryptography
if errorlevel 1 (
  echo ERROR: could not install the cryptography package. Check your internet connection.
  pause
  exit /b 1
)

python sign_release.py init
if errorlevel 1 (
  echo ERROR: could not set up your signing key. See the message above.
  pause
  exit /b 1
)

python sign_release.py sign
if errorlevel 1 (
  echo ERROR: signing failed. See the message above.
  pause
  exit /b 1
)

python -m PyInstaller --noconfirm --onefile --windowed ^
  --icon="icon.ico" ^
  --add-data "templates;templates" ^
  --add-data "static;static" ^
  --add-data "astra_manifest.json;." ^
  --add-data "astra_manifest.sig;." ^
  --hidden-import cryptography ^
  --name "astra" ^
  gui.py

if exist "dist\astra.exe" (
    move /y "dist\astra.exe" ".\astra.exe"
    rmdir /s /q "dist"
    rmdir /s /q "build"
    echo.
    echo SUCCESS: astra.exe created in your main folder with custom icon!
) else (
    echo.
    echo ERROR: Build failed. Check terminal log above.
)

pause