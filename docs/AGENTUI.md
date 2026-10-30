# AgentUI 来源与改动

用户于 2026-10-29 确认将 Vue 3 改为 React，以兼容 AgentUI。
最终栈：Vite 8 + React 19 + TypeScript + Motion + Tailwind CSS 4。

AgentUI 是提供源码复制 / shadcn Registry 安装的 React 组件集合，不是 Vue 组件库，也不是一个名为 `agentui` 的 npm 基础 UI 包。

本项目已从官方页面的 Manual / Copy the source code 接入：

- `src/components/agentui/ReasoningText.tsx`：基于 [Agent Loading States](https://www.agentui.pro/components/agents/loading-states) 的 ReasoningText。用于首次连接、同步和归档加载。保留 aria-live、useId、最长文案占位、cascade / swap、reduced motion。移除未使用的 scramble 分支；用项目图标注入 indicator；把 cn / 通用主题换成项目 CSS。
- `src/components/agentui/SegmentedControl.tsx`：采用 [Usage Dashboard](https://www.agentui.pro/components/agents/usage-dashboard) 的 shared-layout range-selector 实现模式；保留 Motion spring、唯一 layoutId、受控状态与 reduced motion；改为趋势图的柱状 / 折线切换。

没有用 Usage Dashboard 的 token / cost 指标伪装成 Tweets 指标。推文数据、市场核对与图表为本项目领域组件。

核实来源：2026-10-29 官方网页 Manual 代码区。可从上述链接查看原版；本地组件头部保留来源与改动说明。
