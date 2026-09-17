/**
 * Integration test for the Zoom native meeting chat webhook.
 *
 * Run against a server configured with:
 *   LECTURER_ACCESS_TOKEN=test-lecturer-token
 *   ZOOM_WEBHOOK_SECRET_TOKEN=test-webhook-secret
 *   ZOOM_MEETING_ID=5423481172
 */

const crypto = require('crypto');
const http = require('http');
const WebSocket = require('ws');

const PORT = Number(process.env.TEST_PORT || 3000);
const LECTURER_ACCESS_TOKEN = String(process.env.LECTURER_ACCESS_TOKEN || '').trim();
const WEBHOOK_SECRET = String(process.env.ZOOM_WEBHOOK_SECRET_TOKEN || '').trim();
const MEETING_ID = String(process.env.ZOOM_MEETING_ID || '5423481172').replace(/\D/g, '');

function requestJson(path, method, body, headers = {}) {
  const serialized = body ? JSON.stringify(body) : '';
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      path,
      method,
      headers: {
        ...headers,
        ...(serialized ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(serialized)
        } : {})
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

function signedHeaders(serializedBody) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(`v0:${timestamp}:${serializedBody}`)
    .digest('hex');
  return {
    'x-zm-request-timestamp': timestamp,
    'x-zm-signature': `v0=${signature}`
  };
}

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function waitForQuestion(ws, expectedMessageId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Không nhận được câu hỏi webhook trên lecturer WS.')), 1500);
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.type === 'new_student_question' && message.question?.zoomMessageId === expectedMessageId) {
        clearTimeout(timeout);
        resolve(message);
      }
    });
  });
}

async function run() {
  if (!LECTURER_ACCESS_TOKEN || !WEBHOOK_SECRET) {
    throw new Error('Thiếu LECTURER_ACCESS_TOKEN hoặc ZOOM_WEBHOOK_SECRET_TOKEN.');
  }

  const authHeaders = { Authorization: `Bearer ${LECTURER_ACCESS_TOKEN}` };
  await requestJson('/api/reset-session', 'POST', null, authHeaders);
  const started = await requestJson('/api/session/start', 'POST', null, authHeaders);
  if (started.status !== 200) throw new Error('Không mở được phiên webhook test.');

  const lecturerWs = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  await waitForOpen(lecturerWs);
  lecturerWs.send(JSON.stringify({
    type: 'register_role',
    role: 'lecturer',
    name: 'Giảng viên Webhook Test',
    token: LECTURER_ACCESS_TOKEN
  }));
  await new Promise(resolve => setTimeout(resolve, 100));

  const messageId = `zoom-msg-${Date.now()}`;
  const payload = {
    event: 'meeting.chat_message_sent',
    event_ts: Date.now(),
    payload: {
      object: {
        id: Number(MEETING_ID),
        uuid: 'zoom-test-uuid',
        chat_message: {
          date_time: new Date().toISOString(),
          sender_session_id: 'zoom-session-test',
          sender_name: 'Học viên Zoom Test',
          sender_email: 'student@example.com',
          sender_type: 'guest',
          sender_context: 'meeting',
          recipient_type: 'everyone',
          recipient_context: 'meeting',
          message_id: messageId,
          message_content: 'Lab 02 hôm nay học gì?'
        }
      }
    }
  };
  const serialized = JSON.stringify(payload);
  const questionPromise = waitForQuestion(lecturerWs, messageId);
  const received = await requestJson('/api/zoom/webhook', 'POST', payload, signedHeaders(serialized));
  const lecturerMessage = await questionPromise;

  const duplicate = await requestJson('/api/zoom/webhook', 'POST', payload, signedHeaders(serialized));
  const plainToken = `plain-${Date.now()}`;
  const validationPayload = {
    event: 'endpoint.url_validation',
    event_ts: Date.now(),
    payload: { plainToken }
  };
  const validationSerialized = JSON.stringify(validationPayload);
  const validation = await requestJson(
    '/api/zoom/webhook',
    'POST',
    validationPayload,
    signedHeaders(validationSerialized)
  );
  const expectedEncryptedToken = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(plainToken)
    .digest('hex');
  const invalid = await requestJson(
    '/api/zoom/webhook',
    'POST',
    payload,
    { 'x-zm-request-timestamp': String(Math.floor(Date.now() / 1000)), 'x-zm-signature': 'v0=invalid' }
  );

  lecturerWs.close();
  const cases = {
    webhookAccepted: received.status === 200 && received.body.accepted === true,
    lecturerReceivedNativeChat: lecturerMessage.question?.source === 'zoom_webhook',
    duplicateIgnored: duplicate.status === 200 && duplicate.body.duplicate === true,
    crcValidated: validation.status === 200 && validation.body.encryptedToken === expectedEncryptedToken,
    invalidSignatureRejected: invalid.status === 401
  };

  Object.entries(cases).forEach(([name, passed]) => {
    console.log(`${name}: ${passed ? '✅ ĐẠT' : '❌ LỖI'}`);
  });
  if (Object.values(cases).some(passed => !passed)) process.exitCode = 1;
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
