import { lazy, Suspense, useEffect, useState } from 'react';
import { Button, ConfigProvider, Layout, Menu, Result, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  archiveLabels,
  documentLabels,
  isDocumentResource,
  reportLabels,
  type ArchiveResource,
  type ReportName,
} from '@warehouse/contracts';
import { useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/LoginPage';
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
);
const ArchivesPage = lazy(() =>
  import('./pages/ArchivesPage').then((module) => ({ default: module.ArchivesPage })),
);
const UsersPage = lazy(() =>
  import('./pages/UsersPage').then((module) => ({ default: module.UsersPage })),
);
const StockPage = lazy(() =>
  import('./pages/StockPage').then((module) => ({ default: module.StockPage })),
);
const DocumentsPage = lazy(() =>
  import('./pages/DocumentsPage').then((module) => ({ default: module.DocumentsPage })),
);
const ReportsPage = lazy(() =>
  import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })),
);
const BindingsPage = lazy(() =>
  import('./pages/BindingsPage').then((module) => ({ default: module.BindingsPage })),
);
const AuditPage = lazy(() =>
  import('./pages/AuditPage').then((module) => ({ default: module.AuditPage })),
);

export function App() {
  const auth = useAuth();
  const [path, setPath] = useState(location.pathname);
  const [collapsed, setCollapsed] = useState(false);
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  useEffect(() => {
    const section = path.split('/')[2];
    setOpenKeys(
      ['archives', 'documents', 'reports'].includes(section)
        ? [section]
        : ['users', 'bindings'].includes(section)
          ? ['people']
          : [],
    );
  }, [path]);
  useEffect(() => {
    function update() {
      setPath(location.pathname);
    }
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  function navigate(next: string) {
    history.pushState({}, '', next);
    setPath(next);
    window.scrollTo(0, 0);
  }
  function content() {
    if (path === '/admin/' || path === '/admin' || path === '/admin/dashboard') {
      return <DashboardPage navigate={navigate} />;
    }
    if (path === '/admin/users') {
      return <UsersPage />;
    }
    if (path === '/admin/bindings') {
      return <BindingsPage />;
    }
    if (path === '/admin/stock') {
      return <StockPage />;
    }
    if (path === '/admin/audit') {
      return <AuditPage />;
    }
    const category = path.split('/')[2];
    const name = path.split('/')[3] ?? '';
    if (category === 'archives' && Object.hasOwn(archiveLabels, name)) {
      return <ArchivesPage key={name} resource={name as ArchiveResource} />;
    }
    if (category === 'documents' && isDocumentResource(name)) {
      return <DocumentsPage key={name} resource={name} />;
    }
    if (category === 'reports' && Object.hasOwn(reportLabels, name)) {
      return <ReportsPage key={name} name={name as ReportName} />;
    }
    return (
      <Result
        status="404"
        title="没有这个管理页面"
        extra={<Button onClick={() => navigate('/admin/dashboard')}>返回概览</Button>}
      />
    );
  }
  const menu = [
    { key: '/admin/dashboard', label: '仓库概览' },
    { key: '/admin/stock', label: '库存入库与调整' },
    {
      key: 'archives',
      label: '基础档案',
      children: Object.entries(archiveLabels).map(([key, label]) => ({
        key: `/admin/archives/${key}`,
        label: `${label}档案`,
      })),
    },
    {
      key: 'people',
      label: '员工与身份',
      children: [
        { key: '/admin/users', label: '员工与角色' },
        { key: '/admin/bindings', label: '开通协助审批' },
      ],
    },
    {
      key: 'documents',
      label: '全量业务单据',
      children: Object.entries(documentLabels).map(([key, label]) => ({
        key: `/admin/documents/${key}`,
        label,
      })),
    },
    {
      key: 'reports',
      label: '台账与报表',
      children: Object.entries(reportLabels).map(([key, label]) => ({
        key: `/admin/reports/${key}`,
        label,
      })),
    },
    { key: '/admin/audit', label: '管理审计' },
  ];
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#176747',
          colorInfo: '#176747',
          borderRadius: 10,
          fontSize: 15,
          colorBgLayout: '#f3f6f2',
        },
      }}
    >
      {auth.loading ? (
        <div className="full-loading">
          <Spin size="large" tip="正在确认登录状态" />
        </div>
      ) : !auth.user ? (
        <LoginPage />
      ) : (
        <Layout className="admin-layout">
          <Layout.Sider
            theme="light"
            width={244}
            breakpoint="lg"
            collapsedWidth={0}
            collapsed={collapsed}
            onCollapse={setCollapsed}
          >
            <div className="sidebar-brand">
              <span className="brand-mark">菜</span>
              <div>
                <b>包装与蔬菜</b>
                <small>内部管理后台</small>
              </div>
            </div>
            <Menu
              mode="inline"
              selectedKeys={[path === '/admin/' ? '/admin/dashboard' : path]}
              openKeys={openKeys}
              onOpenChange={(keys) => setOpenKeys(keys.length ? [keys[keys.length - 1]] : [])}
              items={menu}
              onClick={({ key }) => navigate(key)}
            />
          </Layout.Sider>
          <Layout>
            <Layout.Header className="admin-header">
              <Button onClick={() => setCollapsed(!collapsed)}>菜单</Button>
              <div>
                <b>{auth.user.name}</b>
                <span className="muted"> · 管理员</span>
                <Button
                  type="text"
                  onClick={() => {
                    void auth.logout();
                  }}
                >
                  退出登录
                </Button>
              </div>
            </Layout.Header>
            <Layout.Content className="admin-content">
              <Suspense fallback={<Spin tip="正在加载页面" />}>{content()}</Suspense>
            </Layout.Content>
            <Layout.Footer className="admin-footer">
              包装与蔬菜库存管理 · 数量按单位核对 · 所有入账操作保留流水
            </Layout.Footer>
          </Layout>
        </Layout>
      )}
    </ConfigProvider>
  );
}
