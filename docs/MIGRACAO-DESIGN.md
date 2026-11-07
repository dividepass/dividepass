# Modernização do design — Tailwind v4 + shadcn/ui + Radix + Motion

> Status: **fundação pronta**. A camada nova convive com o CSS legado; as telas
> migram uma a uma, sem big bang. Este documento é o contrato da migração.

---

## 1. O que já está pronto

| Peça | Onde | Estado |
|---|---|---|
| Tailwind v4 (plugin Vite, sem preflight) | `vite.config.js`, `src/styles/shadcn.css` | pronto |
| Alias `@` | `vite.config.js`, `jsconfig.json`, `components.json` | pronto |
| Tema shadcn espelhando os tokens da marca | `src/styles/shadcn.css` | pronto |
| Helper `cn()` | `src/lib/utils.js` | pronto |
| 27 componentes shadcn/ui (Radix por baixo) | `src/components/ui/` | pronto |
| Componentes compostos do DividePass | `src/components/ds/` | pronto |
| Vocabulário de animação | `src/lib/motion.js` | pronto |
| Providers (Tooltip/Toaster) | `src/App.jsx` | pronto |
| Shell do usuário migrado | `src/pages/user/UserLayout.jsx` | pronto |
| Rodapé migrado | `src/components/SiteFooter.jsx` | pronto |
| **~50 telas restantes** | `src/pages/**` | **pendente** |

Componentes do shadcn instalados: `accordion`, `alert`, `alert-dialog`, `avatar`,
`badge`, `button`, `card`, `checkbox`, `collapsible`, `dialog`, `dropdown-menu`,
`input`, `label`, `popover`, `progress`, `radio-group`, `scroll-area`, `select`,
`separator`, `sheet`, `skeleton`, `sonner`, `switch`, `table`, `tabs`, `textarea`,
`tooltip`.

Componentes compostos (`src/components/ds/`): `PageHeader`, `StatCard`,
`SectionTitle`, `EmptyState`, `StatusBadge`, `ConfirmDialog`.

---

## 2. As 6 regras que evitam regressão

### R1 — Nunca importar o preflight do Tailwind

O projeto tem ~95 arquivos de CSS legado. O preflight zera `font-size` dos
títulos, `margin` de tudo e muda o `box-sizing` — o app inteiro quebra.
O `src/styles/shadcn.css` importa **só** `theme.css` e `utilities.css`.

```css
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css";   /* SEM layer(utilities) */
```

> Sem `layer(utilities)`: estilo sem camada vence estilo em camada, e o CSS
> legado do app não está em camada. Importado por último, o Tailwind vence no
> empate de especificidade.

### R2 — O reset de borda é `border: 0 solid`, nunca só `border-style`

O `border-width` inicial do navegador é `medium` (**3px**). Se você escrever
apenas `border-style: solid`, essa largura padrão aparece em **todo** elemento
do app (foi exatamente o que aconteceu na primeira implementação — bordas de 3px
em tudo). Use o reset completo:

```css
@layer base {
  *, ::after, ::before, ::backdrop, ::file-selector-button {
    border: 0 solid;
  }
}
```

### R3 — Os tokens vivem em `src/styles/shadcn.css`

O bloco `@theme inline` traduz o namespace semântico do shadcn para os tokens
da marca:

| Classe shadcn | Token da marca |
|---|---|
| `bg-primary` / `text-primary` | `--primary` (índigo `#4F46E5`) |
| `bg-action` | `--action` (laranja `#EA580C`) — o CTA da marca |
| `bg-background` | `--background` |
| `bg-card` | `--surface` |
| `text-foreground` | `--text-main` |
| `text-muted-foreground` | `--text-muted` |
| `border-border` | `--border` |
| `bg-destructive` | `--error` |
| `bg-success` / `bg-warning` / `bg-tech` / `bg-economy` | idem |

Extras disponíveis: `bg-action`, `bg-success`, `bg-warning`, `bg-tech`,
`bg-economy`, `border-border-strong`.

**Não crie tokens novos em outro lugar.** Se precisar de um novo, acrescente ao
bloco da marca em `src/styles/shadcn.css` e mapeie no `@theme inline`.

### R4 — O tema é `data-theme`, não `.dark`

O app alterna tema por atributo (`data-theme="dark|light"` no `<html>`), não
por classe. Por isso existe a variante customizada:

```css
@custom-variant dark (&:is([data-theme="dark"] *));
```

Sem essa linha, os `dark:` dos componentes shadcn nunca casam.

Para consumir o tema no React, use o hook (não estado local):

```jsx
import { useAppTheme } from '@/hooks/useAppTheme'
const { theme, setTheme, toggleTheme } = useAppTheme()
```

### R5 — A ordem dos imports de CSS é sacred

`src/main.jsx` importa `index.css` (legado) primeiro e `styles/shadcn.css`
**por último**. Se as utilities entrarem antes do CSS legado, o legado vence.

### R6 — Cuidado com colisão de nome

Se o CSS legado define `.p-4 { padding: 8px }` (seletor **puro**) e algum JSX
usa `className="p-4"`, a utility do Tailwind vence e o padding muda — sem erro
de build. Rode o verificador depois de mexer no CSS:

```bash
node "<skill>/scripts/verificar-instalacao.mjs" "C:\Users\GABRIEL\Documents\DividePass"
```

Hoje: **zero colisões** entre as 95 folhas legadas e as utilities.

---

## 3. Receita para migrar uma tela

1. **Abra a tela e liste o que ela tem**: cabeçalho, cards de KPI, tabela,
   formulário, modais, estados vazios, toasts.
2. **Troque o cabeçalho** por `<PageHeader>` (título, descrição, ações).
3. **Cards de indicador** → `<StatCard label value icon tone />`.
4. **Título de seção** → `<SectionTitle>`.
5. **Lista vazia** → `<EmptyState>`.
6. **Status** → `<StatusBadge status="ativo" />` (a cor sai do rótulo).
7. **Confirmação de exclusão** → `<ConfirmDialog>` (Radix, com foco e `Escape`).
8. **Modal/sidebar** → `Dialog` / `Sheet` do shadcn (Radix).
9. **Menu** → `DropdownMenu`; **abas** → `Tabs`; **seleção** → `Select`;
   **alternador** → `Switch`; **dica** → `Tooltip`.
10. **Animação**: use `src/lib/motion.js` (`fadeUp`, `scaleIn`, `listItem`,
    `staggerContainer`) — não escreva keyframes novos.
11. **Apague o import do CSS legado** da tela quando ela estiver 100% Tailwind.
12. **Rode o build** e confira o console no browser.

### Exemplo mínimo

```jsx
import { PageHeader } from '@/components/ds/PageHeader'
import { StatCard } from '@/components/ds/StatCard'
import { Button } from '@/components/ui/button'
import { Users } from 'lucide-react'

export default function MinhaTela() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Minha tela"
        description="Resumo do que importa aqui."
        actions={<Button>Nova acao</Button>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Assinaturas" value={42} icon={Users} tone="primary" />
      </div>
    </div>
  )
}
```

---

## 4. Animação (Motion / Framer Motion)

- Biblioteca: pacote `motion`, import de `motion/react`.
- Vocabulário em `src/lib/motion.js`: `fade`, `fadeUp`, `scaleIn`, `listItem`,
  `staggerContainer()`, `page`, `pop`.
- Troca de rota: o `UserLayout` já anima o `<Outlet />` com `AnimatePresence`.
  Em outras rotas, use o mesmo padrão:

```jsx
<AnimatePresence mode="wait" initial={false}>
  <motion.div key={location.pathname} {...page}>...</motion.div>
</AnimatePresence>
```

- `useReducedMotion()` desliga a animação para quem pediu no sistema.
- **Não anime `height`/`width` em CSS legado** — use `layout` do Motion.

---

## 5. Detalhe sempre é página com URL

Regra do produto: **nunca usar drawer/modal para o detalhe de um item**.
Clique na lista → rota real com o id (`/app/campanhas/:id/detalhes`), botão
"Voltar" e página que rola. O `Sheet` serve para menu/navegação, não para
detalhe.

---

## 6. Pendências conhecidas

| Item | Situação | Como resolver |
|---|---|---|
| `src/components/SiteFooter.css` e `src/pages/user/UserLayout.css` | ficaram órfãos (nenhum import) — sem efeito no bundle | apagar no próximo commit (a lixeira do runtime recusou a remoção automática) |
| Bundle JS | 1,89 MB → 2,19 MB (gzip 485 → 584 KB) por conta do Radix + Motion, com `codeSplitting: false` | avaliar `build.rolldownOptions.output.codeSplitting` no `vite.config.js`; hoje o app inteiro sai num chunk só |
| ~50 telas em `src/pages/**` | ainda no CSS legado | migrar conforme a receita da seção 3, uma por vez |
| `src/pages/admin/**` | idem — o `AdminLayout` ainda usa o CSS antigo | migrar junto com as telas do admin |
| `next-themes` | dependência órfã do CLI (o `sonner` agora usa `useAppTheme`) | pode ser removida do `package.json` |
| `cn` (pacote npm) | dependência órfã do CLI (todos os imports foram apontados para `@/lib/utils`) | pode ser removida do `package.json` |

---

## 7. Comandos úteis

```bash
npm run dev                 # sobe em http://127.0.0.1:5173
npm run build               # build de produção (precisa passar)
npx shadcn@latest add <componentes> --yes    # instalar mais componente do shadcn
node .tmp-verify/qa-shell-moderno.mjs        # QA do shell (conta QA, sem escrita no banco)
```
