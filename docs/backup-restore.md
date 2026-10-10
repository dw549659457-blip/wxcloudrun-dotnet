# 数据备份与隔离恢复

托管自动备份实际状态本次**未核实**。上线负责人必须填写：产品/地域、启用状态、保留天数、备份时间、控制台恢复入口、最近恢复演练日期与结果。不能只写“平台自带备份”。

手工备份用专用只读备份账号与MySQL客户端，在工作区外/权限受控位置保存0600配置文件，例如client段下host/user/password；真实值仅本地安全管理，不进仓库或命令行。

```sh
bash scripts/backup.sh /私密路径/mysql-client.cnf vegetable_business /私密备份目录/backup.sql.gz
# 操作者预创建一个空隔离库，恢复脚本仅接受isolated_restore_前缀且拒绝非空库。
bash scripts/restore-test.sh /私密路径/mysql-client.cnf isolated_restore_validation /私密备份目录/backup.sql.gz
```

脚本启用pipefail，mysqldump/mysql/gzip失败不会伪报成功；备份不带DROP DATABASE/CREATE DATABASE，不在恢复脚本自动操作生产。备份文件本身含个人与业务数据，妥善限制访问并按业务保留策略清理，不发到公开仓库。

恢复验收：连接配置指向隔离库，APP_COMMAND=reconcile应退出0；核对Users/Documents/InventoryLedger/库存余额及会话数量，检查至少一张包装闭环与DIRECT出库明细。恢复后避免使用复制来的真实生产会话进行普通开发；隔离环境清理或撤销会话需要由操作者按用途确认。生产灾难恢复必须经过单独受控方案，不把本脚本当作直接覆盖生产的授权。
