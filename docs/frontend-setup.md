# 管理后台与微信小程序启动

本项目只有一套 C#/.NET 10 业务后台。前端采用 React + TypeScript + Ant Design 管理端和原生微信 TypeScript 小程序，共享 `packages/contracts` 的 API 类型、十进制数量校验与提交确认逻辑。

## Windows 安装和管理端

安装 .NET SDK 10.0.401、Node.js 24.19.x、Git、微信开发者工具；MySQL 初始化按 README。Node.js 24 不保证附带 Corepack，直接安装锁定 pnpm：

```powershell
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm check
```

先按 README 启动后台，`.env.local` 默认 `PORT=8080`，然后另开 PowerShell：

```powershell
pnpm dev:admin
```

浏览器打开 **http://localhost:5173/admin/**。管理员账号为本地种子 `admin`，密码是自己配置的 `DEV_SEED_PASSWORD`。开发管理端同源代理到 `http://127.0.0.1:8080`，保留浏览器 Host 使 Origin/CSRF 验证一致。后台用其他端口时，先设置：

```powershell
$env:ADMIN_API_PROXY="http://127.0.0.1:8180"
pnpm dev:admin
```

生产与本地发布方式一致：

```powershell
pnpm build:admin
dotnet publish aspnetapp -c Release -o out/api
```

`pnpm build:admin` 将管理端资源复制到 `aspnetapp/wwwroot/admin`，随 .NET publish 分发。直接运行发布输出时，工作目录设为 `out/api`；访问当前 API 地址的 `/admin/`。缺少前端构建输出时不挂载管理端，API 仍正常返回 JSON。Dockerfile 自行执行 Node/pnpm 构建，并复制资源到同一个 .NET 镜像，无需新增 Node 服务。

生产管理端是 **控制台实际 HTTPS 入口 + `/admin/`**。登录使用现有管理员 Cookie；前端只在 sessionStorage 存 CSRF 和待确认提交，不存密码或管理员会话令牌。生产 Cookie 为 Secure，不能用 HTTP 验证生产登录。浏览器 HTTPS 入口、资源、Cookie、刷新和 Excel 下载在用户实际域名上仍待联调。

## 微信开发者工具导入

1. 将 `apps/miniprogram/src/config/settings.ts` 复制为同目录 `local.ts`（已忽略），填写本人的 `envId`。从微信云托管控制台的 **小程序调用示例 `config.env`** 复制实际值，不能用服务名、环境名称或数据库地址替代。服务名暂按用户日志 `dotnet-4jwm`，仍以实际 `X-WX-SERVICE` 值为准。
2. 正式使用 `mode: 'cloud'`、`developmentLogin: false`。保持 HTTPS 校验开关启用。生产通过 `wx.cloud.callContainer`，不依赖直接请求云托管公网域名。
3. 在微信开发者工具导入 **仓库的 `apps/miniprogram` 目录**，填写真实小程序 AppID。模板 AppID 为 `touristappid`，仅可查看代码，不能验证真实微信授权。真实 AppID 可在开发者工具本地配置中填写，勿把 AppSecret 放进此目录。
4. 编译前在仓库根目录执行 `pnpm build:miniprogram`。生成的 `apps/miniprogram/miniprogram` 含 `app.js/app.json`、12 个原生页面的 JS/WXML/WXSS/JSON、2 个原生组件。`project.config.json` 的 `miniprogramRoot` 已指向该目录，无须“构建 npm”。修改源码后重新执行命令，再在开发者工具编译。
5. 小程序与现有云托管环境建立关联；后端控制台设置匹配 AppID 的 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`，管理员先建立员工姓名、唯一手机号与岗位。小程序不填写数据库地址、密码、AppSecret、openid 或角色。

`local.ts` 格式与 `settings.ts` 相同。例如只更改配置值，保留导出结构和 `mode` 的联合类型：

```ts
export const settings = {
  mode: 'cloud' as 'cloud' | 'local',
  envId: '从本人控制台复制实际环境ID',
  serviceName: 'dotnet-4jwm',
  apiBaseUrl: 'http://127.0.0.1:8080', // cloud 模式不使用此地址
  administratorPhone: '',            // 可填管理员工作电话
  developmentLogin: false,
  businessUtcOffsetMinutes: 480,
};
```

真实环境 ID/AppID 尚未提供时，继续完成本地开发验证：临时把 `local.ts` 设为 `mode: 'local'`、`developmentLogin: true`，后台必须为 Development + `DEV_LOGIN_ENABLED=true`。小程序开始页会出现明确标注的“仅本地开发验证”账号入口，使用本地种子员工账号。`apiBaseUrl` 指向开发机端口，真机上的 `127.0.0.1` 是手机自身，不能用于访问电脑；本地验证不等于生产微信验证。上线前恢复 cloud 模式并重新构建，禁止上传 `out/mini-verification`。

## 自动验证

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
dotnet test tests/Business.Tests.csproj
dotnet publish aspnetapp -c Release -o out/api
pnpm exec playwright install chromium
pnpm test:e2e
```

端到端测试只连接本机 MySQL，环境变量为 `E2E_MYSQL_HOST/PORT/USER/PASSWORD`（默认 `127.0.0.1:3306`、root、空密码，适用于隔离测试实例）。需要有创建/删除随机测试库的权限；不得填生产连接。测试生成 `vegetable_ui_<随机值>`，用随机密码创建种子，结束删除该库和私有状态文件。不会清空开发库或生产库。Excel 验证还需 Python 3。若系统已安装 Chromium，可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指向本机可执行文件，避免重复下载。

CI 将前端校验、构建、37 项 C# 测试和浏览器测试纳入同一工作流。`out/mini-verification` 只是测试原生控制器的本地接口适配包，既不会进入 Docker，也不会替代正式小程序包。

## 上线后最小验证

管理端进入 `/admin/` 登录，先查询概览和“只读账本对账”；再在隔离测试环境验证一张入库单和 Excel，避免用生产出库重复测试。微信真机按 [小程序验收](miniprogram-verification.md) 检查首次绑定、协助、再次进入、数字键盘、部分/最终回收和网络恢复。员工简明指引见 [employee-quickstart.md](employee-quickstart.md)。
