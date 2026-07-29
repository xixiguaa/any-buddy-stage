import { Navigate, Route, Routes } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import AppShell from './layout/AppShell.js'
import NewTaskPage from './pages/new-task/index.js'
import TaskDetailPage from './pages/task-detail/index.js'
import ExpertsPage from './pages/experts/index.js'
import SettingsPage from './pages/settings/index.js'
import InspirationPage from './pages/inspiration/index.js'

export default function App() {
  return (
    <ConfigProvider
      theme={{
        token: {
          /* 全局主色：紫色 #6F2BDC */
          colorPrimary: '#6F2BDC',
          borderRadius: 10,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", sans-serif',
          colorLink: '#6F2BDC',
          colorLinkHover: '#5B21B6',
          colorBgLayout: '#f8fafc',
        },
        components: {
          Button: {
            borderRadius: 8,
            colorPrimary: '#6F2BDC',
            colorPrimaryHover: '#5B21B6',
            colorPrimaryActive: '#4C1D95',
            controlHeight: 36,
          },
          Select: {
            borderRadius: 8,
            controlHeight: 36,
          },
          Input: {
            borderRadius: 8,
            controlHeight: 36,
          },
          Tabs: {
            colorPrimary: '#6F2BDC',
            colorPrimaryHover: '#5B21B6',
            colorPrimaryActive: '#4C1D95',
          },
          Card: {
            borderRadiusLG: 12,
          },
          Menu: {
            itemBorderRadius: 8,
            /* 菜单选中态浅紫背景与紫字 */
            itemSelectedBg: '#F5EEFF',
            itemSelectedColor: '#6F2BDC',
          },
        },
      }}
    >
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/tasks/new" replace />} />
          <Route path="/tasks/new" element={<NewTaskPage />} />
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="/inspiration" element={<InspirationPage />} />
          <Route path="/experts" element={<ExpertsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/tasks/new" replace />} />
        </Routes>
      </AppShell>
    </ConfigProvider>
  )
}


