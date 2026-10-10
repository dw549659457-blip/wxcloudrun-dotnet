param([ValidateSet('run','migrate','seed','init-admin','reconcile')][string]$Operation='run')
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if (Test-Path '.env.local') {
    foreach ($line in Get-Content '.env.local') {
        if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim('"',"'"), 'Process')
        }
    }
}
if ($Operation -eq 'run') { Remove-Item Env:APP_COMMAND -ErrorAction SilentlyContinue }
else { $env:APP_COMMAND = $Operation }
dotnet run --project aspnetapp --no-launch-profile
exit $LASTEXITCODE
