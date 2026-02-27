#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"

plugin_entry="${repo_root}/packages/opencode-steed-gate/index.js"
permit_script="${repo_root}/scripts/create-steed-permit.py"
if [[ ! -f "${plugin_entry}" ]]; then
  echo "plugin entry not found: ${plugin_entry}" >&2
  exit 1
fi
if [[ ! -f "${permit_script}" ]]; then
  echo "permit generator not found: ${permit_script}" >&2
  exit 1
fi

config_home="${XDG_CONFIG_HOME:-${HOME}/.config}"
opencode_home="${config_home}/opencode"
gate_home="${opencode_home}/steed-gate"
plugins_dir="${config_home}/opencode/plugins"
commands_dir="${opencode_home}/commands"
mkdir -p "${plugins_dir}" "${commands_dir}" "${gate_home}"

loader_file="${plugins_dir}/steed-gate.js"
secret_file="${gate_home}/secret"
init_command_file="${commands_dir}/steed-gate-init.md"
permit_command_file="${commands_dir}/steed-permit.md"

plugin_entry_json="$(python3 - <<'PY' "${plugin_entry}"
import json
import sys

print(json.dumps(sys.argv[1]))
PY
)"

permit_script_json="$(python3 - <<'PY' "${permit_script}"
import json
import sys

print(json.dumps(sys.argv[1]))
PY
)"

secret_file_json="$(python3 - <<'PY' "${secret_file}"
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

cat >"${init_command_file}" <<'EOF'
---
description: Initialize steed-gate for this project
agent: plan
subtask: false
---
Initialize steed-gate project scope and default permit directory.

Shell output:
!`mkdir -p .opencode/steed-gate && printf 'steed-gate scope marker\n' > .steed-gate-scope && ls -la .opencode/steed-gate .steed-gate-scope`

Then respond with:
- initialized paths
- next step: `/steed-permit <exact steed command>`
EOF

cat >"${permit_command_file}" <<EOF
---
description: Generate signed Steed permit in current project
agent: plan
subtask: false
---
Create or rotate the current project permit for the exact command in \`\$ARGUMENTS\`.

Shell output:
!\`python3 ${permit_script_json} --step-id "step-\$(date +%s)" --command "\$ARGUMENTS" --out ".opencode/steed-gate/permit.json" --secret-file ${secret_file_json}\`

Then respond with:
- permit path: \`.opencode/steed-gate/permit.json\`
- step id and expiry from script output
- reminder that command must match exactly
EOF

echo "Installed steed-gate loader at: ${loader_file}"
echo "Installed command: /steed-gate-init"
echo "Installed command: /steed-permit"
echo "Secret file: ${secret_file}"
echo "Plugin source: ${plugin_entry}"
echo "Restart OpenCode to load changes."
