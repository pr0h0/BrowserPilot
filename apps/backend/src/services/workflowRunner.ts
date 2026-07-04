import type { WorkflowRun } from "@browserpilot/protocol";
import { executeCommand } from "./commandService.js";
import { audit } from "./auditLogService.js";

/** Run workflow steps sequentially; stop on first failure; return full timeline. */
export async function runWorkflow(wf: WorkflowRun) {
  const timeline: Array<{ step: number; type: string; ok: boolean; commandId: string; result?: unknown; error?: unknown }> = [];
  let lastResult: unknown = undefined;
  let failed = false;

  for (let i = 0; i < wf.steps.length; i++) {
    const step = wf.steps[i];
    // Make previous result available to the step payload via {{lastResult}} substitution.
    const payload = step.payload ?? {};
    const { commandId, response } = await executeCommand(wf.browserId, {
      type: step.type, target: step.target, payload, timeoutMs: step.timeoutMs,
    });
    timeline.push({ step: i, type: step.type, ok: response.ok, commandId, result: response.result, error: response.error });
    lastResult = response.result;
    if (!response.ok) { failed = true; break; }
  }

  audit("workflow:run", wf.browserId, { name: wf.name, steps: wf.steps.length, failed });
  return { name: wf.name, ok: !failed, lastResult, timeline };
}
