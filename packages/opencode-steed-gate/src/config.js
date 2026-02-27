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

export function loadGateConfig({ worktree }) {
  const resolvedWorktree = worktree || process.cwd()
  const configHome = process.env.XDG_CONFIG_HOME
    ? path.resolve(process.env.XDG_CONFIG_HOME)
    : path.join(os.homedir(), ".config")

  const gateRoot = path.join(configHome, "opencode", "steed-gate")
  const defaultProjectPermitFile = path.join(resolvedWorktree, ".opencode", "steed-gate", "permit.json")
  const denyDir = resolveMaybeRelative(
    process.env.STEED_GATE_DENY_DIR || path.join(gateRoot, "deny"),
    resolvedWorktree,
  )

  const permitLedgerFile = resolveMaybeRelative(
    process.env.STEED_GATE_PERMIT_LEDGER_FILE ||
      path.join(gateRoot, "permits", "permits.used.jsonl"),
    resolvedWorktree,
  )

  const auditFile = resolveMaybeRelative(
    process.env.STEED_GATE_AUDIT_FILE || path.join(gateRoot, "audit", "events.jsonl"),
    resolvedWorktree,
  )

  const secretFile = resolveMaybeRelative(
    process.env.STEED_GATE_SECRET_FILE || path.join(gateRoot, "secret"),
    resolvedWorktree,
  )

  return {
    mode: normalizeMode(process.env.STEED_GATE_MODE || "manual"),
    scopeMode: normalizeScopeMode(process.env.STEED_GATE_SCOPE_MODE || "auto"),
    scopeMarker: process.env.STEED_GATE_SCOPE_MARKER || DEFAULT_SCOPE_MARKER,
    permitFile: resolveMaybeRelative(
      process.env.STEED_GATE_PERMIT_FILE || defaultProjectPermitFile,
      resolvedWorktree,
    ),
    permitSecret: process.env.STEED_GATE_PERMIT_SECRET || "",
    secretFile,
    permitClockSkewSecs: parsePositiveInt(process.env.STEED_GATE_PERMIT_CLOCK_SKEW_SECS, 0),
    permitLedgerFile,
    denyDir,
    denyLastFile: path.join(denyDir, "last-deny.json"),
    denyEventsFile: path.join(denyDir, "deny-events.jsonl"),
    denyCountsFile: path.join(denyDir, "deny-counts.json"),
    denyMaxAutoRetries: parsePositiveInt(process.env.STEED_GATE_DENY_MAX_AUTO_RETRIES, 1),
    denyLoopThreshold: parsePositiveInt(process.env.STEED_GATE_DENY_LOOP_THRESHOLD, 2),
    autoTtlSecs: parsePositiveInt(process.env.STEED_GATE_AUTO_TTL_SECS, 900),
    autoMaxMutations: parsePositiveInt(process.env.STEED_GATE_AUTO_MAX_MUTATIONS, 8),
    allowFlowAutorun: process.env.STEED_GATE_ALLOW_FLOW_AUTORUN === "1",
    auditFile,
    worktree: resolvedWorktree,
  }
}
