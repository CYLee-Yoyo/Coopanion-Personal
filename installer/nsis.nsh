; Coopanion Personal installs under its own directory. Uninstall never reports telemetry.
!macro customInit
  ${IfNot} ${isUpdated}
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\CoopanionPersonal"
  ${EndIf}
!macroend
!macro customFiles_x64
  ${IfNot} ${FileExists} "$INSTDIR\Coopanion Personal.exe"
    MessageBox MB_OK|MB_ICONSTOP "Coopanion Personal could not be extracted." /SD IDOK
    Abort
  ${EndIf}
!macroend
