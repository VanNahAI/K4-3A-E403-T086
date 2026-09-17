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
          const envContent = `OPENROUTER_API_KEY=${process.env.OPENROUTER_API_KEY || ''}\nOPENROUTER_MODEL=${process.env.OPENROUTER_MODEL || 'nex-agi/nex-n2.5-mini:free'}\n`;
          fs.writeFileSync(path.join(__dirname, '.env'), envContent, 'utf8');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            hasKey: !!process.env.OPENROUTER_API_KEY,
            model: process.env.OPENROUTER_MODEL || 'nex-agi/nex-n2.5-mini:free'
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
        model: process.env.OPENROUTER_MODEL || 'nex-agi/nex-n2.5-mini:free',
        availableFreeModels: [
          'nex-agi/nex-n2.5-mini:free',
          'cohere/north-mini-code:free',
          'z-ai/glm-5.2:free',
          'openrouter/free',
          'nvidia/nemotron-3.5-lightning:free'
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

        let model = requestedModel || process.env.OPENROUTER_MODEL || 'nex-agi/nex-n2.5-mini:free';
        // Auto-sanitize: immediately override any defunct gemini-2.0-flash model from browser cache
        if (!model || model.includes('gemini-2.0-flash')) {
          model = 'nex-agi/nex-n2.5-mini:free';
          process.env.OPENROUTER_MODEL = model;
        }
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
3. Toàn bộ "suggestedTitle" và các từ khóa "keywords" BẮT BUỘC 100% viết bằng Tiếng Việt chuẩn (tuyệt đối không dùng tiếng Trung hay tiếng khác).

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
const DEFAULT_WORKSHOP_FAQS = [
  {
    id: "FAQ_CUDA_OOM",
    canonicalQuestion: "Cách sửa lỗi tràn bộ nhớ CUDA Out of Memory trên GPU / Colab",
    keywords: ["cuda", "oom", "out of memory", "tràn ram", "tràn vram", "hết ram", "gpu colab", "pytorch", "bộ nhớ", "batch size", "empty_cache"],
    answer: "1. Vào Runtime -> Change runtime type, kiểm tra GPU T4 đã bật chưa.\n2. Giảm batch_size (ví dụ từ 32 xuống 16 hoặc 8).\n3. Thêm câu lệnh torch.cuda.empty_cache() trước mỗi epoch hoặc sau bước backward.\n4. Dùng with torch.no_grad(): trong vòng lặp validation để không lưu gradient thừa.",
    resolvedAt: "Đầu buổi workshop",
    servedStudentsCount: 12
  },
  {
    id: "FAQ_DOCKER_PORT",
    canonicalQuestion: "Lỗi xung đột cổng mạng Docker (Port 8080 / 3000 already in use)",
    keywords: ["docker", "port", "cổng", "conflict", "8080", "3000", "already in use", "allocated", "xung đột cổng", "đang chạy", "chiếm cổng"],
    answer: "1. Kiểm tra tiến trình chiếm cổng: Chạy lệnh netstat -ano | findstr :8080 (hoặc :3000).\n2. Tắt tiến trình cũ: taskkill /F /PID <PID> (Windows) hoặc kill -9 <PID> (Linux/Mac).\n3. Hoặc đổi cổng map của container: docker run -p 8081:8080 ... thay vì cổng 8080 mặc định.",
    resolvedAt: "Đầu buổi workshop",
    servedStudentsCount: 8
  },
  {
    id: "FAQ_CVAT_STEP3",
    canonicalQuestion: "Lỗi cài đặt CVAT & OPA bước 3 (Healthcheck 500 / Policy Bundle)",
    keywords: ["cvat", "opa", "bước 3", "step 3", "healthcheck", "500", "policy bundle", "migration", "gán nhãn", "annotation"],
    answer: "1. Chạy lệnh: docker compose down -v để dọn dẹp volume cũ bị lỗi migration.\n2. Tải lại file policy bundle mới nhất từ repo môn học.\n3. Khởi động lại: docker compose up -d và chờ 2-3 phút để container OPA hoàn tất khởi tạo healthcheck.",
    resolvedAt: "Đầu buổi workshop",
    servedStudentsCount: 15
  },
  {
    id: "FAQ_COLAB_DISCONNECT",
    canonicalQuestion: "Cách chống ngắt kết nối GPU Google Colab khi đang huấn luyện mô hình",
    keywords: ["ngắt kết nối", "disconnect", "colab treo", "timeout", "idle", "mất kết nối", "rớt mạng colab", "colab bị dừng"],
    answer: "1. Bấm F12 mở Console trình duyệt tại tab Colab, dán đoạn script giữ kết nối tự động:\nfunction ClickConnect(){ console.log('Keep-alive'); document.querySelector('#top-toolbar > colab-connect-button').click(); } setInterval(ClickConnect, 60000);\n2. Hoặc lưu checkpoint thường xuyên sau mỗi epoch vào Google Drive qua drive.mount('/content/drive').",
    resolvedAt: "Đầu buổi workshop",
    servedStudentsCount: 6
  },
  {
    id: "FAQ_ZOOM_ATTENDANCE",
    canonicalQuestion: "Cú pháp đặt tên tài khoản Zoom & Điểm danh Workshop",
    keywords: ["tên zoom", "đặt tên zoom", "cú pháp", "điểm danh", "myvinuni", "quét qr", "zoom", "họ tên mã", "đổi tên"],
    answer: "Cú pháp đổi tên chuẩn: [Mã HV] - [Họ và Tên] (Ví dụ: K4-3A-1234 - Nguyễn Văn A). Giảng viên sẽ tự động điểm danh qua log Zoom chat và mã QR cuối buổi học.",
    resolvedAt: "Đầu buổi workshop",
    servedStudentsCount: 19
  }
];

let activeFaqs = [...DEFAULT_WORKSHOP_FAQS];
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

function matchWithServerFaqs(text) {
  if (!text || activeFaqs.length === 0) return null;
  const clean = text.toLowerCase().trim();
  if (clean.length < 2) return null;

  const stopwords = new Set([
    "thầy", "thay", "ơi", "oi", "cho", "em", "hỏi", "hoi", "với", "voi", "ạ", "a",
    "là", "la", "gì", "gi", "thế", "the", "nào", "nao", "sao", "bị", "bi", "trong",
    "khi", "lúc", "luc", "làm", "lam", "cách", "cach", "hướng", "dẫn", "bài", "bai",
    "tập", "tap", "ở", "o", "của", "cua", "và", "va", "được", "duoc", "không", "khong"
  ]);

  const tokens = clean.split(/[\s,.\?!;:()\[\]{}"'\\\/]+/).filter(w => w.length >= 2 && !stopwords.has(w));

  let bestFaq = null;
  let maxScore = 0;

  for (const faq of activeFaqs) {
    let score = 0;
    const title = (faq.canonicalQuestion || faq.title || '').toLowerCase();
    const keywords = (faq.keywords || []).map(k => k.toLowerCase().trim());

    if (title.includes(clean)) score += 15;
    else if (clean.includes(title)) score += 12;

    const domainSignatures = [
      { pattern: /(cuda|oom|out of memory|tràn ram|tran ram|hết ram|het ram|vram|gpu colab)/i, id: "FAQ_CUDA_OOM" },
      { pattern: /(docker|port|cổng|cong|8080|3000|already in use|allocated|xung đột|xung dot)/i, id: "FAQ_DOCKER_PORT" },
      { pattern: /(cvat|opa|bước 3|buoc 3|step 3|healthcheck|500|gán nhãn|gan nhan|annotation)/i, id: "FAQ_CVAT_STEP3" },
      { pattern: /(disconnect|ngắt kết nối|ngat ket noi|rớt mạng|rot mang|colab treo|timeout)/i, id: "FAQ_COLAB_DISCONNECT" },
      { pattern: /(tên zoom|ten zoom|đổi tên|doi ten|cú pháp|cu phap|điểm danh|diem danh|myvinuni)/i, id: "FAQ_ZOOM_ATTENDANCE" }
    ];

    for (const sig of domainSignatures) {
      if (sig.pattern.test(clean)) {
        if (faq.id === sig.id || keywords.some(k => sig.pattern.test(k)) || sig.pattern.test(title)) {
          score += 10;
        }
      }
    }

    for (const token of tokens) {
      if (title.includes(token)) score += 3.5;
      for (const kw of keywords) {
        if (kw === token) score += 4.0;
        else if (kw.includes(token) || token.includes(kw)) score += 2.0;
      }
    }

    if (score > maxScore) {
      maxScore = score;
      bestFaq = faq;
    }
  }

  return maxScore >= 4.0 ? bestFaq : null;
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
