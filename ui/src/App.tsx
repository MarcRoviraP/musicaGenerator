import { useState, useEffect } from 'react';
import './index.css';
import ChooseFeed from './pages/ChooseFeed';

const API_BASE = '/api/magiclight-user';
const SERVER_BASE = '/api/magiclight-server';
const MAIL_API_BASE = '/api/mailtm';

type Job = {
  id: string;
  prompt: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  subStatus: string;
  refreshToken?: string;
  musicIds?: string[];
  tracks?: { id: string; url: string; cover: string; title: string }[];
  error?: string;
  styleId?: number;
};

export default function App() {
  const [currentPath, setCurrentPath] = useState<string>(() => window.location.pathname);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
  };

  const [jobs, setJobs] = useState<Job[]>([
    { id: 'initial-1', prompt: '', status: 'idle', subStatus: '' }
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [basePrompt, setBasePrompt] = useState('');
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
  const [variationCount, setVariationCount] = useState<number>(10);
  const [stylesList, setStylesList] = useState<any[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(import.meta.env.VITE_GROQ_MODEL || '');
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const fetchGroqModels = async (): Promise<string[]> => {
    const apiKey = import.meta.env.VITE_GROQ_KEY;
    if (!apiKey) {
      console.warn('VITE_GROQ_KEY is missing');
      return [];
    }
    setIsLoadingModels(true);
    try {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      if (!res.ok) {
        throw new Error(`Groq API models error (${res.status})`);
      }
      const data = await res.json();
      const models = (data.data || [])
        .filter((m: any) => {
          if (m.active === false) return false;
          const id = (m.id || '').toLowerCase();
          if (id.includes('whisper') || id.includes('guard') || id.includes('embed') || id.includes('canopy')) return false;
          if (Array.isArray(m.output_modalities) && !m.output_modalities.includes('text')) return false;
          return true;
        })
        .map((m: any) => m.id as string);

      setAvailableModels(models);

      if (models.length > 0) {
        setSelectedModel(current => {
          if (current && models.includes(current)) return current;
          return models[0];
        });
      }
      return models;
    } catch (err: any) {
      console.error('Error fetching Groq models:', err);
      return [];
    } finally {
      setIsLoadingModels(false);
    }
  };

  const generateVariations = async () => {
    if (!basePrompt.trim()) return;
    setIsGeneratingPrompts(true);
    try {
      let modelToUse = selectedModel;
      if (!modelToUse) {
        const fetched = await fetchGroqModels();
        modelToUse = fetched[0] || 'openai/gpt-oss-20b';
        if (!modelToUse) {
          throw new Error('No se pudieron obtener modelos disponibles de Groq. Verifica tu VITE_GROQ_KEY.');
        }
      }

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_GROQ_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: modelToUse,
          messages: [{ 
            role: 'system', 
            content: `You are an elite music producer and prompt engineer for AI audio generation.
Generate ${variationCount} distinct, production-ready prompt variations based on the user's idea.
CRITICAL FOR AUDIO QUALITY:
- Do NOT output vague sentences. Use structured production descriptors: [Tempo: X BPM] [Key: X] [Instruments: X] [Vocals: X] [Mood: X].
- Ensure high sonic contrast: vary tempos, musical keys (major/minor), instrumentation, and vocal timbres across each variation.
- Available styles:
${stylesList.map(s => `ID: ${s.musicStyleId}, Name: ${s.styleName}, Desc: ${s.prompt}`).join('\n')}
Pick the most suitable styleId for each prompt variation from the available styles.

Output ONLY a valid JSON object with a single key "variations" containing an array of ${variationCount} objects, each with "prompt" (string) and "styleId" (number). Do not include markdown blocks or any other text.` 
          }, { 
            role: 'user', 
            content: `Generate ${variationCount} different detailed prompt variations based on this idea: "${basePrompt}"` 
          }]
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Groq API error (${res.status}): ${errText}`);
      }

      const data = await res.json();
      const content = data.choices[0].message.content;
      const parsed = JSON.parse(content);
      
      if (parsed.variations && Array.isArray(parsed.variations)) {
        const newJobs = parsed.variations.map((v: any) => ({
          id: Math.random().toString(36).substring(7),
          prompt: v.prompt || v,
          styleId: v.styleId || 8,
          status: 'idle',
          subStatus: ''
        }));
        setJobs(newJobs);
      }
    } catch (err: any) {
      console.error('Error generating variations:', err.message || err);
      alert('Error al generar variaciones: ' + (err.message || 'Revisa la consola.'));
    } finally {
      setIsGeneratingPrompts(false);
    }
  };

  const addPrompt = () => {
    setJobs(prev => [...prev, { id: Math.random().toString(36).substring(7), prompt: '', styleId: 8, status: 'idle', subStatus: '' }]);
  };

  const removePrompt = (id: string) => {
    setJobs(prev => prev.filter(j => j.id !== id));
  };

  const updateJobPrompt = (id: string, text: string) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, prompt: text } : j));
  };

  const updateJobState = (id: string, updates: Partial<Job>) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, ...updates } : j));
  };

  const runJob = async (job: Job) => {
    updateJobState(job.id, { status: 'running', subStatus: 'Buscando dominio...', error: '' });
    
    let success = false;
    let attempt = 1;

    while (!success) {
      try {
        // 1 & 2. Create Account with Mail.tm
        updateJobState(job.id, { subStatus: `Intento ${attempt}: Creando email temporal...` });
        
        const domRes = await fetch(`${MAIL_API_BASE}/domains`);
        const domData = await domRes.json();
        const domain = domData['hydra:member'][0].domain;

        const randomStr = Math.random().toString(36).substring(2, 10);
        const email = `${randomStr}@${domain}`;
        const password = `${randomStr}123!`;
        
        const accRes = await fetch(`${MAIL_API_BASE}/accounts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: email, password })
        });
        if (!accRes.ok) throw new Error('Error al crear email en Mail.tm');

        const tokenRes = await fetch(`${MAIL_API_BASE}/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: email, password })
        });
        const { token: mailToken } = await tokenRes.json();

        // 4. Send SMS Code
        updateJobState(job.id, { subStatus: 'Solicitando código a MagicLight...' });
        const reqRes = await fetch(`${API_BASE}/send-sms-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: email, captchaCode: "", method: "signup", type: "email", inviteCode: " ", bdVid: "" })
        });
        if (!reqRes.ok) throw new Error('Error al enviar SMS');

        // 5. Poll for Email
        updateJobState(job.id, { subStatus: 'Esperando código (10-20s)...' });
        let code = '';
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 3000));
          const msgRes = await fetch(`${MAIL_API_BASE}/messages`, {
            headers: { 'Authorization': `Bearer ${mailToken}` }
          });
          if (!msgRes.ok) continue;
          const msgData = await msgRes.json();
          const messages = msgData['hydra:member'];
          
          if (messages && messages.length > 0) {
            const msgId = messages[0].id;
            const msgDetailRes = await fetch(`${MAIL_API_BASE}/messages/${msgId}`, {
              headers: { 'Authorization': `Bearer ${mailToken}` }
            });
            const msgDetail = await msgDetailRes.json();
            const text = msgDetail.text || msgDetail.html || msgDetail.intro || '';
            
            const match = text.match(/\b\d{4,6}\b/);
            if (match) { code = match[0]; break; }
          }
        }
        if (!code) throw new Error('Timeout esperando código');

        // 6. Signup
        updateJobState(job.id, { subStatus: 'Registrando cuenta de IA...' });
        const signupRes = await fetch(`${API_BASE}/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: "u_" + randomStr, password: password, confirm: password, phoneOrEmail: email, code, affiliation: " ", bdVid: "" })
        });
        if (!signupRes.ok) throw new Error('Error registrando usuario');

        // 7. Signin
        updateJobState(job.id, { subStatus: 'Iniciando sesión...' });
        const signinRes = await fetch(`${API_BASE}/signin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: email, password: password })
        });
        const signinData = await signinRes.json();
        if (signinData.code !== 200 || !signinData.data?.refreshToken) throw new Error('Error al loguear');
        const refreshToken = signinData.data.refreshToken;

        // 8. Generate Music
        updateJobState(job.id, { subStatus: 'Generando canción...', refreshToken });
        const createRes = await fetch(`${SERVER_BASE}/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${refreshToken}` },
          body: JSON.stringify({ prompt: job.prompt, style: job.styleId || 8 })
        });
        const createData = await createRes.json();
        if (createData.biz_code !== 10000 || !createData.data?.musicIds) throw new Error('Error en generación musical (sin créditos?)');
        
        updateJobState(job.id, { musicIds: createData.data.musicIds });
        success = true;

      } catch (err: any) {
        attempt++;
        updateJobState(job.id, { status: 'error', error: `${err.message} - Reintentando en 5s...`, subStatus: '' });
        await new Promise(r => setTimeout(r, 5000));
        updateJobState(job.id, { status: 'running', subStatus: 'Reiniciando proceso...', error: '' });
      }
    }
  };

  const startAll = async () => {
    setIsProcessing(true);
    const activeJobs = jobs.filter(j => j.prompt.trim() !== '');
    if (activeJobs.length === 0) {
      setIsProcessing(false);
      return;
    }
    
    // We launch them with a slight delay between each to avoid blasting the API
    for (let i = 0; i < activeJobs.length; i++) {
      runJob(activeJobs[i]);
      await new Promise(r => setTimeout(r, 1000));
    }
    
    setIsProcessing(false);
  };

  useEffect(() => {
    fetchGroqModels();
    fetch(`${SERVER_BASE}/styles`)
      .then(r => r.json())
      .then(d => {
        if (d.data?.styles) {
          const allowedStyles = [8, 10, 11];
          setStylesList(d.data.styles.filter((s: any) => allowedStyles.includes(s.musicStyleId)));
        }
      })
      .catch(console.error);

    const interval = setInterval(() => {
      setJobs(currentJobs => {
        const generatingJobs = currentJobs.filter(j => j.status === 'running' && j.musicIds && j.musicIds.length > 0);
        
        generatingJobs.forEach(async (job) => {
          try {
            const res = await fetch(`${SERVER_BASE}/list`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${job.refreshToken}` },
              body: JSON.stringify({ musicIds: job.musicIds, page: 1, pageSize: 10 })
            });
            const data = await res.json();
            if (data.biz_code === 10000 && data.data?.data) {
              const tracks = data.data.data;
              const completedTracks = tracks.filter((t: any) => t.audioUrl && t.taskStatus === 0);
              
              if (completedTracks.length === job.musicIds!.length) {
                setJobs(prev => prev.map(j => j.id === job.id ? {
                  ...j,
                  status: 'completed',
                  subStatus: '¡Completado!',
                  tracks: completedTracks.map((t: any) => ({ id: t.musicId, url: t.audioUrl, cover: t.coverUrl, title: t.title }))
                } : j));
              } else {
                setJobs(prev => prev.map(j => j.id === job.id ? { ...j, subStatus: `Renderizando audio... (${completedTracks.length}/${job.musicIds!.length})` } : j));
              }
            }
          } catch (e) { console.error(e); }
        });
        
        return currentJobs;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  if (currentPath === '/choose') {
    return <ChooseFeed onNavigateBack={() => navigate('/')} />;
  }

  return (
    <div className="app-container">
      <nav className="app-navbar">
        <button 
          className={`nav-tab ${currentPath !== '/choose' ? 'active' : ''}`}
          onClick={() => navigate('/')}
        >
          📦 Generador en Lote
        </button>
        <button 
          className={`nav-tab ${currentPath === '/choose' ? 'active' : ''}`}
          onClick={() => navigate('/choose')}
        >
          🎵 Feed TikTok (/choose)
        </button>
      </nav>

      <div className="glass-panel">
        <header className="header-section">
          <div className="badge-pill">
            <span className="badge-dot"></span>
            Generador IA Musical por Lotes
          </div>
          <h1 className="title">Music Generator</h1>
          <p className="subtitle">Crea prompts inteligentes, gestiona variaciones y genera pistas independientes sin límites.</p>
        </header>

        <section className="generator-card">
          <div className="generator-topbar">
            <span className="generator-section-title">
              ✨ Asistente de Prompts
            </span>
            <div className="model-selector-group">
              <label className="model-label">Modelo Groq:</label>
              {isLoadingModels ? (
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Cargando modelos...</span>
              ) : (
                <select
                  value={selectedModel}
                  onChange={e => setSelectedModel(e.target.value)}
                  disabled={isGeneratingPrompts}
                  className="select-control"
                >
                  {availableModels.length === 0 && selectedModel && (
                    <option value={selectedModel}>{selectedModel}</option>
                  )}
                  {availableModels.map(m => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="generator-form-row">
            <textarea 
              value={basePrompt}
              onChange={e => setBasePrompt(e.target.value)}
              placeholder={`Ej: Escribe una idea base para que la IA genere ${variationCount} ${variationCount === 1 ? 'variación musical' : 'variaciones musicales'} con estilos afines...`}
              className="generator-textarea"
            />
            <select
              value={variationCount}
              onChange={e => setVariationCount(Number(e.target.value))}
              disabled={isGeneratingPrompts}
              className="select-control count-select"
            >
              <option value={1}>1 versión</option>
              <option value={2}>2 versiones</option>
              <option value={5}>5 versiones</option>
              <option value={10}>10 versiones</option>
            </select>
            <button 
              onClick={generateVariations}
              disabled={isGeneratingPrompts || !basePrompt.trim()}
              className="btn-generate"
            >
              {isGeneratingPrompts ? 'Generando...' : `✨ Generar ${variationCount} ${variationCount === 1 ? 'Versión' : 'Versiones'}`}
            </button>
          </div>
        </section>

        <div className="jobs-container">
          {jobs.map((job, index) => (
            <div key={job.id} className="job-card">
              <div className="job-header">
                <span className="prompt-badge">Prompt #{index + 1}</span>
                <select 
                  value={job.styleId || 8} 
                  onChange={e => updateJobState(job.id, { styleId: Number(e.target.value) })}
                  disabled={job.status !== 'idle' && job.status !== 'error'}
                  className="select-control job-style-select"
                >
                  {stylesList.map(s => (
                    <option key={s.musicStyleId} value={s.musicStyleId}>
                      {s.styleName}
                    </option>
                  ))}
                </select>
                {jobs.length > 1 && job.status === 'idle' && (
                  <button className="remove-btn" onClick={() => removePrompt(job.id)} title="Eliminar prompt">✕</button>
                )}
              </div>
              
              <textarea 
                value={job.prompt} 
                onChange={e => updateJobPrompt(job.id, e.target.value)} 
                placeholder="Describe los instrumentos, ritmo, vibra musical..." 
                rows={3}
                disabled={job.status !== 'idle' && job.status !== 'error'}
              />

              {job.status === 'running' && (
                <div className="status-indicator">
                  <div className="loader-small"></div>
                  <span>{job.subStatus}</span>
                </div>
              )}

              {job.status === 'error' && (
                <div className="status-indicator error-text">
                  <span>❌ {job.error}</span>
                  <button className="retry-btn" onClick={() => runJob(job)}>Reintentar</button>
                </div>
              )}

              {job.status === 'completed' && job.tracks && (
                <div className="tracks-mini-grid">
                  {job.tracks.map(t => (
                    <div key={t.id} className="track-mini">
                      <img src={t.cover} alt="Cover" className="track-mini-cover" />
                      <div className="track-mini-info">
                        <span className="track-title">{t.title || 'Canción generada'}</span>
                        <audio controls src={t.url} className="audio-player mini-audio"></audio>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <footer className="action-buttons">
          <button className="secondary-btn" onClick={addPrompt} disabled={isProcessing}>
            + Añadir Otro Prompt
          </button>
          <button className="primary-btn" onClick={startAll} disabled={isProcessing || jobs.every(j => j.status !== 'idle' && j.status !== 'error')}>
            {isProcessing ? 'Iniciando Trabajos...' : '🚀 Generar Todas las Canciones'}
          </button>
        </footer>
      </div>
      <div className="ambient-background"></div>
    </div>
  );
}
