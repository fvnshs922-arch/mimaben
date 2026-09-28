@echo off
chcp 65001 >nul
cd /d "%~dp0"
where pythonw >nul 2>nul || (echo 没有找到 Python，请先安装 Python 3。 & pause & exit /b 1)
set PYTHONUTF8=1
python tools\setup_window.py
start "" pythonw tools\app.py
