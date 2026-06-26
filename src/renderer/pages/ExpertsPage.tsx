import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Tabs, Card, Tag, Button, Space, Modal, Input, Checkbox, Form, Row, Col, Empty, Tooltip } from 'antd'
import { 
  SlidersOutlined, 
  LinkOutlined, 
  PlusOutlined, 
  SendOutlined, 
  EditOutlined, 
  DeleteOutlined,
  ThunderboltOutlined,
  SearchOutlined,
  CodeOutlined,
  SaveOutlined
} from '@ant-design/icons'
import { useAppStore } from '../stores/app-store.js'

interface Expert {
  id: string
  name: string
  description: string
  skills: string[]
  isCustom?: boolean
  systemPrompt?: string
}

const DEFAULT_EXPERTS: Expert[] = [
  {
    id: 'expert-design',
    name: '设计专家 (Design Agent)',
    description: '专注于应用结构布局、UI 交互语言、高保真组件形态及整体艺术风格重构。',
    skills: ['frontend-design', 'ui-ux-pro-max', 'design-taste-frontend'],
    systemPrompt: 'You are a principal designer expert. Guide the user in UI/UX and styling decisions.'
  },
  {
    id: 'expert-doc',
    name: '文档助手 (Doc Agent)',
    description: '撰写各种详尽的产品规格说明书、设计提案草案、开发排期计划书及长期沉淀文档。',
    skills: ['doc-coauthoring', 'writing-plans'],
    systemPrompt: 'You are a technical writer. Focus on grammar, structure, clarity and concise specs.'
  },
  {
    id: 'expert-research',
    name: '搜索与调试 (Research Agent)',
    description: '聚合多维网络搜索源，精准对比不同的系统架构方案，并辅助排除后台代码缺陷。',
    skills: ['web-search', 'systematic-debugging'],
    systemPrompt: 'You are a research engineer. Write shell commands, search the web and extract raw technical facts.'
  },
]

const SKILLS_LIST = [
  { id: 'frontend-design', name: 'frontend-design', desc: '前端整体界面排版与视觉设计技能包' },
  { id: 'design-taste-frontend', name: 'design-taste-frontend', desc: '反模版化、高审美视觉重构高级技能包' },
  { id: 'doc-coauthoring', name: 'doc-coauthoring', desc: '多人联合文档与文本自动润色校对技能包' },
  { id: 'writing-plans', name: 'writing-plans', desc: '系统架构分解、步骤计划排期输出技能包' },
  { id: 'systematic-debugging', name: 'systematic-debugging', desc: '复杂代码报错精准定位与底层调试技能包' },
  { id: 'web-search', name: 'web-search', desc: '聚合网络多渠道精准搜集与总结要点技能包' }
]

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
  const mcpConfigRaw = useAppStore(state => state.mcpConfigRaw)
  const saveMcpConfig = useAppStore(state => state.saveMcpConfig)
  
  const [activeTab, setActiveTab] = useState('experts')
  const [skillSearch, setSkillSearch] = useState('')
  const [customExperts, setCustomExperts] = useState<Expert[]>([])
  
  // Custom expert modals
  const [isExpertModalOpen, setIsExpertModalOpen] = useState(false)
  const [expertName, setExpertName] = useState('')
  const [expertDesc, setExpertDesc] = useState('')

  // Custom skill modals
  const [isSkillModalOpen, setIsSkillModalOpen] = useState(false)
  const [skillDesc, setSkillDesc] = useState('')

  // MCP Configuration text
  const [mcpConfigText, setMcpConfigText] = useState(mcpConfigRaw)

  useEffect(() => {
    setMcpConfigText(mcpConfigRaw)
  }, [mcpConfigRaw])

  const allExperts = useMemo(() => [...DEFAULT_EXPERTS, ...customExperts], [customExperts])

  const filteredSkills = useMemo(() => {
    if (!skillSearch.trim()) return SKILLS_LIST
    return SKILLS_LIST.filter(s => 
      s.name.toLowerCase().includes(skillSearch.toLowerCase()) || 
      s.desc.toLowerCase().includes(skillSearch.toLowerCase())
    )
  }, [skillSearch])

  const handleStartTask = async (expert: Expert) => {
    setSummonedExpert(expert)
    const defaultPrompt = `帮我创建一个 ${expert.name}，擅长 ${expert.description}。我的经验是：[请在此补充您的行业背景与相关经验]`
    await saveDraft('__new_task__', {
      content: defaultPrompt,
      selectedSkillIds: expert.skills,
      selectedConnectorIds: ['mcp'],
    })
    navigate('/tasks/new')
  }

  const handleCreateExpertPrompt = async () => {
    if (!expertName.trim() || !expertDesc.trim()) {
      Modal.error({ title: '提示', content: '请填写专家名称和定位描述' })
      return
    }
    const tempExpert = {
      id: `custom-${Date.now()}`,
      name: expertName,
      description: expertDesc,
      skills: ['writing-plans'],
      isCustom: true
    }
    setSummonedExpert(tempExpert)
    const prompt = `帮我创建一个 ${expertName}，擅长 ${expertDesc}。我的经验是：[请在此补充您的行业背景与相关经验]`
    await saveDraft('__new_task__', {
      content: prompt,
      selectedSkillIds: ['writing-plans'],
      selectedConnectorIds: ['mcp'],
    })
    setIsExpertModalOpen(false)
    setExpertName('')
    setExpertDesc('')
    navigate('/tasks/new')
  }

  const handleCreateSkillPrompt = async () => {
    if (!skillDesc.trim()) {
      Modal.error({ title: '提示', content: '请填写技能需求描述' })
      return
    }
    const prompt = `帮我编写一个技能包，该技能包用于：${skillDesc}`
    await saveDraft('__new_task__', {
      content: prompt,
      selectedSkillIds: ['doc-coauthoring'],
      selectedConnectorIds: ['mcp'],
    })
    setIsSkillModalOpen(false)
    setSkillDesc('')
    navigate('/tasks/new')
  }

  const handleLocalImportSkill = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e: any) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (evt) => {
        try {
          const json = JSON.parse(evt.target?.result as string)
          const importedName = json.name || json.id || file.name.replace('.json', '')
          Modal.success({ title: '导入成功', content: `本地技能 [${importedName}] 已解析并准备就绪` })
        } catch (err) {
          Modal.error({ title: '解析失败', content: '非法的 JSON 配置文件' })
        }
      }
      reader.readAsText(file)
    }
    input.click()
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
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsExpertModalOpen(true)} style={{ background: '#0f172a', border: 'none' }}>
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
                          <Button 
                            danger 
                            type="text" 
                            size="small" 
                            icon={<DeleteOutlined />} 
                            onClick={(e) => { e.stopPropagation(); setCustomExperts(customExperts.filter(ce => ce.id !== expert.id)) }} 
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
          <SlidersOutlined style={{ marginRight: 6 }} />
          技能
        </span>
      ),
      children: (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#334155' }}>系统技能包</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: 2 }}>技能是可以注入到任务上下文的能力配置包，引导 Agent 调用特定工具集。</div>
            </div>
            <Space>
              <Input
                prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                placeholder="搜索技能..."
                value={skillSearch}
                onChange={e => setSkillSearch(e.target.value)}
                style={{ width: '200px', borderRadius: '6px' }}
              />
              <Button type="default" icon={<PlusOutlined />} onClick={handleLocalImportSkill}>
                本地添加
              </Button>
              <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => setIsSkillModalOpen(true)} style={{ background: '#0f172a', border: 'none' }}>
                对话创建
              </Button>
            </Space>
          </div>
          <Row gutter={[16, 16]}>
            {filteredSkills.map(skill => (
              <Col xs={24} sm={12} key={skill.id}>
                <Card style={{ borderRadius: 10, border: '1px solid #f1f5f9' }} styles={{ body: { padding: 16 } }}>
                  <strong style={{ fontSize: '14px', color: '#0f172a', display: 'block', marginBottom: 8 }}>
                    {skill.name}
                  </strong>
                  <p style={{ fontSize: '12px', color: '#64748b', margin: 0, lineHeight: '1.5' }}>
                    {skill.desc}
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
        <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: 4 }}>配置专家预设或编辑 Composable 技能来拓展 Agent 的自主执行上限。</div>
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
        onCancel={() => setIsExpertModalOpen(false)}
        onOk={handleCreateExpertPrompt}
        title="添加自定义专家"
        okText="前往对话创建"
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
        </div>
      </Modal>

      {/* Skill Creation Modal */}
      <Modal
        open={isSkillModalOpen}
        onCancel={() => setIsSkillModalOpen(false)}
        onOk={handleCreateSkillPrompt}
        title="对话创建技能包"
        okText="前往对话创建"
        cancelText="取消"
      >
        <div style={{ padding: '8px 0' }}>
          <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>技能需求描述</div>
          <Input.TextArea
            rows={4}
            placeholder="描述你需要 Agent 编写什么技能包。如：编写一个自动生成接口测试报告的技能..."
            value={skillDesc}
            onChange={e => setSkillDesc(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  )
}
