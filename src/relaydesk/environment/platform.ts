export type EnvironmentPlatform =
  | "windows"
  | "macos"
  | "linux-desktop"
  | "linux-server"
  | "linux-unknown"
  | "unknown";

// The webview can identify an OS family, not desktop/headless capabilities.
// Keep Linux unknown until the environment backend supplies that distinction.
export function getRuntimePlatform(
  value = navigator.platform,
): EnvironmentPlatform {
  if (/mac/i.test(value)) return "macos";
  if (/win/i.test(value)) return "windows";
  if (/linux/i.test(value)) return "linux-unknown";
  return "unknown";
}

export function canLaunchDesktop(platform: EnvironmentPlatform) {
  return platform === "macos"; // Current desktop detection/launch backend support.
}
