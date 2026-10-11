# 包装流转与蔬菜出入库系统（微信云托管 / C#）

**直接下载小程序工程**：[1.2.0 管理员动态试上线版 ZIP](https://github.com/dw549659457-blip/wxcloudrun-dotnet/raw/refs/heads/main/deliverables/vegetable-miniprogram-1.2.0.zip)。解压后直接导入微信开发者工具，AppID 和云环境 ID 已填好；下载方法见 [交付目录](deliverables/README.md)。

本仓库在用户现有 `wxcloudrun-dotnet` 模板中实现业务后台，按用户确认继续使用 **C# + ASP.NET Core**，升级至 **.NET 10 LTS**，使用 MySQL/InnoDB、MySqlConnector 参数化 SQL 和 C# decimal。原云托管 Dockerfile 入口、80 容器端口和 MySQL 配置名保持兼容；原计数器接口已由真实业务接口替代，原库和云服务版本不被修改。

已提供后台 API、React 管理后台、原生微信小程序、数据库迁移与测试。管理后台构建后由同一 .NET 服务在 `/admin/` 提供；小程序从 `apps/miniprogram` 导入微信开发者工具。前端安装/配置见 [frontend-setup.md](docs/frontend-setup.md)，员工指引见 [employee-quickstart.md](docs/employee-quickstart.md)，管理员图文指引见 [admin-quickstart.md](docs/admin-quickstart.md)。用户已反馈整体联通正常；逐岗位试用与真机显示检查见 [1.2.0发布说明](docs/miniprogram-release-1.2.0.md)。

已有业务库启用管理员动态，先执行 [006升级SQL](database/wechat-cloudrun-upgrade-006.sql)，保留已有账号及业务数据。微信订阅提醒需配置真实模板，步骤见1.2.0发布说明。

微信云托管首次建库可直接导入 [database/wechat-cloudrun-init.sql](database/wechat-cloudrun-init.sql)，默认业务库 `vegetable_prod`。当前已按用户指定 `10.40.100.75:3306`、`root` 适配，密码通过服务环境变量注入；完整步骤见 [docs/database-deploy.md](docs/database-deploy.md)。

## 1. 快速运行

要求：Node.js 24.19.x、pnpm 11.25.0、.NET SDK `10.0.401`（global.json 固定）、MySQL 8.0（本地验证版本 8.0.45）、Git。数据库也可使用已安装的本机 MySQL，不强制 Docker。SQL 兼容 5.7 的写法，但实际云端版本、SQL mode、TLS 必须再次核对；本地未验证 MySQL 5.7。

在仓库根目录执行：

```sh
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm build
dotnet restore aspnetapp.sln --locked-mode
cp .env.example .env.local
# 编辑 .env.local，设置实际本地数据库连接、Development、DEV_LOGIN_ENABLED=true
# DEV_SEED_PASSWORD 由你选择，仅本地使用；不要使用生产密码。
bash scripts/dev.sh migrate
bash scripts/dev.sh seed
bash scripts/dev.sh run
```

数据库须事先存在，建议独立库 `vegetable_dev`，不要使用示例 `aspnet_demo`。本地开启 Docker 路径可先设置 `MYSQL_LOCAL_ROOT_PASSWORD`、`MYSQL_PASSWORD`，运行 `docker compose up -d mysql`；Compose 会创建 vegetable_dev 与 vegetable_app 用户。迁移需具备 DDL 权限的本地管理账号，之后运行账号仅保留业务库 SELECT/INSERT/UPDATE/DELETE 权限。已有本机 MySQL 时手工建库并授权即可，无需 Compose。

变量优先级：应用只读取进程环境变量，云控制台注入的变量直接生效；应用不自动读取 `.env`。`scripts/dev.sh`、`scripts/dev.ps1` 明确载入本地 `.env.local`，其中赋值覆盖当前 shell，同文件禁止使用真实生产凭据。生产镜像通过 `.dockerignore` 排除本地环境文件。

开发账号：admin、driver1、driver2、worker1、worker2、outbound1，密码均为你设置的 `DEV_SEED_PASSWORD`。种子不覆盖既有账号密码、不初始化库存，重复运行只补充缺失档案。开发登录使用 `POST /api/auth/dev-login`，登录响应令牌仅作本地验收；`Production`、`Staging` 等非 Development 环境拒绝开发登录开关。

开发管理端用另一个终端运行 `pnpm dev:admin`，访问 `http://localhost:5173/admin/`；默认代理后台8080，使用管理员或会计账号密码登录。`pnpm build:admin` 后，后台地址的 `/admin/` 也可直接访问。小程序先填写真实 AppID 和 `src/config/local.ts` 的 envId，再运行 `pnpm build:miniprogram` 并导入 `apps/miniprogram`。

本地运行端口由 `.env.local` 的 `PORT=8080` 指定。用本地 HTTP 请求检查 `/health/live`、`/health/ready`。开发模式 `/swagger/` 提供 OpenAPI；生产关闭 Swagger，固定接口契约见 [docs/openapi.json](docs/openapi.json) 和 [docs/api.md](docs/api.md)。

## 2. Windows 初学者步骤

1. 安装 .NET 10 SDK、Node.js 24.19.x、Git、VS Code 和微信开发者工具；安装 Docker Desktop 或本机 MySQL 8.0。
2. VS Code 打开仓库；PowerShell 在仓库根目录执行 `Copy-Item .env.example .env.local`，编辑连接信息与开发开关。
3. 先创建数据库，再运行以下命令；不使用 Docker 时省略 Compose。

```powershell
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm build
dotnet restore aspnetapp.sln --locked-mode
# $env:MYSQL_LOCAL_ROOT_PASSWORD 和 $env:MYSQL_PASSWORD 由你在本地安全设置
docker compose up -d mysql
./scripts/dev.ps1 migrate
./scripts/dev.ps1 seed
./scripts/dev.ps1 run
```

`migrate` 输出有序迁移名称，`seed` 输出 6 个开发账号准备完成但不输出密码，`run` 启动 API。另开终端执行 `dotnet test tests/Business.Tests.csproj` 和 `dotnet build aspnetapp.sln -c Release`。测试默认使用当前开发机 `127.0.0.1:3306` 的隔离 MySQL 管理账号，通过 TEST_MYSQL_PORT、TEST_MYSQL_USER、TEST_MYSQL_PASSWORD 配置。用户明确授权远程测试时，可另外指定 TEST_MYSQL_HOST 并开启 TEST_MYSQL_ALLOW_REMOTE=true；测试仍只创建/删除 vegetable_test_ 随机隔离库，不接受外部指定的测试库名。不要把真实值写入测试源码。临时公网库配置和验证命令见 [docs/cloud-database-verification.md](docs/cloud-database-verification.md)。

## 3. 主要能力

- 内部预注册员工与多角色：管理员、会计 Cookie/CSRF，小程序数据库哈希令牌，账号停用/角色变更撤销会话。
- 会计默认全量查询及导出，业务写操作由管理员配置；后台查询、导出、修改、删除及拒绝操作全部留痕。升级与操作见 [会计权限和审计说明](docs/backoffice-permissions-audit.md)。
- 微信 code2Session 验证、手机号换取、本人确认、管理员协助审批、解绑审计；不信任客户端身份头和角色。
- 档案启停、历史快照；包装/蔬菜期初、补充、外来菜、库存调整流水。
- 多棚户多包装下发、多人装菜、部分回收、最终回收、实收与产出差异、包装损耗。
- NORMAL/DIRECT 出库：实际数量正、库存扣减，DIRECT 展示和导出为负。
- 服务端草稿与版本冲突、跨副本持久幂等、非负库存、包装守恒。
- 管理员冲销和原子重建：保留原单、逆转流水、理由、版本及审计；依赖单据逆序冲销。
- 分页报表、50,000 行上限 Excel、筛选导出、按单位统计、防公式注入、只读对账。

## 4. 命令及代码入口

```sh
pnpm check
# 生成可直接导入微信开发者工具的小程序工程 ZIP
pnpm package:miniprogram
dotnet restore aspnetapp.sln --locked-mode
dotnet test tests/Business.Tests.csproj --logger 'console;verbosity=minimal'
dotnet build aspnetapp.sln -c Release --no-restore
dotnet publish aspnetapp -c Release -o out/api --no-restore
bash scripts/dev.sh reconcile
# 前端端到端：本机 MySQL 随机隔离库；需先发布到 out/api
pnpm exec playwright install chromium
pnpm test:e2e
# 本地镜像构建（需允许微软镜像重定向下载域名）
docker build -t vegetable-api .
```

| 路径 | 职责 |
|---|---|
| apps/admin/src | React管理页面、Cookie/CSRF客户端与提交恢复 |
| apps/miniprogram/src | 原生TS/WXML/WXSS页面、微信绑定、员工角色流程 |
| packages/contracts/src | 共享API类型、十进制校验、原提交确认 |
| scripts/frontend | 构建与隔离端到端测试启动 |
| aspnetapp/Program.cs | DI、路由、请求/健康检查、显式运维命令 |
| aspnetapp/Controllers | 身份验证、请求入口和响应 |
| aspnetapp/Services/DocumentService.cs | 库存业务、草稿/提交/冲销/修正 |
| aspnetapp/Services/TransactionService.cs | 同连接事务、跨副本幂等与结果状态 |
| aspnetapp/Repositories | 参数化 SQL、权限筛选、报表与对账 |
| aspnetapp/Integrations/WechatGateway.cs | 微信身份/手机号/标准令牌适配 |
| database/migrations | 有序迁移及校验历史 |
| tests/frontend | Vitest + Playwright + 原生控制器真实API/MySQL测试 |
| tests | xUnit + ASP.NET 测试宿主 + 真实 MySQL 集成测试 |
| docs | API、业务口径、配置映射、发布/回滚与验收 |

从 [代码导航](docs/code-guide.md) 开始阅读。部署前按 [微信云托管部署说明](docs/deployment-wechat-cloudrun.md) 核对端口、业务库、专用账号、初始管理员和小程序资格。迁移和生产管理员初始化必须由受控命令显式执行，不在每个容器启动时执行。

## 5. 验证边界

本地真实 MySQL 测试验证业务规则，不代表微信线上联调成功。镜像构建、生产数据库连接、备份策略、平台默认域名网页限制、Cookie、真实手机 callContainer 等验证状态分别记录在 [验收记录](docs/acceptance.md) 和 [平台核实记录](docs/platform-verification.md)。Git提交及推送main已获授权；云端构建/发布结果需要平台核实，未操作用户控制台创建新服务。
