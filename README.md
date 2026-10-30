# MuskTracker

Elon Musk 发帖记录工作台，使用 **Vite + React 19**，接入 AgentUI 源码组件。

## Vercel 与多语言

Vercel 使用 `api/router.ts` 承载 API，Turso 保存云端归档；本地开发继续使用 SQLite。数据库连接通过 Vercel Marketplace 的 Turso Starter 集成配置，使用 `TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN`，凭据只在服务端读取。

界面支持中文、英语、日语、韩语、西班牙语。首次访问通过 `/api/locale` 读取 Vercel 的 `x-vercel-ip-country`：中国及中文地区使用中文，美国使用英语，日本使用日语，韩国使用韩语，西班牙及西语地区使用西班牙语；其他已识别国家默认英语。缺少国家信息时按浏览器语言回退，最终默认英语。手动切换会保存在浏览器，下次访问优先使用，并同步更新 HTML 的 `lang`、日期和数字格式。原始推文保留源文。

Vercel Hobby 的原生 Cron 每天最多执行一次。本项目使用 GitHub Actions 的 `Collect posts` 工作流约每 5 分钟访问 `/api/cron`，再加一个每日 Vercel Cron；有访问时，API 每约 60 秒按需同步。GitHub 的定时任务可能排队或延迟，因此后台频率不是严格保证。两处定时调用使用同一个 `CRON_SECRET`：在 Vercel Production 环境和 GitHub 仓库 Actions Secrets 中分别配置。页面的“数据与同步”显示当前部署的采集频率。

云端同步使用数据库租约和冷却窗口防止跨实例重复执行，未完成的批次不会认证新的覆盖区间或移除旧归档；JSON/CSV 导出分块传输。实时行情的 SSE 在接近函数时限前正常结束，由浏览器自动重连。

`main` 的代码推送由 Vercel Git 集成部署，`Validate` 工作流运行测试和生产构建。预览部署使用独立的数据库分支。

## 本地开发

需要 Node.js 24（使用原生 `node:sqlite`）。

```bash
npm install
npm run dev
```

在 Chrome 打开 http://127.0.0.1:5173 。`npm run dev` 同时启动：

- Vite 前端：127.0.0.1:5173，源文件变更走 Vite HMR。
- Node 采集/API：127.0.0.1:3001，源文件变更由开发启动器轮询后重启（避开系统原生 watch 的 EMFILE 问题）。
- 60 秒一次同步，前端 10 秒自动读取新结果。
- SQLite 保存在 `data/musktracker.sqlite`；关掉浏览器后仍采集，但需保持 Node 进程运行；关掉终端或电脑休眠就无法持续采集。

依赖已用本机 npm 缓存安装，package-lock.json 固定版本。当前 Vite 使用原生 TSX 编译和 HMR accept；未安装 `@vitejs/plugin-react`，改 React 组件会重新挂载，筛选页签/天数通过 sessionStorage 保留。这是 HMR，不保证 React Fast Refresh 的所有状态保留行为。

## 已实现

- 五语响应式工作台：概览、推文记录、市场追踪、数据与同步。
- 今日/区间/日均/归档数量；每日柱形/折线、24 小时分布；点击日期钻取推文。
- 搜索、类型与日期筛选、分页、详情、X 原文链接（仅可靠 platformId 存在时）、CSV/JSON 导出。
- XTracker 官方 tracking 周期和 Post Counter；本地数量并列核对。
- Polymarket 实时行情：按市场周期切换 YES/NO 报价、买一卖一、五档盘口、最近成交价，以及 1H/1D/1W/全部历史走势。
- 官方 CLOB WebSocket 经本地 SSE 推送；心跳、断线重连、旧连接消息隔离和已结束市场状态。详见 [docs/POLYMARKET.md](docs/POLYMARKET.md)。
- 当前市场最终发帖数的统计预测、80% 预测区间、各数量档模型概率和独立历史回测；数据不完整或官方计数不一致时暂停预测。详见 [docs/FORECAST.md](docs/FORECAST.md)。
- 原始响应、首见/末见时间、内容修订和源端已移除记录的持久归档。
- 原生 Node SQLite 去重事务、48 小时重叠同步、每天切片的历史补齐；大于等于 100 条的切片继续二分。
- 每小时全量 posts 与用户 `_count.posts` 核对；只有总量相符才记全量核对通过。全量响应不相符时继续按日期回填。
- AgentUI 官方源码适配的 ReasoningText 和共享布局切换器，见 [docs/AGENTUI.md](docs/AGENTUI.md)。

## 口径与边界

来源：[XTracker 官方 API](https://xtracker.polymarket.com/docs)。API 返回的 Posts 是本项目归档对象，**不保证覆盖 Musk 所有不计入市场的 X 回复**。官方 tracking 总量是页面展示的官方计数；本地数相同仅表明当前快照数量相符，不代表已经由 Polymarket 最终结算。

自然日默认为 `America/New_York`，按夏令时自动换算。可切换 UTC。市场周期始终使用源端 UTC 起止时间，不从自然周推算。

未同步区间使用 null/“—”，不当成 0；获取到完整切片后，零发帖才记 0。今日与日均含未结束的今天，界面明确标出。

API 文档未列出 posts 字段完整 schema、所有截断/分页规则或删除语义。适配器目前验证稳定 id、createdAt、列表响应和日期边界，保存所有 raw 字段；未知 type 保持“未分类”，不凭 RT 文本猜分类。真实 API 已完成联调；字段缺失和源端完整性边界仍按上述规则保留。连续切片响应数量低于 100 并非严格的源端无截断证明；全量记录数与官方 tracking 核对用于发现差异。

不提供下注、钱包或交易功能。

## 验证

```bash
npm test
npm run build
```

`server/domain.test.ts` 验证夏令时 23/25 小时、午夜归属、输入验证、幂等导入、被移除记录留档、覆盖区间的毫秒级缺口、跨天断网不误报完整日、重复同步不缩短覆盖区间与 CSV 公式防护（共 7 项测试）。

当前共 28 项测试，覆盖国家语言优先级、五语词条与参数完整性、云端归档、数据库租约、HTTP SQL 协议、导出和采集鉴权，以及预测分布、未来数据隔离、区间概率及质量门槛。

2026-10-29 已完成真实 XTracker / Polymarket API 联调、Chrome 本地页面和 HMR 检查。13 项测试覆盖原有归档逻辑、市场排序、行情资产映射、盘口增量与删除、乱序消息、历史时间单位及 WebSocket 重连。行情实测和截图见 [docs/POLYMARKET.md](docs/POLYMARKET.md)。

## 本地 API

- `GET /api/dashboard?days=30&timezone=America/New_York`
- `GET /api/posts?days=30&q=&type=all&page=1&size=20&archive=false`
- `GET /api/export?format=csv` 或 `format=json`，使用与 posts 一致的筛选参数
- `GET /api/health`
- `GET /api/forecast?tracking=:trackingId`
- `GET /api/locale`
- `GET /api/cron`（定时采集，必须提供 `Authorization: Bearer CRON_SECRET`）
- `GET /api/runs`
- `GET /api/markets/:trackingId`
- `GET /api/markets/:trackingId/stream`（SSE）
- `GET /api/markets/:trackingId/history?asset=:assetId&interval=1d`
- `POST /api/sync`

`from`/`to` 格式 YYYY-MM-DD，会覆盖默认日期范围。最多查询 366 天。本地服务仅监听 loopback；Vercel 的读取 API 公开提供源数据，数据库凭据仅在服务端读取，后台采集入口通过密钥校验。
