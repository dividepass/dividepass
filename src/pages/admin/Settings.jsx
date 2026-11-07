import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import {
  Settings as SettingsIcon,
  Save,
  Loader2,
  Info,
  AlertTriangle,
  CreditCard,
  Zap,
  Shield,
  Globe,
  Mail,
  MessageCircle,
  ExternalLink,
  Eye,
  EyeOff,
  CircleCheck,
  CircleAlert,
  Percent,
  Ticket,
  Sparkles,
  KeyRound,
  ArrowRight,
} from 'lucide-react';
import {
  WHATSAPP_VIP_SETTING_KEY,
  normalizeWhatsappVipUrl,
  extractWhatsappInviteCode,
} from '../../lib/siteLinks';
import {
  AMBIENTE_KEY,
  normalizarAmbiente,
  ambienteLabel,
  ambienteAviso,
} from '../../lib/ambiente';
import SettingsWoovi from './SettingsWoovi';
import './Settings.css';

const DEFAULTS = {
  gateway_fee_percent: '4.98',
  platform_fee_percent: '3.95',
  default_entrance_fee: '15.00',
  active_gateway: 'mercadopago',
};

const GATEWAYS = [
  {
    id: 'mercadopago',
    name: 'Mercado Pago',
    description: 'Gateway principal. Checkout Pro, PIX, cartão, boleto.',
    icon: <CreditCard size={24} />,
    color: '#009ee3',
    envKeys: ['mercadopago_public_key', 'mercadopago_access_token', 'mercadopago_client_id', 'mercadopago_client_secret'],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Gateway global. Cartão, PIX, Checkout Session.',
    icon: <Globe size={24} />,
    color: '#635bff',
    envKeys: ['stripe_secret_key', 'stripe_webhook_secret'],
  },
  {
    id: 'asaas',
    name: 'Asaas',
    description: 'Gateway brasileiro. PIX, boleto, cartão, recorrência.',
    icon: <Zap size={24} />,
    color: '#00c853',
    envKeys: ['asaas_api_key', 'asaas_env'],
  },
  {
    id: 'iopay',
    name: 'IOPay',
    description: 'Gateway brasileiro. PIX, boleto, cartão.',
    icon: <Shield size={24} />,
    color: '#ff6d00',
    envKeys: ['iopay_secret', 'iopay_email', 'iopay_seller_id', 'iopay_env'],
  },
  {
    id: 'pagarme',
    name: 'Pagar.me',
    description: 'Gateway brasileiro. PIX, cartão, boleto, recorrência.',
    icon: <CreditCard size={24} />,
    color: '#e91e63',
    envKeys: ['pagarme_secret_key', 'pagarme_public_key'],
  },
  {
    id: 'woovi',
    name: 'Woovi',
    description: 'Gateway brasileiro. PIX com Pagamento Automático (recorrência real).',
    icon: <Zap size={24} />,
    color: '#0ea5a4',
    envKeys: ['woovi_app_id_sandbox', 'woovi_app_id_production', 'woovi_retry_policy', 'woovi_day_due'],
  },
];

/** Chave legada: guardava o AppID do sandbox. Continua em sincronia. */
const WOOVI_APP_ID_LEGADO = 'woovi_app_id';
const WOOVI_APP_ID_SANDBOX = 'woovi_app_id_sandbox';
const WOOVI_APP_ID_PRODUCTION = 'woovi_app_id_production';

/**
 * Seções da página — a mesma lista vira o menu lateral e as âncoras.
 */
const SECOES = [
  { id: 'ambiente', label: 'Ambiente', icon: Globe },
  { id: 'gateway', label: 'Gateway', icon: CreditCard },
  { id: 'split', label: 'Por método', icon: Zap },
  { id: 'credenciais', label: 'Credenciais', icon: KeyRound },
  { id: 'taxas', label: 'Taxas', icon: Percent },
  { id: 'adesao', label: 'Taxa de adesão', icon: Ticket },
  { id: 'comunicacao', label: 'Grupo VIP', icon: MessageCircle },
  { id: 'email', label: 'E-mail (SMTP)', icon: Mail },
  { id: 'ia', label: 'IA (Groq)', icon: Sparkles },
];

function Settings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const [gatewayFee, setGatewayFee] = useState('');
  const [platformFee, setPlatformFee] = useState('');
  const [entranceFee, setEntranceFee] = useState('');
  const [activeGateway, setActiveGateway] = useState('mercadopago');
  const [ambiente, setAmbiente] = useState('production');
  const [gatewayConfigs, setGatewayConfigs] = useState({});
  const [smtpConfigs, setSmtpConfigs] = useState({});
  const [groqApiKey, setGroqApiKey] = useState('');
  const [whatsappVipUrl, setWhatsappVipUrl] = useState('');

  // Gateway cujas credenciais estão sendo editadas.
  //
  // É SEPARADO do gateway ativo de propósito: configurar a Woovi não pode
  // ativar a Woovi. Sem esta separação o campo do AppID da Woovi só aparecia
  // depois de escolher a Woovi como gateway ativo — e salvar assim gravaria
  // `active_gateway = 'woovi'`, publicando a ativação sem querer.
  const [credGatewayId, setCredGatewayId] = useState(null);

  // ── DIVISÃO POR MÉTODO DE PAGAMENTO ───────────────────────────────────
  // Off por padrão: com a divisão desligada, o checkout usa UM gateway
  // (o `active_gateway`) para tudo — exatamente como o site se comporta
  // hoje. Ligando, o PIX e o cartão passam a poder seguir para gateways
  // diferentes (ex.: PIX na Woovi, cartão na IO Pay).
  const [splitAtivo, setSplitAtivo] = useState(false);
  const [splitGatewayPix, setSplitGatewayPix] = useState('iopay');
  const [splitGatewayCard, setSplitGatewayCard] = useState('iopay');
  // ONDE a divisão vale: 'v2' (só no checkout de teste — o padrão) ou
  // 'all' (em todos os checkouts, inclusive no de produção).
  const [splitEscopo, setSplitEscopo] = useState('v2');

  // UX: seção visível na rolagem + campos de senha reveláveis.
  const [secaoAtiva, setSecaoAtiva] = useState('ambiente');
  const [senhasVisiveis, setSenhasVisiveis] = useState({});

  useEffect(() => {
    async function fetchSettings() {
      setLoading(true);
      const { data, error: err } = await supabase
        .from('app_settings')
        .select('key, value');

      if (err) {
        setError('Erro ao carregar configurações.');
        setLoading(false);
        return;
      }

      const map = {};
      (data || []).forEach((row) => {
        map[row.key] = row.value;
      });

      setGatewayFee(map.gateway_fee_percent ?? DEFAULTS.gateway_fee_percent);
      setPlatformFee(map.platform_fee_percent ?? DEFAULTS.platform_fee_percent);
      setEntranceFee(map.default_entrance_fee ?? DEFAULTS.default_entrance_fee);
      setActiveGateway(map.active_gateway ?? DEFAULTS.active_gateway);
      setAmbiente(normalizarAmbiente(map[AMBIENTE_KEY]));

      // Divisão por método (desligada por padrão).
      setSplitAtivo(String(map.split_gateway_enabled ?? '').trim().toLowerCase() === 'true');
      setSplitGatewayPix(map.split_gateway_pix || 'iopay');
      setSplitGatewayCard(map.split_gateway_card || 'iopay');
      setSplitEscopo(map.split_gateway_scope === 'all' ? 'all' : 'v2');

      const configs = {};
      GATEWAYS.forEach((g) => {
        g.envKeys.forEach((key) => {
          configs[key] = map[key] ?? '';
        });
      });
      // O AppID do sandbox historicamente morava em `woovi_app_id`. Se a
      // chave nova ainda não existe, o valor antigo é migrado para ela.
      configs[WOOVI_APP_ID_SANDBOX] = map[WOOVI_APP_ID_SANDBOX] ?? map[WOOVI_APP_ID_LEGADO] ?? '';
      setGatewayConfigs(configs);

      const SMTP_KEYS = [
        'smtp_host', 'smtp_port',
        'smtp_user_support', 'smtp_user_noreply',
        'smtp_from_support', 'smtp_from_noreply',
      ];
      const smtpCfg = {};
      SMTP_KEYS.forEach((key) => {
        smtpCfg[key] = map[key] ?? '';
      });
      setSmtpConfigs(smtpCfg);

      setGroqApiKey(map.groq_api_key ?? '');

      setWhatsappVipUrl(map[WHATSAPP_VIP_SETTING_KEY] ?? '');

      setLoading(false);
    }

    fetchSettings();
  }, []);

  // Depois de carregar, abre as credenciais do gateway ativo — mas só uma vez:
  // se o admin já escolheu outro gateway para editar, a escolha dele vale.
  useEffect(() => {
    if (!loading && credGatewayId === null) setCredGatewayId(activeGateway);
  }, [loading, activeGateway, credGatewayId]);

  // ── UX: seção ativa conforme a rolagem ─────────────────────────────────
  //
  // ATENÇÃO: no painel admin quem rola NÃO é a window — é o
  // `.admin-content`, que tem `overflow-y: auto` e `height: 100vh`. Por isso
  // o listener vai no container de rolagem (e na window, por garantia).
  useEffect(() => {
    if (loading) return undefined;

    const aoRolar = () => {
      let atual = SECOES[0].id;
      for (const secao of SECOES) {
        const el = document.getElementById(secao.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= 180) atual = secao.id;
      }
      setSecaoAtiva(atual);
    };

    const container = acharContainerRolagem();
    container?.addEventListener('scroll', aoRolar, { passive: true });
    window.addEventListener('scroll', aoRolar, { passive: true });
    window.addEventListener('resize', aoRolar);
    aoRolar();

    return () => {
      container?.removeEventListener('scroll', aoRolar);
      window.removeEventListener('scroll', aoRolar);
      window.removeEventListener('resize', aoRolar);
    };
  }, [loading]);

  const handleGatewayConfigChange = (key, value) => {
    setGatewayConfigs((prev) => ({ ...prev, [key]: value }));
  };

  const handleSmtpConfigChange = (key, value) => {
    setSmtpConfigs((prev) => ({ ...prev, [key]: value }));
  };

  const alternarSenha = (key) => {
    setSenhasVisiveis((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const irPara = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setSecaoAtiva(id);
  };

  /**
   * Monta um retrato de todos os campos editáveis. É com ele que se calcula
   * quantas alterações estão pendentes de salvar.
   */
  const montarRetrato = useCallback(() => ({
    gatewayFee,
    platformFee,
    entranceFee,
    activeGateway,
    ambiente,
    splitAtivo: String(splitAtivo),
    splitGatewayPix,
    splitGatewayCard,
    splitEscopo,
    gatewayConfigs,
    smtpConfigs,
    groqApiKey,
    whatsappVipUrl,
  }), [
    gatewayFee, platformFee, entranceFee, activeGateway, ambiente,
    splitAtivo, splitGatewayPix, splitGatewayCard, splitEscopo,
    gatewayConfigs, smtpConfigs, groqApiKey, whatsappVipUrl,
  ]);

  const [retratoOriginal, setRetratoOriginal] = useState(null);

  // Guarda o retrato de carga: é contra ele que as pendências são contadas.
  useEffect(() => {
    if (!loading && retratoOriginal === null) {
      setRetratoOriginal(montarRetrato());
    }
  }, [loading, retratoOriginal, montarRetrato]);

  const pendentes = useMemo(() => {
    if (!retratoOriginal) return 0;
    return contarDiferencas(retratoOriginal, montarRetrato());
  }, [retratoOriginal, montarRetrato]);

  // Sai da página com alteração pendente? Avisa antes.
  useEffect(() => {
    if (pendentes === 0) return undefined;
    const aviso = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [pendentes]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const updates = [
        { key: 'gateway_fee_percent', value: gatewayFee },
        { key: 'platform_fee_percent', value: platformFee },
        { key: 'default_entrance_fee', value: entranceFee },
        { key: 'active_gateway', value: activeGateway },
        // Interruptor global: produção x sandbox.
        { key: AMBIENTE_KEY, value: normalizarAmbiente(ambiente) },
        // Divisão por método de pagamento (PIX e cartão em gateways
        // diferentes). Desligada = o site se comporta como hoje.
        { key: 'split_gateway_enabled', value: splitAtivo ? 'true' : 'false' },
        { key: 'split_gateway_pix', value: splitGatewayPix },
        { key: 'split_gateway_card', value: splitGatewayCard },
        { key: 'split_gateway_scope', value: splitEscopo },
      ];

      Object.entries(gatewayConfigs).forEach(([key, value]) => {
        updates.push({ key, value });
      });

      // A chave legada continua apontando para o AppID do sandbox: o script
      // que cadastra o webhook e a reserva do backend leem ela.
      updates.push({
        key: WOOVI_APP_ID_LEGADO,
        value: gatewayConfigs[WOOVI_APP_ID_SANDBOX] || '',
      });

      Object.entries(smtpConfigs).forEach(([key, value]) => {
        if (value) updates.push({ key, value });
      });

      if (groqApiKey) updates.push({ key: 'groq_api_key', value: groqApiKey });

      // Link do grupo VIP: aceita o link completo ou só o código do convite.
      // Vazio = o site volta a usar o link padrão (WHATSAPP_VIP_FALLBACK).
      const vipLink = normalizeWhatsappVipUrl(whatsappVipUrl);
      if (whatsappVipUrl.trim() && !vipLink) {
        throw new Error('Link do grupo WhatsApp inválido. Cole o link do convite (https://chat.whatsapp.com/...) ou apenas o código.');
      }
      updates.push({ key: WHATSAPP_VIP_SETTING_KEY, value: vipLink });

      const { error: err } = await supabase
        .from('app_settings')
        .upsert(updates, { onConflict: 'key' });

      if (err) throw err;

      setRetratoOriginal(montarRetrato());
      setSuccess('Configurações salvas com sucesso!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Erro ao salvar configurações.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fade-in">
        <div className="admin-header">
          <h1>Configurações da Plataforma</h1>
        </div>
        <div className="loading-state">
          <div className="loading-spinner" />
          <span>Carregando configurações...</span>
        </div>
      </div>
    );
  }

  const selectedGateway = GATEWAYS.find((g) => g.id === (credGatewayId || activeGateway));
  const nomeGateway = (id) => GATEWAYS.find((g) => g.id === id)?.name || id;
  const ambienteNormalizado = normalizarAmbiente(ambiente);
  const appIdDoAmbiente = ambienteNormalizado === 'sandbox'
    ? (gatewayConfigs[WOOVI_APP_ID_SANDBOX] || '').trim()
    : (gatewayConfigs[WOOVI_APP_ID_PRODUCTION] || '').trim();

  return (
    <div className="fade-in settings-page">
      {/* ── Cabeçalho + resumo do estado atual ─────────────────────────── */}
      <header className="settings-hero">
        <div className="settings-hero-text">
          <h1>
            <SettingsIcon size={22} />
            Configurações da Plataforma
          </h1>
          <p>Gateway de pagamento, credenciais, taxas e integrações.</p>
        </div>

        <div className="settings-hero-chips">
          <span className={`settings-chip ${ambienteNormalizado === 'production' ? 'chip-prod' : 'chip-sandbox'}`}>
            {ambienteNormalizado === 'production' ? 'Produção' : 'Sandbox'}
          </span>
          <span className="settings-chip">
            <CreditCard size={13} /> {nomeGateway(activeGateway)}
          </span>
          <span className={`settings-chip ${splitAtivo ? 'chip-ativo' : ''}`}>
            {splitAtivo
              ? `PIX: ${nomeGateway(splitGatewayPix)}`
              : 'Método único'}
          </span>
          {splitAtivo && (
            <span className="settings-chip">
              Cartão: {nomeGateway(splitGatewayCard)}
            </span>
          )}
          {!appIdDoAmbiente && (
            <span className="settings-chip chip-alerta">
              <CircleAlert size={13} /> Woovi sem AppID de {ambienteNormalizado === 'production' ? 'produção' : 'sandbox'}
            </span>
          )}
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      <div className="settings-layout">
        {/* ── Menu lateral ─────────────────────────────────────────────── */}
        <nav className="settings-nav" aria-label="Seções das configurações">
          {SECOES.map((secao) => {
            const Icon = secao.icon;
            return (
              <button
                key={secao.id}
                type="button"
                className={`settings-nav-item ${secaoAtiva === secao.id ? 'active' : ''}`}
                onClick={() => irPara(secao.id)}
                aria-current={secaoAtiva === secao.id ? 'true' : undefined}
              >
                <Icon size={15} />
                <span>{secao.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="settings-content">
          {/* ── Ambiente de operação (produção x sandbox) ───────────────── */}
          <section className="settings-card" id="ambiente">
            <div className="settings-section-header">
              <h2><Globe size={18} /> Ambiente de Operação</h2>
              <span className="settings-section-hint">
                Move a <strong>Woovi</strong> entre a conta de teste e a real
              </span>
            </div>

            <div className="settings-section-body">
              <p className="gateway-description">
                A Woovi tem <strong>duas contas</strong> — a de teste e a real — e
                cada uma tem o seu AppID. Este interruptor escolhe qual das duas
                está ativa. O código é o mesmo nos dois casos: o que muda é para
                onde a cobrança é enviada.
              </p>

              <div className="gateway-grid gateway-grid-2">
                {[
                  {
                    id: 'production',
                    label: 'Produção',
                    desc: 'Conta real da Woovi. Dinheiro de verdade.',
                    color: '#22c55e',
                    icon: <Shield size={24} />,
                  },
                  {
                    id: 'sandbox',
                    label: 'Sandbox',
                    desc: 'Conta de teste da Woovi. Nenhum dinheiro real.',
                    color: '#f59e0b',
                    icon: <AlertTriangle size={24} />,
                  },
                ].map((op) => (
                  <button
                    key={op.id}
                    type="button"
                    className={`gateway-card ${ambiente === op.id ? 'active' : ''}`}
                    onClick={() => setAmbiente(op.id)}
                  >
                    <div className="gateway-card-icon" style={{ color: op.color }}>
                      {op.icon}
                    </div>
                    <div className="gateway-card-info">
                      <strong>{op.label}</strong>
                      <span>{op.desc}</span>
                    </div>
                    {ambiente === op.id && (
                      <div className="gateway-card-check">
                        <div className="gateway-check-dot" style={{ background: op.color }} />
                      </div>
                    )}
                  </button>
                ))}
              </div>

              {ambienteAviso(ambiente) && (
                <div className="error-banner settings-inline-alert">
                  <AlertTriangle size={16} /> {ambienteAviso(ambiente)}
                </div>
              )}

              {!appIdDoAmbiente && (
                <div className="settings-info-block warning">
                  <AlertTriangle size={16} />
                  <p>
                    Não há AppID da Woovi para <strong>{ambienteLabel(ambiente).toLowerCase()}</strong>.
                    Sem ele, toda cobrança que for para a Woovi volta com
                    <code> appID inválido</code>. Cadastre em{' '}
                    <strong>Credenciais → Woovi</strong>.
                  </p>
                </div>
              )}

              <div className="settings-info-block">
                <Info size={16} />
                <p>
                  Este interruptor afeta <strong>apenas a Woovi</strong>. A IO Pay
                  tem o seu próprio (<code>iopay_env</code>, na aba de credenciais
                  dela) e continuaprocessando em produção como sempre.
                </p>
              </div>

              <p className="settings-footnote">
                Ambiente atual: <strong>{ambienteLabel(ambiente)}</strong>. Depois de
                salvar, leva até 5 segundos para valer em todas as edge functions.
              </p>
            </div>
          </section>

          {/* ── Gateway Selector ── */}
          <section className="settings-card" id="gateway">
            <div className="settings-section-header">
              <h2><CreditCard size={18} /> Gateway de Pagamento</h2>
              <span className="settings-section-hint">
                Qual gateway processa os pagamentos quando não há divisão por método
              </span>
            </div>

            <div className="settings-section-body">
              <div className="gateway-grid">
                {GATEWAYS.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className={`gateway-card ${activeGateway === g.id ? 'active' : ''}`}
                    onClick={() => setActiveGateway(g.id)}
                  >
                    <div className="gateway-card-icon" style={{ color: g.color }}>
                      {g.icon}
                    </div>
                    <div className="gateway-card-info">
                      <strong>{g.name}</strong>
                      <span>{g.description}</span>
                    </div>
                    {activeGateway === g.id && (
                      <div className="gateway-card-check">
                        <div className="gateway-check-dot" style={{ background: g.color }} />
                      </div>
                    )}
                  </button>
                ))}
              </div>

              <div className="settings-info-block">
                <Info size={16} />
                <p>
                  Webhook URL para o gateway ativo:{' '}
                  <code>https://lasoouwboxspstqvjbsv.supabase.co/functions/v1/{activeGateway}-webhook</code>
                </p>
              </div>
            </div>
          </section>

          {/* ── Gateway por método de pagamento ── */}
          <section className="settings-card" id="split">
            <div className="settings-section-header">
              <h2><Zap size={18} /> Gateway por método de pagamento</h2>
              <span className="settings-section-hint">
                PIX e cartão podem seguir para gateways diferentes
              </span>
            </div>

            <div className="settings-section-body">
              <div className="settings-info-block">
                <Info size={16} />
                <p>
                  Com a divisão <strong>desligada</strong> (padrão), o checkout usa um gateway
                  só — o de cima — para o PIX e para o cartão: é exatamente o comportamento de
                  hoje. Ligando, cada método pode seguir para um gateway diferente
                  (ex.: <strong>PIX na Woovi</strong> com Pix Automático e <strong>cartão na
                  IO Pay</strong>).
                </p>
              </div>

              <label className="split-toggle">
                <input
                  type="checkbox"
                  checked={splitAtivo}
                  onChange={(e) => setSplitAtivo(e.target.checked)}
                />
                <span>
                  <strong>Usar um gateway diferente por método</strong>
                  <span className="split-toggle-hint">
                    Quando desligado, o gateway ativo acima vale para o PIX e para o cartão.
                  </span>
                </span>
              </label>

              {splitAtivo && (
                <>
                  <div className="split-resumo">
                    <div>
                      <span>PIX vai para</span>
                      <strong>{nomeGateway(splitGatewayPix)}</strong>
                    </div>
                    <ArrowRight size={14} />
                    <div>
                      <span>Cartão vai para</span>
                      <strong>{nomeGateway(splitGatewayCard)}</strong>
                    </div>
                    <ArrowRight size={14} />
                    <div>
                      <span>Vale em</span>
                      <strong>{splitEscopo === 'all' ? 'Todos os checkouts' : 'Só no checkout V2'}</strong>
                    </div>
                  </div>

                  <div className="split-gateway-grid">
                    <div className="form-group">
                      <label>Gateway do PIX</label>
                      <select
                        value={splitGatewayPix}
                        onChange={(e) => setSplitGatewayPix(e.target.value)}
                      >
                        {GATEWAYS.map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Gateway do cartão de crédito</label>
                      <select
                        value={splitGatewayCard}
                        onChange={(e) => setSplitGatewayCard(e.target.value)}
                      >
                        {GATEWAYS.map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="form-group split-scope-group">
                    <label>Onde a divisão vale</label>
                    <div className="split-scope-options">
                      <label className="split-scope-option">
                        <input
                          type="radio"
                          name="split_scope"
                          checked={splitEscopo === 'v2'}
                          onChange={() => setSplitEscopo('v2')}
                        />
                        <span>
                          <strong>Só no checkout V2 (teste)</strong>
                          <span className="split-toggle-hint">
                            O checkout normal (/checkout) continua exatamente como está.
                          </span>
                        </span>
                      </label>
                      <label className="split-scope-option">
                        <input
                          type="radio"
                          name="split_scope"
                          checked={splitEscopo === 'all'}
                          onChange={() => setSplitEscopo('all')}
                        />
                        <span>
                          <strong>Em todos os checkouts</strong>
                          <span className="split-toggle-hint">
                            Vale também para o checkout de produção. Use só depois de
                            validar no V2.
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="settings-info-block warning">
                    <AlertTriangle size={16} />
                    <p>
                      A divisão vale só para cobranças <strong>novas</strong>. Uma
                      <strong> renovação</strong> continua no gateway que a assinatura já usa —
                      trocar deixaria duas cobranças vivas (a antiga e a nova).
                    </p>
                  </div>

                  <div className="settings-info-block">
                    <Info size={16} />
                    <p>
                      A <strong>Woovi</strong> só faz PIX. Se ela estiver no gateway do cartão,
                      o checkout vai esconder o botão de cartão — é o próprio gateway recusando.
                    </p>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* ── Gateway Credentials ── */}
          {selectedGateway && selectedGateway.envKeys.length > 0 && (
            <section className="settings-card" id="credenciais">
              <div className="settings-section-header">
                <h2><KeyRound size={18} /> Credenciais</h2>
                <span className="settings-section-hint">
                  Salvas no banco, usadas só pelas edge functions
                </span>
              </div>

              {/* Abas de credenciais: editar as credenciais de um gateway NÃO
                  muda o gateway ativo. Sem elas, o campo do AppID da Woovi só
                  aparecia com a Woovi já ativa — e salvar ativava de verdade. */}
              <div className="gateway-cred-tabs">
                {GATEWAYS.filter((g) => g.envKeys.length > 0).map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className={`gateway-cred-tab ${selectedGateway.id === g.id ? 'active' : ''}`}
                    onClick={() => setCredGatewayId(g.id)}
                  >
                    {g.name}
                  </button>
                ))}
              </div>

              <div className="settings-section-body">
                <div className="settings-info-block warning">
                  <AlertTriangle size={16} />
                  <p>
                    As credenciais são salvas no banco de dados e usadas apenas pelas Edge Functions.
                    <strong> Nunca são expostas no frontend.</strong>
                  </p>
                </div>
                <div className="settings-info-block">
                  <Info size={16} />
                  <p>
                    Editar as credenciais <strong>não ativa o gateway</strong>. O que define o que
                    processa os pagamentos é o <strong>Gateway de Pagamento</strong> acima.
                  </p>
                </div>

                {selectedGateway.id === 'woovi' && (
                  <SettingsWoovi
                    ambienteAtual={ambienteNormalizado}
                    valores={{
                      sandbox: gatewayConfigs[WOOVI_APP_ID_SANDBOX] || '',
                      production: gatewayConfigs[WOOVI_APP_ID_PRODUCTION] || '',
                    }}
                    onChange={(id, valor) => handleGatewayConfigChange(
                      id === 'sandbox' ? WOOVI_APP_ID_SANDBOX : WOOVI_APP_ID_PRODUCTION,
                      valor,
                    )}
                  />
                )}

                <div className="gateway-credentials">
                  {selectedGateway.envKeys
                    .filter((key) => !(selectedGateway.id === 'woovi' && (
                      key === WOOVI_APP_ID_SANDBOX || key === WOOVI_APP_ID_PRODUCTION
                    )))
                    .map((key) => (
                      <div className="form-group" key={key}>
                        <label>{formatKeyLabel(key)}</label>
                        <div className="field-with-action">
                          <input
                            type={isSecretField(key) && !senhasVisiveis[key] ? 'password' : 'text'}
                            value={gatewayConfigs[key] || ''}
                            onChange={(e) => handleGatewayConfigChange(key, e.target.value)}
                            placeholder={getPlaceholder(key)}
                            autoComplete="off"
                            spellCheck={false}
                          />
                          {isSecretField(key) && (
                            <button
                              type="button"
                              className="field-action"
                              onClick={() => alternarSenha(key)}
                              aria-label={senhasVisiveis[key] ? 'Ocultar' : 'Mostrar'}
                              title={senhasVisiveis[key] ? 'Ocultar' : 'Mostrar'}
                            >
                              {senhasVisiveis[key] ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          )}
                        </div>
                        <small className="field-hint">{getHint(key)}</small>
                      </div>
                    ))}
                </div>
              </div>
            </section>
          )}

          {/* ── Taxas ── */}
          <section className="settings-card" id="taxas">
            <div className="settings-section-header">
              <h2><Percent size={18} /> Taxas</h2>
              <span className="settings-section-hint">
                Percentuais cobrados de cada transação
              </span>
            </div>

            <div className="settings-section-body">
              <div className="form-row-2">
                <div className="form-group">
                  <label>Taxa do Gateway (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={gatewayFee}
                    onChange={(e) => setGatewayFee(e.target.value)}
                    placeholder="4.98"
                  />
                  <small className="field-hint">
                    Percentual cobrado pelo gateway de pagamento (ex: 4.98%)
                  </small>
                </div>

                <div className="form-group">
                  <label>Taxa da Plataforma (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={platformFee}
                    onChange={(e) => setPlatformFee(e.target.value)}
                    placeholder="3.95"
                  />
                  <small className="field-hint">
                    Percentual retido pela plataforma (ex: 3.95%)
                  </small>
                </div>
              </div>
            </div>
          </section>

          {/* ── Taxa de Adesão ── */}
          <section className="settings-card" id="adesao">
            <div className="settings-section-header">
              <h2><Ticket size={18} /> Taxa de Adesão Padrão</h2>
              <span className="settings-section-hint">
                Cobrada uma única vez, ao entrar no grupo
              </span>
            </div>

            <div className="settings-section-body">
              <div className="form-group">
                <label>Valor (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={entranceFee}
                  onChange={(e) => setEntranceFee(e.target.value)}
                  placeholder="15.00"
                />
              </div>

              <div className="settings-info-block">
                <Info size={16} />
                <p>
                  A taxa de adesão é cobrada apenas <strong>UMA VEZ</strong> para garantir a vaga
                  do membro no grupo. Ela cobre os encargos da taxa da plataforma, taxas de
                  transferências e depósitos bancários. Nas renovações futuras, o membro pagará
                  apenas o valor da assinatura.
                </p>
              </div>

              <div className="settings-info-block warning">
                <AlertTriangle size={16} />
                <p>
                  Grupos criados por usuários sempre terão taxa de adesão. Apenas o admin pode
                  remover no editor de grupos.
                </p>
              </div>
            </div>
          </section>

          {/* ── Link do Grupo VIP (WhatsApp) ── */}
          <section className="settings-card" id="comunicacao">
            <div className="settings-section-header">
              <h2><MessageCircle size={18} /> Grupo VIP no WhatsApp</h2>
              <span className="settings-section-hint">
                Link usado nos botões da home, no rodapé e no painel
              </span>
            </div>

            <div className="settings-section-body">
              <div className="settings-info-block">
                <Info size={16} />
                <p>
                  Trocar aqui atualiza o site na hora, sem novo deploy.
                  Aceita o link completo ou só o código do convite.
                </p>
              </div>

              <div className="settings-info-block warning">
                <AlertTriangle size={16} />
                <p>
                  O convite do WhatsApp expira quando o grupo fica sem atividade — se o botão
                  mostrar <strong>“link inválido”</strong>, pegue o novo em
                  <strong> WhatsApp &gt; Grupo &gt; Adicionar pessoas &gt; Copiar link</strong> e cole abaixo.
                </p>
              </div>

              <div className="form-group">
                <label>Link do convite</label>
                <input
                  type="text"
                  value={whatsappVipUrl}
                  onChange={(e) => setWhatsappVipUrl(e.target.value)}
                  placeholder="https://chat.whatsapp.com/SEU_CODIGO"
                />
                <small className="field-hint">
                  {extractWhatsappInviteCode(whatsappVipUrl)
                    ? `Código do convite: ${extractWhatsappInviteCode(whatsappVipUrl)}`
                    : 'Cole o link do WhatsApp ou apenas o código (ex.: AbCdEf12345).'}
                  {whatsappVipUrl.trim() ? '' : ' Em branco, o site usa o link padrão.'}
                </small>
              </div>

              {normalizeWhatsappVipUrl(whatsappVipUrl) && (
                <div className="settings-section-body" style={{ padding: 0 }}>
                  <a
                    className="btn btn-outline"
                    href={normalizeWhatsappVipUrl(whatsappVipUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={16} />
                    Testar o link do grupo
                  </a>
                </div>
              )}
            </div>
          </section>

          {/* ── SMTP Email ── */}
          <section className="settings-card" id="email">
            <div className="settings-section-header">
              <h2><Mail size={18} /> SMTP — Envio de E-mails</h2>
              <span className="settings-section-hint">
                Suporte e notificações
              </span>
            </div>

            <div className="settings-section-body">
              <div className="settings-info-block">
                <Info size={16} />
                <p>
                  Configurações de e-mail para suporte e notificações.
                  <strong> A senha SMTP é armazenada como segredo do Supabase (não aparece aqui).</strong>
                </p>
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label>SMTP Host</label>
                  <input
                    type="text"
                    value={smtpConfigs.smtp_host || ''}
                    onChange={(e) => handleSmtpConfigChange('smtp_host', e.target.value)}
                    placeholder="mail.dividepass.com"
                  />
                </div>
                <div className="form-group">
                  <label>SMTP Porta</label>
                  <input
                    type="number"
                    value={smtpConfigs.smtp_port || ''}
                    onChange={(e) => handleSmtpConfigChange('smtp_port', e.target.value)}
                    placeholder="465"
                  />
                </div>
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label>Usuário Suporte</label>
                  <input
                    type="text"
                    value={smtpConfigs.smtp_user_support || ''}
                    onChange={(e) => handleSmtpConfigChange('smtp_user_support', e.target.value)}
                    placeholder="suporte@dividepass.com"
                  />
                  <small className="field-hint">Email usado para envio de suporte</small>
                </div>
                <div className="form-group">
                  <label>Usuário Noreply</label>
                  <input
                    type="text"
                    value={smtpConfigs.smtp_user_noreply || ''}
                    onChange={(e) => handleSmtpConfigChange('smtp_user_noreply', e.target.value)}
                    placeholder="noreply@dividepass.com"
                  />
                  <small className="field-hint">Email usado para códigos, senhas, notificações</small>
                </div>
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label>From Suporte</label>
                  <input
                    type="text"
                    value={smtpConfigs.smtp_from_support || ''}
                    onChange={(e) => handleSmtpConfigChange('smtp_from_support', e.target.value)}
                    placeholder="DividePass Suporte <suporte@dividepass.com>"
                  />
                  <small className="field-hint">Nome + email exibido no envio de suporte</small>
                </div>
                <div className="form-group">
                  <label>From Noreply</label>
                  <input
                    type="text"
                    value={smtpConfigs.smtp_from_noreply || ''}
                    onChange={(e) => handleSmtpConfigChange('smtp_from_noreply', e.target.value)}
                    placeholder="DividePass <noreply@dividepass.com>"
                  />
                  <small className="field-hint">Nome + email exibido em códigos e notificações</small>
                </div>
              </div>

              <div className="settings-info-block warning">
                <AlertTriangle size={16} />
                <p>
                  A senha SMTP é configurada como segredo do Supabase via CLI:
                  <code> npx supabase secrets set SMTP_PASS=sua_senha</code>
                </p>
              </div>
            </div>
          </section>

          {/* ── IA - Groq ── */}
          <section className="settings-card" id="ia">
            <div className="settings-section-header">
              <h2><Sparkles size={18} /> IA — Extração de Código (Groq)</h2>
              <span className="settings-section-hint">
                Leitura inteligente de e-mails
              </span>
            </div>

            <div className="settings-section-body">
              <div className="settings-info-block">
                <Info size={16} />
                <p>
                  Chave da API do Groq para leitura inteligente de e-mails.
                  A IA interpreta se o email é de acesso, troca de senha, troca de email, etc.
                  <strong> Gratuito em </strong>
                  <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>
                    console.groq.com/keys
                  </a>
                </p>
              </div>

              <div className="form-group">
                <label>Groq API Key</label>
                <div className="field-with-action">
                  <input
                    type={senhasVisiveis.groq ? 'text' : 'password'}
                    value={groqApiKey}
                    onChange={(e) => setGroqApiKey(e.target.value)}
                    placeholder="gsk_..."
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="field-action"
                    onClick={() => alternarSenha('groq')}
                    aria-label={senhasVisiveis.groq ? 'Ocultar' : 'Mostrar'}
                    title={senhasVisiveis.groq ? 'Ocultar' : 'Mostrar'}
                  >
                    {senhasVisiveis.groq ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <small className="field-hint">
                  Chave necessária para habilitar IA nos grupos. Cada grupo pode ativar/desativar individualmente.
                </small>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* ── Barra de salvar (sempre visível) ──────────────────────────── */}
      <div className={`settings-footer ${pendentes > 0 ? 'tem-pendencias' : ''}`}>
        <div className="settings-footer-info">
          {pendentes > 0 ? (
            <>
              <CircleAlert size={16} />
              <span>
                <strong>{pendentes}</strong> {pendentes === 1 ? 'alteração não salva' : 'alterações não salvas'}
              </span>
            </>
          ) : (
            <>
              <CircleCheck size={16} />
              <span>Tudo salvo</span>
            </>
          )}
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
          Salvar Configurações
        </button>
      </div>
    </div>
  );
}

/**
 * Acha quem realmente rola a página.
 *
 * No painel admin, o container de rolagem é o `.admin-content` (tem
 * `overflow-y: auto` e `height: 100vh`), e não a `window`. Ouvir o scroll
 * errado faz a seção ativa do menu lateral nunca mudar.
 */
function acharContainerRolagem() {
  const candidatos = document.querySelectorAll('.admin-content, .admin-page-wrap');
  for (const el of candidatos) {
    const estilo = window.getComputedStyle(el);
    if (/(auto|scroll)/.test(estilo.overflowY)) return el;
  }
  return null;
}

/**
 * Conta quantos campos mudaram entre dois retratos.
 *
 * Cuenta folha por folha (campo a campo), e não objeto por objeto: assim
 * "3 alterações" quer dizer 3 campos mexidos — que é o que o admin espera
 * ler.
 */
function contarDiferencas(a, b) {
  if (!a || !b) return 0;
  let total = 0;
  const chaves = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const chave of chaves) {
    const va = a[chave];
    const vb = b[chave];
    if (va && vb && typeof va === 'object' && typeof vb === 'object') {
      total += contarDiferencas(va, vb);
    } else if (String(va ?? '') !== String(vb ?? '')) {
      total += 1;
    }
  }
  return total;
}

/**
 * Campos de credencial que devem ficar mascarados na tela.
 *
 * A regra geral é "o nome contém secret ou key". Os AppIDs da Woovi fogem
 * dela (o nome não tem nenhuma das duas palavras) mas são credenciais de
 * verdade: o AppID dá acesso total à conta Woovi, então entram na lista
 * explícita.
 */
function isSecretField(key) {
  if (key.includes('secret') || key.includes('key')) return true;
  return ['woovi_app_id', WOOVI_APP_ID_SANDBOX, WOOVI_APP_ID_PRODUCTION].includes(key);
}

function formatKeyLabel(key) {
  const labels = {
    mercadopago_public_key: 'Public Key',
    mercadopago_access_token: 'Access Token',
    mercadopago_client_id: 'Client ID',
    mercadopago_client_secret: 'Client Secret',
    stripe_secret_key: 'Chave Secreta (Secret Key)',
    stripe_webhook_secret: 'Secret do Webhook',
    asaas_api_key: 'Chave de API',
    asaas_env: 'Ambiente',
    iopay_secret: 'Secret',
    iopay_email: 'E-mail',
    iopay_seller_id: 'IO Seller ID',
    iopay_env: 'Ambiente',
    pagarme_api_key: 'Chave API (Secret Key)',
    pagarme_secret_key: 'Chave Secreta (Secret Key)',
    pagarme_public_key: 'Chave Pública (Public Key)',
    woovi_app_id_sandbox: 'AppID do Sandbox',
    woovi_app_id_production: 'AppID de Produção',
    woovi_retry_policy: 'Política de retentativa',
    woovi_day_due: 'Dias para expirar a cobrança',
  };
  return labels[key] || key;
}

function getPlaceholder(key) {
  const placeholders = {
    mercadopago_public_key: 'APP_USR-...',
    mercadopago_access_token: 'APP_USR-...',
    mercadopago_client_id: '1234567890',
    mercadopago_client_secret: 'xXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxX',
    stripe_secret_key: 'sk_live_...',
    stripe_webhook_secret: 'whsec_...',
    asaas_api_key: '$a$...',
    asaas_env: 'sandbox ou production',
    iopay_secret: 'Sua chave secreta',
    iopay_email: 'seu@email.com.br',
    iopay_seller_id: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    iopay_env: 'sandbox ou production',
    pagarme_api_key: 'sk_live_... ou sk_test_...',
    pagarme_secret_key: 'sk_...',
    pagarme_public_key: 'pk_...',
    woovi_retry_policy: 'THREE_RETRIES_7_DAYS',
    woovi_day_due: '3',
  };
  return placeholders[key] || '';
}

function getHint(key) {
  const hints = {
    mercadopago_public_key: 'Obtida no painel do Mercado Pago > Credenciais',
    mercadopago_access_token: 'Obtida no painel do Mercado Pago > Credenciais',
    mercadopago_client_id: 'Obtida no painel do Mercado Pago > Credenciais > Client ID',
    mercadopago_client_secret: 'Obtida no painel do Mercado Pago > Credenciais > Client Secret',
    stripe_secret_key: 'Obtida no painel do Stripe > Developers > API keys',
    stripe_webhook_secret: 'Obtida no Stripe > Developers > Webhooks > Signing secret',
    asaas_api_key: 'Obtida no Asaas > Configurações > API',
    asaas_env: 'sandbox para testes, production para produção',
    iopay_secret: 'Obtida na Conta Digital IO > Vendas > Pagamentos Online',
    iopay_email: 'E-mail da conta IOPay',
    iopay_seller_id: 'IO Seller ID da conta IOPay',
    iopay_env: 'sandbox para testes, production para produção',
    pagarme_api_key: 'Obtida no painel Pagar.me > Configurações > API Keys',
    pagarme_secret_key: 'Obtida no painel Pagar.me > Configurações > API Keys > Chave Secreta',
    pagarme_public_key: 'Obtida no painel Pagar.me > Configurações > API Keys > Chave Pública',
    woovi_retry_policy: 'THREE_RETRIES_7_DAYS = 3 retentativas em 7 dias. NON_PERMITED = sem retentativa.',
    woovi_day_due: 'Dias que a cobrança do Pix Automático fica aberta antes de expirar. Padrão: 3.',
  };
  return hints[key] || '';
}

export default Settings;
