export interface GeneratedTrack {
  id: string;
  musicId: string;
  url: string;
  cover: string;
  title: string;
  prompt: string;
  genre: string;
  styleId: number;
  createdAt: number;
}

const API_BASE = '/api/magiclight-user';
const SERVER_BASE = '/api/magiclight-server';
const MAIL_API_BASE = '/api/mailtm';

export async function fetchActiveGroqModel(apiKey?: string): Promise<string> {
  const key = apiKey || import.meta.env.VITE_GROQ_KEY;
  if (!key) return 'openai/gpt-oss-20b';
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) return 'openai/gpt-oss-20b';
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

    return models[0] || 'openai/gpt-oss-20b';
  } catch {
    return 'openai/gpt-oss-20b';
  }
}

export interface MagicLightStyleRef {
  id: number;
  name: string;
  desc: string;
}

export const KNOWN_MAGICLIGHT_STYLES: MagicLightStyleRef[] = [
  { id: 8, name: 'Modern Pop', desc: 'Modern mainstream pop, catchy synth leads, tight radio-ready groove, punchy kick' },
  { id: 10, name: 'Rock', desc: 'Modern energetic rock band, electric guitars, punchy drums, driving bass' },
];

export async function generateGroqPromptForTikTok(modelName?: string): Promise<{ prompt: string; genre: string; title: string; styleId: number }> {
  const apiKey = import.meta.env.VITE_GROQ_KEY;
  if (!apiKey) {
    throw new Error('VITE_GROQ_KEY no configurada');
  }

  const model = modelName || await fetchActiveGroqModel(apiKey);
  const targetStyle = KNOWN_MAGICLIGHT_STYLES[Math.floor(Math.random() * KNOWN_MAGICLIGHT_STYLES.length)];

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: 350,
      messages: [
        {
          role: 'system',
          content: `You are an elite music producer and sound engineer. Your task is to output a single production-ready music prompt for an AI audio model that supports specific styles.
CRITICAL FORMAT RULES:
1. Output ONLY a valid raw JSON object with NO markdown, NO code fences, and NO conversational text.
2. The JSON object must contain exactly:
   - "genre": string (must be "${targetStyle.name}")
   - "styleId": number (must be ${targetStyle.id})
   - "title": string (catchy, creative song title in Spanish)
   - "prompt": string (structured audio production prompt under 280 characters using tags: [Tempo: ... BPM] [Key: ...] [Instruments: ...] [Vocals: ...] [Mood: ...], with vocal style and lyrics direction in Spanish)
3. Ensure high acoustic variety: alternate tempos, diverse instruments (e.g. 808s, Rhodes, overdriven guitars, analog synths), and dynamic vocal timbres.`
        },
        {
          role: 'user',
          content: `Compose a high-quality music production prompt for the style "${targetStyle.name}" (Audio profile: ${targetStyle.desc}). Make it sonically distinct, rich in instrumentation, and with Spanish vocal direction.`
        }
      ]
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const rawContent = data.choices[0]?.message?.content || '{}';
  const cleanContent = rawContent.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  let parsed: any = {};
  try {
    parsed = JSON.parse(cleanContent);
  } catch {
    console.warn('Failed to parse Groq JSON response, using fallback');
  }

  return {
    prompt: parsed.prompt || `[Style: ${targetStyle.name}] [Tempo: 120 BPM] [Instruments: Synths, Drums, Bass] [Vocals: Voz en español con melodía pegadiza]`,
    genre: parsed.genre || targetStyle.name,
    title: parsed.title || `${targetStyle.name} Español`,
    styleId: Number(parsed.styleId) || targetStyle.id
  };
}

export async function createAndPollTrack(
  prompt: string,
  styleId: number,
  genre: string,
  title: string,
  onStatus?: (status: string) => void
): Promise<GeneratedTrack> {
  const update = (msg: string) => onStatus?.(msg);

  // 1. Obtener dominio de Mail.tm
  update('Obteniendo dominio temporal...');
  const domRes = await fetch(`${MAIL_API_BASE}/domains`);
  if (!domRes.ok) throw new Error('Error al conectar con Mail.tm domains');
  const domData = await domRes.json();
  const domain = domData['hydra:member']?.[0]?.domain;
  if (!domain) throw new Error('No se encontró dominio disponible en Mail.tm');

  const randomStr = Math.random().toString(36).substring(2, 10);
  const email = `${randomStr}@${domain}`;
  const password = `${randomStr}123!`;

  // 2. Crear cuenta Mail.tm
  update('Creando buzón temporal...');
  const accRes = await fetch(`${MAIL_API_BASE}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: email, password })
  });
  if (!accRes.ok) throw new Error('Error al crear cuenta en Mail.tm');

  // 3. Obtener token Mail.tm
  const tokenRes = await fetch(`${MAIL_API_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: email, password })
  });
  if (!tokenRes.ok) throw new Error('Error de autenticación en Mail.tm');
  const { token: mailToken } = await tokenRes.json();

  // 4. Solicitar código MagicLight
  update('Solicitando verificación a MagicLight...');
  const reqRes = await fetch(`${API_BASE}/send-sms-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: email, captchaCode: '', method: 'signup', type: 'email', inviteCode: ' ', bdVid: '' })
  });
  if (!reqRes.ok) throw new Error('Error al solicitar código a MagicLight');

  // 5. Polling para el código
  update('Esperando código en correo...');
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
      const detailRes = await fetch(`${MAIL_API_BASE}/messages/${msgId}`, {
        headers: { 'Authorization': `Bearer ${mailToken}` }
      });
      const detail = await detailRes.json();
      const text = detail.text || detail.html || detail.intro || '';
      const match = text.match(/\b\d{4,6}\b/);
      if (match) {
        code = match[0];
        break;
      }
    }
  }
  if (!code) throw new Error('Timeout esperando código de verificación');

  // 6. Registro
  update('Registrando cuenta MagicLight...');
  const signupRes = await fetch(`${API_BASE}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: `u_${randomStr}`,
      password,
      confirm: password,
      phoneOrEmail: email,
      code,
      affiliation: ' ',
      bdVid: ''
    })
  });
  if (!signupRes.ok) throw new Error('Error al registrar usuario en MagicLight');

  // 7. Login
  update('Autenticando sesión...');
  const signinRes = await fetch(`${API_BASE}/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: email, password })
  });
  const signinData = await signinRes.json();
  if (signinData.code !== 200 || !signinData.data?.refreshToken) {
    throw new Error('Error al iniciar sesión en MagicLight');
  }
  const refreshToken = signinData.data.refreshToken;

  // 8. Crear canción
  update('Generando audio con IA...');
  const createRes = await fetch(`${SERVER_BASE}/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${refreshToken}`
    },
    body: JSON.stringify({ prompt, style: styleId || 8 })
  });
  const createData = await createRes.json();
  if (createData.biz_code !== 10000 || !createData.data?.musicIds || createData.data.musicIds.length === 0) {
    throw new Error('Error en generación musical (sin créditos o cola saturada)');
  }
  const musicIds: string[] = createData.data.musicIds;

  // 9. Polling hasta tener el audio renderizado
  update('Renderizando pista musical...');
  for (let poll = 0; poll < 35; poll++) {
    await new Promise(r => setTimeout(r, 4000));
    try {
      const listRes = await fetch(`${SERVER_BASE}/list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${refreshToken}`
        },
        body: JSON.stringify({ musicIds, page: 1, pageSize: 10 })
      });
      const listData = await listRes.json();
      if (listData.biz_code === 10000 && listData.data?.data) {
        const completed = listData.data.data.find((t: any) => t.audioUrl && t.taskStatus === 0);
        if (completed) {
          return {
            id: Math.random().toString(36).substring(7),
            musicId: completed.musicId,
            url: completed.audioUrl,
            cover: completed.coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=80',
            title: title || completed.title || `${genre} Track`,
            prompt,
            genre,
            styleId,
            createdAt: Date.now()
          };
        }
      }
    } catch {
      // reintentar polling
    }
  }

  throw new Error('Timeout esperando renderizado del audio');
}
