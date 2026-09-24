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
  if (/relay\.endpoint_unavailable/.test(message)) return "endpointUnavailable";
  if (/relay\.login_failed/.test(message)) return "loginFailed";
  if (/relay\.rate_limited/.test(message)) return "rateLimited";
  if (/relay\.saved_login_expired/.test(message)) return "savedLoginExpired";
  if (/relay\.saved_login_missing/.test(message)) return "savedLoginMissing";
  if (/relay\.saved_login_storage_failed/.test(message))
    return "savedLoginStorageFailed";
  if (/relay\.(invalid_url|https_required)/.test(message)) return "invalidUrl";
  if (/relay\.busy/.test(message)) return "busy";
  if (/relay\.no_targets/.test(message)) return "noTargets";
  if (/relay\.(no_logs|logs_not_found|diagnostics_no_logs)/.test(message))
    return "noLogs";
  if (/relay\.credential_missing/.test(message)) return "credentialMissing";
  if (/relay\.(credential_store_failed|session_lock_failed)/.test(message))
    return "credentialStoreFailed";
  return "genericError";
}
