---
name: ai-office-task-execution
description: Use when implementing or handing off an AI Office repository task with Codex or Claude Code.
---

# AI Office task execution

Use this shared workflow for substantial implementation tasks in this repository.

1. Read the repository `AGENTS.md` and the relevant issue/task instructions. Reuse the
   existing issue; otherwise follow `.agents/skills/github-workflow/SKILL.md` to create
   one, update the project board, and work on its feature branch.
2. Resolve this repository's project memory with the `obsidian-memory` skill. Retrieve
   only relevant notes, keep AI Office memory separate, and save verified outcomes and
   a concise handoff when the work is complete. Never store secrets.
3. Reuse the existing Spec Kit skills and artifacts when the task calls for them. Read
   `.specify/agent-compatibility.md` first. Invoke skills by name in Codex (for example,
   `$speckit-implement`) or Claude Code (for example, `/speckit-implement`). Do not
   copy their procedures into this skill. OpenSpec is not configured here.
4. Create or update a shared skill in `.agents/skills/` only when the task asks for
   reusable agent instructions. Keep it runtime-neutral and focused on decisions that
   differ between agents. Sync Claude's copy with
   `python3 scripts/sync-agent-skills.py`, then verify with `--check`.
5. Make the smallest complete change, preserve secrets, and run validation required by
   the task and project; do not skip those checks only to save time. Follow the
   repository's commit and PR conventions.
6. Review the resulting PR and wait for required checks. If the user has authorized
   automatic merging for this work, merge only after review finds no unresolved issues
   and all required checks pass; otherwise leave it for the owner to merge.

Keep guidance shared between Codex and Claude. Do not add organization-specific shell
syntax, language sign-offs, or other rules unless the user requests them.
