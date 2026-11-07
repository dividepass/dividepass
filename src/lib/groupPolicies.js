/**
 * POLÍTICAS DE USO E RESPONSABILIDADE
 *
 * Texto exibido na etapa final do wizard de criação de grupo (usuário e
 * admin). Fica fora do componente para o mesmo texto ser usado em qualquer
 * tela sem duplicar a redação.
 */
export const GROUP_POLICIES = [
  {
    title: 'A DividePass é somente uma facilitadora de acesso.',
    text:
      'A DividePass intermedeia a contratação de grupos e o acesso ao conteúdo compartilhado de serviços de terceiros. '
      + 'Ela não tem nenhuma responsabilidade sobre quaisquer tipos de situações relacionadas à conta e às credenciais '
      + 'do serviço — bloqueios, cancelamentos, alteração de senha, violações de termos de uso, multas ou qualquer '
      + 'outra ocorrência junto ao provedor.',
  },
  {
    title: 'O criador do grupo assume total responsabilidade pelas credenciais.',
    text:
      'Ao criar o grupo, o responsável assume total responsabilidade por estar compartilhando as próprias credenciais '
      + 'com os membros do grupo, por manter essas credenciais válidas e por responder por qualquer '
      + 'reclamação ou cobrança relacionada ao uso da conta compartilhada.',
  },
  {
    title: 'O conteúdo e o repasse são de responsabilidade do criador do grupo.',
    text:
      'A DividePass não é parte da relação entre o criador e os membros: entrega do serviço, suporte, reembolso e '
      + 'repasse do valor ficam a cargo do criador do grupo.',
  },
];

export default GROUP_POLICIES;
