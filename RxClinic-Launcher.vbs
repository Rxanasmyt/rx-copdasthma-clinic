' Rx-COPD/Asthma Clinic Launcher
Set objShell = CreateObject("WScript.Shell")
strPath = objShell.CurrentDirectory

' Start Node.js server
objShell.Run "cmd /c node.exe server.js", 0, False

' Wait for server
WScript.Sleep 2000

' Try Chrome locations
Dim strChrome
strChrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
If CreateObject("Scripting.FileSystemObject").FileExists(strChrome) = False Then
  strChrome = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
End If

If CreateObject("Scripting.FileSystemObject").FileExists(strChrome) = False Then
  MsgBox "Chrome not found. Open http://localhost:3000 in your browser", 0, "Rx Clinic"
Else
  objShell.Run Chr(34) & strChrome & Chr(34) & " --kiosk=http://localhost:3000", 0, False
End If
