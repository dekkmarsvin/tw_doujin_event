# Review-fix loop

How to act on automated review findings on a pull request without letting the PR grow past the ticket that opened it.

The decision behind these rules, and the incident that produced them, is [ADR-0040](../adr/0040-review-findings-are-bounded-by-the-ticket.md). The threat model referenced below is decision 1 of that ADR: data-operations commands under `scripts/` assume **one maintainer, one sequential command, on a local filesystem**.

## Before triggering a review

Never post a bare `@codex review`. The reviewer compares the diff against the base branch, not against the ticket, so the ticket has to be handed to it explicitly:

```
@codex review — 範圍限 issue #<n>。非目標見該 issue「非目標」段與 ADR-0040 的威脅模型。
超出驗收條件的發現請標記 out-of-scope，不要標 P2。
```

Fill in the real issue number. If the PR closes more than one issue, name them all.

## The scope gate

Answer all three before writing a single line of fix:

1. **Which acceptance criterion does this violate?** Name the checkbox in the ticket, the contract in `docs/contracts/`, or the ADR. "It would be more correct" is not an answer.
2. **Is the assumed failure mode inside the threat model?** Concurrent processes, arbitrary process termination between two renames, and hostile local users are outside it (ADR-0040 decision 1). A finding that only triggers there is out of scope regardless of how it is graded.
3. **Does the fix need a new file, module, or concept?** If yes, it is not a fix for this ticket.

Any "no" on 1–2, or "yes" on 3 → **do not fix**.

## Declining is a normal outcome

Declining must be visible and cheap. On the review thread, state the refusal and its basis:

> 不修：此情境落在 ADR-0040 決策 1 的威脅模型之外（並發執行 / 外部終止），且不對應 #<n> 的任何驗收條件。已記錄於 #<m>。

Then open a follow-up issue with `needs-triage` if the finding is worth keeping, and resolve the thread. Silently ignoring a thread is not declining — it leaves the loop armed.

`wontfix` already exists in this repo's [triage vocabulary](./triage-labels.md); this extends it to review threads.

## Stop conditions

Stop and hand back to the maintainer when **any** of these hold. Do not push another fix first.

- **Three rounds.** A PR has had 3 review-fix rounds.
- **The loop is reviewing its own output.** A finding's `path` points at a file that does not exist on `main`. Check it directly:

  ```bash
  git cat-file -e origin/main:<path> 2>/dev/null || echo "OUT OF LOOP: <path> was created by this PR"
  ```

  A finding against a file this PR invented is a finding against a previous round's fix, not against the ticket.
- **The same subsystem returns.** Three or more findings land on one file or one concern across different rounds, each fix opening the next window. The property being demanded is probably unreachable with the tools at hand; that needs a decision, not another patch.
- **The PR body no longer describes the ticket.** If the Summary needs a new bullet with no counterpart in the issue, the drift is already shipped. Do not rewrite the body to match the code — stop.

## Fixes stay in place

A review-triggered fix edits existing files. It does not add a module, a subsystem, or a new primitive. `scripts/event-onboarding-lock.mjs` was born mid-review-cycle in [#128](https://github.com/dekkmarsvin/tw_doujin_event/pull/128) and drew four further findings of its own; that first new file was the moment to stop.

## Record the boundary in the PR

Fill the `## 範圍邊界` section of the PR template with what the PR deliberately does not do, and why it is not required by the ticket. [#129](https://github.com/dekkmarsvin/tw_doujin_event/pull/129) is the worked example.

This section is for the maintainer and for the next reader. It is not sufficient on its own as a reviewer anchor — the reviewer weights repo docs above PR prose, so a boundary that keeps getting challenged belongs in an ADR.
