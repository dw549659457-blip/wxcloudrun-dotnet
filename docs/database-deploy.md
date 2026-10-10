# 微信云托管数据库导入与配置

已按现有托管 `root` 账号适配，真实密码通过 `MYSQL_PASSWORD` 注入；代码和 SQL 均不保存密码。数据库密码用于连接 MySQL，业务管理员密码另行设置。

开发工作区已准备私有 `.env.cloudrun`，含用户提供的连接配置，权限为600且已被Git忽略。该文件只供部署时复制配置，镜像不会包含或自动加载它；线上环境变量须在现有服务控制台设置。

1. 在微信云托管关联的 MySQL 管理工具中，以现有 root 账号登录。完整执行 [wechat-cloudrun-init.sql](../database/wechat-cloudrun-init.sql)。默认创建 `vegetable_prod`，包含全部业务表、初始写锁行和 4 条迁移记录，没有测试账号与库存。若使用其他库名，同时修改文件内 `CREATE DATABASE`、`USE` 和下述 `MYSQL_DATABASE`。
2. 在**现有服务控制台**逐项设置 [.env.cloudrun.example](../.env.cloudrun.example) 的变量：`MYSQL_ADDRESS=10.40.100.75:3306`，`MYSQL_USERNAME=root`，`MYSQL_PASSWORD` 填你提供的密码，`MYSQL_DATABASE=vegetable_prod`，`MYSQL_ALLOW_ROOT=true`。若同时保留 `MYSQL_USER` 或 `MYSQL_HOST`/`MYSQL_PORT`，须与对应旧变量一致。模板配置文件 `container.config.json` 不会更新现有服务配置。
3. 初始化业务管理员：设置 `INITIAL_ADMIN_USERNAME`、`INITIAL_ADMIN_PASSWORD`（12—128 字符），以同一镜像执行一次 `APP_COMMAND=init-admin`。成功后移除这些初始化变量和 `APP_COMMAND`，启动正常 API。不要在生产执行 `seed`。
4. 检查 `/health/ready` 返回成功。接入微信登录还需要设置 `WECHAT_APP_ID`、`WECHAT_APP_SECRET` 并实际联调。

该 SQL 只用于首次空库导入，重复导入会拒绝执行。已初始化的库升级使用 `APP_COMMAND=migrate`；导入 SQL 后首次执行该命令会根据校验记录跳过 4 个迁移。MySQL DDL 不能整体回滚，执行中途失败时应先检查结构，不在已有业务数据的库上删表重建。

如果管理工具不支持 `DELIMITER`，改用支持脚本执行的工具或 mysql 客户端：

```sh
mysql --host=实际内网主机 --port=3306 --user=root --password < database/wechat-cloudrun-init.sql
```

客户端会提示输入密码。也可以在空库创建后直接用应用 `APP_COMMAND=migrate`，二者选其一即可。SQL 不包含管理员密码明文或哈希，不修改已有 MySQL 账号的密码/权限。

后续新增迁移后运行 `python3 scripts/generate-cloudrun-sql.py` 更新首次安装包；`--check` 可核对生成结果。生产数据库实际连通性仍需在微信云托管内验证，本地测试不代表云端验证通过。
