' Rx-COPD/Asthma Clinic Launcher
Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' เดิม strPath เก็บค่า objShell.CurrentDirectory ไว้เฉยๆ ไม่เคยเอาไปใช้ที่ไหนเลย (dead variable) —
' ส่วนคำสั่ง Run ด้านล่างพึ่งพา current working directory ให้ตรงกับโฟลเดอร์ที่มี server.js อยู่โดยไม่ได้
' ตั้งค่าเองเลย ถ้าเปิดสคริปต์นี้ผ่าน context ที่ CWD ไม่ตรง (เช่นสร้าง shortcut ที่ตั้ง "Start in" เป็น
' โฟลเดอร์อื่น หรือเรียกผ่าน Windows Run dialog) จะหา server.js ไม่เจอ ล้มเหลวแบบเงียบๆ (หน้าต่างซ่อนอยู่
' เพราะ Run ใช้โหมด 0) ผู้ใช้จะเห็นแค่ Chrome เปิดขึ้นมาแล้วบอก "เข้าถึงเว็บไซต์นี้ไม่ได้" โดยไม่รู้สาเหตุ
' แก้โดยหาโฟลเดอร์ที่สคริปต์นี้อยู่จริง (WScript.ScriptFullName) แล้ว cd เข้าไปก่อนรัน node เสมอ
strScriptFolder = objFSO.GetParentFolderName(WScript.ScriptFullName)

' Start Node.js server (cd /d เข้าโฟลเดอร์ของสคริปต์นี้ก่อนเสมอ ไม่พึ่ง CWD เดิมที่อาจไม่ตรง)
objShell.Run "cmd /c cd /d " & Chr(34) & strScriptFolder & Chr(34) & " && node.exe server.js", 0, False

' Wait for server
WScript.Sleep 2000

' Try Chrome locations
Dim strChrome
strChrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
If objFSO.FileExists(strChrome) = False Then
  strChrome = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
End If

If objFSO.FileExists(strChrome) = False Then
  MsgBox "Chrome not found. Open http://localhost:3000 in your browser", 0, "Rx Clinic"
Else
  objShell.Run Chr(34) & strChrome & Chr(34) & " --kiosk=http://localhost:3000", 0, False
End If
