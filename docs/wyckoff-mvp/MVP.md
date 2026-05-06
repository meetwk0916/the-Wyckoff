# Sprint 1 MVP Spec

## Objective

Create the smallest useful front-end artifact that proves the product shape for the Wyckoff radar workflow.

The MVP is successful if a stakeholder can open the page and answer these questions quickly:

1. Which symbols are being monitored?
2. Which symbols are close to action?
3. Which symbols are blocked by risk/reward or incomplete confirmation?
4. What signals need human attention right now?

## Users

- Strategy owner validating the product direction
- Research or trading operator reviewing candidate symbols
- Engineer aligning future back-end contracts to visible UI objects

## Included Scope

### Screen Structure

- Header with product identity, sprint badge, and simulated system status
- Metric cards summarizing monitoring load and candidate quality
- Watchlist matrix listing symbol, phase, support/resistance, price/volume, and risk/reward
- Alert stream showing signal type, time, summary, and acknowledgement action
- Delivery notes panel that makes the Sprint 1 limits explicit

### State Model

The page will use seeded data that mimics the future service contract.

Required watchlist fields:

- `symbol`
- `name`
- `phase`
- `subPhase`
- `support`
- `resistance`
- `currentPrice`
- `volumeState`
- `riskReward`
- `targetPrice`
- `status`

Required alert fields:

- `id`
- `time`
- `type`
- `symbol`
- `message`
- `acknowledged`

### User Interactions

- Filter by phase
- Filter by signal state
- Acknowledge an alert
- Simulate dashboard refresh timestamp

## Explicitly Excluded

- Login
- Real market data
- Broker connectivity
- Back-end storage
- Live notification delivery
- Automated testing harness beyond documented acceptance cases

## Acceptance Criteria

### AC-1 Page Access

- Opening the app shows the dashboard.

### AC-2 Watchlist Comprehension

- Each row exposes enough information to understand phase, structure, and gating.
- Actionable symbols are visually distinct from monitoring-only and rejected symbols.

### AC-3 Alert Workflow

- Alert cards can be acknowledged.
- Acknowledged state persists within the current session view.

### AC-4 Derived Metrics

- Metric cards reflect the seeded watchlist state rather than fixed decorative numbers.

### AC-5 Sprint Transparency

- The page clearly states that ptrade, live data, and execution are not yet wired.

## Engineering Notes

- Sprint 1 stays single-page and front-end only.
- Reuse existing React and `lucide-react` dependencies.
- Keep the seeded state isolated so it can be replaced by service data in Sprint 2.
