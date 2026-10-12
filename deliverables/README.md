# 小程序1.2.1工程下载

[下载1.2.1管理员动态试上线版 ZIP](https://github.com/dw549659457-blip/wxcloudrun-dotnet/raw/refs/heads/main/deliverables/vegetable-miniprogram-1.2.1.zip)

如果直接链接不能下载，登录有仓库访问权限的GitHub账号，打开本目录的 `vegetable-miniprogram-1.2.1.zip` 文件页面，点击 **Download raw file（下载原始文件）**。不要对Codex的 `/workspace/…` 工作区链接使用浏览器“另存为”。

已有业务库先执行包内 **数据库升级006.sql**。该脚本要求001—005已安装；缺005时先执行包内005。保留原账号、库存与单据，不要重跑首次初始化SQL。Git流水线部署新后台后，用原管理员账号填写本人手机号，在小程序绑定本人微信即可进入管理员工作台。

解压后导入同时含 `project.config.json` 和 `miniprogram` 的 **vegetable-miniprogram** 文件夹。AppID、envId和服务名已填好；无需构建npm，开发登录关闭。“我的身份”和上传版本号均为 **1.2.1**。

管理员页面约5秒更新装菜、回收入库、发货出库等动态，支持个人未读和完整明细。微信订阅通知已默认配置真实模板74963，新后台部署后启用；旧空环境变量需删除或填写包内配置。普通一次性订阅每次授权对应下一笔新变动。具体步骤见包内发布试上线说明。

包内 `工程信息.json` 记录源码提交版本，包含14个页面和2个组件。51项前端用例、68项C#用例、11项编译包/API/MySQL及浏览器端到端用例、124项浏览器映射布局检查通过。真实微信模板推送、原生渲染、键盘与上传发布须在体验版验收。

同目录 `vegetable-miniprogram-import.zip` 与1.2.1文件内容相同。旧1.1.0和1.2.0包保留为历史版本。

## 审核描述与图文使用手册

- [下载PDF手册](https://github.com/dw549659457-blip/wxcloudrun-dotnet/raw/refs/heads/main/deliverables/user-manual-1.2.1.pdf)：22页、31张图，可打印或转发给员工。
- [下载完整使用资料ZIP](https://github.com/dw549659457-blip/wxcloudrun-dotnet/raw/refs/heads/main/deliverables/user-manual-1.2.1.zip)：PDF、可离线浏览的HTML、116字符审核描述、审核填写说明及可编辑图文源稿。
- [在线查看图文源稿](../docs/user-manual-1.2.1.md)和[审核填写说明](../docs/review-submission-1.2.1.md)。

覆盖管理员添加员工/会计、身份绑定与协助、各岗位派发/装菜/回收/出库、管理员动态和订阅、会计导出、权限和操作审计、改单与断网处理。后台图来自隔离演示环境，小程序图是当前WXML/WXSS页面的浏览器布局示意，不是微信真机截图。图片与数字均为演示数据。

使用资料ZIP是手册，不是小程序上传工程。截图中的待审核版本1.0.0与交付版本1.2.1需核对实际上传包；小程序微信身份核实的审核测试访问方式需如实说明。

手册生成命令：`python3 scripts/generate-user-manual.py`，再执行`node scripts/export-user-manual.mjs`。生成时验证31张图离线加载、A4章节不溢出和手机宽度不溢出。
