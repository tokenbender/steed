#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

plugin_entry="${repo_root}/packages/opencode-steed-gate/index.js"
permit_script="${repo_root}/scripts/create-steed-permit.py"
control_script="${repo_root}/scripts/steed-project.py"
playwright_skill_source="${repo_root}/packages/opencode-steed-gate/skills/playwright/SKILL.md"
git_master_skill_source="${repo_root}/packages/opencode-steed-gate/skills/git-master/SKILL.md"
steed_master_skill_source="${repo_root}/packages/opencode-steed-gate/skills/steed-master/SKILL.md"

if [[ ! -f "${plugin_entry}" ]]; then
  echo "plugin entry not found: ${plugin_entry}" >&2
  exit 1
fi
if [[ ! -f "${permit_script}" ]]; then
  echo "permit generator not found: ${permit_script}" >&2
  exit 1
fi
if [[ ! -f "${control_script}" ]]; then
  echo "steed control script not found: ${control_script}" >&2
  exit 1
fi
if [[ ! -f "${playwright_skill_source}" ]]; then
  echo "playwright skill not found: ${playwright_skill_source}" >&2
  exit 1
fi
if [[ ! -f "${git_master_skill_source}" ]]; then
  echo "git-master skill not found: ${git_master_skill_source}" >&2
  exit 1
fi
if [[ ! -f "${steed_master_skill_source}" ]]; then
  echo "steed-master skill not found: ${steed_master_skill_source}" >&2
  exit 1
fi

config_home="${XDG_CONFIG_HOME:-${HOME}/.config}"
opencode_home="${config_home}/opencode"
gate_home="${opencode_home}/steed-gate"
plugins_dir="${opencode_home}/plugins"
commands_dir="${opencode_home}/commands"
skills_dir="${opencode_home}/skills"
mkdir -p "${plugins_dir}" "${commands_dir}" "${gate_home}" "${skills_dir}"

loader_file="${plugins_dir}/steed-gate.js"
secret_file="${gate_home}/secret"
steed_command_file="${commands_dir}/steed.md"
mcp_bundle_file="${gate_home}/mcp.bundle.json"

plugin_entry_json="$(python3 - <<'PY' "${plugin_entry}"
import json
import sys

print(json.dumps(sys.argv[1]))
PY
)"

control_script_json="$(python3 - <<'PY' "${control_script}"
import json
import sys

print(json.dumps(sys.argv[1]))
PY
)"

if [[ ! -s "${secret_file}" ]]; then
  python3 - <<'PY' "${secret_file}"
import pathlib
import secrets
import sys

path = pathlib.Path(sys.argv[1])
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(secrets.token_hex(32) + "\n", encoding="utf-8")
PY
  chmod 600 "${secret_file}"
  echo "Generated new steed-gate secret at: ${secret_file}"
else
  echo "Using existing steed-gate secret at: ${secret_file}"
fi

cat >"${loader_file}" <<EOF
import SteedGatePlugin from ${plugin_entry_json}

export default SteedGatePlugin
export { SteedGatePlugin }
EOF

cat >"${steed_command_file}" <<EOF
---
description: Steed project command (control or runtime)
agent: build
subtask: false
---
Run steed command:
\`\$ARGUMENTS\`

Shell output (includes stderr and explicit exit marker):
!\`python3 ${control_script_json} \$ARGUMENTS 2>&1; echo "__STEED_EXIT_CODE__:\$?"\`

Then respond with:
- command status (success/failure from __STEED_EXIT_CODE__)
- key output lines (or explicit note if empty)
- if failure: exact fix command(s) and do not advance workflow phase
- if success: what changed, current mode/profile status, next recommended steed command
EOF

playwright_skill_dir="${skills_dir}/playwright"
git_master_skill_dir="${skills_dir}/git-master"
steed_master_skill_dir="${skills_dir}/steed-master"
mkdir -p "${playwright_skill_dir}" "${git_master_skill_dir}" "${steed_master_skill_dir}"
cp "${playwright_skill_source}" "${playwright_skill_dir}/SKILL.md"
cp "${git_master_skill_source}" "${git_master_skill_dir}/SKILL.md"
cp "${steed_master_skill_source}" "${steed_master_skill_dir}/SKILL.md"

python3 - <<'PY' "${opencode_home}" "${mcp_bundle_file}"
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import quote


def build_mcp_bundle() -> dict[str, dict[str, object]]:
    exa_key = os.environ.get("EXA_API_KEY", "").strip()
    context7_key = os.environ.get("CONTEXT7_API_KEY", "").strip()

    websearch_url = "https://mcp.exa.ai/mcp?tools=web_search_exa"
    websearch_cfg: dict[str, object] = {
        "type": "remote",
        "url": websearch_url,
        "enabled": True,
        "oauth": False,
    }
    if exa_key:
        websearch_cfg["url"] = f"{websearch_url}&exaApiKey={quote(exa_key)}"
        websearch_cfg["headers"] = {"x-api-key": exa_key}

    context7_cfg: dict[str, object] = {
        "type": "remote",
        "url": "https://mcp.context7.com/mcp",
        "enabled": True,
        "oauth": False,
    }
    if context7_key:
        context7_cfg["headers"] = {"Authorization": f"Bearer {context7_key}"}

    return {
        "websearch": websearch_cfg,
        "context7": context7_cfg,
        "grep_app": {
            "type": "remote",
            "url": "https://mcp.grep.app",
            "enabled": True,
            "oauth": False,
        },
    }


def strip_jsonc_comments(text: str) -> str:
    out: list[str] = []
    in_string = False
    escaped = False
    in_line_comment = False
    in_block_comment = False
    i = 0

    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""

        if in_line_comment:
            if ch == "\n":
                in_line_comment = False
                out.append(ch)
            i += 1
            continue

        if in_block_comment:
            if ch == "*" and nxt == "/":
                in_block_comment = False
                i += 2
            else:
                i += 1
            continue

        if in_string:
            out.append(ch)
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            i += 1
            continue

        if ch == '"':
            in_string = True
            out.append(ch)
            i += 1
            continue

        if ch == "/" and nxt == "/":
            in_line_comment = True
            i += 2
            continue

        if ch == "/" and nxt == "*":
            in_block_comment = True
            i += 2
            continue

        out.append(ch)
        i += 1

    return "".join(out)


def parse_config(path: Path) -> dict[str, object]:
    raw = path.read_text(encoding="utf-8")
    if path.suffix == ".jsonc":
        raw = strip_jsonc_comments(raw)
        raw = re.sub(r",(\s*[}\]])", r"\1", raw)
    loaded = json.loads(raw)
    if not isinstance(loaded, dict):
        raise ValueError("config root must be a JSON object")
    return loaded


def write_config(path: Path, data: dict[str, object]) -> None:
    rendered = json.dumps(data, indent=2, ensure_ascii=False)
    path.write_text(rendered + "\n", encoding="utf-8")


opencode_home = Path(sys.argv[1])
mcp_bundle_file = Path(sys.argv[2])
json_path = opencode_home / "opencode.json"
jsonc_path = opencode_home / "opencode.jsonc"

bundle = build_mcp_bundle()

if json_path.exists():
    target = json_path
elif jsonc_path.exists():
    target = jsonc_path
else:
    target = json_path

if target.exists():
    try:
        config = parse_config(target)
    except Exception as exc:  # noqa: BLE001
        mcp_bundle_file.write_text(json.dumps({"mcp": bundle}, indent=2) + "\n", encoding="utf-8")
        print(f"warning: could not parse {target}: {exc}", file=sys.stderr)
        print(f"wrote MCP bundle snippet to {mcp_bundle_file}", file=sys.stderr)
        sys.exit(0)
else:
    config = {"$schema": "https://opencode.ai/config.json"}

mcp_config = config.get("mcp")
if not isinstance(mcp_config, dict):
    mcp_config = {}
    config["mcp"] = mcp_config

added = []
for name, value in bundle.items():
    if name not in mcp_config:
        mcp_config[name] = value
        added.append(name)

write_config(target, config)

if added:
    print(f"Added MCP entries to {target}: {', '.join(added)}")
else:
    print(f"MCP entries already present in {target}")
PY

# Remove legacy compatibility wrappers to keep command surface minimal.
rm -f "${commands_dir}/steed-gate-init.md" "${commands_dir}/steed-permit.md"

echo "Installed steed-gate loader at: ${loader_file}"
echo "Installed command: /steed"
echo "Installed MCP bundle defaults: websearch, context7, grep_app"
echo "Installed bundled skills: playwright, git-master, steed-master"
echo "Secret file: ${secret_file}"
echo "Plugin source: ${plugin_entry}"
echo "Restart OpenCode to load changes."
