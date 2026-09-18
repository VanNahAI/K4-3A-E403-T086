const { evaluateMessageBoundary } = require('./message_boundary');

const DEFAULT_API_BASE = 'https://desktop-qo8dvfq.tail55f3d4.ts.net/v1';
const DEFAULT_MODEL = 'qwen3:8b';
const MAX_QUESTION_LENGTH = 2000;
const MAX_CLUSTERS = 20;
const MAX_KEYWORDS = 5;
const MAX_CACHE_ENTRIES = 500;
const MAX_SAMPLES = 500;

class QwenProxyError extends Error {
  constructor(message, statusCode = 502, code = 'QWEN_UPSTREAM_ERROR', boundary = null) {
    super(message);
    this.name = 'QwenProxyError';
    this.statusCode = statusCode;
    this.code = code;
    this.boundary = boundary;
  }
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getConfig(env = process.env) {
  return {
    apiBase: (env.QWEN_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, ''),
    apiKey: (env.QWEN_API_KEY || '').trim(),
    model: (env.QWEN_MODEL || DEFAULT_MODEL).trim(),
    healthTimeoutMs: positiveInt(env.QWEN_HEALTH_TIMEOUT_MS, 5000),
    warmupTimeoutMs: positiveInt(env.QWEN_WARMUP_TIMEOUT_MS, 30000),
    timeoutMs: positiveInt(env.QWEN_TIMEOUT_MS, 8000)
  };
}

function requireConfigured(config) {
  if (!config.apiKey) throw new QwenProxyError('Qwen3 chưa được cấu hình trên server.', 503, 'QWEN_NOT_CONFIGURED');
}

function compactClusters(rawClusters) {
  if (!Array.isArray(rawClusters)) return [];
  return rawClusters.map((cluster, index) => ({ cluster, index }))
    .sort((a, b) => Number(b.cluster?.count || 0) - Number(a.cluster?.count || 0))
    .slice(0, MAX_CLUSTERS)
    .map(({ cluster, index }) => {
      const id = typeof cluster?.id === 'string' ? cluster.id.trim().slice(0, 160) : '';
      const title = typeof cluster?.title === 'string' ? cluster.title.trim().slice(0, 240) : '';
      if (!id || !title) throw new QwenProxyError(`Cụm câu hỏi tại vị trí ${index} thiếu id hoặc title.`, 400, 'INVALID_CLUSTERS');
      const keywords = Array.isArray(cluster.keywords)
        ? cluster.keywords.filter((item) => typeof item === 'string' && item.trim()).slice(0, MAX_KEYWORDS).map((item) => item.trim().slice(0, 80))
        : [];
      return { id, title, keywords };
    });
}

function validateInput(payload) {
  const question = typeof payload?.question === 'string' ? payload.question.trim() : '';
  const questionId = typeof payload?.questionId === 'string' ? payload.questionId.trim() : '';
  if (!question || question.length > MAX_QUESTION_LENGTH) throw new QwenProxyError(`Câu hỏi phải có từ 1 đến ${MAX_QUESTION_LENGTH} ký tự.`, 400, 'INVALID_QUESTION');
  if (!questionId || questionId.length > 160) throw new QwenProxyError('questionId không hợp lệ.', 400, 'INVALID_QUESTION_ID');
  return { question, questionId, clusters: compactClusters(payload.clusters), forceBoundary: payload?.forceBoundary === true };
}

function buildClassificationMessages(question, clusters) {
  return [
    { role: 'system', content: 'Phân loại câu hỏi workshop công nghệ. Chỉ trả JSON theo schema. matchedClusterId chỉ được là một id có trong C; tuyệt đối không tự tạo id. Nếu C rỗng hoặc câu hỏi mới, matchedClusterId=null và tiêu đề dưới 10 từ. Không giải thích.' },
    { role: 'user', content: `Q=${JSON.stringify(question)}\nC=${JSON.stringify(clusters)}\nSchema={"matchedClusterId":string|null,"suggestedTitle":string|null,"keywords":string[],"category":string,"confidence":number}` }
  ];
}

function parseClassification(rawContent, clusters) {
  if (typeof rawContent !== 'string' || !rawContent.trim()) throw new QwenProxyError('Qwen3 trả về nội dung rỗng.', 502, 'INVALID_MODEL_RESPONSE');
  let parsed;
  try { parsed = JSON.parse(rawContent.replace(/```json/gi, '').replace(/```/g, '').trim()); }
  catch { throw new QwenProxyError('Qwen3 trả về JSON không hợp lệ.', 502, 'INVALID_MODEL_RESPONSE'); }
  const allowedIds = new Set(clusters.map((cluster) => cluster.id));
  const rawMatchedId = parsed.matchedClusterId == null ? '' : String(parsed.matchedClusterId).trim();
  const matchedClusterId = !rawMatchedId || rawMatchedId.toLowerCase() === 'null' ? null : rawMatchedId;
  if (matchedClusterId && !allowedIds.has(matchedClusterId)) throw new QwenProxyError('Qwen3 trả về matchedClusterId không tồn tại.', 502, 'INVALID_MODEL_RESPONSE');
  const suggestedTitle = typeof parsed.suggestedTitle === 'string' ? parsed.suggestedTitle.trim().slice(0, 160) : '';
  if (!matchedClusterId && !suggestedTitle) throw new QwenProxyError('Qwen3 không trả về tiêu đề cho cụm mới.', 502, 'INVALID_MODEL_RESPONSE');
  const keywords = Array.isArray(parsed.keywords) ? parsed.keywords.filter((item) => typeof item === 'string' && item.trim()).slice(0, MAX_KEYWORDS).map((item) => item.trim().slice(0, 80)) : [];
  if (!keywords.length) throw new QwenProxyError('Qwen3 không trả về từ khóa hợp lệ.', 502, 'INVALID_MODEL_RESPONSE');
  const confidence = Number(parsed.confidence);
  return {
    matchedClusterId,
    suggestedTitle: matchedClusterId ? null : suggestedTitle,
    keywords,
    category: typeof parsed.category === 'string' && parsed.category.trim() ? parsed.category.trim().slice(0, 80) : 'technical',
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.9
  };
}

function percentile(samples, value) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(value / 100 * sorted.length) - 1)];
}

function createQwenProxy({ env = process.env, fetchImpl = global.fetch } = {}) {
  const config = getConfig(env);
  const classificationCache = new Map();
  let metrics;
  function resetMetrics() { metrics = { requests: 0, upstreamCalls: 0, cacheHits: 0, failures: 0, tokens: 0, warmups: 0, warmupLatencyMs: null, latencySamples: [] }; }
  resetMetrics();
  function addLatency(value) { metrics.latencySamples.push(value); if (metrics.latencySamples.length > MAX_SAMPLES) metrics.latencySamples.shift(); }
  function getMetrics() {
    const samples = metrics.latencySamples;
    return { requests: metrics.requests, upstreamCalls: metrics.upstreamCalls, cacheHits: metrics.cacheHits, failures: metrics.failures, tokens: metrics.tokens, warmups: metrics.warmups, warmupLatencyMs: metrics.warmupLatencyMs, lastLatencyMs: samples.at(-1) ?? null, p50LatencyMs: percentile(samples, 50), p95LatencyMs: percentile(samples, 95), sampleCount: samples.length };
  }

  async function fetchUpstream(pathname, options = {}, timeoutMs = config.timeoutMs) {
    requireConfigured(config);
    const startedAt = Date.now();
    let response;
    try {
      response = await fetchImpl(`${config.apiBase}${pathname}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}`, ...(options.headers || {}) }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new QwenProxyError(timedOut ? 'Qwen3 phản hồi quá thời gian cho phép.' : 'Không thể kết nối tới Qwen3.', timedOut ? 504 : 502, timedOut ? 'QWEN_TIMEOUT' : 'QWEN_UNREACHABLE');
    }
    if (!response.ok) throw new QwenProxyError(response.status === 401 || response.status === 403 ? 'Qwen3 từ chối thông tin xác thực.' : 'Qwen3 trả về lỗi từ dịch vụ upstream.', 502, response.status === 401 || response.status === 403 ? 'QWEN_AUTH_FAILED' : 'QWEN_UPSTREAM_ERROR');
    let json;
    try { json = await response.json(); } catch { throw new QwenProxyError('Qwen3 trả về phản hồi không phải JSON.', 502, 'INVALID_MODEL_RESPONSE'); }
    return { json, latencyMs: Date.now() - startedAt };
  }

  async function health() {
    const { json, latencyMs } = await fetchUpstream('/models', { method: 'GET' }, config.healthTimeoutMs);
    if (!Array.isArray(json.data) || !json.data.some((item) => item?.id === config.model)) throw new QwenProxyError('Không tìm thấy model Qwen3 đã cấu hình.', 502, 'QWEN_MODEL_NOT_FOUND');
    return { configured: true, reachable: true, model: config.model, latencyMs };
  }

  async function chat(messages, timeoutMs, recordLatency = true) {
    metrics.upstreamCalls++;
    const { json, latencyMs } = await fetchUpstream('/chat/completions', { method: 'POST', body: JSON.stringify({ model: config.model, messages, temperature: 0, max_tokens: 128, stream: false, reasoning_effort: 'none', response_format: { type: 'json_object' } }) }, timeoutMs);
    const tokensUsed = Number.isFinite(json?.usage?.total_tokens) ? json.usage.total_tokens : 0;
    metrics.tokens += tokensUsed;
    if (recordLatency) addLatency(latencyMs);
    return { json, latencyMs, tokensUsed };
  }

  async function warmup() {
    try {
      const { latencyMs } = await chat([{ role: 'user', content: 'Trả đúng JSON: {"ok":true}' }], config.warmupTimeoutMs, false);
      metrics.warmups++;
      metrics.warmupLatencyMs = latencyMs;
      return { ok: true, model: config.model, latencyMs };
    } catch (error) { metrics.failures++; throw error; }
  }

  async function classifyUncached(input, boundary) {
    const { json, latencyMs, tokensUsed } = await chat(buildClassificationMessages(input.question, input.clusters), config.timeoutMs);
    return { ok: true, result: parseClassification(json?.choices?.[0]?.message?.content, input.clusters), boundary, meta: { model: config.model, latencyMs, tokensUsed, cacheHit: false } };
  }

  async function classify(payload) {
    metrics.requests++;
    const input = validateInput(payload);
    const boundary = evaluateMessageBoundary(input.question);
    if (input.forceBoundary && boundary.decision !== 'review') {
      throw new QwenProxyError('forceBoundary chỉ hợp lệ với tin nhắn cần duyệt.', 422, 'INVALID_BOUNDARY_OVERRIDE', boundary);
    }
    const permitted = boundary.decision === 'allow' || (boundary.decision === 'review' && input.forceBoundary);
    if (!permitted) throw new QwenProxyError('Tin nhắn không được phép gọi Qwen3.', 422, boundary.decision === 'review' ? 'BOUNDARY_REVIEW_REQUIRED' : 'BOUNDARY_REJECTED', boundary);
    const cacheKey = `${input.questionId}\u0000${input.question}\u0000${input.forceBoundary}`;
    if (classificationCache.has(cacheKey)) {
      metrics.cacheHits++;
      const cached = await classificationCache.get(cacheKey);
      return { ...cached, meta: { ...cached.meta, cacheHit: true } };
    }
    if (classificationCache.size >= MAX_CACHE_ENTRIES) classificationCache.delete(classificationCache.keys().next().value);
    const pending = classifyUncached(input, boundary).catch((error) => { classificationCache.delete(cacheKey); metrics.failures++; throw error; });
    classificationCache.set(cacheKey, pending);
    return pending;
  }

  function reset() { classificationCache.clear(); resetMetrics(); }
  return { classify, health, warmup, getMetrics, reset, config: { ...config, apiKey: config.apiKey ? '[configured]' : '', apiBase: '[hidden]' } };
}

module.exports = { QwenProxyError, createQwenProxy, getConfig, parseClassification, validateInput, compactClusters };
