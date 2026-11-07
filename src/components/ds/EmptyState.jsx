import { cn } from '@/lib/utils'

/**
 * Estado vazio: quando nao ha nada para listar.
 *
 * Cobre o caso mais comum do painel (lista sem registros) sem que cada
 * tela precise inventar um icone e um texto.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 px-6 py-14 text-center',
        className,
      )}
    >
      {Icon ? (
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-6" aria-hidden="true" />
        </span>
      ) : null}

      <h3 className="mt-4 text-base font-bold text-foreground">{title}</h3>

      {description ? (
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}

      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export default EmptyState
