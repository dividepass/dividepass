# Publicar as edge functions do fluxo de pagamento — 03/11/2026

Guia de execução manual no painel do Supabase (projeto `lasoouwboxspstqvjbsv`).

---

## 1. Por que isso é urgente

O front novo já está no ar (`https://dividepass.com`) e manda `payment_type: 'combined'`.
A `create-payment` **antiga** ainda é a que está publicada, e ela:

- grava o vínculo (`group_members.payment_status`) como `active` **antes** do pagamento;
- e a `check-iopay-tx` antiga tem o atalho que responde "já confirmei" olhando o
  estado do vínculo — então o navegador recebe "confirmado" e **nada é liberado**.

Resultado: enquanto as funções antigas estiverem no ar, **toda nova cliente que pagar
vai cair no mesmo buraco da Cristiana** (assinatura Pende, sem entrada no grupo, sem e-mail).

---

## 2. Ordem de publicação (7 funções)

Publique **nessa ordem** e **uma por vez**: `create-payment` primeiro, porque é a que
cria a cobrança; `confirm-payment` em seguida, porque é a que libera.

| # | Função | Arquivo (arquivo único, já validado) | Linhas | Verify JWT | O que conserta |
|---|--------|--------------------------------------|-------:|-------------|----------------|
| 1 | `create-payment` | `.tmp-verify/painel/create-payment.ts` | 3.890 | **LIGADO** | fluxo `combined` (adesão + 1ª mensalidade em 1 pagamento), cupom sobre a mensalidade, assinatura nasce `pending` com o valor do **ciclo**, e **não** grava o vínculo antes do pagamento |
| 2 | `confirm-payment` | `.tmp-verify/painel/confirm-payment.ts` | 3.459 | **LIGADO** | libera assinatura + vínculo + e-mail; só ignora o replay quando a liberação **terminou** (`liberacaoConcluida`); não duplica linha em `payments` |
| 3 | `iopay-webhook` | `.tmp-verify/painel/iopay-webhook.ts` | 3.883 | **DESLIGADO** | devolve **503** no que é retryable (o gateway só reenvia se a resposta falhar) e acha a tentativa por `external_reference` |
| 4 | `check-iopay-tx` | `.tmp-verify/painel/check-iopay-tx.ts` | 4.179 | **LIGADO** | decide pelo **pagamento aplicado** (`payments`), nunca pelo estado do vínculo — morre o atalho "já confirmei" |
| 5 | `force-confirm-payment` | `.tmp-verify/painel/force-confirm-payment.ts` | 3.749 | **LIGADO** | ação manual do admin (painel → Pagamentos) |
| 6 | `reconcile-payments` | `.tmp-verify/painel/reconcile-payments.ts` | 3.845 | **DESLIGADO** | **novo**: job de 15 min que varre pagamento aprovado no gateway sem liberação e refaz a liberação (é o que resolve a Cristiana sozinha) |
| 7 | `update-subscription-statuses` | `.tmp-verify/painel/update-subscription-statuses.ts` | 2.346 | **DESLIGADO** | rotina de ciclo de vida das assinaturas |

Caminho absoluto da pasta dos pacotes:

```
C:\Users\GABRIEL\Documents\DividePass\.tmp-verify\painel\
```

> Os pacotes são gerados por `node scripts/empacotar-function-painel.mjs`.
> Não edite dentro de `.tmp-verify` — edite em `supabase/functions/` e regere.

### Sobre o "Verify JWT"

- **LIGADO** (`verify_jwt = true`) para as que são chamadas pelo app com o JWT da
  pessoa: `create-payment`, `check-iopay-tx`, `force-confirm-payment`.
  O front manda `Authorization: Bearer <access_token>` em todas — sem isso quebra.
- **DESLIGADO** (`verify_jwt = false`) para as que são chamadas por máquina:
  `iopay-webhook` (gateway), `reconcile-payments` e `update-subscription-statuses`
  (cron, com segredo).
- `confirm-payment` não é chamada por HTTP (só importada por dentro de outras
  funções), então o toggle dela não muda nada — deixe como está.

---

## 3. Como colar no painel

1. Supabase → projeto **DividePass** → menu **Edge Functions** → clique na função.
2. No editor, **Ctrl+A** (seleciona tudo) e **Ctrl+V** (cola o arquivo inteiro por cima).
3. Confira a **última linha** no canto do editor: tem que bater com a contagem da
   tabela acima. Se ficar muito abaixo, o paste foi truncado — cole de novo.
4. Confira o toggle **Verify JWT** conforme a tabela.
5. Clique em **Deploy** e espere o status ficar `ACTIVE` (sem erro vermelho no log).
6. Passe para a próxima função da tabela.

Dica: se o editor do painel travar ou embaralhar o código, use o editor de verdade
(VS Code) para abrir o arquivo, Ctrl+A / Ctrl+C e cole no painel. Se preferir,
o repositório está no GitHub (`dividepass/dividepass`) e o painel do Supabase
suporta **"Deploy from GitHub"** — mas isso re-empacota o código-fonte com o
bundler do Supabase (não é exatamente o arquivo validado aqui).

---

## 4. Como conferir que deu certo

No terminal, na raiz do projeto:

```
node scripts/qa-fluxo-pagamento.mjs
```

Esperado depois de publicar: **47 OK / 0 FALHA**. Enquanto as antigas estiverem no ar
aparece `FALHA REGRESSÃO: transação inexistente NÃO pode vir como 'confirmed: true'`
e `AVISO reconcile-payments ainda não foi publicada (404)`.

---

## 5. Depois de publicar: os SQL (na ordem)

Todos rodam no **SQL Editor** do Supabase. Os arquivos já estão validados no
Postgres 17 local (rodando duas vezes para garantir idempotência).

### 5.1 Diagnóstico — antes de qualquer reparo

`database/diagnostico-pagamento-aprovado-sem-liberacao-2026-11-03.sql`

100% `SELECT`, não altera nada. Devolve 4 blocos:

1. quantas pessoas pagaram e não foram liberadas;
2. a lista (cliente, grupo, valor pago, tipo, estado da assinatura e do vínculo);
3. quem tem pagamento registrado mas liberação pela metade;
4. o recorte da Cristiana.

**Me mande a saída** — é o que define o tamanho do reparo.

### 5.2 Agendar o job de reconciliação (15 min)

`database/add-reconcile-cron.sql`

Precisa do segredo `reconcile_payments_cron_secret` — o arquivo diz como gerar.
É o que faz a liberação acontecer **sozinha** nas próximas horas (inclusive na da
Cristiana), sem depender de alguém abrir o painel.

### 5.3 Reparos pontuais (depois de ver o diagnóstico)

- `database/reparo-vinculos-e-assinaturas-2026-11-01.sql`
- `database/pagamentos-sem-liberacao-2026-11-01.sql`

Rodam **depois** de 5.1 e 5.2 — o job novo resolve sozinho o que for resolvivel, e
esses dois cuidam do que sobrar (inclusive os casos parciais).

---

## 6. O que me mandar de volta

1. A saída do diagnóstico (5.1) — texto, pode colar direto.
2. O resultado do `node scripts/qa-fluxo-pagamento.mjs` depois de publicar.
3. Se o cron (5.2) reclamou de algo, a mensagem de erro.
4. Depois de uns 15–30 min com o cron rodando: rodar o 5.1 de novo — o número de
   "pessoas afetadas" tem que cair a zero.
