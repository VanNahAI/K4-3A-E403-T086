/**
 * Curator AI — Picture-in-Picture & Floating Companion Logic (pip_companion.js)
 * Manages live WebSocket sync, student Q&A with instant deflection, and lecturer host cockpit.
 */

let ws = null;
let currentRole = 'student';
let currentName = 'Học viên';
let currentId = 'S0129';

let activeFaqs = [];
let myQuestions = [];
let lecturerClusters = [];
let totalLecMsgs = 0;
let totalEchoShielded = 0;
let recognition = null;
let activeExplainingCluster = null;
let connectionSuspended = false;
let reconnectTimer = null;

// Stopwords for local deflection matching
const genericStopwords = ["lỗi", "em", "thầy", "cho", "hỏi", "bị", "là", "sao", "thế", "nào", "ạ", "với", "trong", "bài", "ở"];

window.addEventListener('DOMContentLoaded', () => {
  // 1. Read URL parameters
  const params = new URLSearchParams(window.location.search);
  currentRole = params.get('role') || 'student';
  currentName = params.get('name') || (currentRole === 'lecturer' ? 'TS. Nguyễn Thành Nhân (Host)' : 'Minh Quân (S0129)');
  currentId = params.get('id') || (currentRole === 'lecturer' ? 'HOST' : 'S0129');

  // 2. Setup header identity
  document.getElementById('pip-user-name').textContent = currentName;

  // 3. Toggle Role View
  if (currentRole === 'lecturer') {
    document.getElementById('pip-student-container').classList.add('hidden');
    document.getElementById('pip-lecturer-container').classList.remove('hidden');
    document.title = "Curator AI — Host Cockpit (PiP)";
  } else {
    document.getElementById('pip-student-container').classList.remove('hidden');
    document.getElementById('pip-lecturer-container').classList.add('hidden');
    document.title = `Curator AI — ${currentName}`;
  }

  // 4. Initialize AI Engine & WebSocket Connection
  if (typeof UnifiedAIEngine !== 'undefined') {
    window.engine = new UnifiedAIEngine();
  }
  connectWebSocket();
});

function connectWebSocket() {
  if (connectionSuspended) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    document.getElementById('pip-ws-dot').className = 'status-dot pulsing';
    document.getElementById('pip-ws-text').textContent = 'Zoom Live Sync: Sẵn sàng';
    document.getElementById('pip-ws-text').style.color = '#34d399';

    // Register role and appearance name
    ws.send(JSON.stringify({
      type: 'register_role',
      role: currentRole,
      name: currentName,
      studentId: currentId
    }));
    window.dispatchEvent(new CustomEvent('curator:connection-ready'));
  };

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      await handleServerMessage(msg);
    } catch (e) {
      console.warn("Invalid message from server:", e);
    }
  };

  ws.onclose = () => {
    if (connectionSuspended) return;
    document.getElementById('pip-ws-dot').className = 'status-dot';
    document.getElementById('pip-ws-text').textContent = 'Mất kết nối. Đang thử lại...';
    document.getElementById('pip-ws-text').style.color = '#f87171';
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWebSocket, 3000);
  };
}

async function handleServerMessage(msg) {
  switch (msg.type) {
    case 'connected':
      if (msg.activeFaqs && Array.isArray(msg.activeFaqs)) {
        activeFaqs = msg.activeFaqs;
        renderStudentFaqs();
      }
      break;

    case 'student_count':
      const onlineEl = document.getElementById('pip-lec-online');
      if (onlineEl) onlineEl.textContent = msg.count || 1;
      break;

    case 'new_faq_available':
      // Broadcast from teacher
      if (msg.faq) {
        activeFaqs.unshift(msg.faq);
        renderStudentFaqs();
        showNotificationToast(`🔔 Thầy vừa giải thích: "${msg.faq.canonicalQuestion}"`);
      }
      break;

    case 'instant_echo_reply':
      // Direct echo answer from server/AI
      openPipEchoModal(msg.answer, msg.resolvedAt, msg.faqTitle);
      break;

    case 'new_student_question':
      // Lecturer view: incoming student question
      if (currentRole === 'lecturer' && msg.question) {
        totalLecMsgs++;
        document.getElementById('pip-lec-msgs').textContent = totalLecMsgs;
        if (window.engine) {
          await window.engine.processMessage(msg.question.content, msg.question.user);
          lecturerClusters = window.engine.clusters;
          renderLecturerClusters();
        } else {
          addQuestionToLecturerClusters(msg.question);
        }
      }
      break;

    case 'echo_resolved_event':
      // Lecturer view: an echo was automatically deflected
      if (currentRole === 'lecturer') {
        totalEchoShielded++;
        document.getElementById('pip-lec-echo').textContent = totalEchoShielded;
      }
      break;
  }
}

// =========================================================================
// STUDENT LOGIC
// =========================================================================

function switchStudentTab(tab) {
  const btnAsk = document.getElementById('btn-tab-ask');
  const btnFaqs = document.getElementById('btn-tab-faqs');
  const viewAsk = document.getElementById('pip-view-ask');
  const viewFaqs = document.getElementById('pip-view-faqs');

  if (tab === 'ask') {
    btnAsk.classList.add('active');
    btnFaqs.classList.remove('active');
    viewAsk.classList.remove('hidden');
    viewFaqs.classList.add('hidden');
  } else {
    btnFaqs.classList.add('active');
    btnAsk.classList.remove('active');
    viewFaqs.classList.remove('hidden');
    viewAsk.classList.add('hidden');
  }
}

function handleTypingDeflection(text) {
  const box = document.getElementById('pip-deflection-box');
  const ansEl = document.getElementById('pip-deflection-answer');

  if (!text || text.trim().length < 5 || activeFaqs.length === 0) {
    box.classList.add('hidden');
    return;
  }

  const matched = findFaqMatch(text);
  if (matched) {
    ansEl.textContent = matched.answer;
    box.classList.remove('hidden');
  } else {
    box.classList.add('hidden');
  }
}

function findFaqMatch(text) {
  const lower = text.toLowerCase();
  for (const faq of activeFaqs) {
    if (faq.keywords && Array.isArray(faq.keywords)) {
      let hits = 0;
      let hasDistinctive = false;
      for (const kw of faq.keywords) {
        const kwLower = kw.toLowerCase().trim();
        if (kwLower && lower.includes(kwLower)) {
          hits++;
          if (!genericStopwords.includes(kwLower) && kwLower.length >= 4) {
            hasDistinctive = true;
          }
        }
      }
      if (hits >= 2 && hasDistinctive) return faq;
    }
  }
  return null;
}

function handleStudentSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('pip-student-input');
  const content = input.value.trim();
  if (!content) return;

  // 1. Check local instant deflection match
  const localMatch = findFaqMatch(content);
  if (localMatch) {
    openPipEchoModal(localMatch.answer, localMatch.resolvedAt, localMatch.canonicalQuestion);
  }

  // 2. Send to WebSocket backend
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'student_submit_question',
      content: content,
      author: currentName,
      studentId: currentId
    }));
  }

  // 3. Record in personal sent history
  myQuestions.unshift({
    text: content,
    time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    deflected: !!localMatch
  });

  input.value = '';
  document.getElementById('pip-deflection-box').classList.add('hidden');
  renderStudentHistory();
}

function renderStudentHistory() {
  const list = document.getElementById('pip-my-history-list');
  const countTag = document.getElementById('pip-my-count');
  countTag.textContent = `${myQuestions.length} câu`;

  if (myQuestions.length === 0) {
    list.innerHTML = `<div style="text-align: center; padding: 20px; color: #64748b; font-size: 0.78rem;">Chưa gửi câu hỏi nào.</div>`;
    return;
  }

  list.innerHTML = myQuestions.map(q => `
    <div style="background: #131b2e; border: 1px solid #1e293b; border-radius: 8px; padding: 10px; margin-bottom: 8px;">
      <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: #94a3b8; margin-bottom: 4px;">
        <span>${q.time}</span>
        ${q.deflected ? '<span style="color: #34d399; font-weight: 700;">⚡ Đã nhận đáp án tức thì</span>' : '<span style="color: #38bdf8;">Đã gửi tới Thầy</span>'}
      </div>
      <div style="font-size: 0.82rem; color: #f8fafc;">${escapeHTML(q.text)}</div>
    </div>
  `).join('');
}

function renderStudentFaqs() {
  const list = document.getElementById('pip-faqs-list');
  const countTag = document.getElementById('count-pip-faqs');
  countTag.textContent = activeFaqs.length;

  if (activeFaqs.length === 0) {
    list.innerHTML = `<div style="text-align: center; padding: 24px; color: #64748b; font-size: 0.8rem;">Chưa có câu hỏi nào được giải thích chính thức.</div>`;
    return;
  }

  list.innerHTML = activeFaqs.map(faq => `
    <div style="background: #131b2e; border: 1px solid #1e293b; border-left: 3px solid #10b981; border-radius: 8px; padding: 10px; margin-bottom: 8px;">
      <div style="font-size: 0.84rem; font-weight: 700; color: #f8fafc; margin-bottom: 4px;">${escapeHTML(faq.canonicalQuestion)}</div>
      <div style="font-size: 0.78rem; color: #cbd5e1; line-height: 1.4; background: rgba(0,0,0,0.25); padding: 8px; border-radius: 6px;">
        ${escapeHTML(faq.answer)}
      </div>
      <div style="font-size: 0.68rem; color: #64748b; margin-top: 4px;">Giải thích lúc ${faq.resolvedAt || 'lớp học'}</div>
    </div>
  `).join('');
}

function openPipEchoModal(answer, time, title) {
  document.getElementById('pip-echo-answer').textContent = answer;
  document.getElementById('pip-echo-time').textContent = `GIẢNG VIÊN ĐÃ GIẢI THÍCH (${time || 'Trực tiếp'}):`;
  document.getElementById('modal-pip-echo').classList.remove('hidden');
}

function closePipEchoModal() {
  document.getElementById('modal-pip-echo').classList.add('hidden');
}

// =========================================================================
// LECTURER LOGIC (HOST COCKPIT IN PIP)
// =========================================================================

function addQuestionToLecturerClusters(question) {
  const text = question.content.toLowerCase();

  // Simple intent matching into clusters
  let matchedCluster = null;
  if (text.includes("hạn nộp") || text.includes("deadline") || text.includes("trễ")) {
    matchedCluster = lecturerClusters.find(c => c.id === 'c_deadline');
    if (!matchedCluster) {
      matchedCluster = { id: 'c_deadline', title: 'Hạn nộp bài Lab 2 và quy định nộp muộn', count: 0, quotes: [], keywords: ["hạn nộp", "deadline", "lab 2", "muộn"] };
      lecturerClusters.push(matchedCluster);
    }
  } else if (text.includes("cvat") || text.includes("cài đặt") || text.includes("port") || text.includes("docker")) {
    matchedCluster = lecturerClusters.find(c => c.id === 'c_cvat');
    if (!matchedCluster) {
      matchedCluster = { id: 'c_cvat', title: 'Lỗi cài đặt môi trường CVAT và xung đột cổng', count: 0, quotes: [], keywords: ["cvat", "cài đặt", "docker", "cổng 8080"] };
      lecturerClusters.push(matchedCluster);
    }
  } else {
    // Other cluster
    matchedCluster = lecturerClusters.find(c => c.id === 'c_other');
    if (!matchedCluster) {
      matchedCluster = { id: 'c_other', title: 'Thắc mắc chung bài tập & thực hành', count: 0, quotes: [], keywords: ["thực hành", "bài tập", "hỏi"] };
      lecturerClusters.push(matchedCluster);
    }
  }

  matchedCluster.count++;
  matchedCluster.quotes.push(question);
  renderLecturerClusters();

  // Velocity trigger check
  if (matchedCluster.count >= 3) {
    document.getElementById('pip-radar-alert').classList.remove('hidden');
  }
}

function renderLecturerClusters() {
  const list = document.getElementById('pip-clusters-list');
  document.getElementById('pip-lec-clusters').textContent = lecturerClusters.length;

  if (lecturerClusters.length === 0) {
    list.innerHTML = `<div style="text-align: center; padding: 28px; color: #64748b; font-size: 0.8rem;">Đang lắng nghe câu hỏi từ học viên trong lớp...</div>`;
    return;
  }

  list.innerHTML = lecturerClusters.map(c => `
    <div class="pip-cluster-card ${c.count >= 3 ? 'urgent' : ''}">
      <div class="pip-cluster-head">
        <span style="font-size: 0.72rem; color: #38bdf8; font-weight: 700;">🔥 ${c.count} câu hỏi</span>
        ${c.answered ? '<span style="font-size: 0.7rem; color: #34d399; font-weight: 700;">✓ Đã giải thích</span>' : ''}
      </div>
      <div class="pip-cluster-title">${escapeHTML(c.title)}</div>
      <div style="font-size: 0.68rem; color: #a5b4fc; display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
        <span>🤖 ${c.modelSource || 'AI Engine'}</span>
        <span>⚡ ${c.latencyMs || '~0.3s'}</span>
      </div>
      <div class="pip-cluster-actions">
        ${!c.answered ? `
          <button class="btn-pip-explain" onclick="openPipExplainModal('${c.id}')">
            🎙️ Giải thích
          </button>
        ` : `
          <span style="font-size: 0.72rem; color: #34d399;">⚡ Đang tự động trả lời cho học viên hỏi lại</span>
        `}
      </div>
    </div>
  `).join('');
}

function openPipExplainModal(clusterId) {
  const cluster = lecturerClusters.find(c => c.id === clusterId);
  if (!cluster) return;
  activeExplainingCluster = cluster;

  document.getElementById('pip-explain-cluster-name').textContent = `Chủ đề: ${cluster.title}`;
  document.getElementById('pip-explain-text').value = '';
  document.getElementById('modal-pip-explain').classList.remove('hidden');
}

function closePipExplainModal() {
  if (recognition) {
    try { recognition.stop(); } catch (e) {}
  }
  document.getElementById('modal-pip-explain').classList.add('hidden');
  activeExplainingCluster = null;
}

function togglePipMic() {
  const btn = document.getElementById('btn-pip-mic');
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Trình duyệt không hỗ trợ Web Speech API. Bạn có thể gõ chữ trực tiếp.");
    return;
  }

  if (recognition) {
    recognition.stop();
    recognition = null;
    btn.textContent = '🎙️ Bật Micro nói trực tiếp';
    btn.style.background = '';
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'vi-VN';
  recognition.continuous = true;
  recognition.interimResults = true;

  btn.textContent = '🔴 Đang lắng nghe giọng Thầy...';
  btn.style.background = '#ef4444';

  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      transcript += event.results[i][0].transcript;
    }
    document.getElementById('pip-explain-text').value = transcript;
  };

  recognition.onerror = () => {
    btn.textContent = '🎙️ Bật Micro nói trực tiếp';
    btn.style.background = '';
    recognition = null;
  };

  recognition.start();
}

function confirmPipExplanation() {
  const text = document.getElementById('pip-explain-text').value.trim();
  if (!text) {
    alert("Vui lòng nói vào micro hoặc gõ lời giải thích!");
    return;
  }

  if (activeExplainingCluster) {
    activeExplainingCluster.answered = true;
    const resolvedAt = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

    const newFaq = {
      id: `FAQ_${Date.now()}`,
      canonicalQuestion: activeExplainingCluster.title,
      answer: text,
      resolvedAt: resolvedAt,
      keywords: activeExplainingCluster.keywords || ["lab 2", "deadline", "hạn nộp"]
    };

    // Broadcast over WebSocket to all student companions
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'broadcast_faq_resolved',
        faq: newFaq
      }));
    }

    renderLecturerClusters();
    showNotificationToast(`✓ Đã lưu FAQ & Kích hoạt Auto-Reply cho toàn bộ học viên!`);
  }

  closePipExplainModal();
}

// =========================================================================
// UTILITIES
// =========================================================================

function showNotificationToast(text) {
  const toast = document.getElementById('pip-toast');
  const toastText = document.getElementById('pip-toast-text');
  toastText.textContent = text;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 4000);
}

function openFullscreenStage() {
  const stageUrl = `/room?role=${encodeURIComponent(currentRole)}&name=${encodeURIComponent(currentName)}&id=${encodeURIComponent(currentId)}`;
  window.open(stageUrl, '_blank');
}

function escapeHTML(str) {
  return (str || '').replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

function exportCompanionState() {
  return {
    currentRole,
    currentName,
    currentId,
    activeFaqs,
    myQuestions,
    lecturerClusters,
    totalLecMsgs,
    totalEchoShielded,
    draftQuestion: document.getElementById('pip-student-input')?.value || '',
    explanationDraft: document.getElementById('pip-explain-text')?.value || ''
  };
}

function restoreCompanionState(state) {
  if (!state || typeof state !== 'object') return;

  currentRole = state.currentRole || currentRole;
  currentName = state.currentName || currentName;
  currentId = state.currentId || currentId;
  activeFaqs = Array.isArray(state.activeFaqs) ? state.activeFaqs : activeFaqs;
  myQuestions = Array.isArray(state.myQuestions) ? state.myQuestions : myQuestions;
  lecturerClusters = Array.isArray(state.lecturerClusters) ? state.lecturerClusters : lecturerClusters;
  totalLecMsgs = Number.isFinite(state.totalLecMsgs) ? state.totalLecMsgs : totalLecMsgs;
  totalEchoShielded = Number.isFinite(state.totalEchoShielded) ? state.totalEchoShielded : totalEchoShielded;

  const nameEl = document.getElementById('pip-user-name');
  if (nameEl) nameEl.textContent = currentName;

  const questionInput = document.getElementById('pip-student-input');
  const explanationInput = document.getElementById('pip-explain-text');
  if (questionInput && typeof state.draftQuestion === 'string') questionInput.value = state.draftQuestion;
  if (explanationInput && typeof state.explanationDraft === 'string') explanationInput.value = state.explanationDraft;

  if (window.engine && Array.isArray(lecturerClusters)) {
    window.engine.clusters = lecturerClusters;
  }

  if (currentRole === 'student') {
    renderStudentHistory();
    renderStudentFaqs();
  } else {
    const messagesEl = document.getElementById('pip-lec-msgs');
    const echoEl = document.getElementById('pip-lec-echo');
    if (messagesEl) messagesEl.textContent = totalLecMsgs;
    if (echoEl) echoEl.textContent = totalEchoShielded;
    renderLecturerClusters();
  }
}

function suspendCompanion() {
  connectionSuspended = true;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;

  if (recognition) {
    try { recognition.stop(); } catch (error) {}
    recognition = null;
  }

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    ws.close(1000, 'Document PiP handoff');
  }
}

function resumeCompanion() {
  connectionSuspended = false;
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    connectWebSocket();
  }
}

window.curatorCompanionAdapter = {
  exportState: exportCompanionState,
  restoreState: restoreCompanionState,
  suspend: suspendCompanion,
  resume: resumeCompanion,
  getRole: () => currentRole,
  isConnected: () => !!ws && ws.readyState === WebSocket.OPEN
};
