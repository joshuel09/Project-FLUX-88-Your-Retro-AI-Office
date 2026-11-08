---
name: github-workflow
description: Track repository changes through an issue, project board, feature branch, and owner-reviewed PR. Use for implementation work, not read-only reviews.
---

# GitHub development workflow

1. Reuse an existing issue or create one describing the approved change. Use an available
   GitHub connector or `gh`. Verify the repository against `git remote get-url origin`.
2. Add the issue to https://github.com/users/joshuel09/projects/4. Set Todo when created,
   In Progress when implementation starts, and Done after the owner merges.
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
6. Give the PR link to the owner for review and merging. Do not merge or close the PR,
   force-push, or delete protected branches. After the owner merges, confirm the issue
   auto-closed and move the project item to Done.

These are repository preferences, shared by both coding agents. No company-specific
command syntax or language requirements apply. Read-only analysis needs no issue or branch.
