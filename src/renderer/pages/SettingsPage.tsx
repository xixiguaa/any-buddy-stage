import { Form, Switch, InputNumber, Select, Card, Spin } from 'antd'
import { useAppStore } from '../stores/app-store.js'

export default function SettingsPage() {
  const settings = useAppStore(state => state.settings)
  const workspaces = useAppStore(state => state.workspaces)
  const updateSettings = useAppStore(state => state.updateSettings)

  if (!settings) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '48px' }}>
        <Spin size="large" tip="正在加载系统设置..." />
      </div>
    )
  }

  return (
    <div style={{ padding: '24px', background: '#ffffff', minHeight: '100%' }}>
      <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 16, marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>系统设置</h2>
        <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: 4 }}>配置运行时规则、联网策略及默认工作区选项。</div>
      </div>

      <div style={{ maxWidth: '600px' }}>
        <Card style={{ borderRadius: 12, border: '1px solid #f1f5f9', boxShadow: '0 4px 12px rgba(0,0,0,0.01)' }}>
          <Form layout="vertical" initialValues={settings}>
            <Form.Item label="允许访问外部网络" valuePropName="checked" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: '#64748b' }}>允许 Agent 通过外部连接器进行 API 请求与信息获取</span>
                <Switch 
                  checked={settings.networkEnabled}
                  onChange={checked => updateSettings({ networkEnabled: checked })}
                />
              </div>
            </Form.Item>

            <Form.Item label="允许联网搜索" valuePropName="checked" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: '#64748b' }}>当执行复杂研究任务时，允许 Agent 使用搜索引擎检索时效信息</span>
                <Switch 
                  checked={settings.webSearchEnabled}
                  onChange={checked => updateSettings({ webSearchEnabled: checked })}
                />
              </div>
            </Form.Item>

            <Form.Item label="最大并发运行任务数" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: '#64748b' }}>限制后台同时执行的 Agent 任务的最大数量（1-4）</span>
                <InputNumber
                  min={1}
                  max={4}
                  value={settings.maxConcurrentRuns}
                  onChange={val => val && updateSettings({ maxConcurrentRuns: val })}
                  style={{ width: 120, borderRadius: 6 }}
                />
              </div>
            </Form.Item>

            <Form.Item label="默认工作区" style={{ marginBottom: 10 }}>
              <span style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: 8 }}>
                新创建任务时，默认绑定的本地文件夹项目
              </span>
              <Select
                value={settings.defaultWorkspaceId ?? ''}
                onChange={val => updateSettings({ defaultWorkspaceId: val || undefined })}
                style={{ width: '100%' }}
              >
                <Select.Option value="">无 (None)</Select.Option>
                {workspaces.map(workspace => (
                  <Select.Option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Form>
        </Card>
      </div>
    </div>
  )
}
