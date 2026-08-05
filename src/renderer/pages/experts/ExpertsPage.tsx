import { useState, useMemo, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Tabs, Card, Tag, Button, Space, Modal, Input, Row, Col, Empty, Tooltip, Select } from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  SearchOutlined,
  UploadOutlined,
  TeamOutlined,
  UserOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons'
import { useAppStore } from '../../stores/app-store.js'
import { createCulclawClients } from '../../api/clients.js'
import { rendererApi } from '../../api/bridge.js'
import type { ExpertPreset, ExpertTeamPreset } from '../../../shared/types.js'
import ImportSkillModal from '../../components/ImportSkillModal.js'

const SKILL_DESCRIPTIONS: Record<string, string> = {
  'frontend-design': '前端整体界面排版与视觉设计技能包',
  'design-taste-frontend': '反模版化、高审美视觉重构高级技能包',
  'doc-coauthoring': '多人联合文档与文本自动润色校对技能包',
  'writing-plans': '系统架构分解、步骤计划排期输出技能包',
  'systematic-debugging': '复杂代码报错精准定位与底层调试技能包',
  'web-search': '聚合网络多渠道精准搜集与总结要点技能包',
}

type SingleExpertSourceTask = {
  type: 'single_expert'
  taskId: string
  activeExpertId: string
  expertIds: string[]
}

function getSingleExpertSourceTask(state: unknown): SingleExpertSourceTask | undefined {
  if (!state || typeof state !== 'object') return undefined

  const sourceTask = (state as { sourceTask?: unknown }).sourceTask
  if (!sourceTask || typeof sourceTask !== 'object') return undefined

  const candidate = sourceTask as Partial<SingleExpertSourceTask>
  if (
    candidate.type !== 'single_expert' ||
    typeof candidate.taskId !== 'string' ||
    typeof candidate.activeExpertId !== 'string' ||
    !Array.isArray(candidate.expertIds) ||
    !candidate.expertIds.every(expertId => typeof expertId === 'string')
  ) {
    return undefined
  }

  return {
    type: candidate.type,
    taskId: candidate.taskId,
    activeExpertId: candidate.activeExpertId,
    expertIds: candidate.expertIds,
  }
}

export default function ExpertsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const saveDraft = useAppStore(state => state.saveDraft)
  const selectTask = useAppStore(state => state.selectTask)
  const setSummonedExpert = useAppStore(state => state.setSummonedExpert)
  const setSummonedExpertTeam = useAppStore(state => state.setSummonedExpertTeam)
  const experts = useAppStore(state => state.experts)
  const expertTeams = useAppStore(state => state.expertTeams)
  const createExpert = useAppStore(state => state.createExpert)
  const deleteExpert = useAppStore(state => state.deleteExpert)
  const mcpConfigRaw = useAppStore(state => state.mcpConfigRaw)
  // 仅接受任务内单专家入口携带的瞬态来源信息，不写入全局状态。
  const singleExpertSourceTask = getSingleExpertSourceTask(location.state)

  const [activeTab, setActiveTab] = useState('experts')
  const [expertSubTab, setExpertSubTab] = useState('single')
  const [skillSearch, setSkillSearch] = useState('')
  const [localSkills, setLocalSkills] = useState<string[]>([])
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)

  // Custom expert modal
  const [isExpertModalOpen, setIsExpertModalOpen] = useState(false)
  const [expertName, setExpertName] = useState('')
  const [expertDesc, setExpertDesc] = useState('')
  const [expertSkills, setExpertSkills] = useState<string[]>([])
  const [editingExpertId, setEditingExpertId] = useState<string | null>(null)

  // Viewing team & single expert details
  const [viewingTeam, setViewingTeam] = useState<ExpertTeamPreset | null>(null)
  const [viewingExpert, setViewingExpert] = useState<ExpertPreset | null>(null)

  const fetchSkills = () => {
    // 创建 Culclaw 客户端加载技能列表
    const clients = createCulclawClients(rendererApi)
    void clients.config.listSkills().then(result => {
      if (result.ok) {
        setLocalSkills(result.data)
      }
    })
  }

  useEffect(() => {
    fetchSkills()
  }, [])

  const allExperts = useMemo(() => experts, [experts])

  const filteredSkills = useMemo(() => {
    if (!skillSearch.trim()) return localSkills
    const query = skillSearch.toLowerCase()
    return localSkills.filter(name => {
      const description = SKILL_DESCRIPTIONS[name] ?? ''
      return name.toLowerCase().includes(query) || description.toLowerCase().includes(query)
    })
  }, [localSkills, skillSearch])

  const handleStartTask = async (expert: ExpertPreset) => {
    if (singleExpertSourceTask) {
      try {
        if (expert.id !== singleExpertSourceTask.activeExpertId) {
          const clients = createCulclawClients(rendererApi)
          const expertIds = singleExpertSourceTask.expertIds.includes(expert.id)
            ? singleExpertSourceTask.expertIds
            : [...singleExpertSourceTask.expertIds, expert.id]
          const updateResult = await clients.task.update(singleExpertSourceTask.taskId, {
            activeExpertId: expert.id,
            activeExpertTeamId: undefined,
            expertIds,
            skillIds: expert.skills,
          })
          if (!updateResult.ok) {
            throw new Error(updateResult.error.message)
          }

          // 保留未发送的输入内容，同时把草稿选择同步到刚切换的专家。
          const sourceDraft = useAppStore.getState().drafts[singleExpertSourceTask.taskId]
          if (sourceDraft) {
            await saveDraft(singleExpertSourceTask.taskId, {
              content: sourceDraft.content,
              selectedMode: sourceDraft.selectedMode,
              selectedSkillIds: expert.skills,
              selectedConnectorIds: sourceDraft.selectedConnectorIds,
              selectedExpertIds: [expert.id],
              selectedExpertId: expert.id,
              selectedExpertTeamId: undefined,
            })
          }
        }

        setSummonedExpert(expert, { addToRecent: true })
        setSummonedExpertTeam(null)
        await selectTask(singleExpertSourceTask.taskId)
        navigate(`/tasks/${singleExpertSourceTask.taskId}`, { replace: true })
      } catch (error) {
        Modal.error({
          title: '切换专家失败',
          content: error instanceof Error ? error.message : '请稍后重试',
        })
      }
      return
    }

    setSummonedExpert(expert, { addToRecent: true })
    setSummonedExpertTeam(null)
    const defaultPrompt = `帮我创建一个 ${expert.name}，擅长 ${expert.description}。我的经验是：[请在此补充您的行业背景与相关经验]`
    await saveDraft('__new_task__', {
      content: defaultPrompt,
      selectedSkillIds: expert.skills,
      selectedConnectorIds: ['mcp'],
      selectedExpertIds: [expert.id],
      selectedExpertId: expert.id,
      selectedExpertTeamId: undefined,
    })
    navigate('/tasks/new')
  }

  const handleStartTeamTask = async (team: ExpertTeamPreset) => {
    setSummonedExpertTeam(team)
    setSummonedExpert(null)
    const defaultPrompt = `帮我通过 ${team.name} 解决问题：[请在此补充您的具体开发与架构需求]`
    await saveDraft('__new_task__', {
      content: defaultPrompt,
      selectedSkillIds: [],
      selectedConnectorIds: ['mcp'],
      selectedExpertIds: [],
      selectedExpertId: undefined,
      selectedExpertTeamId: team.id,
    })
    navigate('/tasks/new')
  }

  const resetExpertModal = () => {
    setIsExpertModalOpen(false)
    setEditingExpertId(null)
    setExpertName('')
    setExpertDesc('')
    setExpertSkills([])
  }

  const openCreateExpertModal = () => {
    setEditingExpertId(null)
    setExpertName('')
    setExpertDesc('')
    setExpertSkills([])
    setIsExpertModalOpen(true)
  }

  const openEditExpertModal = (expert: ExpertPreset) => {
    setEditingExpertId(expert.id)
    setExpertName(expert.name)
    setExpertDesc(expert.description)
    setExpertSkills(expert.skills)
    setIsExpertModalOpen(true)
  }

  const handleCreateExpertPrompt = async () => {
    if (!expertName.trim() || !expertDesc.trim()) {
      Modal.error({ title: '提示', content: '请填写专家名称和定位描述' })
      return
    }
    if (expertSkills.length === 0) {
      Modal.error({ title: '提示', content: '请至少选择一个技能' })
      return
    }
    const isEditing = Boolean(editingExpertId)
    const tempExpert = await createExpert({
      id: editingExpertId ?? `custom-${Date.now()}`,
      name: expertName,
      description: expertDesc,
      skills: expertSkills,
      isCustom: true,
    })
    if (!tempExpert) {
      Modal.error({ title: '提示', content: isEditing ? '编辑专家失败' : '创建专家失败' })
      return
    }
    if (isEditing) {
      Modal.success({ title: '保存成功', content: '专家配置已更新' })
      resetExpertModal()
      return
    }
    await handleStartTask(tempExpert)
    resetExpertModal()
  }

  const expertSubTabItems = [
    {
      key: 'single',
      label: (
        <span>
          <UserOutlined style={{ marginRight: 6 }} />
          单专家
        </span>
      ),
      children: (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#334155' }}>专家库列表</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: 2 }}>专家是带有特定模式、技能和模型预设的 Agent 会话模板。</div>
            </div>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateExpertModal} style={{ background: '#6F2BDC', border: 'none' }}>
              添加自定义专家
            </Button>
          </div>

          <Row gutter={[16, 16]}>
            {allExperts.map(expert => (
              <Col xs={24} sm={12} md={8} key={expert.id}>
                <Card
                  hoverable
                  style={{ height: '100%', borderRadius: 12, border: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column' }}
                  styles={{ body: { padding: 18, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' } }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <strong style={{ fontSize: '14px', color: '#0f172a' }}>{expert.name}</strong>
                      {expert.isCustom ? (
                        <Space>
                          <Tag color="orange">自定义</Tag>
                          <Tooltip title="编辑专家">
                            <Button
                              type="text"
                              size="small"
                              icon={<EditOutlined />}
                              onClick={(e) => {
                                e.stopPropagation()
                                openEditExpertModal(expert)
                              }}
                            />
                          </Tooltip>
                          <Button
                            danger
                            type="text"
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={(e) => { e.stopPropagation(); void deleteExpert(expert.id) }}
                          />
                        </Space>
                      ) : (
                        <Tooltip title="点击查看详情">
                          <Tag
                            color="purple"
                            style={{ cursor: 'pointer' }}
                            onClick={(e) => {
                              e.stopPropagation()
                              setViewingExpert(expert)
                            }}
                          >
                            内置
                          </Tag>
                        </Tooltip>
                      )}
                    </div>
                    <p style={{ fontSize: '12px', color: '#64748b', lineHeight: '1.6', margin: '0 0 16px 0' }}>
                      {expert.description}
                    </p>
                  </div>
                  <div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 16 }}>
                      {expert.skills.map(skill => (
                        <Tag key={skill} style={{ margin: 0, fontSize: '10px' }}>{skill}</Tag>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                      <Button
                        type="default"
                        icon={<InfoCircleOutlined />}
                        onClick={() => setViewingExpert(expert)}
                        style={{ borderRadius: 6 }}
                      >
                        查看详情
                      </Button>
                      <Button
                        type="primary"
                        icon={<ThunderboltOutlined />}
                        onClick={() => handleStartTask(expert)}
                        style={{ flex: 1, borderRadius: 6, fontWeight: 500, background: '#6F2BDC', border: 'none' }}
                      >
                        基于专家发起任务
                      </Button>
                    </div>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        </div>
      ),
    },
    {
      key: 'team',
      label: (
        <span>
          <TeamOutlined style={{ marginRight: 6 }} />
          专家团
        </span>
      ),
      children: (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#334155' }}>专家团队列表</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: 2 }}>专家团是由多位不同角色 Agent 协同配合构成的多智能体团队。</div>
            </div>
          </div>

          <Row gutter={[16, 16]}>
            {expertTeams.map(team => (
              <Col xs={24} sm={12} md={12} key={team.id}>
                <Card
                  hoverable
                  style={{ height: '100%', borderRadius: 12, border: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column' }}
                  styles={{ body: { padding: 20, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' } }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <strong style={{ fontSize: '16px', color: '#0f172a' }}>{team.name}</strong>
                      <Tag color="purple">内置团队</Tag>
                    </div>
                    <p style={{ fontSize: '13px', color: '#475569', lineHeight: '1.6', margin: '0 0 16px 0' }}>
                      {team.description}
                    </p>

                    {/* 团队成员组成信息块 */}
                    <div style={{ background: '#f8fafc', borderRadius: 8, padding: 12, marginBottom: 16, maxWidth: '100%', boxSizing: 'border-box' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <TeamOutlined /> 团队成员组成 ({team.members.length}人):
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: '100%', boxSizing: 'border-box' }}>
                        {team.members.map(member => (
                          <div
                            key={member.id}
                            style={{
                              fontSize: '12px',
                              color: '#334155',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                              padding: '8px 10px',
                              background: '#ffffff',
                              borderRadius: 6,
                              border: '1px solid #f1f5f9',
                              maxWidth: '100%',
                              boxSizing: 'border-box',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', maxWidth: '100%' }}>
                              <span style={{ fontWeight: 600, color: '#0f172a' }}>
                                {member.name}
                              </span>
                              <span style={{ color: '#64748b', fontSize: '11px' }}>
                                ({member.role})
                              </span>
                            </div>
                            {member.specialty && (
                              /* 背景改为灰色 #f8fafc，字体改为紫色 #6F2BDC */
                              <div
                                style={{
                                  fontSize: '11px',
                                  color: '#6F2BDC',
                                  background: '#f8fafc',
                                  border: '1px solid #e2e8f0',
                                  borderRadius: '4px',
                                  padding: '4px 8px',
                                  lineHeight: '1.5',
                                  wordBreak: 'break-all',
                                  overflowWrap: 'anywhere',
                                  maxWidth: '100%',
                                  boxSizing: 'border-box',
                                }}
                              >
                                {member.specialty}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <Button
                      type="default"
                      icon={<InfoCircleOutlined />}
                      onClick={() => setViewingTeam(team)}
                      style={{ borderRadius: 6 }}
                    >
                      查看详情
                    </Button>
                    <Button
                      type="primary"
                      icon={<ThunderboltOutlined />}
                      onClick={() => handleStartTeamTask(team)}
                      style={{ flex: 1, borderRadius: 6, fontWeight: 500, background: '#6F2BDC', border: 'none' }}
                    >
                      基于专家团发起任务
                    </Button>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        </div>
      ),
    },
  ]

  const items = [
    {
      key: 'experts',
      label: (
        <span>
          <ThunderboltOutlined style={{ marginRight: 6 }} />
          专家
        </span>
      ),
      children: (
        <Tabs
          activeKey={expertSubTab}
          onChange={setExpertSubTab}
          items={expertSubTabItems}
          type="card"
          style={{ marginTop: 8 }}
        />
      ),
    },
    {
      key: 'skills',
      label: (
        <span>
          <EditOutlined style={{ marginRight: 6 }} />
          技能
        </span>
      ),
      children: (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#334155' }}>本地技能包</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: 2 }}>技能来自本地 ~/.culclaw/skills 目录，目录名即为技能名，含 SKILL.md 才被识别。</div>
            </div>
            <Space>
              <Input
                prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                placeholder="搜索技能..."
                value={skillSearch}
                onChange={e => setSkillSearch(e.target.value)}
                style={{ width: '200px', borderRadius: '6px' }}
              />
              <Button
                type="primary"
                icon={<UploadOutlined />}
                onClick={() => setIsImportModalOpen(true)}
                style={{ background: '#6F2BDC', border: 'none', borderRadius: '6px' }}
              >
                导入技能
              </Button>
            </Space>
          </div>
          <Row gutter={[16, 16]}>
            {filteredSkills.map(name => (
              <Col xs={24} sm={12} key={name}>
                <Card style={{ borderRadius: 10, border: '1px solid #f1f5f9' }} styles={{ body: { padding: 16 } }}>
                  <strong style={{ fontSize: '14px', color: '#0f172a', display: 'block', marginBottom: 8 }}>
                    {name}
                  </strong>
                  <p style={{ fontSize: '12px', color: '#64748b', margin: 0, lineHeight: '1.5' }}>
                    {SKILL_DESCRIPTIONS[name] ?? '本地技能包，目录名即为技能名。'}
                  </p>
                </Card>
              </Col>
            ))}
            {filteredSkills.length === 0 && (
              <Col span={24}>
                <Empty description="未找到匹配的技能" />
              </Col>
            )}
          </Row>
        </div>
      ),
    },
  ]

  return (
    <div style={{ padding: '24px', background: '#ffffff', minHeight: '100%', overflowY: 'auto' }}>
      <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 16, marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>专家与技能配置</h2>
        <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: 4 }}>配置专家预设或加载本地技能来拓展 Agent 的自主执行上限。</div>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={items}
        type="line"
      />

      {/* Expert Creation Modal */}
      <Modal
        open={isExpertModalOpen}
        onCancel={resetExpertModal}
        onOk={handleCreateExpertPrompt}
        centered
        title={editingExpertId ? '编辑自定义专家' : '添加自定义专家'}
        okText={editingExpertId ? '保存修改' : '前往对话创建'}
        cancelText="取消"
        /* 使用紫色主题色确定按钮 */
        okButtonProps={{
          style: {
            background: '#6F2BDC',
            borderColor: '#6F2BDC',
          },
        }}
      >
        <div style={{ padding: '8px 0', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>专家名称</div>
            <Input
              placeholder="例如：SQL调优大师, UI动效顾问..."
              value={expertName}
              onChange={e => setExpertName(e.target.value)}
            />
          </div>
          <div>
            <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>擅长描述 / 定位</div>
            <Input.TextArea
              rows={3}
              placeholder="描述该专家的核心特长与解决痛点..."
              value={expertDesc}
              onChange={e => setExpertDesc(e.target.value)}
            />
          </div>
          <div>
            <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>挂载技能</div>
            <Select
              mode="multiple"
              value={expertSkills}
              onChange={setExpertSkills}
              options={localSkills.map(skill => ({
                value: skill,
                label: skill,
              }))}
              placeholder="选择一个或多个技能"
              style={{ width: '100%' }}
              showSearch
              optionFilterProp="label"
            />
          </div>
        </div>
      </Modal>

      {/* 专家团队详情 Modal 弹窗 */}
      <Modal
        open={Boolean(viewingTeam)}
        onCancel={() => setViewingTeam(null)}
        centered
        footer={[
          <Button key="close" onClick={() => setViewingTeam(null)} style={{ borderRadius: 6 }}>
            关闭
          </Button>,
          <Button
            key="start"
            type="primary"
            icon={<ThunderboltOutlined />}
            style={{ background: '#6F2BDC', border: 'none', borderRadius: 6 }}
            onClick={() => {
              if (viewingTeam) {
                const team = viewingTeam
                setViewingTeam(null)
                void handleStartTeamTask(team)
              }
            }}
          >
            基于专家团发起任务
          </Button>,
        ]}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TeamOutlined style={{ color: '#6F2BDC' }} />
            <span>{viewingTeam?.name} 详情</span>
            <Tag color="purple">内置团队 (不可编辑)</Tag>
          </div>
        }
        width={720}
      >
        {viewingTeam && (
          <div style={{ padding: '12px 0', maxHeight: '70vh', overflowY: 'auto', maxWidth: '100%', boxSizing: 'border-box' }}>
            {/* 团队概述描述 */}
            <div style={{ marginBottom: 20, maxWidth: '100%', boxSizing: 'border-box' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: 6 }}>团队概述</div>
              <div
                style={{
                  fontSize: '14px',
                  color: '#1e293b',
                  background: '#f8fafc',
                  border: '1px solid #f1f5f9',
                  padding: '12px 16px',
                  borderRadius: 10,
                  lineHeight: '1.6',
                  wordBreak: 'break-all',
                  overflowWrap: 'anywhere',
                  maxWidth: '100%',
                  boxSizing: 'border-box',
                }}
              >
                {viewingTeam.description}
              </div>
            </div>

            {/* Agent 团队组成人员及分工 */}
            <div style={{ maxWidth: '100%', boxSizing: 'border-box' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <TeamOutlined style={{ color: '#6F2BDC' }} />
                <span>Agent 团队组成人员及分工 ({viewingTeam.members.length}人)</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: '100%', boxSizing: 'border-box' }}>
                {viewingTeam.members.map(member => (
                  <Card
                    key={member.id}
                    size="small"
                    style={{
                      borderRadius: 10,
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                    }}
                    styles={{ body: { padding: '14px 16px', maxWidth: '100%', boxSizing: 'border-box' } }}
                  >
                    {/* 头部：姓名、角色、擅长 (使用原生 CSS 文本徽章，完全替代 Tag 标签) */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8, maxWidth: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', maxWidth: '100%' }}>
                        <span style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a' }}>
                          {member.name}
                        </span>
                        <span style={{ fontSize: '11px', color: '#6F2BDC', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '2px 8px', borderRadius: '4px', fontWeight: 500 }}>
                          {member.role}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '11px',
                          /* 紫色主题背景与文字 */
                          color: '#6F2BDC',
                          background: '#F5EEFF',
                          border: '1px solid #E9D5FF',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          fontWeight: 500,
                          wordBreak: 'break-all',
                          overflowWrap: 'anywhere',
                          maxWidth: '100%',
                          boxSizing: 'border-box',
                          display: 'inline-block',
                        }}
                      >
                        {member.specialty}
                      </span>
                    </div>

                    {/* 提示词摘要：使用多行折行引言框 */}
                    <div
                      style={{
                        fontSize: '12px',
                        color: '#475569',
                        background: '#f8fafc',
                        borderLeft: '3px solid #6F2BDC',
                        padding: '10px 12px',
                        borderRadius: '0 6px 6px 0',
                        marginBottom: member.skills && member.skills.length > 0 ? 10 : 0,
                        lineHeight: '1.6',
                        wordBreak: 'break-all',
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                        maxWidth: '100%',
                        boxSizing: 'border-box',
                      }}
                    >
                      <strong style={{ color: '#334155' }}>提示词摘要：</strong>
                      {member.systemPrompt}
                    </div>

                    {/* 具备技能 (不用 Tag，改用原生轻量徽章) */}
                    {member.skills && member.skills.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8, maxWidth: '100%' }}>
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>具备技能:</span>
                        {member.skills.map(skill => (
                          <span
                            key={skill}
                            style={{
                              fontSize: '10px',
                              color: '#475569',
                              background: '#f1f5f9',
                              border: '1px solid #e2e8f0',
                              padding: '2px 6px',
                              borderRadius: '4px',
                            }}
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* 单专家详情 Modal 弹窗 */}
      <Modal
        open={Boolean(viewingExpert)}
        onCancel={() => setViewingExpert(null)}
        centered
        footer={[
          <Button key="close" onClick={() => setViewingExpert(null)} style={{ borderRadius: 6 }}>
            关闭
          </Button>,
          viewingExpert?.isCustom ? (
            <Button
              key="edit"
              icon={<EditOutlined />}
              onClick={() => {
                if (viewingExpert) {
                  const exp = viewingExpert
                  setViewingExpert(null)
                  openEditExpertModal(exp)
                }
              }}
              style={{ borderRadius: 6 }}
            >
              编辑专家
            </Button>
          ) : null,
          <Button
            key="start"
            type="primary"
            icon={<ThunderboltOutlined />}
            style={{ background: '#6F2BDC', border: 'none', borderRadius: 6 }}
            onClick={() => {
              if (viewingExpert) {
                const exp = viewingExpert
                setViewingExpert(null)
                void handleStartTask(exp)
              }
            }}
          >
            基于专家发起任务
          </Button>,
        ]}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserOutlined style={{ color: '#6F2BDC' }} />
            <span>{viewingExpert?.name} 详情</span>
            {viewingExpert?.isCustom ? (
              <Tag color="orange">自定义专家</Tag>
            ) : (
              <Tag color="purple">内置专家 (不可编辑)</Tag>
            )}
          </div>
        }
        width={600}
      >
        {viewingExpert && (
          <div style={{ padding: '12px 0', maxHeight: '70vh', overflowY: 'auto', maxWidth: '100%', boxSizing: 'border-box' }}>
            {/* 专家定位与描述 */}
            <div style={{ marginBottom: 20, maxWidth: '100%', boxSizing: 'border-box' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: 6 }}>专家定位与描述</div>
              <div
                style={{
                  fontSize: '14px',
                  color: '#1e293b',
                  background: '#f8fafc',
                  border: '1px solid #f1f5f9',
                  padding: '12px 16px',
                  borderRadius: 10,
                  lineHeight: '1.6',
                  wordBreak: 'break-all',
                  overflowWrap: 'anywhere',
                  maxWidth: '100%',
                  boxSizing: 'border-box',
                }}
              >
                {viewingExpert.description}
              </div>
            </div>

            {/* 挂载技能列表 */}
            <div style={{ marginBottom: 20, maxWidth: '100%', boxSizing: 'border-box' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: 8 }}>
                挂载技能 ({viewingExpert.skills.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: '100%', boxSizing: 'border-box' }}>
                {viewingExpert.skills.map(skill => (
                  <Tag key={skill} style={{ margin: 0, padding: '4px 10px', fontSize: '12px' }}>
                    {skill}
                  </Tag>
                ))}
              </div>
            </div>

            {/* 系统提示词（若存在） */}
            {viewingExpert.systemPrompt && (
              <div style={{ maxWidth: '100%', boxSizing: 'border-box' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: 6 }}>系统提示词 (System Prompt)</div>
                <div
                  style={{
                    fontSize: '12px',
                    color: '#475569',
                    background: '#f8fafc',
                    borderLeft: '3px solid #6F2BDC',
                    padding: '10px 12px',
                    borderRadius: '0 6px 6px 0',
                    lineHeight: '1.6',
                    wordBreak: 'break-all',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    maxWidth: '100%',
                    boxSizing: 'border-box',
                  }}
                >
                  {viewingExpert.systemPrompt}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ImportSkillModal
        open={isImportModalOpen}
        onCancel={() => setIsImportModalOpen(false)}
        onSuccess={() => fetchSkills()}
      />
    </div>
  )
}
