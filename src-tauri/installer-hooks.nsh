; RelayDesk NSIS hooks
; 卸载完成后询问用户是否一并删除本地数据（登录信息、设置、日志、缓存）。
; 默认选择「否」，保留数据以便重装后继续使用。

!macro NSIS_HOOK_POSTUNINSTALL
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否同时删除 RelayDesk 的本地数据？$\r$\n$\r$\n选择「是」：删除登录信息、设置、日志与缓存（$PROFILE\.relaydesk 及应用数据目录）。$\r$\n选择「否」：保留数据，重装后可继续使用。" /SD IDNO IDYES relaydesk_delete_data
  Goto relaydesk_skip_data
relaydesk_delete_data:
  RMDir /r "$PROFILE\.relaydesk"
  RMDir /r "$APPDATA\com.relaydesk.desktop"
  RMDir /r "$LOCALAPPDATA\com.relaydesk.desktop"
relaydesk_skip_data:
!macroend
