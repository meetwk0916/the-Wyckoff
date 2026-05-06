# Wyckoff Dashboard Sprint Plan

## Delivery Strategy

The product will be delivered as thin vertical slices. Each sprint must produce a user-visible artifact, supporting documentation, and a bounded test surface.

## Sprint 1: Radar MVP

Goal: ship a usable monitoring dashboard that makes the strategy state visible without depending on live broker or market integrations.

Deliverables:

- Interactive dashboard page in the Vite app
- Watchlist matrix with phase, support/resistance, current price, and risk/reward status
- Alert stream with basic acknowledgement flow
- Top-level metric cards derived from the watchlist state
- Product spec and acceptance test cases in `docs/wyckoff-mvp`

Out of scope:

- Real ptrade data feeds
- Order execution
- Authentication and permissions
- Persistence beyond in-memory seeded state

Exit criteria:

- The MVP page renders as the default app entry
- The watchlist and alert panels are understandable without external explanation
- The UI clearly distinguishes actionable, monitoring, and rejected candidates
- `npm run build` passes

## Sprint 2: Stateful Monitoring

Goal: move from seeded data to strategy-shaped state and user operations.

Deliverables:

- Front-end data contract for `watchlist`, `alerts`, and `system status`
- Repository-level mock API fixtures or local JSON feeds
- Filter bar for phase, signal status, and risk gating
- Symbol detail drawer or panel with state transition timeline
- Persistence for UI interactions such as alert acknowledgement and watchlist filters

Exit criteria:

- MVP no longer depends on hard-coded component-local state only
- Dashboard is navigable for 20-50 symbols without losing clarity
- Test cases expanded to cover filtering and detail inspection

## Sprint 3: Strategy Services Integration

Goal: connect the UI to strategy services before connecting to execution.

Deliverables:

- Back-end endpoints for watchlist snapshot, alert feed, and system health
- Strategy state adapter format aligned to Wyckoff FSM entities
- Polling or streaming update mechanism for dashboard refresh
- Structured audit log view for state transitions and signal rejection reasons

Exit criteria:

- UI reflects back-end state updates without reload
- Audit entries explain why a symbol advanced, stalled, or was rejected
- Error and degraded-mode states are visible in the UI

## Sprint 4: Execution Readiness

Goal: prepare the product for semi-automated or automated trading workflows.

Deliverables:

- Position and order lifecycle panels
- Pre-trade validation display with hard stop, target, and risk/reward gates
- Manual approval actions for trade recommendations
- Integration hooks for ptrade or QMT execution adapters

Exit criteria:

- Users can see recommended trades, approval state, and execution feedback in one place
- Risk vetoes are first-class UI objects, not hidden logs
- Rollout can start in simulation mode before live trading

## Module-to-Sprint Mapping

| Module | Sprint 1 | Sprint 2 | Sprint 3 | Sprint 4 |
| --- | --- | --- | --- | --- |
| Macro Filter & Watchlist | visual only | contract + filters | live service | mature |
| Wyckoff FSM Brain | static states | timeline/detail view | live state adapter | mature |
| L2 Snapshot Validator | placeholder status | placeholder details | partial integration | live integration |
| P&F Risk/Reward Engine | visible outputs | inspectable rules | service-backed | mature |
| Execution Trigger & Orders | none | none | pre-trade display | approval + execution |

## Risks

- The strategy language is richer than the first sprint data model; avoid pretending Sprint 1 is execution-ready.
- A visually strong dashboard can obscure missing service contracts; Sprint 2 must tighten the data model.
- L2 validation is the strategic edge and the most difficult component; do not allow it to block Sprint 1.
