# 小程序1.2.2工程下载

[下载1.2.2工程ZIP](https://github.com/dw549659457-blip/wxcloudrun-dotnet/raw/refs/heads/main/deliverables/vegetable-miniprogram-1.2.2.zip)

如果链接不能下载，登录有仓库访问权限的GitHub账号，打开ZIP文件页面，点击Download raw file（下载原始文件）。不要对Codex工作区链接使用浏览器“另存为”。

本次将原会计显示名称改为后台管理员，保持ACCOUNTANT标识、账号密码和已有业务权限配置。网页后台新增下级员工建档、岗位分配、启用/停用、解绑与开通审批；同级和上级后台账号仍由最高管理员维护。已有005/006的业务库无需新增SQL。详见[职级说明](../docs/backoffice-role-hierarchy.md)。

解压后导入同时含project.config.json和miniprogram的vegetable-miniprogram文件夹。AppID、envId和服务名已预填，开发登录关闭，不需要构建npm。版本号为1.2.2，包含14个页面和2个组件；附带后台管理员职级说明及数据维护填写表。

最高管理员小程序库存动态、未读数及微信订阅提醒沿用原功能，后台管理员仍使用网页后台。旧升级脚本仅供尚未安装005/006的数据库使用，不要重跑首次初始化SQL。

重新构建后验证：76项C#测试、51项前端测试、12项浏览器端到端测试、124个小程序浏览器布局场景均通过，类型检查、构建和SQL一致性检查通过。浏览器映射检查不能替代真实微信原生渲染、订阅推送和真机验收。

同目录vegetable-miniprogram-import.zip与1.2.2包内容相同，旧工程包和1.2.1手册保留为历史资料。

## 历史1.2.1图文使用手册

历史手册中的“会计”名称和人员管理范围以[当前职级说明](../docs/backoffice-role-hierarchy.md)为准。

- [下载PDF手册](https://github.com/dw549659457-blip/wxcloudrun-dotnet/raw/refs/heads/main/deliverables/user-manual-1.2.1.pdf)：22页、31张图，可打印或转发给员工。
- [下载完整使用资料ZIP](https://github.com/dw549659457-blip/wxcloudrun-dotnet/raw/refs/heads/main/deliverables/user-manual-1.2.1.zip)：PDF、可离线浏览的HTML、116字符审核描述、审核填写说明及可编辑图文源稿。
- [在线查看图文源稿](../docs/user-manual-1.2.1.md)和[审核填写说明](../docs/review-submission-1.2.1.md)。

覆盖管理员添加员工/会计、身份绑定与协助、各岗位派发/装菜/回收/出库、管理员动态和订阅、会计导出、权限和操作审计、改单与断网处理。后台图来自隔离演示环境，小程序图是当前WXML/WXSS页面的浏览器布局示意，不是微信真机截图。图片与数字均为演示数据。

使用资料ZIP是手册，不是小程序上传工程。截图中的待审核版本1.0.0与交付版本1.2.1需核对实际上传包；小程序微信身份核实的审核测试访问方式需如实说明。

手册生成命令：`python3 scripts/generate-user-manual.py`，再执行`node scripts/export-user-manual.mjs`。生成时验证31张图离线加载、A4章节不溢出和手机宽度不溢出。

## 上线前基础数据维护Excel

[下载管理员数据维护表](https://github.com/dw549659457-blip/wxcloudrun-dotnet/raw/refs/heads/main/deliverables/prelaunch-data-maintenance-1.2.2.xlsx)。

11个可见工作表：维护指导、清单、人员账号、棚户、包装、蔬菜、客户、期初盘点、未结任务、上线核对与填写示例。填写区留空，示例另放；支持下拉、手机号文本格式、唯一性辅助校验及自动差额。密码只记录设置状态，不填写真实值。

填好后按后台页面维护，当前没有本表的批量导入功能。已有库存先核对系统余额，不重复做期初；在外包装和未入仓菜单独核对。详细规则见 [维护指导](../docs/prelaunch-data-maintenance.md)。
