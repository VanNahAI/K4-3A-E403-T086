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

// Automatically load .env file if present
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}
loadEnv();

const PORT = process.env.PORT || 3000;
const CODEBASE_DIR = path.join(__dirname, 'codebase');

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

  // API: Get / Set OpenRouter AI Model Configuration
  if (pathname === '/api/ai-config') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.apiKey !== undefined) {
            process.env.OPENROUTER_API_KEY = json.apiKey.trim();
          }
          if (json.model) {
            process.env.OPENROUTER_MODEL = json.model.trim();
          }
          // Persist to .env
          const envContent = `OPENROUTER_API_KEY=${process.env.OPENROUTER_API_KEY || ''}\nOPENROUTER_MODEL=${process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp:free'}\n`;
          fs.writeFileSync(path.join(__dirname, '.env'), envContent, 'utf8');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            hasKey: !!process.env.OPENROUTER_API_KEY,
            model: process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp:free'
          }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    } else {
      const key = process.env.OPENROUTER_API_KEY || '';
      const masked = key ? `${key.slice(0, 10)}...${key.slice(-4)}` : '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        hasKey: !!key,
        maskedKey: masked,
        model: process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp:free',
        availableFreeModels: [
          'google/gemini-2.0-flash-exp:free',
          'meta-llama/llama-3.2-3b-instruct:free',
          'qwen/qwen-2.5-7b-instruct:free',
          'deepseek/deepseek-r1:free',
          'mistralai/mistral-7b-instruct:free'
        ]
      }));
      return;
    }
  }

  // REST API: Proxy LLM Semantic Clustering to OpenRouter
  if (req.method === 'POST' && pathname === '/api/llm-analyze') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const json = JSON.parse(body);
        const { text, existingClusters, requestedModel } = json;
        const apiKey = process.env.OPENROUTER_API_KEY || json.apiKey || '';

        if (!apiKey) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, reason: 'no_api_key', fallback: true }));
          return;
        }

        const model = requestedModel || process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp:free';
        const clustersSummary = (existingClusters || [])
          .map(c => `- [ID: ${c.id}] "${c.title}" (từ khóa: ${(c.keywords || []).join(', ')})`)
          .join('\n');

        const prompt = `Bạn là hệ thống AI phân loại câu hỏi trong lớp học workshop công nghệ.
Học viên vừa gửi câu hỏi: "${text}"

Các nhóm câu hỏi hiện có trong lớp:
${clustersSummary || "(Chưa có nhóm nào)"}

Yêu cầu:
1. Nếu câu hỏi có cùng bản chất ngữ nghĩa với 1 nhóm có sẵn, trả về "matchedClusterId".
2. Nếu là chủ đề mới, hãy tạo "suggestedTitle" (dưới 10 từ, chuẩn hóa tiếng Việt, nêu rõ bản chất vấn đề) và trích xuất 3-5 "keywords".

Chỉ trả về định dạng JSON thuần túy (không kèm giải thích hay markdown backticks):
{
  "matchedClusterId": null,
  "suggestedTitle": "Tiêu đề chuẩn hóa dưới 10 từ",
  "keywords": ["từ khóa 1", "từ khóa 2", "từ khóa 3"],
  "confidence": 0.95
}`;

        const startTime = Date.now();
        const llmRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "HTTP-Referer": "https://ai20k-workshop-curator.local",
            "X-Title": "Workshop Question Curator"
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: "system", content: "Bạn là AI phân tích ngữ nghĩa câu hỏi học tập, luôn trả về JSON hợp lệ." },
              { role: "user", content: prompt }
            ],
            temperature: 0.1
          }),
          signal: AbortSignal.timeout(8000)
        });

        if (!llmRes.ok) {
          const errText = await llmRes.text();
          throw new Error(`OpenRouter HTTP ${llmRes.status}: ${errText.slice(0, 150)}`);
        }

        const data = await llmRes.json();
        const latencyMs = Date.now() - startTime;
        const rawContent = data.choices[0].message.content.trim();
        let parsed;
        try {
          const cleanJson = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
          parsed = JSON.parse(cleanJson);
        } catch (parseErr) {
          const match = rawContent.match(/\{[\s\S]*\}/);
          if (match) {
            parsed = JSON.parse(match[0]);
          } else {
            throw parseErr;
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          analysis: parsed,
          model: model,
          latencyMs: latencyMs,
          tokens: data.usage ? data.usage.total_tokens : 0
        }));
      } catch (err) {
        console.warn("[LLM Proxy] OpenRouter call failed:", err.message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message, fallback: true }));
      }
    });
    return;
  }

  // API: Get / Set pre-configured Zoom meeting link
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
    broadcastToRole('all', {
      type: 'faqs_refreshed',
      faqs: []
    });
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
  console.log(`=======================================================`);
});
