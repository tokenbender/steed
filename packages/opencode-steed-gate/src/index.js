import { PLUGIN_NAME } from "./constants.js"
import { loadGateConfig } from "./config.js"
import { recordDeny, writeAuditEvent } from "./audit.js"
import { PERMIT_REQUIRED_FIELDS, verifyPermit } from "./permit.js"
import {
  buildDenyPayload,
  extractAction,
  isFlowAutorunBlocked,
  isNonCoreSteedCommand,
  isReadonlyAction,
  isSteedScopedAction,
} from "./policy.js"
import { callKeyFor, createRuntimeState } from "./state.js"
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

export const SteedGatePlugin = async ({ worktree }) => {
  const config = loadGateConfig({ worktree })
  const runtime = createRuntimeState(config)

  return {
    "tool.execute.before": async (input, output) => {
      const action = await extractAction({ input, output, worktree: config.worktree })
      const callKey = callKeyFor(input)

      const scoped = await isSteedScopedAction({ action, config })
      if (!scoped) {
        runtime.calls.set(callKey, {
          scoped: false,
          tool: action.tool,
        })
        return
      }

      if (isReadonlyAction(action)) {
        runtime.calls.set(callKey, {
          scoped: true,
          action,
          mode: config.mode,
          permit: null,
          mutable: false,
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

      if (isFlowAutorunBlocked(action, config)) {
        await denyAndThrow({
          config,
          input,
          action,
          code: "DENY_FLOW_AUTOMATION_BLOCKED",
          message: "flow autorun is blocked; run explicit phase command instead",
        })
      }

      if (isNonCoreSteedCommand(action)) {
        await denyAndThrow({
          config,
          input,
          action,
          code: "DENY_NON_CORE_COMMAND",
          message: "non-core Steed command blocked by policy",
        })
      }

      if (config.mode === "auto") {
        const now = nowEpoch()
        if (now > runtime.auto.expiresAtEpoch) {
          await denyAndThrow({
            config,
            input,
            action,
            code: "DENY_AUTO_WINDOW_EXPIRED",
            message: "autonomous execution window expired",
          })
        }

        if (runtime.auto.mutationCount >= config.autoMaxMutations) {
          await denyAndThrow({
            config,
            input,
            action,
            code: "DENY_AUTO_BUDGET_EXHAUSTED",
            message: "autonomous mutation budget exhausted",
          })
        }

        runtime.auto.mutationCount += 1
        runtime.calls.set(callKey, {
          scoped: true,
          action,
          mode: config.mode,
          permit: null,
          mutable: true,
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
            mutation_count: runtime.auto.mutationCount,
            max_mutations: config.autoMaxMutations,
            expires_at_epoch: runtime.auto.expiresAtEpoch,
          },
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
