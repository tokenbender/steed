import { nowEpoch } from "./utils.js"

export function createRuntimeState() {
  return {
    calls: new Map(),
    auto: {
      startedAtEpoch: 0,
      expiresAtEpoch: 0,
      mutationCount: 0,
      signature: "",
      active: false,
    },
  }
}

export function ensureAutoWindow(runtime, config) {
  const signature = `${config.autoTtlSecs}:${config.autoMaxMutations}`
  const now = nowEpoch()

  if (!runtime.auto.active || runtime.auto.signature !== signature) {
    runtime.auto.startedAtEpoch = now
    runtime.auto.expiresAtEpoch = now + config.autoTtlSecs
    runtime.auto.mutationCount = 0
    runtime.auto.signature = signature
    runtime.auto.active = true
  }

  return runtime.auto
}

export function deactivateAutoWindow(runtime) {
  runtime.auto.active = false
}

export function callKeyFor(input) {
  if (input?.callID) {
    return `call:${input.callID}`
  }

  const session = input?.sessionID || "session"
  const tool = input?.tool || "tool"
  return `fallback:${session}:${tool}`
}
