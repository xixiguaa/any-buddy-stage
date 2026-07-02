import { EventEmitter } from 'node:events'
import type { AgentRun, TaskRuntimePayload } from '../../shared/types.js'

export class AppEventBus extends EventEmitter {
  emitActiveRuns(runs: AgentRun[]) {
    this.emit('agent-runs:active-changed', runs)
  }

  emitTaskRuntime(taskId: string, payload: TaskRuntimePayload) {
    this.emit(`agent-run:task-changed:${taskId}`, payload)
  }
}
