# Polymarket 行情接入

市场追踪使用已有 XTracker 周期的官方 `marketLink` 定位事件，不以标题模糊匹配。周期发帖数仍来自 XTracker，独立于行情连接状态。

## 数据来源

- [Gamma 市场发现](https://docs.polymarket.com/market-data/discover-markets)：事件、数量区间、YES/NO 资产映射、状态、成交额、流动性。订阅期间每 60 秒重新读取。
- [CLOB 实时行情](https://docs.polymarket.com/market-data/realtime-data)：`book`、`price_change`、`last_trade_price` 和市场生命周期事件。每 10 秒 PING，35 秒未收到任何消息重连；重连重新接收盘口快照，旧连接的消息丢弃。
- [价格与订单簿](https://docs.polymarket.com/market-data/prices-order-books)：最近成交价初值通过批量 last-trades-prices 读取；每个方向按独立资产查询。历史图使用 `data-api.polymarket.com/v2/prices-history`。

公开数据无需账户、钱包或 API Key。没有交易操作。

## 价格与状态

- 有效双边盘口的中间价 = (买一 + 卖一) / 2。YES、NO 均从各自合约计算；缺少一边、空盘口或交叉盘口显示“—”。
- 首次连接前显示 Gamma 提供的价格快照并标记连接中；实时盘口到达后覆盖快照。
- 每份价格为 0–1 美元。表格以百分比表示中间价，盘口与详情以美分表示价格。它们都不是保证成交的报价。
- 盘口内部保留全部价格档位，浏览器只接收前 8 档并展示前 5 档。数量为零的增量删除该档；旧时间戳不会覆盖新盘口。
- 前端每 350ms 最多接收一次合并更新。网络断开明确显示连接状态，保留的旧报价不会标记实时。独立 SSE 心跳避免冷门市场因没有价格变动被误判离线。
- 历史 API 的实际 timestamp 单位为秒，适配器统一为毫秒，也兼容毫秒输入。按资产和周期缓存 30 秒，图表每 60 秒更新历史并加入最新盘口观测点；明显缺口断开绘制。
- 已结束市场使用官方结束价格，不继续订阅盘口；不把已结束自动等同于可成交。
- 行情与盘口为内存快照，历史曲线取自官方 API。本地 SQLite 持久归档的是 XTracker 推文，不是逐笔行情。

## 运行与检查

沿用 `npm run dev`，Vite 5173 代理本地 API 3001。打开 Chrome 的 http://127.0.0.1:5173/ ，选择“市场追踪”。周期选择使用自定义下拉，已移除重复的大标题区。

2026-10-29 验证：

- 13 项自动测试通过，包括 YES/NO 映射、空值与零值、盘口删除及乱序保护、历史时间单位、重连后盘口替换、旧连接消息丢弃和资源清理。
- 真实 Oct 27–Nov 3 市场 SSE 采样 14 秒：19 次行情消息、1 次独立心跳，44 个双边报价的中间价核对通过；NO 一小时历史返回 57 个点。
- Chrome 实测 Oct 23–Oct 30 / Oct 27–Nov 3 周期切换、YES/NO、1H/1D 走势、盘口和持续更新。标题区删除通过 HMR 生效。
- [运行截图](market-live-preview.jpg)。
