/** 校验浮层恢复点是否属于方案确认。 */
export function isPlanApproval(approval: { originalArgs?: Record<string, unknown> }) {
  return approval.originalArgs?.approvalType === 'plan_confirmation'
}

/** 提取方案确认中的文案。 */
export function getPlanApprovalText(approval: { originalArgs?: Record<string, unknown> }) {
  const plan = approval.originalArgs?.plan
  return typeof plan === 'string' ? plan : ''
}

/** 格式化任务状态文本及颜色。 */
export function getStatusLabelAndColor(status: string) {
  switch (status) {
    case 'idle':
    case 'queued':
    case 'planning':
      return { label: '规划中', color: 'blue' }
    case 'running':
      return { label: '进行中', color: 'geekblue' }
    case 'completed':
      return { label: '已完成', color: 'success' }
    case 'failed':
      return { label: '失败', color: 'error' }
    case 'paused':
    case 'waiting_approval':
      return { label: '待恢复', color: 'warning' }
    case 'archived':
      return { label: '已归档', color: 'default' }
    case 'cancelled':
      return { label: '已取消', color: 'default' }
    default:
      return { label: status, color: 'default' }
  }
}
