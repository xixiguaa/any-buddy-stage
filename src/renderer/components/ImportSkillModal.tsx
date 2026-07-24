import { useState } from 'react'
import { Modal, Checkbox, message, Spin } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { createAnybuddyClients } from '../api/clients.js'

interface ImportSkillModalProps {
  open: boolean
  onCancel: () => void
  onSuccess: (skillName: string) => void
}

export default function ImportSkillModal({ open, onCancel, onSuccess }: ImportSkillModalProps) {
  const [autoInstall, setAutoInstall] = useState(false)
  const [loading, setLoading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const handleImport = async (filePath?: string) => {
    setLoading(true)
    try {
      const clients = createAnybuddyClients(window.anybuddy)
      const res = await clients.config.importSkill({ filePath, autoInstall })
      if (res.ok) {
        message.success(`技能 "${res.data.name}" 导入成功！`)
        onSuccess(res.data.name)
        onCancel()
      } else {
        message.error(res.error.message || '导入技能失败')
      }
    } catch (err: any) {
      if (err?.message !== '已取消选择文件') {
        message.error(err?.message || '导入技能出错')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return

    // Electron 环境下，拖拽的 HTML File 对象暴露了原生的 path 属性
    const rawPath = (file as any).path
    if (rawPath) {
      void handleImport(rawPath)
    } else {
      message.error('无法获取拖拽文件的本地物理路径')
    }
  }

  return (
    <Modal
      title={<span style={{ fontSize: '16px', fontWeight: 600, color: '#1e293b' }}>导入技能</span>}
      open={open}
      onCancel={onCancel}
      footer={null}
      width={480}
      centered
      destroyOnClose
    >
      <Spin spinning={loading} tip="正在解压与校验技能包...">
        <div style={{ paddingTop: 12 }}>
          {/* 上传拖拽区域 */}
          <div
            onClick={() => void handleImport()}
            onDragOver={e => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${isDragging ? '#3b82f6' : '#e2e8f0'}`,
              borderRadius: 12,
              backgroundColor: isDragging ? '#eff6ff' : '#f8fafc',
              padding: '36px 20px',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              marginBottom: 20,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 10,
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 12,
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              }}
            >
              <InboxOutlined style={{ fontSize: '24px', color: '#64748b' }} />
            </div>
            <div style={{ fontSize: '15px', color: '#334155', fontWeight: 500 }}>
              拖拽文件或点击上传
            </div>
          </div>

          {/* 复选框 */}
          <div style={{ marginBottom: 24 }}>
            <Checkbox
              checked={autoInstall}
              onChange={e => setAutoInstall(e.target.checked)}
              style={{ color: '#475569', fontSize: '14px' }}
            >
              非高风险自动安装
            </Checkbox>
          </div>

          {/* 文件要求说明 */}
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#1e293b', marginBottom: 8 }}>
              文件要求
            </div>
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                fontSize: '13px',
                color: '#64748b',
                lineHeight: '1.8',
              }}
            >
              <li>文件夹或者 .zip 需要包含 SKILL.md 文件</li>
              <li>.md 文件需包含 YAML 格式的技能名称和描述</li>
            </ul>
          </div>
        </div>
      </Spin>
    </Modal>
  )
}
