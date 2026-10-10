# 云托管容器启动失败排查

用户提供的 dotnet-4jwm-004 平台日志显示镜像构建成功、部署时 dotnet Coredump 并重复重启。随后提供的应用日志为 `Unhandled exception. System.InvalidOperationException: 请明确设置独立业务库 MYSQL_DATABASE`，已确认本次故障由缺少 MYSQL_DATABASE 引起。

## 已复现和修复

以原模板仅提供 MYSQL_ADDRESS、MYSQL_USERNAME、MYSQL_PASSWORD 的生产配置运行旧版代码，缺少 MYSQL_DATABASE 会触发未处理 InvalidOperationException，Linux 进程以 SIGABRT（-6）退出，与用户应用日志一致。补库名但未设置 MYSQL_ALLOW_ROOT=true 时，本地也复现了相同退出；镜像同时补齐这两项已确定的部署配置。

镜像现在按用户已确定的部署配置默认设置 MYSQL_DATABASE=vegetable_prod、MYSQL_ALLOW_ROOT=true，控制台同名变量仍可覆盖。数据库地址、账号和密码继续从云托管环境变量读取，密码不放进镜像或 Git。容器保留原模板默认运行用户和80端口，避免给平台新增非root监听低端口的要求。

启动/运维命令的异常现在记录 STARTUP_FAILED 和异常栈，并以退出码1结束，配置错误不再由未处理托管异常造成 SIGABRT。输出前隐藏数据库密码、微信secret和初始化密码。原生运行时在进入托管代码之前的崩溃不能由这个处理器捕获。

本地验证：两种缺配置情况均退出1并输出明确日志；模拟镜像默认值后，原模板三项MySQL变量即可启动生产监听，/health/live返回200。数据库没有在启动时自动连接或迁移，因此上述启动成功不代表云端数据库已存在或连通。

## 发布时核对

在微信云托管控制台选择当前环境，打开服务dotnet-4jwm的“服务设置”，编辑“环境变量”，保存后重新部署。它不是Git仓库的container.config.json；该文件只用于模板首次部署，不会更新已有服务。

控制台服务配置应为：

| 名称 | 值 |
|---|---|
| ASPNETCORE_ENVIRONMENT | Production |
| PORT | 80，与容器端口一致 |
| MYSQL_ADDRESS | 10.40.100.75:3306 |
| MYSQL_USERNAME | root |
| MYSQL_PASSWORD | 用户已提供的密码，在控制台填写 |
| MYSQL_DATABASE | vegetable_prod；镜像已有同值默认 |
| MYSQL_ALLOW_ROOT | true；镜像已有同值默认 |
| DEV_LOGIN_ENABLED | false |
| APP_COMMAND | 删除该项，正常服务不能保留一次性运维命令 |

若存在MYSQL_HOST/PORT/USER，须与对应MYSQL_ADDRESS/USERNAME一致；Development本地变量不得复制到生产。

重新从 main 构建版本，查看应用日志。/health/live=200表示程序已监听；/health/ready=200表示配置的业务库实际可连接。如果后者503，按database-deploy.md创建/导入vegetable_prod并核实连接配置。不要把健康检查成功当作表结构和业务接口验收。

仍启动失败时，应获取STARTUP_FAILED或Unhandled exception开头的应用日志，包括内部异常；不要只提供平台汇总Coredump。若完全没有托管启动日志而仍Coredump，需要继续核查运行时、平台内核/限制和原生故障信息，不能将配置复现直接当作该云端故障的已确认根因。
