import {
  LayoutGrid,
  Tv,
  Music,
  Bot,
  GraduationCap,
  Briefcase,
  Wrench,
  BookOpen,
  Gamepad2,
  Dumbbell,
  ShieldCheck,
} from 'lucide-react';

/**
 * CATEGORIAS DO CATÁLOGO — fonte única de verdade.
 *
 * Antes cada tela tinha a sua lista: o catálogo usava emoji (📺🎵🤖) e o
 * dashboard usava outro texto. Isso fazia o mesmo tema aparecer com dois
 * desenhos diferentes — e o emoji era pequeno e sem personalidade.
 *
 * Aqui cada categoria tem:
 *   - `label`: nome curto que cabe embaixo do ícone;
 *   - `Icon`: ícone de verdade (lucide), desenhado para ficar legível
 *     dentro do círculo colorido.
 *
 * Os `key` são exatamente o valor de `streaming_services.category` no
 * banco — é o que a query do catálogo filtra.
 */
export const CATEGORIAS = [
  { key: 'all', label: 'Todos', Icon: LayoutGrid },
  { key: 'streaming', label: 'Streaming', Icon: Tv },
  { key: 'musica', label: 'Música', Icon: Music },
  { key: 'ia', label: 'IA', Icon: Bot },
  { key: 'cursos', label: 'Cursos', Icon: GraduationCap },
  { key: 'produtividade', label: 'Produtividade', Icon: Briefcase },
  { key: 'ferramentas', label: 'Ferramentas', Icon: Wrench },
  { key: 'leitura', label: 'Leitura', Icon: BookOpen },
  { key: 'games', label: 'Games', Icon: Gamepad2 },
  { key: 'saude', label: 'Saúde', Icon: Dumbbell },
  { key: 'seguranca', label: 'Segurança', Icon: ShieldCheck },
];

/** As categorias sem o "Todos" — é o que aparece na vitrine da home. */
export const CATEGORIAS_SEM_TODOS = CATEGORIAS.filter((c) => c.key !== 'all');

/** Nome curto de uma categoria (ou o próprio texto, se não souber). */
export function labelCategoria(key) {
  return CATEGORIAS.find((c) => c.key === key)?.label || key || 'Outros';
}

/**
 * Ícone de uma categoria.
 *
 * Devolve o componente pronto para desenhar. Quando a categoria não existe
 * (serviço novo no banco, por exemplo), devolve `null` e a tela segue sem
 * ícone em vez de quebrar.
 */
export function IconeCategoria({ category }) {
  return CATEGORIAS.find((c) => c.key === category)?.Icon || null;
}
