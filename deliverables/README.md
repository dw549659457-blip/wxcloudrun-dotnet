# 小程序1.1.0工程下载

[下载1.1.0界面优化试上线版 ZIP](https://github.com/dw549659457-blip/wxcloudrun-dotnet/raw/refs/heads/main/deliverables/vegetable-miniprogram-1.1.0.zip)

如果直接链接不能下载，登录有仓库访问权限的GitHub账号，打开本目录的 `vegetable-miniprogram-1.1.0.zip` 文件页面，点击右上角 **Download raw file（下载原始文件）**。不要对Codex的 `/workspace/…` 工作区链接使用浏览器“另存为”。

解压后，在微信开发者工具导入含 `project.config.json` 和 `miniprogram` 的 **vegetable-miniprogram** 目录。AppID `wx336b5ac8bed80159`、envId `prod-d7glkv54o7189eae7` 和服务名 `dotnet-4jwm` 已填好，不需要安装Node.js或“构建npm”。

优化了绿色卡片主题、岗位工作台、大字数量输入、核对摘要、列表状态及空页提示。包内附导入说明、发布试上线说明、员工指引和真机验收清单。“我的身份”页面显示版本 **1.1.0**；开发登录关闭。

源码提交版本记录在包内 `工程信息.json`，包含12个页面和2个组件。前端45项用例、100项浏览器映射布局检查以及工程注册/事件/依赖加载和cloud通道替身检查通过。用户反馈整体连通正常；微信原生渲染和数字键盘仍请在预览真机检查。上传版本号填 **1.1.0**，然后在小程序管理平台设置体验版并添加体验成员。

ZIP完整性及SHA256已检查，校验值在同目录 `.sha256` 文件。`vegetable-miniprogram-import.zip` 为同一版的兼容文件名。

更新工程时运行 `pnpm package:miniprogram`，再将 `out/miniprogram-delivery/` 下的两个ZIP与 `.sha256` 一并更新到此目录；GitHub Actions也会保存生成的工程包。
