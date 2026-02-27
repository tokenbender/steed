export const PLUGIN_NAME = "steed-gate"

export const DEFAULT_SCOPE_MARKER = ".steed-gate-scope"

export const DEFAULT_STEED_PATHS = ["infra_scripts/workflow.sh", "steed"]

export const MUTATING_TOOLS = new Set([
  "bash",
  "edit",
  "write",
  "task",
  "todowrite",
  "apply_patch",
])

export const STEED_BASH_PATTERN =
  /(^|\s)(\.\/)?steed(\s|$)|infra_scripts\/workflow\.sh|WORKFLOW_PROFILE=/

export const STEED_PATH_PATTERN =
  /(^|\/)(infra_scripts\/|artifacts\/pod_logs\/|steed$|docs\/STEED\.md$|docs\/infrastructure-automation\.md$)/
