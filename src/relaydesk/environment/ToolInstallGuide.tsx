import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { relayApi } from "@/lib/api/relay";
import { settingsApi } from "@/lib/api/settings";
import { copyText } from "@/lib/clipboard";
import { Action } from "../ui";
import "./environment.css";

export const toolInstallSources: Record<
  string,
  { command: string; url: string; source: string }
> = {
  claude: {
    command: "npm i -g @anthropic-ai/claude-code@latest",
    source: "https://claude.ai/install.sh · @anthropic-ai/claude-code",
    url: "https://code.claude.com/docs/en/setup",
  },
  codex: {
    command: "npm i -g @openai/codex@latest",
    source: "npm · @openai/codex",
    url: "https://developers.openai.com/codex/cli/",
  },
  gemini: {
    command: "npm i -g @google/gemini-cli@latest",
    source: "npm · @google/gemini-cli",
    url: "https://geminicli.com/docs/get-started/installation/",
  },
  grok: {
    command: "npm i -g @xai-official/grok@latest",
    source: "https://x.ai/cli/install.sh · @xai-official/grok",
    url: "https://docs.x.ai/docs/grok-code-fast-1",
  },
  devin: {
    command: "npm i -g devin@latest",
    source: "https://cli.devin.ai/install.sh · devin",
    url: "https://docs.devin.ai/cli",
  },
};

export function ToolInstallGuide({ app }: { app: string }) {
  const { t } = useTranslation("relaydesk");
  const [status, setStatus] = useState<string | null>(null);
  const fallback = toolInstallSources[app] ?? {
    command: "",
    url: "",
    source: "",
  };
  const plan = useQuery({
    queryKey: ["relaydesk", "tool-install-plan", app],
    queryFn: () => relayApi.getToolInstallPlan(app),
    retry: false,
    staleTime: 24 * 60 * 60 * 1000,
  });
  const guide = {
    command: plan.data?.command ?? fallback.command,
    url: plan.data?.docsUrl ?? fallback.url,
  };
  return (
    <div className="rd-install-guide">
      <p>{t("manualInstallHint")}</p>
      <code>{guide.command}</code>
      <div className="rd-env-actions">
        <Action
          onClick={() =>
            void copyText(guide.command).then(
              () => setStatus("commandCopied"),
              () => setStatus("commandCopyFailed"),
            )
          }
        >
          <Copy size={14} />
          {t("copyCommand")}
        </Action>
        <Action
          onClick={() =>
            void settingsApi
              .openExternal(guide.url)
              .catch(() => setStatus("guideOpenFailed"))
          }
        >
          <ExternalLink size={14} />
          {t("officialInstallGuide")}
        </Action>
      </div>
      {status && <p role="status">{t(status)}</p>}
    </div>
  );
}
