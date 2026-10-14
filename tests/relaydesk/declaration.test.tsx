import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import i18n from "i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";
import RelayDeskApp from "@/relaydesk/RelayDeskApp";
import { installRelayTranslations } from "@/relaydesk/i18n";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";

const post = (cmd: string, fn: Parameters<typeof http.post>[1]) =>
  http.post(`http://tauri.local/${cmd}`, fn);

beforeAll(async () => {
  installRelayTranslations();
  await i18n.changeLanguage("zh");
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
});

const ACCEPT_KEY = "relaydesk.legal.accepted.v1";

function mount() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider defaultTheme="dark" storageKey="relaydesk-theme">
        <RelayDeskApp />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

// 本文件独立验证声明门：清掉 setup 里的默认同意标记；
// server.resetHandlers() 每测试都会清掉 mock，这里反复注册未登录态。
beforeEach(() => {
  localStorage.removeItem(ACCEPT_KEY);
  server.use(
    post("relay_get_account", () => HttpResponse.json(null)),
    post("relay_saved_login_name", () => HttpResponse.json(null)),
    post("relay_list_saved_logins", () => HttpResponse.json([])),
  );
});

describe("usage & risk declaration gate", () => {
  it("blocks login until the declaration is checked and accepted", async () => {
    mount();
    // 声明弹出，登录按钮不可见
    const heading = await screen.findByRole("heading", {
      name: "RelayDesk 应用使用与风险声明",
    });
    expect(heading).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "登录 RelayDesk" }),
    ).not.toBeInTheDocument();
    // 未勾选时同意按钮禁用
    const accept = screen.getByRole("button", { name: "同意并继续" });
    expect(accept).toBeDisabled();
    // 勾选后才能继续
    await userEvent.click(
      screen.getByRole("checkbox", { name: /我已完整阅读/ }),
    );
    expect(accept).toBeEnabled();
    await userEvent.click(accept);
    // 门放行 → 登录页出现
    expect(
      await screen.findByRole("button", { name: "登录 RelayDesk" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(ACCEPT_KEY)).toBe("1");
  });

  it("does not show the gate again once accepted", async () => {
    localStorage.setItem(ACCEPT_KEY, "1");
    mount();
    expect(
      await screen.findByRole("button", { name: "登录 RelayDesk" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /使用与风险声明/ }),
    ).not.toBeInTheDocument();
  });
});
