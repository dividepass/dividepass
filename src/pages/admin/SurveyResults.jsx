import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, BarChart3, Users, CheckCircle, Clock,
  ChevronDown, ChevronUp, Trash2, Download, Loader2
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import './SurveyResults.css';

function SurveyResults() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [survey, setSurvey] = useState(null);
  const [steps, setSteps] = useState([]);
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedResponse, setSelectedResponse] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [allPlatforms, setAllPlatforms] = useState([]);

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [responsesData, stepsData, surveyData, platformsData] = await Promise.all([
        supabase.from('survey_responses').select('*').eq('survey_id', id).order('created_at', { ascending: false }),
        supabase.from('survey_steps').select('*').eq('survey_id', id).order('step_number', { ascending: true }),
        supabase.from('surveys').select('*').eq('id', id).single(),
        supabase.from('streaming_services').select('id, name, icon_url, color').order('name'),
      ]);

      const allPlats = platformsData.data || [];
      setAllPlatforms(allPlats);

      const steps = stepsData.data || [];

      // Resolve platforms for platform-type steps
      for (const step of steps) {
        if (step.step_type === 'platforms') {
          const filter = step.platform_filter || [];
          const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          let platforms = [];

          if (filter.length === 0) {
            const { data: p } = await supabase.from('streaming_services')
              .select('id, name, icon_url, color').order('name');
            platforms = p || [];
          } else {
            const uuids = filter.filter(f => uuidPattern.test(String(f)));
            const cats = filter.filter(f => !uuidPattern.test(String(f)));

            if (uuids.length) {
              const { data: p } = await supabase.from('streaming_services')
                .select('id, name, icon_url, color').in('id', uuids);
              platforms = [...platforms, ...(p || [])];
            }
            if (cats.length) {
              const { data: p } = await supabase.from('streaming_services')
                .select('id, name, icon_url, color').in('category', cats);
              platforms = [...platforms, ...(p || [])];
            }
          }

          const seen = new Set();
          step.platforms = platforms.filter(p => { const d = seen.has(p.id); seen.add(p.id); return !d; });
        }
      }

      setResponses(responsesData.data || []);
      setSteps(steps);
      if (surveyData.data) setSurvey(surveyData.data);
    } catch (e) {
      console.error('Load error:', e);
    }
    setLoading(false);
  };

  const handleDeleteResponse = async (responseId) => {
    if (!confirm('Tem certeza que deseja excluir esta resposta?')) return;
    try {
      await supabase.from('survey_responses').delete().eq('id', responseId);
      setResponses(responses.filter(r => r.id !== responseId));
      setSelectedResponse(null);
    } catch (e) {
      console.error('Delete error:', e);
    }
  };

  // Calculate stats for each question step
  const getStepStats = (step) => {
    const questionSteps = steps.filter(s => s.step_type === 'question' || s.step_type === 'platforms');
    const stepIndex = steps.indexOf(step);
    const totalResponses = responses.length;

    const stats = {
      totalResponses,
      answers: {},
      distribution: [],
    };

    if (step.step_type === 'question') {
      if (step.question_type === 'text_input') {
        // Collect all text responses
        responses.forEach(resp => {
          const answer = resolveAnswer(resp, step);
          if (answer?.value) {
            stats.textResponses = stats.textResponses || [];
            stats.textResponses.push({
              text: answer.value,
              user: resp.respondent_name || 'Anônimo',
              date: resp.created_at,
            });
          }
        });
        return stats;
      }

      if (step.question_type === 'rating_star') {
        const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let totalRating = 0;
        let ratedCount = 0;

        responses.forEach(resp => {
          const answer = resolveAnswer(resp, step);
          if (answer?.value) {
            const val = Number(answer.value);
            if (val >= 1 && val <= 5) {
              ratingCounts[val]++;
              totalRating += val;
              ratedCount++;
            }
          }
        });

        stats.avgRating = ratedCount > 0 ? (totalRating / ratedCount).toFixed(1) : '0.0';
        stats.ratedCount = ratedCount;
        stats.distribution = [5, 4, 3, 2, 1].map(star => ({
          label: `${star} estrela${star > 1 ? 's' : ''}`,
          value: ratingCounts[star],
          percentage: ratedCount > 0
            ? Math.round((ratingCounts[star] / ratedCount) * 100)
            : 0,
        }));
        return stats;
      }

      // Count answers for each option
      const allOptions = step.question_type === 'yes_no'
        ? [{ label: 'Sim', value: 'sim' }, { label: 'Não', value: 'nao' }]
        : (step.options || []);

      allOptions.forEach(opt => {
        stats.answers[opt.value] = 0;
      });

      responses.forEach(resp => {
        const answer = resolveAnswer(resp, step);
        if (answer) {
          if (step.question_type === 'multiple' && Array.isArray(answer.value)) {
            answer.value.forEach(v => {
              stats.answers[v] = (stats.answers[v] || 0) + 1;
            });
          } else {
            const val = answer.value;
            stats.answers[val] = (stats.answers[val] || 0) + 1;
          }
        }
      });

      stats.distribution = allOptions.map(opt => ({
        label: opt.label,
        value: stats.answers[opt.value] || 0,
        percentage: totalResponses > 0
          ? Math.round(((stats.answers[opt.value] || 0) / totalResponses) * 100)
          : 0,
      })).sort((a, b) => b.value - a.value);
    } else if (step.step_type === 'platforms') {
      // Count platform selections
      (step.platforms || []).forEach(p => {
        stats.answers[p.id] = 0;
      });

      responses.forEach(resp => {
        const answer = resolveAnswer(resp, step);
        if (answer) {
          const vals = Array.isArray(answer.value) ? answer.value : [answer.value];
          vals.forEach(v => {
            const strId = String(v);
            stats.answers[strId] = (stats.answers[strId] || 0) + 1;
          });
        }
      });

      stats.distribution = (step.platforms || []).map(p => ({
        label: p.name,
        icon: p.icon_url,
        color: p.color,
        value: stats.answers[p.id] || 0,
        percentage: totalResponses > 0
          ? Math.round(((stats.answers[p.id] || 0) / totalResponses) * 100)
          : 0,
      })).sort((a, b) => b.value - a.value);
    }

    return stats;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isCompatibleAnswer = (answer, step) => {
    if (!answer || answer.value == null || answer.value === '') return false;
    if (step.step_type === 'info') return false;

    if (step.step_type === 'question') {
      switch (step.question_type) {
        case 'yes_no':
          return answer.value === 'sim' || answer.value === 'nao' || answer.value === 'não';
        case 'rating_star': {
          const n = Number(answer.value);
          return Number.isInteger(n) && n >= 1 && n <= 5;
        }
        case 'multiple':
          return Array.isArray(answer.value);
        case 'single': {
          if (answer.value == null) return false;
          if (typeof answer.value !== 'string' && typeof answer.value !== 'number') return false;
          const opts = step.options || [];
          if (opts.length === 0) return true;
          const answerStr = String(answer.value).toLowerCase();
          return opts.some(o =>
            String(o.value).toLowerCase() === answerStr ||
            String(o.label || '').toLowerCase() === answerStr
          );
        }
        case 'text_input':
          return typeof answer.value === 'string' && !Array.isArray(answer.value);
        default:
          return false;
      }
    }

    if (step.step_type === 'platforms') {
      return Array.isArray(answer.value) && answer.value.length > 0;
    }

    return false;
  };

  const computeAnswerMap = (resp) => {
    const entries = Object.entries(resp.answers || {});
    if (entries.length === 0) return new Map();

    const map = new Map();
    const usedKeys = new Set();

    for (const step of steps) {
      if (step.step_type === 'info') continue;
      const key = String(step.step_number);
      if (resp.answers?.[key] && isCompatibleAnswer(resp.answers[key], step)) {
        map.set(step.id, resp.answers[key]);
        usedKeys.add(key);
      }
    }

    const unresolvedSteps = steps.filter(s => s.step_type !== 'info' && !map.has(s.id));
    for (const step of unresolvedSteps) {
      if (resp.answers?.[step.id] && isCompatibleAnswer(resp.answers[step.id], step)) {
        map.set(step.id, resp.answers[step.id]);
        usedKeys.add(step.id);
      }
    }

    const stillUnresolved = steps.filter(s => s.step_type !== 'info' && !map.has(s.id));
    const unusedEntries = entries.filter(([k]) => !usedKeys.has(k));
    for (const step of stillUnresolved) {
      for (const [key, answer] of unusedEntries) {
        if (usedKeys.has(key)) continue;
        if (!isCompatibleAnswer(answer, step)) continue;
        map.set(step.id, answer);
        usedKeys.add(key);
        break;
      }
    }

    return map;
  };

  const resolveAnswer = (resp, step) => {
    if (!resp._computedMap) {
      resp._computedMap = computeAnswerMap(resp);
    }
    return resp._computedMap.get(step.id) || null;
  };

  const resolvePlatformName = (id) => {
    const strId = String(id);
    const p = allPlatforms.find(pl => String(pl.id) === strId);
    return p?.name || strId;
  };

  const formatDisplayValue = (answer, step) => {
    if (!answer) return '—';

    if (step.step_type === 'question') {
      if (step.question_type === 'yes_no') {
        return answer.value === 'sim' ? 'Sim' : 'Não';
      }
      if (step.question_type === 'text_input') {
        return answer.value || '—';
      }
      if (step.question_type === 'rating_star') {
        const stars = Number(answer.value) || 0;
        return '★'.repeat(stars) + '☆'.repeat(5 - stars) + ` (${stars}/5)`;
      }
      if (step.question_type === 'multiple') {
        const vals = Array.isArray(answer.value) ? answer.value : [answer.value];
        return vals.map(v => {
          const opt = (step.options || []).find(o => o.value === v || String(o.value) === String(v));
          return opt?.label || resolvePlatformName(v);
        }).join(', ');
      }
      if (step.question_type === 'single') {
        const opt = (step.options || []).find(o => String(o.value) === String(answer.value));
        return opt?.label || answer.label || String(answer.value);
      }
    }

    if (step.step_type === 'platforms') {
      const vals = Array.isArray(answer.value) ? answer.value : [answer.value];
      return vals.map(v => resolvePlatformName(v)).join(', ');
    }

    return answer.label || String(answer.value);
  };

  if (loading) {
    return (
      <div className="admin-layout">
        <div className="admin-content">
          <div className="admin-loading">
            <Loader2 size={32} className="spin" />
            <p>Carregando resultados...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!survey) {
    return (
      <div className="admin-layout">
        <div className="admin-content">
          <div className="admin-empty">
            <BarChart3 size={48} />
            <h3>Pesquisa não encontrada</h3>
            <button className="back-btn" onClick={() => navigate('/admin/surveys')}>
              <ArrowLeft size={16} /> Voltar
            </button>
          </div>
        </div>
      </div>
    );
  }

  const completedCount = responses.filter(r => r.completed_at).length;

  return (
    <div className="admin-layout">
      <div className="admin-content">
        <div className="admin-page-wrap">
          <div className="admin-header">
            <div className="admin-header-left">
              <button className="back-btn" onClick={() => navigate('/admin/surveys')}>
                <ArrowLeft size={20} />
              </button>
              <div>
                <h1>{survey.title}</h1>
                <span className="header-subtitle">
                  {responses.length} resposta(s) • {completedCount} completa(s)
                </span>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="results-tabs">
            <button
              className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              <BarChart3 size={16} /> Visão Geral
            </button>
            <button
              className={`tab-btn ${activeTab === 'responses' ? 'active' : ''}`}
              onClick={() => setActiveTab('responses')}
            >
              <Users size={16} /> Respostas Individuais
            </button>
          </div>

          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="results-overview">
            {/* Summary Cards */}
            <div className="summary-cards">
              <div className="summary-card">
                <div className="summary-icon" style={{ background: 'rgba(79, 70, 229, 0.15)' }}>
                  <Users size={20} color="#818cf8" />
                </div>
                <div>
                  <span className="summary-value">{responses.length}</span>
                  <span className="summary-label">Total de Respostas</span>
                </div>
              </div>
              <div className="summary-card">
                <div className="summary-icon" style={{ background: 'rgba(16, 185, 129, 0.15)' }}>
                  <CheckCircle size={20} color="#10b981" />
                </div>
                <div>
                  <span className="summary-value">{completedCount}</span>
                  <span className="summary-label">Completaram</span>
                </div>
              </div>
              <div className="summary-card">
                <div className="summary-icon" style={{ background: 'rgba(234, 88, 12, 0.15)' }}>
                  <Clock size={20} color="#fb923c" />
                </div>
                <div>
                  <span className="summary-value">
                    {responses.length > 0
                      ? Math.round((completedCount / responses.length) * 100)
                      : 0}%
                  </span>
                  <span className="summary-label">Taxa de Conclusão</span>
                </div>
              </div>
            </div>

            {/* Charts per question */}
            <div className="charts-section">
              <h2>Resultados por Pergunta</h2>
              {steps.filter(s => s.step_type === 'question' || s.step_type === 'platforms').length === 0 ? (
                <div className="no-charts">
                  <BarChart3 size={32} />
                  <p>Nenhuma pergunta para exibir gráficos.</p>
                </div>
              ) : (
                steps
                  .filter(s => s.step_type === 'question' || s.step_type === 'platforms')
                  .map(step => {
                    const stats = getStepStats(step);
                    return (
                      <div key={step.id} className="chart-card">
                        <div className="chart-header">
                          <span className={`step-type-badge ${step.step_type}`}>
                            {step.step_type === 'platforms' ? 'Plataformas' : step.question_type === 'text_input' ? 'Texto Livre' : step.question_type === 'rating_star' ? '⭐ Avaliação' : 'Pergunta'}
                          </span>
                          <h3>{step.title}</h3>
                          <span className="chart-total">{stats.totalResponses} resposta(s)</span>
                        </div>

                        {step.question_type === 'rating_star' ? (
                          <div className="rating-results">
                            <div className="rating-avg">
                              <span className="rating-avg-number">{stats.avgRating}</span>
                              <div className="rating-avg-stars">
                                {[1, 2, 3, 4, 5].map(s => (
                                  <span key={s} className={`rating-result-star ${s <= Math.round(Number(stats.avgRating)) ? 'filled' : ''}`}>★</span>
                                ))}
                              </div>
                              <span className="rating-avg-count">{stats.ratedCount} avaliação(ões)</span>
                            </div>
                            <div className="chart-bars">
                              {stats.distribution.map((item, i) => (
                                <div key={i} className="bar-row">
                                  <div className="bar-label">
                                    <span>{item.label}</span>
                                  </div>
                                  <div className="bar-track">
                                    <div className="bar-fill" style={{ width: `${item.percentage}%`, background: '#FBBF24' }} />
                                  </div>
                                  <span className="bar-count">{item.value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : step.question_type === 'text_input' ? (
                          <div className="text-responses-list">
                            {(stats.textResponses || []).length === 0 ? (
                              <p style={{ color: '#9ca3af', fontSize: '0.85rem' }}>Nenhuma resposta de texto.</p>
                            ) : (
                              (stats.textResponses || []).map((r, i) => (
                                <div key={i} className="text-response-item">
                                  <div className="text-response-avatar">{r.user[0]?.toUpperCase()}</div>
                                  <div className="text-response-content">
                                    <span className="text-response-user">{r.user}</span>
                                    <p className="text-response-text">{r.text}</p>
                                    <span className="text-response-date">{r.date ? new Date(r.date).toLocaleString('pt-BR') : ''}</span>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        ) : (
                        <div className="chart-bars">
                          {stats.distribution.map((item, i) => (
                            <div key={i} className="bar-row">
                              <div className="bar-label">
                                {item.icon && <img src={item.icon} alt="" className="bar-icon" />}
                                <span>{item.label}</span>
                              </div>
                              <div className="bar-track">
                                <div
                                  className="bar-fill"
                                  style={{
                                    width: `${item.percentage}%`,
                                    background: item.color || '#4F46E5',
                                  }}
                                />
                              </div>
                              <div className="bar-value">
                                <span className="bar-count">{item.value}</span>
                                <span className="bar-pct">{item.percentage}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        )}
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        )}

        {/* Individual Responses Tab */}
        {activeTab === 'responses' && (
          <div className="responses-section">
            {responses.length === 0 ? (
              <div className="admin-empty">
                <Users size={48} />
                <h3>Nenhuma resposta ainda</h3>
                <p>Compartilhe o link da pesquisa para começar a coletar dados.</p>
              </div>
            ) : (
              <div className="responses-list">
                {responses.map(resp => (
                  <div key={resp.id} className="response-card">
                    <div
                      className="response-header"
                      onClick={() => setSelectedResponse(
                        selectedResponse?.id === resp.id ? null : resp
                      )}
                    >
                      <div className="response-info">
                        <div className="response-avatar">
                          {(resp.respondent_name || '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <strong>{resp.respondent_name}</strong>
                          <span className="response-meta">
                            {resp.respondent_email || 'Sem email'} • {formatDate(resp.created_at)}
                          </span>
                        </div>
                      </div>
                      <div className="response-actions">
                        <button
                          className="icon-btn danger"
                          onClick={(e) => { e.stopPropagation(); handleDeleteResponse(resp.id); }}
                          title="Excluir"
                        >
                          <Trash2 size={14} />
                        </button>
                        {selectedResponse?.id === resp.id
                          ? <ChevronUp size={16} />
                          : <ChevronDown size={16} />
                        }
                      </div>
                    </div>

                    {selectedResponse?.id === resp.id && (
                      <div className="response-details">
                        {steps.map(step => {
                          const answer = resolveAnswer(resp, step);
                          if (step.step_type === 'info') return null;
                          const displayValue = formatDisplayValue(answer, step);

                          return (
                            <div key={step.id} className="answer-row">
                              <span className="answer-label">{step.title}</span>
                              <span className="answer-value">{displayValue}</span>
                            </div>
                          );
                        })}

                        {resp.respondent_phone && (
                          <div className="answer-row">
                            <span className="answer-label">Telefone</span>
                            <span className="answer-value">{resp.respondent_phone}</span>
                          </div>
                        )}
                        {resp.respondent_whatsapp && (
                          <div className="answer-row">
                            <span className="answer-label">WhatsApp</span>
                            <span className="answer-value">{resp.respondent_whatsapp}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

export default SurveyResults;
