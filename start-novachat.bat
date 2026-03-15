@echo off
setlocal

rem === NovaChat local launcher ===
rem 1) Ollama local endpoint
set "AI_ENDPOINT=http://localhost:11434/v1/chat/completions"
set "AI_MODEL=llama3.2"

rem 2) API key (leave blank for local Ollama)
set "AI_API_KEY="
rem set "AI_API_KEY=sk-PASTE-YOUR-REAL-KEY-HERE"

rem 3) Start the server
node "C:\Users\"Your UserName"\OneDrive\"Folder Loacation"\"Folder Name"\server.js"

rem 4) Keep the window open if it exits
pause
endlocal
