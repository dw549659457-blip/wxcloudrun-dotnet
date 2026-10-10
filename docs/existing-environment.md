# 既有环境接续记录

## 当前仓库实际检查结果

- 仓库：dw549659457-blip/wxcloudrun-dotnet，初始main HEAD为5d21a3ee25c72160073bd2e4066f3b5bac0343df。
- 模板：ASP.NET Core计数器，原net6.0，模板初始化containerPort=80、示例库aspnet_demo。
- 原变量：MYSQL_ADDRESS、MYSQL_USERNAME、MYSQL_PASSWORD；新业务明确MYSQL_DATABASE，兼容旧地址/用户名，与新变量冲突时失败。
- 当前业务：同aspnetapp项目，.NET10 LTS，Dockerfile根目录，默认PORT=80；不再提供/api/count。
- 云开发机：本地MySQL8.0.45、独立vegetable_dev以及随机测试库，与用户云托管数据库不同。

## 用户陈述 / 附件背景 / 待确认

用户表示微信云托管已关联此代码仓库流水线。本次没有访问用户控制台，没有直接看到任务书所引用的截图；附件中提到的示例服务dotnet-4jwm等不是本次实测配置，不能当作最终标识。

以下由用户在控制台核对后填写：实际环境ID、实际服务名、HTTPS入口、当前容器端口、健康检查、发布版本、托管MySQL版本/内网地址/库名/账号权限、自动备份启用状态/保留周期。只记录非敏感元数据；不得填密码、APP_SECRET或token。

本地验证及未完成云端事项见acceptance.md。未创建/发布新版本、未推送仓库或改生产数据库。
