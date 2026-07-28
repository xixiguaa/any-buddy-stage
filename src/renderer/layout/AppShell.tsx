import type { ReactNode } from 'react'
import { Layout } from 'antd'
import Sidebar from './Sidebar.js'

const { Content } = Layout

/**
 * 应用主壳布局组件，包含侧边栏与主内容容器
 */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <Layout className="app-shell-root" style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      {/* 侧边栏导航组件 */}
      <Sidebar />
      {/* 主视图区域 */}
      <Layout className="main-pane" style={{ background: '#f1f5f9', display: 'flex', flexDirection: 'column', height: '100vh' }}>
        {/* 内容主体区块 */}
        <Content style={{ flex: 1, padding: '16px 16px 16px 0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div 
            className="main-content-container" 
            style={{ 
              flex: 1, 
              background: '#ffffff', 
              borderRadius: '20px', 
              border: '1px solid #e2e8f0', 
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.02)',
              display: 'flex', 
              flexDirection: 'column', 
              overflowY: 'auto' 
            }}
          >
            {children}
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}



