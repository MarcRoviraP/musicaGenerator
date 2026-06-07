import { useState, useEffect } from 'react';
import './index.css';

const API_BASE = 'https://api.magiclight.ai/api/user';
const SERVER_BASE = 'https://server.magiclight.ai/task-schedule/music';

export default function App() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [prompt, setPrompt] = useState('');
  const [step, setStep] = useState<'email' | 'code' | 'generate' | 'generating' | 'result'>('email');
  const [refreshToken, setRefreshToken] = useState('');
  const [musicIds, setMusicIds] = useState<string[]>([]);
  const [audioUrls, setAudioUrls] = useState<{ id: string; url: string; cover: string; title: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/send-sms-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: email, captchaCode: "", method: "signup", type: "email", inviteCode: " ", bdVid: "" })
      });
      if (!res.ok) throw new Error('Error al enviar el código');
      setStep('code');
    } catch (err: any) {
      setError(err.message || 'Error al enviar código');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      // Signup
      const signupRes = await fetch(`${API_BASE}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: "potrijugnu", password: `${email}1`, confirm: `${email}1`, phoneOrEmail: email, code, affiliation: " ", bdVid: "" })
      });
      if (!signupRes.ok) throw new Error('Error al registrar usuario');

      // Signin
      const signinRes = await fetch(`${API_BASE}/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: email, password: `${email}1` })
      });
      const signinData = await signinRes.json();
      if (signinData.code !== 200 || !signinData.data?.refreshToken) {
        throw new Error('Error al iniciar sesión');
      }
      setRefreshToken(signinData.data.refreshToken);
      setStep('generate');
    } catch (err: any) {
      setError(err.message || 'Error al verificar código');
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

        {step === 'email' && (
          <form onSubmit={handleSendCode} className="form-group">
            <label>Temporary Email</label>
            <input 
              type="email" 
              value={email} 
              onChange={e => setEmail(e.target.value)} 
              placeholder="user@tempmail.com" 
              required 
            />
            <button type="submit" disabled={loading}>
              {loading ? <span className="loader"></span> : 'Send SMS Code'}
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={handleVerifyCode} className="form-group">
            <label>Verification Code</label>
            <input 
              type="text" 
              value={code} 
              onChange={e => setCode(e.target.value)} 
              placeholder="Enter numeric code" 
              required 
            />
            <button type="submit" disabled={loading}>
              {loading ? <span className="loader"></span> : 'Verify & Login'}
            </button>
          </form>
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
