# 平台核实与验证范围

记录日期：2026-10-10（用户上下文）。

| 项目 | 本次证据 | 状态 |
|---|---|---|
| 原模板接入规范 | 当前仓库Program/CounterContext/Dockerfile/container.config.json | 已检查 |
| MySQL变量及端口 | 模板源码解析MYSQL_ADDRESS/USERNAME/PASSWORD，初始化80端口 | 已检查；云实际设置待核对 |
| 官方.NET LTS SDK | Microsoft releases元数据，SDK10.0.401/运行时10.0.12 | 已安装/构建 |
| 微信登录/手机号接口 | 真实HTTPS适配器已实现；测试替换独立FakeWechat | 真实线上待联调 |
| 微信托管令牌 | 本版使用标准stable_token，未知模式启动拒绝 | 平台模式未验证 |
| 默认域名网页/下载限制 | 未访问用户实际地址；没有当前控制台限制证据 | 待用户实测，不能保证不限用途 |
| 小程序环境ID/服务名/备案/手机号资格 | 未取得实际控制台值/凭证 | 待配置/确认 |
| 生产数据库版本与TLS | 仅本地MySQL8.0.45经过验证 | 云端待核对 |
| 自动备份保留与恢复 | 本地有备份/恢复脚本；未读取托管备份配置 | 待核实 |
| Docker镜像构建 | mcr.microsoft.com的centralus.data.mcr.microsoft.com重定向403 | 受开发环境网络限制，构建尚未完成 |
| Git交付与代码流水线 | 用户明确要求提交并推送 | 目标main；流水线构建和云端发布仍需平台核实 |

平台入口：微信云托管cloud.weixin.qq.com，官方模板WeixinCloud/wxcloudrun-dotnet，以及微信小程序wx.login、callContainer、getPhoneNumber和服务器code2Session/stable_token官方文档。相关产品域名/默认限制不能互相套用。本次没有借助旧截图宣称用户控制台配置已验证。
