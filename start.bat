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

REM --- Check Claude auth token ---

if not exist ".env" goto :need_token
findstr /c:"CLAUDE_CODE_OAUTH_TOKEN" .env >nul 2>&1
if errorlevel 1 goto :need_token
goto :token_ok

:need_token
echo.
echo =========================================
echo   CONNEXION CLAUDE (une seule fois)
echo =========================================
echo.
echo Claude CLI a besoin d'un token d'authentification.
echo.

REM Check if claude is available on host
where claude >nul 2>&1
if errorlevel 1 (
    echo Claude CLI n'est pas installe sur ta machine.
    echo.
    echo Pour generer le token :
    echo   1. Installe Node.js : https://nodejs.org/
    echo   2. npm install -g @anthropic-ai/claude-code
    echo   3. claude setup-token
    echo.
    echo Puis cree un fichier .env dans ce dossier avec :
    echo   CLAUDE_CODE_OAUTH_TOKEN=ton_token_ici
    echo.
    pause
    exit /b 1
)

echo Lance "claude setup-token" pour generer un token.
echo Si une fenetre de navigateur s'ouvre, connecte-toi avec ton compte Claude.
echo.
echo Copie le token affiche et colle-le ci-dessous :
echo.
set /p TOKEN="Token: "

if "%TOKEN%"=="" (
    echo Aucun token entre.
    pause
    exit /b 1
)

echo CLAUDE_CODE_OAUTH_TOKEN=%TOKEN%> .env
echo Token sauvegarde dans .env

:token_ok
echo Token Claude: OK

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
