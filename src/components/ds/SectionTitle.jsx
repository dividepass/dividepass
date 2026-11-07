import { cn } from '@/lib/utils'

/**
 * Titulo de secao dentro de uma tela.
 *
 * Mantem a hierarquia visual do painel: titulo em negrito, descricao curta
 * e uma acao opcional a direita (botao, link, filtro).
 */
export function SectionTitle({ title, description, action, className }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-lg font-bold tracking-tight text-foreground">
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>

      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  )
}

export default SectionTitle
