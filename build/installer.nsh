; ============================================================================
; 自定义 NSIS 安装脚本（electron-builder 默认自动加载 build/installer.nsh）
;
; 目的：区分「自动更新」与「手动/官网安装」的向导流程——
;   - 自动更新：更新器拉起安装器时带 `--updated` 参数，electron-builder 据此置
;     ${isUpdated}=true。此时强制 per-user 安装并跳过「选择安装用户」页，配合
;     electron-builder 更新模式自动跳过欢迎/完成页，直达可见的安装进度条，全程
;     零点击、按既有路径覆盖安装。
;   - 手动 / 官网下载安装：无 `--updated`，${isUpdated}=false，保留完整辅助向导
;     （从「选择安装用户」页开始，可选安装目录）。
;
; 注意：本文件随安装包在「构建期」打入 setup.exe，需重新打包后才生效；同时客户端
; 需以 `--updated` 拉起安装器（见 electron/updater/installer.ts）。
; ============================================================================

!macro customInstallMode
  ; 仅自动更新（--updated）时强制 per-user，从而跳过「选择安装用户」选择页。
  ; 手动安装不进此分支，照常显示该页。
  ${if} ${isUpdated}
    StrCpy $isForceCurrentInstall "1"
  ${endif}
!macroend
