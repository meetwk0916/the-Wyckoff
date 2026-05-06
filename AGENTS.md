# AGENTS

## Project Intent

This repository is an independent Wyckoff Radar MVP workspace. It is not the chat project and it is not a live trading system.

The current product purpose is to turn Wyckoff strategy monitoring into a visible operator console before any real data or execution integration is attempted.

## Read First

1. `README.md`
2. `docs/wyckoff-mvp/PRD.md`
3. `docs/wyckoff-mvp/IMPLEMENTATION-PATH.md`
4. `docs/wyckoff-mvp/MVP.md`
5. `docs/wyckoff-mvp/TEST-CASES.md`

## Current State

- Vite + React single-page dashboard
- Watchlist, filters, alerts, metrics, inspection panel
- Seeded dashboard contract in `src/data/wyckoffMockData.js`
- No backend and no broker integration
- Manual acceptance cases are documented

## Commands

- `npm install`
- `npm run dev`
- `npm run lint`
- `npm run build`

## Working Rules

- Keep the project independent from any other workspace.
- Do not position the product as execution-ready.
- Prefer extracting contract and data-access layers over growing `src/App.jsx` further.
- Update `docs/wyckoff-mvp/TEST-CASES.md` when UI behavior changes.
- Run `npm run lint` and `npm run build` after substantive edits.

## Recommended Next Tasks

1. Replace JS fixture imports with local JSON or a mock API layer.
2. Add automated UI tests for filters, alerts, and inspection selection.
3. Split the page into smaller dashboard components once tests exist.
