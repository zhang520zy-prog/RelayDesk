import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import i18n from "i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";
import RelayDeskApp from "@/relaydesk/RelayDeskApp";
import { installRelayTranslations } from "@/relaydesk/i18n";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";

const ACCEPT_KEY = "relaydesk.legal.accepted.v1";
const post = (cmd: string, fn: Parameters<typeof http.post>[1]) =>
  http.post(`http://tauri.local/${cmd}`, fn);

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

// server.resetHandlers() 每测试都会清掉 mock，这里反复注册未登录态
beforeEach(() => {
  localStorage.removeItem(ACCEPT_KEY);
  server.use(
    post("relay_get_account", () => HttpResponse.json(null)),
    post("relay_saved_login_name", () => HttpResponse.json(null)),
    post("relay_list_saved_logins", () => HttpResponse.json([])),
    post("relay_log_frontend_error", () => HttpResponse.json(null)),
  );
});

describe("usage & risk declaration gate", () => {
  it("pops on login click; requires scroll-to-bottom + checkbox", async () => {
    mount();
    // 启动不再拦截：登录页直接可见
    const loginBtn = await screen.findByRole("button", {
      name: "登录 RelayDesk",
    });
    expect(
      screen.queryByRole("dialog", { name: /使用与风险声明/ }),
    ).not.toBeInTheDocument();

    // 先填表单（required 校验会拦空表单），点登录 → 声明弹出
    await userEvent.type(document.getElementById("rd-username")!, "demo");
    await userEvent.type(document.getElementById("rd-password")!, "secret");
    await userEvent.click(loginBtn);
    const dialog = await screen.findByRole("dialog", {
      name: "RelayDesk 应用使用与风险声明",
    });
    expect(dialog).toBeInTheDocument();

    // 未滚到底：勾选框禁用
    const checkbox = screen.getByRole("checkbox", { name: /我已完整阅读/ });
    expect(checkbox).toBeDisabled();
    const accept = screen.getByRole("button", { name: "同意并继续" });
    expect(accept).toBeDisabled();

    // 滚动到底（jsdom scrollHeight=0 → 一次 scroll 事件即满足）
    const body = dialog.querySelector(".rd-legal-body")!;
    fireEvent.scroll(body);
    await waitFor(() => expect(checkbox).toBeEnabled());
    expect(accept).toBeDisabled(); // 滚到底但未勾选仍不放行
    await userEvent.click(checkbox);
    expect(accept).toBeEnabled();

    // 同意 → 标记落盘 + 触发真实登录提交（400 → 走失败路径留在登录页）
    let loginCalls = 0;
    server.use(
      post("relay_login", () => {
        loginCalls += 1;
        return HttpResponse.json("invalid credentials", { status: 400 });
      }),
    );
    await userEvent.click(accept);
    await waitFor(() => expect(loginCalls).toBe(1));
    expect(localStorage.getItem(ACCEPT_KEY)).toBe("1");
  });

  it("skips the dialog once accepted", async () => {
    localStorage.setItem(ACCEPT_KEY, "1");
    mount();
    let loginCalls = 0;
    server.use(
      post("relay_login", () => {
        loginCalls += 1;
        return HttpResponse.json("invalid credentials", { status: 400 });
      }),
    );
    const loginBtn = await screen.findByRole("button", {
      name: "登录 RelayDesk",
    });
    await userEvent.type(document.getElementById("rd-username")!, "demo");
    await userEvent.type(document.getElementById("rd-password")!, "secret");
    await userEvent.click(loginBtn);
    await waitFor(() => expect(loginCalls).toBe(1));
    expect(
      screen.queryByRole("dialog", { name: /使用与风险声明/ }),
    ).not.toBeInTheDocument();
  });
});
