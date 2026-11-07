import { useState } from 'react';
import {
  Eye,
  EyeOff,
  Loader2,
  CircleCheck,
  CircleX,
  PlugZap,
  Info,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

/**
 * Credenciais da WOOVI — um AppID por ambiente.
 *
 * POR QUE DOIS CAMPOS
 * -------------------
 * A Woovi tem DUAS contas: a de teste (api.woovi-sandbox.com) e a real
 * (api.woovi.com). Cada uma tem o seu AppID, e o AppID de uma NÃO vale na
 * outra — a API responde 401 "appID inválido" sem explicar o motivo.
 *
 * Antes o projeto guardava UM AppID e trocava só a URL: com o ambiente em
 * "produção", a API real recebia o AppID do sandbox e recusava tudo. Aqui
 * cada ambiente tem o seu campo, e a etiqueta "EM USO" mostra exatamente
 * qual deles a operação está usando agora.
 *
 * TESTAR CONEXÃO
 * --------------
 * O botão chama a edge function `woovi-teste-conexao`, que faz uma leitura
 * simples (`GET /api/v1/customer`) na URL do ambiente escolhido. Testa o
 * que está NO CAMPO, mesmo sem salvar — assim o admin descobre o AppID
 * errado antes de gravar.
 *
 * O AppID nunca volta na resposta: a função devolve só o status.
 */

const AMBIENTES = [
  {
    id: 'sandbox',
    rotulo: 'Sandbox',
    url: 'api.woovi-sandbox.com',
    descricao: 'Conta de TESTE da Woovi. Nenhum dinheiro real.',
    ajuda: 'Woovi (conta sandbox) → API/Plugins → Nova API/Plugin.',
  },
  {
    id: 'production',
    rotulo: 'Produção',
    url: 'api.woovi.com',
    descricao: 'Conta REAL da Woovi. Dinheiro de verdade.',
    ajuda: 'Woovi (conta de produção) → API/Plugins → Nova API/Plugin.',
  },
];

export default function SettingsWoovi({
  valores = {},
  onChange,
  ambienteAtual = 'sandbox',
}) {
  const [visiveis, setVisiveis] = useState({});
  const [testando, setTestando] = useState(null);
  const [resultado, setResultado] = useState({});

  const alternarVisao = (id) => {
    setVisiveis((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const testar = async (id) => {
    const valor = (valores[id] || '').trim();
    setTestando(id);
    setResultado((prev) => ({ ...prev, [id]: null }));

    try {
      const resposta = await supabase.functions.invoke('woovi-teste-conexao', {
        body: { app_id: valor, ambiente: id },
      });

      if (resposta?.error) {
        throw new Error(resposta.error.message || 'Falha ao chamar o servidor.');
      }

      const dados = resposta?.data || {};
      setResultado((prev) => ({
        ...prev,
        [id]: {
          ok: dados.ok === true,
          mensagem:
            dados.ok === true
              ? dados.message || 'Credencial aceita.'
              : dados.error || 'A Woovi recusou a credencial.',
          detalhe: dados.api_message || null,
          status: dados.status ?? null,
        },
      }));
    } catch (e) {
      setResultado((prev) => ({
        ...prev,
        [id]: {
          ok: false,
          mensagem: e?.message || 'Não foi possível testar a conexão.',
          detalhe: null,
          status: null,
        },
      }));
    } finally {
      setTestando(null);
    }
  };

  return (
    <div className="woovi-creds">
      <div className="settings-info-block">
        <Info size={16} />
        <p>
          A Woovi tem <strong>duas contas</strong>: a de teste e a real. Cada uma
          tem o seu <strong>AppID</strong> — e o AppID de uma é recusado pela
          outra com <code>401 appID inválido</code>. Por isso os campos são
          separados, e cada conta tem a sua URL.
        </p>
      </div>

      <div className="woovi-creds-grid">
        {AMBIENTES.map((amb) => {
          const emUso = ambienteAtual === amb.id;
          const valor = valores[amb.id] || '';
          const res = resultado[amb.id];
          const carregando = testando === amb.id;

          return (
            <div
              key={amb.id}
              className={`woovi-cred-card ${emUso ? 'em-uso' : ''}`}
            >
              <div className="woovi-cred-head">
                <div className="woovi-cred-title">
                  <strong>{amb.rotulo}</strong>
                  <code>{amb.url}</code>
                </div>
                {emUso && (
                  <span className="woovi-cred-badge">
                    <PlugZap size={12} /> em uso agora
                  </span>
                )}
              </div>

              <p className="woovi-cred-desc">{amb.descricao}</p>

              <div className="woovi-cred-field">
                <input
                  type={visiveis[amb.id] ? 'text' : 'password'}
                  value={valor}
                  onChange={(e) => onChange(amb.id, e.target.value)}
                  placeholder="Client_Id_..."
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={`AppID da Woovi (${amb.rotulo})`}
                />
                <button
                  type="button"
                  className="woovi-cred-eye"
                  onClick={() => alternarVisao(amb.id)}
                  aria-label={visiveis[amb.id] ? 'Ocultar AppID' : 'Mostrar AppID'}
                  title={visiveis[amb.id] ? 'Ocultar' : 'Mostrar'}
                >
                  {visiveis[amb.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <button
                  type="button"
                  className="btn btn-outline woovi-cred-test"
                  onClick={() => testar(amb.id)}
                  disabled={carregando}
                >
                  {carregando ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <PlugZap size={14} />
                  )}
                  Testar
                </button>
              </div>

              <small className="field-hint">Pegue em: {amb.ajuda}</small>

              {res && (
                <div className={`woovi-cred-result ${res.ok ? 'ok' : 'erro'}`}>
                  {res.ok ? <CircleCheck size={15} /> : <CircleX size={15} />}
                  <div>
                    <strong>{res.mensagem}</strong>
                    {res.detalhe && <em>Woovi respondeu: “{res.detalhe}”</em>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="woovi-creds-foot">
        O AppID vai <strong>cru</strong> no header <code>Authorization</code> — sem
        o prefixo <code>Bearer</code>. Ele é a credencial que dá acesso total à
        conta Woovi: nunca sai do painel nem entra no repositório.
      </p>
    </div>
  );
}
