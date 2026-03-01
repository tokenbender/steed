#!/usr/bin/env python3
"""Project-local Steed control utility.

Provides an install-and-forget project interface for:
- initializing Steed gate metadata
- setting manual/auto mode without env variables
- updating workflow profile config keys
- optional hardened permit creation
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import time
from typing import Any


GATE_DEFAULTS = {
    "mode": "manual",
    "require_permit": False,
    "profile": "default",
    "allow_flow_autorun": False,
    "auto_ttl_secs": 900,
    "auto_max_mutations": 8,
    "scope_mode": "auto",
}

REQUIRED_WORKFLOW_KEYS = ["REPO_URL", "OPS_REMOTE_REPO", "OPS_LOCAL_REPO"]
TARGET_WORKFLOW_KEYS = ["LIUM_TARGET", "OPS_DEFAULT_HOST"]


def as_bool(value: Any, fallback: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return fallback
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return fallback


def normalize_mode(value: Any, fallback: str = "manual") -> str:
    text = str(value or fallback).strip().lower()
    if text in {"auto", "autonomous"}:
        return "auto"
    return "manual"


def normalize_scope_mode(value: Any, fallback: str = "auto") -> str:
    text = str(value or fallback).strip().lower()
    if text in {"auto", "force", "off"}:
        return text
    return fallback


def as_nonnegative_int(value: Any, fallback: int) -> int:
    try:
        parsed = int(str(value))
    except Exception:
        return fallback
    return parsed if parsed >= 0 else fallback


def resolve_paths(root: pathlib.Path) -> dict[str, pathlib.Path]:
    gate_dir = root / ".opencode" / "steed-gate"
    return {
        "root": root,
        "marker": root / ".steed-gate-scope",
        "gate_dir": gate_dir,
        "gate_config": gate_dir / "config.json",
        "permit": gate_dir / "permit.json",
        "workflow_dir": root / "infra_scripts" / "workflow",
        "permit_script": root / "scripts" / "create-steed-permit.py",
    }


def load_gate_config(path: pathlib.Path) -> dict[str, Any]:
    result = dict(GATE_DEFAULTS)
    if path.exists():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                result.update(loaded)
        except Exception:
            pass

    result["mode"] = normalize_mode(result.get("mode"), "manual")
    result["require_permit"] = as_bool(result.get("require_permit"), False)
    result["profile"] = str(result.get("profile") or "default")
    result["allow_flow_autorun"] = as_bool(result.get("allow_flow_autorun"), False)
    result["auto_ttl_secs"] = as_nonnegative_int(result.get("auto_ttl_secs"), 900)
    result["auto_max_mutations"] = as_nonnegative_int(result.get("auto_max_mutations"), 8)
    result["scope_mode"] = normalize_scope_mode(result.get("scope_mode"), "auto")
    return result


def save_gate_config(path: pathlib.Path, config: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def ensure_gate_scope(paths: dict[str, pathlib.Path]) -> None:
    paths["gate_dir"].mkdir(parents=True, exist_ok=True)
    if not paths["marker"].exists():
        paths["marker"].write_text("steed-gate scope marker\n", encoding="utf-8")


def workflow_config_path(paths: dict[str, pathlib.Path], profile: str) -> pathlib.Path:
    return paths["workflow_dir"] / f"{profile}.cfg"


def parse_cfg_assignments(path: pathlib.Path) -> dict[str, str]:
    assignments: dict[str, str] = {}
    if not path.exists():
        return assignments

    pattern = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$")
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = pattern.match(raw_line)
        if not match:
            continue
        key = match.group(1)
        value = match.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        assignments[key] = value
    return assignments


def set_cfg_key(path: pathlib.Path, key: str, value: str) -> None:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    assignment = f'{key}="{escaped}"'

    lines: list[str]
    if path.exists():
        lines = path.read_text(encoding="utf-8").splitlines()
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        lines = []

    pattern = re.compile(rf"^\s*(?:export\s+)?{re.escape(key)}=")
    updated = False
    output: list[str] = []
    for line in lines:
        if not updated and pattern.match(line):
            output.append(assignment)
            updated = True
        else:
            output.append(line)

    if not updated:
        if output and output[-1].strip() != "":
            output.append("")
        output.append(assignment)

    path.write_text("\n".join(output) + "\n", encoding="utf-8")


def maybe_apply_gate_key(gate: dict[str, Any], key: str, value: str) -> bool:
    lookup = key.strip().lower()

    if lookup in {"mode", "steed_gate_mode"}:
        gate["mode"] = normalize_mode(value, gate.get("mode", "manual"))
        return True

    if lookup in {"require_permit", "permit_mode", "steed_gate_require_permit"}:
        gate["require_permit"] = as_bool(value, gate.get("require_permit", False))
        return True

    if lookup in {"profile", "steed_profile", "steed_gate_profile"}:
        text = str(value).strip()
        if text:
            gate["profile"] = text
        return True

    if lookup in {"allow_flow_autorun", "steed_gate_allow_flow_autorun"}:
        gate["allow_flow_autorun"] = as_bool(value, gate.get("allow_flow_autorun", False))
        return True

    if lookup in {"auto_ttl_secs", "steed_gate_auto_ttl_secs"}:
        gate["auto_ttl_secs"] = as_nonnegative_int(value, gate.get("auto_ttl_secs", 900))
        return True

    if lookup in {"auto_max_mutations", "steed_gate_auto_max_mutations"}:
        gate["auto_max_mutations"] = as_nonnegative_int(value, gate.get("auto_max_mutations", 8))
        return True

    if lookup in {"scope_mode", "steed_gate_scope_mode"}:
        gate["scope_mode"] = normalize_scope_mode(value, gate.get("scope_mode", "auto"))
        return True

    if lookup in {"permit_file", "steed_gate_permit_file"}:
        text = str(value).strip()
        if text:
            gate["permit_file"] = text
        return True

    if lookup in {"secret_file", "steed_gate_secret_file"}:
        text = str(value).strip()
        if text:
            gate["secret_file"] = text
        return True

    if lookup in {"audit_file", "steed_gate_audit_file"}:
        text = str(value).strip()
        if text:
            gate["audit_file"] = text
        return True

    if lookup in {"deny_dir", "steed_gate_deny_dir"}:
        text = str(value).strip()
        if text:
            gate["deny_dir"] = text
        return True

    if lookup in {"permit_ledger_file", "steed_gate_permit_ledger_file"}:
        text = str(value).strip()
        if text:
            gate["permit_ledger_file"] = text
        return True

    if lookup in {"permit_clock_skew_secs", "steed_gate_permit_clock_skew_secs"}:
        gate["permit_clock_skew_secs"] = as_nonnegative_int(
            value,
            gate.get("permit_clock_skew_secs", 0),
        )
        return True

    if lookup in {"deny_max_auto_retries", "steed_gate_deny_max_auto_retries"}:
        gate["deny_max_auto_retries"] = as_nonnegative_int(
            value,
            gate.get("deny_max_auto_retries", 1),
        )
        return True

    if lookup in {"deny_loop_threshold", "steed_gate_deny_loop_threshold"}:
        gate["deny_loop_threshold"] = as_nonnegative_int(
            value,
            gate.get("deny_loop_threshold", 2),
        )
        return True

    return False


def normalize_workflow_value(paths: dict[str, pathlib.Path], key: str, value: str) -> str:
    if key.strip().upper() != "OPS_LOCAL_REPO":
        return value

    text = str(value).strip()
    if not text:
        return text

    expanded = os.path.expanduser(text)
    candidate = pathlib.Path(expanded)
    if not candidate.is_absolute():
        candidate = (paths["root"] / candidate).resolve()
    else:
        candidate = candidate.resolve()

    return str(candidate)


def status_text(paths: dict[str, pathlib.Path], gate: dict[str, Any], profile: str) -> str:
    cfg_path = workflow_config_path(paths, profile)
    values = parse_cfg_assignments(cfg_path)

    missing = [key for key in REQUIRED_WORKFLOW_KEYS if not values.get(key)]
    if not any(values.get(k) for k in TARGET_WORKFLOW_KEYS):
        missing.append("LIUM_TARGET|OPS_DEFAULT_HOST")

    lines = [
        f"project: {paths['root']}",
        f"gate config: {paths['gate_config']}",
        f"mode: {gate['mode']}",
        f"require_permit: {str(gate['require_permit']).lower()}",
        f"profile: {profile}",
        f"workflow cfg: {cfg_path}",
        f"scope marker: {'present' if paths['marker'].exists() else 'missing'} ({paths['marker']})",
    ]

    if not cfg_path.exists():
        lines.append("workflow cfg status: missing file")
    else:
        lines.append("workflow cfg status: present")

    if missing:
        lines.append(f"workflow cfg missing keys: {', '.join(missing)}")
    else:
        lines.append("workflow cfg missing keys: none")

    lines.append("next examples:")
    lines.append("  /steed pods")
    lines.append("  /steed mode auto")
    lines.append("  /steed cfg apply steed.setup.cfg")
    lines.append("  /steed cfg set REPO_URL https://github.com/org/repo.git")
    lines.append("  /steed cfg set OPS_REMOTE_REPO /workspace/repo")
    lines.append("  /steed cfg set OPS_LOCAL_REPO ~/work/repo")
    lines.append("  steed checkout")
    lines.append("  steed flow --sweep start --fetch all --teardown delete")
    return "\n".join(lines)


def default_secret_file() -> pathlib.Path:
    config_home = os.environ.get("XDG_CONFIG_HOME")
    if config_home:
        base = pathlib.Path(config_home)
    else:
        base = pathlib.Path.home() / ".config"
    return base / "opencode" / "steed-gate" / "secret"


def command_init(args: argparse.Namespace, paths: dict[str, pathlib.Path]) -> int:
    ensure_gate_scope(paths)
    gate = load_gate_config(paths["gate_config"])

    if args.mode:
        gate["mode"] = normalize_mode(args.mode, gate["mode"])
    if args.profile:
        gate["profile"] = args.profile
    if args.permit_mode:
        gate["require_permit"] = args.permit_mode == "on"

    save_gate_config(paths["gate_config"], gate)
    print("initialized steed project scope")
    print(status_text(paths, gate, gate["profile"]))
    return 0


def command_mode(args: argparse.Namespace, paths: dict[str, pathlib.Path]) -> int:
    ensure_gate_scope(paths)
    gate = load_gate_config(paths["gate_config"])
    gate["mode"] = normalize_mode(args.mode, gate["mode"])
    save_gate_config(paths["gate_config"], gate)
    print(f"mode set to {gate['mode']}")
    return 0


def command_permit_mode(args: argparse.Namespace, paths: dict[str, pathlib.Path]) -> int:
    ensure_gate_scope(paths)
    gate = load_gate_config(paths["gate_config"])
    gate["require_permit"] = args.state == "on"
    save_gate_config(paths["gate_config"], gate)
    print(f"require_permit set to {str(gate['require_permit']).lower()}")
    return 0


def command_profile(args: argparse.Namespace, paths: dict[str, pathlib.Path]) -> int:
    ensure_gate_scope(paths)
    gate = load_gate_config(paths["gate_config"])
    gate["profile"] = args.profile
    save_gate_config(paths["gate_config"], gate)
    print(f"profile set to {gate['profile']}")
    return 0


def command_cfg_set(args: argparse.Namespace, paths: dict[str, pathlib.Path]) -> int:
    ensure_gate_scope(paths)
    gate = load_gate_config(paths["gate_config"])
    profile = args.profile or gate["profile"]
    cfg_path = workflow_config_path(paths, profile)
    normalized_value = normalize_workflow_value(paths, args.key, args.value)
    set_cfg_key(cfg_path, args.key, normalized_value)
    print(f"updated {cfg_path}: {args.key}={normalized_value}")
    return 0


def command_cfg_show(args: argparse.Namespace, paths: dict[str, pathlib.Path]) -> int:
    ensure_gate_scope(paths)
    gate = load_gate_config(paths["gate_config"])
    profile = args.profile or gate["profile"]
    cfg_path = workflow_config_path(paths, profile)
    values = parse_cfg_assignments(cfg_path)

    print(f"profile: {profile}")
    print(f"workflow cfg: {cfg_path}")
    if not cfg_path.exists():
        print("status: missing file")
        return 0

    keys = REQUIRED_WORKFLOW_KEYS + TARGET_WORKFLOW_KEYS
    for key in keys:
        print(f"{key}={values.get(key, '')}")
    return 0


def command_cfg_apply(args: argparse.Namespace, paths: dict[str, pathlib.Path]) -> int:
    ensure_gate_scope(paths)
    gate = load_gate_config(paths["gate_config"])

    source = pathlib.Path(args.file)
    if not source.is_absolute():
        source = (paths["root"] / source).resolve()

    if not source.exists():
        print(f"error: cfg file not found: {source}", file=sys.stderr)
        return 2

    assignments = parse_cfg_assignments(source)
    if not assignments:
        print(f"error: no KEY=VALUE assignments found in {source}", file=sys.stderr)
        return 2

    gate_keys: list[str] = []
    workflow_updates: dict[str, str] = {}

    for key, value in assignments.items():
        if maybe_apply_gate_key(gate, key, value):
            gate_keys.append(key)
        else:
            workflow_updates[key] = value

    profile = args.profile or gate["profile"]
    cfg_path = workflow_config_path(paths, profile)
    for key, value in workflow_updates.items():
        set_cfg_key(cfg_path, key, normalize_workflow_value(paths, key, value))

    save_gate_config(paths["gate_config"], gate)

    print(f"applied cfg file: {source}")
    print(f"gate updates: {len(gate_keys)}")
    if gate_keys:
        print(f"gate keys: {', '.join(gate_keys)}")
    print(f"workflow updates: {len(workflow_updates)}")
    print(status_text(paths, gate, profile))
    return 0


def command_status(args: argparse.Namespace, paths: dict[str, pathlib.Path]) -> int:
    ensure_gate_scope(paths)
    gate = load_gate_config(paths["gate_config"])
    profile = args.profile or gate["profile"]
    print(status_text(paths, gate, profile))
    return 0


def command_pods(_args: argparse.Namespace, _paths: dict[str, pathlib.Path]) -> int:
    completed = subprocess.run(["lium", "ps"], check=False)
    return int(completed.returncode)


def command_permit(args: argparse.Namespace, paths: dict[str, pathlib.Path]) -> int:
    ensure_gate_scope(paths)
    gate = load_gate_config(paths["gate_config"])
    command = " ".join(args.command).strip()
    if not command:
        print("error: permit command is empty", file=sys.stderr)
        return 2

    permit_script = paths["permit_script"]
    if not permit_script.exists():
        print(f"error: permit script missing: {permit_script}", file=sys.stderr)
        return 2

    profile = gate["profile"]
    cfg_path = workflow_config_path(paths, profile)
    secret_file = os.environ.get("STEED_GATE_SECRET_FILE", str(default_secret_file()))
    step_id = f"step-{int(time.time())}"

    cmd = [
        sys.executable,
        str(permit_script),
        "--step-id",
        step_id,
        "--command",
        command,
        "--out",
        str(paths["permit"]),
        "--secret-file",
        secret_file,
    ]

    if cfg_path.exists():
        cmd.extend(["--config-path", str(cfg_path)])

    subprocess.run(cmd, check=True)
    print(f"permit ready: {paths['permit']}")
    return 0


def resolve_runtime_steed(paths: dict[str, pathlib.Path]) -> pathlib.Path:
    project_steed = paths["root"] / "steed"
    if project_steed.exists():
        return project_steed

    bundled_steed = pathlib.Path(__file__).resolve().parent.parent / "steed"
    if bundled_steed.exists():
        return bundled_steed

    return project_steed


def command_run(args: argparse.Namespace, paths: dict[str, pathlib.Path]) -> int:
    ensure_gate_scope(paths)

    argv = list(args.argv or [])
    if argv and argv[0] == "steed":
        argv = argv[1:]

    if not argv:
        print("error: missing steed runtime command (example: pod-up, checkout, flow ...)", file=sys.stderr)
        return 2

    steed_path = resolve_runtime_steed(paths)
    if not steed_path.exists():
        print(f"error: steed runtime not found at {steed_path}", file=sys.stderr)
        return 2

    cmd = [str(steed_path), *argv]
    completed = subprocess.run(cmd, check=False)

    if completed.returncode == 0 and argv and argv[0] == "pod-up":
        gate = load_gate_config(paths["gate_config"])
        profile = gate.get("profile", "default")
        cfg_path = workflow_config_path(paths, profile)
        values = parse_cfg_assignments(cfg_path)
        target = values.get("LIUM_TARGET", "").strip()
        pod_name = values.get("LIUM_POD_NAME", "").strip()
        if not target and pod_name:
            set_cfg_key(cfg_path, "LIUM_TARGET", pod_name)
            print(f"auto-set LIUM_TARGET={pod_name} in {cfg_path}")

        # Best-effort immediate visibility into pod details.
        subprocess.run(["lium", "ps"], check=False)

    return int(completed.returncode)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="steed-project",
        description="Steed project control utility",
    )

    sub = parser.add_subparsers(dest="command")

    init_cmd = sub.add_parser("init", help="Initialize project scope and gate config")
    init_cmd.add_argument("--mode", choices=["manual", "auto"], help="Initial gate mode")
    init_cmd.add_argument("--profile", help="Workflow profile name (default: default)")
    init_cmd.add_argument("--permit-mode", choices=["on", "off"], help="Enable/disable hardened permit mode")

    mode_cmd = sub.add_parser("mode", help="Set project gate mode")
    mode_cmd.add_argument("mode", choices=["manual", "auto"]) 

    permit_mode_cmd = sub.add_parser("permit-mode", help="Set hardened permit mode")
    permit_mode_cmd.add_argument("state", choices=["on", "off"])

    profile_cmd = sub.add_parser("profile", help="Set active workflow profile")
    profile_cmd.add_argument("profile")

    cfg_cmd = sub.add_parser("cfg", help="Edit/show workflow cfg values")
    cfg_sub = cfg_cmd.add_subparsers(dest="cfg_command")

    cfg_set = cfg_sub.add_parser("set", help="Set KEY VALUE in workflow profile cfg")
    cfg_set.add_argument("key")
    cfg_set.add_argument("value")
    cfg_set.add_argument("--profile", help="Workflow profile override")

    cfg_show = cfg_sub.add_parser("show", help="Show key workflow values")
    cfg_show.add_argument("--profile", help="Workflow profile override")

    cfg_apply = cfg_sub.add_parser("apply", help="Apply KEY=VALUE file to gate config and workflow cfg")
    cfg_apply.add_argument("file", help="Path to cfg file with KEY=VALUE lines")
    cfg_apply.add_argument("--profile", help="Workflow profile override")

    status_cmd = sub.add_parser("status", help="Show gate/workflow status")
    status_cmd.add_argument("--profile", help="Workflow profile override")

    sub.add_parser("pods", help="Show local lium pod list")

    permit_cmd = sub.add_parser("permit", help="Generate project permit (optional hardened mode)")
    permit_cmd.add_argument("command", nargs=argparse.REMAINDER)

    run_cmd = sub.add_parser("run", help="Run steed runtime command")
    run_cmd.add_argument("argv", nargs=argparse.REMAINDER)

    return parser


def main() -> int:
    parser = build_parser()

    control_commands = {
        "init",
        "mode",
        "permit-mode",
        "profile",
        "cfg",
        "status",
        "pods",
        "permit",
        "run",
        "help",
        "-h",
        "--help",
    }

    argv = sys.argv[1:]
    if argv and argv[0] not in control_commands:
        argv = ["run", *argv]

    args = parser.parse_args(argv)
    paths = resolve_paths(pathlib.Path.cwd())

    if args.command in {None, "help"}:
        parser.print_help()
        return 0

    if args.command == "init":
        return command_init(args, paths)
    if args.command == "mode":
        return command_mode(args, paths)
    if args.command == "permit-mode":
        return command_permit_mode(args, paths)
    if args.command == "profile":
        return command_profile(args, paths)
    if args.command == "status":
        return command_status(args, paths)
    if args.command == "pods":
        return command_pods(args, paths)
    if args.command == "permit":
        return command_permit(args, paths)
    if args.command == "run":
        return command_run(args, paths)
    if args.command == "cfg":
        if args.cfg_command == "set":
            return command_cfg_set(args, paths)
        if args.cfg_command == "show":
            return command_cfg_show(args, paths)
        if args.cfg_command == "apply":
            return command_cfg_apply(args, paths)
        print("error: use 'cfg set', 'cfg show', or 'cfg apply'", file=sys.stderr)
        return 2

    print(f"error: unknown command {args.command}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
