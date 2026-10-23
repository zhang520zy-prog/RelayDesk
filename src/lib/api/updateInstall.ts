// 应用更新安装的全局在途标志：
// 「关于」页与顶部更新横幅是两个独立入口，这里统一"是否已有安装在跑"，
// 避免并发调用 install_update_and_restart，并让另一处 UI 同步显示安装中。
// 内存级标志——应用重启/重载后自然复位，语义正确。
const UPDATE_INSTALL_START = "relaydesk:update-install-start";
let inFlight = false;

export function beginUpdateInstall(): boolean {
  if (inFlight) return false;
  inFlight = true;
  window.dispatchEvent(new CustomEvent(UPDATE_INSTALL_START));
  return true;
}

export function endUpdateInstall(): void {
  inFlight = false;
}

export function updateInstallInFlight(): boolean {
  return inFlight;
}
