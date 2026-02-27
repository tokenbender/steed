import path from "node:path"

import {
  DEFAULT_STEED_PATHS,
  MUTATING_TOOLS,
  STEED_BASH_PATTERN,
  STEED_PATH_PATTERN,
} from "./constants.js"
import { fileExists, readFileText, sha256Hex, stableStringify } from "./utils.js"

const STEED_MUTATING_COMMANDS = new Set([
  "flow",
  "pod-up",
  "pod-delete",
  "pod-butter",
  "config-sync",
  "bootstrap",
  "checkout",
  "workflow-sync",
  "sweep-start",
  "fetch-all",
  "fetch-run",
  "checklist-reset",
  "task-run",
  "local-push",
])

const STEED_READONLY_COMMANDS = new Set([
  "help",
  "-h",
  "--help",
  "pod-wait",
  "pod-status",
  "task-status",
  "task-wait",
  "task-list",
  "checklist-status",
  "sweep-status",
  "sweep-watch",
  "sweep-csv-template",
  "local-status",
  "_sweep_run_all",
  "_sweep_status",
])

const STEED_CORE_COMMANDS = new Set([
  "flow",
  "pod-up",
  "pod-wait",
  "pod-status",
  "pod-delete",
  "config-sync",
  "bootstrap",
  "checkout",
  "sweep-start",
  "sweep-status",
  "fetch-all",
  "fetch-run",
  "checklist-status",
  "_sweep_run_all",
  "_sweep_status",
])

const READONLY_TOOLS = new Set([
  "read",
  "glob",
  "grep",
  "list",
  "skill",
  "webfetch",
  "websearch",
  "codesearch",
  "lsp",
  "todoread",
])

function stripQuotes(value) {
  return String(value || "").replace(/^['"]|['"]$/g, "")
}

function tokenize(command) {
  return String(command || "")
    .match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)
    ?.map((token) => stripQuotes(token)) || []
}

function parseSteedSubcommand(command) {
  const tokens = tokenize(command)

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    const next = tokens[i + 1] || ""
    const next2 = tokens[i + 2] || ""

    if (token === "steed" || token === "./steed" || token.endsWith("/steed")) {
      return next || ""
    }

    if (token.endsWith("infra_scripts/workflow.sh") || token === "infra_scripts/workflow.sh") {
      return next || ""
    }

    if (token === "bash" && (next.endsWith("infra_scripts/workflow.sh") || next === "infra_scripts/workflow.sh")) {
      return next2 || ""
    }
  }

  return ""
}

function sanitizeArgsForPermit(tool, args) {
  const safe = args || {}

  if (tool === "bash") {
    return {
      command: String(safe.command || ""),
    }
  }

  if (tool === "edit") {
    return {
      filePath: String(safe.filePath || ""),
      oldString: String(safe.oldString || ""),
      newString: String(safe.newString || ""),
    }
  }

  if (tool === "write") {
    return {
      filePath: String(safe.filePath || ""),
      content: String(safe.content || ""),
    }
  }

  if (tool === "apply_patch") {
    return {
      patchText: String(safe.patchText || ""),
    }
  }

  if (tool === "task") {
    return {
      description: String(safe.description || ""),
      prompt: String(safe.prompt || ""),
      subagent_type: String(safe.subagent_type || ""),
      task_id: String(safe.task_id || ""),
    }
  }

  if (tool === "todowrite") {
    return {
      todos: Array.isArray(safe.todos) ? safe.todos : [],
    }
  }

  return safe
}

function extractPathsFromPatch(patchText) {
  const paths = []
  const lines = String(patchText || "").split("\n")
  for (const line of lines) {
    const match = line.match(/^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s+(.+)$/)
    if (match) {
      paths.push(stripQuotes(match[1].trim()))
    }
  }
  return paths
}

function extractPathCandidates(tool, args) {
  const candidates = []
  const safe = args || {}

  if (typeof safe.filePath === "string") {
    candidates.push(safe.filePath)
  }

  if (typeof safe.path === "string") {
    candidates.push(safe.path)
  }

  if (tool === "apply_patch") {
    candidates.push(...extractPathsFromPatch(safe.patchText))
  }

  return candidates.filter(Boolean).map((item) => stripQuotes(item))
}

function maybeResolveWorkflowConfigPath(command, worktree) {
  const commandText = String(command || "")
  const explicit = commandText.match(/(?:^|\s)WORKFLOW_CONFIG=([^\s]+)/)
  if (explicit?.[1]) {
    const raw = stripQuotes(explicit[1])
    return path.isAbsolute(raw) ? raw : path.resolve(worktree, raw)
  }

  return path.resolve(worktree, "infra_scripts/workflow/default.cfg")
}

async function maybeReadConfigSha(action, worktree) {
  if (action.tool !== "bash") {
    return ""
  }

  const cfgPath = maybeResolveWorkflowConfigPath(action.command, worktree)
  if (!(await fileExists(cfgPath))) {
    return ""
  }

  const cfgText = await readFileText(cfgPath)
  return sha256Hex(cfgText)
}

function isSteedBash(command) {
  return STEED_BASH_PATTERN.test(String(command || ""))
}

function isSteedPath(filePath) {
  return STEED_PATH_PATTERN.test(String(filePath || ""))
}

function deriveMutation(tool, subcommand) {
  if (tool === "bash" && subcommand) {
    if (STEED_READONLY_COMMANDS.has(subcommand)) {
      return false
    }
    if (STEED_MUTATING_COMMANDS.has(subcommand)) {
      return true
    }
    return true
  }

  if (READONLY_TOOLS.has(tool)) {
    return false
  }

  if (MUTATING_TOOLS.has(tool)) {
    return true
  }

  return true
}

export async function extractAction({ input, output, worktree }) {
  const tool = String(input?.tool || "unknown")
  const args = output?.args && typeof output.args === "object" ? output.args : {}
  const command = tool === "bash" ? String(args.command || "") : ""
  const subcommand = parseSteedSubcommand(command)
  const filePaths = extractPathCandidates(tool, args)
  const permitArgs = sanitizeArgsForPermit(tool, args)
  const argsSha = sha256Hex(stableStringify(permitArgs))
  const isSteedCommand = tool === "bash" && isSteedBash(command)
  const isCoreCommand = !subcommand || STEED_CORE_COMMANDS.has(subcommand)
  const isMutating = deriveMutation(tool, subcommand)

  const action = {
    tool,
    args,
    permitArgs,
    argsSha,
    command,
    subcommand,
    filePaths,
    isSteedCommand,
    isCoreCommand,
    isMutating,
    worktree,
    configSha: "",
  }

  action.configSha = await maybeReadConfigSha(action, worktree)
  return action
}

export async function isSteedScopedAction({ action, config }) {
  if (config.scopeMode === "off") {
    return false
  }

  if (config.scopeMode === "force") {
    return true
  }

  const markerPath = path.resolve(config.worktree, config.scopeMarker)
  if (!(await fileExists(markerPath))) {
    return false
  }

  if (action.isSteedCommand) {
    return true
  }

  if (action.filePaths.some((item) => isSteedPath(item))) {
    return true
  }

  if (DEFAULT_STEED_PATHS.some((item) => action.command.includes(item))) {
    return true
  }

  const argsBlob = stableStringify(action.args)
  return /steed|infra_scripts\/workflow\.sh|WORKFLOW_PROFILE/.test(argsBlob)
}

function permitDesiredAction(requiredFields) {
  return {
    type: "REQUEST_SIGNED_PERMIT",
    description: "Provide a new signed single-use permit that exactly matches the intended action.",
    required_fields: requiredFields,
    example: "set STEED_GATE_PERMIT_FILE=/abs/path/to/permit.json and retry",
  }
}

export function buildDenyPayload({ code, message, action, config, permitRequiredFields }) {
  const permitCodes = new Set([
    "DENY_MANUAL_APPROVAL_MISSING",
    "DENY_PERMIT_FILE_MISSING",
    "DENY_PERMIT_SECRET_MISSING",
    "DENY_PERMIT_PARSE_ERROR",
    "DENY_COMMAND_NOT_ALLOWED",
    "DENY_ARGS_HASH_MISMATCH",
    "DENY_CONFIG_HASH_MISMATCH",
    "DENY_PERMIT_EXPIRED",
    "DENY_SIGNATURE_INVALID",
    "DENY_PERMIT_REPLAY",
  ])

  let desiredAction
  let retriable = true

  if (permitCodes.has(code)) {
    desiredAction = permitDesiredAction(permitRequiredFields)
  } else if (code === "DENY_FLOW_AUTOMATION_BLOCKED") {
    desiredAction = {
      type: "RUN_EXPLICIT_PHASE_COMMAND",
      description: "Flow autorun is blocked by policy; run explicit lifecycle command with permit.",
      example: "steed checkout",
    }
  } else if (code === "DENY_NON_CORE_COMMAND") {
    desiredAction = {
      type: "USE_ALLOWED_STEED_COMMAND",
      description: "Use allowed Steed core commands only.",
      allowed_examples: [
        "pod-up",
        "pod-wait",
        "pod-status",
        "bootstrap",
        "checkout",
        "sweep-start",
        "sweep-status",
        "fetch-all",
        "fetch-run",
      ],
    }
  } else if (code === "DENY_AUTO_WINDOW_EXPIRED") {
    desiredAction = {
      type: "OPEN_AUTO_WINDOW",
      description: "Re-open an autonomous execution window with explicit TTL and mutation budget.",
    }
  } else if (code === "DENY_AUTO_BUDGET_EXHAUSTED") {
    desiredAction = {
      type: "RESET_AUTO_BUDGET",
      description: "Increase or reset autonomous mutation budget before retrying.",
    }
  } else {
    desiredAction = {
      type: "REVIEW_POLICY_DENIAL",
      description: "Inspect reason_code and retry with corrected action.",
    }
  }

  if (code === "DENY_LOOP_TRIPPED") {
    retriable = false
  }

  return {
    decision: "DENY",
    reason_code: code,
    original_reason_code: code,
    message,
    tool: action.tool,
    command: action.command || "",
    args_sha256: action.argsSha,
    config_sha256: action.configSha || "",
    permit_path: config.permitFile || "",
    desired_action: desiredAction,
    retriable,
    max_auto_retries: config.denyMaxAutoRetries,
  }
}

export function isReadonlyAction(action) {
  return READONLY_TOOLS.has(action.tool) || !action.isMutating
}

export function isFlowAutorunBlocked(action, config) {
  return action.tool === "bash" && action.subcommand === "flow" && !config.allowFlowAutorun
}

export function isNonCoreSteedCommand(action) {
  return action.tool === "bash" && action.isSteedCommand && !!action.subcommand && !action.isCoreCommand
}
