import { useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, ShieldCheck, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Brand } from "../layout/Brand";
import { Titlebar } from "../layout/Titlebar";
import { Action, Field } from "../ui";

const RELAY_BASE_URL = "https://yjapi.manqiaotechnology.com/";

export function LoginPage({
  busy,
  error,
  login,
}: {
  busy: boolean;
  error: string | null;
  login: (url: string, username: string, password: string) => Promise<void>;
}) {
  const { t } = useTranslation("relaydesk");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    await login(RELAY_BASE_URL, username.trim(), password);
    setPassword("");
    setVisible(false);
  }
  return (
    <div className="rd-login">
      <Titlebar />
      <div className="rd-login-top">
        <Brand />
        <span className="rd-muted">{t("desktop")}</span>
      </div>
      <main className="rd-login-main">
        <section className="rd-login-story">
          <span className="rd-eyebrow">{t("loginOverline")}</span>
          <h1>
            {t("welcome")}
            <br />
            <em>{t("welcomeAccent")}</em>
          </h1>
          <p>{t("loginSubtitle")}</p>
          <div className="rd-connection-art" aria-hidden="true">
            <div className="rd-art-lines">
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="rd-art-caption">
              RelayDesk <ArrowRight size={16} /> Claude Code / Codex / Gemini
            </div>
          </div>
          <div className="rd-login-benefit">
            <Check size={16} />
            {t("credentialsHint")}
          </div>
        </section>
        <section className="rd-login-form">
          <h2>{t("login")}</h2>
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              <label htmlFor="rd-username">{t("username")}</label>
              <Field
                id="rd-username"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <label htmlFor="rd-password">{t("password")}</label>
              <div className="rd-password">
                <Field
                  id="rd-password"
                  type={visible ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Action
                  type="button"
                  className="rd-eye"
                  aria-label={t(visible ? "hidePassword" : "showPassword")}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                </Action>
              </div>
              <div className="rd-advanced">
                <label>{t("instance")}</label>
                <p className="rd-instance-fixed">{RELAY_BASE_URL}</p>
              </div>
              {error && (
                <div role="alert" className="rd-alert error">
                  {t(error)}
                </div>
              )}
              <Action
                primary
                type="submit"
                className="rd-login-submit"
                disabled={busy || !username.trim() || !password}
              >
                {busy ? (
                  t("loggingIn")
                ) : (
                  <>
                    {t("login")}
                    <ArrowRight size={17} />
                  </>
                )}
              </Action>
            </fieldset>
          </form>
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
