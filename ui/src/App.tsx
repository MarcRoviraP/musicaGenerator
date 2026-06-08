import { useState, useEffect } from 'react';
import './index.css';

const API_BASE = 'https://api.magiclight.ai/api/user';
const SERVER_BASE = 'https://server.magiclight.ai/task-schedule/music';

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
  const [jobs, setJobs] = useState<Job[]>([
    { id: 'initial-1', prompt: '', status: 'idle', subStatus: '' }
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [basePrompt, setBasePrompt] = useState('');
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
  const [stylesList, setStylesList] = useState<any[]>([]);

  const generateVariations = async () => {
    if (!basePrompt.trim()) return;
    setIsGeneratingPrompts(true);
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_GROQ_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [{ 
            role: 'system', 
            content: `You are an AI that writes prompt variations for music generation. Output ONLY a valid JSON object with a single key "variations" containing an array of 10 objects, each with "prompt" (string) and "styleId" (number). Do not include markdown blocks or any other text. Available styles:\n${stylesList.map(s => `ID: ${s.musicStyleId}, Name: ${s.styleName}, Desc: ${s.prompt}`).join('\n')}\nPick the best styleId for each prompt.` 
          }, { 
            role: 'user', 
            content: `Generate 10 different detailed prompt variations based on this idea: "${basePrompt}"` 
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
        // 1. Get Domains
        const domRes = await fetch('https://api.mail.tm/domains');
        const domData = await domRes.json();
        if (!domData['hydra:member'] || domData['hydra:member'].length === 0) throw new Error('No hay dominios');
        const domain = domData['hydra:member'][0].domain;

        // 2. Create Account
        updateJobState(job.id, { subStatus: `Intento ${attempt}: Creando email temporal...` });
        const randomStr = Math.random().toString(36).substring(2, 10);
        const email = `${randomStr}@${domain}`;
        const password = `${randomStr}123!`;
        
        const accRes = await fetch('https://api.mail.tm/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: email, password })
        });
        if (!accRes.ok) throw new Error('Error al crear email');

        // 3. Get Token
        const tokenRes = await fetch('https://api.mail.tm/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: email, password })
        });
        const { token: mailToken } = await tokenRes.json();
        if (!mailToken) throw new Error('Error obteniendo token del correo');

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
          const msgRes = await fetch('https://api.mail.tm/messages', { headers: { 'Authorization': `Bearer ${mailToken}` } });
          const msgData = await msgRes.json();
          const messages = msgData['hydra:member'];
          
          if (messages && messages.length > 0) {
            const msgId = messages[0].id;
            const msgDetailRes = await fetch(`https://api.mail.tm/messages/${msgId}`, { headers: { 'Authorization': `Bearer ${mailToken}` } });
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
          body: JSON.stringify({ displayName: "u_" + randomStr, password: `${email}1`, confirm: `${email}1`, phoneOrEmail: email, code, affiliation: " ", bdVid: "" })
        });
        if (!signupRes.ok) throw new Error('Error registrando usuario');

        // 7. Signin
        updateJobState(job.id, { subStatus: 'Iniciando sesión...' });
        const signinRes = await fetch(`${API_BASE}/signin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: email, password: `${email}1` })
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
    fetch('https://server.magiclight.ai/task-schedule/music/styles')
      .then(r => r.json())
      .then(d => {
        if (d.data?.styles) setStylesList(d.data.styles);
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

  return (
    <div className="app-container">
      <div className="glass-panel">
        <h1 className="title">MusicGen Bulk</h1>
        <p className="subtitle">Genera canciones independientes evadiendo límites</p>

        <div className="generator-header" style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'stretch' }}>
            <textarea 
              value={basePrompt}
              onChange={e => setBasePrompt(e.target.value)}
              placeholder="Ej: Escribe un prompt base para que la IA genere 10 variaciones..."
              style={{ flex: 1, minHeight: '60px' }}
            />
            <button 
              onClick={generateVariations}
              disabled={isGeneratingPrompts || !basePrompt.trim()}
              style={{ padding: '0 2rem', background: 'linear-gradient(135deg, #8a2be2, #38bdf8)' }}
            >
              {isGeneratingPrompts ? 'Generando...' : '✨ Generar 10 Variaciones'}
            </button>
          </div>
        </div>

        <div className="jobs-container">
          {jobs.map((job, index) => (
            <div key={job.id} className="job-card">
              <div className="job-header">
                <h3>Prompt #{index + 1}</h3>
                <select 
                  value={job.styleId || 8} 
                  onChange={e => updateJobState(job.id, { styleId: Number(e.target.value) })}
                  disabled={job.status !== 'idle' && job.status !== 'error'}
                  style={{ marginLeft: '1rem', flex: 1, padding: '0.2rem', borderRadius: '4px', background: 'rgba(0,0,0,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  {stylesList.map(s => (
                    <option key={s.musicStyleId} value={s.musicStyleId}>
                      {s.styleName}
                    </option>
                  ))}
                </select>
                {jobs.length > 1 && job.status === 'idle' && (
                  <button className="remove-btn" onClick={() => removePrompt(job.id)}>✕</button>
                )}
              </div>
              
              <textarea 
                value={job.prompt} 
                onChange={e => updateJobPrompt(job.id, e.target.value)} 
                placeholder="A fast-paced synthwave track..." 
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

        <div className="action-buttons">
          <button className="secondary-btn" onClick={addPrompt} disabled={isProcessing}>
            + Añadir Otro Prompt
          </button>
          <button className="primary-btn" onClick={startAll} disabled={isProcessing || jobs.every(j => j.status !== 'idle' && j.status !== 'error')}>
            {isProcessing ? 'Iniciando Trabajos...' : '🚀 Generar Todas las Canciones'}
          </button>
        </div>
      </div>
      <div className="ambient-background"></div>
    </div>
  );
}
