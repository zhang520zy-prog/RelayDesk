import { invoke } from "@tauri-apps/api/core";

export interface RelaySessionMeta {
  providerId: string;
  sessionId: string;
  title?: string;
  summary?: string;
  projectDir?: string;
  createdAt?: number;
  lastActiveAt?: number;
  sourcePath?: string;
  resumeCommand?: string;
}

export interface RelaySessionMessage {
  role: string;
  content: string;
  ts?: number;
}

export const relaydeskSessionApi = {
  list: () => invoke<RelaySessionMeta[]>("list_sessions"),

  messages: (providerId: string, sourcePath: string) =>
    invoke<RelaySessionMessage[]>("get_session_messages", {
      providerId,
      sourcePath,
    }),

  delete: (providerId: string, sessionId: string, sourcePath: string) =>
    invoke<boolean>("delete_session", {
      providerId,
      sessionId,
      sourcePath,
    }),

  launchTerminal: (command: string, cwd?: string | null) =>
    invoke<boolean>("launch_session_terminal", {
      command,
      cwd: cwd ?? null,
      customConfig: null,
    }),

  /** 打开供应商桌面端（Claude.app / ChatGPT.app…）。桌面应用与本目录共享
   *  会话存储，打开后在其历史列表中可继续同一会话。 */
  launchDesktop: (app: string) =>
    invoke<void>("relay_launch_target", { app, mode: "desktop" }),
};
