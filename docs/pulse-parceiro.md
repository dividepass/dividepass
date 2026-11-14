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
| `supabase/functions/pulse-poll/index.ts` | Job de polling dos pedidos pendentes (rede de segurança do webhook). Atualiza também a tag "Esgotado" (estoque) a cada 5 minutos. |
| `supabase/functions/pulse-status/index.ts` | Job de cron (5 em 5 horas): sincroniza o **status** dos grupos com a Pulse ("Na vitrine" libera, "Indisponível" desativa). Ver seção 19. |

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

As funções são publicadas pela **Management API** (o CLI do Supabase dá 403
neste projeto), com o empacotador do repo — que embute os módulos de
`_shared/` num arquivo só:

```bash
npm run pulse:publicar
# = node scripts/publicar-functions.mjs --only=pulse-admin,pulse-entrega,pulse-webhook,pulse-poll,pulse-status --real
```

O `--only` existe para publicar **uma rodada** sem tocar no resto do que já
está no ar. O fluxo completo (empacotar + publicar) é:

```bash
node scripts/empacotar-function-painel.mjs pulse-admin pulse-entrega pulse-webhook pulse-poll pulse-status
node scripts/publicar-functions.mjs --only=pulse-admin,pulse-entrega,pulse-webhook,pulse-poll,pulse-status --real
```

`supabase/config.toml` já tem os quatro blocos: `pulse-admin` e `pulse-entrega`
com `verify_jwt = true`; `pulse-webhook` e `pulse-poll` com `verify_jwt = false`
(o webhook é chamado pelo servidor da Pulse e o poll pelo cron — ambos se
autenticam dentro do código).

### 8.5 O segredo e as configurações

O segredo e as configurações saem juntos, num comando:

```bash
npm run pulse:config -- --aplicar
# = node scripts/configurar-pulse.mjs --aplicar
```

Ele:
1. cadastra o **segredo** `PULSE_API_KEY` (pela Management API — o navegador
   não escreve secret);
2. grava `pulse_webhook_url` e `pulse_markup` em `app_settings`;
3. mostra o estado: functions publicadas, segredo cadastrado, saldo.

Depois disso, **as configurações são editáveis no painel**, em
`/admin/settings` → **Revenda — Pulse Coding**: a URL do webhook e a margem.
O importador lê a margem de lá (não do código) — mudar a margem no painel
vale na próxima sincronização, sem republicar nada.

> A **chave da API não é editável no painel** (de propósito): um campo de
> texto para o segredo no navegador seria uma brecha.

### 8.6 O webhook na Pulse

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
npm run pulse:test      # 68 asserções, SEM rede (fetch mockado)
npm run pulse:dry-run  # cadeia real, dry_run (NÃO cobra)
npm run pulse:qa       # QA em produção: ping, saldo, catálogo e sync em dry_run
npm run pulse:bundle   # confere se o bundle PUBLICADO já tem o código novo
```

O `pulse-teste.mjs` importa o **mesmo módulo** que vai para a edge function
(o `pulse.ts`), com um shim de `Deno.env`. Ele cobre: as 6 ações, cada `code`
de erro, o retry de 429 e de rede, o timeout, a assinatura do webhook (e a
recusa de corpo adulterado), a idempotência do `external_id`, a classificação
das 4 entregas e as regras de catálogo (ciclo, markup, margem, plataforma de
destino, exclusão de "Serviços", rótulo do período).

O `qa-pulse-sync.mjs` é o teste de produção: ele bate na `pulse-admin` e
mostra o que a sincronização faria. A ação `sync` é de **admin** — a conta QA
não é, e o script avisa isso em vez de falhar calado.

O `conferir-bundle-pulse.mjs` existe porque *"deployed successfully"* **não
prova** que a versão nova foi publicada: cada function embute uma cópia dos
módulos de `_shared`. Ele lê o corpo publicado (vem em bytes — decodificar
como UTF-8) e procura as marcas do código novo.

---

## 10. Armadilhas da publicação (todas encontradas na prática)

### 10.1 O empacotador e o `import type`

O empacotador (`scripts/empacotar-function-painel.mjs`) não entendia
`import type { X } from "./y.ts"` (a forma de statement). O arquivo gerado
saía com `const type { X } = m_y;` — sintaxe inválida — e o deploy morria com
*"Expected a semicolon"*. **Corrigido** no empacotador (import só de tipo não
gera vínculo nenhum: o tipo já foi içado para o topo do arquivo).

O modificador inline (`import { a, type B }`) já funcionava.

### 10.2 Forma abreviada com nome diferente do campo

No importador, o campo do parâmetro é `grupo_id` e a variável local é
`group_id`. A forma abreviada (`grupo_id,`) procurava uma variável que não
existe e derrubava o import com *"grupo_id is not defined"*.

Pior: no `dry_run` isso **só** atingia as plataformas que JÁ existiam (as
novas eram puladas), então o catálogo parecia importar bem. Só no sync real
apareceu — e aí caía em **todos** os 81 pacotes.

### 10.3 Nome de função diferente do importado

`limiterDescricao` importado de um módulo que exporta `limparDescricao`:
TypeScript reclama, mas o *stripper* de tipos do Deno não — no runtime vira
`undefined` e o erro só aparece na hora de usar.

**Regra que sobrou:** depois de mexer num módulo de `_shared/`, rodar o
empacotador e conferir o pacote gerado antes de publicar.

### 10.4 `CHECK` do banco em `service_plans.billing_cycle`

| Tabela | Valores aceitos em `billing_cycle` |
|---|---|
| `groups` | monthly, quarterly, semiannual, annual, custom, **days** |
| `service_plans` | monthly, quarterly, semiannual, annual (**sem `days`**) |

Um produto de prazo em dias (extensão de 7 dias, por exemplo) gerava
`days` no plano e o banco recusava. O plano grava agora o ciclo mais próximo
(`monthly`) e o **prazo exato fica no grupo**, em `custom_cycle_days` — que é
o que vale na cobrança e na expiração.

### 10.5 `cron.unschedule` só existe se o job existir

Chamar `cron.unschedule('pulse-poll')` sem job criado é erro. O bloco do cron
agora confere antes e, se a extensão `pg_cron` não estiver no banco, pula com
um aviso em vez de estourar o arquivo inteiro.

### 10.6 No ciclo `days`, `price_per_slot` é o TOTAL do período

Em todos os outros ciclos, `groups.price_per_slot` é o preço **mensal** da
vaga — o checkout multiplica pelo ciclo. No ciclo `days` não dá para multiply
por "mês": o pacote "Extensão de 7 dias" custa R$ 119,88 **pelos 7 dias**.

Por isso o front não pode escrever "/mês por perfil" num grupo em dias — o
cliente leria um valor por mês que não existe. A regra ficou em
`src/lib/subscriptionCycles.js`:

| Helper | Para que serve |
|---|---|
| `groupPeriodLabel(group)` | `'mês'`, `'trimestre'`, `'7 dias'`, `'2 meses'` |
| `groupPriceSuffix(group)` | `'/mês por perfil'` ou `'/7 dias'` |

O importador grava o rótulo em `groups.custom_cycle_label` (`rotuloCiclo()` em
`pulse-catalog.ts`): é ele que evita o "1 dias" no singular e escreve
"Período (1 dia)" no checkout em vez de "1ª mensalidade (1 dia)".

O checkout já suportava `days` desde o começo (`monthsForCycle` devolve 1 mês
para o cálculo e `daysForCycle` devolve o prazo exato, que vai no payload como
`custom_cycle_days`).

---

## 11. Operação diária

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

## 12. Segurança — o que NÃO pode acontecer

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

---

## 13. O fornecedor aparece como DIVIDEPASS

Decisão do dono: **ninguém precisa saber quem é o parceiro de trás** — o
fornecedor é a **DividePass**. A marca do fornecedor não é apagada: ela é
**trocada por "DividePass"** em tudo que o cliente lê.

| Onde a marca aparecia | O que é agora |
|---|---|
| Nome do grupo ("Extensão Pulse Codig Duração De 7 dias") | "Extensão DividePass — Duração De 7 dias - 100 créditos" |
| Descrição ("Suporte da PULSE para dúvidas") | "Suporte da DividePass para dúvidas" |
| Regras ("entrega individual via Pulse Coding") | "Esta é uma entrega individual via DividePass…" |
| Nome do plano (`service_plans.name`) | o mesmo título trocado |
| Plataforma ("Pulse Coding", "Combos Pulse", "Pulse Clone") | **Extensões**, **Combos**, **Clones** (slug novo: `extensoes`, `combos`, `clones`) |
| Nome do produto na tela de entregas | o título trocado (`pulse-entrega` troca na hora de responder) |
| Tooltip do selo "Via Parceiro" | "Acesso obtido com a DividePass…" |

A troca é feita por `marcarComoDividePass()` (`_shared/pulse-catalog.ts`):
a marca vira "DividePass" e, quando ela está no meio do nome, entra um
separador ("Extensão DividePass — Duração De 7 dias"). O **espelho local**
(`pulse_pacotes`) continua com o texto cru — quem precisa saber qual pacote é
qual é o admin.

**O selo "Via Parceiro" aparece UMA vez.** O importador usava `plan_type`
para marcar o grupo, e isso fazia o `GroupTags` desenhar dois chips: o da tag
e o de "Tipo de conta compartilhada". O `plan_type` agora fica vazio — a tag
basta, e o texto antigo além de repetir descrevia errado (o acesso é privado).

### 13.1 O dono dos grupos é o admin oficial

O `owner_id` do grupo decide **para onde vai o repasse do dinheiro**. Ele
precisa ser sempre o admin oficial (`admin@dividepass.com`), nunca quem
disparou o sync.

Antes, o importador usava o id de quem chamou a função — e o primeiro sync
(feito com a conta QA de sondagem) deixou os 79 grupos com o dono errado.
Agora `resolverDonoAdmin()` procura o admin oficial e só cai no "admin mais
antigo" se ele não existir.

**Armadilha do banco:** o trigger `guard_group_privileged_fields` bloqueia a
mudança de `owner_id` para quem não é admin — e a edge function roda com
`service_role`, que não passa por essa checagem. O sync quebrava com 79
erros. A seção **9.5** do arquivo SQL libera o trigger para a `service_role`
(o backend da plataforma), sem abrir nada para o usuário: a `service_role`
já ignora RLS.

---

## 14. O dinheiro: quem paga o quê (e onde está o "split")

### 14.1 O fluxo, do checkout ao parceiro

```
Cliente paga R$ 119,88 (preço de venda = custo × markup)
      │
      ▼
Gateway (IoPay / Woovi) → cai na conta da PLATAFORMA
      │
      ▼
confirm-payment  ──► registra o pagamento
      │
      ▼
processarCompraViaParceiro  ──► POST create_order na API da Pulse
      │                            (external_id = 8 chars, o mesmo sempre)
      ▼
API da Pulse debita o SALDO DE REVENDA (o custo, R$ 99,90)
      │
      ▼
pulse_entregas  ──► a conta/link/licença/código chega ao cliente
      │              (tela "Minhas Entregas")
      ▼
DividePass fica com a MARGEM: R$ 119,88 − R$ 99,90 = R$ 19,98
```

**O pagamento ao parceiro JÁ é automático** — é o `create_order` da API da
Pulse, que debita o saldo de revenda com o **custo** do pacote. O que o
gateway faz é só cobrar do cliente.

### 14.2 Não existe split de marketplace (e não precisa existir)

O termo "split" neste projeto é outra coisa: é a **divisão por método de
pagamento** (`gateway-por-metodo.ts` — Pix num gateway, cartão noutro). Não
é partilha de receita entre a plataforma e um parceiro.

E não é preciso: o repasse do dono do grupo é feito pelo trigger do banco
`trg_credit_wallet_on_payment`, e ele **não repassa** quando:

| Situação | O que o trigger faz |
|---|---|
| Grupo `is_official = true` | "sem repasse: grupo oficial ou sem dono" |
| Dono do grupo com `role = 'admin'` | "sem repasse: grupo da propria plataforma" |

Os grupos "Via Parceiro" são os dois casos ao mesmo tempo (são oficiais **e**
o dono é o admin da plataforma). Então **100% do valor pago pelo cliente fica
na plataforma**, que depois paga o custo para o parceiro pela API. Isso é o
modelo correto: o repasse ao dono do grupo (que exigiria uma carteira e um
saque) não se aplica a um grupo cujo dono é a própria plataforma.

### 14.3 O que ainda depende de saldo

O `create_order` debita o **saldo de revenda** da Pulse. Se ele acabar, a
compra falha com `saldo_insuficiente` (HTTP 400) — o cliente já pagou, e o
pedido fica pendente até o saldo ser recarregado. Por isso o painel mostra o
saldo no topo e o sync é a primeira coisa a rodar.

### 14.4 O que é registrado (para conferir depois)

| Onde | O que guarda |
|---|---|
| `pulse_mapeamentos.custo` | o custo do pacote (o que a Pulse cobra) |
| `pulse_mapeamentos.preco_venda` | o preço de venda (custo + markup) |
| `pulse_mapeamentos.margem` | a diferença |
| `pulse_pedidos.custo` | o custo real cobrado no pedido |
| `pulse_pedidos.preco_pago` | o que o cliente pagou |

---

## 15. Assinatura x pagamento único — e a capa

### 15.1 A API não tem campo "recorrente"

A API de revenda devolve **23 campos** e **nenhum** diz se o produto é
assinatura ou pagamento único. O que ela devolve de útil:

| Campo | Para que serve |
|---|---|
| `price` | o **custo** (o que a gente paga na revenda) |
| `original_price` | o preço de venda a partir do qual o markup é calculado |
| `delivery` | `"automatica"` ou `"manual"` — a entrega chega sozinha ou precisa de mão |
| `availability` | `"automatic"` / `"manual"` / `"unavailable"` |
| `credits` / `credit_amount` | saldo que vem junto |
| `duration` (no título) | o período do acesso |

A classificação (`classificarProduto()`) sai daí:

| Produto | Natureza | Por quê |
|---|---|---|
| Netflix 1 mês, Canva Pro 12 meses, VIDEOAPI Plano Starter | **recorrente** | acesso contínuo + período no título |
| Extensão 7 dias — 100 créditos | **pagamento único** | entrega saldo (créditos) |
| ANTIGRAVITY — 1 BILHÃO DE TOKENS | **pagamento único** | entrega saldo (tokens) |
| CloneSupa — 2 Clones | **pagamento único** | não tem período no título |

No resultado atual: **36 recorrentes** e **43 pagamento único**. E **20
pacotes com entrega manual** — neles, o pedido fica esperando a entrega à
mão (o painel marca "Entrega manual").

A natureza fica gravada em `pulse_mapeamentos.natureza` e aparece no painel
`/admin/pulse`, na coluna "Cobrança".

### 15.2 A cobrança

Para **os dois** casos a cobrança no DividePass é a mesma: uma compra única,
com `next_charge_at = NULL` (sem recorrência automática). A diferença é o
**efeito**:

- **recorrente** → o acesso renova a cada ciclo; a renovação é manual (o
  cliente renova, a gente compra de novo na Pulse);
- **pagamento único** → o cliente não renova: ele compra de novo quando o
  saldo acaba.

A renovação automática ficou desligada de propósito: o
`process-recurring-billing` **não** chama o `confirm-payment`, então
cobraria o cliente sem comprar nada na Pulse. Para ligar a recorrência
automática, o passo que falta é fazer o job de recorrência comprar na Pulse
antes de cobrar do cliente — e isso só dá com saldo em cima.

### 15.3 A capa

**A API de revenda não devolve imagem nenhuma** (nenhum dos 23 campos é capa).
O que existe é o **logo da plataforma** no Supabase Storage
(`streaming_services.icon_url`) — Netflix, Spotify, ChatGPT, Claude, Prime
Video, YouTube já têm.

Então a capa do grupo importado é o logo da plataforma (`groups.photo_url`).
Hoje **43 dos 81** pacotes têm capa; os outros estão em plataformas criadas
pelo importador (Extensões, Clones, Combos, Antigravity…), que ainda não têm
logo — e ficam com o placeholder de ícone.

Para dar capa aos que faltam, o caminho é subir o logo de cada plataforma no
bucket `platforms` do Supabase Storage e rodar o sync de novo.

---

## 16. Estoque do parceiro — a tag "Esgotado"

### 16.1 Qual campo de estoque manda

A API traz **cinco** campos de estoque e eles **não concordam**:

| Campo | O que é | Exemplo |
|---|---|---|
| `stock` | estoque automático | 0 em **22** produtos de entrega manual que ainda vendem |
| `automatic_stock` | idem | 0 |
| `available_stock` | **o que dá para vender agora** | 100 (esses 22) |
| `in_stock` / `available` | flags | `false` em 19 produtos zerados de verdade |
| `purchase_capacity` | limite de compra | idem `available_stock` |

Usar `stock` apagaria da vitrine 22 produtos que estão à venda. Por isso a
regra é:

> **estoque <= 0** = `available_stock <= 0` **ou** `in_stock === false`.

### 16.2 O que acontece com o produto sem estoque

O grupo **continua na vitrine** (a pessoa vê que o produto existe) e ganha a
tag **"Esgotado"** — o mesmo comportamento de um grupo cheio. Três camadas:

| Camada | Onde | O que faz |
|---|---|---|
| Vitrine | `Catalog.jsx` | o card mostra o selo vermelho e o CTA vira "Esgotado" |
| Página do grupo | `GroupDetail.jsx` | botão "Esgotado — sem estoque", desativado |
| Checkout | `Checkout.jsx` | tela "Esgotado — sem estoque no momento" |
| **Servidor** | `create-payment` | **403 `grupo_esgotado`** — quem paga é bloqueado |

O front sozinho não protege nada (dá para chamar a API direto), então a
trava que importa é a do `create-payment`. A **renovação** não é bloqueada: a
pessoa pagou antes e o acesso dela depende disso.

### 16.3 Quem atualiza a tag

| Quem | Quando | Custo |
|---|---|---|
| Importador (sync) | quando o dono roda a sincronização | 1 `list_packages` |
| **Cron do polling** | **a cada 5 minutos** | 1 `list_packages` por rodada |

O cron (`pulse-poll`) chama `atualizarEstoque()` (`_shared/pulse-estoque.ts`):
busca o catálogo, e para cada grupo **da vitrine** põe ou tira a tag
"Esgotado". Com o limite de 30 requisições por minuto da API, 12 chamadas por
hora não são nada — e a tag fica sempre fresca.

Grupo que está **fora** da vitrine (o parceiro nem libera aquele pacote para
revenda) não recebe a tag: ela é invisível ali e só sujaria o dado. Hoje são
**19** produtos assim.

### 16.4 Prova (o que foi testado em produção)

```bash
node .tmp-verify/prova-esgotado.mjs
```

O script coloca a tag à mão (é o que o importador/cron fazem quando o
estoque acaba), verifica as três camadas e remove a tag no final:

```
card: CTA="Esgotado"  selo="Esgotado"
checkout: Esgotado — Este produto está sem estoque no momento…
create-payment -> HTTP 403
corpo: {"error":"Este produto está sem estoque…","code":"grupo_esgotado"}
```

---

## 17. Como conferir

```bash
npm run pulse:test        # 89 asserções, sem rede
npm run pulse:dry-run     # cadeia real, dry_run (NÃO cobra)
npm run pulse:qa          # QA em produção: ping, saldo, catálogo e sync
npm run pulse:bundle      # confere se o bundle PUBLICADO já tem o código novo
node .tmp-verify/visual-sem-marca.mjs    # varre as páginas do cliente
```

---

## 18. Grupo indisponível fica TRANSPARENTE (pedido do dono, 08/11/2026)

> "quando tiver esgotado ou o grupo cheio ou desativado você deixa o grupo
> com uma opacidade menor e deixa mais transparente."

O card de um grupo que **não dá para comprar agora** não pode competir com o
card de um grupo que dá. Ele fica **visivelmente mais fraco**, e o motivo
continua escrito (selo "Esgotado", "Grupo lotado", badge "Fechado").

| Onde | Classe | Opacidade |
|---|---|---|
| Vitrine (card) | `group-card-full` / `group-card-esgotado` / `group-card-desativado` | **0.6** |
| Vitrine (card cheio) | idem | **0.6** (era 0.7) |
| Página do grupo (cabeçalho) | `gd-header-indisponivel` | **0.65** |
| "Meus Grupos" (card) | `my-group-card-inativo` | **0.6** |

O card transparente **não ganha elevação no hover** (a sombra reforçada que um
card "vivo" tem) — senão o card morto continua chamando mais atenção que o vivo.

### 18.1 De onde vem o "indisponível"

Tudo passa por `src/lib/groupEstado.js` (criado nesta rodada, substituiu o
antigo `groupEsgotado.js`):

| Função | Verdade quando |
|---|---|
| `grupoEsgotado(g)` | a tag **"Esgotado"** está em `g.tags` (o cron de estoque do parceiro aplicou) |
| `grupoDesativado(g)` | `g.status === 'closed'` |
| `grupoIndisponivel(g)` | qualquer um dos dois (ou cheio, no card) |

O card da vitrine usa as três classes; a página do grupo usa `grupoIndisponivel`
para o header **e** para desativar o segundo CTA com o texto **"Esgotado — sem
estoque"** (antes era "Entrar no grupo", que prometia uma compra impossível).
"Eu pego, sem vaga, sem estoque" virou **"Vagas ilimitadas"**.

### 18.2 Prova em produção (estoque REAL zero)

```bash
node .tmp-verify/prova-transparencia-esgotado.mjs   # estados e opacidades
node .tmp-verify/prova-transparencia-cards.mjs      # card por elemento (screenshot)
node .tmp-verify/prova-meus-grupos.mjs              # "Meus Grupos"
```

O script abre por um instante um produto que o parceiro **não libera**
(estoque zerado de verdade), deixa o cron (`pulse-poll`) aplicar a tag
"esgotado" sozinho, mede a opacidade e **restaura** o grupo no `finally`.

Resultado medido em `dividepass.com` (08/11/2026):

```
Amazon Prime Video 6M   | opacidade=1    | selo=""            | Entrar no grupo
Amazon Prime Video 1M   | opacidade=0.6  | selo="Esgotado"    | Esgotado
Prime - Grupo 1         | opacidade=0.6  | selo=""            | Grupo lotado
página do grupo: header opacidade=0.65 | CTA="Esgotado — sem estoque" desativado=true
Meus Grupos: .my-group-card-inativo -> opacidade=0.6
```

---

## 19. STATUS dos grupos sincronizado com a Pulse (13/11/2026)

> "precisamos criar um cron que a cada 5 horas fazemos a sincronia de dados
> com a pulse… se o grupo X estava com o status 'Na vitrine' e na nova
> sincronia esse grupo X passou a ficar com status 'Indisponível' ai devemos
> desativar o grupo para que mais nenhuma pessoa faça pagamento e entre neste
> grupo."

### 19.1 A regra

O status do produto na Pulse é o **mesmo vocabulário** do painel dela:

| Na Pulse | No grupo (DividePass) | O que acontece |
|---|---|---|
| **Na vitrine** | `status = 'open'`, `visibility = 'public'` | liberado, clicável, à venda |
| **Indisponível** | `status = 'closed'`, `visibility = 'private'` | **DESATIVADO**: sai da vitrine, ninguém paga, ninguém entra |

E o estado volta: quando a Pulse volta a liberar o produto, a sincronização
**reativa** o grupo (`open` + `public`) e ele volta para a vitrine.

### 19.2 Status e ESTOQUE são coisas diferentes

| Situação | O que o cliente vê |
|---|---|
| Pulse "Indisponível" (o parceiro tirou do cardápio) | o produto **sai da vitrine** — não faz sentido anunciar o que o fornecedor tirou |
| Pulse "Na vitrine" **sem estoque** | o produto **continua anunciado**, com o selo **"Esgotado"**: a pessoa vê que existe e entra na lista de espera, mas não consegue comprar |

No catálogo de 13/11/2026 os dois casos ainda andam juntos (os produtos
indisponíveis são exatamente os que estão com estoque zero), mas a API trata
os campos separados — e é por isso que a sincronização olha para os dois.

### 19.3 O que "desativado" bloqueia (de verdade)

| Onde | O que acontece |
|---|---|
| Vitrine (card) | o card aparece **sem clique** (cursor `not-allowed`) e com o selo "Esgotado" |
| Página do grupo | o CTA vira **"Esgotado — indisponível"**, desativado |
| Checkout | mostra a tela **"Esgotado"** em vez de cobrar |
| `joinGroup` (entrar no grupo) | **recusa** ("Este grupo está indisponível no momento…") |
| `create-payment` (servidor) | **403 `grupo_desativado`** — a trava que importa (o front pode ser contornado) |
| Painel do admin | coluna "Grupo" com o estado do grupo (Na vitrine / Formando / Esgotado) |

A **renovação** nunca é bloqueada: quem pagou antes precisa do período pago.

### 19.4 O cron (5 em 5 horas)

Job `pulse-status` → edge function `pulse-status` (segredo `pulse_cron_secret`):

```
0 */5 * * *      →  00h, 05h, 10h, 15h, 20h (UTC)
```

```bash
# conferir o job
node scripts/supabase-sql.mjs --query \
  "select jobid, jobname, schedule, active from cron.job where jobname = 'pulse-status'"

# disparar na mão (o segredo está em app_settings)
curl -X POST https://lasoouwboxspstqvjbsv.supabase.co/functions/v1/pulse-status \
  -H "Authorization: Bearer <pulse_cron_secret>" -H "Content-Type: application/json" -d '{}'
```

O mesmo caminho está no botão **"Sincronizar status"** do painel
(`/admin/pulse`), que dispara a mesma função com o JWT do admin.

Por que 5 horas e não 5 minutos (que é o do `pulse-poll`): o **estoque** muda
o dia a dia (o `pulse-poll` atualiza a tag "Esgotado" a cada 5 minutos); o
**status** do produto é mais estável.

### 19.5 A REGRA DE OURO (o que a sincronização NUNCA faz)

**Só mexe em grupo cujo pacote ESTÁ no catálogo da rodada.** Se a API responder
com o catálogo pela metade, nenhum grupo é desativado — é melhor um grupo
"Na vitrine" velho do que apagar a vitrine inteira. Aconteceu de verdade:
8 produtos saíram do catálogo da Pulse e os grupos deles ficaram intactos
(`closed`/`private`, que é o estado de "não oferecido").

### 19.6 Arquivos desta rodada

| Arquivo | O que faz |
|---|---|
| `supabase/functions/_shared/pulse-catalog.ts` | `statusPulseDoPacote()` / `rotuloStatusPulse()` |
| `supabase/functions/_shared/pulse-status.ts` | `sincronizarStatusParceiro()` — a regra inteira |
| `supabase/functions/pulse-status/index.ts` | a edge function (alvo do cron) |
| `supabase/functions/create-payment/index.ts` | bloqueia grupo desativado (403 `grupo_desativado`) |
| `src/lib/groupEstado.js` | `statusGrupoLabel()` — o vocabulário "Na vitrine / Formando / Esgotado" |
| `src/pages/user/Catalog.jsx` | selo "NA VITRINE" + card não clicável quando Esgotado |
| `src/pages/user/GroupDetail.jsx` | selo e CTA "Esgotado — indisponível" |
| `src/pages/user/Checkout.jsx` | tela "Esgotado" em vez de cobrança |
| `src/hooks/useAppData.js` | `joinGroup` recusa grupo indisponível |
| `database/EXECUTAR-2026-11-13-pulse-status-cron.sql` | o job (idempotente) |

### 19.7 Prova em produção (13/11/2026)

```
pulse-status rodando: total=101 na_vitrine=72 indisponiveis=21
                       desativados=0 reativados=1 (produto que voltou)

create-payment num grupo desativado:
  HTTP 403 {"code":"grupo_desativado","status":"closed",
            "error":"Este produto está indisponível no momento e não aceita novos pagamentos."}

Testes: node scripts/pulse-teste.mjs → 107 passaram · 0 falharam
```

### 19.8 Aviso quando um grupo COM gente pagante é desativado

Desativar o grupo **não tira o acesso de quem já pagou**:

- a assinatura continua renovando (a cobrança recorrente é feita pelo
  `process-recurring-billing` direto no gateway — ela **não** passa pelo
  `create-payment`, então o guard do `grupo_desativado` nem a alcança);
- a renovação manual (o clique do cliente) passa porque vai com
  `renewal: true`;
- a credencial continua valendo (`confirm-payment` não filtra por status do
  grupo — só lê nome, preço e serviço);
- a entrada pendente de um grupo desativado continua sendo estornada pelo
  `check-entrance-deadline` (ele trabalha em `group_members`, sem olhar o
  status do grupo).

O **efeito real** é um só: ninguém mais entra nem compra naquele grupo — que
é exatamente o que o dono pediu.

Para o dono não ficar no escuro, a sincronização agora conta quanta gente
viva o grupo tinha **na hora em que o desativou** e escreve isso no evento do
painel (`platform_events`, aba "Eventos" do admin):

```
Status dos grupos sincronizado com a Pulse
Sincronização de 5 em 5 horas: 1 desativado(s). Atenção — desativado com
gente pagante: Antigravity 1B (2 assinatura(s) ativa(s), 1 membro(s)).
Essas assinaturas continuam renovando.
```

O relatório da função (`desativados_com_gente`) também traz a lista, e o
botão "Sincronizar status" mostra o mesmo número no toast.
