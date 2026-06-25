
@echo off
cd /d "%~dp0"
if exist package.json (
	npm start
) else (
	node ./src/server.js
)
pause