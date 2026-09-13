# AGENTS.md

Guidance for coding agents working in this repository.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `dekkmarsvin/tw_doujin_event`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Domain vocabulary, architecture decisions, and behavioral contracts are located through `docs/agents/domain.md`.

### Review-fix loop

Automated review findings are bounded by the ticket that opened the PR. `docs/agents/review-loop.md` owns scope checks, authorized fixes, disposition, and circuit breakers under ADR-0040.
