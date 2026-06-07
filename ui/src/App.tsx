import { useState, useEffect } from 'react';
import './index.css';

const API_BASE = 'https://api.magiclight.ai/api/user';
const SERVER_BASE = 'https://server.magiclight.ai/task-schedule/music';

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [step, setStep] = useState<'start' | 'auto-login' | 'generate' | 'generating' | 'result'>('start');
  const [autoLoginProgress, setAutoLoginProgress] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [musicIds, setMusicIds] = useState<string[]>([]);
  const [audioUrls, setAudioUrls] = useState<{ id: string; url: string; cover: string; title: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAutoLogin = async () => {
    setStep('auto-login');
    setLoading(true);
    setError('');
    try {
      // 1. Get Domains
      setAutoLoginProgress('Buscando dominios de correo...');
      const domRes = await fetch('https://api.mail.tm/domains');
      const domData = await domRes.json();
      if (!domData['hydra:member'] || domData['hydra:member'].length === 0) {
        throw new Error('No hay dominios disponibles en Mail.tm');
      }
      const domain = domData['hydra:member'][0].domain;

      // 2. Create Account
      setAutoLoginProgress('Creando cuenta temporal...');
      const randomStr = Math.random().toString(36).substring(2, 10);
      const email = `${randomStr}@${domain}`;
      const password = `${randomStr}123!`;
      
      const accRes = await fetch('https://api.mail.tm/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: email, password })
      });
      if (!accRes.ok) throw new Error('Error al crear la cuenta de correo');

      // 3. Get Token
      const tokenRes = await fetch('https://api.mail.tm/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: email, password })
      });
      const { token: mailToken } = await tokenRes.json();
      if (!mailToken) throw new Error('Error al obtener el token del correo');

      // 4. Send SMS Code via MagicLight
      setAutoLoginProgress('Solicitando código de verificación...');
      const reqRes = await fetch(`${API_BASE}/send-sms-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: email, captchaCode: "", method: "signup", type: "email", inviteCode: " ", bdVid: "" })
      });
      if (!reqRes.ok) throw new Error('Error al solicitar el código a MagicLight');

      // 5. Poll for Email
      setAutoLoginProgress('Esperando correo (puede tardar 10-20s)...');
      let code = '';
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const msgRes = await fetch('https://api.mail.tm/messages', {
          headers: { 'Authorization': `Bearer ${mailToken}` }
        });
        const msgData = await msgRes.json();
        const messages = msgData['hydra:member'];
        
        if (messages && messages.length > 0) {
          const msgId = messages[0].id;
          const msgDetailRes = await fetch(`https://api.mail.tm/messages/${msgId}`, {
            headers: { 'Authorization': `Bearer ${mailToken}` }
          });
          const msgDetail = await msgDetailRes.json();
          const text = msgDetail.text || msgDetail.html || msgDetail.intro || '';
          
          // Match 6 digit code or 4 digit code usually sent by these APIs
          const match = text.match(/\b\d{4,6}\b/);
          if (match) {
            code = match[0];
            break;
          }
        }
      }

      if (!code) throw new Error('El código de verificación no llegó a tiempo.');

      // 6. Signup to MagicLight
      setAutoLoginProgress('Código recibido! Registrando usuario...');
      const signupRes = await fetch(`${API_BASE}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: "u_" + randomStr, password: `${email}1`, confirm: `${email}1`, phoneOrEmail: email, code, affiliation: " ", bdVid: "" })
      });
      if (!signupRes.ok) throw new Error('Error al registrar usuario en MagicLight');

      // 7. Signin to MagicLight
      setAutoLoginProgress('Iniciando sesión...');
      const signinRes = await fetch(`${API_BASE}/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: email, password: `${email}1` })
      });
      const signinData = await signinRes.json();
      if (signinData.code !== 200 || !signinData.data?.refreshToken) {
        throw new Error('Error al iniciar sesión en MagicLight');
      }
      
      setRefreshToken(signinData.data.refreshToken);
      setStep('generate');
    } catch (err: any) {
      setError(err.message || 'Error en el login automático');
      setStep('start');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${SERVER_BASE}/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${refreshToken}`
        },
        body: JSON.stringify({ prompt, style: 8 })
      });
      const data = await res.json();
      if (data.biz_code !== 10000 || !data.data?.musicIds) {
        throw new Error('Error al crear la música');
      }
      setMusicIds(data.data.musicIds);
      setStep('generating');
    } catch (err: any) {
      setError(err.message || 'Error en la generación');
      setLoading(false);
    }
  };

  useEffect(() => {
    if (step === 'generating' && musicIds.length > 0) {
      let interval: ReturnType<typeof setInterval>;

      const checkStatus = async () => {
        try {
          const res = await fetch(`${SERVER_BASE}/list`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${refreshToken}`
            },
            body: JSON.stringify({ musicIds, page: 1, pageSize: 2 })
          });
          const data = await res.json();
          if (data.biz_code === 10000 && data.data?.data) {
            const tracks = data.data.data;
            const completedTracks = tracks.filter((t: any) => t.audioUrl && t.taskStatus === 0);
            
            if (completedTracks.length === musicIds.length) {
              setAudioUrls(completedTracks.map((t: any) => ({
                id: t.musicId,
                url: t.audioUrl,
                cover: t.coverUrl,
                title: t.title
              })));
              setStep('result');
              setLoading(false);
              clearInterval(interval);
            }
          }
        } catch (err) {
          console.error(err);
        }
      };

      interval = setInterval(checkStatus, 5000);
      checkStatus(); // Initial check

      return () => clearInterval(interval);
    }
  }, [step, musicIds, refreshToken]);

  return (
    <div className="app-container">
      <div className="glass-panel">
        <h1 className="title">MusicGen</h1>
        <p className="subtitle">AI Music Creation Portal</p>

        {error && <div className="error-message">{error}</div>}

        {step === 'start' && (
          <div className="form-group" style={{ textAlign: 'center' }}>
            <p style={{ marginBottom: '1rem', color: 'var(--text-muted)' }}>
              Accede directamente sin necesidad de correos. Generaremos una cuenta temporal y validaremos el acceso por vos de forma automática.
            </p>
            <button onClick={handleAutoLogin} disabled={loading}>
              Iniciar Acceso Automático
            </button>
          </div>
        )}

        {step === 'auto-login' && (
          <div className="generating-state">
            <div className="spinner-large"></div>
            <h3>Autenticando...</h3>
            <p>{autoLoginProgress}</p>
          </div>
        )}

        {step === 'generate' && (
          <form onSubmit={handleGenerate} className="form-group">
            <label>Music Prompt</label>
            <textarea 
              value={prompt} 
              onChange={e => setPrompt(e.target.value)} 
              placeholder="A fast-paced synthwave track with heavy bass..." 
              rows={4}
              required 
            />
            <button type="submit" disabled={loading}>
              {loading ? <span className="loader"></span> : 'Generate Tracks'}
            </button>
          </form>
        )}

        {step === 'generating' && (
          <div className="generating-state">
            <div className="spinner-large"></div>
            <h3>Generating your music...</h3>
            <p>This may take a few minutes. Please wait.</p>
          </div>
        )}

        {step === 'result' && (
          <div className="results-container">
            <h3>Your Generated Tracks</h3>
            <div className="tracks-grid">
              {audioUrls.map((track) => (
                <div key={track.id} className="track-card">
                  <div className="track-image" style={{ backgroundImage: `url(${track.cover})` }}></div>
                  <div className="track-info">
                    <h4>{track.title || 'Untitled Track'}</h4>
                    <audio controls src={track.url} className="audio-player">
                      Your browser does not support the audio element.
                    </audio>
                  </div>
                </div>
              ))}
            </div>
            <button className="secondary-btn" onClick={() => { setStep('generate'); setPrompt(''); }}>
              Create More
            </button>
          </div>
        )}
      </div>
      <div className="ambient-background"></div>
    </div>
  );
}
