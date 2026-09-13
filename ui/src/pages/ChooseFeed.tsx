import { useState, useEffect, useRef } from 'react';
import {
  generateGroqPromptForTikTok,
  createAndPollTrack,
  type GeneratedTrack
} from '../services/musicEngine';

export default function ChooseFeed({ onNavigateBack }: { onNavigateBack: () => void }) {
  const [tracks, setTracks] = useState<GeneratedTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [workerStatus, setWorkerStatus] = useState<string>('Iniciando generador...');
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isGeneratingRef = useRef(false);
  const tracksRef = useRef<GeneratedTrack[]>([]);
  const currentIndexRef = useRef(0);

  // Mantener referencias sincronizadas
  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  // Gestor de cola continua: mantiene al menos 3 pistas por delante
  const checkAndRefillQueue = async () => {
    if (isGeneratingRef.current) return;

    const availableAhead = tracksRef.current.length - currentIndexRef.current;
    if (availableAhead >= 3) return;

    isGeneratingRef.current = true;
    setIsGenerating(true);

    try {
      setWorkerStatus('Consultando prompt a Groq...');
      const { prompt, genre, title, styleId } = await generateGroqPromptForTikTok();
      
      setWorkerStatus(`Creando pista de ${genre} (${title})...`);
      const newTrack = await createAndPollTrack(prompt, styleId, genre, title, (msg) => {
        setWorkerStatus(`[${genre}] ${msg}`);
      });

      setTracks(prev => {
        const next = [...prev, newTrack];
        tracksRef.current = next;
        return next;
      });

      setWorkerStatus('Pista lista en la cola.');
    } catch (err: any) {
      console.error('Error en ciclo de cola TikTok:', err);
      setWorkerStatus(`Error: ${err.message || err}. Reintentando en 6s...`);
      await new Promise(r => setTimeout(r, 6000));
    } finally {
      isGeneratingRef.current = false;
      setIsGenerating(false);
      // Volver a comprobar si se necesita otra pista para alcanzar el mínimo de 3
      const remainingAhead = tracksRef.current.length - currentIndexRef.current;
      if (remainingAhead < 3) {
        checkAndRefillQueue();
      }
    }
  };

  // Arrancar el ciclo de fondo
  useEffect(() => {
    checkAndRefillQueue();
    const interval = setInterval(() => {
      checkAndRefillQueue();
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Manejo de reproducción al cambiar de pista
  const currentTrack = tracks[currentIndex];

  useEffect(() => {
    if (audioRef.current && currentTrack) {
      audioRef.current.src = currentTrack.url;
      audioRef.current.currentTime = 0;
      audioRef.current.play()
        .then(() => setIsPlaying(true))
        .catch(e => {
          console.warn('Autoplay bloqueado por interacción del navegador:', e);
          setIsPlaying(false);
        });
    }
  }, [currentIndex, currentTrack?.url]);

  const handleNext = () => {
    if (currentIndex < tracks.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play()
        .then(() => setIsPlaying(true))
        .catch(console.error);
    }
  };

  const handleDownload = async () => {
    if (!currentTrack) return;
    try {
      const res = await fetch(currentTrack.url);
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      const cleanTitle = (currentTrack.title || currentTrack.genre || 'cancion')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_');
      a.download = `${cleanTitle}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(currentTrack.url, '_blank');
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !audioDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const newRatio = Math.max(0, Math.min(1, clickX / rect.width));
    audioRef.current.currentTime = newRatio * audioDuration;
    setAudioProgress(audioRef.current.currentTime);
  };

  // Controles por teclado: Flecha abajo / Arriba para pasar, Espacio para pausar, D para descargar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleDownload();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, tracks.length, isPlaying, currentTrack]);

  // Manejo de rueda de ratón (gesto vertical tipo TikTok)
  const lastScrollTime = useRef(0);
  const handleWheel = (e: React.WheelEvent) => {
    const now = Date.now();
    if (now - lastScrollTime.current < 600) return;
    if (e.deltaY > 30) {
      lastScrollTime.current = now;
      handleNext();
    } else if (e.deltaY < -30) {
      lastScrollTime.current = now;
      handlePrev();
    }
  };

  // Pantalla de carga inicial si aún no se ha generado la primera canción
  if (tracks.length === 0) {
    return (
      <div className="tiktok-loading-screen">
        <button className="tiktok-back-btn" onClick={onNavigateBack}>
          ← Volver al Generador
        </button>
        <div className="tiktok-loading-card">
          <div className="pulsing-disc">
            <div className="disc-inner">🎵</div>
          </div>
          <h2>Preparando tu Feed de Música</h2>
          <p className="status-text">{workerStatus}</p>
          <div className="tiktok-loader-bar">
            <div className="tiktok-loader-bar-fill"></div>
          </div>
          <p className="hint-text">La IA de Groq está componiendo el prompt y MagicLight generando las primeras pistas...</p>
        </div>
      </div>
    );
  }

  const upcomingCount = tracks.length - 1 - currentIndex;

  return (
    <div className="tiktok-feed-container" onWheel={handleWheel}>
      {/* Fondo ambiental reactivo a la portada */}
      <div 
        className="tiktok-bg-cover" 
        style={{ backgroundImage: `url(${currentTrack?.cover})` }}
      />
      <div className="tiktok-overlay" />

      {/* Barra superior */}
      <header className="tiktok-topbar">
        <button className="tiktok-back-btn" onClick={onNavigateBack}>
          ← Modo Lotes
        </button>
        <div className="tiktok-buffer-badge">
          <span className={`status-dot ${isGenerating ? 'active' : ''}`} />
          <span>{isGenerating ? workerStatus : `En cola: ${upcomingCount} listas`}</span>
        </div>
      </header>

      {/* Contenido principal del track activo */}
      <main className="tiktok-content">
        <div className="tiktok-artwork-container" onClick={togglePlay}>
          <img 
            src={currentTrack.cover} 
            alt={currentTrack.title} 
            className={`tiktok-artwork ${isPlaying ? 'playing' : ''}`}
          />
          {!isPlaying && (
            <div className="tiktok-play-overlay">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 3 20 12 6 21 6 3"/>
              </svg>
            </div>
          )}
          <div className="artwork-glow-ring"></div>
        </div>

        {/* Información limpia de la pista (sin el texto del prompt) */}
        <div className="tiktok-info">
          <div className="tiktok-genre-badge">
            <span className="genre-dot"></span>
            {currentTrack.genre}
          </div>
          <h1 className="tiktok-title">{currentTrack.title}</h1>

          {/* Reproductor con tiempo y barra interactiva */}
          <div className="tiktok-player-controls">
            <div className="tiktok-progress-wrapper" onClick={handleSeek} title="Haz clic para saltar en la canción">
              <div className="tiktok-progress-container">
                <div 
                  className="tiktok-progress-fill" 
                  style={{ width: audioDuration ? `${(audioProgress / audioDuration) * 100}%` : '0%' }}
                />
              </div>
            </div>
            <div className="tiktok-time-readout">
              <span>{formatTime(audioProgress)}</span>
              <span>{formatTime(audioDuration)}</span>
            </div>
          </div>
        </div>

        {/* Acciones laterales estilo TikTok mejoradas */}
        <aside className="tiktok-actions-sidebar">
          <button 
            className="tiktok-action-btn download-btn" 
            onClick={handleDownload}
            title="Descargar MP3 (Tecla D)"
          >
            <span className="action-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </span>
            <span className="action-label">Bajar</span>
            <span className="action-shortcut">D</span>
          </button>

          <button 
            className={`tiktok-action-btn play-btn ${isPlaying ? 'active' : ''}`} 
            onClick={togglePlay}
            title="Pausar / Reanudar (Espacio)"
          >
            <span className="action-icon">
              {isPlaying ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1"/>
                  <rect x="14" y="4" width="4" height="16" rx="1"/>
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6 3 20 12 6 21 6 3"/>
                </svg>
              )}
            </span>
            <span className="action-label">{isPlaying ? 'Pausa' : 'Play'}</span>
            <span className="action-shortcut">Esp</span>
          </button>

          <button 
            className="tiktok-action-btn next-btn" 
            onClick={handleNext}
            disabled={currentIndex >= tracks.length - 1 && isGenerating}
            title="Pasar a la siguiente canción (Flecha Abajo)"
          >
            <span className="action-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 4 15 12 5 20 5 4"/>
                <line x1="19" y1="5" x2="19" y2="19"/>
              </svg>
            </span>
            <span className="action-label">Pasar</span>
            <span className="action-shortcut">↓</span>
          </button>

          {currentIndex > 0 && (
            <button 
              className="tiktok-action-btn prev-btn" 
              onClick={handlePrev}
              title="Canción anterior (Flecha Arriba)"
            >
              <span className="action-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="19 20 9 12 19 4 19 20"/>
                  <line x1="5" y1="19" x2="5" y2="5"/>
                </svg>
              </span>
              <span className="action-label">Atrás</span>
              <span className="action-shortcut">↑</span>
            </button>
          )}
        </aside>
      </main>

      {/* Elemento de audio HTML5 */}
      <audio
        ref={audioRef}
        onEnded={handleNext}
        onTimeUpdate={() => {
          if (audioRef.current) {
            setAudioProgress(audioRef.current.currentTime);
            setAudioDuration(audioRef.current.duration || 0);
          }
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />
    </div>
  );
}
