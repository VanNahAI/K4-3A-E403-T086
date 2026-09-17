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

  // REST API: Verify whether student question matches a candidate FAQ using LLM
  if (req.method === 'POST' && pathname === '/api/llm-verify-faq') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const json = JSON.parse(body);
        const { question, candidateFaq } = json;
        const apiKey = process.env.OPENROUTER_API_KEY || json.apiKey || '';

        if (!candidateFaq) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, matched: false, reason: 'Không có FAQ đối chiếu' }));
          return;
        }

        // 1. Zero-latency heuristic contradiction pre-filter
        if (hasSemanticConflict(question, candidateFaq)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            matched: false,
            confidence: 0.99,
            reason: "Phát hiện mâu thuẫn thời gian/chủ đề (ví dụ: 'hôm nay' vs 'ngày mai', hoặc bài lab khác nhau).",
            provider: 'fast_conflict_filter'
          }));
          return;
        }

        // 2. If no OpenRouter key, fallback safely
        if (!apiKey) {
          const localOk = !hasSemanticConflict(question, candidateFaq);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            matched: localOk,
            confidence: localOk ? 0.8 : 0.2,
            reason: localOk ? "Khớp ngữ nghĩa cục bộ" : "Không khớp ngữ nghĩa",
            fallback: true
          }));
          return;
        }

        let model = process.env.OPENROUTER_MODEL || 'nex-agi/nex-n2.5-mini:free';
        if (!model || model.includes('gemini-2.0-flash')) {
          model = 'nex-agi/nex-n2.5-mini:free';
        }

        const prompt = `Bạn là AI thẩm định sự trùng khớp câu hỏi của học viên với ngân hàng câu trả lời FAQ.
Học viên đang hỏi: "${question}"

Câu hỏi/đáp án FAQ có sẵn của Giảng viên:
- Tiêu đề: "${candidateFaq.canonicalQuestion || candidateFaq.title}"
- Đáp án của Thầy: "${candidateFaq.answer}"

QUY TẮC BẮT BUỘC:
1. MỐC THỜI GIAN: Nếu học viên hỏi về 'ngày mai' / 'tuần sau' / 'hôm qua' trong khi FAQ nói về 'hôm nay' (hoặc ngược lại), TUYỆT ĐỐI KHÔNG ĐƯỢC COI LÀ TRÙNG KHỚP (matched = false).
2. SỐ THỨ TỰ BÀI/LAB: Nếu học viên hỏi bài Lab khác (ví dụ: hỏi Lab 3 trong khi FAQ là Lab 2), TUYỆT ĐỐI KHÔNG TRÙNG KHỚP (matched = false).
3. ĐÁP ÁN: Chỉ trả về matched = true khi đáp án của FAQ thực sự giải đáp đúng và đủ câu hỏi của học viên.

Chỉ trả về định dạng JSON thuần túy (không kèm markdown):
{
  "matched": false,
  "confidence": 0.95,
  "reason": "Giải thích ngắn gọn bằng tiếng Việt dưới 25 từ"
}`;

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
              { role: "system", content: "Bạn là AI thẩm định câu hỏi học tập, luôn trả về JSON hợp lệ." },
              { role: "user", content: prompt }
            ],
            temperature: 0.1
          }),
          signal: AbortSignal.timeout(6000)
        });

        if (!llmRes.ok) {
          throw new Error(`OpenRouter HTTP ${llmRes.status}`);
        }

        const data = await llmRes.json();
        const rawContent = data.choices[0].message.content.trim();
        let parsed = null;
        try {
          const cleanJson = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
          parsed = JSON.parse(cleanJson);
        } catch (parseErr) {
          const match = rawContent.match(/\{[\s\S]*\}/);
          if (match) parsed = JSON.parse(match[0]);
        }

        if (parsed && typeof parsed.matched === 'boolean') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            matched: parsed.matched,
            confidence: parsed.confidence || 0.95,
            reason: parsed.reason || '',
            model: model
          }));
        } else {
          throw new Error("Invalid LLM response structure");
        }
      } catch (err) {
        console.warn("[LLM Student Verify] Fallback due to:", err.message);
        const localMatch = !hasSemanticConflict(json?.question, json?.candidateFaq);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          matched: localMatch,
          confidence: 0.75,
          reason: "Fallback xác thực cục bộ",
          fallback: true
        }));
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
  if (req.method === 'GET' && pathname === '/api/session/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getSessionSnapshot()));
    return;
  }

  // Start a brand-new workshop session. Starting a session is also the
  // authoritative place where all FAQ/question state is cleared.
  if (req.method === 'POST' && pathname === '/api/session/start') {
    const session = startNewSession();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, session }));
    return;
  }

  // Students use this endpoint before entering the simulated Zoom room.
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
let sessionState = {
  isOpen: false,
  sessionId: createSessionId(),
  startedAt: null
};

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
    activeFaqs: activeFaqs,
    session: getSessionSnapshot()
  }));
});

const genericStopwords = ["lỗi", "em", "thầy", "cho", "hỏi", "bị", "là", "sao", "thế", "nào", "ạ", "với", "trong", "bài", "ở", "kết nối", "thực hành", "cài đặt", "hướng dẫn", "giúp em", "giải thích", "câu hỏi", "vấn đề", "thực hiện", "phần này"];

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
  if (/deadline|han nop|\bnop (muon|tre)\b|gia han|tru diem/.test(text)) return 'submission_deadline';
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

function hasSemanticConflict(questionText, faq) {
  if (!questionText || !faq) return false;
  const qNorm = normalizeSearchText(questionText);
  const faqTitleNorm = normalizeSearchText(faq.canonicalQuestion || faq.originalClusterTitle || faq.title || '');
  const faqAnsNorm = normalizeSearchText(faq.answer || '');
  const faqTextNorm = `${faqTitleNorm} ${faqAnsNorm}`;

  // 1. Temporal conflicts: Today vs Tomorrow vs Yesterday vs Next week
  const qHasTomorrow = /\b(ngay mai|mai nay|hom sau|ngay tiep theo)\b/.test(qNorm) || (/\bmai\b/.test(qNorm) && !/\bmyvinuni\b/.test(qNorm) && !/\bmai vn\b/.test(qNorm));
  const qHasToday = /\b(hom nay|bua nay|chieu nay|toi nay|sang nay)\b/.test(qNorm);
  const qHasYesterday = /\b(hom qua|hom truoc)\b/.test(qNorm);
  const qHasNextWeek = /\b(tuan sau|tuan toi)\b/.test(qNorm);

  const faqHasToday = /\b(hom nay|bua nay|chieu nay|toi nay|sang nay)\b/.test(faqTextNorm);
  const faqHasTomorrow = /\b(ngay mai|mai nay|hom sau)\b/.test(faqTextNorm);

  if (qHasTomorrow && faqHasToday && !faqHasTomorrow) return true;
  if (qHasYesterday && faqHasToday) return true;
  if (qHasNextWeek && !faqTextNorm.includes('tuan sau') && !faqTextNorm.includes('tuan toi')) return true;

  // 2. Lab numbering conflicts: e.g. "lab 1", "lab 2", "lab 3", "lab 4"
  const qLabMatch = qNorm.match(/\blab\s*([0-9]+)\b/);
  const faqLabMatch = faqTextNorm.match(/\blab\s*([0-9]+)\b/);
  if (qLabMatch && faqLabMatch && qLabMatch[1] !== faqLabMatch[1]) {
    return true; // e.g. Lab 3 asked, but FAQ is about Lab 2
  }

  // 3. Start vs End time conflicts
  const qHasStart = /\b(bat dau|may gio hoc|may gio vao)\b/.test(qNorm);
  const qHasEnd = /\b(ket thuc|tan hoc|may gio xong|may gio nghi|bao gio nghi)\b/.test(qNorm);
  const faqHasEnd = /\b(ket thuc|tan hoc|may gio xong|nghi luc)\b/.test(faqTextNorm);
  const faqHasStart = /\b(bat dau|vao hoc)\b/.test(faqTextNorm);

  if (qHasStart && faqHasEnd && !faqHasStart) return true;
  if (qHasEnd && faqHasStart && !faqHasEnd) return true;

  return false;
}

function scoreFaqMatch(text, faq) {
  if (hasSemanticConflict(text, faq)) return 0;

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

  const domainSignatures = [
    { pattern: /(cuda|oom|out of memory|tràn ram|tran ram|hết ram|het ram|vram|gpu colab)/i, id: "FAQ_CUDA_OOM" },
    { pattern: /(docker|port|cổng|cong|8080|3000|already in use|allocated|xung đột|xung dot)/i, id: "FAQ_DOCKER_PORT" },
    { pattern: /(cvat|opa|bước 3|buoc 3|step 3|healthcheck|500|gán nhãn|gan nhan|annotation)/i, id: "FAQ_CVAT_STEP3" },
    { pattern: /(disconnect|ngắt kết nối|ngat ket noi|rớt mạng|rot mang|colab treo|timeout)/i, id: "FAQ_COLAB_DISCONNECT" },
    { pattern: /(tên zoom|ten zoom|đổi tên|doi ten|cú pháp|cu phap|điểm danh|diem danh|myvinuni)/i, id: "FAQ_ZOOM_ATTENDANCE" }
  ];
  for (const sig of domainSignatures) {
    if (sig.pattern.test(text)) {
      if (faq.id === sig.id || terms.some(k => sig.pattern.test(k)) || sig.pattern.test(title)) {
        score += 10;
        distinctiveHit = true;
        exactHits += 2;
      }
    }
  }

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
  return score >= 10 ? score : 0;
}

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

function handleWebSocketMessage(ws, msg) {
  const client = clients.get(ws);
  if (!client) return;

  switch (msg.type) {
    case 'register_role':
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
      sendToClient(msg.targetClientId, {
        type: 'instant_echo_reply',
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
