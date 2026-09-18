/**
 * Workshop Question Curator — Realtime Application Server (server.js)
 * Endpoints:
 *   - http://localhost:3000/          -> Lecturer Dashboard
 *   - http://localhost:3000/student   -> Mobile Student Portal
 *   - ws://localhost:3000/ws          -> Realtime WebSocket Bridge
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3000;
const CODEBASE_DIR = path.join(__dirname, 'codebase');
const LECTURER_ACCESS_TOKEN = String(process.env.LECTURER_ACCESS_TOKEN || '').trim();
const ENABLE_SIMULATION = String(process.env.ENABLE_SIMULATION || '').toLowerCase() === 'true';
const ZOOM_MEETING_URL = String(process.env.ZOOM_MEETING_URL || '').trim();
const ZOOM_MEETING_ID = String(process.env.ZOOM_MEETING_ID || '').trim();
const ZOOM_PASSCODE = String(process.env.ZOOM_PASSCODE || '').trim();
const ZOOM_TOPIC = String(process.env.ZOOM_TOPIC || 'AI20K Workshop').trim();
const ZOOM_SPEAKER = String(process.env.ZOOM_SPEAKER || '').trim();
const ZOOM_WEBHOOK_SECRET_TOKEN = String(process.env.ZOOM_WEBHOOK_SECRET_TOKEN || '').trim();
const ZOOM_OAUTH_CLIENT_ID = String(process.env.ZOOM_OAUTH_CLIENT_ID || '').trim();
const ZOOM_OAUTH_CLIENT_SECRET = String(process.env.ZOOM_OAUTH_CLIENT_SECRET || '').trim();
const ZOOM_OAUTH_REDIRECT_URI = String(process.env.ZOOM_OAUTH_REDIRECT_URI || '').trim();
const ZOOM_OAUTH_SUCCESS_PATH = String(process.env.ZOOM_OAUTH_SUCCESS_PATH || '/zoom-auth-success').trim() || '/zoom-auth-success';
const zoomOAuthGrants = new Map();
const zoomAppSessions = new Map();
const ZOOM_APP_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const ZOOM_WEBHOOK_MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const zoomWebhookDiagnostics = {
  received: 0,
  signatureRejected: 0,
  validationRequests: 0,
  acceptedMessages: 0,
  ignoredMessages: 0,
  lastEvent: null,
  lastEventAt: null,
  lastOutcome: null
};
const configuredBodyLimit = Number(process.env.MAX_REQUEST_BODY_BYTES);
const MAX_REQUEST_BODY_BYTES = Number.isInteger(configuredBodyLimit) && configuredBodyLimit > 0
  ? configuredBodyLimit
  : 1024 * 1024;
const MAX_WS_PAYLOAD_BYTES = 64 * 1024;
const WS_MESSAGE_WINDOW_MS = 10 * 1000;
const WS_MESSAGE_LIMIT = 60;

// MIME types for static serving
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Zoom meeting state is initialized from environment variables and can be
// updated at runtime by an authenticated lecturer.
let zoomMeetingConfig = {
  url: ZOOM_MEETING_URL,
  meetingId: ZOOM_MEETING_ID,
  passcode: ZOOM_PASSCODE,
  topic: ZOOM_TOPIC,
  speaker: ZOOM_SPEAKER
};

function getBearerToken(req) {
  const authorization = String(req.headers.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function hasValidLecturerToken(providedToken) {
  if (!LECTURER_ACCESS_TOKEN || !providedToken) return false;

  const expected = Buffer.from(LECTURER_ACCESS_TOKEN, 'utf8');
  const provided = Buffer.from(String(providedToken), 'utf8');
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

function decryptZoomAppContext(encryptedContext) {
  if (!ZOOM_OAUTH_CLIENT_SECRET) {
    throw new Error('ZOOM_OAUTH_CLIENT_SECRET chưa được cấu hình.');
  }

  let buffer = Buffer.from(String(encryptedContext || '').trim(), 'base64url');
  if (buffer.length < 24) throw new Error('Zoom App Context không hợp lệ.');

  const ivLength = buffer.readUInt8(0);
  buffer = buffer.subarray(1);
  if (!ivLength || buffer.length < ivLength + 2) throw new Error('Zoom App Context thiếu IV.');
  const iv = buffer.subarray(0, ivLength);
  buffer = buffer.subarray(ivLength);

  const aadLength = buffer.readUInt16LE(0);
  buffer = buffer.subarray(2);
  if (buffer.length < aadLength + 4) throw new Error('Zoom App Context thiếu AAD.');
  const aad = buffer.subarray(0, aadLength);
  buffer = buffer.subarray(aadLength);

  const cipherLength = buffer.readUInt32LE(0);
  buffer = buffer.subarray(4);
  if (!cipherLength || buffer.length !== cipherLength + 16) {
    throw new Error('Zoom App Context có độ dài bản mã không hợp lệ.');
  }
  const cipherText = buffer.subarray(0, cipherLength);
  const authTag = buffer.subarray(cipherLength);

  const key = crypto.createHash('sha256').update(ZOOM_OAUTH_CLIENT_SECRET).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  if (aad.length) decipher.setAAD(aad);
  decipher.setAuthTag(authTag);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

function timestampToMilliseconds(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
  return timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
}

function validateZoomHostContext(encryptedContext) {
  const context = decryptZoomAppContext(encryptedContext);
  const now = Date.now();
  const expiresAt = timestampToMilliseconds(context.exp);
  const createdAt = timestampToMilliseconds(context.ts);

  if (expiresAt && expiresAt <= now) throw new Error('Zoom App Context đã hết hạn.');
  if (!expiresAt && (!createdAt || Math.abs(now - createdAt) > 10 * 60 * 1000)) {
    throw new Error('Zoom App Context đã quá cũ.');
  }
  if (context.iss && context.iss !== 'marketplace.zoom.us') {
    throw new Error('Zoom App Context có issuer không hợp lệ.');
  }
  if (context.aud && ZOOM_OAUTH_CLIENT_ID && context.aud !== ZOOM_OAUTH_CLIENT_ID) {
    throw new Error('Zoom App Context không thuộc ứng dụng này.');
  }

  const role = String(context.attendrole || '').toLowerCase().replace(/[\s_-]/g, '');
  if (role !== 'host' && role !== 'cohost') {
    const error = new Error('Chỉ Host hoặc Co-host mới được mở bảng giảng viên.');
    error.statusCode = 403;
    throw error;
  }
  return { ...context, normalizedRole: role };
}

function issueZoomAppSession(context) {
  const token = crypto.randomBytes(32).toString('base64url');
  const contextExpiry = timestampToMilliseconds(context.exp);
  const expiresAt = Math.min(contextExpiry || Number.MAX_SAFE_INTEGER, Date.now() + ZOOM_APP_SESSION_TTL_MS);
  zoomAppSessions.set(token, {
    userId: String(context.uid || ''),
    meetingUuid: String(context.mid || ''),
    expiresAt
  });
  return { token, expiresAt };
}

function hasValidZoomAppSessionToken(providedToken) {
  const token = String(providedToken || '').trim();
  const session = zoomAppSessions.get(token);
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    zoomAppSessions.delete(token);
    return false;
  }
  return true;
}

function hasValidLecturerCredential(providedToken) {
  return hasValidLecturerToken(providedToken) || hasValidZoomAppSessionToken(providedToken);
}

function sendJson(res, statusCode, payload) {
  applySecurityHeaders(res);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=UTF-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; object-src 'none'; " +
    "script-src 'self' 'unsafe-inline' https://appssdk.zoom.us; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com data:; " +
    "img-src 'self' data: https://api.qrserver.com; " +
    "connect-src 'self' ws: wss: https://openrouter.ai; frame-src 'self'"
  );
}

function readJsonBody(req, res, onJson) {
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    req.resume();
    sendJson(res, 413, {
      success: false,
      code: 'REQUEST_BODY_TOO_LARGE',
      message: `Nội dung request vượt quá ${MAX_REQUEST_BODY_BYTES} bytes.`
    });
    return;
  }

  let body = '';
  let receivedBytes = 0;
  let finished = false;

  req.on('data', chunk => {
    if (finished) return;
    receivedBytes += chunk.length;
    if (receivedBytes > MAX_REQUEST_BODY_BYTES) {
      finished = true;
      sendJson(res, 413, {
        success: false,
        code: 'REQUEST_BODY_TOO_LARGE',
        message: `Nội dung request vượt quá ${MAX_REQUEST_BODY_BYTES} bytes.`
      });
      return;
    }
    body += chunk.toString('utf8');
  });

  req.on('end', () => {
    if (finished) return;
    try {
      onJson(JSON.parse(body), body);
    } catch (error) {
      sendJson(res, 400, {
        success: false,
        code: 'INVALID_JSON',
        message: 'Request body phải là JSON hợp lệ.'
      });
    }
  });

  req.on('error', error => {
    if (!finished && !res.headersSent) {
      finished = true;
      sendJson(res, 400, {
        success: false,
        code: 'REQUEST_READ_FAILED',
        message: 'Không thể đọc request body.'
      });
    }
    console.warn('Request body read failed:', error.message);
  });
}

function requireLecturerHttp(req, res) {
  if (!LECTURER_ACCESS_TOKEN && zoomAppSessions.size === 0) {
    sendJson(res, 503, {
      success: false,
      code: 'LECTURER_AUTH_NOT_CONFIGURED',
      message: 'Server chưa cấu hình LECTURER_ACCESS_TOKEN.'
    });
    return false;
  }

  if (!hasValidLecturerCredential(getBearerToken(req))) {
    sendJson(res, 401, {
      success: false,
      code: 'LECTURER_AUTH_REQUIRED',
      message: 'Cần mã truy cập giảng viên hợp lệ.'
    });
    return false;
  }

  return true;
}

function getPublicZoomConfig() {
  return {
    url: zoomMeetingConfig.url,
    meetingId: zoomMeetingConfig.meetingId,
    topic: zoomMeetingConfig.topic,
    speaker: zoomMeetingConfig.speaker,
    passcode: null
  };
}

function isValidZoomUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && Boolean(parsed.hostname);
  } catch (error) {
    return false;
  }
}

function normalizeMeetingId(value) {
  return String(value || '').replace(/\D/g, '');
}

function hasValidZoomWebhookSignature(req, rawBody) {
  if (!ZOOM_WEBHOOK_SECRET_TOKEN) return false;

  const timestamp = String(req.headers['x-zm-request-timestamp'] || '').trim();
  const receivedSignature = String(req.headers['x-zm-signature'] || '').trim();
  const timestampNumber = Number(timestamp);
  if (!timestamp || !receivedSignature || !Number.isFinite(timestampNumber)) return false;
  if (Math.abs(Date.now() - timestampNumber * 1000) > ZOOM_WEBHOOK_MAX_CLOCK_SKEW_SECONDS * 1000) {
    return false;
  }

  const message = `v0:${timestamp}:${rawBody}`;
  const expectedSignature = `v0=${crypto
    .createHmac('sha256', ZOOM_WEBHOOK_SECRET_TOKEN)
    .update(message)
    .digest('hex')}`;
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const receivedBuffer = Buffer.from(receivedSignature, 'utf8');
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function createZoomWebhookValidationResponse(plainToken) {
  return {
    plainToken,
    encryptedToken: crypto
      .createHmac('sha256', ZOOM_WEBHOOK_SECRET_TOKEN)
      .update(plainToken)
      .digest('hex')
  };
}

function getZoomOAuthRedirectUri(req) {
  if (ZOOM_OAUTH_REDIRECT_URI) return ZOOM_OAUTH_REDIRECT_URI;

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || (req.socket.encrypted ? 'https' : 'http');
  return `${protocol}://${req.headers.host}/api/zoom/oauth/callback`;
}

function sendHtml(res, statusCode, html) {
  applySecurityHeaders(res);
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=UTF-8',
    'Cache-Control': 'no-store'
  });
  res.end(html);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function exchangeZoomAuthorizationCode(code, redirectUri) {
  const credentials = Buffer
    .from(`${ZOOM_OAUTH_CLIENT_ID}:${ZOOM_OAUTH_CLIENT_SECRET}`, 'utf8')
    .toString('base64');
  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(payload.reason || payload.error || 'Zoom OAuth token exchange failed.'));
    error.statusCode = response.status;
    throw error;
  }
  return payload;
}

function formatIncomingTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }
  return date.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function isAuthorizedLecturer(client) {
  return Boolean(client && client.role === 'lecturer' && client.authenticated);
}

function sendWsAuthError(ws, message = 'Cần xác thực giảng viên hợp lệ.') {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'auth_error',
      code: 'LECTURER_AUTH_REQUIRED',
      message
    }));
  }
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname;

  if ((pathname === '/room' || pathname === '/zoom') && !ENABLE_SIMULATION) {
    sendJson(res, 410, {
      success: false,
      code: 'SIMULATION_DISABLED',
      message: 'Phòng Zoom mô phỏng đã được tắt. Hãy tham gia bằng liên kết Zoom thật.'
    });
    return;
  }

  // Route aliases
  if (pathname === '/' || pathname === '/portal') {
    pathname = '/portal.html';
  } else if (pathname === '/zoom-app') {
    pathname = '/zoom_entry.html';
  } else if (pathname === '/zoom-app/lecturer' || pathname === '/zoom-app/student') {
    pathname = '/pip_companion.html';
  } else if (pathname === '/zoom-auth-success') {
    pathname = '/zoom_auth_success.html';
  } else if (pathname === '/lecturer') {
    res.writeHead(302, { Location: '/zoom-app' });
    res.end();
    return;
  } else if (pathname === '/host') {
    pathname = '/index.html';
  } else if (pathname === '/student') {
    pathname = '/student.html';
  } else if (pathname === '/room' || pathname === '/zoom') {
    pathname = '/zoom_room.html';
  } else if (pathname === '/pip' || pathname === '/companion') {
    pathname = '/pip_companion.html';
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, {
      status: 'ok',
      service: 'workshop-question-curator',
      lecturerAuthConfigured: Boolean(LECTURER_ACCESS_TOKEN),
      zoomConfigured: isValidZoomUrl(zoomMeetingConfig.url),
      zoomWebhookConfigured: Boolean(ZOOM_WEBHOOK_SECRET_TOKEN),
      simulationEnabled: ENABLE_SIMULATION,
      sessionOpen: sessionState.isOpen,
      zoomWebhook: { ...zoomWebhookDiagnostics }
    });
    return;
  }

  // Zoom redirects users here after they approve the General App. The
  // authorization code is exchanged server-side; tokens are never returned
  // to the browser or written to logs.
  if (req.method === 'GET' && pathname === '/api/zoom/oauth/callback') {
    const oauthError = String(url.searchParams.get('error') || '').trim();
    if (oauthError) {
      const description = String(url.searchParams.get('error_description') || 'Người dùng chưa cấp quyền cho ứng dụng.').trim();
      sendHtml(res, 400, `<!doctype html><meta charset="utf-8"><title>Zoom OAuth</title><p>Không thể cấp quyền Zoom: ${escapeHtml(description)}</p>`);
      return;
    }

    const code = String(url.searchParams.get('code') || '').trim();
    if (!code) {
      sendHtml(res, 400, '<!doctype html><meta charset="utf-8"><title>Zoom OAuth</title><p>Thiếu mã cấp quyền Zoom.</p>');
      return;
    }

    if (!ZOOM_OAUTH_CLIENT_ID || !ZOOM_OAUTH_CLIENT_SECRET) {
      sendHtml(res, 503, '<!doctype html><meta charset="utf-8"><title>Zoom OAuth</title><p>Server chưa cấu hình ZOOM_OAUTH_CLIENT_ID và ZOOM_OAUTH_CLIENT_SECRET.</p>');
      return;
    }

    const redirectUri = getZoomOAuthRedirectUri(req);
    try {
      const tokenPayload = await exchangeZoomAuthorizationCode(code, redirectUri);
      // The current deployment only needs to complete the authorization flow.
      // Keep the grant in memory for this process; persistent encrypted token
      // storage will be added when server-side Zoom APIs are enabled.
      const grantKey = String(tokenPayload.user_id || tokenPayload.id || Date.now());
      zoomOAuthGrants.set(grantKey, {
        accessToken: tokenPayload.access_token,
        refreshToken: tokenPayload.refresh_token,
        expiresAt: Date.now() + Number(tokenPayload.expires_in || 0) * 1000,
        scope: tokenPayload.scope || ''
      });

      const separator = ZOOM_OAUTH_SUCCESS_PATH.includes('?') ? '&' : '?';
      res.writeHead(303, {
        Location: `${ZOOM_OAUTH_SUCCESS_PATH}${separator}zoom_auth=success`,
        'Cache-Control': 'no-store'
      });
      res.end();
    } catch (error) {
      console.warn('Zoom OAuth token exchange failed:', error.message);
      sendHtml(res, 502, '<!doctype html><meta charset="utf-8"><title>Zoom OAuth</title><p>Zoom không chấp nhận mã cấp quyền. Hãy tạo Authorization URL mới và thử lại.</p>');
    }
    return;
  }

  // Exchange Zoom's encrypted, short-lived app context for an equally
  // short-lived local lecturer session. This avoids a browser prompt inside
  // the Zoom webview while verifying the caller is the live Host or Co-host.
  if (req.method === 'POST' && pathname === '/api/zoom/bootstrap') {
    readJsonBody(req, res, json => {
      try {
        const context = validateZoomHostContext(json.context);
        const session = issueZoomAppSession(context);
        sendJson(res, 200, {
          success: true,
          token: session.token,
          expiresAt: new Date(session.expiresAt).toISOString(),
          meetingUuid: context.mid || null
        });
      } catch (error) {
        sendJson(res, error.statusCode || 401, {
          success: false,
          code: 'ZOOM_APP_CONTEXT_INVALID',
          message: error.message || 'Không xác thực được Zoom App Context.'
        });
      }
    });
    return;
  }

  // Zoom sends native meeting chat events here. This endpoint is intentionally
  // separate from lecturer auth: Zoom authenticates the request with its
  // x-zm-signature header and webhook secret token.
  if (req.method === 'POST' && pathname === '/api/zoom/webhook') {
    readJsonBody(req, res, (json, rawBody) => {
      zoomWebhookDiagnostics.received += 1;
      zoomWebhookDiagnostics.lastEvent = String(json.event || 'unknown_event');
      zoomWebhookDiagnostics.lastEventAt = new Date().toISOString();

      if (!ZOOM_WEBHOOK_SECRET_TOKEN) {
        zoomWebhookDiagnostics.ignoredMessages += 1;
        zoomWebhookDiagnostics.lastOutcome = 'ZOOM_WEBHOOK_NOT_CONFIGURED';
        sendJson(res, 503, {
          success: false,
          code: 'ZOOM_WEBHOOK_NOT_CONFIGURED',
          message: 'Server chưa cấu hình ZOOM_WEBHOOK_SECRET_TOKEN.'
        });
        return;
      }

      if (!hasValidZoomWebhookSignature(req, rawBody)) {
        zoomWebhookDiagnostics.signatureRejected += 1;
        zoomWebhookDiagnostics.lastOutcome = 'SIGNATURE_INVALID';
        sendJson(res, 401, {
          success: false,
          code: 'ZOOM_WEBHOOK_SIGNATURE_INVALID',
          message: 'Chữ ký webhook Zoom không hợp lệ hoặc đã hết hạn.'
        });
        return;
      }

      if (json.event === 'endpoint.url_validation') {
        zoomWebhookDiagnostics.validationRequests += 1;
        zoomWebhookDiagnostics.lastOutcome = 'ENDPOINT_VALIDATED';
        const plainToken = String(json.payload?.plainToken || '').trim();
        if (!plainToken) {
          sendJson(res, 400, {
            success: false,
            code: 'ZOOM_WEBHOOK_VALIDATION_TOKEN_MISSING',
            message: 'Thiếu payload.plainToken cho bước xác thực webhook Zoom.'
          });
          return;
        }
        sendJson(res, 200, createZoomWebhookValidationResponse(plainToken));
        return;
      }

      if (json.event !== 'meeting.chat_message_sent') {
        zoomWebhookDiagnostics.ignoredMessages += 1;
        zoomWebhookDiagnostics.lastOutcome = `IGNORED_EVENT:${json.event || 'unknown_event'}`;
        sendJson(res, 200, {
          success: true,
          received: true,
          ignored: json.event || 'unknown_event'
        });
        return;
      }

      const meetingObject = json.payload?.object || {};
      const chatMessage = meetingObject.chat_message || {};
      const configuredMeetingId = normalizeMeetingId(zoomMeetingConfig.meetingId);
      const incomingMeetingId = normalizeMeetingId(meetingObject.id);
      if (configuredMeetingId && incomingMeetingId && configuredMeetingId !== incomingMeetingId) {
        zoomWebhookDiagnostics.ignoredMessages += 1;
        zoomWebhookDiagnostics.lastOutcome = 'MEETING_ID_MISMATCH';
        sendJson(res, 200, {
          success: true,
          received: true,
          ignored: 'MEETING_ID_MISMATCH'
        });
        return;
      }

      const result = ingestZoomChatMessage(chatMessage, meetingObject, json.event_ts);
      if (result.accepted) {
        zoomWebhookDiagnostics.acceptedMessages += 1;
        zoomWebhookDiagnostics.lastOutcome = result.isEcho ? 'ACCEPTED_ECHO' : 'ACCEPTED_NEW_QUESTION';
      } else {
        zoomWebhookDiagnostics.ignoredMessages += 1;
        zoomWebhookDiagnostics.lastOutcome = result.ignored || (result.duplicate ? 'DUPLICATE' : 'IGNORED');
      }
      sendJson(res, 200, {
        success: true,
        received: true,
        ...result
      });
    });
    return;
  }

  // API: Get / Set pre-configured Zoom meeting link
  if (pathname === '/api/config-zoom') {
    if (req.method === 'POST') {
      if (!requireLecturerHttp(req, res)) return;
      readJsonBody(req, res, json => {
        try {
          if (json.url !== undefined) {
            if (!isValidZoomUrl(json.url)) {
              sendJson(res, 400, {
                success: false,
                code: 'INVALID_ZOOM_URL',
                message: 'Link Zoom phải là URL http hoặc https hợp lệ.'
              });
              return;
            }
            zoomMeetingConfig.url = String(json.url).trim();
          }
          if (json.meetingId) zoomMeetingConfig.meetingId = json.meetingId;
          if (json.passcode) zoomMeetingConfig.passcode = json.passcode;
          if (json.topic) zoomMeetingConfig.topic = json.topic;
          sendJson(res, 200, { success: true, config: zoomMeetingConfig });
        } catch (e) {
          sendJson(res, 400, { success: false, error: e.message });
        }
      });
      return;
    } else {
      sendJson(res, 200, getPublicZoomConfig());
      return;
    }
  }

  // REST API: Ingest raw Zoom chat
  if (req.method === 'POST' && pathname === '/api/zoom-import') {
    if (!requireLecturerHttp(req, res)) return;
    readJsonBody(req, res, json => {
      try {
        const rawText = json.rawText || '';
        const parsed = parseZoomChatLog(rawText);
        
        // Broadcast parsed messages to all lecturers
        broadcastToRole('lecturer', {
          type: 'zoom_chat_batch',
          messages: parsed
        });

        sendJson(res, 200, { success: true, importedCount: parsed.length });
      } catch (err) {
        sendJson(res, 400, { success: false, error: err.message });
      }
    });
    return;
  }
  
  // REST API: Reset live session state
  if (req.method === 'GET' && pathname === '/api/session/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getSessionSnapshot()));
    return;
  }

  // Start a brand-new workshop session. Starting a session is also the
  // authoritative place where all FAQ/question state is cleared.
  if (req.method === 'POST' && pathname === '/api/session/start') {
    if (!requireLecturerHttp(req, res)) return;
    if (!isValidZoomUrl(zoomMeetingConfig.url)) {
      sendJson(res, 503, {
        success: false,
        code: 'ZOOM_NOT_CONFIGURED',
        message: 'Chưa cấu hình ZOOM_MEETING_URL hợp lệ cho buổi học.'
      });
      return;
    }
    const session = startNewSession();
    sendJson(res, 200, { success: true, session });
    return;
  }

  // Students use this endpoint before entering the real Zoom meeting.
  if (req.method === 'POST' && pathname === '/api/session/join') {
    if (!sessionState.isOpen) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        code: 'MEETING_NOT_STARTED',
        message: 'Giảng viên chưa mở lớp. Vui lòng quay lại khi cuộc họp bắt đầu.'
      }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, session: getSessionSnapshot() }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/reset-session') {
    if (!requireLecturerHttp(req, res)) return;
    activeFaqs = [];
    sessionQuestionsCount = 0;
    sessionState = {
      isOpen: false,
      sessionId: createSessionId(),
      startedAt: null
    };
    syncClientSessionIds();
    broadcastToRole('all', {
      type: 'faqs_refreshed',
      faqs: []
    });
    broadcastToRole('all', {
      type: 'session_ended',
      session: getSessionSnapshot(),
      message: 'Phiên học đã được làm sạch.'
    });
    sendJson(res, 200, { success: true, message: 'Session reset successfully' });
    return;
  }

  // API: Get server network IP for mobile QR code
  if (pathname === '/api/network-info') {
    const interfaces = os.networkInterfaces();
    let localIp = 'localhost';
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIp = iface.address;
          break;
        }
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ip: localIp, port: PORT, studentUrl: `http://${localIp}:${PORT}/student` }));
    return;
  }

  // Serve static file from codebase
  const filePath = path.join(CODEBASE_DIR, pathname);

  // Security check: prevent directory traversal
  if (!filePath.startsWith(CODEBASE_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
      res.end("404 Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// WebSocket Server
const wss = new WebSocketServer({ server, maxPayload: MAX_WS_PAYLOAD_BYTES });
const clients = new Map(); // ws -> { role, id, name, authenticated, sessionId }

// Live session state
let activeFaqs = [];
let sessionQuestionsCount = 0;
let sessionState = {
  isOpen: false,
  sessionId: createSessionId(),
  startedAt: null
};
const processedZoomMessageIds = new Set();

function createSessionId() {
  return `SESSION_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function getSessionSnapshot() {
  return { ...sessionState };
}

function syncClientSessionIds() {
  for (const info of clients.values()) {
    info.sessionId = sessionState.sessionId;
  }
}

function startNewSession() {
  activeFaqs = [];
  sessionQuestionsCount = 0;
  sessionState = {
    isOpen: true,
    sessionId: createSessionId(),
    startedAt: new Date().toISOString()
  };
  syncClientSessionIds();

  broadcastToRole('all', {
    type: 'session_started',
    session: getSessionSnapshot()
  });
  broadcastToRole('all', {
    type: 'faqs_refreshed',
    faqs: []
  });

  return getSessionSnapshot();
}

wss.on('connection', (ws) => {
  const clientId = `USER_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  clients.set(ws, {
    role: 'unknown',
    id: clientId,
    name: '',
    authenticated: false,
    messageWindowStartedAt: Date.now(),
    messageCount: 0
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleWebSocketMessage(ws, msg);
    } catch (e) {
      console.warn("Invalid WS message format:", e);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcastStudentCount();
  });

  // Send initial handshake
  ws.send(JSON.stringify({
    type: 'connected',
    clientId: clientId,
    activeFaqs: activeFaqs,
    session: getSessionSnapshot()
  }));
});

const genericStopwords = ["lỗi", "em", "thầy", "cho", "hỏi", "bị", "là", "sao", "thế", "nào", "ạ", "với", "trong", "bài", "ở", "kết nối", "thực hành", "cài đặt", "hướng dẫn", "giúp em", "giải thích", "câu hỏi", "vấn đề", "thực hiện", "phần này"];

function matchWithServerFaqs(text) {
  if (!text || activeFaqs.length === 0) return null;
  let bestFaq = null;
  let bestScore = 0;

  for (const faq of activeFaqs) {
    const score = scoreFaqMatch(text, faq);
    if (score > bestScore) {
      bestScore = score;
      bestFaq = faq;
    }
  }

  return bestScore >= 2.5 ? bestFaq : null;
}

function rememberZoomMessage(messageId) {
  const normalizedId = String(messageId || '').trim();
  if (!normalizedId) return false;
  if (processedZoomMessageIds.has(normalizedId)) return true;

  processedZoomMessageIds.add(normalizedId);
  while (processedZoomMessageIds.size > 1000) {
    const oldestId = processedZoomMessageIds.values().next().value;
    processedZoomMessageIds.delete(oldestId);
  }
  return false;
}

function ingestZoomChatMessage(chatMessage, meetingObject, eventTimestamp) {
  if (!sessionState.isOpen) {
    return { accepted: false, ignored: 'SESSION_NOT_OPEN' };
  }

  const messageId = String(chatMessage.message_id || '').trim();
  if (rememberZoomMessage(messageId)) {
    return { accepted: false, duplicate: true, messageId };
  }

  const content = String(chatMessage.message_content || '').trim();
  if (!content) {
    return { accepted: false, ignored: 'EMPTY_MESSAGE', messageId };
  }

  sessionQuestionsCount++;
  const senderName = String(chatMessage.sender_name || '').trim() || 'Học viên Zoom';
  const questionPayload = {
    id: `ZM${1000 + sessionQuestionsCount}`,
    user: senderName,
    content,
    timestamp: formatIncomingTimestamp(chatMessage.date_time || eventTimestamp),
    clientId: `ZOOM_${String(chatMessage.sender_session_id || senderName).trim()}`,
    source: 'zoom_webhook',
    zoomMessageId: messageId || null,
    recipientType: chatMessage.recipient_type || 'everyone'
  };

  const matchedFaq = matchWithServerFaqs(questionPayload.content);
  if (matchedFaq) {
    matchedFaq.servedStudentsCount = (matchedFaq.servedStudentsCount || 0) + 1;
    broadcastToRole('lecturer', {
      type: 'new_student_question',
      question: questionPayload,
      isEcho: true,
      matchedFaq
    });
    broadcastToRole('lecturer', {
      type: 'echo_resolved_event',
      question: questionPayload,
      matchedFaq
    });
  } else {
    broadcastToRole('lecturer', {
      type: 'new_student_question',
      question: questionPayload,
      isEcho: false
    });
  }

  return {
    accepted: true,
    messageId: messageId || questionPayload.id,
    questionId: questionPayload.id,
    isEcho: Boolean(matchedFaq)
  };
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferQuestionIntent(value) {
  const text = normalizeSearchText(value);
  if (/deadline|han nop|nop (muon|tre)|gia han|tru diem/.test(text)) return 'submission_deadline';
  if (/hoc gi|noi dung|chu de|agenda|chuong trinh|kien thuc.*hom nay/.test(text)) return 'session_agenda';
  if (/ket thuc|tan hoc|hoc den|may gio (xong|nghi)|bao gio (xong|nghi)/.test(text)) return 'session_end_time';
  if (/diem danh|quet qr|myvinuni|ten zoom|dat ten/.test(text)) return 'attendance';
  if (/ghep doi|lap team|lap nhom|dong doi|thanh vien/.test(text)) return 'team_formation';
  if (/diem xp|\/rank|xep hang|thu hang/.test(text)) return 'xp_ranking';
  if (/(cvat|opa|docker).*(loi|error|500|port|health|migration)|(loi|error|500|port).*(cvat|opa|docker)/.test(text)) return 'technical_setup';
  return null;
}

function meaningfulQuestionTokens(value) {
  const stopwords = new Set([
    'ai', 'anh', 'bai', 'ban', 'buoi', 'cac', 'cho', 'co', 'cua', 'de', 'duoc',
    'em', 'gi', 'hom', 'hoi', 'hoc', 'la', 'lam', 'luc', 'may', 'minh', 'nao',
    'nay', 'o', 'phan', 'sao', 'thay', 'the', 'thi', 'trong', 'va', 've', 'voi'
  ]);
  return normalizeSearchText(value).split(' ').filter(token => token.length >= 2 && !stopwords.has(token));
}

function scoreFaqMatch(text, faq) {
  const normalizedText = normalizeSearchText(text);
  const questionTokens = new Set(normalizedText.split(' ').filter(Boolean));
  const terms = Array.isArray(faq.keywords) ? faq.keywords : [];
  const title = faq.canonicalQuestion || faq.originalClusterTitle || faq.title || '';
  const normalizedTitle = normalizeSearchText(title);
  const titleTokens = new Set(normalizedTitle.split(' ').filter(Boolean));
  const incomingIntent = inferQuestionIntent(text);
  const faqIntent = inferQuestionIntent([title, ...terms].join(' '));

  if (normalizedText.length >= 12 && (
    normalizedText === normalizedTitle ||
    normalizedTitle.endsWith(normalizedText) ||
    normalizedText.endsWith(normalizedTitle)
  )) return 100;

  if (incomingIntent && faqIntent && incomingIntent !== faqIntent) return 0;

  let score = 0;
  let exactHits = 0;
  let distinctiveHit = false;

  for (const term of [...terms, title]) {
    const normalizedTerm = normalizeSearchText(term);
    if (!normalizedTerm || normalizedTerm.length < 2) continue;

    if (normalizedText.includes(normalizedTerm)) {
      exactHits++;
      const words = normalizedTerm.split(' ').filter(Boolean);
      score += words.length > 1 ? 1.5 : 1;
      if (!genericStopwords.includes(String(term).toLowerCase().trim()) && normalizedTerm.length >= 4) {
        distinctiveHit = true;
      }
    }
  }

  let titleOverlap = 0;
  for (const token of questionTokens) {
    if (token.length >= 2 && titleTokens.has(token)) titleOverlap++;
  }
  score += Math.min(titleOverlap, 3) * 0.5;

  const meaningfulTitleTokens = new Set(meaningfulQuestionTokens(title));
  const meaningfulOverlap = meaningfulQuestionTokens(text).filter(token => meaningfulTitleTokens.has(token)).length;
  if (incomingIntent && faqIntent && incomingIntent === faqIntent && meaningfulOverlap >= 1) {
    score += 3;
    distinctiveHit = true;
  } else if (meaningfulOverlap >= 2) {
    score += 2.5;
    distinctiveHit = true;
  }

  if (exactHits >= 2 && distinctiveHit) return score + 1;
  if (exactHits >= 1 && titleOverlap >= 2 && distinctiveHit) return score + 0.5;
  return 0;
}

function handleWebSocketMessage(ws, msg) {
  const client = clients.get(ws);
  if (!client) return;

  const now = Date.now();
  if (now - client.messageWindowStartedAt >= WS_MESSAGE_WINDOW_MS) {
    client.messageWindowStartedAt = now;
    client.messageCount = 0;
  }
  client.messageCount += 1;
  if (client.messageCount > WS_MESSAGE_LIMIT) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'rate_limited',
        message: 'Bạn gửi quá nhiều thao tác trong thời gian ngắn. Vui lòng thử lại sau.'
      }));
    }
    return;
  }

  switch (msg.type) {
    case 'register_role':
      if (msg.role === 'lecturer') {
        if (!hasValidLecturerCredential(msg.token)) {
          client.role = 'unknown';
          client.authenticated = false;
          sendWsAuthError(ws, 'Không thể đăng ký quyền giảng viên nếu thiếu mã truy cập hợp lệ.');
          ws.close(1008, 'Lecturer authentication required');
          break;
        }
        client.authenticated = true;
      } else {
        client.authenticated = false;
      }

      client.role = msg.role; // 'lecturer' or 'student'
      client.name = msg.name || (client.role === 'student' ? `S${Math.floor(1000 + Math.random() * 9000)}` : 'Giảng viên');
      client.sessionId = sessionState.sessionId;
      broadcastStudentCount();
      if (client.role === 'student' && !sessionState.isOpen) {
        ws.send(JSON.stringify({
          type: 'meeting_not_started',
          session: getSessionSnapshot(),
          message: 'Giảng viên chưa mở lớp. Đây là thông báo mô phỏng của Zoom.'
        }));
      }
      break;

    case 'student_submit_question':
      if (!sessionState.isOpen) {
        ws.send(JSON.stringify({
          type: 'meeting_not_started',
          session: getSessionSnapshot(),
          message: 'Lớp chưa mở nên câu hỏi chưa được gửi.'
        }));
        break;
      }

      if (client.sessionId && client.sessionId !== sessionState.sessionId) {
        ws.send(JSON.stringify({
          type: 'session_stale',
          session: getSessionSnapshot(),
          message: 'Phiên học đã thay đổi. Vui lòng tải lại trang để vào phiên mới.'
        }));
        break;
      }

      const content = typeof msg.content === 'string' ? msg.content.trim() : '';
      if (!content) break;

      sessionQuestionsCount++;
      const questionPayload = {
        id: `M${1000 + sessionQuestionsCount}`,
        user: client.name || msg.author || 'Học viên ẩn danh',
        content: content,
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        clientId: client.id
      };

      // Server-side Instant Echo matching against active FAQs
      const matchedFaq = matchWithServerFaqs(questionPayload.content);
      if (matchedFaq) {
        matchedFaq.servedStudentsCount = (matchedFaq.servedStudentsCount || 0) + 1;
        // Send instant echo reply directly to this student
        ws.send(JSON.stringify({
          type: 'instant_echo_reply',
          studentMsg: questionPayload.content,
          answer: matchedFaq.answer,
          resolvedAt: matchedFaq.resolvedAt || 'lớp học',
          faqTitle: matchedFaq.canonicalQuestion
        }));

        // The lecturer still receives every question in realtime. The match
        // metadata lets the dashboard show it as auto-resolved without
        // creating a duplicate unanswered cluster.
        broadcastToRole('lecturer', {
          type: 'new_student_question',
          question: questionPayload,
          isEcho: true,
          matchedFaq: matchedFaq
        });

        // Keep a separate event for compact host-cockpit metrics.
        broadcastToRole('lecturer', {
          type: 'echo_resolved_event',
          question: questionPayload,
          matchedFaq: matchedFaq
        });
      } else {
        // Broadcast to all lecturers for live clustering
        broadcastToRole('lecturer', {
          type: 'new_student_question',
          question: questionPayload,
          isEcho: false
        });
      }

      // Acknowledge back to the submitting student
      ws.send(JSON.stringify({
        type: 'question_received',
        questionId: questionPayload.id,
        isEcho: !!matchedFaq
      }));
      break;

    case 'broadcast_faq_resolved':
      // Lecturer broadcast a newly extracted FAQ
      if (!isAuthorizedLecturer(client)) {
        sendWsAuthError(ws);
        break;
      }
      if (msg.faq) {
        activeFaqs.unshift(msg.faq);
        // Broadcast to all students so their live FAQ feed updates!
        broadcastToRole('student', {
          type: 'new_faq_available',
          faq: msg.faq
        });
      }
      break;

    case 'send_echo_reply_to_student':
      // Lecturer AI detected an echo inquiry and sends instant answer to that student
      if (!isAuthorizedLecturer(client)) {
        sendWsAuthError(ws);
        break;
      }
      sendToClient(msg.targetClientId, {
        type: 'instant_echo_reply',
        studentMsg: msg.studentMsg,
        answer: msg.answer,
        resolvedAt: msg.resolvedAt,
        faqTitle: msg.faqTitle
      });
      break;

    case 'sync_active_faqs':
      if (!isAuthorizedLecturer(client)) {
        sendWsAuthError(ws);
        break;
      }
      if (Array.isArray(msg.faqs)) {
        activeFaqs = msg.faqs;
        broadcastToRole('student', {
          type: 'faqs_refreshed',
          faqs: activeFaqs
        });
      }
      break;
  }
}

function broadcastToRole(role, payload) {
  const str = JSON.stringify(payload);
  for (const [ws, info] of clients.entries()) {
    const isTargetRole = role === 'all' || info.role === role;
    const canReceiveLecturerTraffic = role !== 'lecturer' || isAuthorizedLecturer(info);
    if (ws.readyState === WebSocket.OPEN && isTargetRole && canReceiveLecturerTraffic) {
      ws.send(str);
    }
  }
}

function sendToClient(clientId, payload) {
  for (const [ws, info] of clients.entries()) {
    if (info.id === clientId && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return true;
    }
  }
  return false;
}

function broadcastStudentCount() {
  let studentCount = 0;
  for (const info of clients.values()) {
    if (info.role === 'student') studentCount++;
  }

  const payload = JSON.stringify({
    type: 'online_students_count',
    count: studentCount
  });

  for (const [ws, info] of clients.entries()) {
    if (ws.readyState === WebSocket.OPEN && isAuthorizedLecturer(info)) {
      ws.send(payload);
    }
  }
}

/**
 * Standard Zoom chatlog parser
 * Format:
 * 14:23:05 From S0129 to Everyone:
 * Cho em hỏi hạn nộp bài lab 2 là mấy giờ tối nay ạ?
 */
function parseZoomChatLog(rawText) {
  const lines = rawText.split(/\r?\n/);
  const messages = [];
  let currentMsg = null;

  const headerRegex = /^(\d{2}:\d{2}:\d{2})\s+From\s+(.+?)\s+to\s+Everyone:\s*$/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(headerRegex);
    if (match) {
      if (currentMsg && currentMsg.content) {
        messages.push(currentMsg);
      }
      currentMsg = {
        id: `ZM${Math.floor(1000 + Math.random() * 9000)}`,
        timestamp: match[1],
        user: match[2],
        content: ''
      };
    } else if (currentMsg) {
      currentMsg.content = (currentMsg.content ? currentMsg.content + ' ' : '') + trimmed;
    } else {
      // Freeform message
      messages.push({
        id: `ZM${Math.floor(1000 + Math.random() * 9000)}`,
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        user: `S${Math.floor(1000 + Math.random() * 9000)}`,
        content: trimmed
      });
    }
  }

  if (currentMsg && currentMsg.content) {
    messages.push(currentMsg);
  }

  return messages;
}

// Start Server
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Workshop Question Curator Server running!`);
  console.log(`👉 Giảng viên Dashboard: http://localhost:${PORT}/host`);
  console.log(`👉 Học viên Mobile Portal: http://localhost:${PORT}/student`);
  console.log(`👉 WebSocket Endpoint: ws://localhost:${PORT}/ws`);
  console.log(`=======================================================`);
});

let isShuttingDown = false;
function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Đang đóng server theo tín hiệu ${signal}...`);

  for (const ws of clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.close(1001, 'Server đang khởi động lại');
  }

  server.close(() => process.exit(0));
  setTimeout(() => {
    for (const ws of clients.keys()) ws.terminate();
    process.exit(0);
  }, 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
