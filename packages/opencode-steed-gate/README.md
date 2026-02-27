# opencode-steed-gate

Deterministic policy gate plugin for OpenCode, scoped to Steed workflows.

## What It Enforces

- Steed-scoped mutating actions (`bash`, `edit`, `write`, `task`, `apply_patch`, `todowrite`) are denied by default in manual mode unless a valid signed permit is provided.
- Read-only actions are allowed.
- `flow` autorun can be blocked (`DENY_FLOW_AUTOMATION_BLOCKED`) unless explicitly enabled.
- Non-core Steed commands can be blocked (`DENY_NON_CORE_COMMAND`).
- Denials return machine-readable guidance (`desired_action`) and loop escalation (`DENY_LOOP_TRIPPED`).

## Runtime Files

By default under `${XDG_CONFIG_HOME:-~/.config}/opencode/steed-gate/`:

- `audit/events.jsonl`
- `deny/last-deny.json`
- `deny/deny-events.jsonl`
- `deny/deny-counts.json`
- `permits/permits.used.jsonl`

## Environment Variables

- `STEED_GATE_MODE=manual|auto` (default: `manual`)
- `STEED_GATE_SCOPE_MODE=auto|force|off` (default: `auto`)
- `STEED_GATE_SCOPE_MARKER=.steed-gate-scope` (default marker)
- `STEED_GATE_PERMIT_FILE=/abs/path/permit.json` (default: `.opencode/steed-gate/permit.json` in current project)
- `STEED_GATE_PERMIT_SECRET=<hmac secret>` (optional if secret file is present)
- `STEED_GATE_SECRET_FILE=/abs/path/secret` (default: `${XDG_CONFIG_HOME:-~/.config}/opencode/steed-gate/secret`)
- `STEED_GATE_PERMIT_CLOCK_SKEW_SECS=0`
- `STEED_GATE_ALLOW_FLOW_AUTORUN=0|1`
- `STEED_GATE_DENY_MAX_AUTO_RETRIES=1`
- `STEED_GATE_DENY_LOOP_THRESHOLD=2`
- `STEED_GATE_AUTO_TTL_SECS=900`
- `STEED_GATE_AUTO_MAX_MUTATIONS=8`

## Permit Schema (manual mode)

```json
{
  "step_id": "step-03",
  "tool": "bash",
  "command": "steed checkout",
  "args_sha256": "<sha256 of permit args>",
  "config_sha256": "<optional workflow config sha>",
  "expires_at_epoch": 1767232500,
  "nonce": "step-03-nonce",
  "signature": "<hmac-sha256 hex>"
}
```

Signature payload:

`step_id|tool|command|args_sha256|config_sha256|expires_at_epoch|nonce`

HMAC algorithm: SHA-256.

## Create Permit File

Use the helper script from repo root:

```bash
python3 scripts/create-steed-permit.py \
  --step-id step-03 \
  --command "steed checkout" \
  --config-path "infra_scripts/workflow/default.cfg" \
  --expires-in 900
```

If `STEED_GATE_PERMIT_SECRET` is not set, the script uses `STEED_GATE_SECRET_FILE` or the default global secret file.

Then point the gate at that permit:

```bash
export STEED_GATE_PERMIT_FILE="/Users/tokenbender/Documents/steed/.opencode/steed-gate/permit.json"
```

## Local Install (global plugin dir)

From repo root:

```bash
bash scripts/install-opencode-steed-gate.sh
```

This installs:

- plugin loader: `~/.config/opencode/plugins/steed-gate.js`
- secret file (auto-generated if missing): `~/.config/opencode/steed-gate/secret`
- slash commands:
  - `/steed-gate-init` (creates `.steed-gate-scope` + `.opencode/steed-gate/` in current project)
  - `/steed-permit <exact steed command>` (generates `.opencode/steed-gate/permit.json`)
