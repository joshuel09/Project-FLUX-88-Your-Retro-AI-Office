---
name: github-workflow
description: Track repository changes through an issue, project board, feature branch, automatic PR review, and merge. Use for implementation work, not read-only reviews.
---

# GitHub development workflow

1. Reuse an existing issue or create one describing the approved change. Use an available
   GitHub connector or `gh`. Verify the repository against `git remote get-url origin`.
2. Add the issue to https://github.com/users/joshuel09/projects/4. Set Todo when created,
   In Progress when implementation starts, and Done after merge.
   With `gh`, use `gh project item-add 4 --owner joshuel09 --url <issue-url> --format json`
   and `gh project item-edit` with these board fields:
   - Project: `PVT_kwHOAsjgsc4Bqcky`
   - Status field: `PVTSSF_lAHOAsjgsc4Bqckyzhozq1A`
   - Todo: `f75ad846`; In Progress: `47fc9ee4`; Done: `98236657`
3. Create `feature/issue-N-<slug>` or `fix/issue-N-<slug>` from current `main`.
   Preserve unrelated work; use an isolated worktree when another feature is in progress.
4. Implement and validate against the approved spec or maintenance plan. Use Conventional
   Commits with `refs #N` in the body. Follow the identity rules in `AGENTS.md`.
5. Push the feature branch and open a PR with `Closes #N`, a concrete summary, and relevant
   validation. For multiline bodies, use structured connector arguments or `--body-file`.
6. Automatically review the complete diff against the approved requirements. Inspect
   affected callers, authorization, validation, persistence, migrations, and tests as
   relevant. Fix blocking findings on the feature branch and rerun affected checks.
   Record findings, fixes, validation, and remaining limitations in the PR. Label a
   self-review accurately; never claim independent approval or manufacture approvals.
7. Wait for required CI checks on the latest head commit. Recheck PR state, mergeability,
   current head SHA, unresolved review findings, and any explicit hold before merging.
   Review new commits or base changes that affect the result. Merge only the reviewed
   head (for example `gh pr merge N --squash --match-head-commit <sha>`).
8. The owner has explicitly authorized automatic review and merge for this repository.
   When review and checks pass, merge without asking for confirmation again. Respect
   draft PRs and task-specific requests to hold. Never use an admin bypass, force-push
   protected branches, dismiss blocking reviews, or change protection rules to merge.
   If checks fail or approval/protection requirements prevent merging, fix what is
   within scope and report the specific remaining blocker; do not merge around it.
9. Verify the PR merged and its linked issue closed, then move the board item to Done.
   Keep unrelated worktrees and local changes intact. Do not deploy or publish releases
   merely because merge is authorized.

These are repository preferences, shared by both coding agents. No company-specific
command syntax or language requirements apply. Read-only analysis needs no issue or branch.
