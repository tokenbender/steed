# Steed Infrastructure Automation

This guide covers the current Steed model: plugin-first policy control with a deterministic runtime backend.

## Control Plane and Data Plane

Steed is split into two layers:

1. **Control plane (OpenCode plugin)**
   - Package: `packages/opencode-steed-gate`
   - Enforces allow/deny before tool execution (`tool.execute.before`)
   - Handles policy decisions, optional permits, deny reasons, and loop escalation

2. **Data plane (runtime orchestrator)**
   - Entrypoint: `steed`
   - Implementation: `infra_scripts/workflow.sh`
   - Profiles: `infra_scripts/workflow/<profile>.cfg`

In normal operation, the plugin is authoritative for policy. The runtime executes commands and writes artifacts.

## Operating Modes

### 1) Manual mode (default)

- `STEED_GATE_MODE=manual`
- Steed-scoped mutating actions are allowed step-by-step by default.
- No permit is required unless hardened mode is enabled.
- Optional hardened mode: `STEED_GATE_REQUIRE_PERMIT=1`.
- In hardened mode, permits are single-use (nonce replay is denied).

### 2) Autonomous mode (bounded)

- `STEED_GATE_MODE=auto`
- Execution is still bounded by:
  - TTL: `STEED_GATE_AUTO_TTL_SECS`
  - Mutation budget: `STEED_GATE_AUTO_MAX_MUTATIONS`
- Optional flow guard: `STEED_GATE_ALLOW_FLOW_AUTORUN=1`.

### 3) Direct runtime invocation

- You can still call policy-approved raw runtime validation commands directly for status/list/health checks.
- Backend wrapper commands (`python3 scripts/steed-project.py ...`) are also allowed and are the preferred direct execution path for subagents or other slash-less contexts.
- Recommended path remains `/steed ...` for user-facing execution because it keeps intent and continuation handling explicit.

## Mental Model

### Shared control flow

```text
Human/Agent proposes action
           |
           v
steed-gate plugin (tool.execute.before)
  |- scope check (Steed-scoped v1)
  |- policy class classification (validation vs workflow-changing)
  |- mode policy (manual step-wise or auto budget/ttl)
  |- allow OR structured deny
           |
   +-------+-------+
   |               |
 ALLOW           DENY
   |               |
   v               v
tool executes   no execution
   |            deny payload + audit
   v
runtime backend writes artifacts
```

### Manual mode (default, step-wise)

```text
STEP_REQUESTED
      |
      | proposed action
      v
policy checks
      |
   +--+--+
   |     |
pass   fail
   |     |
   v     v
ALLOW   DENY -> desired_action
```

### Manual mode (optional hardened permits)

```text
export STEED_GATE_REQUIRE_PERMIT=1

WAITING_FOR_PERMIT
      |
      | /steed permit <exact steed command>
      v
PERMIT_READY
      |
      | mutating action
      v
gate verifies: tool, command, args hash, optional config hash,
               expiry, signature, nonce replay
      |
   +--+--+
   |     |
 pass   fail
   |     |
   v     v
ALLOW   DENY -> desired_action
   |
   v
nonce consumed (single-use)
```

### Autonomous mode (bounded)

```text
WINDOW_OPEN (ttl + mutation budget)
      |
      | proposed mutating action
      v
checks: scope/core command/flow policy/ttl/budget
      |
   +--+--+
   |     |
 pass   fail
   |     |
   v     v
ALLOW   DENY (expired/budget/policy)
   |
   v
mutation_count += 1
```

## First-Time Setup (Plugin-First)

Install once from this repo:

```bash
bash scripts/install-opencode-steed-gate.sh
```

The installer creates:

- global plugin loader: `~/.config/opencode/plugins/steed-gate.js`
- global secret file: `~/.config/opencode/steed-gate/secret` (auto-generated if missing)
- global slash command: `/steed`

Per project:

1. Run `/steed init` (creates `.steed-gate-scope` and `.opencode/steed-gate/`).
2. Configure workflow values with `/steed cfg set ...` (`REPO_URL`, `OPS_REMOTE_REPO`, `OPS_LOCAL_REPO`, target vars), or apply a full cfg file with `/steed cfg apply <file>`.
3. Check readiness with `/steed status`.
4. Generate sweep CSV via `./steed sweep-csv-template`.
5. Optional (hardened mode): generate permit per mutating step via `/steed permit <exact command>`.
   - Needed only when `STEED_GATE_REQUIRE_PERMIT=1`.
   - `/steed permit` uses the global secret file created by installer unless you override secret env/file.

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

Steed convenience behavior via `/steed` command:

- `/steed self --json` returns dynamic Steed project/repo/version/docs references.
- `/steed self --check-remote --json` compares installed commit with remote default branch.
- `/steed pods` maps to runtime `pod list` (active pods + rentable executors).
- `/steed volumes` maps to runtime `volume list`.
- `/steed pod-up` auto-sets `LIUM_TARGET` to `LIUM_POD_NAME` when target is empty, then prints `lium ps`.

Subagent/backend equivalents:

- `python3 scripts/steed-project.py <args>` is the backend equivalent of `/steed <args>`.
- Prefer that backend form when a subagent cannot invoke slash commands directly.
- Keep raw `./steed ...` usage mainly for runtime-native validation/list/status operations.

Steed runtime discovery commands:

- `./steed pod list` (or `./steed pod-list`) lists active pods and rentable executors without requiring workflow config.
- `./steed volume list` (or `./steed volume-list`) lists available volumes without requiring workflow config.

### One-file configuration apply

`/steed cfg apply <file>` reads `KEY=VALUE` lines and applies both:

- gate keys (`mode`, `require_permit`, `profile`, `allow_flow_autorun`, `auto_ttl_secs`, `auto_max_mutations`, `scope_mode`)
- workflow keys (written into `infra_scripts/workflow/<profile>.cfg`)

Example:

```text
/steed cfg apply steed.setup.cfg
```

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
  - present/used when hardened permit mode is enabled

## Denials and Recovery

Policy denials are structured and machine-readable. Each deny includes:

- `reason_code`
- `desired_action`
- retry/loop metadata

Repeated identical denials can escalate to `DENY_LOOP_TRIPPED`, requiring explicit human correction.

```text
DENY
 |
 +-> fingerprint(reason_code|tool|command|args_sha|config_sha)
 |
 +-> count[fingerprint] += 1
       |
       +-> count <= threshold -> retriable deny with desired_action
       |
       +-> count > threshold  -> DENY_LOOP_TRIPPED
                                 desired_action=ESCALATE_TO_HUMAN
```

## Notable Changes from Older Design

- Legacy FSM command surface was removed.
- Legacy split flow artifacts were consolidated into one canonical `flow.state.json`.
- Policy enforcement is now plugin-first, with step-wise manual mode and optional hardened permits.
