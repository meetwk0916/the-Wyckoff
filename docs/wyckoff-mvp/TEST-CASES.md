# Wyckoff Dashboard Test Cases

## Test Strategy

The current set covers Sprint 1 behavior plus the first Sprint 2 inspection slice. Automated coverage can be added later, but these cases define the required behavior now.

## Acceptance Cases

### TC-001 Dashboard Render

Precondition: dev server is running.

Steps:

1. Open the app root.
2. Observe the page shell and content.

Expected:

- Wyckoff MVP dashboard is shown.
- The page includes metric cards, watchlist matrix, alert stream, and MVP scope notes.

### TC-002 Phase Filter

Precondition: dashboard is open.

Steps:

1. Change the phase filter to `Phase D`.
2. Observe the table.
3. Reset the filter to `All phases`.

Expected:

- Only `Phase D` rows remain while the filter is active.
- Reset restores the full table.

### TC-003 Status Filter

Precondition: dashboard is open.

Steps:

1. Change the signal filter to actionable candidates.
2. Observe the table.

Expected:

- Only actionable rows remain.
- Risk-blocked and monitoring-only rows are excluded.

### TC-004 Alert Acknowledgement

Precondition: dashboard is open and at least one unacknowledged alert exists.

Steps:

1. Click the acknowledgement action on an alert.

Expected:

- The alert changes to acknowledged state.
- The action no longer appears available for the same alert.

### TC-005 Metric Consistency

Precondition: dashboard is open.

Steps:

1. Count actionable rows in the current filtered state.
2. Compare with the summary metric.

Expected:

- Summary metrics align with the visible state model.

### TC-006 Simulated Refresh

Precondition: dashboard is open.

Steps:

1. Trigger the refresh action.

Expected:

- The last-updated timestamp changes.
- No page crash occurs.

### TC-007 Symbol Inspection Panel

Precondition: dashboard is open.

Steps:

1. Click a visible symbol row in the watchlist matrix.
2. Observe the inspection panel on the right side.
3. Change the filters so another symbol becomes the primary visible candidate.

Expected:

- The inspection panel switches to the selected symbol.
- The panel shows thesis, entry zone, stop, confidence, and state timeline.
- If the selected symbol is filtered out, the panel falls back to the next visible candidate.

### TC-008 MVP Scope Guardrail

Precondition: dashboard is open.

Steps:

1. Review the delivery notes or scope section.

Expected:

- The UI clearly says this is a monitoring MVP.
- It explicitly marks live ptrade integration and auto-trading as deferred.

## Regression Checks for Each Future Sprint

- App root still renders the dashboard.
- Build succeeds with `npm run build`.
- Symbol inspection stays synchronized with the current watchlist selection.
- New filters or panels do not hide risk veto information.
