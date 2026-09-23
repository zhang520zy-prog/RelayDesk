# RelayDesk

RelayDesk 是一个独立的桌面客户端：登录你自营的 new-api 中转站后，可以查看余额与用量、浏览分组与模型，并一键把所选模型应用（同步配置）到 Claude Code、OpenAI Codex 与 Gemini CLI，同时自动创建对应分组的 API Key。

## 功能

- **中转站账号**：登录、余额/累计消费、近 7 天用量统计
- **模型中心**：48+ 模型、分组浏览、按分组映射应用目标工具
- **一键应用**：自动创建分组令牌，写入各工具配置
- **工具部署**：本机环境医生（Git/Python/Node/中转站可达性/代理/目录可写性）、CLI 检测与引导安装、桌面端状态分行展示
- **目标重启**：模型切换成功后，可在确认后重启 macOS 桌面端（ChatGPT/Codex、Claude.app）
- **诊断导出**：一键导出脱敏日志 + 环境检查，便于反馈问题
- **自动更新**：设置页检查更新，确认后下载安装（需配置更新端点）

## 开发

```bash
pnpm install
pnpm dev          # Tauri 桌面开发模式
pnpm test:unit    # 前端测试（vitest）
cargo test --manifest-path src-tauri/Cargo.toml   # 后端测试
```

## Windows 测试包

仓库内置 `.github/workflows/windows-test-build.yml`：在 Actions 中手动触发即可产出未签名的 NSIS 安装包 artifact（不发布 Release）。

## 来源与声明

RelayDesk is a modified and rebranded derivative of [cc-switch](https://github.com/farion1231/cc-switch). The upstream project is licensed under the MIT License; its copyright notice is retained in [LICENSE](./LICENSE).

RelayDesk 是基于 cc-switch 修改并重新命名的衍生项目，与上游作者不存在官方关联。界面中提及的 Claude、OpenAI Codex、Gemini 等名称仅用于描述兼容的第三方工具，不代表与对应厂商存在合作或认证关系。

## 许可证

MIT — 见 [LICENSE](./LICENSE)。第三方组件许可证见 [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md)；Inter 字体见 `src/relaydesk/assets/fonts/Inter-OFL.txt`（SIL OFL 1.1）。
