import { useMemo, useState } from 'react'
import type { ModelApiMode } from '../../shared/types.js'
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Button, Badge, Modal, Input, Popover, Avatar, Dropdown, Space, Tag, Tooltip, Switch, Divider, Form, Card } from 'antd'
import {
  PlusOutlined,
  SearchOutlined,
  FilterOutlined,
  SettingOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  DownOutlined,
  RightOutlined,
  UserOutlined,
  SyncOutlined,
  InfoCircleOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  SlidersOutlined
} from '@ant-design/icons'
import { Sparkles, Terminal, ShieldAlert, Award, Radio, MoreHorizontal } from 'lucide-react'
import { useAppStore } from '../stores/app-store.js'
import { createAnybuddyClients } from '../api/clients.js'

const { Sider } = Layout

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Running' },
  { value: 'waiting_approval', label: 'Paused' },
  { value: 'failed', label: 'Failed' },
] as const

const TIME_FILTERS = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'last_7_days', label: '7d' },
  { value: 'last_30_days', label: '30d' },
] as const

function matchesTimeRange(updatedAt: string, timeRange: (typeof TIME_FILTERS)[number]['value']) {
  if (timeRange === 'all') {
    return true
  }

  const updated = new Date(updatedAt)
  if (Number.isNaN(updated.getTime())) {
    return false
  }

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  if (timeRange === 'today') {
    return updated.getTime() >= startOfToday.getTime()
  }

  const daysBack = timeRange === 'last_7_days' ? 7 : 30
  const cutoff = new Date(startOfToday)
  cutoff.setDate(cutoff.getDate() - (daysBack - 1))
  return updated.getTime() >= cutoff.getTime()
}

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const tasks = useAppStore(state => state.tasks)
  const workspaces = useAppStore(state => state.workspaces)
  const runs = useAppStore(state => state.agentRuns)
  const search = useAppStore(state => state.sidebarSearch)
  const statusFilter = useAppStore(state => state.sidebarStatusFilter)
  const timeRange = useAppStore(state => state.sidebarTimeRange)
  const settings = useAppStore(state => state.settings)
  const customModels = useAppStore(state => state.customModels)
  
  const setSidebarSearch = useAppStore(state => state.setSidebarSearch)
  const setSidebarStatusFilter = useAppStore(state => state.setSidebarStatusFilter)
  const setSidebarTimeRange = useAppStore(state => state.setSidebarTimeRange)
  const saveCustomModels = useAppStore(state => state.saveCustomModels)
  const updateSettings = useAppStore(state => state.updateSettings)

  const [showSearchModal, setShowSearchModal] = useState(false)
  const [showFilterPopover, setShowFilterPopover] = useState(false)
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Record<string, boolean>>({})
  const [collapsed, setCollapsed] = useState(false)
  
  const [tasksCollapsed, setTasksCollapsed] = useState(false)
  const [workspacesCollapsed, setWorkspacesCollapsed] = useState(false)
  const [hoveredWorkspaceId, setHoveredWorkspaceId] = useState<string | null>(null)

  // Settings Modal States
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [activeSettingsTab, setActiveSettingsTab] = useState('account')
  
  // Custom Model Form States
  const [newModelName, setNewModelName] = useState('')
  const [newModelEndpoint, setNewModelEndpoint] = useState('')
  const [newModelKey, setNewModelKey] = useState('')
  const [newModelBase, setNewModelBase] = useState('')
  const [newModelApiMode, setNewModelApiMode] = useState<ModelApiMode>('auto')

  // Global Assistant Setup Form States
  const [wechatWebhook, setWechatWebhook] = useState(settings?.wechatWebhook ?? '')
  const [wechatSecret, setWechatSecret] = useState(settings?.wechatSecret ?? '')
  const [dingtalkWebhook, setDingtalkWebhook] = useState(settings?.dingtalkWebhook ?? '')
  const [dingtalkSecret, setDingtalkSecret] = useState(settings?.dingtalkSecret ?? '')

  useMemo(() => {
    if (settings) {
      setWechatWebhook(settings.wechatWebhook ?? '')
      setWechatSecret(settings.wechatSecret ?? '')
      setDingtalkWebhook(settings.dingtalkWebhook ?? '')
      setDingtalkSecret(settings.dingtalkSecret ?? '')
    }
  }, [settings])

  const filteredTasks = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return tasks.filter(task => {
      if (statusFilter === 'active' && !['queued', 'running', 'paused', 'waiting_approval'].includes(task.status)) {
        return false
      }
      if (statusFilter === 'waiting_approval' && task.status !== 'waiting_approval') {
        return false
      }
      if (statusFilter === 'failed' && task.status !== 'failed') {
        return false
      }
      if (!matchesTimeRange(task.updatedAt, timeRange)) {
        return false
      }
      if (!keyword) return true
      return `${task.title} ${task.primaryWorkspaceName ?? ''} ${task.status}`.toLowerCase().includes(keyword)
    })
  }, [search, statusFilter, tasks, timeRange])

  const activeRuns = useMemo(() => {
    return runs.filter(run => ['queued', 'running', 'paused', 'waiting_approval'].includes(run.status))
  }, [runs])

  const runningTasks = useMemo(() => {
    const taskMap = new Map(tasks.map(task => [task.id, task]))
    return activeRuns
      .map(run => ({
        run,
        task: taskMap.get(run.taskId),
      }))
      .filter((item): item is { run: typeof activeRuns[number]; task: typeof tasks[number] } => Boolean(item.task))
  }, [activeRuns, tasks])

  const tasksByWorkspace = useMemo(() => {
    return workspaces.map(workspace => ({
      workspace,
      tasks: filteredTasks.filter(task => task.primaryWorkspaceId === workspace.id),
    }))
  }, [filteredTasks, workspaces])

  function toggleWorkspace(workspaceId: string) {
    setExpandedWorkspaceIds(state => ({
      ...state,
      [workspaceId]: !state[workspaceId],
    }))
  }

  const handleUserMenuClick = (info: { key: string }) => {
    if (info.key === 'settings') {
      setShowSettingsModal(true)
      setActiveSettingsTab('account')
    } else if (info.key === 'update') {
      Modal.info({
        title: '检查更新',
        content: '当前已是最新版本 v1.1.5',
      })
    } else if (info.key === 'logout') {
      Modal.warning({
        title: '提示',
        content: '当前版本暂为个人工作台，无需登录',
      })
    }
  }

  const userMenuItems = {
    items: [
      { key: 'settings', label: '系统设置', icon: <SettingOutlined /> },
      { key: 'update', label: '检查更新', icon: <SyncOutlined /> },
      { key: 'logout', label: '退出登录', icon: <InfoCircleOutlined /> },
    ],
    onClick: handleUserMenuClick,
  }

  const getStatusTag = (status: string) => {
    switch (status) {
      case 'running':
        return <Tag color="processing" style={{ margin: 0, scale: '0.85' }}>Running</Tag>
      case 'waiting_approval':
        return <Tag color="warning" style={{ margin: 0, scale: '0.85' }}>Paused</Tag>
      case 'failed':
        return <Tag color="error" style={{ margin: 0, scale: '0.85' }}>Failed</Tag>
      case 'completed':
        return <Tag color="success" style={{ margin: 0, scale: '0.85' }}>Done</Tag>
      case 'paused':
        return <Tag color="warning" style={{ margin: 0, scale: '0.85' }}>Paused</Tag>
      default:
        return <Tag color="default" style={{ margin: 0, scale: '0.85' }}>{status}</Tag>
    }
  }

  const handleAddCustomModel = async () => {
    if (!newModelName || !newModelEndpoint) {
      Modal.error({ title: '添加失败', content: '模型名称和接口地址不能为空' })
      return
    }
    if (!newModelBase.trim()) {
      Modal.error({ title: '添加失败', content: '模型型号不能为空' })
      return
    }
    const now = new Date().toISOString()
    const normalizedEndpoint = newModelEndpoint.trim().replace(/\/+$/, '')
    const inferredApiMode: ModelApiMode = /deepseek/i.test(normalizedEndpoint) ? 'chat_completions' : newModelApiMode
    const newModel = {
      id: newModelName.toLowerCase().replace(/[^a-z0-9-_]+/g, '-'),
      name: newModelName,
      provider: 'openai_compatible' as const,
      baseUrl: normalizedEndpoint,
      apiKeyRef: newModelKey || undefined,
      modelName: newModelBase.trim(),
      apiMode: inferredApiMode,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }
    const updated = [...customModels, newModel]
    await saveCustomModels(updated)
    setNewModelName('')
    setNewModelEndpoint('')
    setNewModelKey('')
    setNewModelBase('')
    setNewModelApiMode('auto')
    Modal.success({ title: '保存成功', content: '自定义模型已保存写入' })
  }

  const handleDeleteCustomModel = async (modelId: string) => {
    const updated = customModels.filter(model => model.id !== modelId)
    await saveCustomModels(updated)
  }

  const handleSaveAssistantConfig = async () => {
    await updateSettings({
      wechatWebhook,
      wechatSecret,
      dingtalkWebhook,
      dingtalkSecret
    })
    Modal.success({ title: '保存成功', content: '全局助理集成配置已更新' })
  }

  const filterContent = (
    <div style={{ padding: '8px 4px', width: '220px', background: '#ffffff' }}>
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '8px' }}>筛选时间：</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {(['all', 'today', 'last_7_days', 'last_30_days'] as const).map(value => {
            const labels = { all: '全部时间', today: '今天', last_7_days: '最近 7 天', last_30_days: '最近 30 天' }
            const active = timeRange === value
            return (
              <Button
                key={value}
                type={active ? 'primary' : 'default'}
                size="small"
                onClick={() => setSidebarTimeRange(value)}
                style={{
                  textAlign: 'left',
                  borderRadius: '6px',
                  background: active ? '#0f172a' : 'transparent',
                  color: active ? '#ffffff' : '#475569',
                  border: active ? '1px solid #0f172a' : '1px solid #e2e8f0',
                  boxShadow: 'none',
                }}
              >
                {labels[value]}
              </Button>
            )
          })}
        </div>
      </div>
      <Divider style={{ margin: '8px 0' }} />
      <Button
        type="text"
        danger
        block
        onClick={() => {
          setSidebarTimeRange('all')
          setSidebarStatusFilter('all')
          setSidebarSearch('')
        }}
        style={{ fontSize: '12px', height: '28px', padding: 0 }}
      >
        清空筛选条件（重置）
      </Button>
    </div>
  )

  return (
    <Sider
      width={280}
      collapsedWidth={64}
      collapsible
      collapsed={collapsed}
      trigger={null}
      theme="light"
      style={{
        borderRight: '1px solid #e2e8f0',
        background: '#f8fafc',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '16px 12px' }}>
        {/* Brand Header with top-right actions */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          marginBottom: '20px',
          padding: '0 4px'
        }}>
          {!collapsed ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  background: '#0f172a',
                  color: '#ffffff',
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 'bold',
                  fontSize: '16px'
                }}>
                  W
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a', lineHeight: '1.2' }}>anybuddy</div>
                  <div style={{ fontSize: '10px', color: '#94a3b8' }}>v1.1.5 · local AI</div>
                </div>
              </div>
              <Space size={2}>
                <Tooltip title="收起侧边栏">
                  <Button
                    type="text"
                    size="small"
                    icon={<MenuFoldOutlined />}
                    onClick={() => setCollapsed(true)}
                    style={{ color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  />
                </Tooltip>
                <Tooltip title="搜索任务">
                  <Button
                    type="text"
                    size="small"
                    icon={<SearchOutlined />}
                    onClick={() => setShowSearchModal(true)}
                    style={{ color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  />
                </Tooltip>
                <Popover
                  content={filterContent}
                  trigger="click"
                  placement="bottomRight"
                  open={showFilterPopover}
                  onOpenChange={setShowFilterPopover}
                  overlayStyle={{ zIndex: 1050 }}
                >
                  <Tooltip title="筛选选项">
                    <Button
                      type="text"
                      size="small"
                      icon={<FilterOutlined />}
                      style={{ color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    />
                  </Tooltip>
                </Popover>
              </Space>
            </>
          ) : (
            <Button
              type="text"
              icon={<MenuUnfoldOutlined />}
              onClick={() => setCollapsed(false)}
              style={{ color: '#64748b' }}
            />
          )}
        </div>

        {/* Scrollable Navigation / Items Panel */}
        <div style={{ flex: 1, overflowY: 'auto', margin: '0 -4px', padding: '0 4px' }}>
          {/* Main Navigation Links */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '20px' }}>
            <NavLink
              to="/tasks/new"
              className={({ isActive }) => `sidebar-nav-item ${isActive && location.pathname === '/tasks/new' ? 'active' : ''}`}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 500,
                color: isActive && location.pathname === '/tasks/new' ? '#0f172a' : '#475569',
                background: isActive && location.pathname === '/tasks/new' ? '#e2e8f0' : 'transparent',
              })}
            >
              <PlusOutlined style={{ fontSize: '14px' }} />
              {!collapsed && <span>新建任务</span>}
            </NavLink>
            
            <NavLink
              to="/experts"
              className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 500,
                color: isActive ? '#0f172a' : '#475569',
                background: isActive ? '#e2e8f0' : 'transparent',
              })}
            >
              <Award size={16} />
              {!collapsed && <span>专家</span>}
            </NavLink>
          </div>

          {!collapsed && (
            <>
              <div style={{ marginBottom: '16px' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '4px 8px',
                  fontSize: '11px',
                  color: '#94a3b8',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  userSelect: 'none',
                }}>
                  <Space size={4}>
                    <span>运行中任务</span>
                    <Badge count={runningTasks.length} size="small" style={{ backgroundColor: '#dbeafe', color: '#1d4ed8', boxShadow: 'none' }} />
                  </Space>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px', paddingLeft: '4px' }}>
                  {runningTasks.map(({ run, task }) => (
                    <NavLink
                      key={run.id}
                      to={`/tasks/${task.id}`}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        padding: '8px 10px',
                        borderRadius: '8px',
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                          {task.title}
                        </span>
                        <Tag color={run.status === 'waiting_approval' ? 'warning' : run.status === 'paused' ? 'default' : 'processing'} style={{ margin: 0, fontSize: '10px' }}>
                          {run.status === 'waiting_approval' ? 'paused' : run.status}
                        </Tag>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#94a3b8' }}>
                        <span>{run.agentName}</span>
                        <span>{run.currentNode ?? 'idle'}</span>
                      </div>
                    </NavLink>
                  ))}
                  {!runningTasks.length && (
                    <div style={{ fontSize: '12px', color: '#94a3b8', padding: '8px', textAlign: 'center' }}>暂无运行中的任务</div>
                  )}
                </div>
              </div>

              {/* Tasks Accordion */}
              <div style={{ marginBottom: '16px' }}>
                <div
                  onClick={() => setTasksCollapsed(!tasksCollapsed)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '4px 8px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    color: '#94a3b8',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    userSelect: 'none',
                  }}
                >
                  <Space size={4}>
                    <span>任务</span>
                    <Badge count={filteredTasks.length} size="small" style={{ backgroundColor: '#e2e8f0', color: '#475569', boxShadow: 'none' }} />
                  </Space>
                  {tasksCollapsed ? <RightOutlined style={{ fontSize: '9px' }} /> : <DownOutlined style={{ fontSize: '9px' }} />}
                </div>

                {!tasksCollapsed && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '6px', paddingLeft: '4px' }}>
                    {filteredTasks.map(task => (
                      <NavLink
                        key={task.id}
                        to={`/tasks/${task.id}`}
                        style={({ isActive }) => ({
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          background: isActive ? '#ffffff' : 'transparent',
                          border: isActive ? '1px solid #e2e8f0' : '1px solid transparent',
                          boxShadow: isActive ? '0 2px 8px rgba(0,0,0,0.02)' : 'none',
                        })}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                            {task.title}
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center' }}>
                            {task.status === 'running' && <Badge status="processing" />}
                            {task.status === 'waiting_approval' && <Badge status="warning" />}
                            {task.status === 'failed' && <Badge status="error" />}
                            {task.status === 'completed' && <Badge status="success" />}
                            {task.status === 'paused' && <Badge status="warning" />}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#94a3b8' }}>
                          <span>{task.primaryWorkspaceName ?? 'No Workspace'}</span>
                          <span>{task.mode}</span>
                        </div>
                      </NavLink>
                    ))}
                    {!filteredTasks.length && (
                      <div style={{ fontSize: '12px', color: '#94a3b8', padding: '8px', textAlign: 'center' }}>暂无任务</div>
                    )}
                  </div>
                )}
              </div>

              {/* Workspaces Accordion */}
              <div style={{ marginBottom: '16px' }}>
                <div
                  onClick={() => setWorkspacesCollapsed(!workspacesCollapsed)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '4px 8px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    color: '#94a3b8',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    userSelect: 'none',
                  }}
                >
                  <Space size={4}>
                    <span>空间</span>
                    <Badge count={workspaces.length} size="small" style={{ backgroundColor: '#e2e8f0', color: '#475569', boxShadow: 'none' }} />
                  </Space>
                  {workspacesCollapsed ? <RightOutlined style={{ fontSize: '9px' }} /> : <DownOutlined style={{ fontSize: '9px' }} />}
                </div>

                {!workspacesCollapsed && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px', paddingLeft: '4px' }}>
                    {tasksByWorkspace.map(({ workspace }) => {
                      const expanded = expandedWorkspaceIds[workspace.id] ?? false
                      const wsTasksList = tasks.filter(t => t.primaryWorkspaceId === workspace.id)
                      return (
                        <div
                          key={workspace.id}
                          style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}
                          onMouseEnter={() => setHoveredWorkspaceId(workspace.id)}
                          onMouseLeave={() => setHoveredWorkspaceId(null)}
                        >
                          <div
                            onClick={() => {
                              toggleWorkspace(workspace.id)
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '6px 8px',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              background: hoveredWorkspaceId === workspace.id ? 'rgba(0, 0, 0, 0.03)' : 'transparent',
                              transition: 'background 0.2s',
                            }}
                          >
                            <Space size={8} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                              <FolderOutlined style={{ color: '#64748b' }} />
                              <span style={{ fontSize: '13px', fontWeight: 500, color: '#334155' }}>{workspace.name}</span>
                            </Space>

                            <Space size={2} onClick={e => e.stopPropagation()}>
                              {hoveredWorkspaceId === workspace.id && (
                                <Popover
                                  content={
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                      <Button
                                        type="text"
                                        size="small"
                                        icon={<FolderOpenOutlined />}
                                        style={{ textAlign: 'left', fontSize: '12px' }}
                                        onClick={async () => {
                                          const clients = createAnybuddyClients(window.anybuddy)
                                          await clients.workspace.openFolder(workspace.id)
                                        }}
                                      >
                                        打开文件夹
                                      </Button>
                                      <Button
                                        type="text"
                                        size="small"
                                        danger
                                        icon={<DeleteOutlined />}
                                        style={{ textAlign: 'left', fontSize: '12px' }}
                                        onClick={async () => {
                                          Modal.confirm({
                                            title: '移除工作空间',
                                            content: `确定要从列表中移除空间 "${workspace.name}" 吗？`,
                                            okText: '确认',
                                            cancelText: '取消',
                                            onOk: async () => {
                                              const clients = createAnybuddyClients(window.anybuddy)
                                              await clients.workspace.remove(workspace.id)
                                              const refreshed = await clients.workspace.list()
                                              if (refreshed.ok) {
                                                useAppStore.setState({ workspaces: refreshed.data })
                                              }
                                            }
                                          })
                                        }}
                                      >
                                        从列表中移除
                                      </Button>
                                    </div>
                                  }
                                  trigger="click"
                                  placement="bottomRight"
                                >
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={<MoreHorizontal size={14} />}
                                    style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                  />
                                </Popover>
                              )}
                              <Button
                                type="text"
                                size="small"
                                icon={expanded ? <DownOutlined style={{ fontSize: '10px' }} /> : <RightOutlined style={{ fontSize: '10px' }} />}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleWorkspace(workspace.id)
                                }}
                                style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              />
                            </Space>
                          </div>

                          {expanded && (
                            <div style={{
                              marginLeft: '14px',
                              paddingLeft: '10px',
                              borderLeft: '1px dashed #cbd5e1',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px',
                            }}>
                              {wsTasksList.map(task => (
                                <NavLink
                                  key={task.id}
                                  to={`/tasks/${task.id}`}
                                  style={({ isActive }) => ({
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '4px 8px',
                                    borderRadius: '4px',
                                    fontSize: '12px',
                                    color: isActive ? '#0f172a' : '#64748b',
                                    background: isActive ? '#e2e8f0' : 'transparent',
                                    fontWeight: isActive ? 600 : 500,
                                  })}
                                >
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>
                                    {task.title}
                                  </span>
                                  {getStatusTag(task.status)}
                                </NavLink>
                              ))}
                              {!wsTasksList.length && (
                                <div style={{ fontSize: '11px', color: '#94a3b8', padding: '4px 8px' }}>无任务</div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Sidebar Footer User Profile */}
        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px', marginTop: 'auto' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            padding: '4px'
          }}>
            <Dropdown menu={userMenuItems} trigger={['click']} placement="topRight">
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                cursor: 'pointer',
                overflow: 'hidden',
                width: '100%'
              }}>
                <Avatar size={32} icon={<UserOutlined />} style={{ backgroundColor: '#0f172a' }} />
                {!collapsed && (
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      syang
                    </span>
                    <span style={{ fontSize: '10px', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      Developer
                    </span>
                  </div>
                )}
              </div>
            </Dropdown>
          </div>
        </div>
      </div>

      {/* Global Search Modal */}
      <Modal
        open={showSearchModal}
        onCancel={() => setShowSearchModal(false)}
        footer={null}
        title="Search tasks"
        width={560}
        styles={{ body: { padding: '8px 0' } }}
      >
        <div style={{ padding: '0 16px 12px 16px' }}>
          <Input
            autoFocus
            size="large"
            placeholder="输入任务标题、工作空间或状态搜索..."
            prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
            value={search}
            onChange={event => setSidebarSearch(event.target.value)}
            style={{ borderRadius: '8px' }}
          />
        </div>
        <div style={{ maxHeight: '360px', overflowY: 'auto', padding: '0 16px' }}>
          {filteredTasks.map(task => (
            <div
              key={task.id}
              onClick={() => {
                navigate(`/tasks/${task.id}`)
                setShowSearchModal(false)
              }}
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                cursor: 'pointer',
                marginBottom: '6px',
                border: '1px solid #f1f5f9',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                transition: 'background 0.2s',
              }}
              className="search-result-item"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '13px', color: '#1e293b' }}>{task.title}</strong>
                {getStatusTag(task.status)}
              </div>
              <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: '#94a3b8' }}>
                <span>{task.primaryWorkspaceName ?? 'No Workspace'}</span>
                <span>·</span>
                <span>{task.mode}</span>
                <span>·</span>
                <span>{task.unreadEventCount} unread</span>
              </div>
            </div>
          ))}
          {!filteredTasks.length && (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
              未找到匹配的任务
            </div>
          )}
        </div>
      </Modal>

      {/* Global Settings Modal with Dual-column mockup layout */}
      <Modal
        open={showSettingsModal}
        onCancel={() => setShowSettingsModal(false)}
        footer={null}
        width={820}
        styles={{ body: { padding: 0 } }}
        style={{ top: '60px' }}
      >
        <div style={{ display: 'flex', height: '560px', borderRadius: '12px', overflow: 'hidden' }}>
          {/* Left Menu Sidebar */}
          <div style={{
            width: '200px',
            background: '#f8fafc',
            borderRight: '1px solid #f1f5f9',
            padding: '24px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', padding: '0 12px 12px 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>设置选项</div>
            {[
              { key: 'account', label: '账户管理', icon: <UserOutlined /> },
              { key: 'system', label: '系统设置', icon: <SettingOutlined /> },
              { key: 'models', label: '模型', icon: <DatabaseOutlined /> },
              { key: 'assistant', label: '助理设置', icon: <SlidersOutlined /> },
              { key: 'security', label: '安全中心', icon: <ShieldAlert size={15} /> },
            ].map(item => {
              const active = activeSettingsTab === item.key
              return (
                <div
                  key={item.key}
                  onClick={() => setActiveSettingsTab(item.key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: active ? 600 : 500,
                    color: active ? '#0f172a' : '#64748b',
                    background: active ? '#f1f5f9' : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </div>
              )
            })}
          </div>

          {/* Right Content Panel */}
          <div style={{ flex: 1, padding: '32px', display: 'flex', flexDirection: 'column', overflowY: 'auto', background: '#ffffff' }}>
            {activeSettingsTab === 'account' && (
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '24px' }}>账户管理</h2>
                <Card style={{ borderRadius: '12px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <Avatar size={64} icon={<UserOutlined />} style={{ backgroundColor: '#0f172a' }} />
                    <div>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>syang</div>
                      <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>Developer</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>本地工作台运行状态：正常</div>
                    </div>
                  </div>
                  <Divider />
                  <Button
                    type="primary"
                    danger
                    onClick={() => Modal.warning({ title: '提示', content: '个人工作台暂无登录系统，无需退出。' })}
                  >
                    退出当前账号
                  </Button>
                </Card>
              </div>
            )}

            {activeSettingsTab === 'system' && settings && (
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '24px' }}>系统设置</h2>
                <Form layout="vertical" initialValues={settings}>
                  <Form.Item label="允许访问外部网络" style={{ marginBottom: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', color: '#64748b' }}>允许 Agent 通过外部连接器进行 API 请求与信息获取</span>
                      <Switch
                        checked={settings.networkEnabled}
                        onChange={checked => updateSettings({ networkEnabled: checked })}
                      />
                    </div>
                  </Form.Item>

                  <Form.Item label="允许联网搜索" style={{ marginBottom: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', color: '#64748b' }}>当执行复杂研究任务时，允许 Agent 使用搜索引擎检索时效信息</span>
                      <Switch
                        checked={settings.webSearchEnabled}
                        onChange={checked => updateSettings({ webSearchEnabled: checked })}
                      />
                    </div>
                  </Form.Item>

                  <Form.Item label="最大并发运行任务数" style={{ marginBottom: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', color: '#64748b' }}>限制后台同时执行的 Agent 任务的最大数量（1-4）</span>
                      <Input
                        type="number"
                        min={1}
                        max={4}
                        value={settings.maxConcurrentRuns}
                        onChange={e => updateSettings({ maxConcurrentRuns: parseInt(e.target.value) || 2 })}
                        style={{ width: '120px', borderRadius: '6px' }}
                      />
                    </div>
                  </Form.Item>

                  <Form.Item label="默认工作区" style={{ marginBottom: '10px' }}>
                    <span style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '8px' }}>
                      新创建任务时，默认绑定的本地文件夹项目
                    </span>
                    <select
                      value={settings.defaultWorkspaceId ?? ''}
                      onChange={e => updateSettings({ defaultWorkspaceId: e.target.value || undefined })}
                      style={{ width: '100%', height: '36px', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '0 8px' }}
                    >
                      <option value="">无 (None)</option>
                      {workspaces.map(workspace => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.name}
                        </option>
                      ))}
                    </select>
                  </Form.Item>
                </Form>
              </div>
            )}

            {activeSettingsTab === 'models' && (
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>自定义模型</h2>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '20px' }}>
                  本地配置文件保存路径：<code>%USERPROFILE%\.anybuddy\models.json</code>
                </div>

                <div style={{ marginBottom: '24px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#334155', marginBottom: '12px' }}>已保存模型列表：</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {customModels.map(model => (
                      <div
                        key={model.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '10px 14px',
                          borderRadius: '8px',
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                        }}
                      >
                        <div>
                          <strong style={{ fontSize: '13px', color: '#0f172a' }}>{model.name}</strong>
                          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                            Base Model: {model.modelName} · Endpoint: {model.baseUrl}
                          </div>
                        </div>
                        <Button
                          danger
                          type="text"
                          size="small"
                          icon={<DeleteOutlined />}
                          onClick={() => handleDeleteCustomModel(model.id)}
                        />
                      </div>
                    ))}
                    {!customModels.length && (
                      <div style={{ fontSize: '12px', color: '#94a3b8', textAlign: 'center', padding: '16px' }}>
                        暂无自定义模型
                      </div>
                    )}
                  </div>
                </div>

                <Divider />

                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#334155', marginBottom: '16px' }}>添加本地模型：</div>
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <div>
                      <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>模型名称：</span>
                      <Input
                        placeholder="例如: local-llama3"
                        value={newModelName}
                        onChange={e => setNewModelName(e.target.value)}
                      />
                    </div>
                    <div>
                      <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>模型型号：</span>
                      <Input
                        placeholder="例如: gpt-4o-mini、deepseek-chat、qwen2.5-coder"
                        value={newModelBase}
                        onChange={e => setNewModelBase(e.target.value)}
                      />
                    </div>
                    <div>
                      <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>接口地址 (Endpoint)：</span>
                      <Input
                        placeholder="例如: http://localhost:11434/v1"
                        value={newModelEndpoint}
                        onChange={e => setNewModelEndpoint(e.target.value)}
                      />
                    </div>
                    <div>
                      <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>API 模式：</span>
                      <select
                        value={newModelApiMode}
                        onChange={e => setNewModelApiMode(e.target.value as ModelApiMode)}
                        style={{ width: '100%', height: '36px', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '0 8px' }}
                      >
                        <option value="auto">自动</option>
                        <option value="responses">Responses API</option>
                        <option value="chat_completions">Compatible Chat API</option>
                      </select>
                    </div>
                    <div>
                      <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>API Key (可选)：</span>
                      <Input.Password
                        placeholder="填入您的 API Token"
                        value={newModelKey}
                        onChange={e => setNewModelKey(e.target.value)}
                      />
                    </div>
                    <Button type="primary" onClick={handleAddCustomModel} style={{ background: '#0f172a', fontWeight: 600, marginTop: '8px' }}>
                      保存自定义模型
                    </Button>
                  </Space>
                </div>
              </div>
            )}

            {activeSettingsTab === 'assistant' && (
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '24px' }}>助理集成设置 (全局)</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <Card title="微信助理全局默认配置" style={{ borderRadius: '10px', border: '1px solid #f1f5f9' }} styles={{ body: { padding: '16px' } }}>
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <div>
                        <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Webhook 地址：</span>
                        <Input
                          placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
                          value={wechatWebhook}
                          onChange={e => setWechatWebhook(e.target.value)}
                        />
                      </div>
                      <div>
                        <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>签名密钥 (Secret)：</span>
                        <Input.Password
                          placeholder="请输入微信签名密钥"
                          value={wechatSecret}
                          onChange={e => setWechatSecret(e.target.value)}
                        />
                      </div>
                    </Space>
                  </Card>

                  <Card title="钉钉助理全局默认配置" style={{ borderRadius: '10px', border: '1px solid #f1f5f9' }} styles={{ body: { padding: '16px' } }}>
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <div>
                        <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Webhook 地址：</span>
                        <Input
                          placeholder="https://oapi.dingtalk.com/robot/send?access_token=xxx"
                          value={dingtalkWebhook}
                          onChange={e => setDingtalkWebhook(e.target.value)}
                        />
                      </div>
                      <div>
                        <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>安全设置密钥：</span>
                        <Input.Password
                          placeholder="请输入钉钉签名密钥"
                          value={dingtalkSecret}
                          onChange={e => setDingtalkSecret(e.target.value)}
                        />
                      </div>
                    </Space>
                  </Card>

                  <Button type="primary" onClick={handleSaveAssistantConfig} style={{ background: '#0f172a', fontWeight: 600, width: 'fit-content' }}>
                    保存全局参数
                  </Button>
                </div>
              </div>
            )}

            {activeSettingsTab === 'security' && settings && (
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '24px' }}>安全中心</h2>
                <Card style={{ borderRadius: '12px', border: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong style={{ fontSize: '14px', color: '#0f172a', display: 'block' }}>开启沙箱安全机制</strong>
                      <span style={{ fontSize: '12px', color: '#64748b', marginTop: '2px', display: 'block' }}>
                        启用时将隔离运行不安全的脚本和命令，需要人工审查和二次确认。
                      </span>
                    </div>
                    <Switch
                      checked={settings.sandboxEnabled ?? true}
                      onChange={checked => updateSettings({ sandboxEnabled: checked })}
                    />
                  </div>
                </Card>
              </div>
            )}
          </div>
        </div>
      </Modal>
    </Sider>
  )
}
