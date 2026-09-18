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
let aiPipelineState = 'inactive';
let aiPipelineError = '';
let aiPendingQuestions = [];
let aiProcessedQuestionIds = new Set();
let aiReceivedQuestionIds = new Set();
let aiPipelineRestored = false;
let aiPipelineSuspended = false;
let aiDrainPromise = null;
let aiHealthPromise = null;
let aiWarmedUp = false;
let aiReviewQuestions = [];
let aiBoundaryHandledIds = new Set();
let aiMetrics = createEmptyAiMetrics();

function createEmptyAiMetrics() {
  return {
    total: 0, allow: 0, filter: 0, review: 0, block: 0,
    manualReviewSent: 0, manualReviewSkipped: 0,
    gateLatencies: [], qwenLatencies: [],
    qwenRequests: 0, upstreamCalls: 0, cacheHits: 0, failures: 0, tokens: 0
  };
}

function pushMetricSample(samples, value) {
  if (!Number.isFinite(value)) return;
  samples.push(value);
  if (samples.length > 500) samples.shift();
}

function metricPercentile(samples, value) {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(value / 100 * sorted.length) - 1)];
}

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
    window.engine = new UnifiedAIEngine(currentRole === 'lecturer' ? {
      provider: 'backend-qwen',
      strictLlm: true,
      backendClassifierUrl: '/api/ai/classify'
    } : {});
  }
  connectWebSocket();

  if (currentRole === 'lecturer') {
    if (!window.engine) {
      setAiPipelineState('paused', 'Không tải được AI Engine trong PiP.');
    } else {
      setTimeout(initializeAiPipeline, 0);
    }
  }
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
        if (!aiReceivedQuestionIds.has(msg.question.id)) {
          aiReceivedQuestionIds.add(msg.question.id);
          totalLecMsgs++;
          const messagesEl = document.getElementById('pip-lec-msgs');
          if (messagesEl) messagesEl.textContent = totalLecMsgs;
        }
        enqueueQuestionForAi(msg.question);
      }
      break;

    case 'echo_resolved_event':
      // Lecturer view: an echo was automatically deflected
      if (currentRole === 'lecturer') {
        totalEchoShielded++;
        const echoEl = document.getElementById('pip-lec-echo');
        if (echoEl) echoEl.textContent = totalEchoShielded;
      }
      break;

    case 'session_reset':
      resetAiSessionState();
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

function updateAiPipelineUi() {
  const container = document.getElementById('pip-ai-status');
  const title = document.getElementById('pip-ai-status-title');
  const detail = document.getElementById('pip-ai-status-detail');
  const retryButton = document.getElementById('btn-ai-retry');
  if (!container || !title || !detail || !retryButton) return;

  const queued = aiPendingQuestions.length;
  const queueText = queued > 0 ? ` · ${queued} câu đang chờ` : '';
  container.dataset.state = aiPipelineState;
  retryButton.classList.toggle('hidden', aiPipelineState !== 'paused');
  retryButton.disabled = aiPipelineState === 'connecting';

  if (aiPipelineState === 'ready') {
    title.textContent = 'Qwen3 sẵn sàng';
    detail.textContent = `Phân loại bằng model qwen3:8b${queueText}`;
  } else if (aiPipelineState === 'processing') {
    title.textContent = 'Qwen3 đang phân loại...';
    detail.textContent = `Đang xử lý tuần tự${queueText}`;
  } else if (aiPipelineState === 'paused') {
    title.textContent = 'Đã dừng phân loại';
    detail.textContent = `${aiPipelineError || 'Không thể kết nối Qwen3.'}${queueText}`;
  } else {
    title.textContent = 'Đang kết nối Qwen3...';
    detail.textContent = `Kiểm tra model trên backend${queueText}`;
  }
}

function setAiPipelineState(state, errorMessage = '') {
  aiPipelineState = state;
  aiPipelineError = errorMessage;
  updateAiPipelineUi();
}

async function checkAiHealth() {
  const response = await fetch('/api/ai/health', { cache: 'no-store' });
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {}

  if (!response.ok || !payload?.ok || !payload.reachable) {
    const healthError = new Error(payload?.error?.message || `Qwen3 health check failed (${response.status})`);
    healthError.code = payload?.error?.code || 'QWEN_HEALTH_FAILED';
    throw healthError;
  }
  return payload;
}

async function warmupAiModel() {
  const response = await fetch('/api/ai/warmup', { method: 'POST' });
  let payload = null;
  try { payload = await response.json(); } catch (error) {}
  if (!response.ok || !payload?.ok) {
    const warmupError = new Error(payload?.error?.message || `Qwen3 warm-up failed (${response.status})`);
    warmupError.code = payload?.error?.code || 'QWEN_WARMUP_FAILED';
    throw warmupError;
  }
  return payload;
}

async function initializeAiPipeline() {
  if (currentRole !== 'lecturer' || aiPipelineSuspended) return;
  if (!window.engine) {
    setAiPipelineState('paused', 'Không tải được AI Engine trong PiP.');
    return;
  }
  if (aiPipelineRestored && aiPipelineState === 'paused') {
    updateAiPipelineUi();
    return;
  }
  if (aiHealthPromise) return aiHealthPromise;

  setAiPipelineState('connecting');
  aiHealthPromise = checkAiHealth()
    .then(() => aiWarmedUp ? null : warmupAiModel())
    .then(async () => {
      aiWarmedUp = true;
      setAiPipelineState('ready');
      await drainAiQuestionQueue();
    })
    .catch((error) => {
      setAiPipelineState('paused', error.message);
    })
    .finally(() => {
      aiHealthPromise = null;
    });
  return aiHealthPromise;
}

function normalizeQueuedQuestion(question) {
  return {
    id: String(question.id || `QUESTION_${Date.now()}`),
    user: String(question.user || 'Học viên'),
    content: String(question.content || ''),
    timestamp: question.timestamp || '',
    clientId: question.clientId || '',
    forceBoundary: question.forceBoundary === true,
    boundaryChecked: question.boundaryChecked === true,
    boundary: question.boundary || null
  };
}

function enqueueQuestionForAi(question) {
  if (!question?.content) return;
  const normalized = normalizeQueuedQuestion(question);
  if (aiProcessedQuestionIds.has(normalized.id)) return;
  if (aiPendingQuestions.some((item) => item.id === normalized.id)) return;
  if (aiReviewQuestions.some((item) => item.id === normalized.id)) return;

  const boundaryApi = window.CuratorMessageBoundary;
  if (!boundaryApi?.evaluateMessageBoundary) {
    setAiPipelineState('paused', 'Không tải được admission gate.');
    return;
  }
  const boundary = boundaryApi.evaluateMessageBoundary(normalized.content);
  normalized.boundary = boundary;
  normalized.boundaryChecked = true;
  if (!aiBoundaryHandledIds.has(normalized.id)) {
    aiBoundaryHandledIds.add(normalized.id);
    aiMetrics.total++;
    aiMetrics[boundary.decision]++;
    pushMetricSample(aiMetrics.gateLatencies, boundary.latencyMs);
  }

  if (boundary.decision === 'allow') aiPendingQuestions.push(normalized);
  else if (boundary.decision === 'review') aiReviewQuestions.push(normalized);
  else aiProcessedQuestionIds.add(normalized.id);

  renderAiMetrics();
  renderReviewQueue();
  updateAiPipelineUi();
  if (boundary.decision === 'allow' && aiPipelineState === 'ready') drainAiQuestionQueue();
}

async function drainAiQuestionQueue() {
  if (aiDrainPromise || aiPipelineSuspended || aiPipelineState === 'paused') return aiDrainPromise;

  aiDrainPromise = (async () => {
    while (aiPendingQuestions.length > 0 && !aiPipelineSuspended && aiPipelineState !== 'paused') {
      const question = aiPendingQuestions[0];
      setAiPipelineState('processing');

      try {
        aiMetrics.qwenRequests++;
        const result = await window.engine.processMessage(question.content, question.user, {
          id: question.id,
          boundaryChecked: true,
          forceBoundary: question.forceBoundary === true
        });
        if (result?.type === 'review' || result?.type === 'filtered') {
          throw new Error('Boundary handoff không nhất quán.');
        }
        if (window.engine.lastCacheHit) aiMetrics.cacheHits++;
        else aiMetrics.upstreamCalls++;
        aiMetrics.tokens += Number(window.engine.lastTokensUsed) || 0;
        pushMetricSample(aiMetrics.qwenLatencies, Number(window.engine.lastLatencyMs) || 0);
        lecturerClusters = window.engine.clusters;
        aiProcessedQuestionIds.add(question.id);
        aiPendingQuestions.shift();
        renderLecturerClusters();
        renderAiMetrics();
        setAiPipelineState('ready');
      } catch (error) {
        aiMetrics.failures++;
        renderAiMetrics();
        setAiPipelineState('paused', error.message || 'Qwen3 không thể phân loại câu hỏi.');
        break;
      }
    }
  })().finally(() => {
    aiDrainPromise = null;
    updateAiPipelineUi();
  });

  return aiDrainPromise;
}

async function retryAiPipeline() {
  if (aiHealthPromise || aiPipelineSuspended) return;
  aiPipelineRestored = false;
  aiWarmedUp = false;
  setAiPipelineState('connecting');
  await initializeAiPipeline();
}

function renderAiMetrics() {
  const values = {
    'pip-lec-msgs': aiMetrics.total,
    'pip-metric-allow': aiMetrics.allow,
    'pip-metric-filter': aiMetrics.filter,
    'pip-metric-review': aiReviewQuestions.length,
    'pip-metric-block': aiMetrics.block,
    'pip-metric-qwen': aiMetrics.qwenRequests
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });
  const gateP95 = metricPercentile(aiMetrics.gateLatencies, 95);
  const qwenP95 = metricPercentile(aiMetrics.qwenLatencies, 95);
  const saved = aiMetrics.total ? Math.round(((aiMetrics.filter + aiMetrics.review + aiMetrics.block - aiMetrics.manualReviewSent) / aiMetrics.total) * 100) : 0;
  const gateEl = document.getElementById('pip-gate-p95');
  const qwenEl = document.getElementById('pip-qwen-p95');
  const savedEl = document.getElementById('pip-calls-saved');
  if (gateEl) gateEl.textContent = `${gateP95.toFixed(2)} ms`;
  if (qwenEl) qwenEl.textContent = qwenP95 ? `${Math.round(qwenP95)} ms` : '—';
  if (savedEl) savedEl.textContent = `${Math.max(0, saved)}%`;
}

function toggleReviewDrawer(forceOpen = null) {
  const drawer = document.getElementById('pip-review-drawer');
  if (!drawer) return;
  const shouldOpen = forceOpen === null ? drawer.classList.contains('hidden') : forceOpen;
  drawer.classList.toggle('hidden', !shouldOpen);
}

function renderReviewQueue() {
  const list = document.getElementById('pip-review-list');
  if (!list) return;
  if (!aiReviewQuestions.length) {
    list.innerHTML = '<div class="pip-review-empty">Không có tin nhắn cần duyệt.</div>';
    return;
  }
  list.innerHTML = aiReviewQuestions.map((question) => {
    const safeQuestionId = String(question.id).replace(/[^a-zA-Z0-9_.:-]/g, '');
    return `
    <article class="pip-review-item">
      <strong>${escapeHTML(question.user)}</strong>
      <p>${escapeHTML(question.content)}</p>
      <small>${escapeHTML(question.boundary?.reasonCode || 'ambiguous')}</small>
      <div class="pip-review-actions">
        <button type="button" onclick="submitReviewToQwen('${safeQuestionId}')">Gửi Qwen</button>
        <button type="button" class="secondary" onclick="skipReviewQuestion('${safeQuestionId}')">Bỏ qua</button>
      </div>
    </article>`;
  }).join('');
}

function submitReviewToQwen(questionId) {
  const index = aiReviewQuestions.findIndex((item) => item.id === questionId);
  if (index < 0) return;
  const [question] = aiReviewQuestions.splice(index, 1);
  question.forceBoundary = true;
  aiMetrics.manualReviewSent++;
  aiPendingQuestions.unshift(question);
  renderReviewQueue();
  renderAiMetrics();
  if (aiPipelineState === 'ready') drainAiQuestionQueue();
}

function skipReviewQuestion(questionId) {
  const index = aiReviewQuestions.findIndex((item) => item.id === questionId);
  if (index < 0) return;
  const [question] = aiReviewQuestions.splice(index, 1);
  aiProcessedQuestionIds.add(question.id);
  aiMetrics.manualReviewSkipped++;
  renderReviewQueue();
  renderAiMetrics();
}

function resetAiSessionState() {
  totalLecMsgs = 0;
  totalEchoShielded = 0;
  aiPendingQuestions = [];
  aiReviewQuestions = [];
  aiProcessedQuestionIds = new Set();
  aiReceivedQuestionIds = new Set();
  aiBoundaryHandledIds = new Set();
  aiMetrics = createEmptyAiMetrics();
  lecturerClusters = [];
  if (window.engine) {
    window.engine.clusters = [];
    window.engine.messages = [];
  }
  const messages = document.getElementById('pip-lec-msgs');
  const echo = document.getElementById('pip-lec-echo');
  if (messages) messages.textContent = '0';
  if (echo) echo.textContent = '0';
  renderAiMetrics();
  renderReviewQueue();
  renderLecturerClusters();
}

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
  const clusterCountEl = document.getElementById('pip-lec-clusters');
  if (clusterCountEl) clusterCountEl.textContent = lecturerClusters.length;

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
    aiPipelineState,
    aiPipelineError,
    aiPendingQuestions,
    aiReviewQuestions,
    aiBoundaryHandledIds: Array.from(aiBoundaryHandledIds),
    aiMetrics,
    aiWarmedUp,
    aiProcessedQuestionIds: Array.from(aiProcessedQuestionIds),
    aiReceivedQuestionIds: Array.from(aiReceivedQuestionIds),
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
  aiPipelineState = typeof state.aiPipelineState === 'string' ? state.aiPipelineState : aiPipelineState;
  aiPipelineError = typeof state.aiPipelineError === 'string' ? state.aiPipelineError : aiPipelineError;
  aiWarmedUp = state.aiWarmedUp === true;
  aiPendingQuestions = Array.isArray(state.aiPendingQuestions)
    ? state.aiPendingQuestions.map(normalizeQueuedQuestion)
    : aiPendingQuestions;
  aiReviewQuestions = Array.isArray(state.aiReviewQuestions)
    ? state.aiReviewQuestions.map(normalizeQueuedQuestion)
    : aiReviewQuestions;
  aiBoundaryHandledIds = new Set(Array.isArray(state.aiBoundaryHandledIds) ? state.aiBoundaryHandledIds : []);
  if (state.aiMetrics && typeof state.aiMetrics === 'object') {
    aiMetrics = { ...createEmptyAiMetrics(), ...state.aiMetrics };
    aiMetrics.gateLatencies = Array.isArray(state.aiMetrics.gateLatencies) ? state.aiMetrics.gateLatencies.slice(-500) : [];
    aiMetrics.qwenLatencies = Array.isArray(state.aiMetrics.qwenLatencies) ? state.aiMetrics.qwenLatencies.slice(-500) : [];
  }
  aiProcessedQuestionIds = new Set(Array.isArray(state.aiProcessedQuestionIds) ? state.aiProcessedQuestionIds : []);
  aiReceivedQuestionIds = new Set(Array.isArray(state.aiReceivedQuestionIds) ? state.aiReceivedQuestionIds : []);
  aiPipelineRestored = true;

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
    renderAiMetrics();
    renderReviewQueue();
    updateAiPipelineUi();
    if (aiPipelineState !== 'paused') setTimeout(initializeAiPipeline, 0);
  }
}

function suspendCompanion() {
  connectionSuspended = true;
  aiPipelineSuspended = true;
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
  aiPipelineSuspended = false;
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    connectWebSocket();
  }
  if (currentRole === 'lecturer' && aiPipelineState !== 'paused') initializeAiPipeline();
}

window.curatorCompanionAdapter = {
  exportState: exportCompanionState,
  restoreState: restoreCompanionState,
  suspend: suspendCompanion,
  resume: resumeCompanion,
  getRole: () => currentRole,
  isConnected: () => !!ws && ws.readyState === WebSocket.OPEN
};
