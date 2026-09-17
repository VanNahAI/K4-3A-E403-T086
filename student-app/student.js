/**
 * Student Mobile Portal Client Controller (student.js)
 * Manages:
 *   1. Realtime WebSocket Connection to Workshop Server
 *   2. Pre-submit Instant FAQ Deflection (Search while typing)
 *   3. Submitting Questions & Tracking Status
 *   4. Instant Echo-Reply Modal
 *   5. Live Ground Truth FAQ Feed
 */

let ws = null;
let studentId = localStorage.getItem('curator_student_id') || `S${Math.floor(1000 + Math.random() * 9000)}`;
let myQuestions = JSON.parse(localStorage.getItem('curator_my_questions') || '[]');
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

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('tag-student-id').textContent = `${studentId} ▾`;
  initWebSocket();
  setupStudentEvents();
  renderMyQuestions();
  renderFaqFeed();
});

function initWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws`;

  updateStatus(false, "Đang kết nối...");

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      updateStatus(true, "Đã kết nối Workshop");
      ws.send(JSON.stringify({
        type: 'register_role',
        role: 'student',
        name: studentId
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (err) {
        console.warn("Invalid server message:", err);
      }
    };

    ws.onclose = () => {
      updateStatus(false, "Mất kết nối (Đang thử lại...)");
      setTimeout(initWebSocket, 3000);
    };

    ws.onerror = () => {
      updateStatus(false, "Lỗi kết nối");
    };
  } catch (err) {
    updateStatus(false, "Offline");
  }
}

function updateStatus(isOnline, text) {
  const dot = document.getElementById('student-ws-dot');
  const label = document.getElementById('student-ws-status');
  if (isOnline) {
    dot.style.background = '#10b981';
    dot.classList.add('pulsing');
    label.style.color = '#34d399';
  } else {
    dot.style.background = '#ef4444';
    dot.classList.remove('pulsing');
    label.style.color = '#f87171';
  }
  label.textContent = text;
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'connected':
      if (Array.isArray(msg.activeFaqs) && msg.activeFaqs.length > 0) {
        const existingIds = new Set(activeFaqs.map(f => f.id));
        for (const f of msg.activeFaqs) {
          if (!existingIds.has(f.id)) {
            activeFaqs.unshift(f);
            existingIds.add(f.id);
          }
        }
        renderFaqFeed();
      }
      break;

    case 'new_faq_available':
      // Prepend newly resolved FAQ from lecturer
      if (msg.faq) {
        activeFaqs = activeFaqs.filter(f => f.id !== msg.faq.id);
        activeFaqs.unshift(msg.faq);
        renderFaqFeed();
      }
      break;

    case 'faqs_refreshed':
      if (Array.isArray(msg.faqs) && msg.faqs.length > 0) {
        activeFaqs = msg.faqs;
        renderFaqFeed();
      }
      break;

    case 'question_received':
      break;

    case 'instant_echo_reply':
      // The student asked something that matches a verified FAQ!
      showInstantEchoModal(msg);
      break;
  }
}

function setupStudentEvents() {
  const form = document.getElementById('form-student-ask');
  const input = document.getElementById('student-msg-input');

  // Pre-submit Deflection: check while typing in real time
  input.addEventListener('input', () => {
    checkInstantDeflection(input.value);
  });

  // Submit Question
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const content = input.value.trim();
    if (!content) return;

    // Send to server via WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'student_submit_question',
        content: content,
        author: studentId
      }));
    }

    // Save locally to personal history
    const questionObj = {
      id: `LOCAL_${Date.now()}`,
      content: content,
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      status: 'Đang xếp hàng lên bảng'
    };
    myQuestions.unshift(questionObj);
    localStorage.setItem('curator_my_questions', JSON.stringify(myQuestions.slice(0, 20)));

    input.value = '';
    const box = document.getElementById('box-deflection');
    if (box) box.classList.add('hidden');
    renderMyQuestions();
  });
}

let deflectionDebounceTimer = null;
let deflectionRequestId = 0;

function hasSemanticConflict(questionText, faq) {
  if (!questionText || !faq) return false;
  const qNorm = String(questionText || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const faqTitleNorm = String(faq.canonicalQuestion || faq.title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const faqAnsNorm = String(faq.answer || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
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

function checkInstantDeflection(rawText) {
  const box = document.getElementById('box-deflection');
  const titleEl = document.getElementById('deflection-faq-title');
  const ansEl = document.getElementById('deflection-answer-text');
  const badgeEl = document.getElementById('deflection-ai-badge');

  if (deflectionDebounceTimer) clearTimeout(deflectionDebounceTimer);

  if (!rawText || rawText.trim().length < 2) {
    if (box) box.classList.add('hidden');
    return;
  }

  const match = findMatchingFaq(rawText);
  // Zero-latency conflict check: if student changes time (e.g. "hôm nay" -> "ngày mai"), reject immediately!
  if (!match || hasSemanticConflict(rawText, match)) {
    if (box) box.classList.add('hidden');
    return;
  }

  // Provisional display with AI pending status
  if (titleEl) titleEl.textContent = `📌 Khớp chủ đề: "${match.canonicalQuestion || match.title}"`;
  if (ansEl) ansEl.textContent = match.answer;
  if (badgeEl) {
    badgeEl.textContent = '🤖 AI LLM đang kiểm tra...';
    badgeEl.style.background = 'rgba(56, 189, 248, 0.18)';
    badgeEl.style.color = '#7dd3fc';
    badgeEl.style.border = '1px solid rgba(56, 189, 248, 0.35)';
  }
  if (box) box.classList.remove('hidden');

  // Debounced LLM Deep Semantic Verification
  const reqId = ++deflectionRequestId;
  deflectionDebounceTimer = setTimeout(async () => {
    try {
      const resp = await fetch('/api/llm-verify-faq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: rawText,
          candidateFaq: match
        })
      });
      if (reqId !== deflectionRequestId) return; // Stale request
      const data = await resp.json();
      if (data && data.success) {
        if (data.matched === false) {
          // LLM caught semantic mismatch (e.g. tomorrow vs today)
          console.log("[Student LLM Deflection] Phủ định khớp:", data.reason);
          if (box) box.classList.add('hidden');
        } else {
          // LLM verified!
          if (badgeEl) {
            const modelName = data.model ? data.model.split('/')[1] : 'Live LLM';
            badgeEl.textContent = `✓ AI LLM đã xác thực (${modelName})`;
            badgeEl.style.background = 'rgba(16, 185, 129, 0.2)';
            badgeEl.style.color = '#34d399';
            badgeEl.style.border = '1px solid rgba(16, 185, 129, 0.4)';
          }
        }
      }
    } catch (e) {
      console.warn("[Student LLM Deflection check error]", e);
    }
  }, 350);
}

function acceptDeflectionAnswer() {
  const input = document.getElementById('student-msg-input');
  const titleEl = document.getElementById('deflection-faq-title');
  const ansEl = document.getElementById('deflection-answer-text');

  const questionText = input.value.trim() || (titleEl ? titleEl.textContent.replace('📌 Khớp chủ đề: ', '') : 'Câu hỏi đã giải đáp');

  // Record in personal history
  myQuestions.unshift({
    id: `SOLVED_${Date.now()}`,
    content: questionText,
    timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    status: '⚡ Đã nhận đáp án tức thì',
    answer: ansEl ? ansEl.textContent : ''
  });
  localStorage.setItem('curator_my_questions', JSON.stringify(myQuestions.slice(0, 20)));

  input.value = '';
  const box = document.getElementById('box-deflection');
  if (box) box.classList.add('hidden');
  renderMyQuestions();
  alert("✓ Đã nhận đáp án! Câu hỏi đã được lưu vào lịch sử học tập của bạn.");
}
window.acceptDeflectionAnswer = acceptDeflectionAnswer;

function findMatchingFaq(rawText) {
  if (!rawText || activeFaqs.length === 0) return null;
  const clean = rawText.toLowerCase().trim();
  if (clean.length < 2) return null;

  // Filter out Vietnamese generic filler words
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
    if (hasSemanticConflict(rawText, faq)) continue;

    let score = 0;
    const title = (faq.canonicalQuestion || faq.title || '').toLowerCase();
    const answer = (faq.answer || '').toLowerCase();
    const keywords = (faq.keywords || []).map(k => k.toLowerCase().trim());

    // 1. Direct title or query containment
    if (title.includes(clean)) {
      score += 15;
    } else if (clean.includes(title)) {
      score += 12;
    }

    // 2. High-priority technical domain signatures
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

    // 3. Token overlap with Title and Keywords
    for (const token of tokens) {
      if (title.includes(token)) {
        score += 3.5;
      }
      for (const kw of keywords) {
        if (kw === token) {
          score += 4.0;
        } else if (kw.includes(token) || token.includes(kw)) {
          score += 2.0;
        }
      }
      if (answer.includes(token) && token.length >= 4) {
        score += 1.0;
      }
    }

    if (score > maxScore) {
      maxScore = score;
      bestFaq = faq;
    }
  }

  // Threshold: >= 4.0 indicates a confident match
  return maxScore >= 4.0 ? bestFaq : null;
}

function renderMyQuestions() {
  const list = document.getElementById('student-my-list');
  const countTag = document.getElementById('student-my-count');
  countTag.textContent = `${myQuestions.length} câu`;

  if (myQuestions.length === 0) {
    list.innerHTML = `
      <div style="text-align: center; padding: 24px; color: #64748b; font-size: 0.8rem;">
        Chưa gửi câu hỏi nào. Khi bạn gặp lỗi, hãy gõ vào ô phía trên!
      </div>
    `;
    return;
  }

  list.innerHTML = myQuestions.map(q => `
    <div style="background: #131b2e; border: 1px solid #1e293b; border-radius: 10px; padding: 12px; margin-bottom: 10px;">
      <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: #64748b; margin-bottom: 4px;">
        <span>${q.timestamp}</span>
        <span class="badge" style="background: rgba(99, 102, 241, 0.2); color: #a5b4fc;">${q.status}</span>
      </div>
      <div style="font-size: 0.88rem; color: #f1f5f9;">${escapeHTML(q.content)}</div>
    </div>
  `).join('');
}

function renderFaqFeed() {
  const list = document.getElementById('student-faqs-list');
  const visibleCountTag = document.getElementById('student-faqs-visible-count');
  visibleCountTag.textContent = activeFaqs.length;

  if (activeFaqs.length === 0) {
    list.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #64748b; font-size: 0.85rem;">
        Chưa có câu hỏi nào được giải thích chính thức trong phiên học này.
      </div>
    `;
    return;
  }

  list.innerHTML = activeFaqs.map(faq => `
    <div class="faq-item-card">
      <div class="faq-q-title">❓ ${escapeHTML(faq.canonicalQuestion || faq.title)}</div>
      <div class="faq-a-body">
        <b>Lời giải đáp của Thầy:</b><br/>
        ${escapeHTML(faq.answer || faq.verifiedAnswer)}
      </div>
      <div class="faq-meta">
        <span>⏰ Giải đáp lúc ${faq.resolvedAt || 'buổi học'}</span>
        <span>👥 Đã phục vụ ${faq.servedStudentsCount || 1} lượt</span>
      </div>
    </div>
  `).join('');
}

function showInstantEchoModal(data) {
  document.getElementById('echo-modal-time').textContent = `GIẢNG VIÊN ĐÃ GIẢI THÍCH (LÚC ${data.resolvedAt}):`;
  document.getElementById('echo-modal-answer').textContent = data.answer;
  document.getElementById('modal-student-echo').classList.remove('hidden');
}

function closeStudentEchoModal() {
  document.getElementById('modal-student-echo').classList.add('hidden');
}

function promptChangeName() {
  const newName = prompt("Nhập mã học viên hoặc tên hiển thị của bạn (Ví dụ: S0129 hoặc Minh Quân):", studentId);
  if (newName && newName.trim()) {
    studentId = newName.trim();
    localStorage.setItem('curator_student_id', studentId);
    document.getElementById('tag-student-id').textContent = `${studentId} ▾`;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'register_role',
        role: 'student',
        name: studentId
      }));
    }
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

window.closeStudentEchoModal = closeStudentEchoModal;
window.promptChangeName = promptChangeName;
