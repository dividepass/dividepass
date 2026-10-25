<#
.SYNOPSIS
  Aplica um arquivo .sql no projeto Supabase pela Management API.

.DESCRIPTION
  O projeto DividePass (lasoouwboxspstqvjbsv) vive num org criado pelo
  Vercel Marketplace, fora da conta em que a CLI 'supabase' esta autenticada
  (403 em 'functions list'). A Management API e o caminho usado para DDL.

  A Management API roda o SQL em transacao propria: erro em qualquer
  statement desfaz TUDO (rollback automatico). O SQL do arquivo precisa ir
  sem BEGIN/COMMIT, por isso o script remove essas linhas.

  O token (Personal Access Token, escopo do projeto, Full access) vem de:
    $env:SUPABASE_ACCESS_TOKEN = '<sbp_...>'

  NOTA: este arquivo e ASCII puro de proposito. O Windows PowerShell 5.1 le
  arquivos UTF-8 sem BOM como CP1252, e o em-dash (E2 80 94) vira uma aspa
  curva que o PowerShell trata como fim de string (erro de sintaxe).

.PARAMETER File
  Caminho do arquivo .sql, relativo a raiz do repo.

.PARAMETER ProjectRef
  Ref do projeto Supabase. Padrao: lasoouwboxspstqvjbsv (DividePass).

.EXAMPLE
  $env:SUPABASE_ACCESS_TOKEN = '<sbp_...>'
  .\scripts\apply-migration.ps1 -File database\add-user-feedback.sql
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$File,

  [string]$ProjectRef = 'lasoouwboxspstqvjbsv'
)

$ErrorActionPreference = 'Stop'

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  throw "SUPABASE_ACCESS_TOKEN nao definido. Crie um PAT em https://supabase.com/dashboard/account/tokens (escopo do projeto $ProjectRef, Full access) e defina: `$env:SUPABASE_ACCESS_TOKEN = '<sbp_...>'"
}

$path = Join-Path (Split-Path -Parent $PSScriptRoot) $File
if (-not (Test-Path $path)) {
  throw "Arquivo SQL nao encontrado: $path"
}

# A Management API ja abre transacao propria: BEGIN/COMMIT no arquivo
# quebrariam ("there is already a transaction in progress").
$sql = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
$sql = $sql -replace '(?m)^\s*BEGIN;\s*$', '' -replace '(?m)^\s*COMMIT;\s*$', ''

Write-Host "Aplicando $File no projeto $ProjectRef ..." -ForegroundColor Cyan

$uri = "https://api.supabase.com/v1/projects/$ProjectRef/database/query"
$response = Invoke-RestMethod -Method Post -Uri $uri `
  -Headers @{ Authorization = "Bearer $env:SUPABASE_ACCESS_TOKEN" } `
  -ContentType 'application/json; charset=utf-8' `
  -Body (@{ query = $sql } | ConvertTo-Json -Compress)

Write-Host "OK - SQL aplicado." -ForegroundColor Green
if ($response) {
  Write-Host "Resultado:"
  $response | ConvertTo-Json -Depth 6
}
