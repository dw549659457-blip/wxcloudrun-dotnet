# 微信小程序接入

已提供原生 TypeScript 小程序，入口为 `apps/miniprogram/project.config.json`。安装、配置与编译步骤见 [frontend-setup.md](frontend-setup.md)，人工验收见 [miniprogram-verification.md](miniprogram-verification.md)。

已预填用户提供的 AppID `wx336b5ac8bed80159`、环境 ID `prod-d7glkv54o7189eae7`，服务名为 `dotnet-4jwm`。运行 `pnpm package:miniprogram` 生成可直接导入工程，见 [导入说明](miniprogram-import.md)；更换环境时修改编译包 `miniprogram/config/runtime.js` 或源码 `src/config/local.ts`。`wx.cloud.init` 和每次 callContainer 的 `config.env` 使用环境ID，header `X-WX-SERVICE` 指向实际服务，path 以 `/api/` 开头。删除环境ID会明确提示配置缺失，不假登录。

服务端 `WECHAT_APP_ID/WECHAT_APP_SECRET` 只在后端环境变量中。wx.login code 发给 wechat-login；手机号授权 code 独立发给 bind-phone。员工本人点击授权，核对姓名角色后 confirm-binding 才正式绑定。不收集头像、昵称或无关个人信息，也不允许员工自己手填 openid/角色/手机号认领。

拒绝授权或接口资格缺失时，可以申请管理员协助：员工提交 binding-requests，管理员在 `/admin/bindings` 线下核实后批准，员工检查状态并本人确认。账号原先绑定其他微信时不自动覆盖；管理员解除后旧会话失效，重新由本人确认。

会话恢复先核实 auth/me，过期时 wx.login 验证已绑定微信恢复，不重复索取手机号。多角色由后端校验并记住上次身份，首页和个人页可切换。业务请求带后端员工 token，后台永远按数据库角色与记录归属限制访问。

开发模式需 `mode: 'local'`、`developmentLogin: true`，并且服务端 Development + DEV_LOGIN_ENABLED=true。生产误开后端开发登录会拒绝启动。真实生产依赖微信资格、凭证与环境关联；本地接口替身不能替代真实微信验收。
