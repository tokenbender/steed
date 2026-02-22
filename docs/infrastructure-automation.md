# Steed Infrastructure Automation

This guide covers operating Steed as a standalone orchestrator for any research repository.

## What Steed Automates

Steed runs a full campaign lifecycle:

1. Precheck and config validation
2. Pod/target provisioning and readiness checks
3. Remote bootstrap and repository checkout
4. Sweep launch from CSV manifest
5. Monitoring and status updates
6. Artifact fetch
7. Teardown and flow summary

It uses explicit phase evidence and checklist artifacts so each phase is auditable.

## Architecture

- `steed` is the CLI entrypoint.
- `infra_scripts/workflow.sh` contains implementation.
- `infra_scripts/workflow/<profile>.cfg` is the source-of-truth runtime config model.

Primary operating modes:

- `flow` for one-command end-to-end execution
- individual commands (`pod-up`, `checkout`, `sweep-start`, `fetch-all`, etc.) for manual control

## First-Time Setup

Choose a profile config before first run.

- Default: `infra_scripts/workflow/default.cfg`
- Example: `infra_scripts/workflow/retrieval-sparse-fusion.cfg`
- Select profile with `WORKFLOW_PROFILE=<name>` (for example, `WORKFLOW_PROFILE=retrieval-sparse-fusion`)

Required basics:

- `REPO_URL` - Git URL of the research repository to run
- `OPS_REMOTE_REPO` - remote checkout directory
- target/pod variables (`LIUM_*` or fallback host values)

Recommended safety settings:

- `RUN_TIMEOUT_SECS` and `TASK_TIMEOUT_SECS` to non-zero values
- `WF_DEFAULT_TEARDOWN` based on your workflow (`keep` during debugging, `delete` for clean runs)

## Training Execution Model

Steed supports two execution modes during sweep runs.

1. Default mode (`TRAIN_COMMAND_TEMPLATE` empty)
   - Uses a `torch.distributed.run` command with:
     - `TRAIN_ENTRYPOINT` (default `train.py`)
     - `CONFIG` from sweep CSV
     - key-value args (`out_dir`, optional `data_dir`, `seed`, W&B args, overrides)

2. Template mode (`TRAIN_COMMAND_TEMPLATE` non-empty)
   - Runs your command with `bash -lc`.
   - Available variables:
     - `RUN_ID`, `CONFIG`, `SEED`, `TRAIN_OUT_DIR`, `NPROC_PER_NODE`
     - `DATA_DIR`, `HF_HOME`, `OVERRIDES`
     - `WANDB_LOG`, `WANDB_PROJECT`, `WANDB_GROUP_VALUE`, `WANDB_RUN_NAME`
     - `OPS_REMOTE_REPO`, `VENV_PYTHON`

Use template mode for repos with non-nanoGPT entrypoints or custom launch schemes.

## Sweep Manifest

Generate starter CSV:

```bash
./steed sweep-csv-template
```

Manifest format:

```csv
run_id,config,seed,overrides,notes
baseline-seed0,config/train_baseline.py,0,"max_iters=20 eval_interval=10 eval_iters=5","smoke"
```

## Common Commands

```bash
./steed --help
./steed flow --sweep start --fetch all --teardown delete
./steed sweep-status
./steed sweep-watch
./steed fetch-run <run_id>
./steed fetch-all
```

## Artifacts

By default, local artifacts are stored under `LOCAL_ARTIFACTS_DIR` (default `artifacts/pod_logs`).

Per-run outputs include:

- `status.json`
- `summary.json`
- `stdout.log`
- optional checkpoints

Flow-level artifacts include phase evidence under `_flows/<flow_id>/`.

## Troubleshooting

- Pod startup issues: check `LIUM_GPU`, `LIUM_COUNT`, `LIUM_UP_TIMEOUT_SECS`.
- Sweep stalls: run `./steed sweep-watch`, inspect `stdout.log`, verify tmux sessions.
- Fetch issues: validate remote run directory and local artifact path permissions.
- Checkout failures: verify `REPO_URL`, credentials, and `CHECKOUT_INSTALL_CMD`.

## Notes on Portability

Steed no longer hardcodes project-specific training/data assumptions in config defaults.
Repo-specific behavior should be expressed via:

- `CHECKOUT_INSTALL_CMD`
- `CHECKOUT_POST_CMD`
- `TRAIN_WORKDIR_REL`
- `TRAIN_ENTRYPOINT`
- `TRAIN_COMMAND_TEMPLATE`
