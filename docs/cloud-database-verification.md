# 微信云托管 MySQL 配置与接口验证

用户授权的临时外网地址：`sh-cynosdbmysql-grp-pft64fzw.sql.tencentcdb.com:24478`，账号 `root`，目标业务库 `vegetable_prod`。生产容器继续使用内网 `10.40.100.75:3306`，不将临时地址作为线上默认值。

## 本次云端连接结果

当前开发环境直连域名解析返回 `Temporary failure in name resolution`；通过环境网络代理向该地址发起连接，返回 `HTTP/1.1 403 Forbidden`、`Domain forbidden`。错误发生在数据库认证之前，不能据此判断密码正确与否、端口白名单或 MySQL 版本。

已把该精确域名加入云开发环境网络配置草稿，保留原包管理预设和原微软镜像下载域名。工具返回 `status=saved`、`requires_publish=true`；需在**Codex 云开发环境设置**审核并保存，再发布环境，才能应用草稿。这与微信云托管应用发布是不同操作。保存草稿没有改变运行时网络，也没有连接或修改云端数据库。

截至本次记录：云端建库、迁移和接口测试均未执行。不能把既有本地测试结果称为云端通过。网络生效后还需实际检验 TCP 24478 与数据库连接。

验证脚本已在本地随机隔离库执行：Required TLS 连接成功、建库与4个迁移成功、账本对账consistent=true，生产模式HTTP检查live=200、ready=200、未登录users=401。验证后删除自身临时库。完整测试共35项；这些结果属于本地验证。

## 已准备的验证命令

私有 `.env.cloudrun-test` 已填入用户提供的账号密码，被 Git 和 Docker 忽略、权限为600。提交的 [.env.cloudrun-test.example](../.env.cloudrun-test.example) 只有占位密码。脚本不输出密码、令牌或连接字符串；外网连接默认 `MYSQL_SSL_MODE=Required`，服务端需支持 TLS，如有 CA 文件可配置 `MYSQL_SSL_CA_FILE` 和 VerifyCA/VerifyFull。

在 .NET SDK10.0.401 与 Python3 可用的环境中执行：

```sh
# 只读检查版本、SQL mode、连接的 TLS cipher、目标库是否存在及表名
bash scripts/verify-cloudrun.sh check

# 显式创建目标业务库（已有库不覆盖），执行迁移、对账和生产模式健康/401检查
bash scripts/verify-cloudrun.sh prepare

# 在同一云端实例的 vegetable_test_ 随机隔离库运行业务/认证接口测试
bash scripts/verify-cloudrun.sh test

# 以上步骤依次执行
bash scripts/verify-cloudrun.sh all
```

`prepare` 不初始化管理员、员工、测试档案或业务单据；`test` 通过真实 MySQL 与 ASP.NET TestServer 验证业务接口，微信调用仍使用仅在测试进程注册的 FakeWechat。每个测试类使用随机隔离库，结束时删除自身创建的库；初始化部分失败也会尝试清理。远程测试必须显式开启 TEST_MYSQL_ALLOW_REMOTE=true，脚本 test/all 会设置该开关，单独运行 dotnet test 默认仅本地。

生产业务管理员仍按 [database-deploy.md](database-deploy.md) 使用 `APP_COMMAND=init-admin` 和单独管理员密码创建，不把 MySQL root 密码当作后台登录密码。

新增维护命令：`APP_COMMAND=inspect-db` 为只读检查，`APP_COMMAND=create-database` 只创建配置的独立业务库；后者拒绝系统库、原 aspnet_demo 库和不安全标识符，使用 CREATE DATABASE IF NOT EXISTS，不删除或覆盖既有库。两个命令均不在应用正常启动时自动运行。

## 用户手动验证接口与参数

将下面的 `你的云托管HTTPS域名` 替换为控制台的真实服务入口，数据库外网地址不是 HTTP API 地址。

### 1. MySQL 连通性（不需要登录）

```http
GET https://你的云托管HTTPS域名/health/ready
```

请求参数：无；请求体：无。成功返回 HTTP 200 和 `{"status":"ready"}`，表示应用已打开配置的业务库连接并完成 `SELECT 1`。HTTP 503 和 `{"status":"not_ready"}` 表示连接失败，需检查地址、密码、库名、TLS、访问权限及网络。`/health/live` 仅表示程序存活，不能证明 MySQL 连通。

### 2. 登录并查询真实库存（只读业务验证）

先按部署说明用 `APP_COMMAND=init-admin` 创建业务管理员；MySQL root 账号不是业务登录账号。

```http
POST https://你的云托管HTTPS域名/api/auth/admin-login
Content-Type: application/json

{"username":"admin","password":"你初始化时设置的业务管理员密码"}
```

登录返回 HTTP 200、管理员信息与 csrfToken，并设置 `warehouse_session` Cookie。在 Postman 或 Apifox 中保留该 Cookie 后执行：

```http
GET https://你的云托管HTTPS域名/api/inventory/packaging?page=1&pageSize=20
```

参数：`page=1`、`pageSize=20`。成功返回 HTTP 200 和 items/page/pageSize 等分页字段，空库存时items为空数组。这同时验证登录、权限和真实数据库表查询，不创建业务库存或单据。未登录时返回401。

可导入 [cloudrun-test.postman_collection.json](cloudrun-test.postman_collection.json)，填写 baseUrl 与业务管理员密码，按顺序执行3个请求。管理员密码变量默认为空，不保存任何真实凭据。
