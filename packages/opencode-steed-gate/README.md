# opencode-steed-gate

Deterministic policy gate plugin for OpenCode, scoped to Steed workflows.

## What It Enforces

- Steed-scoped read-only actions are always allowed.
- In `manual` mode, Steed-scoped mutating actions are allowed step-by-step by default (no permit required).
- Optional hardened mode (`STEED_GATE_REQUIRE_PERMIT=1`) requires valid signed single-use permits for mutating actions.
- `flow` autorun can be blocked (`DENY_FLOW_AUTOMATION_BLOCKED`) unless explicitly enabled.
- Non-core Steed commands can be blocked (`DENY_NON_CORE_COMMAND`).
- Denials return machine-readable guidance (`desired_action`) and loop escalation (`DENY_LOOP_TRIPPED`).

## Runtime Files

By default under `${XDG_CONFIG_HOME:-~/.config}/opencode/steed-gate/`:

- `audit/events.jsonl`
- `deny/last-deny.json`
- `deny/deny-events.jsonl`
- `deny/deny-counts.json`
- `permits/permits.used.jsonl` (used only when permit mode is enabled)

## Environment Variables

- `STEED_GATE_MODE=manual|auto` (default: `manual`)
- `STEED_GATE_SCOPE_MODE=auto|force|off` (default: `auto`)
- `STEED_GATE_SCOPE_MARKER=.steed-gate-scope` (default marker)
- `STEED_GATE_REQUIRE_PERMIT=0|1` (default: `0`; set `1` for hardened permit mode)
- `STEED_GATE_PERMIT_FILE=/abs/path/permit.json` (default: `.opencode/steed-gate/permit.json` in current project)
- `STEED_GATE_PERMIT_SECRET=<hmac secret>` (optional if secret file is present)
- `STEED_GATE_SECRET_FILE=/abs/path/secret` (default: `${XDG_CONFIG_HOME:-~/.config}/opencode/steed-gate/secret`)
- `STEED_GATE_PERMIT_CLOCK_SKEW_SECS=0`
- `STEED_GATE_ALLOW_FLOW_AUTORUN=0|1`
- `STEED_GATE_DENY_MAX_AUTO_RETRIES=1`
- `STEED_GATE_DENY_LOOP_THRESHOLD=2`
- `STEED_GATE_AUTO_TTL_SECS=900`
- `STEED_GATE_AUTO_MAX_MUTATIONS=8`

## Permit Schema (Optional Hardened Mode)

Enable hardened mode first:

```bash
export STEED_GATE_REQUIRE_PERMIT=1
```

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

## Create Permit File (Optional)

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

If `STEED_GATE_REQUIRE_PERMIT` is not set to `1`, permits are not required.

## Local Install (global plugin dir)

From repo root:

```bash
bash scripts/install-opencode-steed-gate.sh
```

This installs:

- plugin loader: `~/.config/opencode/plugins/steed-gate.js`
- secret file (auto-generated if missing): `~/.config/opencode/steed-gate/secret`
- slash command: `/steed` (init/mode/cfg/status/permit)

Project setup can be done either key-by-key or in one shot:

- key-by-key: `/steed cfg set REPO_URL ...`
- one-shot file apply: `/steed cfg apply steed.setup.cfg`

Operational helpers:

- `/steed pods` for local `lium ps` visibility.
- `/steed pod-up` auto-binds target (`LIUM_TARGET=LIUM_POD_NAME`) when target is empty.
