import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, hasCsrfToken, setCsrfToken } from '../api/client';
import type { AdminLogin, Identity } from '@warehouse/contracts';

interface AuthState {
  user: Identity | null;
  loading: boolean;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  can(permission: string): boolean;
}
const AuthContext = createContext<AuthState | null>(null);
function clearPrivateBrowserState(): void {
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith('warehouse:')) {
      sessionStorage.removeItem(key);
    }
  }
  setCsrfToken('');
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    async function restoreSession() {
      try {
        if (hasCsrfToken()) {
          const identity = await api.request<Identity>('GET', '/api/auth/me');
          if (
            active &&
            identity.sessionType === 'WEB_ADMIN' &&
            identity.roles.some((role) => ['ADMIN', 'ACCOUNTANT'].includes(role))
          ) {
            setUser(identity);
          }
        }
      } catch {
        if (active) {
          setCsrfToken('');
          setUser(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    void restoreSession();
    async function refreshPermissions() {
      if (!hasCsrfToken()) {
        return;
      }
      try {
        const identity = await api.request<Identity>('GET', '/api/auth/me');
        if (
          active &&
          identity.sessionType === 'WEB_ADMIN' &&
          identity.roles.some((role) => ['ADMIN', 'ACCOUNTANT'].includes(role))
        ) {
          setUser(identity);
        }
      } catch {
        /* 会话失效由统一 401 事件处理；网络失败保留当前页面。 */
      }
    }
    function expired() {
      setCsrfToken('');
      setUser(null);
    }
    window.addEventListener('warehouse:unauthorized', expired);
    window.addEventListener('focus', refreshPermissions);
    window.addEventListener('warehouse:permissions-changed', refreshPermissions);
    return () => {
      active = false;
      window.removeEventListener('warehouse:unauthorized', expired);
      window.removeEventListener('focus', refreshPermissions);
      window.removeEventListener('warehouse:permissions-changed', refreshPermissions);
    };
  }, []);
  async function login(username: string, password: string) {
    const result = await api.request<AdminLogin>('POST', '/api/auth/admin-login', {
      username,
      password,
    });
    const previousOwner = sessionStorage.getItem('warehouse:owner');
    if (previousOwner && previousOwner !== String(result.userId)) {
      clearPrivateBrowserState();
    }
    sessionStorage.setItem('warehouse:owner', String(result.userId));
    setCsrfToken(result.csrfToken);
    setUser({
      id: result.userId,
      name: result.name,
      roles: result.roles,
      sessionType: 'WEB_ADMIN',
      selectedRole: result.roles.includes('ADMIN') ? 'ADMIN' : 'ACCOUNTANT',
      permissions: result.permissions,
    });
  }
  async function logout() {
    try {
      await api.request('POST', '/api/auth/logout');
    } finally {
      setCsrfToken('');
      setUser(null);
    }
  }
  function can(permission: string): boolean {
    return Boolean(user?.roles.includes('ADMIN') || user?.permissions?.includes(permission));
  }
  return <AuthContext value={{ user, loading, login, logout, can }}>{children}</AuthContext>;
}
export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('AuthProvider未初始化');
  }
  return context;
}
