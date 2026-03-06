#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

plugin_source_dir="${repo_root}/packages/opencode-steed-gate"
plugin_entry="${plugin_source_dir}/index.js"
plugin_package_json="${plugin_source_dir}/package.json"
plugin_src_dir="${plugin_source_dir}/src"
permit_script="${repo_root}/scripts/create-steed-permit.py"
control_script="${repo_root}/scripts/steed-project.py"
runtime_entry="${repo_root}/steed"
workflow_script="${repo_root}/infra_scripts/workflow.sh"
workflow_assets_dir="${repo_root}/infra_scripts/workflow"
playwright_skill_source="${repo_root}/packages/opencode-steed-gate/skills/playwright/SKILL.md"
git_master_skill_source="${repo_root}/packages/opencode-steed-gate/skills/git-master/SKILL.md"
steed_master_skill_source="${repo_root}/packages/opencode-steed-gate/skills/steed-master/SKILL.md"

if [[ ! -f "${plugin_entry}" ]]; then
  echo "plugin entry not found: ${plugin_entry}" >&2
  exit 1
fi
if [[ ! -f "${plugin_package_json}" ]]; then
  echo "plugin package metadata not found: ${plugin_package_json}" >&2
  exit 1
fi
if [[ ! -d "${plugin_src_dir}" ]]; then
  echo "plugin source directory not found: ${plugin_src_dir}" >&2
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
if [[ ! -f "${runtime_entry}" ]]; then
  echo "steed runtime entry not found: ${runtime_entry}" >&2
  exit 1
fi
if [[ ! -f "${workflow_script}" ]]; then
  echo "workflow script not found: ${workflow_script}" >&2
  exit 1
fi
if [[ ! -d "${workflow_assets_dir}" ]]; then
  echo "workflow assets directory not found: ${workflow_assets_dir}" >&2
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
plugin_bundle_root="${gate_home}/plugin"
plugin_bundle_dir="${plugin_bundle_root}/opencode-steed-gate"
runtime_bundle_dir="${gate_home}/runtime"
runtime_bundle_scripts_dir="${gate_home}/scripts"
runtime_bundle_infra_dir="${runtime_bundle_dir}/infra_scripts"
mkdir -p "${plugins_dir}" "${commands_dir}" "${gate_home}" "${skills_dir}" "${plugin_bundle_root}" "${runtime_bundle_dir}" "${runtime_bundle_scripts_dir}" "${runtime_bundle_infra_dir}"

loader_file="${plugins_dir}/steed-gate.js"
secret_file="${gate_home}/secret"
steed_command_file="${commands_dir}/steed.md"
mcp_bundle_file="${gate_home}/mcp.bundle.json"

plugin_bundle_entry="${plugin_bundle_dir}/index.js"
bundled_control_script="${runtime_bundle_scripts_dir}/steed-project.py"
bundled_permit_script="${runtime_bundle_scripts_dir}/create-steed-permit.py"
bundled_runtime_entry="${runtime_bundle_dir}/steed"
bundled_workflow_script="${runtime_bundle_infra_dir}/workflow.sh"
bundled_workflow_assets_dir="${runtime_bundle_infra_dir}/workflow"

plugin_entry_json="$(python3 - <<'PY' "${plugin_bundle_entry}"
import json
import sys

print(json.dumps(sys.argv[1]))
PY
)"

control_script_json="$(python3 - <<'PY' "${bundled_control_script}"
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

rm -rf "${plugin_bundle_dir}"
mkdir -p "${plugin_bundle_dir}"
cp "${plugin_entry}" "${plugin_bundle_dir}/index.js"
cp "${plugin_package_json}" "${plugin_bundle_dir}/package.json"
cp -R "${plugin_src_dir}" "${plugin_bundle_dir}/src"

cp "${control_script}" "${bundled_control_script}"
cp "${permit_script}" "${bundled_permit_script}"
cp "${runtime_entry}" "${bundled_runtime_entry}"
cp "${workflow_script}" "${bundled_workflow_script}"
rm -rf "${bundled_workflow_assets_dir}"
cp -R "${workflow_assets_dir}" "${bundled_workflow_assets_dir}"
chmod +x "${bundled_runtime_entry}" "${bundled_workflow_script}"

cat >"${loader_file}" <<EOF
import SteedGatePlugin from ${plugin_entry_json}

export default SteedGatePlugin
export { SteedGatePlugin }
EOF

cat >"${steed_command_file}" <<EOF
---
description: Steed project command (control or runtime)
agent: build
subtask: true
---
Requested Steed arguments: \$ARGUMENTS

Shell output (includes stderr, numeric exit marker, and artifact marker):
!\`steed_log_dir="\${XDG_STATE_HOME:-\${HOME}/.local/state}/steed-gate"; mkdir -p "\$steed_log_dir"; steed_log_file="\$steed_log_dir/steed-\$(date +%Y%m%d-%H%M%S)-\$\$.log"; if steed_output="\$(python3 ${control_script_json} \$ARGUMENTS 2>&1)"; then steed_rc=0; else steed_rc=\$?; fi; printf "%s\n" "\$steed_output" > "\$steed_log_file"; printf "%s\n__STEED_EXIT_CODE__:%s\n__STEED_ARTIFACT__:%s\n" "\$steed_output" "\$steed_rc" "\$steed_log_file"\`

Then respond with:
- critical execution rule:
  - the slash command has already executed the requested Steed action in the correct project context
  - do not run additional shell commands like steed ..., ./steed ..., /steed ..., or /Users/.../steed/... to retry or continue it
  - do not switch into the Steed source repo or copy workflow config between repos unless the user explicitly asks
  - if the user says "continue", do not invent the next Steed command; only continue within the intake loop below or with an explicitly requested command
- if output contains __STEED_POD_UP_INTAKE_REQUIRED__:1:
  - treat as needs-input (not a hard failure)
  - parse __STEED_POD_UP_QUESTIONS__ (fallback: __STEED_POD_UP_INTAKE_JSON__.questions, fallback: wrap __STEED_POD_UP_NEXT_QUESTION__ as a single-item list)
  - ask all currently-needed targeted questions in one question tool call using the full batch
  - conditional questions may include a 'required_when' field and a 'Not needed' option; respect that dependency and treat 'Not needed' as skip
  - apply every answered LIUM_* value with: python3 ${control_script_json} cfg set <KEY> <VALUE>
  - do not write __PROVISION_MODE__ into config; use it only to decide which conditional answers matter
  - if the chosen mode still leaves required conditional inputs unresolved, ask one immediate follow-up batch only for the unresolved keys, then continue
  - rerun the original steed command and repeat until intake marker is gone
- otherwise:
  - command status (success/failure from numeric __STEED_EXIT_CODE__)
  - key output lines (or explicit note if empty)
  - artifact path from __STEED_ARTIFACT__
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
echo "Installed steed-gate plugin bundle at: ${plugin_bundle_dir}"
echo "Installed steed runtime bundle at: ${runtime_bundle_dir}"
echo "Installed steed helper scripts at: ${runtime_bundle_scripts_dir}"
echo "Installed command: /steed"
echo "Installed MCP bundle defaults: websearch, context7, grep_app"
echo "Installed bundled skills: playwright, git-master, steed-master"
echo "Secret file: ${secret_file}"
echo "Restart OpenCode to load changes."
