import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Settings as SettingsIcon, Save, Loader2, Info, AlertTriangle, CreditCard, Zap, Shield, Globe, Mail } from 'lucide-react';
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
  const [gatewayConfigs, setGatewayConfigs] = useState({});
  const [smtpConfigs, setSmtpConfigs] = useState({});
  const [groqApiKey, setGroqApiKey] = useState('');

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

      const configs = {};
      GATEWAYS.forEach((g) => {
        g.envKeys.forEach((key) => {
          configs[key] = map[key] ?? '';
        });
      });
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

      setLoading(false);
    }

    fetchSettings();
  }, []);

  const handleGatewayConfigChange = (key, value) => {
    setGatewayConfigs((prev) => ({ ...prev, [key]: value }));
  };

  const handleSmtpConfigChange = (key, value) => {
    setSmtpConfigs((prev) => ({ ...prev, [key]: value }));
  };

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
      ];

      Object.entries(gatewayConfigs).forEach(([key, value]) => {
        updates.push({ key, value });
      });

      Object.entries(smtpConfigs).forEach(([key, value]) => {
        if (value) updates.push({ key, value });
      });

      if (groqApiKey) updates.push({ key: 'groq_api_key', value: groqApiKey });

      const { error: err } = await supabase
        .from('app_settings')
        .upsert(updates, { onConflict: 'key' });

      if (err) throw err;

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

  const selectedGateway = GATEWAYS.find((g) => g.id === activeGateway);

  return (
    <div className="fade-in settings-page">
      <div className="admin-header">
        <h1>
          <SettingsIcon size={22} />
          Configurações da Plataforma
        </h1>
        <p>Gerencie gateway de pagamento, taxas e configurações globais</p>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      <div className="settings-card">
        {/* ── Gateway Selector ── */}
        <section className="settings-section">
          <div className="settings-section-header">
            <h2>Gateway de Pagamento</h2>
          </div>

          <div className="settings-section-body">
            <p className="gateway-description">
              Selecione qual gateway processará os pagamentos da plataforma.
              O webhook de cada gateway será configurado automaticamente.
            </p>

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
                <strong>
                  https://lasoouwboxspstqvjbsv.supabase.co/functions/v1/{activeGateway}-webhook
                </strong>
              </p>
            </div>
          </div>
        </section>

        {/* ── Gateway Credentials ── */}
        {selectedGateway && selectedGateway.envKeys.length > 0 && (
          <section className="settings-section">
            <div className="settings-section-header">
              <h2>Credenciais — {selectedGateway.name}</h2>
            </div>

            <div className="settings-section-body">
              <div className="settings-info-block warning">
                <AlertTriangle size={16} />
                <p>
                  As credenciais são salvas no banco de dados e usadas apenas pelas Edge Functions.
                  <strong> Nunca são expostas no frontend.</strong>
                </p>
              </div>

              <div className="gateway-credentials">
                {selectedGateway.envKeys.map((key) => (
                  <div className="form-group" key={key}>
                    <label>{formatKeyLabel(key)}</label>
                    <input
                      type={key.includes('secret') || key.includes('key') ? 'password' : 'text'}
                      value={gatewayConfigs[key] || ''}
                      onChange={(e) => handleGatewayConfigChange(key, e.target.value)}
                      placeholder={getPlaceholder(key)}
                    />
                    <small className="field-hint">{getHint(key)}</small>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── Taxas ── */}
        <section className="settings-section">
          <div className="settings-section-header">
            <h2>Taxas</h2>
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
        <section className="settings-section">
          <div className="settings-section-header">
            <h2>Taxa de Adesão Padrão</h2>
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

        {/* ── SMTP Email ── */}
        <section className="settings-section">
          <div className="settings-section-header">
            <h2>
              <Mail size={18} />
              SMTP - Envio de E-mails
            </h2>
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
        <section className="settings-section">
          <div className="settings-section-header">
            <h2>
              <Zap size={18} />
              IA - Extração de Código (Groq)
            </h2>
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
              <input
                type="password"
                value={groqApiKey}
                onChange={(e) => setGroqApiKey(e.target.value)}
                placeholder="gsk_..."
              />
              <small className="field-hint">
                Chave necessária para habilitar IA nos grupos. Cada grupo pode ativar/desativar individualmente.
              </small>
            </div>
          </div>
        </section>
      </div>

      <div className="settings-footer">
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
  };
  return hints[key] || '';
}

export default Settings;
