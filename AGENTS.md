# AGENTS.md

Guidance for coding agents working in this repository.

## Agent skills

### Project workflow

When triaging issues, choosing the next task, scheduling review follow-ups, or accepting a milestone, read `docs/runbooks/project-workflow.md` for goal-based classification, readiness, and completion evidence. Its section 7 holds the Cloudflare cost baseline, the complexity budget, and the expansion threshold — read it before proposing a cost-motivated change, a new Cloudflare product, or a new scheduled role.

### Issue tracker

Issues live as GitHub issues in `dekkmarsvin/tw_doujin_event`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Domain vocabulary, architecture decisions, and behavioral contracts are located through `docs/agents/domain.md`.

### Review-fix loop

For implementation review, finding disposition, reviewer assignment, verification, and review completion, follow `docs/agents/review-loop.md` as the single rule source.
