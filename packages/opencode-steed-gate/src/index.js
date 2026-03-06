import { PLUGIN_NAME } from "./constants.js"
import { loadGateConfig } from "./config.js"
import { recordDeny, writeAuditEvent } from "./audit.js"
import { PERMIT_REQUIRED_FIELDS, verifyPermit } from "./permit.js"
import {
  buildDenyPayload,
  extractAction,
  isFlowAutorunBlocked,
  isNonCoreSteedCommand,
  isDirectSteedRuntimeCommand,
  isReadonlyAction,
  parseSteedWrapperCommand,
  isSteedProjectWrapperCommand,
  isSteedScopedAction,
  resolveActionWorktree,
} from "./policy.js"
import {
  callKeyFor,
  clearSessionState,
  createRuntimeState,
  deactivateAutoWindow,
  ensureAutoWindow,
  getSessionState,
  setSessionState,
} from "./state.js"
import { nowEpoch } from "./utils.js"

async function safeAudit(config, event) {
  try {
    await writeAuditEvent(config, event)
  } catch {
    // best-effort logging; never block execution on audit persistence errors
  }
}

function denyError(payload) {
  return new Error(`[${PLUGIN_NAME}] ${JSON.stringify(payload)}`)
}

async function denyAndThrow({ config, input, action, code, message }) {
  const denyPayload = buildDenyPayload({
    code,
    message,
    action,
    config,
    permitRequiredFields: PERMIT_REQUIRED_FIELDS,
  })

  let finalPayload = denyPayload
  try {
    finalPayload = await recordDeny(config, denyPayload)
  } catch {
    // keep base payload if deny ledger fails
  }

  await safeAudit(config, {
    hook: "tool.execute.before",
    decision: "deny",
    reason_code: finalPayload.reason_code,
    original_reason_code: finalPayload.original_reason_code,
    tool: action.tool,
    command: action.command || "",
    args_sha256: action.argsSha,
    config_sha256: action.configSha || "",
    call_id: input?.callID || "",
    session_id: input?.sessionID || "",
    mode: config.mode,
    scoped: true,
    payload: finalPayload,
  })

  throw denyError(finalPayload)
}

function extractMarker(outputText, marker) {
  const prefix = `${marker}:`
  const lines = String(outputText || "").split("\n")
  let value = ""
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      value = line.slice(prefix.length)
    }
  }
  return value
}

function parseMarkerJson(outputText, marker) {
  const raw = extractMarker(outputText, marker)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function parseExitCode(outputText) {
  const raw = extractMarker(outputText, "__STEED_EXIT_CODE__")
  if (!raw) {
    return null
  }
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeWrapperDescriptor(parsed) {
  if (!parsed) {
    return null
  }
  return {
    control: parsed.control || "",
    runtimeSubcommand: parsed.runtimeSubcommand || "",
    args: Array.isArray(parsed.args) ? parsed.args : [],
  }
}

function sameWrapperDescriptor(left, right) {
  if (!left || !right) {
    return false
  }
  return (
    left.control === right.control &&
    left.runtimeSubcommand === right.runtimeSubcommand &&
    JSON.stringify(left.args || []) === JSON.stringify(right.args || [])
  )
}

function buildContinuationFromOutput(outputText, rootWrapper) {
  if (!String(outputText || "").includes("__STEED_POD_UP_INTAKE_REQUIRED__:1")) {
    return null
  }

  const nextQuestion =
    parseMarkerJson(outputText, "__STEED_POD_UP_NEXT_QUESTION__") ||
    parseMarkerJson(outputText, "__STEED_POD_UP_INTAKE_JSON__")?.next_question ||
    null

  const key = String(nextQuestion?.key || "").trim()
  if (!key) {
    return null
  }

  if (key === "__PROVISION_MODE__") {
    return {
      kind: "cfg-set",
      allowedKeys: ["LIUM_EXECUTOR_ID", "LIUM_GPU"],
      questionKey: key,
      rootWrapper,
    }
  }

  if (key.startsWith("LIUM_")) {
    return {
      kind: "cfg-set",
      allowedKeys: [key],
      questionKey: key,
      rootWrapper,
    }
  }

  return null
}

function continuationMessage(continuation) {
  if (!continuation) {
    return "Steed continuation is not approved for this session"
  }

  if (continuation.kind === "cfg-set") {
    return `Only cfg set for ${continuation.allowedKeys.join(" or ")} is approved next`
  }

  if (continuation.kind === "rerun") {
    return "Only rerunning the original /steed command is approved next"
  }

  return "Steed continuation is not approved for this session"
}

export const SteedGatePlugin = async ({ worktree }) => {
  const runtime = createRuntimeState()

  return {
    "command.execute.before": async (input) => {
      if (!input?.sessionID) {
        return
      }

      if (input.command === "steed") {
        setSessionState(runtime, input, {
          worktree,
          startedAtEpoch: nowEpoch(),
          command: input.command,
          arguments: String(input.arguments || ""),
          rootWrapper: null,
          continuation: null,
        })
        return
      }

      clearSessionState(runtime, input)
    },

    "tool.execute.before": async (input, output) => {
      const config = loadGateConfig({ worktree })
      const action = await extractAction({ input, output, worktree: config.worktree })
      const callKey = callKeyFor(input)
      const session = getSessionState(runtime, input)

      const scoped = await isSteedScopedAction({ action, config })
      if (!scoped) {
        runtime.calls.set(callKey, {
          scoped: false,
          tool: action.tool,
          config,
        })
        return
      }

      if (action.tool === "bash" && isDirectSteedRuntimeCommand(action.command)) {
        await denyAndThrow({
          config,
          input,
          action,
          code: "DENY_DIRECT_RUNTIME_BYPASS",
          message: "direct Steed runtime bash is blocked; use the /steed wrapper instead",
        })
      }

      if (action.tool === "bash" && isSteedProjectWrapperCommand(action.command)) {
        if (!session || session.command !== "steed") {
          await denyAndThrow({
            config,
            input,
            action,
            code: "DENY_WRAPPER_BYPASS",
            message: "Steed wrapper execution is only allowed through the /steed command",
          })
        }

        const actionWorktree = resolveActionWorktree(action, config)
        if (actionWorktree !== session.worktree) {
          await denyAndThrow({
            config,
            input,
            action,
            code: "DENY_WORKTREE_DRIFT",
            message: `Steed wrapper must run from session worktree ${session.worktree}`,
          })
        }

        const parsedWrapper = normalizeWrapperDescriptor(parseSteedWrapperCommand(action.command))
        if (!session.rootWrapper && parsedWrapper) {
          setSessionState(runtime, input, {
            ...session,
            rootWrapper: parsedWrapper,
          })
        }

        if (session.continuation) {
          let approved = false
          if (session.continuation.kind === "cfg-set") {
            const args = parsedWrapper?.args || []
            approved =
              parsedWrapper?.control === "cfg" &&
              args[0] === "set" &&
              session.continuation.allowedKeys.includes(String(args[1] || ""))
          } else if (session.continuation.kind === "rerun") {
            approved = sameWrapperDescriptor(parsedWrapper, session.continuation.rootWrapper)
          }

          if (!approved) {
            await denyAndThrow({
              config,
              input,
              action,
              code: "DENY_CONTINUATION_NOT_APPROVED",
              message: continuationMessage(session.continuation),
            })
          }
        }
      }

      if (isReadonlyAction(action)) {
        if (config.mode !== "auto") {
          deactivateAutoWindow(runtime)
        }
        runtime.calls.set(callKey, {
          scoped: true,
          action,
          mode: config.mode,
          permit: null,
          mutable: false,
          config,
        })
        await safeAudit(config, {
          hook: "tool.execute.before",
          decision: "allow",
          reason_code: "ALLOW_READONLY",
          tool: action.tool,
          command: action.command || "",
          args_sha256: action.argsSha,
          config_sha256: action.configSha || "",
          call_id: input?.callID || "",
          session_id: input?.sessionID || "",
          mode: config.mode,
          scoped: true,
        })
        return
      }

      if (config.mode === "auto" && isFlowAutorunBlocked(action, config)) {
        await denyAndThrow({
          config,
          input,
          action,
          code: "DENY_FLOW_AUTOMATION_BLOCKED",
          message: "flow autorun is blocked; run explicit phase command instead",
        })
      }

      if (config.mode === "auto" && isNonCoreSteedCommand(action)) {
        await denyAndThrow({
          config,
          input,
          action,
          code: "DENY_NON_CORE_COMMAND",
          message: "non-core Steed command blocked by policy",
        })
      }

      if (config.mode === "auto") {
        const autoWindow = ensureAutoWindow(runtime, config)
        const now = nowEpoch()
        if (now > autoWindow.expiresAtEpoch) {
          await denyAndThrow({
            config,
            input,
            action,
            code: "DENY_AUTO_WINDOW_EXPIRED",
            message: "autonomous execution window expired",
          })
        }

        if (autoWindow.mutationCount >= config.autoMaxMutations) {
          await denyAndThrow({
            config,
            input,
            action,
            code: "DENY_AUTO_BUDGET_EXHAUSTED",
            message: "autonomous mutation budget exhausted",
          })
        }

        autoWindow.mutationCount += 1
        runtime.calls.set(callKey, {
          scoped: true,
          action,
          mode: config.mode,
          permit: null,
          mutable: true,
          config,
        })

        await safeAudit(config, {
          hook: "tool.execute.before",
          decision: "allow",
          reason_code: "ALLOW_AUTO_BUDGET",
          tool: action.tool,
          command: action.command || "",
          args_sha256: action.argsSha,
          config_sha256: action.configSha || "",
          call_id: input?.callID || "",
          session_id: input?.sessionID || "",
          mode: config.mode,
          scoped: true,
          auto: {
            mutation_count: autoWindow.mutationCount,
            max_mutations: config.autoMaxMutations,
            expires_at_epoch: autoWindow.expiresAtEpoch,
          },
        })
        return
      }

      deactivateAutoWindow(runtime)

      if (!config.requirePermit) {
        runtime.calls.set(callKey, {
          scoped: true,
          action,
          mode: config.mode,
          permit: null,
          mutable: true,
          config,
        })

        await safeAudit(config, {
          hook: "tool.execute.before",
          decision: "allow",
          reason_code: "ALLOW_MANUAL_STEP",
          tool: action.tool,
          command: action.command || "",
          args_sha256: action.argsSha,
          config_sha256: action.configSha || "",
          call_id: input?.callID || "",
          session_id: input?.sessionID || "",
          mode: config.mode,
          scoped: true,
          require_permit: false,
        })
        return
      }

      const permitDecision = await verifyPermit({ action, config })
      if (!permitDecision.ok) {
        await denyAndThrow({
          config,
          input,
          action,
          code: permitDecision.code,
          message: permitDecision.message,
        })
      }

      runtime.calls.set(callKey, {
        scoped: true,
        action,
        mode: config.mode,
        permit: {
          step_id: permitDecision.stepId,
          nonce: permitDecision.nonce,
          permit_path: permitDecision.permitPath,
        },
        mutable: true,
        config,
      })

      await safeAudit(config, {
        hook: "tool.execute.before",
        decision: "allow",
        reason_code: "ALLOW_SIGNED_PERMIT",
        tool: action.tool,
        command: action.command || "",
        args_sha256: action.argsSha,
        config_sha256: action.configSha || "",
        call_id: input?.callID || "",
        session_id: input?.sessionID || "",
        mode: config.mode,
        scoped: true,
        require_permit: true,
        permit: {
          step_id: permitDecision.stepId,
          nonce: permitDecision.nonce,
          permit_path: permitDecision.permitPath,
        },
      })
    },

    "tool.execute.after": async (input, output) => {
      const callKey = callKeyFor(input)
      const call = runtime.calls.get(callKey)
      runtime.calls.delete(callKey)

      if (!call?.scoped) {
        return
      }

      const config = call.config || loadGateConfig({ worktree })

      if (call.action.tool === "bash" && isSteedProjectWrapperCommand(call.action.command)) {
        const session = getSessionState(runtime, input)
        if (session && session.command === "steed") {
          const textOutput = String(output?.output || "")
          const currentRootWrapper = session.rootWrapper || normalizeWrapperDescriptor(parseSteedWrapperCommand(call.action.command))
          const currentWrapper = normalizeWrapperDescriptor(parseSteedWrapperCommand(call.action.command))
          const continuation = buildContinuationFromOutput(textOutput, currentRootWrapper)

          if (continuation) {
            setSessionState(runtime, input, {
              ...session,
              rootWrapper: currentRootWrapper,
              continuation,
            })
          } else if (session.continuation?.kind === "cfg-set") {
            const args = currentWrapper?.args || []
            const wasApprovedCfgSet =
              currentWrapper?.control === "cfg" &&
              args[0] === "set" &&
              session.continuation.allowedKeys.includes(String(args[1] || ""))

            if (wasApprovedCfgSet && currentRootWrapper) {
              setSessionState(runtime, input, {
                ...session,
                rootWrapper: currentRootWrapper,
                continuation: {
                  kind: "rerun",
                  rootWrapper: currentRootWrapper,
                },
              })
            }
          } else {
            clearSessionState(runtime, input)
          }
        }
      }

      await safeAudit(config, {
        hook: "tool.execute.after",
        decision: "observed",
        tool: call.action.tool,
        command: call.action.command || "",
        args_sha256: call.action.argsSha,
        config_sha256: call.action.configSha || "",
        call_id: input?.callID || "",
        session_id: input?.sessionID || "",
        mode: call.mode,
        scoped: true,
        mutable: call.mutable,
        permit: call.permit,
        output_summary: {
          has_output: !!output,
        },
      })
    },
  }
}

export default SteedGatePlugin
