@echo off
setlocal
cd /d "%~dp0"

echo.
echo ==========================================================
echo   DIVIDEPASS - PUBLICAR A INTEGRACAO WOOVI (Pix Automatico)
echo ==========================================================
echo.
echo 1) Verificando se a CLI ja esta logada na conta do projeto
echo    DividePass (lasoouwboxspstqvjbsv).
echo.
npx supabase projects list | findstr lasoouwboxspstqvjbsv >nul 2>&1
if errorlevel 1 (
  echo    A CLI nao alcanca o projeto ainda.
  echo    Vai abrir o navegador para voce autorizar a CLI do Supabase.
  echo    Entre com a conta que TEM o projeto DividePass e clique
  echo    em "Authorize CLI". Sem isso nada e publicado.
  echo.
  npx supabase login
  if errorlevel 1 (
    echo.
    echo [ERRO] O login da CLI falhou. Tente de novo.
    pause
    exit /b 1
  )
) else (
  echo    [OK] A CLI ja alcanca o projeto DividePass. Pulando o login.
)

echo.
echo 2) Publicando as edge functions...
node scripts\publicar-edge-functions.mjs

echo.
echo 3) Cadastrando os webhooks na Woovi (o AppID e lido do proprio
echo    Admin > Configuracoes, e o ambiente vem do toggle "Sandbox").
node scripts\configurar-webhook-woovi.mjs --criar

echo.
echo 4) Estado final no ar:
node scripts\diagnostico-functions.mjs

echo.
echo ==========================================================
echo   FIM. Pode fechar esta janela.
echo ==========================================================
pause