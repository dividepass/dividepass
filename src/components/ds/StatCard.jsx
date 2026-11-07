import { cn } from '@/lib/utils'

/**
 * Card de indicador (KPI).
 *
 * `tone` escolhe a cor de destaque — as mesmas familias que ja existem na
 * marca (primary, action, tech, economy, success, warning). O valor usa a
 * tipografia tabular para nao "pular" quando o numero muda.
 */
const TONES = {
  primary: 'bg-primary/10 text-primary',
  action: 'bg-action/10 text-action',
  tech: 'bg-tech/10 text-tech',
  economy: 'bg-economy/10 text-economy',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-destructive/10 text-destructive',
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'primary',
  trend,
  className,
}) {
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-xl border border-border bg-card p-5',
        'transition-shadow duration-200 hover:shadow-md',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-foreground tabular-nums">
            {value}
          </p>
        </div>

        {Icon ? (
          <span
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105',
              TONES[tone] || TONES.primary,
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
          </span>
        ) : null}
      </div>

      {hint || trend ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          {trend}
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export default StatCard
