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
let activeSessionId = null;
let isSessionOpen = false;
const handledEchoQuestionIds = new Set();
const expandedClusterIds = new Set();

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
    document.getElementById('pip-ws-dot').className = 'status-dot';
    document.getElementById('pip-ws-text').textContent = 'Mất kết nối. Đang thử lại...';
    document.getElementById('pip-ws-text').style.color = '#f87171';
    setTimeout(connectWebSocket, 3000);
  };
}

async function handleServerMessage(msg) {
  switch (msg.type) {
    case 'connected':
      syncPipSession(msg.session);
      if (msg.activeFaqs && Array.isArray(msg.activeFaqs)) {
        activeFaqs = msg.activeFaqs;
        renderStudentFaqs();
      }
      break;

    case 'student_count':
    case 'online_students_count':
      const onlineEl = document.getElementById('pip-lec-online');
      if (onlineEl) onlineEl.textContent = msg.count || 1;
      break;

    case 'new_faq_available':
      // Broadcast from teacher
      if (msg.faq && !activeFaqs.some(faq => faq.id === msg.faq.id)) {
        activeFaqs.unshift(msg.faq);
        renderStudentFaqs();
        showNotificationToast(`🔔 Thầy vừa giải thích: "${msg.faq.canonicalQuestion}"`);
      }
      break;

    case 'faqs_refreshed':
      if (Array.isArray(msg.faqs)) {
        activeFaqs = msg.faqs;
        renderStudentFaqs();
      }
      break;

    case 'session_started':
      syncPipSession(msg.session, true);
      showNotificationToast('✓ Giảng viên đã mở phiên học mới.');
      break;

    case 'session_ended':
      syncPipSession(msg.session, true);
      break;

    case 'meeting_not_started':
      isSessionOpen = false;
      updatePipStudentAccess();
      break;

    case 'session_stale':
      window.location.reload();
      break;

    case 'instant_echo_reply':
      // Direct echo answer from server/AI
      openPipEchoModal(msg.answer, msg.resolvedAt, msg.faqTitle, msg.studentMsg);
      break;

    case 'new_student_question':
      // Lecturer view: incoming student question
      if (currentRole === 'lecturer' && msg.question) {
        totalLecMsgs++;
        document.getElementById('pip-lec-msgs').textContent = totalLecMsgs;
        if (msg.isEcho && msg.matchedFaq) {
          handledEchoQuestionIds.add(msg.question.id);
          totalEchoShielded++;
          document.getElementById('pip-lec-echo').textContent = totalEchoShielded;
          addQuestionToLecturerClusters(msg.question, msg.matchedFaq);
        } else if (window.engine) {
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
        if (!handledEchoQuestionIds.has(msg.question && msg.question.id)) {
          handledEchoQuestionIds.add(msg.question && msg.question.id);
          totalEchoShielded++;
          document.getElementById('pip-lec-echo').textContent = totalEchoShielded;
        }
      }
      break;
  }
}

function syncPipSession(session, forceClear = false) {
  if (!session || !session.sessionId) return;

  let storedSessionId = null;
  try {
    storedSessionId = localStorage.getItem('curator_active_session_id');
    localStorage.setItem('curator_active_session_id', session.sessionId);
  } catch (error) {
    // Continue in memory if storage is unavailable.
  }

  if (forceClear || (storedSessionId && storedSessionId !== session.sessionId)) {
    activeFaqs = [];
    myQuestions = [];
    lecturerClusters = [];
    totalLecMsgs = 0;
    totalEchoShielded = 0;
    handledEchoQuestionIds.clear();
    expandedClusterIds.clear();
    if (window.engine && typeof window.engine.clearAll === 'function') window.engine.clearAll();
    localStorage.setItem('curator_my_questions', '[]');
    renderStudentFaqs();
    renderStudentHistory();
    renderLecturerClusters();
  }

  activeSessionId = session.sessionId;
  isSessionOpen = Boolean(session.isOpen);
  updatePipStudentAccess();
}

function updatePipStudentAccess() {
  if (currentRole !== 'student') return;
  const input = document.getElementById('pip-student-input');
  const submit = document.getElementById('btn-pip-send');
  const banner = document.getElementById('pip-session-closed');
  const canAsk = isSessionOpen;
  if (input) input.disabled = !canAsk;
  if (submit) submit.disabled = !canAsk;
  if (banner) banner.classList.toggle('hidden', canAsk);
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
  const lower = normalizeFaqText(text);
  const questionTokens = new Set(lower.split(' ').filter(Boolean));
  let bestFaq = null;
  let bestScore = 0;

  for (const faq of activeFaqs) {
    const title = faq.canonicalQuestion || faq.originalClusterTitle || faq.title || '';
    const titleTokens = new Set(normalizeFaqText(title).split(' ').filter(Boolean));
    let score = 0;
    let exactHits = 0;
    let distinctiveHit = false;
    for (const term of [...(faq.keywords || []), title]) {
      const normalizedTerm = normalizeFaqText(term);
      if (!normalizedTerm || normalizedTerm.length < 2) continue;
      if (lower.includes(normalizedTerm)) {
        exactHits++;
        score += normalizedTerm.includes(' ') ? 1.5 : 1;
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
    if (exactHits >= 2 && distinctiveHit) score += 1;
    else if (!(exactHits >= 1 && titleOverlap >= 2 && distinctiveHit)) score = 0;

    if (score > bestScore) {
      bestScore = score;
      bestFaq = faq;
    }
  }
  return bestScore >= 2.5 ? bestFaq : null;
}

function normalizeFaqText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function handleStudentSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('pip-student-input');
  const content = input.value.trim();
  if (!content) return;
  if (!isSessionOpen) {
    showNotificationToast('🔒 Lớp chưa mở. Vui lòng chờ Giảng viên bắt đầu.');
    return;
  }

  // 1. Check local instant deflection match
  const localMatch = findFaqMatch(content);
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

  if (localMatch) {
    openPipEchoModal(localMatch.answer, localMatch.resolvedAt, localMatch.canonicalQuestion, content);
  }
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
        ${q.deflected ? '<span style="color: #34d399; font-weight: 700;">✓ Đã trả lời — xem Đáp án từ Thầy</span>' : '<span style="color: #38bdf8;">Đã gửi tới Thầy</span>'}
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

function openPipEchoModal(answer, time, title, studentMsg = '') {
  const normalizedQuestion = normalizeFaqText(studentMsg);
  if (normalizedQuestion) {
    const matchedQuestion = myQuestions.find(q => normalizeFaqText(q.text) === normalizedQuestion);
    if (matchedQuestion) matchedQuestion.deflected = true;
    renderStudentHistory();
  }

  document.getElementById('pip-echo-answer').textContent = answer;
  document.getElementById('pip-echo-time').textContent = `GIẢNG VIÊN ĐÃ GIẢI THÍCH (${time || 'Trực tiếp'}):`;
  document.getElementById('modal-pip-echo').classList.remove('hidden');
  showNotificationToast('✓ Câu hỏi của bạn đã được giảng viên trả lời. Xem lại trong “Đáp án từ Thầy”.');
}

function closePipEchoModal() {
  document.getElementById('modal-pip-echo').classList.add('hidden');
}

// =========================================================================
// LECTURER LOGIC (HOST COCKPIT IN PIP)
// =========================================================================

function addQuestionToLecturerClusters(question, matchedFaq = null) {
  if (matchedFaq) {
    let faqCluster = lecturerClusters.find(c => c.id === `faq_${matchedFaq.id}`);
    if (!faqCluster) {
      faqCluster = {
        id: `faq_${matchedFaq.id}`,
        title: matchedFaq.canonicalQuestion || 'Câu hỏi đã được giải đáp',
        count: 0,
        quotes: [],
        keywords: matchedFaq.keywords || [],
        answered: true,
        modelSource: 'Server FAQ Ground Truth'
      };
      lecturerClusters.push(faqCluster);
    }
    faqCluster.count++;
    faqCluster.quotes.push(question);
    renderLecturerClusters();
    return;
  }

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

  list.innerHTML = lecturerClusters.map(c => {
    const quotes = Array.isArray(c.quotes) ? c.quotes : [];
    const isExpanded = expandedClusterIds.has(c.id);
    return `
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
      ${quotes.length ? `
        <button class="pip-quotes-toggle" type="button" onclick="togglePipClusterQuotes('${c.id}')" aria-expanded="${isExpanded}">
          ${isExpanded ? 'Thu gọn' : 'Xem'} ${quotes.length} câu hỏi gốc ${isExpanded ? '▴' : '▾'}
        </button>
        <div class="pip-quotes-list ${isExpanded ? '' : 'hidden'}">
          ${quotes.map((quote, index) => `
            <div class="pip-quote-row">
              <div class="pip-quote-meta">
                <span>${index + 1}. ${escapeHTML(quote.user || quote.author || 'Học viên')}</span>
                <span>${escapeHTML(quote.timestamp || '')}</span>
              </div>
              <div class="pip-quote-content">${escapeHTML(quote.content || quote.text || '')}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
  }).join('');
}

function togglePipClusterQuotes(clusterId) {
  if (expandedClusterIds.has(clusterId)) expandedClusterIds.delete(clusterId);
  else expandedClusterIds.add(clusterId);
  renderLecturerClusters();
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
