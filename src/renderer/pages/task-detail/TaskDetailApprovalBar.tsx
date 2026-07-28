import { AlertCircle, Edit2, Play, Terminal, XCircle } from 'lucide-react'
import { Button, Input, Modal } from 'antd'
import { getPlanApprovalText, useTaskDetail } from './TaskDetailContext.js'
import { renderMarkdown } from '../../utils/markdown.js'

/**
 * 任务审批与恢复控制栏/弹窗组件
 * 处理中断恢复 Alert 提示条、方案确认 Modal、编辑参数 Modal
 */
export default function TaskDetailApprovalBar() {
  const {
    pendingInterrupts,
    activePlanApproval,
    isPlanApprovalModalOpen,
    setClosedPlanApprovalId,
    handleApprovePlanWithFeedback,
    handleRejectPlanWithFeedback,
    editApprovalId,
    setEditApprovalId,
    editedArgsText,
    setEditedArgsText,
    handleResumeWithEditedArgs,
  } = useTaskDetail()

  return (
    <>
      {/* 顶部运行暂停 Alert 提示条 */}
      {pendingInterrupts.length > 0 && (
        <div
          style={{
            padding: '12px 24px',
            background: 'linear-gradient(90deg, #fffbeb 0%, #fef3c7 100%)',
            borderBottom: '1px solid #fde68a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: 'inset 0 -2px 4px rgba(251, 191, 36, 0.03)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: '#fffdf5',
                border: '1px solid #fbbf24',
                color: '#d97706',
                boxShadow: '0 2px 4px rgba(217, 119, 6, 0.06)',
              }}
            >
              <AlertCircle size={15} />
            </span>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#78350f' }}>运行已暂停</div>
              <div style={{ fontSize: '11px', color: '#92400e', marginTop: '1px' }}>
                Agent 触发了中断点，正在等待您确认或调整恢复参数。
              </div>
            </div>
          </div>
          <Button
            size="small"
            type="primary"
            onClick={() => {
              const element = document.getElementById('runtime-interrupts-panel')
              element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            style={{
              background: '#d97706',
              borderColor: '#d97706',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              boxShadow: '0 2px 6px rgba(217, 119, 6, 0.15)',
              display: 'flex',
              alignItems: 'center',
              height: '28px',
            }}
          >
            查看恢复点
          </Button>
        </div>
      )}

      {/* Plan 方案确认浮层 Modal */}
      {activePlanApproval && (
        <Modal
          open={isPlanApprovalModalOpen}
          onCancel={() => setClosedPlanApprovalId(activePlanApproval.id)}
          footer={null}
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#0f172a' }}>
              <span style={{ color: '#2563eb', display: 'flex', alignItems: 'center' }}>
                <AlertCircle size={18} />
              </span>
              <span style={{ fontWeight: 700 }}>方案确认</span>
            </div>
          }
          width={640}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '12px 0 4px 0' }}>
            <div style={{ fontSize: '13px', color: '#475569', lineHeight: 1.5 }}>
              Agent 已生成执行方案，请审阅方案内容。同意后将自动切换到 Craft 模式开始执行。
            </div>
            <div
              style={{
                maxHeight: '360px',
                overflowY: 'auto',
                padding: '16px',
                borderRadius: '12px',
                border: '1px solid #dbeafe',
                background: '#f8fbff',
                color: '#334155',
                fontSize: '13px',
                lineHeight: 1.7,
              }}
            >
              {(() => {
                const planText = getPlanApprovalText(activePlanApproval)
                return planText ? renderMarkdown(planText) : activePlanApproval.reason
              })()}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
              <Button
                danger
                size="middle"
                icon={<XCircle size={14} style={{ marginRight: '2px' }} />}
                onClick={() => void handleRejectPlanWithFeedback(activePlanApproval.id)}
                style={{ borderRadius: '8px', fontWeight: 600, height: '36px' }}
              >
                取消
              </Button>
              <Button
                type="primary"
                size="middle"
                icon={<Play size={14} style={{ marginRight: '4px' }} />}
                onClick={() => void handleApprovePlanWithFeedback(activePlanApproval.id)}
                style={{
                  background: '#0f172a',
                  borderColor: '#0f172a',
                  borderRadius: '8px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  height: '36px',
                }}
              >
                同意方案并执行
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* 编辑恢复参数 Modal */}
      <Modal
        open={editApprovalId !== null}
        onCancel={() => setEditApprovalId(null)}
        onOk={() => void handleResumeWithEditedArgs()}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#0f172a' }}>
            <span style={{ color: '#4f46e5', display: 'flex', alignItems: 'center' }}>
              <Edit2 size={16} />
            </span>
            <span style={{ fontWeight: 700 }}>编辑参数并恢复执行</span>
          </div>
        }
        okText="按编辑参数恢复"
        cancelText="取消"
        okButtonProps={{
          style: {
            background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)',
            borderColor: '#4f46e5',
            borderRadius: '6px',
            fontWeight: 600,
          },
        }}
        cancelButtonProps={{
          style: {
            borderRadius: '6px',
          },
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px 0 4px 0' }}>
          <div style={{ fontSize: '13px', color: '#475569', lineHeight: 1.5 }}>
            您可以修改以下 JSON 格式的参数，修改后的参数将在恢复执行时传递给 Agent 节点：
          </div>
          <div
            style={{
              position: 'relative',
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid #1e293b',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
            }}
          >
            <div
              style={{
                background: '#1e293b',
                padding: '6px 12px',
                borderBottom: '1px solid #334155',
                fontSize: '11px',
                color: '#94a3b8',
                fontFamily: 'Consolas, Courier New, monospace',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Terminal size={12} style={{ color: '#38bdf8' }} />
              arguments.json
            </div>
            <Input.TextArea
              rows={12}
              value={editedArgsText}
              onChange={(event) => setEditedArgsText(event.target.value)}
              style={{
                fontFamily: `'Fira Code', 'Consolas', 'Courier New', monospace`,
                fontSize: '12px',
                background: '#0f172a',
                color: '#38bdf8',
                border: 'none',
                padding: '12px',
                resize: 'none',
                overflowY: 'auto',
                outline: 'none',
                boxShadow: 'none',
              }}
            />
          </div>
        </div>
      </Modal>
    </>
  )
}
