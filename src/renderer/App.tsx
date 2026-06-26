import { Navigate, Route, Routes } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import AppShell from './layout/AppShell.js'
import NewTaskPage from './pages/NewTaskPage.js'
import TaskDetailPage from './pages/TaskDetailPage.js'
import ExpertsPage from './pages/ExpertsPage.js'
import SettingsPage from './pages/SettingsPage.js'

export default function App() {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#0f172a',
          borderRadius: 10,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", sans-serif',
          colorLink: '#0f172a',
          colorLinkHover: '#334155',
          colorBgLayout: '#f8fafc',
        },
        components: {
          Button: {
            borderRadius: 8,
            colorPrimary: '#0f172a',
            colorPrimaryHover: '#334155',
            colorPrimaryActive: '#020617',
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
            colorPrimary: '#0f172a',
            colorPrimaryHover: '#334155',
            colorPrimaryActive: '#020617',
          },
          Card: {
            borderRadiusLG: 12,
          },
          Menu: {
            itemBorderRadius: 8,
            itemSelectedBg: '#f1f5f9',
            itemSelectedColor: '#0f172a',
          },
        },
      }}
    >
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/tasks/new" replace />} />
          <Route path="/tasks/new" element={<NewTaskPage />} />
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="/experts" element={<ExpertsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/tasks/new" replace />} />
        </Routes>
      </AppShell>
    </ConfigProvider>
  )
}


