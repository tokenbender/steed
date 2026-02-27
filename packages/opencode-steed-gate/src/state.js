import { nowEpoch } from "./utils.js"

export function createRuntimeState(config) {
  const now = nowEpoch()
  return {
    calls: new Map(),
    auto: {
      startedAtEpoch: now,
      expiresAtEpoch: now + config.autoTtlSecs,
      mutationCount: 0,
    },
  }
}

export function callKeyFor(input) {
  if (input?.callID) {
    return `call:${input.callID}`
  }

  const session = input?.sessionID || "session"
  const tool = input?.tool || "tool"
  return `fallback:${session}:${tool}`
}
