@echo off
setlocal enabledelayedexpansion
title DividePass - Deploy da edge function fetch-email-code
cd /d "C:\Users\GABRIEL\Documents\DividePass"

echo ============================================================
echo  DividePass - subir a edge function fetch-email-code
echo  (libera o criador/gestor do grupo a buscar o codigo)
echo ============================================================
echo.

echo [1/3] Verificando token no arquivo...
powershell -NoProfile -ExecutionPolicy Bypass -File ".tmp-verify\extract-pat.ps1"

if exist ".tmp-verify\pat.txt" (
  set "PAT="
  for /f "usebackq delims=" %%L in (".tmp-verify\pat.txt") do set "PAT=%%L"
  echo       usando token do arquivo: !PAT:~0,10!...
  echo [2/3] Login com o token...
  npx supabase login --token !PAT!
) else (
  echo       Nenhum token no arquivo. Vou fazer o login pelo navegador.
  echo       >>> quando aparecer "Press Enter to open browser", aperte ENTER
  echo       >>> depois, no navegador que abrir, clique em "Authorize CLI"
  echo.
  echo [2/3] Login...
  npx supabase login
)

echo.
echo [3/3] Subindo a funcao fetch-email-code...
npx supabase functions deploy fetch-email-code --project-ref lasoouwboxspstqvjbsv

echo.
echo ============================================================
echo  FIM - "Deployed" no fim = no ar.
echo  Teste em dividepass.com/dashboard/my-groups/[id]/manage
echo  (criador do grupo sem assinatura e sem ser membro)
echo ============================================================
pause
