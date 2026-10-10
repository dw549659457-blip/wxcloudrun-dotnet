#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 3 ]; then echo '用法: restore-test.sh 私密MySQL配置文件 isolated_restore_库名 输入.sql.gz' >&2; exit 2; fi
if [[ ! "$2" =~ ^isolated_restore_[A-Za-z0-9_]+$ ]]; then echo '只允许恢复到 isolated_restore_ 开头的隔离库' >&2; exit 2; fi
# 要求目标库由操作者预先创建且为空；禁止覆盖已有数据。
rows=$(mysql --defaults-extra-file="$1" --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$2'")
if [ "$rows" != 0 ]; then echo '隔离恢复库非空，拒绝覆盖' >&2; exit 2; fi
gzip -dc "$3" | mysql --defaults-extra-file="$1" "$2"
# 验证真实业务结构已导入，不能把空stdin或错误备份内容当作恢复成功。
mysql --defaults-extra-file="$1" --batch --skip-column-names "$2" -e 'SELECT COUNT(*) FROM SchemaMigrations; SELECT COUNT(*) FROM Documents; SELECT COUNT(*) FROM InventoryLedger;' > /dev/null
echo '恢复完成；请将应用配置指向该隔离库，执行 APP_COMMAND=reconcile 并核对单据/会话/账本。'
