# 小程序工程下载

[直接下载微信小程序工程 ZIP](https://github.com/dw549659457-blip/wxcloudrun-dotnet/raw/refs/heads/main/deliverables/vegetable-miniprogram-import.zip)

如果直接链接不能下载，登录有仓库访问权限的 GitHub 账号，打开本目录的 `vegetable-miniprogram-import.zip` 文件页面，点击右上角 **Download raw file（下载原始文件）**。不要对 Codex 的 `/workspace/…` 工作区链接使用浏览器“另存为”。

解压后，在微信开发者工具导入含 `project.config.json` 的 **vegetable-miniprogram** 目录。AppID `wx336b5ac8bed80159`、envId `prod-d7glkv54o7189eae7` 和服务名 `dotnet-4jwm` 已填好，不需要安装 Node.js 或“构建 npm”。包内附导入说明、员工指引和真机验收清单。

源码提交版本记录在包内 `工程信息.json`，包含12个页面和2个组件。已检查 ZIP 完整性、解压后的注册/事件/依赖加载和 cloud 通道替身检查，SHA256 在同目录 `.sha256` 文件。实际微信授权与真机渲染仍需微信开发者工具/预览验证。新版保留后台503/WECHAT_NOT_CONFIGURED的明确原因，不再把微信登录失败显示成查询业务提交。

更新工程时先运行 `pnpm package:miniprogram`，再将 `out/miniprogram-delivery/` 下的 ZIP 与 `.sha256` 一并更新到此目录；GitHub Actions 也会保存自动生成的工程包。
