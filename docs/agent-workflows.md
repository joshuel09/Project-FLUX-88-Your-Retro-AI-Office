# Shared Claude and Codex workflow

`AGENTS.md` owns shared coding standards. `CLAUDE.md` directs Claude to those standards.
The FLUX runtime constitution is `.specify/memory/constitution.md`; execution differences
are documented in `.specify/agent-compatibility.md`.

## Skills and upgrades

Edit `.agents/skills/<name>/SKILL.md`, then run:

```sh
python3 scripts/sync-agent-skills.py
python3 scripts/sync-agent-skills.py --check
python3 -m unittest discover -s scripts -p 'test_*.py'
```

Claude copies are generated and tracked. CI rejects missing, changed, or unexpected
copies. Local Claude settings and `.codex/` configuration stay ignored.
After upstream Spec Kit upgrades, inspect local customizations reported by
`specify integration status`, reconcile the canonical copies, and regenerate Claude
copies. The installation manifests intentionally retain upstream fingerprints.

Both integrations are installed with Spec Kit 1.0.4. The existing default remains
Claude. For automated workflows choose `integration: codex` or `integration: claude`
explicitly; `auto` follows the repository default, not the currently open coding agent.
Use `/speckit-analyze` in Claude and `$speckit-analyze` (or its name) in Codex.
The same `specs/` artifacts serve both agents. OpenSpec is not installed here.

## Validation and smoke checks

For a read-only review, give both agents the same feature directory and ask for a
spec/plan/tasks consistency report without executing setup scripts or hooks. Compare
requirement references and findings, not prose. Both should use English, the same
constitution, and the same quality requirements. For path resolution, use
`check-prerequisites.sh --json --paths-only` and validate required artifacts separately.
The analysis skill skips all hooks and never persists the selected feature. Regression
tests cover both absent and existing feature state, plus missing task artifacts.

For write smoke checks, copy `.specify`, `.agents`, `.claude/skills`, `AGENTS.md`, and
`CLAUDE.md` to a disposable directory; never exercise generation against existing
feature artifacts. Run the setup helpers with `SPECIFY_FEATURE_DIRECTORY` pointing
to that directory's fixture feature. Check the JSON output and generated artifacts.
Do not run hooks or GitHub issue generation as part of smoke checks.

This migration validates integration registration, skill parity, helper execution,
and disposable generation. Interactive behavior in fresh Claude and Codex sessions
still requires a manual smoke check; file discovery is not proof of model behavior.

## Removed inherited policies

Mandatory translations and company-specific command conventions are excluded. Company
references, the CRYPTREC mandate, and the fixed seven-day dependency restriction were
removed. Secrets protection, input validation, application runtime authorization,
acceptance coverage, issue/branch/PR tracking, automatic review/merge under owner authorization, and attribution preferences
remain project requirements. This migration changes no application approval behavior.

## Automatic PR review and merge

The owner authorizes both coding agents to review and merge PRs for authorized work
without repeated confirmation. Follow `.agents/skills/github-workflow/SKILL.md`: review
and fix findings, wait for checks on the latest head, verify no blocking findings or
explicit holds remain, and merge that exact head. Repository approval requirements
still apply; self-review cannot stand in for a required independent approval. Mark the
linked board item Done only after confirming merge and issue closure. Merge authorization
does not authorize deployment, releases, or bypassing branch protections.
