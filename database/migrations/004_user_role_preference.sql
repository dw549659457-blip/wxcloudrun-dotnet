-- 已绑定员工重新登录仍记住上次身份；实际权限始终来自 UserRoles。
ALTER TABLE Users ADD COLUMN PreferredRole VARCHAR(16) NULL;
