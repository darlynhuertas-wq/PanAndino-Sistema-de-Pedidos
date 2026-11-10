@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ================================================
echo   PANANDINO - INICIANDO SERVIDOR WEB
echo ================================================
echo.
where py >nul 2>&1
if %errorlevel%==0 (
    echo Python detectado. Iniciando...
    echo.
    echo Abre: http://127.0.0.1:8000
    echo Administradora: 1234
    echo Cerrar: Ctrl + C
    echo.
    py app.py
) else (
    where python >nul 2>&1
    if %errorlevel%==0 (
        echo Abre: http://127.0.0.1:8000
        python app.py
    ) else (
        echo ERROR: No se encuentra Python.
        echo Instala Python 3.10 o posterior y marca "Add Python to PATH".
    )
)
echo.
echo El servidor se ha detenido.
pause
