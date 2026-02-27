#!/usr/bin/env python3
"""Create a signed single-use permit for opencode-steed-gate.

This utility currently supports creating permits for `bash` tool actions,
which is the primary path for Steed command execution.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import pathlib
import secrets
import sys
import time
from typing import Any


def stable_value(value: Any) -> Any:
    if isinstance(value, list):
        return [stable_value(item) for item in value]
    if isinstance(value, dict):
        return {k: stable_value(value[k]) for k in sorted(value)}
    return value


def stable_stringify(value: Any) -> str:
    return json.dumps(stable_value(value), separators=(",", ":"), ensure_ascii=False)


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def read_file_sha256(path_str: str) -> str:
    data = pathlib.Path(path_str).read_text(encoding="utf-8")
    return sha256_hex(data)


def sign(secret: str, payload: str) -> str:
    return hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def default_secret_file() -> str:
    config_home = os.environ.get("XDG_CONFIG_HOME")
    if config_home:
        base = pathlib.Path(config_home)
    else:
        base = pathlib.Path.home() / ".config"
    return str(base / "opencode" / "steed-gate" / "secret")


def read_secret_file(path_str: str) -> str:
    path = pathlib.Path(path_str)
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8").strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="Create signed permit for steed-gate")
    parser.add_argument("--step-id", required=True, help="Permit step identifier")
    parser.add_argument("--command", required=True, help="Exact bash command that will be executed")
    parser.add_argument(
        "--config-sha256",
        default="",
        help="Optional config sha256 to bind permit (if omitted, no config binding)",
    )
    parser.add_argument(
        "--config-path",
        default="",
        help="Optional config file path to hash (overrides --config-sha256)",
    )
    parser.add_argument(
        "--expires-in",
        type=int,
        default=900,
        help="Permit TTL in seconds (default 900)",
    )
    parser.add_argument("--nonce", default="", help="Optional nonce override")
    parser.add_argument(
        "--out",
        default=".opencode/steed-gate/permit.json",
        help="Output permit JSON path (default: .opencode/steed-gate/permit.json)",
    )
    parser.add_argument(
        "--secret",
        default="",
        help="Permit signing secret (fallback: STEED_GATE_PERMIT_SECRET env)",
    )
    parser.add_argument(
        "--secret-file",
        default=os.environ.get("STEED_GATE_SECRET_FILE", default_secret_file()),
        help="Path to secret file used when --secret/env is unset",
    )

    args = parser.parse_args()

    secret = args.secret or os.environ.get("STEED_GATE_PERMIT_SECRET", "")
    if not secret:
        secret = read_secret_file(args.secret_file)
    if not secret:
        print(
            "error: missing signing secret; set --secret or STEED_GATE_PERMIT_SECRET or create secret file at "
            f"{args.secret_file}",
            file=sys.stderr,
        )
        return 2

    if args.expires_in <= 0:
        print("error: --expires-in must be > 0", file=sys.stderr)
        return 2

    config_sha256 = args.config_sha256
    if args.config_path:
        config_sha256 = read_file_sha256(args.config_path)

    permit_args = {
        "command": args.command,
    }
    args_sha256 = sha256_hex(stable_stringify(permit_args))

    nonce = args.nonce or secrets.token_urlsafe(24)
    expires_at_epoch = int(time.time()) + args.expires_in

    signing_payload = "|".join(
        [
            args.step_id,
            "bash",
            args.command,
            args_sha256,
            config_sha256,
            str(expires_at_epoch),
            nonce,
        ]
    )
    signature = sign(secret, signing_payload)

    permit = {
        "step_id": args.step_id,
        "tool": "bash",
        "command": args.command,
        "args_sha256": args_sha256,
        "config_sha256": config_sha256,
        "expires_at_epoch": expires_at_epoch,
        "nonce": nonce,
        "signature": signature,
    }

    out_path = pathlib.Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(permit, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(f"wrote permit: {out_path}")
    print(f"tool=bash step_id={args.step_id}")
    print(f"args_sha256={args_sha256}")
    print(f"expires_at_epoch={expires_at_epoch}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
