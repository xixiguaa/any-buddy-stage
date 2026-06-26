import { EventEmitter } from 'node:events'
import type { AgentEvent, AgentRun, HumanApproval } from '../../shared/types.js'

export class AppEventBus extends EventEmitter {
  emitActiveRuns(runs: AgentRun[]) {
    this.emit('agent-runs:active-changed', runs)
  }

  emitTaskRuntime(taskId: string, payload: { runs: AgentRun[]; events: AgentEvent[]; approvals: HumanApproval[] }) {
    this.emit(`agent-run:task-changed:${taskId}`, payload)
  }
}
