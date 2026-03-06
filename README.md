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

This installs a self-contained Steed bundle into `~/.config/opencode/steed-gate/` with plugin wiring, `/steed` command wiring, bundled runtime/scripts, MCP entries (`websearch`, `context7`, `grep_app`), and bundled skills (`playwright`, `git-master`, `steed-master`).

2. Restart OpenCode so the plugin loader and bundled plugin copy are picked up.

3. Initialize Steed in your project:

```text
/steed init
```

4. Configure workflow values (no env required):

```text
/steed cfg set REPO_URL https://github.com/org/repo.git
/steed cfg set OPS_REMOTE_REPO /workspace/repo
/steed cfg set OPS_LOCAL_REPO ~/work/repo
```

Or apply everything at once from a cfg file:

```text
/steed cfg apply steed.setup.cfg
```

Optional profile switch:

```text
/steed profile retrieval-sparse-fusion
```

5. Check readiness:

```text
/steed status
/steed self --json
/steed self --check-remote --json
```

This validates missing required workflow keys and shows next steps.

6. Generate sweep CSV if needed:

```bash
./steed sweep-csv-template
```

7. Choose execution mode:

```text
/steed mode manual
```

or

```text
/steed mode auto
```

8. Run Steed commands directly (single-step or full autonomy):

```text
steed checkout
steed flow --sweep start --fetch all --teardown delete
```

Optional hardened mode (signed permit per mutating step):

```text
/steed permit-mode on
/steed permit steed checkout
```

Equivalent env toggle if needed:

```bash
export STEED_GATE_REQUIRE_PERMIT=1
```

`/steed` writes project-local gate config at `.opencode/steed-gate/config.json`.
`/steed cfg apply` accepts `KEY=VALUE` lines and applies both gate keys (mode/permit/profile/etc.) and workflow keys.

Reference workflow cfg file remains `infra_scripts/workflow/<profile>.cfg`:

  - set `REPO_URL`
  - set `OPS_REMOTE_REPO`
  - set `OPS_LOCAL_REPO`
  - configure target/pod values (`LIUM_*` or fallback host)

Default permit path is `.opencode/steed-gate/permit.json`; `/steed permit ...` uses the installer-managed global secret file.

## Runtime Commands

```bash
./steed --help
./steed pod list
./steed volume list
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
  - `${XDG_CONFIG_HOME:-~/.config}/opencode/steed-gate/permits/permits.used.jsonl` (hardened permit mode)

## Key Files

- `steed` - CLI entrypoint
- `infra_scripts/workflow.sh` - orchestrator/runtime
- `infra_scripts/workflow/` - profile configs
- `packages/opencode-steed-gate/` - OpenCode policy plugin
- `scripts/install-opencode-steed-gate.sh` - global plugin installer
- `scripts/create-steed-permit.py` - signed permit generator (optional hardened mode)
- `docs/infrastructure-automation.md` - operational guide
- `docs/STEED.md` - manifesto
