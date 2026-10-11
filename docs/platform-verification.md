# 平台核实与验证范围

更新日期：2026-10-11。

| 项目 | 本次证据 | 状态 |
|---|---|---|
| 原模板接入规范 | 当前仓库Program/CounterContext/Dockerfile/container.config.json | 已检查 |
| MySQL变量及端口 | 模板源码解析MYSQL_ADDRESS/USERNAME/PASSWORD，初始化80端口 | 已检查；云实际设置待核对 |
| 官方.NET LTS SDK | Microsoft releases元数据，SDK10.0.401/运行时10.0.12 | 已安装/构建 |
| 微信登录/手机号接口 | 真实HTTPS适配器已实现；测试替换独立FakeWechat | 真实线上待联调 |
| 小程序到云托管实际通道 | 用户开发者工具返回callContainer的503，业务code WECHAT_NOT_CONFIGURED，请求ID cb2252fbb8f249378d85954d67258d72 | 历史错误已定位；用户随后反馈整体连通正常，逐岗位真机验收待记录 |
| 微信托管令牌 | 本版使用标准stable_token，未知模式启动拒绝 | 平台模式未验证 |
| 默认域名网页/下载限制 | 未访问用户实际地址；没有当前控制台限制证据 | 待用户实测，不能保证不限用途 |
| 小程序环境ID/服务名/备案/手机号资格 | 工程已预填用户提供的AppID wx336b5ac8bed80159、envId prod-d7glkv54o7189eae7，服务名dotnet-4jwm | 实际关联权限、备案/手机号资格仍待微信平台确认 |
| 生产数据库版本与TLS | 仅本地MySQL8.0.45经过验证 | 云端待核对 |
| 自动备份保留与恢复 | 本地有备份/恢复脚本；未读取托管备份配置 | 待核实 |
| Docker镜像与容器启动 | 用户日志曾显示dotnet-4jwm-004构建成功与启动配置异常，随后反馈后台暂时ok | 新增管理前端构建阶段待平台验证；本地Docker仍受开发网络限制 |
| 管理端本地浏览器与API/Excel | Chromium+真实MySQL端到端10项通过，320/375/1440宽 | 本地通过，实际HTTPS入口待验证 |
| 原生页面与业务接口 | 真正TS/WXML/WXSS；控制器执行真实本地库存闭环925/8 | 本地通过，微信渲染/授权待验证 |
| 小程序1.1.0布局 | 实际WXML/WXSS浏览器映射：25状态 × 4配置，100项通过；320/375/430宽及125%字号 | 本地布局通过，微信键盘与原生渲染需真机检查 |
| Git交付与代码流水线 | 用户明确要求提交并推送 | 目标main；流水线构建和云端发布仍需平台核实 |

平台入口：微信云托管cloud.weixin.qq.com，官方模板WeixinCloud/wxcloudrun-dotnet，以及微信小程序wx.login、callContainer、getPhoneNumber和服务器code2Session/stable_token官方文档。相关产品域名/默认限制不能互相套用。本次没有借助旧截图宣称用户控制台配置已验证。

会计及审计更新：用户已确认实际公网入口的 admin 登录成功；本次新增权限配置与后台操作记录已在本地真实MySQL/Chromium验证，生产仍需先执行005升级SQL再发布新版本。未直接访问或修改用户生产库。
