#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# .env.local 是用户自己管理的 shell 赋值文件；不要载入外部提供的不可信脚本。
if [ -f .env.local ]; then set -a; source .env.local; set +a; fi
operation="${1:-run}"
case "$operation" in
  migrate|seed|init-admin|reconcile) export APP_COMMAND="$operation" ;;
  run) unset APP_COMMAND ;;
  *) echo '用法: scripts/dev.sh [run|migrate|seed|init-admin|reconcile]' >&2; exit 2 ;;
esac
dotnet run --project aspnetapp --no-launch-profile
