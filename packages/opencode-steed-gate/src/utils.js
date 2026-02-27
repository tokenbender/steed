import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item))
  }

  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort()
    const output = {}
    for (const key of keys) {
      output[key] = stableValue(value[key])
    }
    return output
  }

  return value
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value))
}

export function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex")
}

export async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

export async function appendJsonLine(filePath, payload) {
  await ensureParentDir(filePath)
  await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8")
}

export async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export async function writeJsonFile(filePath, payload) {
  await ensureParentDir(filePath)
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function readFileText(filePath) {
  return fs.readFile(filePath, "utf8")
}

export function nowEpoch() {
  return Math.floor(Date.now() / 1000)
}
