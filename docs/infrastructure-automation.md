# Steed Infrastructure Automation

This guide covers the current Steed model: plugin-first policy control with a deterministic runtime backend.

## Control Plane and Data Plane

Steed is split into two layers:

1. **Control plane (OpenCode plugin)**
   - Package: `packages/opencode-steed-gate`
   - Enforces allow/deny before tool execution (`tool.execute.before`)
   - Handles permits, deny reasons, and loop escalation

2. **Data plane (runtime orchestrator)**
   - Entrypoint: `steed`
   - Implementation: `infra_scripts/workflow.sh`
   - Profiles: `infra_scripts/workflow/<profile>.cfg`

In normal operation, the plugin is authoritative for policy. The runtime executes commands and writes artifacts.

## Operating Modes

### 1) Manual mode (default)

- `STEED_GATE_MODE=manual`
- Steed-scoped mutating actions are denied unless a valid signed permit is present.
- One permit is single-use (nonce replay is denied).

### 2) Autonomous mode (bounded)

- `STEED_GATE_MODE=auto`
- Execution is still bounded by:
  - TTL: `STEED_GATE_AUTO_TTL_SECS`
  - Mutation budget: `STEED_GATE_AUTO_MAX_MUTATIONS`
- Optional flow guard: `STEED_GATE_ALLOW_FLOW_AUTORUN=1`.

### 3) Direct runtime invocation

- You can still call `./steed ...` directly.
- Recommended path remains plugin-mediated execution for deterministic gating and audit parity.

## First-Time Setup (Plugin-First)

Install once from this repo:

```bash
bash scripts/install-opencode-steed-gate.sh
```

The installer creates:

- global plugin loader: `~/.config/opencode/plugins/steed-gate.js`
- global secret file: `~/.config/opencode/steed-gate/secret` (auto-generated if missing)
- global slash commands:
  - `/steed-gate-init`
  - `/steed-permit <exact steed command>`

Per project:

1. Run `/steed-gate-init` (creates `.steed-gate-scope` and `.opencode/steed-gate/`).
2. Configure your profile (`REPO_URL`, `OPS_REMOTE_REPO`, `OPS_LOCAL_REPO`, target vars).
3. Generate sweep CSV via `./steed sweep-csv-template`.
4. Generate permit per mutating step via `/steed-permit <exact command>` in manual mode.
   - `/steed-permit` uses the global secret file created by installer unless you override secret env/file.

## Campaign Lifecycle

Steed runtime orchestrates:

1. Precheck and config validation
2. Provision/target readiness
3. Bootstrap and checkout
4. Sweep launch/resume policy
5. Monitoring/wait
6. Fetch policy
7. Teardown and final summary

Use `flow` for end-to-end or individual commands for explicit control.

## Training Execution Model

Steed supports two sweep execution modes:

1. **Default mode** (`TRAIN_COMMAND_TEMPLATE` empty)
   - Uses `torch.distributed.run` with configured entrypoint and CSV fields.

2. **Template mode** (`TRAIN_COMMAND_TEMPLATE` non-empty)
   - Executes custom command via `bash -lc` with variables:
     - `RUN_ID`, `CONFIG`, `SEED`, `TRAIN_OUT_DIR`, `NPROC_PER_NODE`
     - `DATA_DIR`, `HF_HOME`, `OVERRIDES`
     - `WANDB_LOG`, `WANDB_PROJECT`, `WANDB_GROUP_VALUE`, `WANDB_RUN_NAME`
     - `OPS_REMOTE_REPO`, `VENV_PYTHON`

## Artifacts

Default local artifact root is `LOCAL_ARTIFACTS_DIR` (`artifacts/pod_logs` by default).

### Flow-level

- `artifacts/pod_logs/_flows/<flow_id>/flow.state.json` (canonical flow artifact)
  - includes flow metadata, per-phase records, phase events, and final summary
- live checklist file: `infra_scripts/workflow.checklist.md` (reset on flow end by default)

### Run-level

- `status.json`
- `summary.json`
- `stdout.log`
- optional checkpoints

### Policy-level (plugin)

Under `${XDG_CONFIG_HOME:-~/.config}/opencode/steed-gate/`:

- `audit/events.jsonl`
- `deny/last-deny.json`
- `deny/deny-events.jsonl`
- `deny/deny-counts.json`
- `permits/permits.used.jsonl`

## Denials and Recovery

Policy denials are structured and machine-readable. Each deny includes:

- `reason_code`
- `desired_action`
- retry/loop metadata

Repeated identical denials can escalate to `DENY_LOOP_TRIPPED`, requiring explicit human correction.

## Notable Changes from Older Design

- Legacy FSM command surface was removed.
- Legacy split flow artifacts were consolidated into one canonical `flow.state.json`.
- Policy enforcement is now plugin-first, with explicit permit and deny-loop contracts.
