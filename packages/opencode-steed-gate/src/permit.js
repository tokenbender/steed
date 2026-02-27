import crypto from "node:crypto"

import {
  appendJsonLine,
  fileExists,
  nowEpoch,
  readFileText,
  readJsonFile,
  stableStringify,
} from "./utils.js"

export const PERMIT_REQUIRED_FIELDS = [
  "step_id",
  "tool",
  "args_sha256",
  "expires_at_epoch",
  "nonce",
  "signature",
]

function safeInt(value) {
  const parsed = Number.parseInt(String(value), 10)
  return Number.isNaN(parsed) ? null : parsed
}

function verifyNonceFormat(nonce) {
  return /^[A-Za-z0-9._-]{1,128}$/.test(nonce)
}

function verifySignatureFormat(signature) {
  return /^[0-9a-fA-F]{64}$/.test(signature)
}

async function resolvePermitSecret(config) {
  const inline = String(config.permitSecret || "").trim()
  if (inline && inline !== "CHANGE_ME") {
    return inline
  }

  const secretPath = String(config.secretFile || "").trim()
  if (!secretPath) {
    return ""
  }

  if (!(await fileExists(secretPath))) {
    return ""
  }

  const fromFile = (await readFileText(secretPath)).trim()
  if (!fromFile || fromFile === "CHANGE_ME") {
    return ""
  }

  return fromFile
}

export function permitSignaturePayload(permit) {
  return [
    String(permit.step_id),
    String(permit.tool),
    String(permit.command || ""),
    String(permit.args_sha256),
    String(permit.config_sha256 || ""),
    String(permit.expires_at_epoch),
    String(permit.nonce),
  ].join("|")
}

export function expectedSignature(secret, permit) {
  return crypto
    .createHmac("sha256", secret)
    .update(permitSignaturePayload(permit), "utf8")
    .digest("hex")
}

function commandMatches(action, permit) {
  if (!permit.command) {
    return true
  }
  return String(permit.command) === String(action.command || "")
}

async function nonceAlreadyUsed(ledgerFile, nonce) {
  if (!(await fileExists(ledgerFile))) {
    return false
  }

  const raw = await readFileText(ledgerFile)
  if (!raw.trim()) {
    return false
  }

  const lines = raw.split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    try {
      const payload = JSON.parse(trimmed)
      if (String(payload.nonce) === String(nonce)) {
        return true
      }
    } catch {
      // ignore malformed historical lines
    }
  }

  return false
}

export function computePermitArgsSha(action) {
  return crypto
    .createHash("sha256")
    .update(stableStringify(action.permitArgs), "utf8")
    .digest("hex")
}

export async function verifyPermit({ action, config }) {
  const permitPath = config.permitFile
  if (!permitPath) {
    return {
      ok: false,
      code: "DENY_MANUAL_APPROVAL_MISSING",
      message: "set STEED_GATE_PERMIT_FILE before mutating Steed actions",
    }
  }

  if (!(await fileExists(permitPath))) {
    return {
      ok: false,
      code: "DENY_PERMIT_FILE_MISSING",
      message: `permit file not found: ${permitPath}`,
    }
  }

  const secret = await resolvePermitSecret(config)
  if (!secret) {
    const hint = config.secretFile
      ? `set STEED_GATE_PERMIT_SECRET or write secret to ${config.secretFile}`
      : "set STEED_GATE_PERMIT_SECRET"
    return {
      ok: false,
      code: "DENY_PERMIT_SECRET_MISSING",
      message: `${hint} to verify permit signatures`,
    }
  }

  const permit = await readJsonFile(permitPath, null)
  if (!permit || typeof permit !== "object") {
    return {
      ok: false,
      code: "DENY_PERMIT_PARSE_ERROR",
      message: `invalid JSON permit file: ${permitPath}`,
    }
  }

  for (const fieldName of PERMIT_REQUIRED_FIELDS) {
    if (permit[fieldName] === undefined || permit[fieldName] === null || permit[fieldName] === "") {
      return {
        ok: false,
        code: "DENY_PERMIT_PARSE_ERROR",
        message: `missing permit field: ${fieldName}`,
      }
    }
  }

  if (String(permit.tool) !== String(action.tool)) {
    return {
      ok: false,
      code: "DENY_COMMAND_NOT_ALLOWED",
      message: `permit tool=${permit.tool} requested=${action.tool}`,
    }
  }

  if (!commandMatches(action, permit)) {
    return {
      ok: false,
      code: "DENY_COMMAND_NOT_ALLOWED",
      message: "permit command does not match requested command",
    }
  }

  const expectedArgsSha = computePermitArgsSha(action)
  if (String(permit.args_sha256) !== expectedArgsSha) {
    return {
      ok: false,
      code: "DENY_ARGS_HASH_MISMATCH",
      message: "permit args_sha256 does not match requested action",
    }
  }

  if (permit.config_sha256 && action.configSha && String(permit.config_sha256) !== action.configSha) {
    return {
      ok: false,
      code: "DENY_CONFIG_HASH_MISMATCH",
      message: "permit config_sha256 does not match active workflow config",
    }
  }

  const expiresAt = safeInt(permit.expires_at_epoch)
  if (expiresAt === null) {
    return {
      ok: false,
      code: "DENY_PERMIT_PARSE_ERROR",
      message: "expires_at_epoch must be an integer",
    }
  }

  const now = nowEpoch()
  if (now > expiresAt + config.permitClockSkewSecs) {
    return {
      ok: false,
      code: "DENY_PERMIT_EXPIRED",
      message: `permit expired at epoch=${expiresAt}`,
    }
  }

  if (!verifyNonceFormat(String(permit.nonce))) {
    return {
      ok: false,
      code: "DENY_PERMIT_PARSE_ERROR",
      message: "nonce format invalid",
    }
  }

  if (!verifySignatureFormat(String(permit.signature))) {
    return {
      ok: false,
      code: "DENY_PERMIT_PARSE_ERROR",
      message: "signature must be 64 hex characters",
    }
  }

  const expected = expectedSignature(secret, permit)
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(permit.signature).toLowerCase()))) {
    return {
      ok: false,
      code: "DENY_SIGNATURE_INVALID",
      message: "permit signature verification failed",
    }
  }

  if (await nonceAlreadyUsed(config.permitLedgerFile, permit.nonce)) {
    return {
      ok: false,
      code: "DENY_PERMIT_REPLAY",
      message: `permit nonce already consumed: ${permit.nonce}`,
    }
  }

  await appendJsonLine(config.permitLedgerFile, {
    step_id: String(permit.step_id),
    tool: action.tool,
    command: action.command,
    args_sha256: expectedArgsSha,
    config_sha256: action.configSha || "",
    nonce: String(permit.nonce),
    permit_path: permitPath,
    validated_at_epoch: now,
  })

  return {
    ok: true,
    permitPath,
    stepId: String(permit.step_id),
    nonce: String(permit.nonce),
  }
}
