import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createAnybuddyClients } from '../api/clients.js'
import { Input, Select, Button, Space, Divider, Popover, Checkbox, Tooltip, Modal, Tag } from 'antd'
import {
  PlusOutlined,
  SendOutlined,
  SlidersOutlined,
  LinkOutlined,
  FolderOpenOutlined,
  FileTextOutlined,
  SettingOutlined,
  InfoCircleOutlined,
  CloseOutlined,
  RightOutlined,
  CompassOutlined
} from '@ant-design/icons'
import type { CreateTaskInput, ExpertPreset, ModelApiMode, ModelConfig, TaskDraft, WorkspaceSummary } from '../../shared/types.js'
import { useAppStore } from '../stores/app-store.js'
import { useNavigate } from 'react-router-dom'

// Custom icons matching the user's screenshot
const CraftIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: 12 }}>
    <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M16 8L2 22" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M17.5 15H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    {/* Sparkle star */}
    <path d="M19 3h.01M22 6h.01M16 6h.01" fill="currentColor" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

const AskIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: 12 }}>
    <path d="M21 11.5C21 16.1944 16.9706 20 12 20C10.4289 20 8.95663 19.5969 7.68367 18.8911L3 20L4.25417 15.8236C3.4687 14.5772 3 13.0984 3 11.5C3 6.80558 7.02944 3 12 3C16.9706 3 21 6.80558 21 11.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 11.5C9.5 12.5 14.5 12.5 15 11.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)

const PlanIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: 12 }}>
    <rect x="5" y="4" width="14" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
    <path d="M9 2H15V5H9V2Z" fill="currentColor" stroke="currentColor" strokeWidth="1" />
    <path d="M9 9H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M9 13H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M9 17H13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)

const ExpertIcon = ({ color = '#475569' }: { color?: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: 12 }}>
    <circle cx="12" cy="13" r="7" stroke={color} strokeWidth="1.8" />
    <circle cx="9.5" cy="12.5" r="1" fill={color} />
    <circle cx="14.5" cy="12.5" r="1" fill={color} />
    <path d="M10.5 15.5C11 16 13 16 13.5 15.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    <path d="M12 6C12 4.5 14 3.5 15 4.5C16 5.5 14.5 7 12 7C10.5 7 9 8 9 9.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: 8, color: '#0f172a' }}>
    <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const BoyAvatar = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="16" cy="16" r="16" fill="#E0F2FE" />
    <path d="M9 16C9 11 11 9 16 9C21 9 23 11 23 16V18H9V16Z" fill="#1E293B" />
    <circle cx="16" cy="17" r="6" fill="#FED7AA" />
    <path d="M10 13C12 10 20 10 22 13C20 11 12 11 10 13Z" fill="#1E293B" />
    <path d="M9 12C10.5 10 14 10 15 12C16 10 19.5 10 21 12C20 9 11 9 9 12Z" fill="#1E293B" />
    <circle cx="14" cy="16.5" r="0.8" fill="#1E293B" />
    <circle cx="18" cy="16.5" r="0.8" fill="#1E293B" />
    <path d="M14.5 19C15 19.5 17 19.5 17.5 19" stroke="#1E293B" strokeWidth="0.8" strokeLinecap="round" />
    <circle cx="12.5" cy="17.8" r="0.6" fill="#FCA5A5" />
    <circle cx="19.5" cy="17.8" r="0.6" fill="#FCA5A5" />
    <circle cx="25" cy="25" r="5" fill="#22C55E" stroke="#FFFFFF" strokeWidth="1" />
    <path d="M23.5 24.5C23.5 23.7 24.2 23 25 23C25.8 23 26.5 23.7 26.5 24.5C26.5 25.3 25.8 26 25 26C24.7 26 24.5 25.9 24.3 25.8L23.5 26.2L23.7 25.4C23.6 25.1 23.5 24.8 23.5 24.5Z" fill="white" />
  </svg>
)

const MeituanAvatar = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="16" cy="16" r="16" fill="#FEF08A" />
    <path d="M12 12C11 7 13 4 14 5C15 6 14.5 9 14 12" fill="#FACC15" stroke="#EAB308" strokeWidth="0.5" />
    <path d="M20 12C21 7 19 4 18 5C17 6 17.5 9 18 12" fill="#FACC15" stroke="#EAB308" strokeWidth="0.5" />
    <circle cx="16" cy="17" r="7" fill="#FACC15" />
    <ellipse cx="16" cy="18.5" rx="3.5" ry="2.2" fill="#FFFFFF" />
    <ellipse cx="14" cy="16" rx="0.8" ry="1.2" fill="#1E293B" />
    <ellipse cx="18" cy="16" rx="0.8" ry="1.2" fill="#1E293B" />
    <circle cx="16" cy="17.8" r="0.6" fill="#1E293B" />
    <path d="M15 19C15.5 19.5 16.5 19.5 17 19" stroke="#1E293B" strokeWidth="0.6" strokeLinecap="round" />
  </svg>
)

const getExpertAvatar = (name: string) => {
  if (/设计|design/i.test(name)) return <BoyAvatar />
  if (/文档|doc/i.test(name)) return <MeituanAvatar />
  if (/搜索|调试|research/i.test(name)) return <BoyAvatar />
  return <BoyAvatar />
}

const MODE_OPTIONS: CreateTaskInput['mode'][] = ['ask', 'plan', 'craft']

export default function TaskComposer({
  workspaces,
  onCreate,
  onSend,
  defaultWorkspaceId,
  draft,
  onDraftChange,
  onClearDraft,
  onPickWorkspace,
  hideWorkspacePicker = false,
  hideTitle = false,
  buttonLabel
}: {
  workspaces: WorkspaceSummary[]
  onCreate?: (input: CreateTaskInput, initialMessage: string) => Promise<void>
  onSend?: (content: string, options: {
    mode: CreateTaskInput['mode']
    modelId: string
    skillIds: string[]
    connectorIds: string[]
    permissionMode: 'default' | 'full_access'
    expertIds: string[]
    activeExpertId?: string
  }) => Promise<void>
  defaultWorkspaceId?: string
  draft?: TaskDraft
  onDraftChange?: (draft: Omit<TaskDraft, 'taskId' | 'updatedAt'>) => Promise<void> | void
  onClearDraft?: () => Promise<void> | void
  onPickWorkspace?: () => Promise<WorkspaceSummary | undefined> | WorkspaceSummary | undefined
  hideWorkspacePicker?: boolean
  hideTitle?: boolean
  buttonLabel?: string
}) {
  const navigate = useNavigate()
  const workspaceOptions = useMemo(() => workspaces.filter(workspace => !workspace.isArchived), [workspaces])
  const customModels = useAppStore(state => state.customModels)
  const saveCustomModels = useAppStore(state => state.saveCustomModels)
  const recentExperts = useAppStore(state => state.recentExperts)
  const summonedExpert = useAppStore(state => state.summonedExpert)
  const setSummonedExpert = useAppStore(state => state.setSummonedExpert)
  const experts = useAppStore(state => state.experts)
  const defaultModelId = useMemo(
    () => customModels.find(model => model.enabled)?.id ?? customModels[0]?.id ?? '',
    [customModels],
  )
  const [title, setTitle] = useState('未命名任务')
  const [message, setMessage] = useState(draft?.content ?? '')
  const [mode, setMode] = useState<CreateTaskInput['mode']>('plan')
  const [modelId, setModelId] = useState(defaultModelId)
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId ?? workspaceOptions[0]?.id ?? '')
  const [attachedWorkspaceIds, setAttachedWorkspaceIds] = useState<string[]>([])
  const [skills, setSkills] = useState(draft?.selectedSkillIds.join(', ') || '')
  const [connectors, setConnectors] = useState(draft?.selectedConnectorIds.join(', ') || 'mcp')
  const [activeExpertId, setActiveExpertId] = useState<string | undefined>(draft?.selectedExpertId ?? draft?.selectedExpertIds?.[0])
  const [permissionMode, setPermissionMode] = useState<'default' | 'full_access'>('default')
  const [busy, setBusy] = useState(false)

  // Popover visible states
  const [showModePopover, setShowModePopover] = useState(false)
  const [showModelPopover, setShowModelPopover] = useState(false)
  const [showSkillsPopover, setShowSkillsPopover] = useState(false)
  const [showConnectorPopover, setShowConnectorPopover] = useState(false)
  const [showAttachPopover, setShowAttachPopover] = useState(false)
  const [showPermissionPopover, setShowPermissionPopover] = useState(false)
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false)
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
  const [showRecentExperts, setShowRecentExperts] = useState(false)

  // Search filter states
  const [skillSearch, setSkillSearch] = useState('')
  const [wsSearch, setWsSearch] = useState('')

  // Local model add state
  const [addingModel, setAddingModel] = useState(false)
  const [newModelName, setNewModelName] = useState('')
  const [newModelEndpoint, setNewModelEndpoint] = useState('')
  const [newModelKey, setNewModelKey] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('') // This is used to store manually entered Model ID
  const [newModelApiMode, setNewModelApiMode] = useState<ModelApiMode>('auto')

  const closeModeAndExpertPopovers = useCallback(() => {
    setShowModePopover(false)
    setShowRecentExperts(false)
  }, [])

  const scheduleCloseModeAndExpertPopovers = useCallback(() => {
    window.setTimeout(() => {
      closeModeAndExpertPopovers()
    }, 0)
  }, [closeModeAndExpertPopovers])

  // Close both popovers when clicking outside either popover or the trigger button
  useEffect(() => {
    if (!showModePopover && !showRecentExperts) return

    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement

      const insideMode = target.closest('.mode-popover-container')
      const insideExperts = target.closest('.experts-popover-container')
      const insideTrigger = target.closest('.mode-trigger-btn')
      const insideExpertTrigger = target.closest('.expert-trigger-btn')

      if (!insideMode && !insideExperts && !insideTrigger && !insideExpertTrigger) {
        scheduleCloseModeAndExpertPopovers()
      }
    }

    document.addEventListener('mousedown', handleOutsideClick, true)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick, true)
    }
  }, [scheduleCloseModeAndExpertPopovers, showModePopover, showRecentExperts])

  // Import custom skills locally - removed, now loaded from local .agents/skills directory
  // Load local skills from .agents/skills directory via IPC
  const [localSkills, setLocalSkills] = useState<string[]>([])
  const [skillsLoaded, setSkillsLoaded] = useState(false)
  useEffect(() => {
    const clients = createAnybuddyClients(window.anybuddy)
    void clients.config.listSkills().then(result => {
      if (result.ok) {
        setLocalSkills(result.data)
      }
      setSkillsLoaded(true)
    })
  }, [])

  const selectedSkillsList = useMemo(() => {
    const parsed = skills.split(',').map(s => s.trim()).filter(Boolean)
    if (!skillsLoaded) return parsed
    return parsed.filter(s => localSkills.includes(s))
  }, [skills, localSkills, skillsLoaded])

  const selectedConnectorsList = useMemo(() => {
    const parsed = connectors.split(',').map(c => c.trim()).filter(Boolean)
    const allowed = ['wechat', 'dingtalk', 'mcp', 'filesystem', 'web-search']
    return parsed.filter(c => allowed.includes(c))
  }, [connectors])

  const onDraftChangeRef = useRef(onDraftChange)

  useEffect(() => {
    onDraftChangeRef.current = onDraftChange
  }, [onDraftChange])

  useEffect(() => {
    if (!workspaceId && workspaceOptions[0]) {
      setWorkspaceId(workspaceOptions[0].id)
    }
  }, [workspaceId, workspaceOptions])

  useEffect(() => {
    const hasCurrent = customModels.some(model => model.id === modelId)
    if (!hasCurrent) {
      setModelId(defaultModelId)
    }
  }, [customModels, defaultModelId, modelId])

  const expertSelected = Boolean(activeExpertId) || Boolean(summonedExpert)

  function applyExpertSelection(expert: ExpertPreset | null) {
    if (!expert) {
      setSummonedExpert(null)
      setActiveExpertId(undefined)
      setSkills('')
      if (onCreate) {
        if (summonedExpert && message.trim() === `帮我创建一个 ${summonedExpert.name}，擅长 ${summonedExpert.description}。`) {
          setMessage('')
        }
      }
      return
    }

    setSummonedExpert(expert)
    setActiveExpertId(expert.id)
    setSkills(expert.skills.join(', '))
    if (onCreate) {
      setMessage(`帮我创建一个 ${expert.name}，擅长 ${expert.description}。`)
    }
  }

  function toggleExpertSelection(expert: ExpertPreset) {
    setActiveExpertId(prev => {
      const next = prev === expert.id ? undefined : expert.id
      if (!next) {
        setSummonedExpert(null)
        setSkills('')
        return undefined
      }

      setSummonedExpert(expert)
      setSkills(expert.skills.join(', '))
      return next
    })
  }

  function closeExpertPopovers() {
    setShowRecentExperts(false)
    setShowModePopover(false)
  }

  useEffect(() => {
    if (!draft) {
      return
    }

    const nextSkills = draft.selectedSkillIds.join(', ')
    const nextConnectors = draft.selectedConnectorIds.join(', ')
    const nextExpertId = draft.selectedExpertId ?? draft.selectedExpertIds?.[0] ?? ''
    if (
      draft.content === message &&
      nextSkills === skills &&
      nextConnectors === connectors &&
      nextExpertId === (activeExpertId ?? '')
    ) {
      return
    }

    setMessage(draft.content)
    setSkills(nextSkills)
    setConnectors(nextConnectors)
    setActiveExpertId(draft.selectedExpertId ?? draft.selectedExpertIds?.[0])

    if (draft.selectedExpertId || draft.selectedExpertIds?.length) {
      const firstExpert = experts.find(e => e.id === (draft.selectedExpertId ?? draft.selectedExpertIds?.[0]))
      if (firstExpert) {
        setSummonedExpert(firstExpert)
      }
    } else {
      setSummonedExpert(null)
    }
  }, [draft?.taskId, draft?.updatedAt, experts])

  useEffect(() => {
    onDraftChangeRef.current?.({
      content: message,
      selectedSkillIds: selectedSkillsList,
      selectedConnectorIds: selectedConnectorsList,
      selectedExpertIds: activeExpertId ? [activeExpertId] : [],
      selectedExpertId: activeExpertId,
    })
  }, [activeExpertId, selectedConnectorsList, message, selectedSkillsList])

  async function handlePickWorkspace() {
    const workspace = await onPickWorkspace?.()
    if (!workspace) {
      return
    }
    setWorkspaceId(workspace.id)
  }

  async function handleSubmit() {
    const initialMessage = message.trim()
    if (!initialMessage) return
    if (!modelId) {
      Modal.warning({ title: '请选择模型', content: '当前没有可用模型，请先添加或启用一个模型配置。' })
      setShowModelPopover(true)
      return
    }
    setBusy(true)
    try {
      if (onSend) {
        await onSend(initialMessage, {
          mode,
          modelId,
          skillIds: selectedSkillsList,
          connectorIds: selectedConnectorsList,
          permissionMode: permissionMode === 'full_access' ? 'full_access' : 'default',
          expertIds: activeExpertId ? [activeExpertId] : [],
          activeExpertId,
        })
      } else if (onCreate) {
        const taskTitle = title.trim() || initialMessage.split('\n')[0]?.slice(0, 80) || '未命名任务'
        await onCreate(
          {
            title: taskTitle,
            mode,
            modelId,
            workspaceId: workspaceId || undefined,
            additionalWorkspaceIds: attachedWorkspaceIds,
            permissionMode: permissionMode === 'full_access' ? 'full_access' : 'default',
            connectorIds: selectedConnectorsList,
            skillIds: selectedSkillsList,
            expertIds: activeExpertId ? [activeExpertId] : [],
            activeExpertId,
          },
          initialMessage,
        )
      }
      await onClearDraft?.()
      setMessage('')
    } catch (error) {
      Modal.error({
        title: onSend ? '发送失败' : '创建任务失败',
        content: error instanceof Error ? error.message : '发生未知错误，请查看控制台日志。',
      })
    } finally {
      setBusy(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  const allModels = useMemo(() => {
    return customModels.map(model => ({
      label: model.name,
      value: model.id,
      provider: model.provider,
      modelName: model.modelName,
      isCustom: model.provider !== 'builtin',
      enabled: model.enabled,
    }))
  }, [customModels])

  const availableSkills = useMemo(() => {
    if (!skillSearch.trim()) return localSkills
    return localSkills.filter(s => s.toLowerCase().includes(skillSearch.toLowerCase()))
  }, [localSkills, skillSearch])

  const handleRemoveCustomModel = async (nameToRemove: string) => {
    Modal.confirm({
      title: '删除模型',
      content: `确定要删除自定义模型 "${nameToRemove}" 吗？`,
      okText: '确定',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        const updated = customModels.filter(m => m.id !== nameToRemove)
        await saveCustomModels(updated)
        if (modelId === nameToRemove) {
          setModelId(updated.find(model => model.enabled)?.id ?? updated[0]?.id ?? '')
        }
        Modal.success({ title: '删除成功', content: '自定义模型已删除' })
      }
    })
  }

  const handleAddLocalModel = async () => {
    if (!newModelEndpoint.trim()) {
      Modal.error({ title: '添加失败', content: '接口地址不能为空' })
      return
    }
    if (!selectedModelId.trim()) {
      Modal.error({ title: '添加失败', content: '模型型号不能为空' })
      return
    }
    const now = new Date().toISOString()
    const finalName = newModelName.trim() || selectedModelId.trim()
    const normalizedId = finalName.toLowerCase().replace(/[^a-z0-9-_]+/g, '-')
    const apiKeyRef = newModelKey.trim()
    const normalizedEndpoint = newModelEndpoint.trim().replace(/\/+$/, '')
    const inferredApiMode: ModelApiMode = /deepseek/i.test(normalizedEndpoint) ? 'chat_completions' : newModelApiMode
    const newModel: ModelConfig = {
      id: normalizedId,
      name: finalName,
      provider: 'openai_compatible',
      baseUrl: normalizedEndpoint,
      apiKeyRef: apiKeyRef || undefined,
      modelName: selectedModelId.trim(),
      apiMode: inferredApiMode,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }
    const updated = [...customModels, newModel]
    await saveCustomModels(updated)
    setModelId(newModel.id)
    setNewModelName('')
    setNewModelEndpoint('')
    setNewModelKey('')
    setSelectedModelId('')
    setNewModelApiMode('auto')
    setAddingModel(false)
    Modal.success({ title: '保存成功', content: '自定义模型已添加' })
  }

  const currentWorkspaceName = useMemo(() => {
    const ws = workspaceOptions.find(w => w.id === workspaceId)
    return ws ? ws.name : '未选择工作空间'
  }, [workspaceId, workspaceOptions])

  const filteredWorkspaceOptions = useMemo(() => {
    if (!wsSearch.trim()) return workspaceOptions
    return workspaceOptions.filter(w => w.name.toLowerCase().includes(wsSearch.toLowerCase()))
  }, [wsSearch, workspaceOptions])

  return (
    <div style={{
      border: '1px solid #e2e8f0',
      borderRadius: '16px',
      padding: '16px',
      background: '#f8fafc',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.04)',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }}>
      {/* Title Row */}
      {!hideTitle && (
        <div style={{ display: 'flex', alignItems: 'center', paddingBottom: '8px', borderBottom: '1px solid #f1f5f9' }}>
          <Input
            variant="borderless"
            placeholder="给你的任务起个名字..."
            value={title}
            onChange={event => setTitle(event.target.value)}
            style={{
              fontSize: '15px',
              fontWeight: 600,
              color: '#1e293b',
              padding: 0
            }}
          />
        </div>
      )}

      {/* Selected Skills Block */}
      {selectedSkillsList.length > 0 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          padding: '8px 12px',
          background: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #f1f5f9'
        }}>
          <span style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', marginRight: '4px' }}>
            已加载技能:
          </span>
          {selectedSkillsList.map(skill => (
            <Tag
              key={skill}
              closable
              onClose={() => {
                const updated = selectedSkillsList.filter(s => s !== skill).join(', ')
                setSkills(updated)
              }}
              style={{
                background: '#f1f5f9',
                border: 'none',
                borderRadius: '4px',
                color: '#334155',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                margin: 0
              }}
            >
              {skill}
            </Tag>
          ))}
        </div>
      )}

      {/* Main Textarea Prompt Bar */}
      <Input.TextArea
        rows={6}
        value={message}
        onChange={event => setMessage(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={onSend ? "描述后续步骤或要求 Agent 继续执行..." : "描述你想让 Agent 做什么。你可以包含工作区、约束或粗略的计划。直接回车将触发创建..."}
        style={{
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          background: '#ffffff',
          padding: '12px',
          fontSize: '14px',
          color: '#334155'
        }}
      />

      {/* Floating Option Pills & Actions Bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
        paddingTop: '4px'
      }}>
        {/* Configuration Selectors */}
        <Space wrap size={6}>
          {/* Mode Option */}
            <Popover
              open={showModePopover}
              onOpenChange={(open) => {
                setShowModePopover(open)
                if (!open) {
                  setShowRecentExperts(false)
                }
              }}
              classNames={{ root: 'mode-popover-container' }}
              styles={{ content: { padding: '6px 8px', borderRadius: '12px' } }}
            content={
              <div style={{ width: '180px', display: 'flex', flexDirection: 'column', gap: '2px', position: 'relative' }}>
                {[
                  { value: 'craft', label: 'Craft', icon: <CraftIcon />, desc: 'CRAFT (执行模式): 完全自主的代码改写与写入' },
                  { value: 'ask', label: 'Ask', icon: <AskIcon />, desc: 'ASK (问答模式): 快速问答与检索，不改动代码' },
                  { value: 'plan', label: 'Plan', icon: <PlanIcon />, desc: 'PLAN (规划模式): 生成分步方案，确认后继续执行' }
                ].map(opt => {
                  const isSelected = mode === opt.value
                  const isHovered = hoveredItem === opt.value
                  return (
                    <div
                      key={opt.value}
                      onClick={() => {
                        setMode(opt.value as any)
                        setShowModePopover(false)
                      }}
                      onMouseEnter={() => setHoveredItem(opt.value)}
                      onMouseLeave={() => setHoveredItem(null)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '10px 12px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        background: (isSelected || isHovered) ? '#f1f5f9' : 'transparent',
                        transition: 'background 0.2s',
                        userSelect: 'none'
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', color: '#1e293b' }}>
                        {opt.icon}
                      </span>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#1e293b', flex: 1 }}>
                        {opt.label}
                      </span>
                      {isSelected && <CheckIcon />}
                      <Tooltip title={opt.desc} placement="right" mouseEnterDelay={0.5}>
                        <InfoCircleOutlined 
                          style={{ 
                            color: '#94a3b8', 
                            fontSize: '14px', 
                            cursor: 'help' 
                          }} 
                          onClick={(e) => e.stopPropagation()} 
                        />
                      </Tooltip>
                    </div>
                  )
                })}

                <Divider style={{ margin: '6px 0' }} />

                <div style={{ position: 'relative' }}>
                  <div
                    className="expert-trigger-btn"
                    onClick={(event) => {
                      event.stopPropagation()
                      setShowRecentExperts(prev => !prev)
                    }}
                    onMouseEnter={() => setHoveredItem('expert')}
                    onMouseLeave={() => setHoveredItem(null)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      background: (expertSelected || hoveredItem === 'expert' || showRecentExperts) ? '#f1f5f9' : 'transparent',
                      transition: 'background 0.2s',
                      userSelect: 'none'
                    }}
                  >
                    {expertSelected && summonedExpert ? (
                      <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, gap: '10px' }}>
                        {getExpertAvatar(summonedExpert.name)}
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {summonedExpert.name}
                          </span>
                          <span style={{ fontSize: '11px', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {summonedExpert.description || ''}
                          </span>
                        </div>
                        <CheckIcon />
                      </div>
                    ) : (
                      <>
                        <span style={{ display: 'flex', alignItems: 'center', color: '#1e293b' }}>
                          <ExpertIcon />
                        </span>
                        <span style={{ fontSize: '14px', fontWeight: 500, color: '#1e293b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          选择专家
                        </span>
                      </>
                    )}
                    <RightOutlined style={{ fontSize: '11px', color: '#94a3b8' }} />
                  </div>

                  {showRecentExperts && (
                    <div
                      className="experts-popover-container"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 'calc(100% + 8px)',
                        width: '220px',
                        padding: '10px 12px',
                        borderRadius: '12px',
                        background: '#ffffff',
                        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
                        border: '1px solid #e2e8f0',
                        zIndex: 1000
                      }}
                    >
                      <div style={{ fontSize: '12px', color: '#94a3b8', padding: '4px 8px 8px 8px', fontWeight: 500 }}>
                        选择当前专家
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                        {(() => {
                          const list = experts.map(exp => ({
                            id: exp.id,
                            name: exp.name,
                            sub: exp.description || '已包含专家',
                            avatar: getExpertAvatar(exp.name),
                            skills: exp.skills || [],
                            desc: exp.description || ''
                          }))

                          if (list.length === 0) {
                            return (
                              <div style={{ fontSize: '12px', color: '#94a3b8', padding: '8px' }}>
                                暂无可用专家，请前往专家页添加
                              </div>
                            )
                          }

                          return list.map(exp => {
                            const isExpSelected = activeExpertId === exp.id
                            const isExpHovered = hoveredItem === exp.name
                            return (
                              <div
                                key={exp.id}
                                onClick={() => {
                                  toggleExpertSelection({
                                    id: exp.id,
                                    name: exp.name,
                                    description: exp.desc,
                                    skills: exp.skills,
                                    createdAt: new Date().toISOString(),
                                    updatedAt: new Date().toISOString(),
                                  })
                                  setShowRecentExperts(false)
                                }}
                                onMouseEnter={() => setHoveredItem(exp.name)}
                                onMouseLeave={() => setHoveredItem(null)}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '10px',
                                  padding: '8px',
                                  borderRadius: '8px',
                                  cursor: 'pointer',
                                  background: isExpHovered ? '#f1f5f9' : 'transparent',
                                  transition: 'background 0.2s'
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, gap: '10px' }}>
                                  {exp.avatar}
                                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {exp.name}
                                    </span>
                                    <span style={{ fontSize: '11px', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {exp.sub}
                                    </span>
                                  </div>
                                </div>
                                <Checkbox checked={isExpSelected} style={{ pointerEvents: 'none' }} />
                              </div>
                            )
                          })
                        })()}
                      </div>

                      <Divider style={{ margin: '6px 0' }} />

                      <div
                        onClick={(event) => {
                          event.stopPropagation()
                          setShowRecentExperts(false)
                          navigate('/experts')
                        }}
                        onMouseEnter={() => setHoveredItem('other_experts')}
                        onMouseLeave={() => setHoveredItem(null)}
                        style={{
                          padding: '8px 10px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          color: '#4f46e5',
                          background: hoveredItem === 'other_experts' ? '#f1f5f9' : 'transparent',
                          transition: 'background 0.2s'
                        }}
                      >
                        <ExpertIcon color="#4f46e5" />
                        <span style={{ fontSize: '13px', fontWeight: 600 }}>管理专家库</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            }
            trigger="click"
            placement="bottomLeft"
          >
            <Button className="mode-trigger-btn" size="small" style={{ borderRadius: '6px', fontSize: '12px' }}>
              ⚡ 模式: {mode.toUpperCase()}
            </Button>
          </Popover>

          {/* Model Option */}
          <Popover
            open={showModelPopover}
            onOpenChange={setShowModelPopover}
            styles={{ content: { padding: '6px 8px', borderRadius: '12px' } }}
            content={
              <div style={{ width: '260px', padding: '2px 0' }}>
                {!addingModel ? (
                  <>
                    <div style={{ fontWeight: 600, fontSize: '11px', color: '#94a3b8', padding: '2px 8px 6px 8px', borderBottom: '1px solid #f1f5f9', marginBottom: '6px' }}>
                      切换底层大模型
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '180px', overflowY: 'auto' }}>
                      {allModels.length === 0 && (
                        <div style={{ fontSize: '12px', color: '#94a3b8', padding: '12px 8px', textAlign: 'center' }}>
                          暂无可用模型配置
                        </div>
                      )}
                      {allModels.map(m => {
                        const isSelected = modelId === m.value
                        return (
                          <div
                            key={m.value}
                            onClick={() => {
                              setModelId(m.value)
                              setShowModelPopover(false)
                            }}
                            style={{
                              padding: '6px 8px',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              background: isSelected ? '#f1f5f9' : 'transparent',
                              transition: 'background 0.2s',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              position: 'relative'
                            }}
                            onMouseEnter={e => !isSelected && (e.currentTarget.style.background = '#f8fafc')}
                            onMouseLeave={e => !isSelected && (e.currentTarget.style.background = 'transparent')}
                          >
                            <span style={{ fontSize: '12px', fontWeight: 500, color: isSelected ? '#0f172a' : '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '24px' }}>
                              🤖 {m.label}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {m.isCustom && (
                                <Tooltip title="删除此自定义模型">
                                  <CloseOutlined
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void handleRemoveCustomModel(m.value)
                                    }}
                                    style={{
                                      fontSize: '11px',
                                      color: '#94a3b8',
                                      cursor: 'pointer',
                                      padding: '2px',
                                      borderRadius: '4px',
                                      transition: 'all 0.2s',
                                    }}
                                    onMouseEnter={e => {
                                      e.currentTarget.style.color = '#ef4444'
                                      e.currentTarget.style.background = '#fee2e2'
                                    }}
                                    onMouseLeave={e => {
                                      e.currentTarget.style.color = '#94a3b8'
                                      e.currentTarget.style.background = 'transparent'
                                    }}
                                  />
                                </Tooltip>
                              )}
                              {isSelected && <span style={{ color: '#0f172a', fontSize: '11px', fontWeight: 'bold' }}>✓</span>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <Divider style={{ margin: '6px 0' }} />
                    <div style={{ padding: '0 4px' }}>
                      <Button
                        type="dashed"
                        block
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => setAddingModel(true)}
                        style={{ borderRadius: '6px', fontSize: '11px' }}
                      >
                        添加模型配置
                      </Button>
                    </div>
                  </>
                ) : (
                  <div style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontWeight: 600, fontSize: '12px', color: '#334155' }}>添加自定义模型 (兼容 OpenAI)</div>
                    <Input
                      placeholder="API 接口地址 (如 https://api.openai.com/v1)"
                      value={newModelEndpoint}
                      onChange={e => setNewModelEndpoint(e.target.value)}
                      size="small"
                      style={{ borderRadius: '4px' }}
                    />
                    <Input.Password
                      placeholder="API Key 环境变量名 (如 OPENAI_API_KEY)"
                      value={newModelKey}
                      onChange={e => setNewModelKey(e.target.value)}
                      size="small"
                      style={{ borderRadius: '4px' }}
                    />
                    <Select
                      value={newModelApiMode}
                      onChange={value => setNewModelApiMode(value)}
                      size="small"
                      style={{ width: '100%' }}
                      options={[
                        { value: 'auto', label: 'API 模式: 自动' },
                        { value: 'responses', label: 'API 模式: Responses API' },
                        { value: 'chat_completions', label: 'API 模式: Compatible Chat API' },
                      ]}
                    />
                    <Input
                      placeholder="模型型号 (如 gpt-4o)"
                      value={selectedModelId}
                      onChange={e => setSelectedModelId(e.target.value)}
                      size="small"
                      style={{ borderRadius: '4px' }}
                    />
                    <Input
                      placeholder="自定义显示名称 (如 My-GPT-4)"
                      value={newModelName}
                      onChange={e => setNewModelName(e.target.value)}
                      size="small"
                      style={{ borderRadius: '4px' }}
                    />

                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', marginTop: '6px' }}>
                      <Button 
                        size="small" 
                        onClick={() => {
                          setAddingModel(false)
                          setNewModelEndpoint('')
                          setNewModelKey('')
                          setSelectedModelId('')
                          setNewModelApiMode('auto')
                          setNewModelName('')
                        }} 
                        style={{ borderRadius: '4px', fontSize: '11px' }}
                      >
                        取消
                      </Button>
                      <Button 
                        size="small" 
                        type="primary" 
                        disabled={!newModelEndpoint.trim() || !selectedModelId.trim()}
                        style={{ 
                          background: (newModelEndpoint.trim() && selectedModelId.trim()) ? '#0f172a' : '#cbd5e1', 
                          border: 'none', 
                          borderRadius: '4px', 
                          fontSize: '11px',
                          color: '#ffffff'
                        }} 
                        onClick={handleAddLocalModel}
                      >
                        保存
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            }
            trigger="click"
            placement="bottomLeft"
          >
            <Button size="small" style={{ borderRadius: '6px', fontSize: '12px' }}>
              🤖 模型: {allModels.find(model => model.value === modelId)?.label ?? '未配置'}
            </Button>
          </Popover>

          {/* Composable Skills Popover */}
          <Popover
            open={showSkillsPopover}
            onOpenChange={setShowSkillsPopover}
            styles={{ content: { padding: '6px 8px', borderRadius: '10px' } }}
            content={
              <div style={{ width: '220px', padding: '2px 0' }}>
                <div style={{ fontWeight: 600, fontSize: '11px', color: '#94a3b8', padding: '2px 8px 6px 8px', borderBottom: '1px solid #f1f5f9', marginBottom: '8px' }}>
                  可用技能组合列表
                </div>
                <div style={{ padding: '0 8px 8px 8px' }}>
                  <Input
                    placeholder="检索技能包..."
                    size="small"
                    value={skillSearch}
                    onChange={e => setSkillSearch(e.target.value)}
                    style={{ borderRadius: '4px' }}
                  />
                </div>
                <div style={{ maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px', padding: '0 4px' }}>
                  {availableSkills.map(skill => {
                    const isChecked = selectedSkillsList.includes(skill)
                    return (
                      <div
                        key={skill}
                        onClick={() => {
                          let nextList
                          if (!isChecked) {
                            nextList = [...selectedSkillsList, skill]
                          } else {
                            nextList = selectedSkillsList.filter(s => s !== skill)
                          }
                          setSkills(nextList.join(', '))
                        }}
                        style={{
                          padding: '6px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          background: isChecked ? 'rgba(15, 23, 42, 0.03)' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          transition: 'background 0.2s'
                        }}
                        onMouseEnter={e => !isChecked && (e.currentTarget.style.background = '#f8fafc')}
                        onMouseLeave={e => !isChecked && (e.currentTarget.style.background = 'transparent')}
                      >
                        <span style={{ fontSize: '12px', color: isChecked ? '#0f172a' : '#475569', fontWeight: isChecked ? 600 : 500 }}>
                          {skill}
                        </span>
                        <Checkbox checked={isChecked} style={{ pointerEvents: 'none' }} />
                      </div>
                    )
                  })}
                  {availableSkills.length === 0 && (
                    <div style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'center', padding: '12px 0' }}>无匹配技能</div>
                  )}
                </div>
                </div>
            }
            trigger="click"
            placement="bottomLeft"
          >
            <Button size="small" style={{ borderRadius: '6px', fontSize: '12px' }}>
              🛠️ 技能 ({selectedSkillsList.length})
            </Button>
          </Popover>

          {/* App Connectors Popover */}
          <Popover
            open={showConnectorPopover}
            onOpenChange={setShowConnectorPopover}
            styles={{ content: { padding: '6px 8px', borderRadius: '10px' } }}
            content={
              <div style={{ width: '220px', padding: '2px 0' }}>
                <div style={{ fontWeight: 600, fontSize: '11px', color: '#94a3b8', padding: '2px 8px 6px 8px', borderBottom: '1px solid #f1f5f9', marginBottom: '8px' }}>
                  连接外部应用渠道
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '0 4px' }}>
                  {[
                    { label: '微信助手 (WeChat)', value: 'wechat', desc: '微信客户端消息推送' },
                    { label: '钉钉助手 (DingTalk)', value: 'dingtalk', desc: '钉钉机器人通知流水' },
                    { label: 'MCP 协议 (MCP Server)', value: 'mcp', desc: '大模型上下文协议网关' },
                    { label: '本地文件 (Filesystem)', value: 'filesystem', desc: '挂载主工作空间读写' },
                    { label: '网页搜索 (Search)', value: 'web-search', desc: '网页端多渠道搜索' }
                  ].map(opt => {
                    const isChecked = selectedConnectorsList.includes(opt.value)
                    return (
                      <div
                        key={opt.value}
                        onClick={() => {
                          let nextList
                          if (!isChecked) {
                            nextList = [...selectedConnectorsList, opt.value]
                          } else {
                            nextList = selectedConnectorsList.filter(c => c !== opt.value)
                          }
                          setConnectors(nextList.join(', '))
                        }}
                        style={{
                          padding: '6px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          background: isChecked ? 'rgba(15, 23, 42, 0.03)' : 'transparent',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px',
                          transition: 'background 0.2s'
                        }}
                        onMouseEnter={e => !isChecked && (e.currentTarget.style.background = '#f8fafc')}
                        onMouseLeave={e => !isChecked && (e.currentTarget.style.background = 'transparent')}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: isChecked ? '#0f172a' : '#334155' }}>
                            {opt.label}
                          </span>
                          <Checkbox checked={isChecked} style={{ pointerEvents: 'none' }} />
                        </div>
                        <span style={{ fontSize: '9px', color: '#94a3b8', lineHeight: '1.2' }}>{opt.desc}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            }
            trigger="click"
            placement="bottomLeft"
          >
            <Button size="small" style={{ borderRadius: '6px', fontSize: '12px' }}>
              🔗 连应用 ({selectedConnectorsList.length})
            </Button>
          </Popover>

          {/* Attached Workspaces Check List */}
          <Popover
            open={showAttachPopover}
            onOpenChange={setShowAttachPopover}
            styles={{ content: { padding: '6px 8px', borderRadius: '10px' } }}
            content={
              <div style={{ width: '220px', padding: '2px 0' }}>
                <div style={{ fontWeight: 600, fontSize: '11px', color: '#94a3b8', padding: '2px 8px 6px 8px', borderBottom: '1px solid #f1f5f9', marginBottom: '8px' }}>
                  挂载其他关联空间
                </div>
                {workspaceOptions.filter(w => w.id !== workspaceId).length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '0 4px' }}>
                    {workspaceOptions.filter(w => w.id !== workspaceId).map(w => {
                      const isChecked = attachedWorkspaceIds.includes(w.id)
                      return (
                        <div
                          key={w.id}
                          onClick={() => {
                            let nextList
                            if (!isChecked) {
                              nextList = [...attachedWorkspaceIds, w.id]
                            } else {
                              nextList = attachedWorkspaceIds.filter(id => id !== w.id)
                            }
                            setAttachedWorkspaceIds(nextList)
                          }}
                          style={{
                            padding: '6px 8px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            background: isChecked ? 'rgba(15, 23, 42, 0.03)' : 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            transition: 'background 0.2s'
                          }}
                          onMouseEnter={e => !isChecked && (e.currentTarget.style.background = '#f8fafc')}
                          onMouseLeave={e => !isChecked && (e.currentTarget.style.background = 'transparent')}
                        >
                          <span style={{ fontSize: '12px', color: isChecked ? '#0f172a' : '#475569' }}>📁 {w.name}</span>
                          <Checkbox checked={isChecked} style={{ pointerEvents: 'none' }} />
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'center', padding: '12px 0' }}>无可用的其他空间</div>
                )}
              </div>
            }
            trigger="click"
            placement="bottomLeft"
          >
            <Button size="small" style={{ borderRadius: '6px', fontSize: '12px' }}>
              📂 关联 ({attachedWorkspaceIds.length})
            </Button>
          </Popover>

          {/* Permission Mode Popover */}
          <Popover
            open={showPermissionPopover}
            onOpenChange={setShowPermissionPopover}
            styles={{ content: { padding: '6px 8px', borderRadius: '10px' } }}
            content={
              <div style={{ width: '220px', padding: '2px 0' }}>
                <div style={{ fontWeight: 600, fontSize: '11px', color: '#94a3b8', padding: '2px 8px 6px 8px', borderBottom: '1px solid #f1f5f9', marginBottom: '8px' }}>
                  执行安全控制级别
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '0 4px' }}>
                  {[
                    { value: 'default', label: '🔒 默认受限权限', desc: '写入和运行动作会暂停到恢复点，确认参数后继续。' },
                    { value: 'full_access', label: '🔑 完全访问权限', desc: '大模型可以自动无限制读写并免审批执行。' }
                  ].map(opt => {
                    const isSelected = permissionMode === opt.value
                    return (
                      <div
                        key={opt.value}
                        onClick={() => {
                          setPermissionMode(opt.value as any)
                          setShowPermissionPopover(false)
                        }}
                        style={{
                          padding: '8px 10px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          background: isSelected ? '#f1f5f9' : 'transparent',
                          transition: 'background 0.2s',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px',
                          border: isSelected ? '1px solid #cbd5e1' : '1px solid transparent'
                        }}
                        onMouseEnter={e => !isSelected && (e.currentTarget.style.background = '#f8fafc')}
                        onMouseLeave={e => !isSelected && (e.currentTarget.style.background = 'transparent')}
                      >
                        <span style={{ fontSize: '12px', fontWeight: 600, color: isSelected ? '#0f172a' : '#334155' }}>
                          {opt.label}
                        </span>
                        <span style={{ fontSize: '10px', color: '#94a3b8', lineHeight: '1.3' }}>{opt.desc}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            }
            trigger="click"
            placement="bottomLeft"
          >
            <Button size="small" style={{ borderRadius: '6px', fontSize: '12px' }}>
              🛡️ 权限: {permissionMode === 'full_access' ? '完全' : '默认'}
            </Button>
          </Popover>
        </Space>

        {/* Right Action buttons */}
        <Space size={8}>
          <Button
            type="primary"
            shape="round"
            icon={<SendOutlined />}
            onClick={handleSubmit}
            disabled={busy || !message.trim()}
            style={{ background: '#0f172a', fontWeight: 600, height: '32px', border: 'none' }}
          >
            {buttonLabel || (onSend ? '发送' : '创建任务')}
          </Button>
        </Space>
      </div>

      {/* Bottom Workspace Selector Bar */}
      {!hideWorkspacePicker && (
        <Popover
          open={showWorkspacePicker}
          onOpenChange={setShowWorkspacePicker}
          trigger="click"
          placement="bottomLeft"
          content={
            <div style={{ padding: '4px', width: '240px' }}>
              <div style={{ fontWeight: 600, fontSize: '12px', color: '#475569', marginBottom: '8px' }}>切换主工作空间</div>
              <Input
                placeholder="搜索工作空间..."
                size="small"
                value={wsSearch}
                onChange={e => setWsSearch(e.target.value)}
                style={{ marginBottom: '8px', borderRadius: '4px' }}
              />
              <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
                {filteredWorkspaceOptions.map(ws => (
                  <Button
                    key={ws.id}
                    type={workspaceId === ws.id ? 'primary' : 'text'}
                    block
                    size="small"
                    style={{
                      textAlign: 'left',
                      background: workspaceId === ws.id ? '#0f172a' : 'transparent',
                      color: workspaceId === ws.id ? '#ffffff' : '#334155',
                      borderRadius: '4px'
                    }}
                    onClick={() => {
                      setWorkspaceId(ws.id)
                      setShowWorkspacePicker(false)
                    }}
                  >
                    📁 {ws.name}
                  </Button>
                ))}
                {filteredWorkspaceOptions.length === 0 && (
                  <div style={{ fontSize: '12px', color: '#94a3b8', textAlign: 'center', padding: '12px 0' }}>无匹配空间</div>
                )}
              </div>
              <Divider style={{ margin: '8px 0' }} />
              <Button
                type="dashed"
                block
                size="small"
                icon={<PlusOutlined />}
                style={{ borderRadius: '4px' }}
                onClick={async () => {
                  setShowWorkspacePicker(false)
                  await handlePickWorkspace()
                }}
              >
                打开本地工作空间...
              </Button>
            </div>
          }
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            background: '#f1f5f9',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            cursor: 'pointer',
            marginTop: '4px',
            transition: 'background 0.2s',
            userSelect: 'none'
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#e2e8f0'}
          onMouseLeave={e => e.currentTarget.style.background = '#f1f5f9'}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#334155' }}>
              <FolderOpenOutlined style={{ color: '#64748b' }} />
              <span>主工作空间: <strong>{currentWorkspaceName}</strong></span>
            </div>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>点击切换 ▾</span>
          </div>
        </Popover>
      )}
    </div>
  )
}
