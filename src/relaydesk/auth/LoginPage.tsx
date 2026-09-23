import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  ShieldCheck,
  Check,
  Languages,
  SunMoon,
  Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Brand } from "../layout/Brand";
import { Titlebar } from "../layout/Titlebar";
import { Action, Field } from "../ui";
import { useTheme } from "@/components/theme-provider";
import type { RelaySavedLogin } from "@/lib/api/relay";

const RELAY_BASE_URL = "https://www.shenlanqaq.com/";
// The relay now serves its management API and website routes from the same
// origin. Keep the login links rooted at the public site so registration and
// password recovery never inherit the legacy tenant prefix.
const RELAY_LOGIN_URL = "https://www.shenlanqaq.com/sign-in";
const RELAY_SIGN_UP_URL = `${RELAY_BASE_URL}sign-up`;
const RELAY_FORGOT_PASSWORD_URL = `${RELAY_BASE_URL}forgot-password`;

export function LoginPage({
  busy,
  error,
  login,
  savedLogins = [],
  savedLoginsLoading = false,
  loginSaved,
  forgetSavedLogin,
}: {
  busy: boolean;
  error: string | null;
  login: (
    url: string,
    username: string,
    password: string,
    remember: boolean,
  ) => Promise<void>;
  savedLogins?: RelaySavedLogin[];
  savedLoginsLoading?: boolean;
  loginSaved?: (savedId: string) => Promise<void>;
  forgetSavedLogin?: (savedId: string) => Promise<void>;
}) {
  const { t, i18n } = useTranslation("relaydesk");
  const { theme, setTheme } = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [remember, setRemember] = useState(false);
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const hasSavedLogins = savedLogins.length > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    await login(RELAY_BASE_URL, username.trim(), password, remember);
    setPassword("");
    setVisible(false);
  }
  return (
    <div className="rd-login">
      <Titlebar />
      <div className="rd-login-top">
        <Brand />
        <div className="rd-login-utilities">
          <label htmlFor="rd-login-theme">
            <SunMoon size={16} aria-hidden="true" />
            <span className="sr-only">{t("theme")}</span>
          </label>
          <select
            id="rd-login-theme"
            className="rd-select"
            value={theme}
            onChange={(event) =>
              setTheme(event.target.value as "light" | "dark" | "system")
            }
          >
            <option value="light">{t("light")}</option>
            <option value="dark">{t("dark")}</option>
            <option value="system">{t("system")}</option>
          </select>

          <label htmlFor="rd-login-language">
            <Languages size={16} aria-hidden="true" />
            <span className="sr-only">{t("language")}</span>
          </label>
          <select
            id="rd-login-language"
            className="rd-select"
            value={i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en"}
            onChange={(event) => {
              try {
                localStorage.setItem("language", event.target.value);
              } catch {
                /* Keep language selection usable without persistence. */
              }
              void i18n.changeLanguage(event.target.value);
            }}
          >
            <option value="zh">简体中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>
      <main className="rd-login-main">
        <section className="rd-login-story">
          <span className="rd-eyebrow">{t("loginOverline")}</span>
          <h2>
            {t("welcome")}
            <br />
            <em>{t("welcomeAccent")}</em>
          </h2>
          <p>{t("loginSubtitle")}</p>
          <div className="rd-login-tools" aria-label={t("loginTools")}>
            <span>Claude Code</span>
            <span>OpenAI Codex</span>
            <span>Gemini CLI</span>
          </div>
          <div className="rd-login-benefit">
            <Check size={16} />
            {t("credentialsHint")}
          </div>
        </section>
        <section className="rd-login-form">
          <h1>{t("login")}</h1>
          <p className="rd-login-form-hint">{t("loginFormHint")}</p>
          {hasSavedLogins && !showPasswordForm && (
            <div className="rd-saved-logins" aria-label={t("savedLoginList")}>
              <div className="rd-saved-logins-heading">
                <span>{t("savedLoginTitle")}</span>
                <small>{t("savedLoginHint")}</small>
              </div>
              <div className="rd-saved-login-list">
                {savedLogins.map((saved) => (
                  <div className="rd-saved-login" key={saved.id}>
                    <button
                      type="button"
                      className="rd-saved-login-main"
                      disabled={busy || selectedSavedId !== null}
                      onClick={async () => {
                        if (!loginSaved || busy) return;
                        setSelectedSavedId(saved.id);
                        try {
                          await loginSaved(saved.id);
                        } finally {
                          setSelectedSavedId(null);
                        }
                      }}
                    >
                      <span
                        className="rd-saved-login-avatar"
                        aria-hidden="true"
                      >
                        {saved.username.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="rd-saved-login-copy">
                        <strong>{saved.username}</strong>
                        <small>{saved.baseUrl}</small>
                      </span>
                      {selectedSavedId === saved.id ? (
                        <Loader2
                          size={16}
                          className="rd-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <ArrowRight size={16} aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="rd-saved-login-forget"
                      aria-label={`${t("forgetSavedLogin")}: ${saved.username}`}
                      disabled={busy || selectedSavedId !== null}
                      onClick={() => void forgetSavedLogin?.(saved.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="rd-text-button rd-saved-login-other"
                onClick={() => setShowPasswordForm(true)}
              >
                {t("useOtherAccount")}
              </button>
            </div>
          )}
          {savedLoginsLoading && !hasSavedLogins && (
            <p className="rd-saved-login-loading" role="status">
              {t("savedLoginLoading")}
            </p>
          )}
          {error && (
            <div id="rd-login-error" role="alert" className="rd-alert error">
              {t(error)}
            </div>
          )}
          {(showPasswordForm || !hasSavedLogins) && (
            <form onSubmit={submit} aria-busy={busy}>
              <fieldset disabled={busy}>
                <label htmlFor="rd-username">{t("username")}</label>
                <Field
                  id="rd-username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={t("usernamePlaceholder")}
                  aria-describedby={error ? "rd-login-error" : undefined}
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
                <label htmlFor="rd-password">{t("password")}</label>
                <div className="rd-password">
                  <Field
                    id="rd-password"
                    aria-describedby={error ? "rd-login-error" : undefined}
                    type={visible ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <Action
                    type="button"
                    className="rd-eye"
                    aria-pressed={visible}
                    aria-controls="rd-password"
                    aria-label={t(visible ? "hidePassword" : "showPassword")}
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                  </Action>
                </div>
                <Action
                  primary
                  type="submit"
                  className="rd-login-submit"
                  disabled={busy || !username.trim() || !password}
                >
                  {busy ? (
                    <>
                      <Loader2
                        size={17}
                        className="rd-spin"
                        aria-hidden="true"
                      />
                      {t("loggingIn")}
                    </>
                  ) : (
                    <>
                      {t("login")}
                      <ArrowRight size={17} />
                    </>
                  )}
                </Action>
                <label
                  className="rd-remember-login"
                  htmlFor="rd-remember-login"
                >
                  <input
                    id="rd-remember-login"
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                  />
                  <span>{t("rememberLogin")}</span>
                  <small>{t("rememberLoginHint")}</small>
                </label>
                <div className="rd-login-options">
                  <div className="rd-login-links">
                    <a
                      href={RELAY_SIGN_UP_URL}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("register")}
                    </a>
                    <a
                      href={RELAY_FORGOT_PASSWORD_URL}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("forgotPassword")}
                    </a>
                  </div>
                </div>
              </fieldset>
            </form>
          )}
          {hasSavedLogins && showPasswordForm && (
            <button
              type="button"
              className="rd-text-button rd-saved-login-other"
              onClick={() => setShowPasswordForm(false)}
            >
              {t("backToSavedLogins")}
            </button>
          )}
          <div className="rd-advanced">
            <span className="rd-instance-label">{t("instance")}</span>
            <p className="rd-instance-fixed">
              <a href={RELAY_LOGIN_URL} target="_blank" rel="noreferrer">
                {RELAY_LOGIN_URL}
              </a>
            </p>
          </div>
          <p className="rd-privacy">
            <ShieldCheck size={15} />
            {t("privacy")}
          </p>
        </section>
      </main>
      <footer className="rd-login-footer">
        RelayDesk<span>{t("ready")}</span>
      </footer>
    </div>
  );
}
