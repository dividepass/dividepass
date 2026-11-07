# Pulse Coding — revenda dentro do DividePass

> Integração de **06/11/2026**. O DividePass vende, para os próprios
> clientes, produtos que a **Pulse Coding** revende. O cliente paga no
> DividePass, o DividePass compra na Pulse e entrega o acesso ao cliente.

---

## 1. A ideia em uma frase

Cada pacote do catálogo da Pulse vira um **grupo do DividePass** marcado com a
tag **"Via Parceiro"**, dentro da plataforma correspondente (Netflix,
ChatGPT, Claude, Prime Video…). O cliente vê o produto na vitrine normal,
paga no gateway do DividePass e, **depois** do pagamento confirmado, o
DividePass compra o pacote na Pulse e entrega a conta/link/licença/código
para ele.

```
  Catálogo da Pulse  ──sync──▶  grupos "Via Parceiro" na vitrine
                                        │
  Cliente paga no gateway do DividePass  │
                                        ▼
                             confirm-payment confirma
                                        │
                                        ▼
                          create_order na Pulse (external_id = meu pedido)
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
          webhook (rápido)                        polling (5 min)
                    └───────────────────┬───────────────────┘
                                        ▼
                          entrega no "Minhas Entregas" do cliente
```

---

## 2. Por que "grupo" e não "produto novo"

O DividePass já tem vitrine, checkout, assinatura, fatura, renewal e painel de
credencial prontos. E o `group_credentials` **aceita várias credenciais por
grupo** (o `UNIQUE` de `group_id` foi dropado em
`remove-group-credentials-unique.sql`).

Como a Pulse vende **conta privada por compra**, cada compra gera **uma
credencial só do comprador** — 1 compra = 1 cliente, sem rateio.

O grupo "Via Parceiro" é a **vitrine**, não o rateio:

| Campo | Valor | Por quê |
|---|---|---|
| `has_slot_limit` | `false` | "vagas ilimitadas": cada comprador leva a SUA conta |
| `tags` | `['Via Parceiro']` | marca a origem (o selo aparece na vitrine) |
| `is_official` | `true` | grupo da plataforma → **sem repasse** de carteira |
| `owner_id` | admin que rodou o import | grupo oficial, custo é da plataforma |
| `has_entrance_fee` | `false` | não existe taxa de adesão em produto de revenda |
| `chat_enabled` | `false` | não é grupo de rateio, é entrega de produto |
| `billing_cycle` | derivado do título | 1 Mês → monthly, 3 Meses → quarterly, 12 Meses → annual, 30 dias → days |

---

## 3. O que a API da Pulse faz DE VERDADE (testado em 06/11/2026)

A documentação da Pulse não descreve tudo, e três coisas mudam o código:

### 3.1 O `code` do corpo manda, não o status HTTP

| Situação real | HTTP | `code` no corpo |
|---|---|---|
| Saldo insuficiente | **400** (não 402) | `saldo_insuficiente` |
| Sem estoque | 409 | `sem_estoque` |
| Pacote inexistente | **404** (não 410) | `pacote_inexistente` |
| Pedido inexistente (`check_status`) | 404 | **sem `code` nenhum** |

Um 400 pode ser "dado inválido" **ou** "saldo"; um 404 pode ser "pacote
sumiu" **ou** "pedido não existe". Por isso o `pulseClient` traduz a resposta
em `PulseError.code` e o resto do sistema decide por ele.

### 3.2 O catálogo tem muito mais campos que a doc

`price` (o que EU pago), `original_price` (preço de venda ao consumidor),
`stock`, `automatic_stock`, `purchase_capacity`, `available_stock`,
`availability` (`automatic`/`manual`/`unavailable`), `delivery`
(`automatica`/`manual`), `orderable_via_api`, `credits`, `features`.

### 3.3 No dia da integração

- **81 pacotes** no catálogo: **63 compráveis via API**, **18 indisponíveis**
  (Netflix, Spotify, YouTube Premium, ChatGPT Plus Conta Privada, Google AI
  Pro, Gemini Pro…).
- **21 dos 63 têm margem ZERO** (`price` == `original_price`): todos os
  Antigravity, API Codex, os 2 Combos, Canva Pro 12M, ChatGPT Plus Extensão,
  Gemini Plus 12M. O painel marca esses como "sem margem".
- **Saldo da conta: R$ 0,00.** Nenhum pedido real sai (e o `dry_run` responde
  400) até recarregar.

---

## 4. Decisões do dono (o que foi fechado)

| Decisão | Valor |
|---|---|
| Preço de venda | `original_price` **+ 20%** de markup (editável por grupo) |
| Pacote indisponível | **importado**, mas **fora da vitrine** (`status=closed`, `visibility=private`) |
| Categoria "Serviços" | **excluída** do import automático |
| Modelo | **1 compra = 1 conta privada** do cliente |
| Renovação | **manual** (o cliente renova pelo fluxo normal → nova compra na Pulse) |

---

## 5. Arquivos

### Backend (Supabase Edge Functions)

| Arquivo | O que faz |
|---|---|
| `supabase/functions/_shared/pulse.ts` | **O `pulseClient`**: uma função por ação (`ping`, `getBalance`, `listPackages`, `createOrder`, `checkStatus`, `listOrders`), timeout 30 s, `PulseError` tipado por `code`, retry em 429/503/rede, HMAC do webhook. A chave vem SÓ de `Deno.env.get("PULSE_API_KEY")` e nunca é logada. |
| `supabase/functions/_shared/pulse-catalog.ts` | Regras do catálogo: plataforma de destino, ciclo derivado do título, markup, margem, o que é ignorado. |
| `supabase/functions/_shared/pulse-orders.ts` | Idempotência e gravação: `garantirPedido` (cria o `external_id` uma vez), `aplicarEntrega`, `atualizarPedidoComResposta`, `reprocessarPendentes`. |
| `supabase/functions/_shared/pulse-import.ts` | O importador: cria plataforma/plano/grupo e o espelho local. Idempotente. |
| `supabase/functions/pulse-admin/index.ts` | Painel do admin (JWT + `role=admin`): saldo, sync, catálogo, pedidos, remapeamento, dry-run. |
| `supabase/functions/pulse-webhook/index.ts` | Receptor do webhook. `verify_jwt = false` + assinatura `X-Pulse-Signature` **obrigatória**. |
| `supabase/functions/pulse-entrega/index.ts` | O cliente busca a SUA entrega (JWT obrigatório, filtrado por `user_id`). |
| `supabase/functions/pulse-poll/index.ts` | Job de polling dos pedidos pendentes (rede de segurança do webhook). |

### Banco

`database/EXECUTAR-2026-11-06-pulse-parceiro.sql` — 5 tabelas, view, RLS, guarda
do trigger e o cron do polling. **Idempotente**: pode rodar mais de uma vez.

| Tabela | Para quê |
|---|---|
| `pulse_pacotes` | Espelho do catálogo da Pulse (o `package_id` **nunca** fica fixo no código) |
| `pulse_mapeamentos` | Grupo do DividePass ↔ pacote da Pulse (+ custo, margem, status) |
| `pulse_pedidos` | Os meus pedidos (`external_id` único, status, custo, tentativas) |
| `pulse_entregas` | O que o cliente recebeu (conta, link, licença, código) |
| `pulse_eventos` | Auditoria |

### Frontend

| Arquivo | O que faz |
|---|---|
| `src/pages/admin/PulseCatalog.jsx` | `/admin/pulse` — saldo, sync, catálogo com margem, pedidos |
| `src/pages/admin/PulseOrderDetail.jsx` | `/admin/pulse/pedidos/:id` — **página com id na URL**, nunca drawer |
| `src/pages/user/MyDeliveries.jsx` | `/dashboard/entregas` — "Minhas Entregas" |
| `src/components/GroupTags.jsx` | Selo "Via Pareiro" na vitrine |
| `src/pages/user/ServiceCredentials.jsx` | **Correção**: mostra a credencial **atribuída a mim**, não a primeira do grupo |

---

## 6. O gancho no `confirm-payment`

O ponto de hooked é `supabase/functions/confirm-payment/index.ts`, dentro do
ramo `subscription`, e ele roda em três momentos:

1. **Detecta** se o grupo é "Via Parceiro" (`groups.tags` + mapeamento ativo).
2. **Ajusta as datas** da assinatura:
   - `next_charge_at = NULL` — o job de cobrança recorrente filtra por
     `next_charge_at <= agora` e o NULL é excluído pelo PostgREST. Sem isso, o
     cron **cobraria o cliente sem comprar nada na Pulse** (esse job NÃO
     passa pelo `confirmPayment`);
   - `renewal_due_at` / `expires_at` = data de validade do pacote;
   - **não** cria `billing_cycles` pendente.
3. **Compra** (depois do pagamento registrado): `processarCompraViaParceiro`.

**Falha da Pulse nunca derruba a confirmação.** O cliente pagou e tem que
entrar no grupo de qualquer jeito: o pedido fica `pendente` e o webhook/polling
tenta de novo.

---

## 7. Garantia de "não cobra duas vezes"

| Camada | Como |
|---|---|
| `external_id` | Gerado **uma vez** por pedido (8 caracteres, letras e números) e **nunca** muda. É o id do MEU pedido na Pulse. |
| Repetição | Timeout/erro de rede → repete com o **mesmo** `external_id` (a Pulse devolve `duplicate: true` e não cobra de novo). |
| Replay do webhook do gateway | `pulse_pedidos` tem `UNIQUE (transaction_code, group_id)` → não nasce um segundo pedido. |
| Pedido já entregue | `processarCompraViaParceiro` sai sem comprar de novo. |

> **Nunca** gerar `external_id` novo para o mesmo pedido.

---

## 8. Checklist — o que precisa ser cadastrado

### 8.1 O segredo da API

```bash
# No terminal (a chave NUNCA vai para o repositório nem para o front):
supabase secrets set PULSE_API_KEY=pk_...
```

O `.env` local já tem a chave para os scripts de teste — o `.env` está no
`.gitignore` e o frontend **nunca** lê essa variável (só `VITE_*` vai para o
bundle).

> A chave foi colada no chat nesta conversa. **Gire-a** no painel da Pulse e
> cadastre a nova como secret antes de ligar a compra real.

### 8.2 O saldo

Recarregar na Pulse Coding. **Hoje está em R$ 0,00** — sem isso nenhum
`dry_run` e nenhum pedido real passam.

### 8.3 O banco

Rodar `database/EXECUTAR-2026-11-06-pulse-parceiro.sql` no SQL Editor do
Supabase (produção: `lasoouwboxspstqvjbsv`). O arquivo cria as tabelas, o
cron do polling, o segredo do job e a URL do webhook.

### 8.4 As edge functions

```bash
node scripts/publicar-functions.mjs          # (ou o script de pendências)
```

`supabase/config.toml` já tem os quatro blocos: `pulse-admin` e `pulse-entrega`
com `verify_jwt = true`; `pulse-webhook` e `pulse-poll` com `verify_jwt = false`
(o webhook é chamado pelo servidor da Pulse e o poll pelo cron — ambos se
autenticam dentro do código).

### 8.5 O webhook na Pulse

Cadastrar na Pulse Coding:

```
https://lasoouwboxspstqvjbsv.supabase.co/functions/v1/pulse-webhook
```

A URL já é gravada sozinha em `app_settings.pulse_webhook_url` (é por ela que
os pedidos saem com `webhook_url`). O segredo do job é criado em
`app_settings.pulse_cron_secret`.

---

## 9. Testes

```bash
node scripts/pulse-teste.mjs      # 65 asserções, SEM rede (fetch mockado)
node scripts/pulse-dry-run.mjs    # cadeia real, dry_run (NÃO cobra)
```

O `pulse-teste.mjs` importa o **mesmo módulo** que vai para a edge function
(o `pulse.ts`), com um shim de `Deno.env`. Ele cobre: as 6 ações, cada `code`
de erro, o retry de 429 e de rede, o timeout, a assinatura do webhook (e a
recusa de corpo adulterado), a idempotência do `external_id`, a classificação
das 4 entregas e as regras de catálogo (ciclo, markup, margem, plataforma de
destino, exclusão de "Serviços").

---

## 10. Operação diária

| Ação | Onde |
|---|---|
| Sincronizar o catálogo | `/admin/pulse` → **Sincronizar** (ou **Simular sync** antes) |
| Ver saldo | `/admin/pulse` → card "Saldo na revenda" |
| Remapear pacote sumido | `/admin/pulse` → aba Pedidos → pedido → ver o `package_id` |
| Ver o que o cliente recebeu | `/admin/pulse/pedidos/:id` → bloco "Entrega" |
| Ver as entregas do cliente | `/dashboard/entregas` (o cliente) |

### Quando a Pulse troca o id de um pacote

1. A compra falha com `pacote_inexistente` (404).
2. O mapeamento vira `precisa_remap`, o grupo é fechado (`closed`/`private`) e
   some da vitrine.
3. O admin recebe um evento em `platform_events` ("Pacote da Pulse sumiu do
   catálogo").
4. O sync traz o pacote novo; o admin remapeia o grupo para o `package_id`
   novo e o grupo volta para a vitrine.

**O cliente nunca fica sem entrega por causa disso**: o pedido fica `pendente`
e o polling continua tentando.

---

## 11. Segurança — o que NÃO pode acontecer

| Regra | Como é garantida |
|---|---|
| A chave não vaza para o front | Só `PULSE_API_KEY` (sem `VITE_`) é lida; o bundle do Vite não a enxerga |
| A chave não aparece em log | Nenhum `console.log` do valor; os erros da API não a repetem |
| O navegador não fala com a Pulse | Todas as chamadas saem da edge function |
| Compra só depois do pagamento | O gancho está depois de `registrarPagamento` no `confirm-payment` |
| Um cliente não vê a entrega de outro | `pulse_entregas` só é lida pela edge function, filtrada por `user_id` |
| A conta privada não vaza para o grupo | A entrega NÃO vai para `group_credentials` (o trigger `release_credential` desalocaria a credencial e a deixaria visível para os outros membros) |
| A credencial do grupo não mostra a conta de outro | `ServiceCredentials.jsx` agora escolhe a credencial **atribuída a mim** |
| Compra sem saldo não trava o site | O erro vira `saldo_insuficiente` e um aviso no painel; a confirmação do pagamento segue |
| Webhook falsificado não entra | `X-Pulse-Signature` = HMAC-SHA256 do corpo cru, conferido em tempo constante |
