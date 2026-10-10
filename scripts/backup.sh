#!/usr/bin/env bash
set -euo pipefail
# 使用 MySQL --defaults-extra-file 注入备份账号；不把密码放进命令行或输出。
if [ "$#" -ne 3 ]; then echo '用法: backup.sh 私密MySQL配置文件 业务库名 输出.sql.gz' >&2; exit 2; fi
if [[ ! "$2" =~ ^[A-Za-z0-9_]+$ ]]; then echo '库名格式不正确' >&2; exit 2; fi
mysqldump --defaults-extra-file="$1" --single-transaction --routines --triggers --hex-blob --set-gtid-purged=OFF "$2" | gzip > "$3"
test -s "$3"
