# 包装流转与蔬菜出入库后台（微信云托管 / C#）

本仓库在用户现有 `wxcloudrun-dotnet` 模板中实现业务后台，按用户确认继续使用 **C# + ASP.NET Core**，升级至 **.NET 10 LTS**，使用 MySQL/InnoDB、MySqlConnector 参数化 SQL 和 C# decimal。原云托管 Dockerfile 入口、80 容器端口和 MySQL 配置名保持兼容；原计数器接口已由真实业务接口替代，原库和云服务版本不被修改。

**本次交付范围是后台 API、数据库、测试、Excel、运维命令与部署资料。** 任务书所列微信小程序页面和完整 Web 管理界面需另行接入这些 API；本仓库没有冒充完整前端的演示页面，`/admin/` 当前返回 JSON 404。微信登录适配器已实现，真实微信和用户云托管环境尚未联调。现存模板 Razor 页面/静态素材未挂载到服务路由。

微信云托管首次建库可直接导入 [database/wechat-cloudrun-init.sql](database/wechat-cloudrun-init.sql)，默认业务库 `vegetable_prod`。当前已按用户指定 `10.40.100.75:3306`、`root` 适配，密码通过服务环境变量注入；完整步骤见 [docs/database-deploy.md](docs/database-deploy.md)。

## 1. 快速运行

要求：.NET SDK `10.0.401`（global.json 固定）、MySQL 8.0（本地验证版本 8.0.45）、Git。数据库也可使用已安装的本机 MySQL，不强制 Docker。SQL 兼容 5.7 的写法，但实际云端版本、SQL mode、TLS 必须再次核对；本地未验证 MySQL 5.7。

在仓库根目录执行：

```sh
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

本地运行端口由 `.env.local` 的 `PORT=8080` 指定。用本地 HTTP 请求检查 `/health/live`、`/health/ready`。开发模式 `/swagger/` 提供 OpenAPI；生产关闭 Swagger，固定接口契约见 [docs/openapi.json](docs/openapi.json) 和 [docs/api.md](docs/api.md)。

## 2. Windows 初学者步骤

1. 安装 .NET 10 SDK、Git、VS Code；安装 Docker Desktop 或本机 MySQL 8.0。
2. VS Code 打开仓库；PowerShell 在仓库根目录执行 `Copy-Item .env.example .env.local`，编辑连接信息与开发开关。
3. 先创建数据库，再运行以下命令；不使用 Docker 时省略 Compose。

```powershell
dotnet restore aspnetapp.sln --locked-mode
# $env:MYSQL_LOCAL_ROOT_PASSWORD 和 $env:MYSQL_PASSWORD 由你在本地安全设置
docker compose up -d mysql
./scripts/dev.ps1 migrate
./scripts/dev.ps1 seed
./scripts/dev.ps1 run
```

`migrate` 输出有序迁移名称，`seed` 输出 6 个开发账号准备完成但不输出密码，`run` 启动 API。另开终端执行 `dotnet test tests/Business.Tests.csproj` 和 `dotnet build aspnetapp.sln -c Release`。测试要求本机 `127.0.0.1:3306` 的独立 MySQL 管理账号可创建/删除测试库，默认自动测试使用当前云开发机的本地无密码 root 隔离实例；其他本机环境通过 TEST_MYSQL_PORT、TEST_MYSQL_USER、TEST_MYSQL_PASSWORD 配置测试专用管理账号，只允许 127.0.0.1。不要指向生产数据库、不要把真实值写入测试源码。

## 3. 主要能力

- 内部预注册员工与多角色：管理员 Cookie/CSRF、小程序数据库哈希令牌、账号停用/角色变更撤销会话。
- 微信 code2Session 验证、手机号换取、本人确认、管理员协助审批、解绑审计；不信任客户端身份头和角色。
- 档案启停、历史快照；包装/蔬菜期初、补充、外来菜、库存调整流水。
- 多棚户多包装下发、多人装菜、部分回收、最终回收、实收与产出差异、包装损耗。
- NORMAL/DIRECT 出库：实际数量正、库存扣减，DIRECT 展示和导出为负。
- 服务端草稿与版本冲突、跨副本持久幂等、非负库存、包装守恒。
- 管理员冲销和原子重建：保留原单、逆转流水、理由、版本及审计；依赖单据逆序冲销。
- 分页报表、50,000 行上限 Excel、筛选导出、按单位统计、防公式注入、只读对账。

## 4. 命令及代码入口

```sh
dotnet restore aspnetapp.sln --locked-mode
dotnet test tests/Business.Tests.csproj --logger 'console;verbosity=minimal'
dotnet build aspnetapp.sln -c Release --no-restore
dotnet publish aspnetapp -c Release -o out/api --no-restore
bash scripts/dev.sh reconcile
# 本地镜像构建（需允许微软镜像重定向下载域名）
docker build -t vegetable-api .
```

| 路径 | 职责 |
|---|---|
| aspnetapp/Program.cs | DI、路由、请求/健康检查、显式运维命令 |
| aspnetapp/Controllers | 身份验证、请求入口和响应 |
| aspnetapp/Services/DocumentService.cs | 库存业务、草稿/提交/冲销/修正 |
| aspnetapp/Services/TransactionService.cs | 同连接事务、跨副本幂等与结果状态 |
| aspnetapp/Repositories | 参数化 SQL、权限筛选、报表与对账 |
| aspnetapp/Integrations/WechatGateway.cs | 微信身份/手机号/标准令牌适配 |
| database/migrations | 有序迁移及校验历史 |
| tests | xUnit + ASP.NET 测试宿主 + 真实 MySQL 集成测试 |
| docs | API、业务口径、配置映射、发布/回滚与验收 |

从 [代码导航](docs/code-guide.md) 开始阅读。部署前按 [微信云托管部署说明](docs/deployment-wechat-cloudrun.md) 核对端口、业务库、专用账号、初始管理员和小程序资格。迁移和生产管理员初始化必须由受控命令显式执行，不在每个容器启动时执行。

## 5. 验证边界

本地真实 MySQL 测试验证业务规则，不代表微信线上联调成功。镜像构建、生产数据库连接、备份策略、平台默认域名网页限制、Cookie、真实手机 callContainer 等验证状态分别记录在 [验收记录](docs/acceptance.md) 和 [平台核实记录](docs/platform-verification.md)。未自动推送、创建云服务版本或发布生产。
