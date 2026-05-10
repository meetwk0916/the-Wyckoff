@echo off
setlocal

if "%PTRADE_RELAY_PORT%"=="" set PTRADE_RELAY_PORT=19090

echo [ptrade-relay-win] starting on port %PTRADE_RELAY_PORT%
python "%~dp0ptrade_relay_server.py"

endlocal