export type EnvironmentStatus =
  | "ok"
  | "warn"
  | "error"
  | "fixable"
  | "loading"
  | "unavailable"
  | "unsupported";
export interface EnvironmentCheck {
  id: string;
  label: string;
  status: EnvironmentStatus;
  detail: string;
  /** 可选补充说明（如"无法运行"的底层原因），以小字展示在 detail 下方 */
  hint?: string;
  /** 已安装但探测失败时提供"修复安装"入口（复用一键安装对话框） */
  repairable?: boolean;
}
