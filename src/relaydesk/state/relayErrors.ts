export function relayErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    /relay\.(session_expired|not_logged_in)|登录已失效|登录已过期|Not logged in/.test(
      message,
    )
  )
    return "expired";
  if (/relay\.invalid_credentials/.test(message)) return "invalidCredentials";
  if (/relay\.(network|timeout)/.test(message)) return "network";
  if (/relay\.rate_limited/.test(message)) return "rateLimited";
  if (/relay\.(invalid_url|https_required)/.test(message)) return "invalidUrl";
  if (/relay\.busy/.test(message)) return "busy";
  if (/relay\.no_targets/.test(message)) return "noTargets";
  if (/relay\.(no_logs|logs_not_found|diagnostics_no_logs)/.test(message))
    return "noLogs";
  return "genericError";
}
