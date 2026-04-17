@echo off
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

REM --- Check Claude auth ---

docker compose exec -T app claude -p "say ok" --output-format json 2>&1 | findstr /i "not logged in authentication" >nul
if not errorlevel 1 (
    echo.
    echo =========================================
    echo   PREMIERE UTILISATION
    echo =========================================
    echo.
    echo Claude n'est pas encore connecte.
    echo Lance cette commande dans un terminal :
    echo.
    echo   cd %cd%
    echo   docker compose run --rm app claude login
    echo.
    echo Puis relance ce script.
    echo.
    docker compose down
    pause
    exit /b 0
)

REM --- Open browser ---

echo.
echo =========================================
echo   PRET !
echo =========================================
echo.
echo   Interface : http://localhost:3000
echo   Arreter   : Ctrl+C ou 'docker compose down'
echo.

start http://localhost:3000

REM Follow logs
docker compose logs -f app
