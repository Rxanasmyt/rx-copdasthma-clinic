' Rx-COPD/Asthma Clinic Launcher
' Runs in Chrome app mode (fullscreen, no browser UI)

Set objShell = CreateObject("WScript.Shell")
strPath = objShell.CurrentDirectory

' Start Node.js server in background
objShell.Run "node.exe server.js", 0, False

' Wait for server to start
WScript.Sleep 2000

' Find Chrome
strChrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
If Dir(strChrome) = "" Then
  strChrome = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
End If

' Launch Chrome in fullscreen kiosk mode
' --kiosk = fullscreen, no UI
' --incognito = private mode (no history)
objShell.Run strChrome & " --kiosk=http://localhost:3000 --incognito --no-first-run", 0, False
