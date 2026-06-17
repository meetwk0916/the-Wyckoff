# MiniQMT 验证日志

## 2026-05-13 初始化

本次只做 workspace 初始化，不连接真实 MiniQMT / QMT 客户端。

已完成：

- 新建 `feature/miniqmt-wyckoff-workspace` 分支。
- 新建 `docs/miniqmt-wyckoff/` 文档入口。
- 新建 `miniqmt-workspace/` 独立工作区。
- 明确 MiniQMT 路线优先使用 XtQuant 外部 Python 适配器。
- 明确共享文件 / DBF / CSV 只作为执行 fallback，不作为主行情通道。

当前未验证：

- Windows 侧 MiniQMT / QMT 客户端是否已安装。
- XtQuant Python 包是否可用。
- userdata 路径是否正确。
- 账号状态、行情订阅、L2、逐笔委托、逐笔成交、交易回报是否可读。

下一次验证命令应在 Windows 侧执行，目标不是下单，而是输出 `ADAPTER-CONTRACT.md` 中的 `health` 事件。

## 2026-06-17 离线可验证管线 + Windows 适配器脚本就绪

本次把 MiniQMT 方向从「仅文档」推进到「可验证阶段」，分两条轨道。完整背景见
`docs/REVIEW-AND-MINIQMT-PLAN.md`。

### 轨道 A：离线可验证管线（本机已跑通，不依赖券商）

新增 `miniqmt-workspace/src/`（纯 Node，无第三方依赖），复刻 crypto Phase C 的
evidence-first 纪律，并内置审查中建议的「前瞻证伪契约」与「dumb baseline 对照」。

已验证命令与结果（`node miniqmt-workspace/src/run*.mjs` 顺序执行；npm 脚本见
`package.json` 的 `miniqmt:*`）：

- `miniqmt:contract:validate`：校验 `fixtures/recordings/*.jsonl` 符合 `ADAPTER-CONTRACT.md`，并拦截凭据字段。通过。
- `miniqmt:evidence`：3 个 A 股 seed 窗口，inputsReady=3，fullSensorReady=1。
- `miniqmt:classify`：spring_candidate=1、reaction_failure=1、insufficient_evidence=1、upthrust_risk=0。
- `miniqmt:outcome`：在 held-out K 线上评估证伪契约。gate 命中率 1.0 vs baseline 0.667，edge=+0.333。
- `miniqmt:verify`：钉死三窗口标签 + spring 的 held-out target_hit + reaction 的 baseline invalidated。通过。

要点：
- `ashare-no-l2-600570` 与 spring 结构相同但无 L2 权限，被正确降级为 `insufficient_evidence`，落实「缺 L2 不得伪装成微观确认」硬闸门。
- 所有分类对象 `emitsTradeAction:false / requiresHumanReview:true`，不输出交易动作。

### 轨道 B：Windows 真实客户端脚本（待你在 Windows 跑）

新增 `miniqmt-workspace/adapter/`（Python 标准库 + XtQuant，全部带 `--mock`）：

- `lib_contract.py`：事件构造、symbol 归一、账号脱敏、append-only 落盘、凭据守卫。
- `health_check.py`（Phase 0）、`quote_capture.py` / `order_flow_capture.py`（Phase 1）、`paper_trade_probe.py`（Phase 3，模拟盘、`--arm-live` 被拒绝）、`replay_export.py`（把录制导出为轨道 A fixture）。

本机未安装 Python，故 Windows 真实路径仍未跑过。下一步在 Windows 执行：

```
python miniqmt-workspace/adapter/health_check.py --mock        # 先确认契约输出
python miniqmt-workspace/adapter/health_check.py --userdata "C:/path/userdata_mini" --account <id>
```

当前仍未验证（需 Windows + 账号权限）：

- MiniQMT/QMT 客户端安装、登录、userdata 路径、XtQuant 导入。
- 真实行情、L2、逐笔委托/成交权限。
- 模拟盘委托/成交/撤单/持仓/回报闭环与次日对账。

### 2026-06-17 补充：本机实跑确认（非真机券商部分）

在本机实际执行（非仅设计），结果如下：

- 前端基线：`npm install` → `eslint .`（exit 0，无告警）→ `vite build`（exit 0，dist 产物正常）。
- 轨道 A 管线：`contract:validate → evidence → classify → outcome → verify` 全绿；`spring=1 / reaction=1 / insufficient=1`，gate 命中率 1.0 vs baseline 0.667，edge=+0.333。
- 轨道 B 适配器（便携 Python 3.12 实跑 `--mock`）：`health_check` / `quote_capture` / `order_flow_capture` / `paper_trade_probe` 均输出契约合规事件并 exit 0；`--arm-live` 与非 100 整数手被正确拒绝；Python 生成的录制通过 Node 契约校验器；`replay_export.py` 导出的 fixture 端到端流入 Node 管线（薄录制被保守判为 `reaction_failure`，符合预期）。
- 仍未触达：真实 MiniQMT/QMT 客户端、L2/逐笔权限、模拟盘真机回报闭环（需 Windows + 账号权限）。

