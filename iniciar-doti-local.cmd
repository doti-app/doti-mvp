@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\node.exe" (
    set "PATH=C:\Program Files\nodejs;%PATH%"
  ) else (
    echo.
    echo O Node.js ainda nao esta instalado.
    echo Instale a versao LTS em https://nodejs.org/ e tente novamente.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo Iniciando a Doti em http://localhost:3000
echo Mantenha esta janela aberta enquanto estiver testando.
echo.
call npm run dev

echo.
echo O servidor local foi encerrado.
pause
