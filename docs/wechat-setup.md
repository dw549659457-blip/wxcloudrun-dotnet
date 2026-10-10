# 微信端后续接入

本次后台已提供真实微信适配器，小程序页面未包含在本次交付，没有可导入的miniprogram目录。前端实现时使用原生微信小程序，不把网页当作小程序。

从控制台复制实际环境ID和服务名，在小程序初始化wx.cloud。每次调用wx.cloud.callContainer的config.env取实际值，header中X-WX-SERVICE取实际服务名，path以/api/开头；登录流程先wx.login，将code发送auth/wechat-login。

服务端WECHAT_APP_ID/WECHAT_APP_SECRET只在后台环境变量中，员工不会手填openid或角色。手机号按钮由本人点击获取独立phoneCode，走bind-phone->身份摘要->confirm-binding；没有接口资格或拒绝授权走binding-requests->管理员线下核实批准->本人confirm-binding。

开发验收使用DEV_LOGIN_ENABLED，仅Development；FakeWechat仅由tests宿主替换DI，生产未注册mock。线上身份头不被信任。会话失败先wx.login恢复绑定身份，无需重复手机号授权。多角色select-role只接受数据库已分配值。

前端对库存提交生成并保留Idempotency-Key，超时查询当前用户submissions/status；成功清理草稿，PENDING沿用原key，FAILED根据中文错误修改后再提交。前端草稿按用户隔离，不保存登录/手机号授权code或密码。对老人使用大字、56px按钮、无注册表和清晰本次口径；真机和现场试用尚未执行。
