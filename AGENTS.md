# AGENTS.md

Guidance for coding agents working in this repository.

## Agent skills

### Project workflow

When triaging issues, choosing the next task, scheduling review follow-ups, or accepting a milestone, read `docs/runbooks/project-workflow.md` for goal-based classification, readiness, and completion evidence. Its section 7 holds the Cloudflare cost baseline, the complexity budget, and the expansion threshold — read it before proposing a cost-motivated change, a new Cloudflare product, or a new scheduled role.

Acceptance evidence — screenshots, measurements, dated verification or audit notes — goes on the issue or pull request, never into a new repository document. Section 6 of the same runbook says how to attach screenshots without leaving them on `main`. `docs/design/` holds current specs only, and `docs/design/history/` is frozen.

### Issue tracker

Issues live as GitHub issues in `dekkmarsvin/tw_doujin_event`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Domain vocabulary, architecture decisions, and behavioral contracts are located through `docs/agents/domain.md`.

### Interface copy

Before changing user-facing interface text, read `docs/design/copy.md`. Apply its audience and task boundary to the surface being changed, and keep actions and states consistent with what the user can actually do. Limit copy work to the affected surface; do not expand a copy change into a site-wide rewrite, a new copy framework, or an extra audit process unless the task explicitly requires it.

### Review-fix loop

For implementation review, finding disposition, reviewer assignment, verification, and review completion, follow `docs/agents/review-loop.md` as the single rule source.
