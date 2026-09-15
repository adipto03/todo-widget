' Launches the To-Do widget without a console window.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
electron = dir & "\node_modules\electron\dist\electron.exe"

If Not fso.FileExists(electron) Then
  MsgBox "Electron isn't installed yet." & vbCrLf & "Open a terminal in this folder and run:  npm install", 48, "To-Do Widget"
  WScript.Quit 1
End If

shell.CurrentDirectory = dir
shell.Run """" & electron & """ """ & dir & """", 0, False
