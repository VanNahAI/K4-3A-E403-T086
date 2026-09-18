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
const { WebSocketServer, WebSocket } = require('ws');
const { createQwenProxy, QwenProxyError } = require('./ai-core/qwen_proxy');

const PORT = process.env.PORT || 3000;
const CODEBASE_DIR = path.join(__dirname, 'codebase');
const qwenProxy = createQwenProxy();

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=UTF-8' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, maxBytes = 32768) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bodyTooLarge = false;

    req.on('data', (chunk) => {
      if (bodyTooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > maxBytes) {
        bodyTooLarge = true;
        reject(new QwenProxyError('Request body quá lớn.', 413, 'REQUEST_TOO_LARGE'));
      }
    });
    req.on('end', () => {
      if (bodyTooLarge) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new QwenProxyError('Request body không phải JSON hợp lệ.', 400, 'INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendQwenError(res, error) {
  const knownError = error instanceof QwenProxyError;
  const statusCode = knownError ? error.statusCode : 500;
  const code = knownError ? error.code : 'INTERNAL_ERROR';
  const message = knownError ? error.message : 'Backend không thể xử lý yêu cầu AI.';
  console.warn(`[Qwen Proxy] ${code}: ${message}`);
  const boundary = knownError && error.boundary ? error.boundary : undefined;
  sendJson(res, statusCode, { ok: false, error: { code, message, ...(boundary ? { boundary } : {}) } });
}

async function handleQwenHealth(res) {
  try {
    const status = await qwenProxy.health();
    sendJson(res, 200, { ok: true, ...status });
  } catch (error) {
    sendQwenError(res, error);
  }
}

async function handleQwenClassification(req, res) {
  try {
    const payload = await readJsonBody(req);
    const result = await qwenProxy.classify(payload);
    sendJson(res, 200, result);
  } catch (error) {
    sendQwenError(res, error);
  }
}

async function handleQwenWarmup(res) {
  try {
    sendJson(res, 200, await qwenProxy.warmup());
  } catch (error) {
    sendQwenError(res, error);
  }
}

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

// Pre-configured Zoom meeting state
let zoomMeetingConfig = {
  url: 'https://us06web.zoom.us/j/84920419921?pwd=ai20k_workshop_lab',
  meetingId: '849 2041 9921',
  passcode: 'ai20k',
  topic: 'AI20K · Workshop 01 — Q&A Onboarding & Lab Setup',
  speaker: 'TS. Nguyễn Thành Nhân & Ban Trợ Giảng K4'
};

// HTTP Server
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname;

  // Route aliases to 3-part modular directories
  if (pathname === '/' || pathname === '/portal') {
    pathname = '/portal.html';
  } else if (pathname === '/lecturer') {
    pathname = '/lecturer-app/index.html';
  } else if (pathname === '/student') {
    pathname = '/student-app/student.html';
  } else if (pathname === '/room' || pathname === '/zoom') {
    pathname = '/lecturer-app/zoom_room.html';
  } else if (pathname === '/pip' || pathname === '/companion') {
    const roleParam = url.searchParams.get('role');
    pathname = roleParam === 'lecturer' ? '/lecturer-app/pip_lecturer.html' : '/student-app/pip_student.html';
  }

  // API: Get / Set pre-configured Zoom meeting link
  if (pathname === '/api/ai/health') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Chỉ hỗ trợ GET.' } });
      return;
    }
    handleQwenHealth(res);
    return;
  }

  if (pathname === '/api/ai/classify') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Chỉ hỗ trợ POST.' } });
      return;
    }
    handleQwenClassification(req, res);
    return;
  }

  if (pathname === '/api/ai/warmup') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Chỉ hỗ trợ POST.' } });
      return;
    }
    handleQwenWarmup(res);
    return;
  }

  if (pathname === '/api/ai/metrics') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Chỉ hỗ trợ GET.' } });
      return;
    }
    sendJson(res, 200, { ok: true, metrics: qwenProxy.getMetrics() });
    return;
  }

  if (pathname === '/api/config-zoom') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.url) zoomMeetingConfig.url = json.url;
          if (json.meetingId) zoomMeetingConfig.meetingId = json.meetingId;
          if (json.passcode) zoomMeetingConfig.passcode = json.passcode;
          if (json.topic) zoomMeetingConfig.topic = json.topic;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, config: zoomMeetingConfig }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(zoomMeetingConfig));
      return;
    }
  }

  // REST API: Ingest raw Zoom chat
  if (req.method === 'POST' && pathname === '/api/zoom-import') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const json = JSON.parse(body);
        const rawText = json.rawText || '';
        const parsed = parseZoomChatLog(rawText);
        
        // Broadcast parsed messages to all lecturers
        broadcastToRole('lecturer', {
          type: 'zoom_chat_batch',
          messages: parsed
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, importedCount: parsed.length }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }
  
  // REST API: Reset live session state
  if (req.method === 'POST' && pathname === '/api/reset-session') {
    activeFaqs = [];
    sessionQuestionsCount = 0;
    qwenProxy.reset();
    broadcastToRole('all', {
      type: 'faqs_refreshed',
      faqs: []
    });
    broadcastToRole('all', { type: 'session_reset' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Session reset successfully' }));
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

  // Serve static files across modular folders
  const candidatePaths = [
    path.join(__dirname, pathname),
    path.join(__dirname, 'student-app', pathname),
    path.join(__dirname, 'lecturer-app', pathname),
    path.join(__dirname, 'ai-core', pathname),
    path.join(__dirname, 'codebase', pathname)
  ];

  let targetPath = null;
  for (const cand of candidatePaths) {
    if (cand.startsWith(__dirname) && fs.existsSync(cand)) {
      try {
        if (fs.statSync(cand).isFile()) {
          targetPath = cand;
          break;
        }
      } catch (e) {}
    }
  }

  if (!targetPath) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
    res.end("404 Not Found");
    return;
  }

  fs.readFile(targetPath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=UTF-8' });
      res.end("500 Server Error");
      return;
    }

    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// WebSocket Server
const wss = new WebSocketServer({ server });
const clients = new Map(); // ws -> { role: 'student'|'lecturer', id: string, name: string }

// Live session state
let activeFaqs = [];
let sessionQuestionsCount = 0;

wss.on('connection', (ws) => {
  const clientId = `USER_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  clients.set(ws, { role: 'unknown', id: clientId, name: '' });

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
    activeFaqs: activeFaqs
  }));
});

const genericStopwords = ["lỗi", "em", "thầy", "cho", "hỏi", "bị", "là", "sao", "thế", "nào", "ạ", "với", "trong", "bài", "ở", "kết nối", "thực hành", "cài đặt", "hướng dẫn", "giúp em", "giải thích", "câu hỏi", "vấn đề", "thực hiện", "phần này"];

function matchWithServerFaqs(text) {
  if (!text || activeFaqs.length === 0) return null;
  const lower = text.toLowerCase();
  for (const faq of activeFaqs) {
    if (faq.keywords && Array.isArray(faq.keywords)) {
      let hits = 0;
      let hasDistinctiveHit = false;
      for (const kw of faq.keywords) {
        const kwLower = kw.toLowerCase().trim();
        if (kwLower && lower.includes(kwLower)) {
          hits++;
          if (!genericStopwords.includes(kwLower) && kwLower.length >= 4) {
            hasDistinctiveHit = true;
          }
        }
      }
      if (hits >= 2 && hasDistinctiveHit) {
        return faq;
      }
    }
  }
  return null;
}

function handleWebSocketMessage(ws, msg) {
  const client = clients.get(ws);
  if (!client) return;

  switch (msg.type) {
    case 'register_role':
      client.role = msg.role; // 'lecturer' or 'student'
      client.name = msg.name || (client.role === 'student' ? `S${Math.floor(1000 + Math.random() * 9000)}` : 'Giảng viên');
      broadcastStudentCount();
      break;

    case 'student_submit_question':
      sessionQuestionsCount++;
      const questionPayload = {
        id: `M${1000 + sessionQuestionsCount}`,
        user: client.name || msg.author || 'Học viên ẩn danh',
        content: msg.content.trim(),
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        clientId: client.id
      };

      // Server-side Instant Echo matching against active FAQs
      const matchedFaq = matchWithServerFaqs(questionPayload.content);
      if (matchedFaq) {
        // Send instant echo reply directly to this student
        ws.send(JSON.stringify({
          type: 'instant_echo_reply',
          studentMsg: questionPayload.content,
          answer: matchedFaq.answer,
          resolvedAt: matchedFaq.resolvedAt || 'lớp học',
          faqTitle: matchedFaq.canonicalQuestion
        }));

        matchedFaq.servedStudentsCount = (matchedFaq.servedStudentsCount || 0) + 1;

        // Notify lecturers that an echo was shielded
        broadcastToRole('lecturer', {
          type: 'echo_resolved_event',
          question: questionPayload,
          matchedFaq: matchedFaq
        });
      } else {
        // Broadcast to all lecturers for live clustering
        broadcastToRole('lecturer', {
          type: 'new_student_question',
          question: questionPayload
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
      broadcastToRole('student', {
        type: 'instant_echo_reply',
        targetClientId: msg.targetClientId,
        studentMsg: msg.studentMsg,
        answer: msg.answer,
        resolvedAt: msg.resolvedAt,
        faqTitle: msg.faqTitle
      });
      break;

    case 'sync_active_faqs':
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
    if (ws.readyState === WebSocket.OPEN && (role === 'all' || info.role === role)) {
      ws.send(str);
    }
  }
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
    if (ws.readyState === WebSocket.OPEN && info.role === 'lecturer') {
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
  console.log(`👉 Giảng viên Dashboard: http://localhost:${PORT}/lecturer`);
  console.log(`👉 Học viên Mobile Portal: http://localhost:${PORT}/student`);
  console.log(`👉 WebSocket Endpoint: ws://localhost:${PORT}/ws`);
  console.log(`👉 Qwen3 Backend: ${process.env.QWEN_API_KEY ? 'Configured' : 'Not configured (copy .env.example to .env)'}`);
  console.log(`=======================================================`);
});
