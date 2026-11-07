import { cn } from '@/lib/utils'

/**
 * Etiqueta de status.
 *
 * As tabelas do painel (assinaturas, grupos, cobrancas, pedidos) repetem os
 * mesmos status com as mesmas cores. `statusTone` traduz o rotulo para a
 * familia de cor, entao a tela nao precisa montar a classe na mao.
 */
const TONES = {
  neutral: 'border-border bg-muted text-muted-foreground',
  success: 'border-success/30 bg-success/12 text-success',
  warning: 'border-warning/30 bg-warning/12 text-warning',
  danger: 'border-destructive/30 bg-destructive/12 text-destructive',
  info: 'border-tech/30 bg-tech/12 text-tech',
  primary: 'border-primary/30 bg-primary/12 text-primary',
  action: 'border-action/30 bg-action/12 text-action',
}

/** Mapa de rotulos -> familia de cor. */
const STATUS_MAP = {
  ativo: 'success',
  ativa: 'success',
  ativo_': 'success',
  aprovado: 'success',
  aprovada: 'success',
  pago: 'success',
  paga: 'success',
  confirmado: 'success',
  confirmada: 'success',
  concluido: 'success',
  concluida: 'success',
  entregue: 'success',
  pendente: 'warning',
  aguardando: 'warning',
  processando: 'warning',
  em_analise: 'warning',
  analysis: 'warning',
  atrasado: 'danger',
  atrasada: 'danger',
  vencido: 'danger',
  vencida: 'danger',
  cancelado: 'danger',
  cancelada: 'danger',
  falhou: 'danger',
  falha: 'danger',
  erro: 'danger',
  inativo: 'neutral',
  inativa: 'neutral',
  expirado: 'neutral',
  expirada: 'neutral',
  arquivado: 'neutral',
}

/**
 * Descobre a familia de cor a partir do rotulo do status.
 * Aceita texto com acentos, caixa varied e separadores (`-`, `_`, ` `).
 */
export function statusTone(status) {
  if (!status) return 'neutral'
  const key = String(status)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_')

  if (STATUS_MAP[key]) return STATUS_MAP[key]
  if (STATUS_MAP[key.replace(/_/g, '')]) return STATUS_MAP[key.replace(/_/g, '')]
  return 'neutral'
}

export function StatusBadge({ status, tone, className, children }) {
  const resolved = tone || statusTone(status)
  const label = children ?? status

  if (!label) return null

  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium capitalize',
        TONES[resolved] || TONES.neutral,
        className,
      )}
    >
      {label}
    </span>
  )
}

export default StatusBadge
