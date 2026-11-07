import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Loader2, Check, ImageIcon, Upload, Pin, Star, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { optimizeImage } from '../../lib/imageOptimizer';
import { fetchPlansForService, saveServicePlans } from '../../lib/platformPlans';
import PlatformPlansEditor from '../../components/group-creation/PlatformPlansEditor';
import './Platforms.css';

/* A tabela `service_plans` nasce com RLS ligado e sem policy: sem a migration,
   nem o admin consegue gravar os planos da plataforma. */
const PLAN_HINT = 'Aplique a migration database/add-platform-plans-and-group-visibility.sql no SQL Editor do Supabase (ela libera a leitura e a gravação dos planos).';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CATEGORIES = [
  { value: 'streaming', label: 'Streaming', icon: '📺', desc: 'Filmes, séries e esportes' },
  { value: 'musica', label: 'Música', icon: '🎵', desc: 'Música, podcasts e audiobooks' },
  { value: 'ia', label: 'IA', icon: '🤖', desc: 'Inteligência artificial' },
  { value: 'cursos', label: 'Cursos', icon: '🎓', desc: 'Educação e capacitação' },
  { value: 'produtividade', label: 'Produtividade', icon: '💼', desc: 'Trabalho e colaboração' },
  { value: 'ferramentas', label: 'Ferramentas', icon: '🛠', desc: 'Design, marketing e edição' },
  { value: 'leitura', label: 'Leitura', icon: '📚', desc: 'Livros e conteúdo digital' },
  { value: 'games', label: 'Games', icon: '🎮', desc: 'Assinaturas para jogos' },
  { value: 'saude', label: 'Saúde', icon: '🏋️', desc: 'Fitness e qualidade de vida' },
  { value: 'seguranca', label: 'Segurança', icon: '🔒', desc: 'VPN, senhas e proteção' },
];

/**
 * Busca a plataforma pelo SLUG (URL amigável) e, se não achar, pelo id.
 * A URL usa o slug ("/admin/platforms/netflix/edit"); o id uuid continua
 * valendo (link antigo, ou plataforma sem slug).
 */
async function loadPlatformByKey(key) {
  if (!key) return null;

  const bySlug = await supabase
    .from('streaming_services')
    .select('*')
    .eq('slug', key)
    .maybeSingle();
  if (!bySlug.error && bySlug.data) return bySlug.data;

  if (UUID_RE.test(key)) {
    const byId = await supabase
      .from('streaming_services')
      .select('*')
      .eq('id', key)
      .maybeSingle();
    if (!byId.error && byId.data) return byId.data;
  }

  return null;
}

/** Os planos da plataforma no formato do editor (inclui o id do banco). */
function toPlanDraft(p) {
  return {
    id: p.id,
    name: p.name || '',
    official_price: p.official_price ?? '',
    max_members: p.max_members ?? '',
    suggested_price: p.suggested_price ?? '',
    min_price: p.min_price ?? '',
    max_price: p.max_price ?? '',
    max_screens: p.max_screens ?? '',
    quality: p.quality || '',
    details: p.details || '',
    billing_cycle: p.billing_cycle || 'monthly',
    is_active: p.is_active !== false,
  };
}

function PlatformForm() {
  /* A rota aceita slug OU uuid: /admin/platforms/netflix/edit */
  const { platformKey } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  /* A rota decide o que a tela é:
       /admin/platforms/:key/edit -> edição de uma plataforma existente
       /admin/platforms/:key/new  -> rascunho criado pelo admin (ainda vazio)
       /admin/platforms/new       -> atalho antigo: cria o rascunho e redireciona */
  const isNewRoute = location.pathname.endsWith('/new');
  const isEditing = !isNewRoute;

  const [platform, setPlatform] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPlans, setSavingPlans] = useState(false);
  const [error, setError] = useState('');
  const [plansError, setPlansError] = useState('');
  const [plansOk, setPlansOk] = useState('');
  const [iconFile, setIconFile] = useState(null);
  const [iconPreview, setIconPreview] = useState('');
  /* Planos padrão da plataforma (service_plans). */
  const [plans, setPlans] = useState([]);
  const [originalPlanIds, setOriginalPlanIds] = useState([]);
  const [creatingDraft, setCreatingDraft] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    full_name: '',
    icon: '',
    color: '#4F46E5',
    category: 'streaming',
    description: '',
    official_url: '',
    official_price: '',
    max_group_size: 4,
    status: 'active',
    featured: false,
    pinned: false,
  });

  /* Sem id na URL (/admin/platforms/new): cria o rascunho e abre a URL com
     o slug — o mesmo movimento do wizard de grupos (a URL sempre diz qual
     plataforma está sendo editada). */
  useEffect(() => {
    if (platformKey || creatingDraft) return;

    (async () => {
      try {
        setCreatingDraft(true);
        const stamp = Date.now().toString(36).slice(-6);
        const { error: err } = await supabase
          .from('streaming_services')
          .insert({
            name: `nova-plataforma-${stamp}`,
            full_name: 'Nova plataforma',
            slug: `nova-plataforma-${stamp}`,
            icon: '?',
            color: '#4F46E5',
            category: 'streaming',
            status: 'inactive',
            max_group_size: 4,
          });

        if (err) throw err;
        navigate(`/admin/platforms/nova-plataforma-${stamp}/new`, { replace: true });
      } catch (err) {
        setError(`Não foi possível abrir o formulário: ${err.message}`);
        setLoading(false);
      } finally {
        setCreatingDraft(false);
      }
    })();
  }, [platformKey, creatingDraft, navigate]);

  useEffect(() => {
    if (!platformKey) return;

    let cancelled = false;

    (async () => {
      setLoading(true);
      const data = await loadPlatformByKey(platformKey);

      if (cancelled) return;

      if (!data) {
        setError('Plataforma não encontrada.');
        setLoading(false);
        return;
      }

      setPlatform(data);

      // O rascunho nasce inativo (para não aparecer no catálogo enquanto o
      // admin preenche). No formulário ele já entra como ativo — o campo
      // Status é a escolha do admin.
      const isDraft = String(data.name || '').startsWith('nova-plataforma-');

      setFormData({
        name: data.name || '',
        full_name: data.full_name || '',
        icon: data.icon || '',
        color: data.color || '#4F46E5',
        category: data.category || 'streaming',
        description: data.description || '',
        official_url: data.official_url || '',
        official_price: data.official_price || '',
        max_group_size: data.max_group_size || 4,
        status: isDraft ? 'active' : (data.status || 'active'),
        featured: !!data.featured,
        pinned: !!data.pinned,
      });
      setIconPreview(data.icon_url || '');
      setLoading(false);

      // Planos da plataforma (só os desta). O recarregamento depois de
      // salvar é ESSENCIAL: sem o id do banco, o próximo "salvar planos"
      // tentaria INSERT de novo e bateria na chave única.
      const existing = await fetchPlansForService(data.id);
      if (cancelled) return;
      setPlans(existing.map(toPlanDraft));
      setOriginalPlanIds(existing.map(p => p.id));

      // URL amigável: o slug no lugar do uuid (sem mexer no histórico).
      const urlSlug = data.slug || data.id;
      const suffix = isNewRoute ? 'new' : 'edit';
      if (platformKey !== urlSlug) {
        navigate(`/admin/platforms/${urlSlug}/${suffix}`, { replace: true });
      }
    })();

    return () => { cancelled = true; };
  }, [platformKey, isNewRoute, navigate]);

  /* Recarrega os planos do banco (usado depois de salvar). */
  const loadPlans = async (serviceId) => {
    const existing = await fetchPlansForService(serviceId);
    setPlans(existing.map(toPlanDraft));
    setOriginalPlanIds(existing.map(p => p.id));
  };

  const handleIconChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Selecione uma imagem.');
      return;
    }
    const optimized = await optimizeImage(file, 'icon');
    setIconFile(optimized);
    setIconPreview(URL.createObjectURL(optimized));
  };

  /* ────────────────────────────────────────────────── SALVAR A PLATAFORMA */
  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!platform?.id) return;
    setSaving(true);
    setError('');

    try {
      let iconUrl = iconPreview || '';

      if (iconFile) {
        const fileExt = iconFile.name.split('.').pop();
        const fileName = `${crypto.randomUUID()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('platform-icons')
          .upload(fileName, iconFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from('platform-icons')
          .getPublicUrl(fileName);

        iconUrl = publicUrlData.publicUrl;
      }

      const slug = formData.name
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      const payload = {
        name: formData.name,
        full_name: formData.full_name,
        slug,
        icon: formData.icon,
        color: formData.color,
        category: formData.category,
        description: formData.description || null,
        official_url: formData.official_url || null,
        icon_url: iconUrl || null,
        official_price: formData.official_price ? parseFloat(formData.official_price) : null,
        max_group_size: parseInt(formData.max_group_size, 10),
        status: formData.status,
        featured: formData.featured,
        pinned: formData.pinned,
      };

      const { error: updateError } = await supabase
        .from('streaming_services')
        .update(payload)
        .eq('id', platform.id);
      if (updateError) throw updateError;

      setPlatform(prev => ({ ...prev, ...payload }));

      // A plataforma existia (inclusive o rascunho): a URL agora é a de edição
      // e mostra o slug.
      navigate(`/admin/platforms/${slug || platform.id}/edit`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  /* ───────────────────────────────────────────────────── SALVAR OS PLANOS */
  const handleSavePlans = async () => {
    if (!platform?.id) return;
    setSavingPlans(true);
    setPlansError('');
    setPlansOk('');

    try {
      const result = await saveServicePlans(platform.id, plans, originalPlanIds);
      if (!result.ok) {
        setPlansError(`Não foi possível salvar os planos: ${result.error}. ${PLAN_HINT}`);
        return;
      }

      // Recarrega para trazer o id do banco de cada plano — sem isso o
      // próximo save tentaria inserir de novo.
      await loadPlans(platform.id);
      setPlansOk(
        result.saved > 0
          ? `${result.saved} plano(s) salvo(s).`
          : 'Nenhum plano para salvar.'
      );
    } catch (err) {
      setPlansError(`Não foi possível salvar os planos: ${err.message}. ${PLAN_HINT}`);
    } finally {
      setSavingPlans(false);
    }
  };

  /* Rascunho aberto e não salvo: pode ser descartado sem deixar lixo. */
  const handleDiscard = async () => {
    if (!platform?.id) return;
    if (!window.confirm('Descartar este rascunho? A plataforma não será salva.')) return;

    setSaving(true);
    try {
      await supabase.from('service_plans').delete().eq('service_id', platform.id);
      const { error: delErr } = await supabase
        .from('streaming_services')
        .delete()
        .eq('id', platform.id);
      if (delErr) throw delErr;
      navigate('/admin/platforms');
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  if (loading || (!platformKey && creatingDraft)) {
    return (
      <div className="loading-state">
        <Loader2 size={32} className="spin" />
        <p>{creatingDraft ? 'Abrindo nova plataforma...' : 'Carregando...'}</p>
      </div>
    );
  }

  const platformSlug = platform?.slug || platform?.id || '';

  return (
    <div className="fade-in platform-form-page">
      <button onClick={() => navigate('/admin/platforms')} className="back-btn-platform">
        <ArrowLeft size={18} />
        Voltar
      </button>

      <div className="admin-header">
        <h1>{isEditing ? 'Editar Plataforma' : 'Nova Plataforma'}</h1>
        {platformSlug && (
          <p className="page-subtitle" title={`id no banco: ${platform?.id}`}>
            ID da plataforma: <code>{platformSlug}</code>
          </p>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <form onSubmit={handleSubmit} className="platform-form-wrap">
        <div className="platform-form-card">
          <section className="pf-section">
            <h2>Dados da Plataforma</h2>

            <div className="form-row-2">
              <div className="form-group">
                <label>Nome da plataforma *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Netflix"
                  required
                />
                <small className="field-hint">
                  É o que aparece na URL: <code>/admin/platforms/{formData.name.toLowerCase().replace(/\s+/g, '-')}/edit</code>
                </small>
              </div>
              <div className="form-group">
                <label>Nome completo *</label>
                <input
                  type="text"
                  value={formData.full_name}
                  onChange={e => setFormData({ ...formData, full_name: e.target.value })}
                  placeholder="Netflix Premium"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label>Categoria *</label>
              <div className="category-selector">
                {CATEGORIES.map(cat => (
                  <button
                    key={cat.value}
                    type="button"
                    className={`category-option ${formData.category === cat.value ? 'selected' : ''}`}
                    onClick={() => setFormData({ ...formData, category: cat.value })}
                  >
                    <span className="category-option-icon">{cat.icon}</span>
                    <span className="category-option-label">{cat.label}</span>
                    <span className="category-option-desc">{cat.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="form-row-3">
              <div className="form-group icon-upload-group">
                <label>Ícone</label>
                <div className="icon-upload">
                  <div className="icon-preview" style={{ backgroundColor: formData.color }}>
                    {iconPreview ? (
                      <img src={iconPreview} alt="Preview" />
                    ) : (
                      formData.icon || <ImageIcon size={20} />
                    )}
                  </div>
                  <label className="btn btn-outline btn-sm upload-btn">
                    <Upload size={14} />
                    Subir imagem
                    <input type="file" accept="image/*" onChange={handleIconChange} hidden />
                  </label>
                </div>
                <input
                  type="text"
                  value={formData.icon}
                  onChange={e => setFormData({ ...formData, icon: e.target.value })}
                  placeholder="Letra de fallback (N)"
                  maxLength={3}
                  className="icon-fallback"
                />
              </div>
              <div className="form-group">
                <label>Cor</label>
                <div className="color-input">
                  <input
                    type="color"
                    value={formData.color}
                    onChange={e => setFormData({ ...formData, color: e.target.value })}
                  />
                  <span>{formData.color}</span>
                </div>
              </div>
              <div className="form-group">
                <label>Status</label>
                <select
                  value={formData.status}
                  onChange={e => setFormData({ ...formData, status: e.target.value })}
                >
                  <option value="active">Ativo</option>
                  <option value="inactive">Inativo</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Descrição</label>
              <textarea
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="Plano Premium Ultra HD"
                rows={3}
              />
            </div>

            <div className="form-group">
              <label>URL do site oficial</label>
              <input
                type="url"
                value={formData.official_url}
                onChange={e => setFormData({ ...formData, official_url: e.target.value })}
                placeholder="https://www.netflix.com"
              />
              <small className="field-hint">Link exibido na página de credenciais do membro</small>
            </div>
          </section>

          {/* ------------------------------------------- PLANOS DA PLATAFORMA */}
          <PlatformPlansEditor
            plans={plans}
            onChange={setPlans}
            disabled={savingPlans}
            error={plansError}
            success={plansOk}
            onSave={handleSavePlans}
            saving={savingPlans}
          />
        </div>

        {/* --------------------------- EXIBIÇÃO NO CATÁLOGO (abaixo do card) */}
        <section className="pf-section platform-visibility-section">
          <h2>Exibição no catálogo</h2>
          <p className="section-desc">
            Como a plataforma aparece para o usuário no catálogo e na home.
          </p>

          <div className="form-row-2">
            <label className="toggle-option">
              <input
                type="checkbox"
                checked={formData.pinned}
                onChange={e => setFormData({ ...formData, pinned: e.target.checked })}
              />
              <div className="toggle-content">
                <Pin size={16} />
                <div>
                  <strong>Fixar no topo</strong>
                  <span>Aparece sempre no início do catálogo</span>
                </div>
              </div>
            </label>
            <label className="toggle-option">
              <input
                type="checkbox"
                checked={formData.featured}
                onChange={e => setFormData({ ...formData, featured: e.target.checked })}
              />
              <div className="toggle-content">
                <Star size={16} />
                <div>
                  <strong>Destaque</strong>
                  <span>Exibe selo de destaque no catálogo</span>
                </div>
              </div>
            </label>
          </div>

          <div className="platform-form-footer">
            {isNewRoute && (
              <button type="button" className="btn btn-outline" onClick={handleDiscard} disabled={saving}>
                <Trash2 size={16} />
                Descartar rascunho
              </button>
            )}
            <button type="button" className="btn btn-outline" onClick={() => navigate('/admin/platforms')}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
              {isEditing ? 'Salvar Alterações' : 'Criar Plataforma'}
            </button>
          </div>
        </section>
      </form>
    </div>
  );
}

export default PlatformForm;
