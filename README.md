# steed

Steed is a standalone research-infrastructure orchestrator.

It manages the full lifecycle for experiment campaigns:

- provision/attach compute target
- bootstrap + checkout a research repo
- launch sweep runs from CSV
- monitor progress and collect artifacts
- teardown and summarize with phase evidence

This repo is intentionally generic and can be used with any research repository.

## Quick Start

1. Choose/edit a profile config in `infra_scripts/workflow/<profile>.cfg`.
   - Default profile: `infra_scripts/workflow/default.cfg`.
   - Example profile: `infra_scripts/workflow/retrieval-sparse-fusion.cfg`.
   - Set `REPO_URL` to your research repo.
   - Set `OPS_REMOTE_REPO` to remote checkout path.
   - Adjust pod settings, timeouts, and artifact paths.

2. Configure training execution.
   - Set `TRAIN_WORKDIR_REL` (relative path under `OPS_REMOTE_REPO`).
   - Optionally set `TRAIN_COMMAND_TEMPLATE` for arbitrary training entrypoints.

3. Create a sweep manifest:

```bash
./steed sweep-csv-template
```

4. Run a full campaign:

```bash
./steed flow --sweep start --fetch all --teardown delete
```

## Generic Training Hook

If `TRAIN_COMMAND_TEMPLATE` is set, Steed executes it with `bash -lc` and provides these variables:

- `RUN_ID`, `CONFIG`, `SEED`, `TRAIN_OUT_DIR`, `NPROC_PER_NODE`
- `DATA_DIR`, `HF_HOME`, `OVERRIDES`
- `WANDB_LOG`, `WANDB_PROJECT`, `WANDB_GROUP_VALUE`, `WANDB_RUN_NAME`
- `OPS_REMOTE_REPO`, `VENV_PYTHON`

Example:

```bash
TRAIN_WORKDIR_REL="."
TRAIN_COMMAND_TEMPLATE='"${VENV_PYTHON}" -m torch.distributed.run --standalone --nproc_per_node="${NPROC_PER_NODE}" train.py "${CONFIG}" output_dir="${TRAIN_OUT_DIR}" seed="${SEED}" ${OVERRIDES}'
```

## Key Files

- `steed` - CLI entrypoint
- `infra_scripts/workflow.sh` - main orchestrator
- `infra_scripts/workflow/` - runtime profile configurations (`<profile>.cfg`)
- `infra_scripts/workflow.cfg` - legacy compatibility shim (sources `workflow/default.cfg`)
- `docs/infrastructure-automation.md` - operational reference
- `docs/STEED.md` - manifesto/philosophy
