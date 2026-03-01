#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

plugin_entry="${repo_root}/packages/opencode-steed-gate/index.js"
permit_script="${repo_root}/scripts/create-steed-permit.py"
control_script="${repo_root}/scripts/steed-project.py"

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

config_home="${XDG_CONFIG_HOME:-${HOME}/.config}"
opencode_home="${config_home}/opencode"
gate_home="${opencode_home}/steed-gate"
plugins_dir="${opencode_home}/plugins"
commands_dir="${opencode_home}/commands"
mkdir -p "${plugins_dir}" "${commands_dir}" "${gate_home}"

loader_file="${plugins_dir}/steed-gate.js"
secret_file="${gate_home}/secret"
steed_command_file="${commands_dir}/steed.md"

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

# Remove legacy compatibility wrappers to keep command surface minimal.
rm -f "${commands_dir}/steed-gate-init.md" "${commands_dir}/steed-permit.md"

echo "Installed steed-gate loader at: ${loader_file}"
echo "Installed command: /steed"
echo "Secret file: ${secret_file}"
echo "Plugin source: ${plugin_entry}"
echo "Restart OpenCode to load changes."
