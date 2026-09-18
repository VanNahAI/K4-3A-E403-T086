const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');

const PORT = 3197;
const CLIENT_ID = 'zoom-app-test-client';
const CLIENT_SECRET = 'zoom-app-test-secret';

function encryptContext(payload) {
  const iv = crypto.randomBytes(12);
  const aad = Buffer.from('zoom-app-context-test');
  const key = crypto.createHash('sha256').update(CLIENT_SECRET).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const cipherText = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  const ivLength = Buffer.from([iv.length]);
  const aadLength = Buffer.alloc(2);
  aadLength.writeUInt16LE(aad.length);
  const cipherLength = Buffer.alloc(4);
  cipherLength.writeUInt32LE(cipherText.length);
  return Buffer.concat([ivLength, iv, aadLength, aad, cipherLength, cipherText, tag]).toString('base64url');
}

function requestJson(path, method = 'GET', body, token) {
  const serialized = body ? JSON.stringify(body) : '';
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      path,
      method,
      headers: {
        ...(serialized ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(serialized)
        } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }, res => {
      let responseBody = '';
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        let json = {};
        try { json = responseBody ? JSON.parse(responseBody) : {}; } catch (error) {}
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (serialized) req.write(serialized);
    req.end();
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await requestJson('/api/health');
      if (response.status === 200) return;
    } catch (error) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Test server không khởi động.');
}

async function run() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: require('path').join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      LECTURER_ACCESS_TOKEN: 'fallback-test-token',
      ZOOM_OAUTH_CLIENT_ID: CLIENT_ID,
      ZOOM_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
      ZOOM_WEBHOOK_SECRET_TOKEN: 'webhook-test-secret',
      ZOOM_MEETING_URL: 'https://zoom.us/j/123456789',
      ENABLE_SIMULATION: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer();
    const baseContext = {
      typ: 'meeting',
      uid: 'zoom-host-user',
      mid: 'zoom-meeting-uuid',
      attendrole: 'host',
      iss: 'marketplace.zoom.us',
      aud: CLIENT_ID,
      ts: Date.now(),
      exp: Date.now() + 5 * 60 * 1000
    };
    const bootstrap = await requestJson('/api/zoom/bootstrap', 'POST', {
      context: encryptContext(baseContext)
    });
    const started = await requestJson('/api/session/start', 'POST', null, bootstrap.body.token);
    const participant = await requestJson('/api/zoom/bootstrap', 'POST', {
      context: encryptContext({ ...baseContext, attendrole: 'participant' })
    });
    const tamperedContext = encryptContext(baseContext).slice(0, -2) + 'aa';
    const tampered = await requestJson('/api/zoom/bootstrap', 'POST', { context: tamperedContext });

    const cases = {
      hostContextAccepted: bootstrap.status === 200 && Boolean(bootstrap.body.token),
      issuedTokenStartsSession: started.status === 200 && started.body.session?.isOpen === true,
      participantRejected: participant.status === 403,
      tamperedContextRejected: tampered.status === 401
    };
    Object.entries(cases).forEach(([name, passed]) => {
      console.log(`${name}: ${passed ? '✅ ĐẠT' : '❌ LỖI'}`);
    });
    if (Object.values(cases).some(passed => !passed)) process.exitCode = 1;
  } finally {
    server.kill('SIGTERM');
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
