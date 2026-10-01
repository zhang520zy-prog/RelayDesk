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
};
