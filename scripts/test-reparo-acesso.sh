#!/bin/bash
# Testa o script EXECUTAR-2026-11-02-reparo-acesso-credenciais.sql no Postgres local (WSL).
set -e
export PATH="$PATH:/usr/lib/postgresql/18/bin"

service postgresql start >/dev/null 2>&1 || true
sleep 3

su postgres -c "dropdb --if-exists teste_acesso"
su postgres -c "createdb teste_acesso"

BASE=/mnt/c/Users/GABRIEL/Documents/DividePass

echo "=================== SCHEMA + DADOS ==================="
su postgres -c "psql -q -U postgres -d teste_acesso -f $BASE/scripts/test-reparo-acesso-schema.sql"

echo
echo "=================== EXECUTANDO O REPARO ================"
su postgres -c "psql -q -U postgres -d teste_acesso -f $BASE/database/EXECUTAR-2026-11-02-reparo-acesso-credenciais.sql" \
  | grep -E 'ERROR|FATAL|error' && echo "!!! HOUVE ERRO NO SCRIPT !!!" || echo "script rodou sem erro de sintaxe"

echo
echo "=================== VERIFICACAO ======================"
su postgres -c "psql -U postgres -d teste_acesso -f $BASE/scripts/test-reparo-acesso-verifica.sql"

echo
echo "=================== RODAR DE NOVO (idempotencia) ====="
su postgres -c "psql -q -U postgres -d teste_acesso -f $BASE/database/EXECUTAR-2026-11-02-reparo-acesso-credenciais.sql" \
  | grep -E 'ERROR|FATAL' && echo "!!! HOUVE ERRO NA SEGUNDA RODADA !!!" || echo "segunda rodada sem erro (idempotente)"
su postgres -c "psql -U postgres -d teste_acesso -f $BASE/scripts/test-reparo-acesso-verifica.sql" | tail -8
