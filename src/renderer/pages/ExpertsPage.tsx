import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Tabs, Card, Tag, Button, Space, Modal, Input, Row, Col, Empty, Tooltip, Select } from 'antd'
import {
  LinkOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  SearchOutlined,
  CodeOutlined,
  SaveOutlined
} from '@ant-design/icons'
import { useAppStore } from '../stores/app-store.js'
import { createAnybuddyClients } from '../api/clients.js'
import type { ExpertPreset } from '../../shared/types.js'

const SKILL_DESCRIPTIONS: Record<string, string> = {
  'frontend-design': '前端整体界面排版与视觉设计技能包',
  'design-taste-frontend': '反模版化、高审美视觉重构高级技能包',
  'doc-coauthoring': '多人联合文档与文本自动润色校对技能包',
  'writing-plans': '系统架构分解、步骤计划排期输出技能包',
  'systematic-debugging': '复杂代码报错精准定位与底层调试技能包',
  'web-search': '聚合网络多渠道精准搜集与总结要点技能包'
}

const CONNECTORS_LIST = [
  { id: 'wechat', name: '微信助手连接器', desc: '用于将 Agent 推送通知或在微信端执行异步响应' },
  { id: 'dingtalk', name: '钉钉助手连接器', desc: '集成钉钉机器人 Webhook 以同步会话记录和执行报告' },
  { id: 'mcp', name: 'MCP 连接器', desc: '符合模型上下文协议的标准外部服务网关' },
  { id: 'filesystem', name: '本地文件系统', desc: '直接挂载并操作受控工作空间文件夹的连接层' },
  { id: 'web-search', name: '搜索引擎连接器', desc: '对接 Google/Bing 搜索接口提供时效性信息的接口' }
]

export default function ExpertsPage() {
  const navigate = useNavigate()
  const saveDraft = useAppStore(state => state.saveDraft)
  const setSummonedExpert = useAppStore(state => state.setSummonedExpert)
  const experts = useAppStore(state => state.experts)
  const createExpert = useAppStore(state => state.createExpert)
  const deleteExpert = useAppStore(state => state.deleteExpert)
  const mcpConfigRaw = useAppStore(state => state.mcpConfigRaw)
  const saveMcpConfig = useAppStore(state => state.saveMcpConfig)

  const [activeTab, setActiveTab] = useState('experts')
  const [skillSearch, setSkillSearch] = useState('')
  const [localSkills, setLocalSkills] = useState<string[]>([])

  // Custom expert modal
  const [isExpertModalOpen, setIsExpertModalOpen] = useState(false)
  const [expertName, setExpertName] = useState('')
  const [expertDesc, setExpertDesc] = useState('')
  const [expertSkills, setExpertSkills] = useState<string[]>([])
  const [editingExpertId, setEditingExpertId] = useState<string | null>(null)

  // MCP Configuration text
  const [mcpConfigText, setMcpConfigText] = useState(mcpConfigRaw)

  useEffect(() => {
    setMcpConfigText(mcpConfigRaw)
  }, [mcpConfigRaw])

  useEffect(() => {
    const clients = createAnybuddyClients(window.anybuddy)
    void clients.config.listSkills().then(result => {
      if (result.ok) {
        setLocalSkills(result.data)
      }
    })
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
    setSummonedExpert(expert, { addToRecent: true })
    const defaultPrompt = `帮我创建一个 ${expert.name}，擅长 ${expert.description}。我的经验是：[请在此补充您的行业背景与相关经验]`
    await saveDraft('__new_task__', {
      content: defaultPrompt,
      selectedSkillIds: expert.skills,
      selectedConnectorIds: ['mcp'],
      selectedExpertIds: [expert.id],
      selectedExpertId: expert.id,
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
      isCustom: true
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
    setSummonedExpert(tempExpert, { addToRecent: true })
    const prompt = `帮我创建一个 ${expertName}，擅长 ${expertDesc}。我的经验是：[请在此补充您的行业背景与相关经验]`
    await saveDraft('__new_task__', {
      content: prompt,
      selectedSkillIds: expertSkills,
      selectedConnectorIds: ['mcp'],
      selectedExpertIds: [tempExpert.id],
      selectedExpertId: tempExpert.id,
    })
    resetExpertModal()
    navigate('/tasks/new')
  }

  const handleSaveMcp = async () => {
    try {
      JSON.parse(mcpConfigText)
      await saveMcpConfig(mcpConfigText)
      Modal.success({ title: '保存成功', content: 'MCP 配置文件已更新写入 ~/.anybuddy/mcp.json' })
    } catch (err) {
      Modal.error({ title: '保存失败', content: '非法的 JSON 格式，请检查语法' })
    }
  }

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
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#334155' }}>专家库列表</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: 2 }}>专家是带有特定模式、技能和模型预设的 Agent 会话模板。</div>
            </div>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateExpertModal} style={{ background: '#0f172a', border: 'none' }}>
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
                        <Tag color="blue">内置</Tag>
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
                    <Button
                      type="default"
                      icon={<ThunderboltOutlined />}
                      block
                      onClick={() => handleStartTask(expert)}
                      style={{ borderRadius: 6, fontWeight: 500 }}
                    >
                      基于专家发起任务
                    </Button>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        </div>
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
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: 2 }}>技能来自本地 .agents/skills 目录，目录名即为技能名，含 SKILL.md 才被识别。</div>
            </div>
            <Input
              prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
              placeholder="搜索技能..."
              value={skillSearch}
              onChange={e => setSkillSearch(e.target.value)}
              style={{ width: '200px', borderRadius: '6px' }}
            />
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
    {
      key: 'connectors',
      label: (
        <span>
          <LinkOutlined style={{ marginRight: 6 }} />
          连接器
        </span>
      ),
      children: (
        <div>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#334155' }}>外部应用连接器</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: 2 }}>连接器是 MCP Server 或外部应用通知钩子，允许 Agent 获取或写入外部数据。</div>
          </div>
          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            {CONNECTORS_LIST.map(conn => (
              <Col xs={24} sm={12} md={8} key={conn.id}>
                <Card style={{ borderRadius: 10, border: '1px solid #f1f5f9', height: '100%' }} styles={{ body: { padding: 16 } }}>
                  <strong style={{ fontSize: '14px', color: '#0f172a', display: 'block', marginBottom: 8 }}>
                    {conn.name}
                  </strong>
                  <p style={{ fontSize: '12px', color: '#64748b', margin: 0, lineHeight: '1.5' }}>
                    {conn.desc}
                  </p>
                </Card>
              </Col>
            ))}
          </Row>

          {/* MCP Config Direct Edit Section */}
          <div style={{
            borderTop: '1px solid #f1f5f9',
            paddingTop: '20px',
            marginTop: '20px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CodeOutlined />
                  <span>MCP 配置文件直编 (~/.anybuddy/mcp.json)</span>
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                  直接在此编辑 MCP 服务网关参数，点击保存将同步更新到磁盘。
                </div>
              </div>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                style={{ background: '#0f172a', border: 'none' }}
                onClick={handleSaveMcp}
              >
                保存配置
              </Button>
            </div>
            <Input.TextArea
              value={mcpConfigText}
              onChange={e => setMcpConfigText(e.target.value)}
              rows={12}
              style={{
                fontFamily: 'Consolas, Monaco, monospace',
                fontSize: '12px',
                background: '#0f172a',
                color: '#38bdf8',
                borderRadius: '8px',
                border: '1px solid #1e293b',
                padding: '12px'
              }}
            />
          </div>
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
        title={editingExpertId ? '编辑自定义专家' : '添加自定义专家'}
        okText={editingExpertId ? '保存修改' : '前往对话创建'}
        cancelText="取消"
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
    </div>
  )
}
