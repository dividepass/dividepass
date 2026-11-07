#!/usr/bin/env bash
# =============================================================================
# DividePass — teste da migration do onboarding novo (banco descartável)
# =============================================================================
# Roda a migration num Postgres local (WSL) e prova:
#   1. antes da migration, kind='share' é REJEITADO pelo CHECK;
#   2. a migration roda sem erro;
#   3. a migration roda de novo sem erro (idempotente);
#   4. depois, kind='share' e kind='join' são aceitos e kind='xxx' continua
#      barrado;
#   5. as colunas group_intent e expectations existem e aceitam escrita.
#
# Uso:  wsl -e bash /mnt/c/Users/GABRIEL/Documents/DividePass/scripts/test-onboarding-novo-fluxo.sh
# =============================================================================
set -uo pipefail

RAIZ="/mnt/c/Users/GABRIEL/Documents/DividePass"
DB="qa_onboarding_test"
SCHEMA="$RAIZ/scripts/test-onboarding-novo-fluxo-schema.sql"
MIGRATION="$RAIZ/database/EXECUTAR-2026-11-02-onboarding-novo-fluxo.sql"

falhas=0
check() {
  if [ "$1" = "0" ]; then
    echo "OK   $2"
  else
    echo "FAIL $2"
    falhas=$((falhas + 1))
  fi
}

# Roda um SQL e devolve o código de saída (0 = aceitou).
run_sql() {
  su postgres -c "psql -v ON_ERROR_STOP=1 -d $DB -f $1" >/dev/null 2>&1
  echo $?
}

cat > /tmp/ob-insert-share.sql <<'SQL'
INSERT INTO public.user_onboarding_interests (user_id, platform_name, kind)
SELECT id, 'Netflix', 'share' FROM auth_fake_users;
SQL

cat > /tmp/ob-insert-join.sql <<'SQL'
INSERT INTO public.user_onboarding_interests (user_id, platform_name, kind)
SELECT id, 'Spotify', 'join' FROM auth_fake_users;
SQL

cat > /tmp/ob-insert-invalid.sql <<'SQL'
INSERT INTO public.user_onboarding_interests (user_id, platform_name, kind)
SELECT id, 'Xbox', 'xxx' FROM auth_fake_users;
SQL

cat > /tmp/ob-write-profile.sql <<'SQL'
INSERT INTO public.user_onboarding_profiles (user_id)
SELECT id FROM auth_fake_users;

UPDATE public.user_onboarding_profiles
   SET group_intent = 'ambos',
       expectations = 'Quero pagar menos no Netflix'
 WHERE user_id = (SELECT id FROM auth_fake_users);
SQL

echo "=== recriando o banco de teste ==="
su postgres -c "dropdb --if-exists $DB" >/dev/null 2>&1
su postgres -c "createdb $DB" || exit 1
su postgres -c "psql -v ON_ERROR_STOP=1 -d $DB -f $SCHEMA" >/dev/null || exit 1

echo
echo "=== 1. antes da migration, kind='share' deve ser barrado ==="
run_sql /tmp/ob-insert-share.sql > /tmp/r.txt
if [ "$(cat /tmp/r.txt)" != "0" ]; then
  check 0 "CHECK antigo barra 'share' (o teste é válido)"
else
  check 1 "CHECK antigo NÃO barrou 'share' — o teste não prova nada"
fi

echo
echo "=== 2. rodando a migration (1a vez) ==="
su postgres -c "psql -v ON_ERROR_STOP=1 -d $DB -f $MIGRATION" > /tmp/mig1.log 2>&1
check $? "migration aplicada"
tail -8 /tmp/mig1.log

echo
echo "=== 3. rodando a migration DE NOVO (idempotencia) ==="
su postgres -c "psql -v ON_ERROR_STOP=1 -d $DB -f $MIGRATION" > /tmp/mig2.log 2>&1
check $? "migration roda de novo sem erro"

echo
echo "=== 4. depois da migration, share/join aceitos e xxx barrado ==="
run_sql /tmp/ob-insert-share.sql > /tmp/r.txt
[ "$(cat /tmp/r.txt)" = "0" ]; check $? "insert com kind='share' aceito"

run_sql /tmp/ob-insert-join.sql > /tmp/r.txt
[ "$(cat /tmp/r.txt)" = "0" ]; check $? "insert com kind='join' aceito"

run_sql /tmp/ob-insert-invalid.sql > /tmp/r.txt
[ "$(cat /tmp/r.txt)" != "0" ]; check $? "insert com kind='xxx' continua barrado"

echo
echo "=== 5. colunas novas existem e aceitam escrita ==="
run_sql /tmp/ob-write-profile.sql > /tmp/r.txt
[ "$(cat /tmp/r.txt)" = "0" ]; check $? "group_intent + expectations aceitam escrita"

su postgres -c "psql -d $DB -t -A -c \"select group_intent || ' | ' || expectations from public.user_onboarding_profiles\"" 2>/dev/null | grep -q "ambos | Quero pagar menos no Netflix"
check $? "valores gravados voltam na leitura"

echo
if [ "$falhas" = "0" ]; then
  echo "TODOS OS TESTES PASSARAM"
else
  echo "$falhas TESTE(S) FALHARAM"
fi
exit "$falhas"
