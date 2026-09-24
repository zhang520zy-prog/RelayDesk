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
}
