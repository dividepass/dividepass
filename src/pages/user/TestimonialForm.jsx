import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, Send, Loader2, CheckCircle, AlertCircle, Trash2, Sparkles, ArrowRight, Copy, Check, ImageIcon, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { saveAvatar } from '../../lib/uploadAvatar';
import './TestimonialForm.css';

function TestimonialForm() {
  const navigate = useNavigate();
  const { user, profile, refreshProfile, loading: authLoading } = useAuth();
  const [myTestimonials, setMyTestimonials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [text, setText] = useState('');
  const [rating, setRating] = useState(5);
  const [role, setRole] = useState('');
  const [hoveredStar, setHoveredStar] = useState(0);
  const [message, setMessage] = useState(null);
  const [rewardData, setRewardData] = useState(null);
  const [rewardError, setRewardError] = useState('');
  const [couponCopied, setCouponCopied] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const avatarUrl = profile?.avatar_url || null;

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Selecione uma imagem válida.' });
      return;
    }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const removePhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
  };

  useEffect(() => {
    loadMyTestimonials();
  }, [user?.id]);

  const loadMyTestimonials = async () => {
    if (!user?.id) {
      setMyTestimonials([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data } = await supabase
      .from('testimonials')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setMyTestimonials(data || []);
    setLoading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (!user?.id) {
      setMessage({ type: 'error', text: 'Você precisa estar autenticado para enviar um depoimento.' });
      return;
    }
setSubmitting(true);
    setMessage(null);
    setRewardError('');

    try {
      let currentAvatarUrl = avatarUrl;

      if (photoFile) {
        setUploadingPhoto(true);
        currentAvatarUrl = await saveAvatar(photoFile, user.id);
        setUploadingPhoto(false);
        removePhoto();
        // Mantém o card de foto e o cabeçalho em dia com o novo avatar.
        if (refreshProfile) await refreshProfile();
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('Sessão expirada. Faça login novamente.');

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/grant-testimonial-reward`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          user_name: profile?.name || user.user_metadata?.name || user.email || 'Anônimo',
          user_role: role || null,
          text: text.trim(),
          rating,
          avatar_url: currentAvatarUrl || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.already_granted) {
          setMessage({
            type: 'error',
            text: 'Você já possui elegibilidade para esta campanha.',
          });
          setSubmitting(false);
          return;
        }
        throw new Error(data.error || 'Erro ao enviar depoimento.');
      }

      // A edge function grava o avatar_url do depoimento quando já foi
      // atualizada. Até lá, gravamos direto: a RLS permite o usuário
      // atualizar o próprio depoimento enquanto ele está 'pending'.
      if (currentAvatarUrl && data.testimonial_id) {
        const { error: avatarErr } = await supabase
          .from('testimonials')
          .update({ avatar_url: currentAvatarUrl })
          .eq('id', data.testimonial_id);

        if (avatarErr) {
          // Avatar é cosmético: o depoimento e o cupom já estão garantidos.
          console.error('Não foi possível gravar o avatar no depoimento:', avatarErr);
        }
      }

      setRewardData(data.reward);
      setMessage({ type: 'success', text: 'Depoimento enviado!' });
      setText('');
      setRating(5);
      setRole('');
      loadMyTestimonials();
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Erro ao enviar depoimento.' });
    } finally {
      setUploadingPhoto(false);
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Excluir este depoimento?')) return;
    await supabase.from('testimonials').delete().eq('id', id);
    loadMyTestimonials();
  };

  const statusLabel = (s) => {
    if (s === 'approved') return <span className="tf-status approved">Aprovado</span>;
    if (s === 'rejected') return <span className="tf-status rejected">Rejeitado</span>;
    return <span className="tf-status pending">Aguardando aprovação</span>;
  };

  if (rewardData) {
    const couponCode = rewardData.code;
    const expiryDate = rewardData.expires_at
      ? new Date(rewardData.expires_at).toLocaleDateString('pt-BR')
      : null;

    const handleCopyCoupon = () => {
      navigator.clipboard.writeText(couponCode).then(() => {
        setCouponCopied(true);
        setTimeout(() => setCouponCopied(false), 2500);
      }).catch(() => {
        // Fallback para navegadores sem clipboard API
        const input = document.createElement('input');
        input.value = couponCode;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        setCouponCopied(true);
        setTimeout(() => setCouponCopied(false), 2500);
      });
    };

    return (
      <div className="tf-page fade-in">
        <div className="tf-container">
          <div className="tf-reward-success">
            <div className="tf-reward-icon">
              <Sparkles size={40} />
            </div>
            <h2>Obrigado pela sua avaliação!</h2>
            <p className="tf-reward-sub">
              Você ganhou <strong>R$ 5,00</strong> de desconto na sua próxima assinatura.
            </p>

            <div className="tf-coupon-box">
              <span className="tf-coupon-label">Cupom</span>
              <div className="tf-coupon-code-row">
                <span className="tf-coupon-code">{couponCode}</span>
                <button
                  className={`tf-copy-btn ${couponCopied ? 'copied' : ''}`}
                  onClick={handleCopyCoupon}
                  title={couponCopied ? 'Copiado!' : 'Copiar código'}
                >
                  {couponCopied ? <Check size={16} /> : <Copy size={16} />}
                  {couponCopied ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              {expiryDate && (
                <p className="tf-coupon-expiry">
                  Válido até {expiryDate}
                </p>
              )}
            </div>

            <div className="tf-reward-actions">
              <button
                className="tf-reward-cta"
                onClick={() => navigate('/dashboard/catalog')}
              >
                Explorar assinaturas
                <ArrowRight size={18} />
              </button>
            </div>
            <p className="tf-reward-note">
              O cupom será aplicado automaticamente ao contratar uma nova assinatura.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tf-page fade-in">
      <div className="tf-container">
        <h1>Enviar Depoimento</h1>
        <p className="tf-subtitle">Compartilhe sua experiência com a DividePass. Seu depoimento ajudará outras pessoas a confiar na plataforma.</p>

        {authLoading && <div className="tf-message">Carregando usuário...</div>}

        {message && !rewardData && (
          <div className={`tf-message ${message.type}`}>
            {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
            {message.text}
          </div>
        )}

        <form className="tf-form" onSubmit={handleSubmit}>
          <div className="tf-rating-row">
            <label>Sua avaliação</label>
            <div className="tf-stars">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  className={`tf-star ${star <= (hoveredStar || rating) ? 'active' : ''}`}
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoveredStar(star)}
                  onMouseLeave={() => setHoveredStar(0)}
                >
                  <Star size={28} fill={star <= (hoveredStar || rating) ? '#FBBF24' : 'none'} color={star <= (hoveredStar || rating) ? '#FBBF24' : '#6b7280'} />
                </button>
              ))}
              <span className="tf-rating-label">{rating} {rating === 1 ? 'estrela' : 'estrelas'}</span>
            </div>
          </div>

          <div className="tf-form-group">
            <label>Seu papel (opcional)</label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Ex: Estudante, Designer, Analista..."
            />
          </div>

          <div className="tf-form-group">
            <label>Seu depoimento *</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Conte como foi sua experiência com a DividePass..."
              rows={5}
              required
            />
          </div>

          <div className="tf-form-group">
            <label>Sua foto (opcional)</label>
            {photoPreview ? (
              <div className="image-preview-box">
                <img src={photoPreview} alt="Preview" />
                <button type="button" className="remove-image-btn" onClick={removePhoto}>
                  <X size={16} />
                </button>
              </div>
            ) : avatarUrl ? (
              <div className="tf-avatar-current">
                <img src={avatarUrl} alt="Seu avatar" />
                <span>Essa é a foto que aparece no seu depoimento.</span>
              </div>
            ) : (
              <label className="image-upload-area">
                <ImageIcon size={24} />
                <span>Adicionar uma foto</span>
                <small>Aparece junto do seu depoimento (máx. 5MB)</small>
                <input type="file" accept="image/*" onChange={handlePhotoChange} hidden />
              </label>
            )}
          </div>

          <button type="submit" className="tf-submit" disabled={submitting || !text.trim()}>
            {submitting ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
            {uploadingPhoto ? 'Enviando foto...' : submitting ? 'Enviando...' : 'Enviar Depoimento'}
          </button>
        </form>

        {myTestimonials.length > 0 && (
          <div className="tf-my-testimonials">
            <h2>Meus Depoimentos</h2>
            {myTestimonials.map((t) => (
              <div key={t.id} className="tf-my-card">
                <div className="tf-my-header">
                  <div className="tf-my-stars">
                    {Array.from({ length: t.rating }).map((_, i) => (
                      <Star key={i} size={14} fill="#FBBF24" color="#FBBF24" />
                    ))}
                  </div>
                  {statusLabel(t.status)}
                </div>
                <p>"{t.text}"</p>
                <div className="tf-my-footer">
                  <span>{new Date(t.created_at).toLocaleDateString('pt-BR')}</span>
                  {t.status === 'pending' && (
                    <button className="tf-delete-btn" onClick={() => handleDelete(t.id)}>
                      <Trash2 size={14} /> Excluir
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default TestimonialForm;
