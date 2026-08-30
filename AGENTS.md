# AGENTS.md

Guidance for coding agents working in this repository.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `dekkmarsvin/tw_doujin_event`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Review-fix loop

Automated review findings are bounded by the ticket that opened the PR. Pass the scope gate before fixing, decline out-of-scope findings on the thread, and stop at the circuit breakers. See `docs/agents/review-loop.md` and ADR-0040.
