import { createRoot } from 'react-dom/client';
import { AuthProvider } from './hooks/useAuth';
import { App } from './App';
import './styles.css';
const element = document.getElementById('root');
if (!element) {
  throw new Error('缺少管理页面挂载点');
}
createRoot(element).render(
  <AuthProvider>
    <App />
  </AuthProvider>,
);
