# 微信云托管接续部署（现有 C# 模板服务）

本仓库按用户授权提供代码、Git提交/推送和发布材料；不操作用户控制台。源码/Release发布已本地验证。用户已授权云端建库和隔离接口测试，但当前开发环境网络代理阻断数据库域名，云端迁移和测试尚未执行，见[cloud-database-verification.md](cloud-database-verification.md)。Docker镜像及云端登录需完成下述核对。本项目是微信云托管业务后端，不是云开发文档数据库项目，不开第二套后端。

## 一、保留现有环境和回退版本

1. 在当前微信云托管服务记录已发布版本、仓库/分支、构建目录、Dockerfile路径、实际容器端口、健康检查、环境变量**名称**、最大副本数。不要把密码或截图中的凭据写入仓库。
2. 当前仓库 container.config.json 为模板首次初始化配置：80端口、aspnet_demo示例库。文件自己的说明已指出部署后修改它不会改变服务设置，后续配置在控制台修改。本项目 Dockerfile 保留80；仍须核对实际服务是否也是80，再同步 PORT 和健康检查。
3. 不删除原计数器库、原表或现有服务版本。源码可通过原 Git 提交5d21a3e回看模板，生产应用回滚应选择控制台已有版本，不假定 Git 回退会回退数据库。

## 二、核对并复用已有托管 MySQL

在已关联实例核实内网地址、端口、实际版本/SQL mode、TLS及备份。本地验证是 MySQL8.0.45，不等于云实例已验证。优先在同实例创建独立业务库，vegetable_prod；不要默认为aspnet_demo，不重复开通同类资源、不把MySQL装到应用镜像。

由有权限的操作者创建业务账号时，只允许该库SELECT/INSERT/UPDATE/DELETE；DDL迁移用受控账号。本次按用户指定复用托管root，需显式设置MYSQL_ALLOW_ROOT=true；默认仍拒绝生产运行root。已知内网地址为10.40.100.75:3306，新业务库为vegetable_prod，导入步骤参见[database-deploy.md](database-deploy.md)。

环境变量兼容原模板：

| 原变量/新增变量 | 行为 |
|---|---|
| MYSQL_ADDRESS=host:port | 兼容原模板；或设MYSQL_HOST和MYSQL_PORT |
| MYSQL_USERNAME | 兼容原模板；或设MYSQL_USER |
| MYSQL_PASSWORD | 保留同名，安全录入控制台 |
| MYSQL_DATABASE | 本服务镜像默认vegetable_prod；控制台可覆盖，应明确为独立业务库 |
| MYSQL_ALLOW_ROOT | 源码默认关闭；本服务镜像按用户授权默认true，控制台可覆盖 |
| MYSQL_POOL_LIMIT | 默认10 |
| MYSQL_SSL_MODE | 默认Preferred；按真实数据库支持选择VerifyCA/VerifyFull，使用MYSQL_SSL_CA_FILE指定受信CA路径后实测，勿通过关闭校验解决失败 |
| PORT | 默认80，与平台实际容器端口一致 |
| ASPNETCORE_ENVIRONMENT | Production |
| DEV_LOGIN_ENABLED | false，生产误开会拒绝启动 |
| BUSINESS_TIME_ZONE | 默认Asia/Shanghai |
| REQUEST_TIMEOUT_SECONDS | 默认30，上限300 |
| TRUSTED_PROXIES | 可信入口代理的明确IP列表；未知留空，不无条件信任转发头 |
| WECHAT_APP_ID / WECHAT_APP_SECRET | 小程序服务端凭证，仅后端控制台保存 |
| WECHAT_TOKEN_MODE | standard；使用微信stable_token，平台托管令牌未验证 |

新旧MySQL变量同时设置须一致，否则启动失败，避免连接错误库。线上不得载入本地.env.local。

## 三、备份、迁移、管理员初始化

1. 先核实托管自动备份是否启用、保留周期、恢复入口，并执行手工备份与隔离恢复验证，参见backup-restore.md。
2. 容器发布不自动迁移。使用控制台允许的受控单次执行能力，或有内网访问权限的执行环境启动一次同镜像命令，设置APP_COMMAND=migrate与DDL账号。
3. 迁移使用GET_LOCK互斥，SchemaMigrations记录校验值；重复运行已完成文件跳过，修改已执行迁移会拒绝。MySQL DDL不能整体回滚：中途失败时对照日志检查部分结构和备份，不盲目反复运行，不在生产删表重建。若首次空业务库迁移失败，可由操作者确认无业务数据后重建独立空库，其他情况新增修复迁移。
4. 初次管理员设置INITIAL_ADMIN_USERNAME、INITIAL_ADMIN_PASSWORD（12—128字符）并执行APP_COMMAND=init-admin。成功后移除这些初始化变量和APP_COMMAND，改回专用运行账号。命令拒绝覆盖已有账号，生产禁止APP_COMMAND=seed。
5. 原始源码迁移文件不得改历史校验值。将来发布采用增量兼容迁移，先扩展字段/表，再发布使用方，旧版本回滚仍可运行；破坏性删字段不得和应用同时上线。

## 四、编译、发布与检查

```sh
pnpm install --frozen-lockfile
pnpm check
dotnet restore aspnetapp.sln --locked-mode
dotnet test tests/Business.Tests.csproj
dotnet build aspnetapp.sln -c Release --no-restore
docker build -t vegetable-api .
```

Docker新增Node24.19.0/pnpm11.25.0管理前端构建阶段，npm锁定安装并复制打包结果；.NET阶段固定SDK10.0.401和ASP.NET运行时10.0.12；运行时只包含 .NET 发布输出与 `/admin/` 静态资源，保留原模板默认运行用户和80端口，不带数据库、测试或本地环境文件。镜像拉取必须允许mcr.microsoft.com及其官方下载重定向域名；当前开发环境centralus.data.mcr.microsoft.com受限导致403，已记录到环境草稿。不得用不可信镜像或跳过TLS代替。

代码就绪并按用户授权推送到已关联main分支后，云托管按根目录Dockerfile构建新版本。保留原版本可回退。健康检查先核对端口，再配置/health/live和/health/ready（平台若只支持单一路径，按其能力选择）。最小/最大副本在控制台设置；连接配额约束为“最大副本数×MYSQL_POOL_LIMIT+迁移/运维连接”，实际额度以实例为准。例如原模板max5、pool10意味着至少考虑50个应用连接，不能默认数据库允许。

标准输出日志含请求ID、状态及耗时；配置错误率、延迟、CPU/内存、数据库连接和费用/额度告警。ASP.NET宿主支持SIGTERM停止接收并等待在途请求；若平台终止等待时间小于请求/事务超时需协调设置。会话、幂等、业务数据和审计都存MySQL，不能靠容器磁盘持久化。

## 五、入口和微信上线验证

- 从控制台复制实际HTTPS地址；不能从任务书截图猜测环境ID/域名，不能硬编码特定后缀。服务名按实际X-WX-SERVICE值，环境ID按复制的callContainer片段。
- 小程序先初始化wx.cloud，再callContainer调用/api/...；wx.login code由后端验证。手机号code与登录code分开。原生项目位于 `apps/miniprogram`，配置后编译导入步骤见 [frontend-setup.md](frontend-setup.md)。使用平台默认域名与callContainer不等于小程序备案和审核已完成。
- 浏览器访问所需公网入口仍要开启，所有数据和导出需认证。管理入口为实际HTTPS域名的 `/admin/`。本地真实浏览器已验证资源、SPA刷新、Cookie/CSRF、API与Excel；用户实际云端仍需按 [frontend-setup.md](frontend-setup.md) 验证。
- 默认域名网页/下载能力和条款以实际微信云托管控制台为准，本地无法证实。不绕过限制；若平台明确要求自定义域名，按地域/备案规则配置获准域名，不以“内部使用”推断免备案。
- 微信线上code2Session、手机号资格、真实callContainer、小程序真机需用户实际账号联调。没有真实凭证时本地假微信适配器只用于测试，不可在生产注册。
- 发布后用健康检查和只读接口验证，**不要**反复调用旧/api/count或生产出库/清零接口检测上线。

回滚：选择保留的旧应用版本，确认环境变量和端口与该版本一致；数据库不自动回滚，恢复数据必须先在隔离库验证，再按受控故障处理方案操作生产。

容器启动Coredump的已复现原因、修复与日志获取步骤见[deployment-startup-troubleshooting.md](deployment-startup-troubleshooting.md)。
