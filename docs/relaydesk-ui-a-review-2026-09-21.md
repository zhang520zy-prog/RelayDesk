# RelayDesk A / C 全局 UI 审阅记录

日期：2026-09-21  
状态：代码与本轮 UI 验证完成，等待用户审阅；**不是最终 Handoff**。  
工作区：`/Users/ilaohuyo/Documents/projects/RelayDesk/relaydesk`。本轮没有提交代码，也没有重置、清理或覆盖既有未提交实现。

## 本轮成果

按已确认的 A 方案统一青绿单色渐变、表面与玻璃层次、间距和字体；C 方案用于聚焦登录表单及安装确认。保留 RelayDesk 品牌、rd-\*、现有 Action/Dialog/Switch，不引入 UI 库。

- **视觉基础**：青绿 50–950 色阶；深浅主题独立映射；三个阴影等级；玻璃仅用于页首、登录、筛选、图表和充值分组，普通数据与确认动作保持清楚边界。
- **排版与控件**：12/13/14/16/24/32px 语义字号，400/500/600 字重；普通控件 40px，主动作 44px，主要动作间距 12px。Inter Latin 可变字体随安装包加载，中文使用系统无衬线字体。
- **登录**：账号、密码、提交相邻；注册与找回密码在提交下方；主题和语言集中于顶部；中转站地址弱化到表单末尾。没有添加安全警告面板，没有恢复钥匙串或密码保存。
- **页面布局**：模型中心窄窗摘要两列；钱包金额、支付方式与结算摘要有明确比例；1250px 起图表明细、设置和目标页面采用多列。900px 页面与面板不横向撑宽，详细表格可在独立区域内横向滚动。
- **图表**：Sol、Luna、Terra、Astra 分别使用蓝、紫、橙、玫红；其他模型使用独立分类色。曲线结合线型和圆/方/菱形/三角标记，图例同步。三种图表始终只展示用户选择的一种。
- **确认交互**：安装来源、命令、可能改动位置与环境前提分组展示；取消/确认相邻。重启帮助保留纯说明，未改重启资格、进度或执行逻辑。
- **边界修正**：修正账户页面 grid 默认最小轨道导致的内部横向溢出；短窗口侧栏隐藏次要工作区标语；极长余额换行，必要时侧栏纵向滚动。

## 精确修改文件

下列 renderer 文件与本轮开始前快照比较得到；不把整个工作区的历史未提交改动算作本轮成果。

| 文件                                                       | 本轮修改                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| `src/relaydesk/design/tokens.css`                          | 色阶、主题、字号、间距、图表分类色、阴影和玻璃 token     |
| `src/relaydesk/design/fonts.css`                           | 本地 Inter Latin 可变字体声明与 swap                     |
| `src/relaydesk/assets/fonts/inter-latin-wght-normal.woff2` | 字体文件，48,256 字节                                    |
| `src/relaydesk/assets/fonts/Inter-OFL.txt`                 | SIL OFL 许可                                             |
| `src/relaydesk/design/brand.css`                           | 字体引入、语义字号和字重收敛                             |
| `src/relaydesk/design/polish.css`                          | 全局布局、玻璃分组、控件、各页比例、响应式和最终溢出修正 |
| `src/relaydesk/auth/LoginPage.tsx`                         | 登录前主题选择、信息顺序、标题语义                       |
| `src/relaydesk/account/account.css`                        | 账户、钱包、图表和表格字号/字重统一                      |
| `src/relaydesk/account/UsageCharts.tsx`                    | 稳定线型与标记、图例对应、12px 刻度、可读 tooltip 文本   |
| `src/relaydesk/environment/environment.css`                | 环境及安装区域字号/字重统一                              |
| `src/relaydesk/models/launch.css`                          | 启动询问字号/字重统一                                    |
| `src/relaydesk/models/restart.css`                         | 重启字号/字重统一，修正未定义边框 token                  |
| `src/relaydesk/targets/group-routing.css`                  | 分组映射字号/字重统一                                    |
| `tests/relaydesk/usageCharts.test.ts`                      | 分类色/模型标识行为覆盖                                  |
| `tests/relaydesk/usageCharts.test.tsx`                     | 实际 SVG、图例与筛选/刷新/排序一致性                     |
| `tests/relaydesk/walletUsage.test.tsx`                     | ThemeProvider、登录前主题切换和不触发登录断言            |

文档更新：本记录、设计规范、实施计划、`progress.md` 和历史 `task_plan.md` 的安全策略更正。证据文件位于 `docs/qa-2026-09-21/`。没有新增 API、翻译键或后端业务修改。

本轮快照：`/tmp/relaydesk-ui-a-20260921-103228/relaydesk`（临时目录，不作为长期交付物）。

## 状态与交互验证

| 区域          | 本轮实际验证                                                       | 保留边界                                         |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| 登录          | 空表单禁用；中英文、深浅/系统主题；18 组尺寸组合；本地字体加载     | 不提交真实登录，不保存密码                       |
| 模型中心      | 无新成功操作时重启按钮禁用；帮助说明；普通及极长余额、长模型名     | 不改成功资格与 operationId 状态机                |
| 目标映射      | 三个目标卡、启用/关闭视觉、长中英文分组，单列与三列                | 不改变分组来源、建议或本地覆盖逻辑               |
| 钱包          | 金额选择、支付方式切换、报价更新、付款前确认与取消                 | 未执行创建支付或真实付款                         |
| 用量          | 曲线/柱状/占比切换；4 模型与 12 模型；筛选、指标切换及刷新保持身份 | 数据为明确标注的合成 fixture，非真实账号数据验证 |
| 设置/工具部署 | 六页矩阵中覆盖；环境检查失败如实显示；安装确认/取消                | 未伪造真实环境通过，未安装工具                   |
| 安装 C 弹窗   | 英文深色 900×600 最终尺寸 520×529，无横向溢出；中文浅色也走查      | 未调用安装执行命令                               |

图表前 8 色在浅色表面的计算对比度为 4.67–5.60，深色为 6.49–9.90；扩展色最低非文本对比度仍超过 3:1。此结果是数学检查，不等于完整色觉障碍用户测试。模型超过 8 个时可能出现接近色相，完整名称、线型、标记、数值和筛选共同帮助区分。

## 测试与构建

| 检查                      | 结果                                                     |
| ------------------------- | -------------------------------------------------------- |
| TypeScript                | 通过，exit 0                                             |
| 完整前端单测              | **148 个文件、1274 项全部通过**                          |
| Renderer production build | 通过，exit 0，含本地 WOFF2 字体                          |
| 修改 UI 文件 Prettier     | 通过                                                     |
| `git diff --check`        | 通过                                                     |
| 中英文键集合              | 494 / 494，完全一致                                      |
| 功能页布局矩阵            | **216 组**：6 页 × 3 尺寸 × 2 语言 × 3 主题 × 2 侧栏状态 |
| 登录布局矩阵              | **18 组**：3 尺寸 × 2 语言 × 3 主题                      |
| 全部矩阵结果              | 无页面/面板横向溢出；检查点字体已加载                    |
| 最后修正复查              | 长余额不再横向撑宽；安装弹窗按钮可见                     |
| Rust                      | 本轮未改 Rust，未重跑，不把历史通过结果计作本轮证据      |

执行命令：

```sh
pnpm --config.verify-deps-before-run=warn typecheck
pnpm --config.verify-deps-before-run=warn test:unit --maxWorkers=2 --minWorkers=1
pnpm --config.verify-deps-before-run=warn build:renderer
git diff --check
```

现有 `pnpm-workspace.yaml` 的 `allowBuilds` 包含非布尔占位值，直接运行脚本时自动依赖安装会报 `ERR_PNPM_IGNORED_BUILDS`。本轮使用命令级 `verify-deps-before-run=warn` 运行已有依赖，保留警告，未改动该历史配置。构建仍有既有主 JS chunk 约 1.58MB（gzip 488kB）的体积警告。

矩阵采用 production renderer 和独立 IPC fixture，进行了 DOM 布局测量与代表性截图走查；不是 234 张截图逐像素审查。矩阵后仅修正长金额换行及安装段落间距，并单独复核相应场景。

## 视觉截图与证据

以下图片是浏览器中的实际生产 renderer，**账户、金额、用量与安装计划均为合成验收数据**。截图从完整验收窗口裁剪出应用区域，未修改 UI 内容。

- [中文浅色登录 · 900×600](qa-2026-09-21/review-shots/login-zh-light-900.png)
- [英文深色登录 · 1440×900](qa-2026-09-21/review-shots/login-en-dark-1440.png)
- [模型中心 · 900×600](qa-2026-09-21/review-shots/models-zh-light-900.png)
- [钱包与充值 · 1440×900](qa-2026-09-21/review-shots/wallet-zh-light-1440.png)
- [用量曲线 · 英文深色](qa-2026-09-21/review-shots/usage-en-dark-1440.png)
- [用量柱状图](qa-2026-09-21/review-shots/usage-bars-en-system-1440.png)
- [用量占比图](qa-2026-09-21/review-shots/usage-share-en-system-1440.png)
- [应用目标 · 1440×900](qa-2026-09-21/review-shots/targets-zh-light-1440.png)
- [设置 · 英文深色](qa-2026-09-21/review-shots/settings-en-dark-1440.png)
- [工具部署 · 900×600](qa-2026-09-21/review-shots/deployment-en-dark-900.png)
- [安装确认 · 英文深色 900×600](qa-2026-09-21/review-shots/install-en-dark-900.png)
- [重启纯说明 · 900×600](qa-2026-09-21/review-shots/restart-help-zh-light-900.png)
- [12 模型曲线](qa-2026-09-21/review-shots/usage-many-en-dark-1440.png)

机器可读记录：`layout-matrix.json`、`login-matrix.json`、`chart-identity-browser.json`、`long-values.json`、`install-final-layout.json`、`payment-cancel.json`、`contrast.json`；命令结果见 [validation-results.md](qa-2026-09-21/validation-results.md)。

## 未完成事项与原因

1. **真实 Tauri 操作验收**：本轮仅完成实际 renderer 的合成 UI 验收；未执行真实账户登录、支付、安装、启动或重启。现有开发进程在运行，但本轮 UI 自动化未取得对应 RelayDesk 原生窗口，不能宣称原生端到端通过。
2. **Windows / Linux 原生窗口与发行包**：当前环境为 macOS；未验证其它平台的字体回退、窗口装饰、安装包、签名或公证。
3. **跟随系统的实时 OS 切换**：已选择 system 并验证当前系统浅色解析；未在运行中修改操作系统主题。显式 light/dark 均已验证。
4. **显示缩放与辅助技术**：覆盖三个 CSS 窗口尺寸；未覆盖所有 DPI/缩放比、完整屏幕阅读器流程或色觉障碍用户测试。已有 focus/reduced-motion 样式保留。
5. **完整中文字库**：本轮内嵌 Inter Latin，中文使用平台字体，跨 OS 字形不会完全一致。
6. **安装环境/接口与产品既有状态**：本轮不补写环境医生、重启或支付后端。接口需求继续以 `docs/relaydesk-account-usage-api-requirements-2026-09-20.md` 为准。
7. **工程配置与包体**：上述 pnpm 自动安装配置问题和主 bundle 体积警告保留为独立后续任务。
8. **最终 Handoff**：按用户要求，在用户确认本项可交付之后再生成。本记录仅供本轮审阅。
