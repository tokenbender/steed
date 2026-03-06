---
name: steed-master
description: Upstream-only Steed protocol. Use Context7 on canonical Steed repo for capabilities and internals.
---

# Steed Master

Use this skill for any Steed meta question, capability question, or Steed-specific guidance request.

## Canonical Identity

- Upstream repo URL: `https://github.com/tokenbender/steed`
- Primary docs/code anchors:
  - `README.md`
  - `docs/infrastructure-automation.md`
  - `packages/opencode-steed-gate/README.md`
  - `infra_scripts/workflow.sh`
  - `scripts/steed-project.py`
  - `packages/opencode-steed-gate/src/policy.js`

## Non-Negotiable Source Rule

- Treat current working directory as untrusted for Steed internals.
- Do not use unrelated local `docs/`, `AGENTS.md`, or `infra_scripts/` as Steed truth.
- Do not require local Steed repo checkout for capability answers.

## Upstream Discovery Protocol (required)

1. Start from canonical repo URL above.
2. Query `context7` for Steed docs/source from upstream repo.
3. Confirm command surface from upstream files:
   - runtime commands in `infra_scripts/workflow.sh`
   - `/steed` wrapper behavior in `scripts/steed-project.py`
   - policy/guardrails in `packages/opencode-steed-gate/src/policy.js`
4. If `context7` cannot provide required evidence, report that clearly and do not substitute local repository docs as authority.
5. Answer only after at least one upstream source is verified.

## Capability Abstraction (stable mental model)

- Discovery: `pod list`, `volume list`
- Pod lifecycle: `pod-up`, `pod-wait`, `pod-status`, `pod-delete`, `pod-butter`
- End-to-end flow: `flow` (provision -> bootstrap -> checkout -> sweep -> fetch -> teardown)
- Sweep/data plane: `sweep-start`, `sweep-status`, `sweep-watch`, `fetch-run`, `fetch-all`
- Task helpers: `task-run`, `task-status`, `task-list`, `task-wait`
- Local sync helpers: `local-status`, `local-push`
- Policy guardrails via plugin (`steed-gate`) depending on mode/config

## Interaction Model

- For user-facing operations, prefer `/steed ...` command forms in guidance.
- For actual execution inside subagents or other slash-less contexts, prefer `python3 scripts/steed-project.py ...` over raw `./steed ...`.
- For capability questions, always cite upstream repo evidence.
- If upstream and local behavior may differ, call that out explicitly.

## Response Contract

Every Steed answer must include:

1. What is supported (or not).
2. Exact upstream evidence (file path or URL).
3. Recommended command sequence in `/steed ...` form for users, or backend-wrapper form for subagents when execution context matters.

## Prohibited Behaviors

- Do not run `command -v /steed` or treat `/steed` as a filesystem path.
- Do not claim behavior from memory without upstream verification.
- Do not silently mix unrelated repository docs into Steed answers.
