import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { DEFAULT_SCOPE_MARKER } from "./constants.js"

function parsePositiveInt(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") {
    return fallback
  }

  const value = Number.parseInt(String(raw), 10)
  if (Number.isNaN(value) || value < 0) {
    return fallback
  }

  return value
}

function resolveMaybeRelative(rawPath, worktree) {
  if (!rawPath) {
    return ""
  }

  const asString = String(rawPath)

  if (asString.startsWith("~/")) {
    return path.join(os.homedir(), asString.slice(2))
  }

  if (path.isAbsolute(asString)) {
    return asString
  }

  if (!worktree) {
    return path.resolve(asString)
  }

  return path.resolve(worktree, asString)
}

function normalizeMode(raw) {
  const value = String(raw || "manual").toLowerCase()
  if (value === "auto" || value === "autonomous") {
    return "auto"
  }
  return "manual"
}

function normalizeScopeMode(raw) {
  const value = String(raw || "auto").toLowerCase()
  if (value === "force" || value === "off" || value === "auto") {
    return value
  }
  return "auto"
}

function parseBoolean(raw, fallback = false) {
  if (raw === undefined || raw === null || raw === "") {
    return fallback
  }

  const value = String(raw).toLowerCase()
  if (value === "1" || value === "true" || value === "yes" || value === "on") {
    return true
  }
  if (value === "0" || value === "false" || value === "no" || value === "off") {
    return false
  }

  return fallback
}

function readJsonObject(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {}
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8")
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function envValue(name) {
  if (Object.prototype.hasOwnProperty.call(process.env, name)) {
    return process.env[name]
  }
  return undefined
}

function normalizeModeFrom(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback
  }
  return normalizeMode(value)
}

function normalizeScopeModeFrom(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback
  }
  return normalizeScopeMode(value)
}

function parsePositiveIntFrom(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback
  }
  return parsePositiveInt(value, fallback)
}

function parseBooleanFrom(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback
  }
  return parseBoolean(value, fallback)
}

export function loadGateConfig({ worktree }) {
  const resolvedWorktree = worktree || process.cwd()
  const configHome = process.env.XDG_CONFIG_HOME
    ? path.resolve(process.env.XDG_CONFIG_HOME)
    : path.join(os.homedir(), ".config")

  const gateRoot = path.join(configHome, "opencode", "steed-gate")
  const projectGateConfigPath = path.join(
    resolvedWorktree,
    ".opencode",
    "steed-gate",
    "config.json",
  )
  const projectGateConfig = readJsonObject(projectGateConfigPath)

  const defaultMode = normalizeMode(projectGateConfig.mode || "manual")
  const defaultScopeMode = normalizeScopeMode(projectGateConfig.scope_mode || "auto")
  const defaultScopeMarker = String(projectGateConfig.scope_marker || DEFAULT_SCOPE_MARKER)
  const defaultRequirePermit = parseBoolean(projectGateConfig.require_permit, false)
  const defaultAllowFlowAutorun = parseBoolean(projectGateConfig.allow_flow_autorun, false)
  const defaultAutoTtlSecs = parsePositiveInt(projectGateConfig.auto_ttl_secs, 900)
  const defaultAutoMaxMutations = parsePositiveInt(projectGateConfig.auto_max_mutations, 8)

  const defaultProjectPermitFile = path.join(resolvedWorktree, ".opencode", "steed-gate", "permit.json")
  const configuredPermitFile = String(projectGateConfig.permit_file || defaultProjectPermitFile)
  const denyDir = resolveMaybeRelative(
    envValue("STEED_GATE_DENY_DIR") || projectGateConfig.deny_dir || path.join(gateRoot, "deny"),
    resolvedWorktree,
  )

  const permitLedgerFile = resolveMaybeRelative(
    envValue("STEED_GATE_PERMIT_LEDGER_FILE") ||
      projectGateConfig.permit_ledger_file ||
      path.join(gateRoot, "permits", "permits.used.jsonl"),
    resolvedWorktree,
  )

  const auditFile = resolveMaybeRelative(
    envValue("STEED_GATE_AUDIT_FILE") ||
      projectGateConfig.audit_file ||
      path.join(gateRoot, "audit", "events.jsonl"),
    resolvedWorktree,
  )

  const secretFile = resolveMaybeRelative(
    envValue("STEED_GATE_SECRET_FILE") ||
      projectGateConfig.secret_file ||
      path.join(gateRoot, "secret"),
    resolvedWorktree,
  )

  return {
    mode: normalizeModeFrom(envValue("STEED_GATE_MODE"), defaultMode),
    scopeMode: normalizeScopeModeFrom(envValue("STEED_GATE_SCOPE_MODE"), defaultScopeMode),
    scopeMarker: envValue("STEED_GATE_SCOPE_MARKER") || defaultScopeMarker,
    requirePermit: parseBooleanFrom(envValue("STEED_GATE_REQUIRE_PERMIT"), defaultRequirePermit),
    permitFile: resolveMaybeRelative(
      envValue("STEED_GATE_PERMIT_FILE") || configuredPermitFile,
      resolvedWorktree,
    ),
    permitSecret: envValue("STEED_GATE_PERMIT_SECRET") || String(projectGateConfig.permit_secret || ""),
    secretFile,
    permitClockSkewSecs: parsePositiveIntFrom(
      envValue("STEED_GATE_PERMIT_CLOCK_SKEW_SECS"),
      parsePositiveInt(projectGateConfig.permit_clock_skew_secs, 0),
    ),
    permitLedgerFile,
    denyDir,
    denyLastFile: path.join(denyDir, "last-deny.json"),
    denyEventsFile: path.join(denyDir, "deny-events.jsonl"),
    denyCountsFile: path.join(denyDir, "deny-counts.json"),
    denyMaxAutoRetries: parsePositiveIntFrom(
      envValue("STEED_GATE_DENY_MAX_AUTO_RETRIES"),
      parsePositiveInt(projectGateConfig.deny_max_auto_retries, 1),
    ),
    denyLoopThreshold: parsePositiveIntFrom(
      envValue("STEED_GATE_DENY_LOOP_THRESHOLD"),
      parsePositiveInt(projectGateConfig.deny_loop_threshold, 2),
    ),
    autoTtlSecs: parsePositiveIntFrom(envValue("STEED_GATE_AUTO_TTL_SECS"), defaultAutoTtlSecs),
    autoMaxMutations: parsePositiveIntFrom(
      envValue("STEED_GATE_AUTO_MAX_MUTATIONS"),
      defaultAutoMaxMutations,
    ),
    allowFlowAutorun: parseBooleanFrom(
      envValue("STEED_GATE_ALLOW_FLOW_AUTORUN"),
      defaultAllowFlowAutorun,
    ),
    auditFile,
    worktree: resolvedWorktree,
    projectConfigPath: projectGateConfigPath,
  }
}
