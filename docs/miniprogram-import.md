# 微信小程序工程导入

这是原生微信小程序工程，包含已编译的 JS、WXML、WXSS、JSON，连接现有 C# 后台。无需安装 Node.js，无需执行“构建 npm”。管理员、司机、装菜员、出库员使用此小程序；管理员和后台管理员也可使用已有管理后台。

本包为 **1.2.1 管理员库存动态试上线版**，上传版本号可填写 `1.2.1`。发布、体验成员与真机检查步骤见包内 `发布试上线说明.md`；用户已反馈整体连通正常。

## 三步导入

1. 解压 ZIP，打开微信开发者工具 → 小程序 → 导入项目。目录选择解压得到的 **vegetable-miniprogram** 文件夹（这里有 `project.config.json`），不要选其中的 `miniprogram` 子文件夹。
2. 使用工程已预填的 **AppID `wx336b5ac8bed80159`**，以有此小程序开发者权限的微信登录开发者工具。
3. **miniprogram/config/runtime.js** 已预填 **envId `prod-d7glkv54o7189eae7`**，服务名为 **`dotnet-4jwm`**。点击“编译”，再点“预览”用真实微信测试授权。

如更换小程序或云环境，再修改 AppID 与此配置文件；环境 ID 从云托管“小程序调用示例”的 `config.env` 复制，服务名以 `X-WX-SERVICE` 为准。`envId` 不是公网网址、数据库地址或服务名。保持 `mode: "cloud"`、`developmentLogin: false`；手机号联系管理员可选填 `administratorPhone`。修改这个文件会同时作用于全部页面，无需重新打包。

## 后台联通条件

- 将小程序与现有云托管环境关联，云托管允许这个小程序调用服务。
- 云托管服务中设置匹配此小程序的 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`；AppSecret 只配置在服务器。
- 管理后台先创建员工姓名、本人唯一手机号、岗位，并启用账号。员工用微信进入，首次核实手机号并本人确认身份；普通员工不用后台 `admin` 密码登录。
- 在小程序管理平台确认手机号接口资格并填写使用手机号的隐私保护指引，首次授权才能按微信平台规则完成。
- 小程序使用 `wx.cloud.callContainer`，无需填写 MySQL 连接信息，也无需把公网 URL 写入配置。现有管理后台入口为 https://dotnet-4jwm-326107-6-1503430980.sh.run.tcloudbase.com/admin/ 。

不要把数据库密码、AppSecret、后台账号密码放进小程序。导入时保持域名与 HTTPS 校验开启；本工程没有开启本地开发登录入口。

## 联通验证

使用管理后台预录的测试员工，在小程序点击“开始使用”：未绑定员工应进入本人手机号核实页；已绑定员工应显示本人姓名及岗位，随后打开批次或库存列表并看到后台数据。网络错误时查看开发者工具 Console 与 Network 中 `/api/auth/wechat-login` 或业务请求的状态码、message、requestId，不复制会话令牌。

正式验证首次手机号授权和云托管通道请使用开发者工具“预览”后的真实微信。业务记账测试使用专门测试棚户、客户与批次；每笔正式提交会记入现有数据库。

本工程已进行静态检查、原生页面控制器检查及隔离 MySQL 的实际业务链路测试。本次自动验证采用控制器和浏览器映射；用户已反馈整体联通正常，逐岗位真机显示和业务验收的人工步骤见 `微信验收清单.md`。

### 登录提示“微信登录暂未配置”

后台返回 `503 / WECHAT_NOT_CONFIGURED` 表示 `WECHAT_APP_ID`、`WECHAT_APP_SECRET` 至少一项为空；这个响应证明云托管路由已到达 C# 服务。

打开微信云托管控制台 → 服务 `dotnet-4jwm` → 环境变量（服务设置或版本配置中），添加：

| 变量 | 值 |
|---|---|
| `WECHAT_APP_ID` | `wx336b5ac8bed80159` |
| `WECHAT_APP_SECRET` | 此小程序的 AppSecret，只填云控制台 |

AppSecret 在小程序管理平台“开发管理 → 开发设置”中管理。保存后重新部署或重启服务；后台在启动时读取环境变量。重新点“开始使用”，未绑定员工应进入本人手机号核实页。仅修改电脑上的 `.env.cloudrun.example` 或小程序配置文件不会设置服务器环境变量。

新版工程将微信配置错误直接显示为“微信登录暂未配置，请联系管理员”；Console 中 `[warehouse] 接口请求失败` 只记录 method、path、status、code、requestId 或数值 cloudErrorCode，不记录登录凭证、请求体或令牌。业务记账结果不明时仍保留原提交确认流程。

## 工程结构与源码

`project.config.json` 是导入入口；`miniprogram/` 是完整可编辑、可上传的原生工程；`miniprogram/config/runtime.js` 是唯一运行配置；另附员工指引及验收清单。

管理员动态先执行包内 `数据库升级006.sql`；管理员本人微信绑定、消息模板配置与一次性订阅说明见 `发布试上线说明.md`。

TypeScript 源码在仓库 `apps/miniprogram/src`，共享接口在 `packages/contracts`。后续源码开发从仓库根目录运行 `pnpm package:miniprogram` 可重新生成此包；设置 `MINIPROGRAM_APP_ID`、`MINIPROGRAM_ENV_ID` 可预填本人公开配置。重新生成会覆盖输出目录，已在导入包内修改的 JS 请自行保留。
