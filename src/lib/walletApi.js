import { supabase } from './supabase';

/**
 * Camada de chamada das RPCs de carteira.
 *
 * O banco novo (database/fix-wallet-repasse.sql) traz `request_withdrawal` e
 * `process_withdrawal`, que fazem o repasse de forma atomica: o saldo fica
 * reservado no pedido e o admin so confirma ou devolve.
 *
 * Enquanto o script nao for rodado no Supabase, essas RPCs nao existem. A
 * camada detecta isso (PGRST202) e cai no caminho antigo de INSERT direto,
 * que usa SO as colunas que ja existem em producao (pix_key/bank_* nunca
 * existiram na tabela e quebravam o pedido com PGRST204).
 */

const rpcDisponivel = {};

function rpcNaoExiste(error) {
  if (!error) return false;
  const msg = String(error.message || '');
  return error.code === 'PGRST202' || /could not find the function|função não encontrada/i.test(msg);
}

async function chamarRpc(nome, args) {
  if (rpcDisponivel[nome] === false) return { semRpc: true };

  const { data, error } = await supabase.rpc(nome, args);
  if (error) {
    if (rpcNaoExiste(error)) {
      rpcDisponivel[nome] = false;
      return { semRpc: true };
    }
    return { error };
  }
  return { data };
}

/** Detecta (uma vez) se a RPC existe no banco. */
export async function temRpc(nome) {
  if (rpcDisponivel[nome] === false) return false;
  if (rpcDisponivel[nome] === true) return true;

  // Uma chamada com dados invalidos: se a RPC existir, o erro e de negocio
  // (nao de "funcao inexistente"); se nao existir, vem PGRST202.
  const { error } = await supabase.rpc(nome, {
    p_withdrawal_id: '00000000-0000-0000-0000-000000000000',
    p_action: 'probe',
  });

  if (!error) {
    rpcDisponivel[nome] = true;
    return true;
  }
  if (rpcNaoExiste(error)) {
    rpcDisponivel[nome] = false;
    return false;
  }
  rpcDisponivel[nome] = true;
  return true;
}

const detalhesPagamento = (dados) =>
  JSON.stringify({
    pix_key: dados.pixKey || null,
    pix_type: dados.pixType || null,
    bank_name: dados.bankName || null,
    bank_agency: dados.bankAgency || null,
    bank_account: dados.bankAccount || null,
    bank_holder: dados.bankHolder || null,
  });

/**
 * Pede saque. Com a RPC ativa o saldo e reservado no banco; sem ela, o
 * pedido e gravado direto (sem reservar) e o admin debita na hora de pagar.
 */
export async function solicitarSaque(dados) {
  const rpc = await chamarRpc('request_withdrawal', {
    p_amount: Number(dados.amount),
    p_payment_method: dados.paymentMethod || 'pix',
    p_pix_key: dados.pixKey || null,
    p_pix_type: dados.pixType || null,
    p_bank_name: dados.bankName || null,
    p_bank_agency: dados.bankAgency || null,
    p_bank_account: dados.bankAccount || null,
    p_bank_holder: dados.bankHolder || null,
    p_notes: dados.notes || null,
  });

  if (rpc.data) return { ok: true, id: rpc.data };
  if (!rpc.semRpc) return { ok: false, error: rpc.error?.message || 'Falha ao solicitar o saque' };

  // Fallback: banco sem a migration. Usa apenas colunas que existem hoje.
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) return { ok: false, error: 'Sessão expirada. Entre novamente.' };

  const { data, error } = await supabase
    .from('wallet_withdrawals')
    .insert({
      user_id: user.user.id,
      amount: Number(dados.amount),
      status: 'pending',
      payment_method: dados.paymentMethod || 'pix',
      payment_details: detalhesPagamento(dados),
      notes: dados.notes || null,
      requested_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id };
}

/**
 * Admin paga (paid) ou rejeita (rejected) um saque.
 * `reservado` indica se o saldo ja foi retido no pedido (fluxo com RPC).
 */
export async function processarSaque({ withdrawalId, action, notes, reservado, amount, userId }) {
  const rpc = await chamarRpc('process_withdrawal', {
    p_withdrawal_id: withdrawalId,
    p_action: action,
    p_notes: notes || null,
  });

  if (rpc.semRpc) {
    // Banco sem a migration: atualiza o pedido na mao.
    const novoStatus = action === 'paid' ? 'completed' : 'rejected';
    const { error } = await supabase
      .from('wallet_withdrawals')
      .update({ status: novoStatus, processed_at: new Date().toISOString(), notes: notes || null })
      .eq('id', withdrawalId);
    if (error) return { ok: false, error: error.message };
  } else if (rpc.error) {
    return { ok: false, error: rpc.error.message || 'Falha ao processar o saque' };
  }

  // Sem reserva (pedido antigo ou fallback), o saldo ainda esta inteiro:
  // o pagamento do saque precisa debitar a carteira.
  if (action === 'paid' && !reservado) {
    const { error } = await supabase.rpc('credit_wallet', {
      p_user_id: userId,
      p_amount: -Math.abs(Number(amount)),
      p_description: 'Saque processado',
      p_reference_type: 'withdrawal',
      p_reference_id: withdrawalId,
    });
    if (error) return { ok: false, error: `Saque marcado, mas o saldo nao foi debitado: ${error.message}` };
  }

  if (action === 'rejected' && !reservado) {
    // Sem reserva nao houve debito: nada a devolver.
  }

  return { ok: true };
}
