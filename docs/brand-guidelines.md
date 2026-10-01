# RelayDesk Brand Guidelines

> 适用范围：RelayDesk 桌面客户端（`src/relaydesk/**`）、发布物料与文档。
> Token 源：`src/relaydesk/design/tokens.css`；可导出副本：`assets/design-tokens.json`。

## 1. 品牌定位

RelayDesk 是一个"中转站 → 本地 AI 工具"的桥接桌面端：登录中转站 → 看余额/分组/模型 → 一键应用到 Claude Code、Codex、Gemini CLI。品牌气质：**安静、可靠、工具感**——不炫技，让用户扫一眼就完成操作。

- 产品名固定写作 **RelayDesk**（一个驼峰词），不拆写、不缩写为 RD
- 文档和用户面 UI 不出现 `cc-switch` / `ccswitch` 字样；与上游项目的隔离是品牌要求，不是可选项

## 2. 标志资产

- 主标识：`src/relaydesk/design/` 下的 `relaydesk-mark`（青绿圆角方形 + 中继路径图形），打包输出 `assets/relaydesk-mark-*.png`
- 使用规则：最小尺寸 16px；深/浅背景通用（标志自带底色）；不要旋转、拉伸、加阴影
- 图标规范：**`src/relaydesk/` 内一律用 `lucide-react`**；旧 `@/components` 的自绘 `ProviderIcon` 只留在遗留页面，新代码不得引入

## 3. 颜色

品牌主色为青绿（teal）单色阶 `teal-50 … teal-950`，见 `tokens.css` / `design-tokens.json`。

语义色（浅色主题值，深色见同名 token）：

| 语义 | 浅色 | 用途 |
|---|---|---|
| `action` / `teal` | `#126555` | 主按钮、选中态、聚焦色 |
| `success` | `#16704e` | 已同步、检测通过 |
| `warning` | `#8b571b` | 待同步、可选未安装 |
| `danger` | `#ba3449` | 失败、删除、会话过期 |
| `muted` | `#536b62` | 次级文本、禁用 |

规则：

- 状态色只用语义 token（`var(--rd-success)` 等），禁止直接写 `#xxx`
- 状态底色一律 `color-mix(in srgb, <语义色> 8%, var(--rd-raised))`，边框 25–30% 混合
- 图表色用 `--rd-chart-1..8`，超过 8 条曲线循环使用，深浅主题各一套

## 4. 排版与间距

- 字体：`RelayDesk Inter`（本地打包）+ 系统栈回退；中文走 PingFang/雅黑
- 字号档位：`caption 12 / control 13 / body 14 / section 16 / title 24 / stat 32`
- 字重：400 正文 / 500 次级强调 / 600 标题与数字
- 间距阶梯 `4/8/12/16/20/24/32`；控件高 40px、主操作按钮 44px、圆角控件 10px / 面板 18px
- 页面内容最大宽 1180px

## 5. 组件与交互约定

- 侧栏：静态导航，**不加 hover 位移/缩放动画**；选中项用背景+左边条区分；折叠态靠 `title` 提示
- 卡片：白面 + 1px 线框 + 轻阴影；聚焦卡用 teal 边框 + `color-mix` 光晕（参考 `.rd-target-card.is-focus`）
- 加载：`rd-spin` 旋转器 / `rd-boot-skeleton` 骨架，必须配 `role="status"`；`prefers-reduced-motion` 下动画自动关闭
- 焦点：`outline: 2px solid var(--rd-focus); outline-offset: 2px`——所有可交互元素必须可见焦点
- 文案：中文简短动词（"应用目标""在终端恢复"），英文同步走 `en.json`；i18n key 必须双语言同时存在

## 6. 语气（Voice）

- 面向"会用 AI CLI 但不一定是工程师"的用户：提示要可操作（"请先安装应用安装程序"），不要只抛错误码
- 错误文案三要素：发生了什么 → 影响是什么 → 下一步怎么做
- 不吹嘘、不用感叹号收尾、不用 emoji

## 7. 未完成事项（后续沉淀）

- 图标库统一（`ProviderIcon` 自绘 vs lucide）待遗留页面清理后收口
- 组件级状态表（button/input 全状态）暂以 `assets/design-tokens.json` 的 `component` 节为准
- 品牌 MASTER 设计记忆文档待设计系统稳定后生成
