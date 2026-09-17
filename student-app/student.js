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
let activeFaqs = [];

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('tag-student-id').textContent = `${studentId} ▾`;
  initWebSocket();
  setupStudentEvents();
  renderMyQuestions();
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
      if (Array.isArray(msg.activeFaqs)) {
        activeFaqs = msg.activeFaqs;
        renderFaqFeed();
      }
      break;

    case 'new_faq_available':
      // Prepend newly resolved FAQ from lecturer
      activeFaqs.unshift(msg.faq);
      renderFaqFeed();
      break;

    case 'faqs_refreshed':
      if (Array.isArray(msg.faqs)) {
        activeFaqs = msg.faqs;
        renderFaqFeed();
      }
      break;

    case 'question_received':
      // Acknowledged
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

  // Pre-submit Deflection: check while typing
  input.addEventListener('input', () => {
    const text = input.value.toLowerCase().trim();
    if (text.length < 5) {
      document.getElementById('box-deflection').classList.add('hidden');
      return;
    }

    // Check if matching any active FAQ
    const match = findMatchingFaq(text);
    if (match) {
      document.getElementById('deflection-answer-text').textContent = match.answer;
      document.getElementById('box-deflection').classList.remove('hidden');
    } else {
      document.getElementById('box-deflection').classList.add('hidden');
    }
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
    document.getElementById('box-deflection').classList.add('hidden');
    renderMyQuestions();
  });
}

function findMatchingFaq(text) {
  for (const faq of activeFaqs) {
    if (faq.keywords && Array.isArray(faq.keywords)) {
      for (const kw of faq.keywords) {
        if (text.includes(kw.toLowerCase())) {
          return faq;
        }
      }
    }
  }
  return null;
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
