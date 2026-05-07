# Crypto Data Boundary

This directory is for local crypto market captures and replay fixtures.

Do not commit raw market data. The intended local files are append-only JSONL or compressed captures generated during provider validation and replay work.

Expected future file shapes:

- `raw/<provider>/<date>/<stream>.jsonl`
- `normalized/<market>/<date>/<event-type>.jsonl`
- `replay/<scenario-id>.jsonl`

The first committed implementation should write small validation reports to `../reports/`, not large market captures here.
