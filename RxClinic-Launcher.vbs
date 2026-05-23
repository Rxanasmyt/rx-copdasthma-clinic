' Rx-COPD/Asthma Clinic Launcher
' Runs standalone desktop app in Chrome

Set objShell = CreateObject("WScript.Shell")
strPath = objShell.CurrentDirectory

' Start Node.js server
objShell.Run "node.exe server.js", 0, False

' Wait for server to start
WScript.Sleep 2000

' Find Chrome path
On Error Resume Next
Set objReg = GetObject("winmgmts:").ExecMethod("Win32_Process", "Create", , , )
strChrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
If Dir(strChrome) = "" Then
  strChrome = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
End If

' Launch Chrome in app mode
objShell.Run strChrome & " --app=http://localhost:3000 --incognito", 3, False
