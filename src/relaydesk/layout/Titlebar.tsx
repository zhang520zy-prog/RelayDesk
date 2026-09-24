import { getRuntimePlatform } from "../environment/platform";

export function Titlebar() {
  // macOS uses an overlay titlebar, so the app draws its own drag region here.
  // Windows/Linux keep their native titlebar; rendering this would duplicate it.
  if (getRuntimePlatform() !== "macos") return null;
  return (
    <div className="rd-titlebar" data-tauri-drag-region>
      <span data-tauri-drag-region>RelayDesk</span>
    </div>
  );
}
