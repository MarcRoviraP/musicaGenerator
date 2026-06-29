// Script para probar el flujo completo de los endpoints (Mail temporal + MagicLight AI)
// Ejecutar con: node test-endpoints.js

const API_BASE = 'https://api.magiclight.ai/api/user';
const SERVER_BASE = 'https://server.magiclight.ai/task-schedule/music';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('🚀 Iniciando test de endpoints...\n');

  try {
    // 1. Crear Email Temporal en Mail.tm
    console.log('1️⃣ Generando email temporal en Mail.tm...');
    const domRes = await fetch('https://api.mail.tm/domains');
    const domData = await domRes.json();
    const domain = domData['hydra:member'][0].domain;

    const randomStr = Math.random().toString(36).substring(2, 10);
    const email = `${randomStr}@${domain}`;
    const password = `${randomStr}123!`;
    
    const accRes = await fetch('https://api.mail.tm/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: email, password })
    });
    if (!accRes.ok) throw new Error('Error al crear la cuenta de correo');

    const tokenRes = await fetch('https://api.mail.tm/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: email, password })
    });
    const { token: mailToken } = await tokenRes.json();
    
    console.log(`✅ Email creado: ${email}`);

    // 2. Solicitar código de verificación
    console.log('\n2️⃣ Solicitando código a MagicLight AI...');
    const reqRes = await fetch(`${API_BASE}/send-sms-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        phone: email, 
        captchaCode: "", 
        method: "signup", 
        type: "email", 
        inviteCode: " ", 
        bdVid: "" 
      })
    });
    const reqData = await reqRes.json();
    console.log(`✅ Solicitud enviada. Respuesta:`, reqData);

    // 3. Esperar y extraer código del correo temporal
    console.log('\n3️⃣ Esperando código de verificación en el correo temporal (polling 10-20s)...');
    let code = '';
    for (let i = 0; i < 15; i++) {
      await delay(3000);
      process.stdout.write('.');
      const msgRes = await fetch('https://api.mail.tm/messages', {
        headers: { 'Authorization': `Bearer ${mailToken}` }
      });
      if (!msgRes.ok) continue;
      
      const msgData = await msgRes.json();
      const messages = msgData['hydra:member'];
      
      if (messages && messages.length > 0) {
        const msgId = messages[0].id;
        const msgDetailRes = await fetch(`https://api.mail.tm/messages/${msgId}`, {
          headers: { 'Authorization': `Bearer ${mailToken}` }
        });
        const msgDetail = await msgDetailRes.json();
        const text = msgDetail.text || msgDetail.html || msgDetail.intro || '';
        
        const match = text.match(/\b\d{4,6}\b/);
        if (match) { 
          code = match[0]; 
          break; 
        }
      }
    }
    
    if (!code) throw new Error('Timeout esperando código');
    console.log(`\n✅ Código recibido: ${code}`);

    // 4. Signup en MagicLight AI
    console.log('\n4️⃣ Registrando cuenta en MagicLight AI...');
    const signupRes = await fetch(`${API_BASE}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        displayName: "u_" + randomStr, 
        password: password, 
        confirm: password, 
        phoneOrEmail: email, 
        code: code, 
        affiliation: " ", 
        bdVid: "" 
      })
    });
    const signupData = await signupRes.json();
    console.log(`✅ Registro completado:`, signupData);

    // 5. Login
    console.log('\n5️⃣ Iniciando sesión...');
    const signinRes = await fetch(`${API_BASE}/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: email, password: password })
    });
    const signinData = await signinRes.json();
    if (signinData.code !== 200 || !signinData.data?.refreshToken) {
      throw new Error('Error al loguear: ' + JSON.stringify(signinData));
    }
    const refreshToken = signinData.data.refreshToken;
    console.log(`✅ Login exitoso. Refresh Token obtenido (truncado): ${refreshToken.substring(0, 15)}...`);

    // 6. Generar Música
    console.log('\n6️⃣ Generando canción de prueba...');
    const createRes = await fetch(`${SERVER_BASE}/create`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${refreshToken}` 
      },
      body: JSON.stringify({ 
        prompt: "A test song with an epic cinematic vibe", 
        style: 8 
      })
    });
    const createData = await createRes.json();
    
    if (createData.biz_code === 10000 && createData.data?.musicIds) {
      console.log(`✅ ¡Éxito! Música generada. IDs:`, createData.data.musicIds);
    } else {
      console.log(`⚠️ Generación falló o requiere créditos:`, createData);
    }

    console.log('\n🎉 Test completado.');

  } catch (err) {
    console.error('\n❌ Error durante el test:', err.message || err);
  }
}

runTest();
