import { appendJsonLine, nowEpoch, readJsonFile, sha256Hex, writeJsonFile } from "./utils.js"

function denyFingerprint(payload) {
  return sha256Hex(
    [
      String(payload.original_reason_code || payload.reason_code || ""),
      String(payload.tool || ""),
      String(payload.command || ""),
      String(payload.args_sha256 || ""),
      String(payload.config_sha256 || ""),
    ].join("|"),
  )
}

export async function writeAuditEvent(config, event) {
  const payload = {
    plugin: "steed-gate",
    timestamp_epoch: nowEpoch(),
    ...event,
  }
  await appendJsonLine(config.auditFile, payload)
}

export async function recordDeny(config, payload) {
  const fingerprint = denyFingerprint(payload)
  const counts = await readJsonFile(config.denyCountsFile, {})
  const repeatCount = Number.parseInt(String(counts[fingerprint] || 0), 10) + 1
  counts[fingerprint] = repeatCount

  const loop = {
    fingerprint,
    repeat_count: repeatCount,
    threshold: config.denyLoopThreshold,
    tripped: repeatCount > config.denyLoopThreshold,
  }

  const finalPayload = {
    ...payload,
    loop,
    timestamp_epoch: nowEpoch(),
  }

  if (loop.tripped) {
    finalPayload.reason_code = "DENY_LOOP_TRIPPED"
    finalPayload.desired_action = {
      type: "ESCALATE_TO_HUMAN",
      description: "Repeated denial fingerprint exceeded threshold; modify command or permit before retrying.",
    }
    finalPayload.retriable = false
  }

  await writeJsonFile(config.denyCountsFile, counts)
  await writeJsonFile(config.denyLastFile, finalPayload)
  await appendJsonLine(config.denyEventsFile, finalPayload)
  return finalPayload
}
