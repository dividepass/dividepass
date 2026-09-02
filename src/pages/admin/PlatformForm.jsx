import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Check, ImageIcon, Upload, Pin, Star } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { optimizeImage } from '../../lib/imageOptimizer';
import './Platforms.css';

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

function PlatformForm() {
  const { platformId } = useParams();
  const navigate = useNavigate();
  const isEditing = !!platformId;

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [iconFile, setIconFile] = useState(null);
  const [iconPreview, setIconPreview] = useState('');

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

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    const load = async () => {
      const { data, error: err } = await supabase
        .from('streaming_services')
        .select('*')
        .eq('id', platformId)
        .single();

      if (err || !data) {
        navigate('/admin/platforms');
        return;
      }

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
        status: data.status || 'active',
        featured: !!data.featured,
        pinned: !!data.pinned,
      });
      setIconPreview(data.icon_url || '');
      setLoading(false);
    };

    load();
  }, [platformId, isEditing, navigate]);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
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

      const payload = {
        name: formData.name,
        full_name: formData.full_name,
        slug: formData.name
          .toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
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

      if (isEditing) {
        const { error: updateError } = await supabase
          .from('streaming_services')
          .update(payload)
          .eq('id', platformId);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('streaming_services')
          .insert(payload);
        if (insertError) throw insertError;
      }

      navigate('/admin/platforms');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-state">
        <Loader2 size={32} className="spin" />
        <p>Carregando...</p>
      </div>
    );
  }

  return (
    <div className="fade-in platform-form-page">
      <button onClick={() => navigate('/admin/platforms')} className="back-btn-platform">
        <ArrowLeft size={18} />
        Voltar para Plataformas
      </button>

      <div className="admin-header">
        <h1>{isEditing ? 'Editar Plataforma' : 'Nova Plataforma'}</h1>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <form onSubmit={handleSubmit} className="platform-form-card">
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
        </section>

        <div className="platform-form-footer">
          <button type="button" className="btn btn-outline" onClick={() => navigate('/admin/platforms')}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
            {isEditing ? 'Salvar Alterações' : 'Criar Plataforma'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default PlatformForm;
