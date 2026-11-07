# =============================================================================
# DividePass - runner da validacao local da correcao de exclusao de grupo
# =============================================================================
# Sobe um banco Postgres local descartavel, aplica o schema de teste (no
# estado de producao: payments.group_id com FK NO ACTION), aplica a migration
# DUAS vezes (idempotencia) e roda os asserts de comportamento.
#
#   powershell -ExecutionPolicy Bypass -File scripts/run-admin-delete-local-test.ps1
#
# Requer: PostgreSQL 17 local rodando (padrao: postgres/postgres em localhost:5432)
# =============================================================================

param(
  [string]$Psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe",
  [string]$User = "postgres",
  [string]$Password = "postgres",
  [string]$HostName = "localhost",
  [string]$DbName = "dp_admin_delete_test",
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$env:PGPASSWORD = $Password

if (-not (Test-Path $Psql)) {
  Write-Error "psql nao encontrado em $Psql. Ajuste o parametro -Psql."
}

Push-Location $ProjectRoot
try {
  Write-Host ">>> recriando o banco de teste $DbName"
  & $Psql -U $User -h $HostName -c "DROP DATABASE IF EXISTS $DbName" | Out-Null
  & $Psql -U $User -h $HostName -c "CREATE DATABASE $DbName" | Out-Null

  Write-Host ">>> 1) schema de teste (estado de producao: FK NO ACTION em payments)"
  & $Psql -U $User -h $HostName -d $DbName -v ON_ERROR_STOP=1 -q -f scripts/test-fix-admin-delete-group-schema.sql
  if ($LASTEXITCODE -ne 0) { throw "falha ao criar o schema de teste (exit $LASTEXITCODE)" }

  Write-Host ">>> 2) migration (1a execucao)"
  & $Psql -U $User -h $HostName -d $DbName -v ON_ERROR_STOP=1 -q -f database/fix-admin-delete-group-2026-11-06.sql
  if ($LASTEXITCODE -ne 0) { throw "falha na 1a execucao da migration (exit $LASTEXITCODE)" }

  Write-Host ">>> 3) migration (2a execucao - idempotencia)"
  & $Psql -U $User -h $HostName -d $DbName -v ON_ERROR_STOP=1 -q -f database/fix-admin-delete-group-2026-11-06.sql
  if ($LASTEXITCODE -ne 0) { throw "falha na 2a execucao da migration (exit $LASTEXITCODE)" }

  Write-Host ">>> 4) asserts de comportamento"
  # psql escreve os NOTICE em stderr; com ErrorActionPreference='Stop' o
  # PowerShell trataria isso como erro. Aqui o controle e pelo exit code.
  $ErrorActionPreference = 'Continue'
  $out = & $Psql -U $User -h $HostName -d $DbName -v ON_ERROR_STOP=1 -f scripts/test-fix-admin-delete-group-asserts.sql 2>&1
  $code = $LASTEXITCODE
  $out | ForEach-Object { $_.ToString() } | Where-Object { $_ -match 'PASS |FAIL |RESULTADO|ERRO' } |
    ForEach-Object { ($_ -replace '^.*NOTICE:\s+', '' -replace '^psql:.*ERRO:\s*', 'ERRO: ').Trim() }
  Write-Host ""
  if ($code -eq 0) {
    Write-Host "RESULTADO: todos os asserts passaram." -ForegroundColor Green
  } else {
    Write-Host "RESULTADO: houve falha (exit $code)." -ForegroundColor Red
  }
  exit $code
}
finally {
  Pop-Location
}
