import { cn } from '@/lib/utils'

/**
 * Cabecalho de pagina: titulo, descricao e area de acoes.
 *
 * Substitui o bloco `<h1>` + paragrafo + botoes que se repete em quase
 * todas as telas do painel. A tipografia usa as classes semanticas do
 * design system, entao acompanha o tema claro/escuro sem CSS extra.
 */
export function PageHeader({ title, description, icon, actions, className }) {
  return (
    <header
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>

      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  )
}

export default PageHeader
