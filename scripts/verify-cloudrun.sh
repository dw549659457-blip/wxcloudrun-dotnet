#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# 只加载本人管理的私有文件，文件被 Git / Docker 忽略；不输出密码或环境。
configuration="${CLOUDRUN_TEST_CONFIG:-.env.cloudrun-test}"
if [ -f "$configuration" ]; then set -a; source "$configuration"; set +a; fi
action="${1:-check}"
case "$action" in check|prepare|test|all) ;; *) echo '用法: scripts/verify-cloudrun.sh [check|prepare|test|all]' >&2; exit 2 ;; esac
: "${MYSQL_HOST:?请配置临时测试地址 MYSQL_HOST}"
: "${MYSQL_PORT:?请配置临时测试端口 MYSQL_PORT}"
: "${MYSQL_USER:?请配置 MYSQL_USER}"
: "${MYSQL_PASSWORD?请配置 MYSQL_PASSWORD}"
: "${MYSQL_DATABASE:?请配置 MYSQL_DATABASE}"
unset MYSQL_ADDRESS MYSQL_USERNAME APP_COMMAND
export ASPNETCORE_ENVIRONMENT=Production DEV_LOGIN_ENABLED=false
export MYSQL_SSL_MODE="${MYSQL_SSL_MODE:-Required}"
dotnet restore aspnetapp.sln --locked-mode
dotnet publish aspnetapp -c Release --no-restore -o artifacts/cloudrun-verification /p:UseAppHost=false
application=artifacts/cloudrun-verification/aspnetapp.dll
APP_COMMAND=inspect-db dotnet "$application"

if [ "$action" = prepare ] || [ "$action" = all ]; then
  APP_COMMAND=create-database dotnet "$application"
  APP_COMMAND=migrate dotnet "$application"
  APP_COMMAND=inspect-db dotnet "$application"
  APP_COMMAND=reconcile dotnet "$application"
  # 对配置后的业务库只检查健康和未授权访问，不创建业务管理员/员工/单据。
  export PORT="${CLOUDRUN_VERIFY_API_PORT:-8281}"
  log_file="$(mktemp)"
  chmod 600 "$log_file"
  dotnet "$application" >"$log_file" 2>&1 &
  api_pid=$!
  trap 'kill "$api_pid" 2>/dev/null || true; wait "$api_pid" 2>/dev/null || true; rm -f "$log_file"' EXIT
  python3 - <<'PY'
import json, os, time, urllib.error, urllib.request
base = 'http://127.0.0.1:' + os.environ['PORT']
for attempt in range(30):
    try:
        with urllib.request.urlopen(base + '/health/live', timeout=2) as response:
            assert json.load(response)['status'] == 'alive'
        break
    except (OSError, urllib.error.URLError):
        time.sleep(1)
else:
    raise SystemExit('Production API did not start on the verification port')
with urllib.request.urlopen(base + '/health/ready', timeout=15) as response:
    assert json.load(response)['status'] == 'ready'
try:
    urllib.request.urlopen(base + '/api/users', timeout=15)
    raise SystemExit('Unauthenticated users endpoint unexpectedly succeeded')
except urllib.error.HTTPError as error:
    assert error.code == 401
print('Production API PASS: live=200, ready=200, unauthenticated users=401')
PY
  kill "$api_pid"
  wait "$api_pid" || true
  rm -f "$log_file"
  trap - EXIT
fi

if [ "$action" = test ] || [ "$action" = all ]; then
  export TEST_MYSQL_HOST="$MYSQL_HOST" TEST_MYSQL_PORT="$MYSQL_PORT" TEST_MYSQL_USER="$MYSQL_USER"
  export TEST_MYSQL_PASSWORD="$MYSQL_PASSWORD" TEST_MYSQL_ALLOW_REMOTE=true
  export TEST_MYSQL_SSL_MODE="$MYSQL_SSL_MODE" TEST_MYSQL_SSL_CA_FILE="${MYSQL_SSL_CA_FILE:-}"
  dotnet test tests/Business.Tests.csproj --no-restore --logger 'console;verbosity=minimal'
fi
