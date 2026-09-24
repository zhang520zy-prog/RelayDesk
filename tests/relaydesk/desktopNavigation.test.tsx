import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import i18n from "i18next";
import { installRelayTranslations } from "@/relaydesk/i18n";
import { AppShell } from "@/relaydesk/layout/AppShell";
import type { RelayAccountInfo } from "@/lib/api/relay";
const account = {
  username: "fixture",
  quota: 0,
  applyApps: {},
} as RelayAccountInfo;
beforeEach(async () => {
  localStorage.clear();
  installRelayTranslations();
  await i18n.changeLanguage("zh");
});
it("limits global refresh to pages it updates and focuses the destination heading", () => {
  const props = {
    account,
    busy: false,
    refreshing: false,
    refresh: vi.fn(),
    logout: vi.fn(),
    navigate: vi.fn(),
  };
  const { rerender } = render(
    <AppShell {...props} page="models">
      models
    </AppShell>,
  );
  expect(screen.getByRole("button", { name: "刷新数据" })).toBeInTheDocument();
  rerender(
    <AppShell {...props} page="usage">
      usage
    </AppShell>,
  );
  expect(
    screen.queryByRole("button", { name: "刷新数据" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "用量统计" })).toHaveFocus();
});
it("remembers sidebar width across remounts and offers a keyboard skip link", async () => {
  const props = {
    account,
    page: "usage" as const,
    busy: false,
    refreshing: false,
    refresh: vi.fn(),
    logout: vi.fn(),
    navigate: vi.fn(),
  };
  const user = userEvent.setup();
  const first = render(<AppShell {...props}>usage</AppShell>);
  await user.click(screen.getByRole("button", { name: "折叠导航" }));
  first.unmount();
  render(<AppShell {...props}>usage</AppShell>);
  expect(screen.getByRole("button", { name: "展开导航" })).toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "跳转到主内容" }));
  expect(screen.getByRole("main")).toHaveFocus();
});

it("keeps navigation static without a hover layer or scale animation", () => {
  const { container } = render(
    <AppShell
      account={account}
      page="models"
      busy={false}
      refreshing={false}
      refresh={vi.fn()}
      logout={vi.fn()}
      navigate={vi.fn()}
    >
      models
    </AppShell>,
  );
  expect(container.querySelector(".rd-nav-hover")).toBeNull();
  expect(container.querySelectorAll(".rd-nav-content")).toHaveLength(5);
  expect(
    [...container.querySelectorAll<HTMLElement>(".rd-nav-content")].every(
      (element) => !element.style.transform,
    ),
  ).toBe(true);
});
