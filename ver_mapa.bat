@echo off
cd /d "%~dp0"
echo Abriendo el mapa en http://localhost:8000 ...
echo (Para cerrarlo, cierra esta ventana.)
start "" http://localhost:8000
python -m http.server 8000
