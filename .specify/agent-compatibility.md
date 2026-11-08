# Shared Spec Kit execution

Read this file before executing any Spec Kit skill. Shared project instructions in
`AGENTS.md` and the user's request take precedence over command examples in skills.

## Invocation and tools

- Claude Code: `/speckit-plan <request>`. Codex: `$speckit-plan <request>` or ask by name.
  `$ARGUMENTS` in upstream templates means the actual user request, never a literal
  environment variable or shell substitution. Do not ask the user to repeat available input.
- Run shell scripts with the session's shell tool and explicit arguments. Slash commands
  and `EXECUTE_COMMAND:` output are descriptions, not executable shell commands.
- Hooks are optional infrastructure: none are currently configured. If added, resolve
  each hook to an installed skill or documented executable before calling it. Report
  unavailable mandatory hooks as blockers; do not pretend printed text executed them.
  Hook actions remain limited to the user's authorized task.
- Research can run sequentially. Delegate only when authorized and supported by the
  session. `[P]` marks independent work, not a requirement to spawn agents.
- GitHub operations may use an available connector or `gh`. Verify the repository from
  the Git remote, preserve deduplication, and never create issues in another repository.
  Deduplicate by feature directory plus task ID (IDs repeat between features), using
  an issue-body marker such as `Spec task: specs/001-flux-88-platform#T001`.

## Shared artifacts and quality

Both agents use the same constitution, templates, and feature artifacts. Select the
feature explicitly with `SPECIFY_FEATURE_DIRECTORY=specs/<feature>` when necessary;
branch names and feature directory names are independent. Do not run modifying setup
scripts during read-only reviews: even prerequisite helpers can persist feature state.

Product behavior requires acceptance coverage under the constitution. Generic upstream
"tests optional" examples cannot waive that requirement. Documentation and tooling
maintenance require relevant validation rather than unrelated product tests.

## Integration and upgrades

Spec Kit 1.0.4 has both `claude` and `codex` installed. Claude remains the default for
`integration: auto`; select `codex` explicitly when using the workflow runner with Codex.
Do not switch the repository default merely because another agent is active.

`.agents/skills/` is canonical; run `python3 scripts/sync-agent-skills.py` to regenerate
Claude copies and `--check` to detect drift. Both directories are version controlled.
Upstream install manifests retain their original hashes so `specify integration status`
can identify local customizations. Do not reset these hashes to hide local modifications.

Before a Spec Kit upgrade, use a clean feature branch or disposable checkout, inspect
upstream changes against the canonical skills, reapply shared adapters, regenerate the
Claude copies, and run the drift and smoke checks documented in `docs/agent-workflows.md`.
An upgrade must not restore removed company policies or discard local skill adaptations.

OpenSpec is not configured in this repository. Do not initialize it or generate a second
set of specifications unless the owner explicitly chooses to adopt it.
