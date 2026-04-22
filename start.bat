@echo off
setlocal enabledelayedexpansion
REM
REM Montage Video — Windows Docker Launcher
REM Double-cliquer ce fichier pour demarrer.
REM

cd /d "%~dp0"

echo.
echo ==================================
echo    MONTAGE VIDEO
echo ==================================
echo.

REM --- Check Docker ---

where docker >nul 2>&1
if errorlevel 1 (
    echo ERREUR: Docker n'est pas installe.
    echo.
    echo Telecharge Docker Desktop :
    echo   https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
    echo ERREUR: Docker n'est pas demarre.
    echo Lance Docker Desktop, puis relance ce script.
    echo.
    pause
    exit /b 1
)

echo Docker: OK

if not exist ".env" type nul > .env

REM --- Check Kimi API key ---

findstr /c:"KIMI_API_KEY=sk-" .env >nul 2>&1
if errorlevel 1 (
    echo.
    echo =========================================
    echo   KIMI API KEY (pour l'IA)
    echo =========================================
    echo.
    echo Pour le montage IA, tu as besoin d'une cle API Kimi.
    echo.
    echo   1. Va sur https://platform.moonshot.ai/
    echo   2. Cree un compte et une cle API
    echo   3. Colle-la ici :
    echo.
    set /p KIMI_KEY="Kimi API Key: "

    if "!KIMI_KEY!"=="" (
        echo Aucune cle entree. Le pipeline ne peut pas demarrer.
        pause
        exit /b 1
    )

    echo KIMI_API_KEY=!KIMI_KEY!>> .env
    echo Cle Kimi sauvegardee.
)

echo Kimi: OK

REM --- Check Gemini API key ---

findstr /c:"GEMINI_API_KEY=" .env >nul 2>&1
if errorlevel 1 (
    echo.
    echo =========================================
    echo   GEMINI API KEY (pour les miniatures)
    echo =========================================
    echo.
    echo Pour generer des miniatures avec l'IA :
    echo   1. Va sur https://aistudio.google.com/apikey
    echo   2. Cree une cle API
    echo   3. Colle-la ici (ou laisse vide pour sauter) :
    echo.
    set /p GEMINI_KEY="Gemini API Key: "
    if not "!GEMINI_KEY!"=="" (
        echo GEMINI_API_KEY=!GEMINI_KEY!>> .env
        echo Cle Gemini sauvegardee.
    ) else (
        echo Pas de cle Gemini — les miniatures AI ne fonctionneront pas.
    )
)

REM --- Build and start ---

echo.
echo Demarrage du conteneur...
echo (Premier lancement = build de l'image, ~5-10 min)
echo.

docker compose up --build -d
if errorlevel 1 (
    echo.
    echo ERREUR: Le build Docker a echoue.
    echo Verifie ta connexion internet et reessaie.
    echo.
    pause
    exit /b 1
)

echo Attente du demarrage...
timeout /t 5 /nobreak >nul

echo.
echo =========================================
echo   PRET !
echo =========================================
echo.
echo   Interface : http://localhost:3000
echo   Arreter   : Ctrl+C ou 'docker compose down'
echo.

start http://localhost:3000

docker compose logs -f app
