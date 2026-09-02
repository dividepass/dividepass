import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Plus, Trash2, GripVertical, Eye, EyeOff,
  BarChart3, Link as LinkIcon, ToggleLeft, ToggleRight,
  CheckCircle, FileText, List, Monitor, Edit2, Copy,
  ExternalLink, ChevronUp, ChevronDown, X, Save, Loader2,
  Layers, GitBranch
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import './Surveys.css';

const CATEGORIES = [
  { value: 'streaming', label: '📺 Streaming' },
  { value: 'musica', label: '🎵 Música' },
  { value: 'ia', label: '🤖 IA' },
  { value: 'cursos', label: '🎓 Cursos' },
  { value: 'produtividade', label: '💼 Produtividade' },
  { value: 'ferramentas', label: '🛠 Ferramentas' },
  { value: 'leitura', label: '📚 Leitura' },
  { value: 'games', label: '🎮 Games' },
  { value: 'saude', label: '🏋️ Saúde' },
  { value: 'seguranca', label: '🔒 Segurança' },
];

function Surveys() {
  const navigate = useNavigate();
  const { id: urlId } = useParams();
  const [surveys, setSurveys] = useState([]);
  const [platforms, setPlatforms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list'); // list, create, edit, editSteps
  const [editingSurvey, setEditingSurvey] = useState(null);
  const [saving, setSaving] = useState(false);
  const [copiedSlug, setCopiedSlug] = useState(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [autoSaving, setAutoSaving] = useState(false);
  const autoSaveTimer = useRef(null);
  const stepsEndRef = useRef(null);

  // Form state
  const [form, setForm] = useState({
    title: '',
    description: '',
    slug: '',
    is_active: true,
    show_in_catalog: false,
    steps: [],
  });
  const formRef = useRef(form);
  formRef.current = form;

  // Step editor state
  const [editingStep, setEditingStep] = useState(null);
  const [showStepModal, setShowStepModal] = useState(false);
  const [stepForm, setStepForm] = useState({
    step_type: 'info',
    title: '',
    description: '',
    is_required: true,
    question_type: 'single',
    options: [],
    content: '',
    image_url: '',
    platform_filter: [],
    platform_filter_mode: 'individual', // 'individual' | 'category'
    branch_sim: '',
    branch_nao: '',
    id: null, // existing step id for edit
  });

  useEffect(() => {
    loadData();
  }, []);

  // Auto-enter edit mode from URL
  useEffect(() => {
    if (urlId && !loading && surveys.length >= 0) {
      const survey = surveys.find(s => s.id === urlId);
      if (survey) {
        startEdit(survey);
      } else if (!loading && surveys.length > 0) {
        navigate('/admin/surveys', { replace: true });
      }
    }
  }, [urlId, loading, surveys]);

  // Auto-save function
  const autoSave = useCallback(async (formToSave) => {
    if (!formToSave.title.trim()) return;
    if (!formRef.current || formRef.current !== formToSave) return;

    setAutoSaving(true);
    try {
      const stepsToSave = formToSave.steps.map((step, i) => {
        const resolveBranchStep = (val) => {
          if (!val || val === '') return null;
          if (val === '__end__') return 0;
          const num = parseInt(val, 10);
          return isNaN(num) ? null : num;
        };
        return {
          step_number: i + 1,
          step_type: step.step_type,
          title: step.title,
          description: step.description || null,
          is_required: step.is_required !== false,
          question_type: step.question_type || null,
          options: step.options || [],
          content: step.content || null,
          image_url: step.image_url || null,
          platform_filter: step.platform_filter || [],
          branch_sim_step: resolveBranchStep(step.branch_sim),
          branch_nao_step: resolveBranchStep(step.branch_nao),
          id: step.id || null,
        };
      });

      const upsertSteps = async (surveyId) => {
        if (stepsToSave.length === 0) return;

        const { data: existingSteps } = await supabase
          .from('survey_steps').select('id').eq('survey_id', surveyId);
        const existingIds = new Set((existingSteps || []).map(s => s.id));

        const toUpdate = [];
        const toInsert = [];
        for (const s of stepsToSave) {
          const row = {
            survey_id: surveyId,
            step_number: s.step_number,
            step_type: s.step_type,
            title: s.title,
            description: s.description,
            is_required: s.is_required,
            question_type: s.question_type,
            options: s.options,
            content: s.content,
            image_url: s.image_url,
            platform_filter: s.platform_filter,
            branch_sim_step: s.branch_sim_step,
            branch_nao_step: s.branch_nao_step,
          };
          if (s.id && existingIds.has(s.id)) {
            toUpdate.push({ ...row, id: s.id });
          } else {
            toInsert.push(row);
          }
        }

        for (const row of toUpdate) {
          await supabase.from('survey_steps').update(row).eq('id', row.id);
        }
        if (toInsert.length > 0) {
          await supabase.from('survey_steps').insert(toInsert);
        }

        const currentIds = new Set(stepsToSave.filter(s => s.id && existingIds.has(s.id)).map(s => s.id));
        for (const es of (existingSteps || [])) {
          if (!currentIds.has(es.id)) {
            await supabase.from('survey_steps').delete().eq('id', es.id);
          }
        }
      };

      if (editingSurvey) {
        await supabase
          .from('surveys')
          .update({
            title: formToSave.title,
            description: formToSave.description,
            slug: formToSave.slug || null,
            is_active: formToSave.is_active,
            show_in_catalog: formToSave.show_in_catalog || false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingSurvey.id);

        await upsertSteps(editingSurvey.id);
      } else {
        const { data: newSurvey, error: createError } = await supabase
          .from('surveys')
          .insert({
            title: formToSave.title,
            description: formToSave.description,
            slug: formToSave.slug || null,
            is_active: formToSave.is_active !== false,
            show_in_catalog: formToSave.show_in_catalog || false,
          })
          .select()
          .single();

        if (createError) throw createError;
        await upsertSteps(newSurvey.id);

        // Update editingSurvey so subsequent auto-saves update instead of create
        setEditingSurvey(newSurvey);
        navigate(`/admin/surveys/${newSurvey.id}/edit`, { replace: true });
      }
    } catch (e) {
      console.error('Auto-save error:', e);
    }
    setAutoSaving(false);
  }, [editingSurvey, navigate]);

  // Trigger auto-save on form changes (debounced 1.5s)
  useEffect(() => {
    if (view === 'list') return;
    if (!form.title.trim()) return;

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      autoSave(form);
    }, 1500);

    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [form, view, autoSave]);

  // Auto-scroll to bottom when steps change
  useEffect(() => {
    if (stepsEndRef.current) {
      stepsEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [form.steps.length]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Ensure branch columns exist in survey_steps table
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          await fetch(`${supabase.supabaseUrl}/functions/v1/manage-survey?action=ensure-columns`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${session.access_token}`, apikey: supabase.supabaseKey },
          });
        }
      } catch (e) {
        console.warn('[Surveys] Could not ensure branch columns:', e.message);
      }

      const [surveysData, platformsData] = await Promise.all([
        supabase.from('surveys').select('*').order('created_at', { ascending: false }),
        supabase.from('streaming_services').select('id, name, icon_url, color, pinned, featured').order('name'),
      ]);

      if (surveysData.data) {
        // Get response counts
        const surveyIds = surveysData.data.map(s => s.id);
        let countMap = {};
        if (surveyIds.length > 0) {
          const { data: counts } = await supabase
            .from('survey_responses')
            .select('survey_id')
            .in('survey_id', surveyIds);
          (counts || []).forEach(r => {
            countMap[r.survey_id] = (countMap[r.survey_id] || 0) + 1;
          });
        }
        const enriched = surveysData.data.map(s => ({
          ...s,
          response_count: countMap[s.id] || 0,
        }));
        setSurveys(enriched);
      }
      if (platformsData.data) {
        setPlatforms(platformsData.data.sort((a, b) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          if (a.featured && !b.featured) return -1;
          if (!a.featured && b.featured) return 1;
          return a.name?.localeCompare(b.name);
        }));
      }
    } catch (e) {
      console.error('Load error:', e);
    }
    setLoading(false);
  };

  const handleCopyLink = (slug) => {
    const link = `${window.location.origin}/pesquisa/${slug}`;
    navigator.clipboard.writeText(link);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2000);
  };

  const handleDelete = async (id) => {
    if (!confirm('Tem certeza que deseja excluir esta pesquisa?')) return;
    try {
      await supabase.from('surveys').delete().eq('id', id);
      setSurveys(surveys.filter(s => s.id !== id));
    } catch (e) {
      console.error('Delete error:', e);
    }
  };

  const handleToggleActive = async (id, current) => {
    try {
      await supabase.from('surveys').update({ is_active: !current, updated_at: new Date().toISOString() }).eq('id', id);
      setSurveys(surveys.map(s => s.id === id ? { ...s, is_active: !current } : s));
    } catch (e) {
      console.error('Toggle error:', e);
    }
  };

  const startCreate = () => {
    setEditingSurvey(null);
    setForm({
      title: '',
      description: '',
      slug: '',
      is_active: true,
      show_in_catalog: false,
      steps: [],
    });
    setView('create');
    navigate('/admin/surveys', { replace: true });
  };

  const startEdit = async (survey) => {
    try {
      const { data: surveyData, error: surveyError } = await supabase
        .from('surveys')
        .select('*')
        .eq('id', survey.id)
        .single();
      if (surveyError) throw surveyError;

      const { data: steps } = await supabase
        .from('survey_steps')
        .select('*')
        .eq('survey_id', survey.id)
        .order('step_number', { ascending: true });

      const fullSurvey = { ...surveyData, steps: (steps || []).map(s => ({
        ...s,
        branch_sim: s.branch_sim_step != null ? String(s.branch_sim_step) : '',
        branch_nao: s.branch_nao_step != null ? String(s.branch_nao_step) : '',
      })) };

      setEditingSurvey(fullSurvey);
      setForm({
        title: fullSurvey.title || '',
        description: fullSurvey.description || '',
        slug: fullSurvey.slug || '',
        is_active: fullSurvey.is_active !== false,
        show_in_catalog: fullSurvey.show_in_catalog || false,
        steps: fullSurvey.steps || [],
      });
      setView('edit');
      navigate(`/admin/surveys/${survey.id}/edit`, { replace: true });
    } catch (e) {
      console.error('Load survey error:', e);
      alert('Erro ao carregar pesquisa');
    }
  }; 

  // ==================== STEP EDITOR ====================
  const openStepModal = (stepIndex = null) => {
    if (stepIndex !== null) {
      // Edit existing step
      const step = form.steps[stepIndex];
      // Determine if filter is by category or individual
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const hasCategories = (step.platform_filter || []).some(f => !uuidPattern.test(String(f)));
      setEditingStep(stepIndex);
      setStepForm({
        step_type: step.step_type,
        title: step.title || '',
        description: step.description || '',
        is_required: step.is_required !== false,
        question_type: step.question_type || 'single',
        options: step.options || [],
        content: step.content || '',
        image_url: step.image_url || '',
        platform_filter: step.platform_filter || [],
        platform_filter_mode: hasCategories ? 'category' : 'individual',
        branch_sim: step.branch_sim != null ? step.branch_sim : (step.branch_sim_step != null ? String(step.branch_sim_step) : ''),
        branch_nao: step.branch_nao != null ? step.branch_nao : (step.branch_nao_step != null ? String(step.branch_nao_step) : ''),
        id: step.id || null,
      });
    } else {
      // New step
      setEditingStep(null);
      setStepForm({
        step_type: 'info',
        title: '',
        description: '',
        is_required: true,
        question_type: 'single',
        options: [],
        content: '',
        image_url: '',
        platform_filter: [],
        platform_filter_mode: 'individual',
        id: null,
      });
    }
    setShowStepModal(true);
  };

  const saveStep = () => {
    if (!stepForm.title.trim()) {
      alert('Título é obrigatório');
      return;
    }

    if (stepForm.step_type === 'question' && stepForm.question_type !== 'yes_no' && stepForm.question_type !== 'text_input' && stepForm.question_type !== 'rating_star' && stepForm.options.length === 0) {
      alert('Adicione pelo menos uma opção de resposta');
      return;
    }

    const newSteps = [...form.steps];
    const stepData = {
      ...stepForm,
      id: stepForm.id || `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      step_number: editingStep !== null ? editingStep + 1 : newSteps.length + 1,
    };

    if (editingStep !== null) {
      newSteps[editingStep] = stepData;
    } else {
      newSteps.push(stepData);
    }

    // Re-number steps
    newSteps.forEach((s, i) => { s.step_number = i + 1; });

    setForm({ ...form, steps: newSteps });
    setShowStepModal(false);
  };

  const removeStep = (index) => {
    const newSteps = form.steps.filter((_, i) => i !== index);
    newSteps.forEach((s, i) => { s.step_number = i + 1; });
    setForm({ ...form, steps: newSteps });
  };

  const moveStep = (from, to) => {
    if (to < 0 || to >= form.steps.length) return;
    const newSteps = [...form.steps];
    const [item] = newSteps.splice(from, 1);
    newSteps.splice(to, 0, item);
    newSteps.forEach((s, i) => { s.step_number = i + 1; });
    setForm({ ...form, steps: newSteps });
  };

  // ==================== OPTIONS EDITOR ====================
  const addOption = () => {
    const idx = stepForm.options.length;
    setStepForm({
      ...stepForm,
      options: [...stepForm.options, { label: '', value: `opt_${idx}` }],
    });
  };

  const updateOption = (index, field, value) => {
    const newOptions = [...stepForm.options];
    newOptions[index] = { ...newOptions[index], [field]: value };
    if (field === 'label') {
      newOptions[index].value = value
        ? `opt_${index}_${value.toLowerCase().replace(/\s+/g, '_')}`
        : `opt_${index}`;
    }
    setStepForm({ ...stepForm, options: newOptions });
  };

  const removeOption = (index) => {
    setStepForm({ ...stepForm, options: stepForm.options.filter((_, i) => i !== index) });
  };

  const togglePlatformFilter = (platformId) => {
    const current = stepForm.platform_filter || [];
    if (current.includes(platformId)) {
      setStepForm({ ...stepForm, platform_filter: current.filter(id => id !== platformId) });
    } else {
      setStepForm({ ...stepForm, platform_filter: [...current, platformId] });
    }
  };

  // ==================== SAVE SURVEY ====================
  const handleSave = async () => {
    if (!form.title.trim()) {
      alert('Título é obrigatório');
      return;
    }

    setSaving(true);
    try {
      const stepsToSave = form.steps.map((step, i) => {
        const resolveBranchStep = (val) => {
          if (!val || val === '') return null;
          if (val === '__end__') return 0; // 0 = finalizar pesquisa
          const num = parseInt(val, 10);
          return isNaN(num) ? null : num;
        };
        return {
          step_number: i + 1,
          step_type: step.step_type,
          title: step.title,
          description: step.description || null,
          is_required: step.is_required !== false,
          question_type: step.question_type || null,
          options: step.options || [],
          content: step.content || null,
          image_url: step.image_url || null,
          platform_filter: step.platform_filter || [],
          branch_sim_step: resolveBranchStep(step.branch_sim),
          branch_nao_step: resolveBranchStep(step.branch_nao),
          id: step.id || null,
        };
      });

      const upsertSteps = async (surveyId) => {
        if (stepsToSave.length === 0) return;

        const { data: existingSteps } = await supabase
          .from('survey_steps').select('id').eq('survey_id', surveyId);
        const existingIds = new Set((existingSteps || []).map(s => s.id));

        const toUpdate = [];
        const toInsert = [];
        for (const s of stepsToSave) {
          const row = {
            survey_id: surveyId,
            step_number: s.step_number,
            step_type: s.step_type,
            title: s.title,
            description: s.description,
            is_required: s.is_required,
            question_type: s.question_type,
            options: s.options,
            content: s.content,
            image_url: s.image_url,
            platform_filter: s.platform_filter,
            branch_sim_step: s.branch_sim_step,
            branch_nao_step: s.branch_nao_step,
          };
          if (s.id && existingIds.has(s.id)) {
            toUpdate.push({ ...row, id: s.id });
          } else {
            toInsert.push(row);
          }
        }

        for (const row of toUpdate) {
          await supabase.from('survey_steps').update(row).eq('id', row.id);
        }
        if (toInsert.length > 0) {
          await supabase.from('survey_steps').insert(toInsert);
        }

        const currentIds = new Set(stepsToSave.filter(s => s.id && existingIds.has(s.id)).map(s => s.id));
        for (const es of (existingSteps || [])) {
          if (!currentIds.has(es.id)) {
            await supabase.from('survey_steps').delete().eq('id', es.id);
          }
        }
      };

      if (editingSurvey) {
        await supabase
          .from('surveys')
          .update({
            title: form.title,
            description: form.description,
            slug: form.slug || null,
            is_active: form.is_active,
            show_in_catalog: form.show_in_catalog || false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingSurvey.id);

        await upsertSteps(editingSurvey.id);
      } else {
        const { data: newSurvey, error: createError } = await supabase
          .from('surveys')
          .insert({
            title: form.title,
            description: form.description,
            slug: form.slug || null,
            is_active: form.is_active !== false,
            show_in_catalog: form.show_in_catalog || false,
          })
          .select()
          .single();

        if (createError) throw createError;
        await upsertSteps(newSurvey.id);
      }

      setLoading(true);
      try {
        const surveysData = await supabase.from('surveys').select('*').order('created_at', { ascending: false });
        if (surveysData.data) {
          const surveyIds = surveysData.data.map(s => s.id);
          let countMap = {};
          if (surveyIds.length > 0) {
            const { data: counts } = await supabase
              .from('survey_responses')
              .select('survey_id')
              .in('survey_id', surveyIds);
            (counts || []).forEach(r => {
              countMap[r.survey_id] = (countMap[r.survey_id] || 0) + 1;
            });
          }
          setSurveys(surveysData.data.map(s => ({ ...s, response_count: countMap[s.id] || 0 })));
        }
      } catch (e) {
        console.error('Reload error:', e);
      }
      setLoading(false);

      setView('list');
      setSuccessMsg('Pesquisa salva com sucesso!');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (e) {
      console.error('Save error:', e);
      alert('Erro ao salvar: ' + e.message);
    }
    setSaving(false);
  };

  const getSurveyLink = (slug) => `${window.location.origin}/pesquisa/${slug}`;

  // ==================== LIST VIEW ====================
  if (view === 'list') {
    return (
      <div className="admin-layout">
        <div className="admin-content">
          <div className="admin-header">
            <div className="admin-header-left">
              <BarChart3 size={28} className="admin-icon" />
              <h1>Pesquisas</h1>
            </div>
            <button className="add-btn" onClick={startCreate}>
              <Plus size={20} />
              Nova Pesquisa
            </button>
          </div>

          {successMsg && (
            <div className="success-banner">
              <CheckCircle size={18} />
              {successMsg}
            </div>
          )}

          {loading ? (
            <div className="admin-loading">
              <Loader2 size={32} className="spin" />
              <p>Carregando pesquisas...</p>
            </div>
          ) : surveys.length === 0 ? (
            <div className="admin-empty">
              <BarChart3 size={48} />
              <h3>Nenhuma pesquisa criada</h3>
              <p>Crie sua primeira pesquisa para coletar dados dos usuários.</p>
              <button className="add-btn" onClick={startCreate}>
                <Plus size={20} /> Criar Pesquisa
              </button>
            </div>
          ) : (
            <div className="surveys-grid">
              {surveys.map(survey => (
                <div key={survey.id} className="survey-card">
                  <div className="survey-card-header">
                    <div className="survey-card-title">
                      <h3>{survey.title}</h3>
                      <span className={`status-dot ${survey.is_active ? 'active' : 'inactive'}`} />
                    </div>
                    <div className="survey-card-actions">
                      <button
                        className="icon-btn"
                        onClick={() => handleToggleActive(survey.id, survey.is_active)}
                        title={survey.is_active ? 'Desativar' : 'Ativar'}
                      >
                        {survey.is_active ? <Eye size={16} /> : <EyeOff size={16} />}
                      </button>
                      <button className="icon-btn" onClick={() => startEdit(survey)} title="Editar">
                        <Edit2 size={16} />
                      </button>
                      <button className="icon-btn danger" onClick={() => handleDelete(survey.id)} title="Excluir">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {survey.description && (
                    <p className="survey-card-desc">{survey.description}</p>
                  )}

                  <div className="survey-card-meta">
                    <span className="meta-item">
                      <FileText size={14} />
                      {survey.response_count || 0} respostas
                    </span>
                    <span className="meta-item">
                      <List size={14} />
                      {survey.slug}
                    </span>
                  </div>

                  <div className="survey-card-link">
                    <LinkIcon size={14} />
                    <span className="link-text">{getSurveyLink(survey.slug)}</span>
                    <button
                      className="copy-btn"
                      onClick={() => handleCopyLink(survey.slug)}
                    >
                      {copiedSlug === survey.slug ? <CheckCircle size={14} /> : <Copy size={14} />}
                    </button>
                  </div>

                  <div className="survey-card-footer">
                    <button
                      className="results-btn"
                      onClick={() => navigate(`/admin/surveys/${survey.id}/results`)}
                    >
                      <BarChart3 size={14} /> Ver Resultados
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==================== EDIT STEPS FULL-SCREEN VIEW ====================
  if (view === 'editSteps') {
    return (
      <div className="admin-layout">
        <div className="admin-content steps-editor-page">
          <div className="admin-header">
            <div className="admin-header-left">
              <button className="back-btn" onClick={() => setView(editingSurvey ? 'edit' : 'create')}>
                <ArrowLeft size={20} />
              </button>
              <h1>Etapas da Pesquisa</h1>
              {autoSaving && <span className="auto-save-badge"><Loader2 size={12} className="spin" /> Salvando...</span>}
              {!autoSaving && <span className="auto-save-badge saved"><CheckCircle size={12} /> Salvo</span>}
            </div>
            <button className="add-step-btn" onClick={() => openStepModal()}>
              <Plus size={16} /> Nova Etapa
            </button>
          </div>

          <div className="steps-editor-list">
            {form.steps.length === 0 ? (
              <div className="empty-steps">
                <FileText size={48} />
                <h3>Nenhuma etapa ainda</h3>
                <p>Adicione etapas para construir sua pesquisa.</p>
                <button className="add-step-btn" onClick={() => openStepModal()}>
                  <Plus size={16} /> Adicionar Primeira Etapa
                </button>
              </div>
            ) : (
              <div className="steps-list-full">
                {form.steps.map((step, index) => (
                  <div key={index} className="step-card-full">
                    <div className="step-card-header">
                      <div className="step-number">{index + 1}</div>
                      <div className="step-info">
                        <span className={`step-type-badge ${step.step_type}`}>
                          {step.step_type === 'info' ? 'Informação' :
                           step.step_type === 'platforms' ? 'Plataformas' :
                           step.question_type === 'rating_star' ? '⭐ Estrelas' :
                           step.question_type === 'text_input' ? '📝 Texto' :
                           'Pergunta'}
                        </span>
                        <h4>{step.title}</h4>
                      </div>
                      <div className="step-actions">
                        <button className="icon-btn" onClick={() => moveStep(index, index - 1)} disabled={index === 0} title="Mover para cima">
                          <ChevronUp size={14} />
                        </button>
                        <button className="icon-btn" onClick={() => moveStep(index, index + 1)} disabled={index === form.steps.length - 1} title="Mover para baixo">
                          <ChevronDown size={14} />
                        </button>
                        <button className="icon-btn" onClick={() => openStepModal(index)} title="Editar">
                          <Edit2 size={14} />
                        </button>
                        <button className="icon-btn danger" onClick={() => removeStep(index)} title="Remover">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {step.step_type === 'info' && step.content && (
                      <p className="step-preview">{step.content.substring(0, 200)}...</p>
                    )}

                    {step.step_type === 'question' && (
                      <div className="step-options-preview">
                        {step.options?.map((opt, i) => (
                          <span key={i} className="option-chip">{opt.label}</span>
                        ))}
                      </div>
                    )}

                    {step.question_type === 'yes_no' && (step.branch_sim_step || step.branch_nao_step || step.branch_sim || step.branch_nao) && (
                      <div className="step-branch-preview">
                        <GitBranch size={12} />
                        {step.branch_sim_step ? <span className="branch-sim-preview">Sim → Etapa {step.branch_sim_step}</span> :
                         step.branch_sim && <span className="branch-sim-preview">Sim → Etapa {form.steps.findIndex(s => s.id === step.branch_sim) + 1 || '?'}</span>}
                        {step.branch_nao_step ? <span className="branch-nao-preview">Não → Etapa {step.branch_nao_step}</span> :
                         step.branch_nao && <span className="branch-nao-preview">Não → Etapa {form.steps.findIndex(s => s.id === step.branch_nao) + 1 || '?'}</span>}
                      </div>
                    )}

                    {step.step_type === 'platforms' && (
                      <div className="step-platforms-preview">
                        {(() => {
                          const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                          const hasCategories = (step.platform_filter || []).some(f => !uuidPattern.test(String(f)));
                          if (step.platform_filter?.length === 0) {
                            return <span className="platform-chip" style={{ borderColor: '#a855f7' }}>Todas as plataformas</span>;
                          }
                          if (hasCategories) {
                            return step.platform_filter.map(catVal => {
                              const catObj = CATEGORIES.find(c => c.value === catVal);
                              return catObj ? <span key={catVal} className="platform-chip" style={{ borderColor: '#a855f7' }}>{catObj.label}</span> : null;
                            });
                          }
                          return step.platform_filter.map(pid => {
                            const plat = platforms.find(p => p.id === pid || p.id === Number(pid));
                            return plat ? (
                              <span key={pid} className="platform-chip" style={{ borderColor: plat.color }}>
                                {plat.icon_url && <img src={plat.icon_url} alt="" />}
                                {plat.name}
                              </span>
                            ) : null;
                          });
                        })()}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={stepsEndRef} />
              </div>
            )}
          </div>

          {/* INLINE STEP EDITOR */}
          {showStepModal && (
            <div className="step-inline-editor">
              <div className="inline-editor-header">
                <h3>{editingStep !== null ? 'Editar Etapa' : 'Nova Etapa'}</h3>
                <button className="close-btn" onClick={() => setShowStepModal(false)}>
                  <X size={18} />
                </button>
              </div>

              <div className="inline-editor-body">
                <div className="form-group">
                  <label>Tipo da Etapa *</label>
                  <div className="type-selector">
                    <button className={`type-btn ${stepForm.step_type === 'info' ? 'active' : ''}`} onClick={() => setStepForm({ ...stepForm, step_type: 'info' })}>
                      <FileText size={16} /> Informação
                    </button>
                    <button className={`type-btn ${stepForm.step_type === 'question' ? 'active' : ''}`} onClick={() => setStepForm({ ...stepForm, step_type: 'question' })}>
                      <List size={16} /> Pergunta
                    </button>
                    <button className={`type-btn ${stepForm.step_type === 'platforms' ? 'active' : ''}`} onClick={() => setStepForm({ ...stepForm, step_type: 'platforms' })}>
                      <Monitor size={16} /> Plataformas
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label>Título da Etapa *</label>
                  <input type="text" value={stepForm.title} onChange={(e) => setStepForm({ ...stepForm, title: e.target.value })}
                    placeholder={stepForm.step_type === 'info' ? 'Ex: Bem-vindo à nossa pesquisa' : stepForm.step_type === 'platforms' ? 'Ex: Quais plataformas você utiliza?' : 'Ex: Qual sua idade?'} />
                </div>

                <div className="form-group">
                  <label>Descrição (opcional)</label>
                  <input type="text" value={stepForm.description} onChange={(e) => setStepForm({ ...stepForm, description: e.target.value })} placeholder="Contexto adicional para esta etapa" />
                </div>

                {stepForm.step_type === 'info' && (
                  <>
                    <div className="form-group">
                      <label>Conteúdo *</label>
                      <textarea value={stepForm.content} onChange={(e) => setStepForm({ ...stepForm, content: e.target.value })} placeholder="Texto que o usuário irá ler." rows={6} />
                    </div>
                    <div className="form-group">
                      <label>URL da Imagem (opcional)</label>
                      <input type="url" value={stepForm.image_url} onChange={(e) => setStepForm({ ...stepForm, image_url: e.target.value })} placeholder="https://..." />
                    </div>
                  </>
                )}

                {stepForm.step_type === 'question' && (
                  <>
                    <div className="form-group">
                      <label>Tipo de Resposta *</label>
                      <div className="type-selector">
                        <button className={`type-btn small ${stepForm.question_type === 'single' ? 'active' : ''}`} onClick={() => setStepForm({ ...stepForm, question_type: 'single' })}>Escolha Única</button>
                        <button className={`type-btn small ${stepForm.question_type === 'multiple' ? 'active' : ''}`} onClick={() => setStepForm({ ...stepForm, question_type: 'multiple' })}>Múltipla Escolha</button>
                        <button className={`type-btn small ${stepForm.question_type === 'yes_no' ? 'active' : ''}`} onClick={() => setStepForm({ ...stepForm, question_type: 'yes_no' })}>Sim / Não</button>
                        <button className={`type-btn small ${stepForm.question_type === 'text_input' ? 'active' : ''}`} onClick={() => setStepForm({ ...stepForm, question_type: 'text_input', options: [] })}>Resposta Livre</button>
                        <button className={`type-btn small ${stepForm.question_type === 'rating_star' ? 'active' : ''}`} onClick={() => setStepForm({ ...stepForm, question_type: 'rating_star', options: [] })}>⭐ Estrelas</button>
                      </div>
                    </div>

                    {stepForm.question_type === 'yes_no' && (
                      <div className="branch-selector">
                        <label>Ramificação Condicional</label>
                        <p style={{ fontSize: '0.8rem', color: '#9ca3af', margin: '0 0 0.75rem' }}>Para onde ir dependendo da resposta do usuário:</p>
                        <div className="branch-options">
                          <div className="branch-option">
                            <span className="branch-label branch-sim">Se SIM</span>
                            <select className="branch-select" value={stepForm.branch_sim || ''} onChange={(e) => setStepForm({ ...stepForm, branch_sim: e.target.value })}>
                              <option value="">Próxima etapa (padrão)</option>
                              <option value="__end__">Finalizar pesquisa</option>
                              {form.steps.map((s, i) => {
                                if (i === editingStep) return null;
                                return (
                                  <option key={i} value={String(i + 1)}>Etapa {i + 1}: {s.title || 'Sem título'}</option>
                                );
                              })}
                            </select>
                          </div>
                          <div className="branch-option">
                            <span className="branch-label branch-nao">Se NÃO</span>
                            <select className="branch-select" value={stepForm.branch_nao || ''} onChange={(e) => setStepForm({ ...stepForm, branch_nao: e.target.value })}>
                              <option value="">Próxima etapa (padrão)</option>
                              <option value="__end__">Finalizar pesquisa</option>
                              {form.steps.map((s, i) => {
                                if (i === editingStep) return null;
                                return (
                                  <option key={i} value={String(i + 1)}>Etapa {i + 1}: {s.title || 'Sem título'}</option>
                                );
                              })}
                            </select>
                          </div>
                        </div>
                      </div>
                    )}

                    {stepForm.question_type !== 'yes_no' && stepForm.question_type !== 'text_input' && (
                      <div className="form-group">
                        <label>Opções de Resposta *</label>
                        <div className="options-editor">
                          {stepForm.options.map((opt, i) => (
                            <div key={i} className="option-row">
                              <input type="text" value={opt.label} onChange={(e) => updateOption(i, 'label', e.target.value)} placeholder="Texto da opção" className="option-input" />
                              <button className="icon-btn danger" onClick={() => removeOption(i)}><Trash2 size={14} /></button>
                            </div>
                          ))}
                          <button className="add-option-btn" onClick={addOption}><Plus size={14} /> Adicionar Opção</button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {stepForm.step_type === 'platforms' && (
                  <>
                    <div className="form-group">
                      <label>Modo de Seleção *</label>
                      <div className="type-selector">
                        <button className={`type-btn small ${stepForm.platform_filter_mode === 'individual' ? 'active' : ''}`} onClick={() => setStepForm({ ...stepForm, platform_filter_mode: 'individual', platform_filter: [] })}>
                          <Monitor size={14} /> Por Plataforma
                        </button>
                        <button className={`type-btn small ${stepForm.platform_filter_mode === 'category' ? 'active' : ''}`} onClick={() => setStepForm({ ...stepForm, platform_filter_mode: 'category', platform_filter: [] })}>
                          <Layers size={14} /> Por Categoria
                        </button>
                      </div>
                    </div>

                    {stepForm.platform_filter_mode === 'individual' ? (
                      <div className="form-group">
                        <label>Plataformas</label>
                        <p className="help-text">Se nada for selecionado, TODAS as plataformas serão mostradas.</p>
                        <div className="platforms-grid">
                          {platforms.map(p => (
                            <div key={p.id} className={`platform-select-card ${(stepForm.platform_filter || []).includes(p.id) ? 'selected' : ''} ${p.pinned ? 'card-pinned' : ''} ${p.featured ? 'card-featured' : ''}`} onClick={() => togglePlatformFilter(p.id)}>
                              <div className="platform-select-icon" style={{ background: p.color || '#4F46E5' }}>
                                {p.icon_url ? <img src={p.icon_url} alt={p.name} /> : <span>{p.name?.[0]}</span>}
                              </div>
                              <span className="platform-select-name">{p.name}{p.featured && <span className="featured-star">⭐</span>}</span>
                              <CheckCircle size={16} className={`check-icon ${(stepForm.platform_filter || []).includes(p.id) ? 'visible' : ''}`} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="form-group">
                        <label>Categorias</label>
                        <p className="help-text">Se nada for selecionado, TODAS as categorias serão mostradas.</p>
                        <div className="platforms-grid">
                          {CATEGORIES.map(cat => (
                            <div key={cat.value} className={`platform-select-card ${(stepForm.platform_filter || []).includes(cat.value) ? 'selected' : ''}`} onClick={() => togglePlatformFilter(cat.value)}>
                              <div className="platform-select-icon category-icon"><Layers size={16} /></div>
                              <span className="platform-select-name">{cat.label}</span>
                              <CheckCircle size={16} className={`check-icon ${(stepForm.platform_filter || []).includes(cat.value) ? 'visible' : ''}`} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div className="form-group">
                  <label className="checkbox-label">
                    <input type="checkbox" checked={stepForm.is_required} onChange={(e) => setStepForm({ ...stepForm, is_required: e.target.checked })} />
                    Obrigatório (avançar somente respondendo)
                  </label>
                </div>
              </div>

              <div className="inline-editor-footer">
                <button className="cancel-btn" onClick={() => setShowStepModal(false)}>Cancelar</button>
                <button className="save-btn" onClick={saveStep}>
                  {editingStep !== null ? 'Salvar Etapa' : 'Adicionar Etapa'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==================== CREATE/EDIT VIEW ====================
  return (
    <div className="admin-layout">
      <div className="admin-content">
        <div className="admin-header">
          <div className="admin-header-left">
            <button className="back-btn" onClick={() => { navigate('/admin/surveys'); setView('list'); }}>
              <ArrowLeft size={20} />
            </button>
            <h1>{editingSurvey ? 'Editar Pesquisa' : 'Nova Pesquisa'}</h1>
            {autoSaving && <span className="auto-save-badge"><Loader2 size={12} className="spin" /> Salvando automaticamente...</span>}
            {!autoSaving && view !== 'list' && form.title.trim() && <span className="auto-save-badge saved"><CheckCircle size={12} /> Salvo</span>}
          </div>
          <button className="save-btn" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>

        <div className="survey-form">
          {/* Basic Info */}
          <div className="form-section">
            <h2>Informações Básicas</h2>
            <div className="form-grid">
              <div className="form-group full-width">
                <label>Título *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Ex: Pesquisa de Satisfação"
                />
              </div>
              <div className="form-group full-width">
                <label>Descrição</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Breve descrição da pesquisa"
                  rows={2}
                />
              </div>
              <div className="form-group">
                <label>Slug (URL)</label>
                <div className="slug-input-group">
                  <span className="slug-prefix">/pesquisa/</span>
                  <input
                    type="text"
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    placeholder="auto-gerado"
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Status</label>
                <div className="toggle-group">
                  <button
                    type="button"
                    className={`toggle-btn ${form.is_active ? 'active' : ''}`}
                    onClick={() => setForm({ ...form, is_active: !form.is_active })}
                  >
                    {form.is_active ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                    {form.is_active ? 'Ativa' : 'Inativa'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Steps Summary */}
          <div className="form-section">
            <div className="section-header">
              <h2>Etapas da Pesquisa ({form.steps.length})</h2>
              <button className="add-step-btn" onClick={() => setView('editSteps')}>
                <Edit2 size={16} /> Editar Etapas
              </button>
            </div>

            {form.steps.length === 0 ? (
              <div className="empty-steps">
                <FileText size={32} />
                <p>Nenhuma etapa adicionada. Clique em "Editar Etapas" para começar.</p>
              </div>
            ) : (
              <div className="steps-summary">
                {form.steps.map((step, index) => (
                  <div key={index} className="step-summary-row">
                    <span className="step-number">{index + 1}</span>
                    <span className={`step-type-badge ${step.step_type}`}>
                      {step.step_type === 'info' ? 'Info' :
                       step.step_type === 'platforms' ? 'Plat' :
                       step.question_type === 'rating_star' ? '⭐' :
                       step.question_type === 'text_input' ? '📝' :
                       step.question_type === 'yes_no' ? 'S/N' :
                       'Perg'}
                    </span>
                    <span className="step-summary-title">{step.title}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="steps-edit-cta">
              <button className="edit-steps-btn" onClick={() => setView('editSteps')}>
                <Edit2 size={16} /> Editar Etapas ({form.steps.length})
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Surveys;
