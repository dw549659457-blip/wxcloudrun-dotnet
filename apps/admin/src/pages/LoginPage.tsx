import { useState } from 'react';
import { Button, Form, Input, Typography } from 'antd';
import { friendlyError } from '@warehouse/contracts';
import { useAuth } from '../hooks/useAuth';
import { ErrorNotice } from '../components/Common';
export function LoginPage() {
  const { login } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(values: { username: string; password: string }) {
    setPending(true);
    setError('');
    try {
      await login(values.username, values.password);
    } catch (failure) {
      setError(friendlyError(failure));
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark">菜</div>
        <Typography.Title level={1}>包装与蔬菜管理</Typography.Title>
        <p className="login-intro">内部管理后台</p>
        <ErrorNotice message={error} />
        <Form layout="vertical" onFinish={submit} requiredMark={false}>
          <Form.Item
            label="管理员账号"
            name="username"
            rules={[{ required: true, message: '请输入管理员账号' }]}
          >
            <Input autoComplete="username" size="large" />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password autoComplete="current-password" size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={pending}>
            进入管理后台
          </Button>
        </Form>
        <p className="muted">使用管理员预先创建的账号。员工请使用微信小程序。</p>
      </section>
    </main>
  );
}
