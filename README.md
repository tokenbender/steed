# steed

Steed is a deterministic research-infrastructure runtime with a plugin-first policy gate for controlled execution.

## Architecture

Steed is split into two layers:

- Control plane: `packages/opencode-steed-gate` (OpenCode plugin)
- Data plane: `steed` + `infra_scripts/workflow.sh` (runtime executor)

The plugin decides whether an action is allowed. The runtime executes and writes artifacts.

## Quick Start (Plugin-First)

1. Install the plugin and global helper commands:

```bash
bash scripts/install-opencode-steed-gate.sh
```

2. Restart OpenCode so the plugin loader is picked up.

3. Initialize scope in your project:

```text
/steed-gate-init
```

4. Configure a profile in `infra_scripts/workflow/<profile>.cfg`:
   - set `REPO_URL`
   - set `OPS_REMOTE_REPO`
   - set `OPS_LOCAL_REPO`
   - configure target/pod values (`LIUM_*` or fallback host)

5. Generate sweep CSV if needed:

```bash
./steed sweep-csv-template
```

6. In manual mode, generate a permit for each mutating step:

```text
/steed-permit steed checkout
```

The default permit path is `.opencode/steed-gate/permit.json`.
The command uses the installer-managed global secret file by default.

## Runtime Commands

```bash
./steed --help
./steed flow --sweep start --fetch all --teardown delete
./steed sweep-status
./steed sweep-watch
./steed fetch-run <run_id>
./steed fetch-all
```

## Generic Training Hook

If `TRAIN_COMMAND_TEMPLATE` is set, Steed executes it with `bash -lc` and exposes:

- `RUN_ID`, `CONFIG`, `SEED`, `TRAIN_OUT_DIR`, `NPROC_PER_NODE`
- `DATA_DIR`, `HF_HOME`, `OVERRIDES`
- `WANDB_LOG`, `WANDB_PROJECT`, `WANDB_GROUP_VALUE`, `WANDB_RUN_NAME`
- `OPS_REMOTE_REPO`, `VENV_PYTHON`

## Artifacts

- Flow-level canonical artifact:
  - `artifacts/pod_logs/_flows/<flow_id>/flow.state.json`
- Flow checklist:
  - `infra_scripts/workflow.checklist.md` (reset on flow end by default)
- Per-run artifacts:
  - `status.json`, `summary.json`, `stdout.log`
- Plugin policy artifacts:
  - `${XDG_CONFIG_HOME:-~/.config}/opencode/steed-gate/audit/events.jsonl`
  - `${XDG_CONFIG_HOME:-~/.config}/opencode/steed-gate/deny/*`
  - `${XDG_CONFIG_HOME:-~/.config}/opencode/steed-gate/permits/permits.used.jsonl`

## Key Files

- `steed` - CLI entrypoint
- `infra_scripts/workflow.sh` - orchestrator/runtime
- `infra_scripts/workflow/` - profile configs
- `packages/opencode-steed-gate/` - OpenCode policy plugin
- `scripts/install-opencode-steed-gate.sh` - global plugin installer
- `scripts/create-steed-permit.py` - signed permit generator
- `docs/infrastructure-automation.md` - operational guide
- `docs/STEED.md` - manifesto
