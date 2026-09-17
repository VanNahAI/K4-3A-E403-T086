const DEFAULT_API_BASE = 'https://desktop-qo8dvfq.tail55f3d4.ts.net/v1';
const DEFAULT_MODEL = 'qwen3:8b';
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_QUESTION_LENGTH = 2000;
const MAX_CLUSTERS = 50;
const MAX_CACHE_ENTRIES = 500;

class QwenProxyError extends Error {
  constructor(message, statusCode = 502, code = 'QWEN_UPSTREAM_ERROR') {
    super(message);
    this.name = 'QwenProxyError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function getConfig(env = process.env) {
  const parsedTimeout = Number.parseInt(env.QWEN_TIMEOUT_MS || '', 10);
  return {
    apiBase: (env.QWEN_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, ''),
    apiKey: (env.QWEN_API_KEY || '').trim(),
    model: (env.QWEN_MODEL || DEFAULT_MODEL).trim(),
    timeoutMs: Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? parsedTimeout
      : DEFAULT_TIMEOUT_MS
  };
}

function requireConfigured(config) {
  if (!config.apiKey) {
    throw new QwenProxyError(
      'Qwen3 chưa được cấu hình trên server.',
      503,
      'QWEN_NOT_CONFIGURED'
    );
  }
}

function compactClusters(rawClusters) {
  if (!Array.isArray(rawClusters)) return [];
  if (rawClusters.length > MAX_CLUSTERS) {
    throw new QwenProxyError(
      `Chỉ chấp nhận tối đa ${MAX_CLUSTERS} cụm câu hỏi.`,
      400,
      'INVALID_CLUSTERS'
    );
  }

  return rawClusters.map((cluster, index) => {
    const id = typeof cluster?.id === 'string' ? cluster.id.trim().slice(0, 160) : '';
    const title = typeof cluster?.title === 'string' ? cluster.title.trim().slice(0, 240) : '';
    if (!id || !title) {
      throw new QwenProxyError(
        `Cụm câu hỏi tại vị trí ${index} thiếu id hoặc title.`,
        400,
        'INVALID_CLUSTERS'
      );
    }

    const keywords = Array.isArray(cluster.keywords)
      ? cluster.keywords
          .filter((keyword) => typeof keyword === 'string' && keyword.trim())
          .slice(0, 8)
          .map((keyword) => keyword.trim().slice(0, 80))
      : [];

    return { id, title, keywords };
  });
}

function validateInput(payload) {
  const question = typeof payload?.question === 'string' ? payload.question.trim() : '';
  const questionId = typeof payload?.questionId === 'string' ? payload.questionId.trim() : '';

  if (!question || question.length > MAX_QUESTION_LENGTH) {
    throw new QwenProxyError(
      `Câu hỏi phải có từ 1 đến ${MAX_QUESTION_LENGTH} ký tự.`,
      400,
      'INVALID_QUESTION'
    );
  }
  if (!questionId || questionId.length > 160) {
    throw new QwenProxyError(
      'questionId không hợp lệ.',
      400,
      'INVALID_QUESTION_ID'
    );
  }

  return {
    question,
    questionId,
    clusters: compactClusters(payload.clusters)
  };
}

function buildClassificationMessages(question, clusters) {
  const clusterData = clusters.length > 0
    ? JSON.stringify(clusters)
    : '[]';

  return [
    {
      role: 'system',
      content: [
        'Bạn là bộ phân loại câu hỏi tiếng Việt cho một workshop công nghệ.',
        'Chỉ trả về một JSON object hợp lệ, không markdown và không giải thích.',
        'Nếu câu hỏi cùng bản chất với một cụm có sẵn, matchedClusterId phải là id chính xác của cụm đó.',
        'Nếu là chủ đề mới, matchedClusterId phải là null và suggestedTitle phải ngắn gọn dưới 10 từ.',
        'keywords gồm 3 đến 5 từ khóa; confidence là số từ 0 đến 1.'
      ].join(' ')
    },
    {
      role: 'user',
      content: [
        `Câu hỏi: ${JSON.stringify(question)}`,
        `Các cụm hiện có: ${clusterData}`,
        'Schema bắt buộc: {"matchedClusterId": string|null, "suggestedTitle": string|null, "keywords": string[], "category": string, "confidence": number}'
      ].join('\n')
    }
  ];
}

function parseClassification(rawContent, clusters) {
  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    throw new QwenProxyError('Qwen3 trả về nội dung rỗng.', 502, 'INVALID_MODEL_RESPONSE');
  }

  let parsed;
  try {
    const clean = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
    parsed = JSON.parse(clean);
  } catch (error) {
    throw new QwenProxyError('Qwen3 trả về JSON không hợp lệ.', 502, 'INVALID_MODEL_RESPONSE');
  }

  const allowedIds = new Set(clusters.map((cluster) => cluster.id));
  const matchedClusterId = parsed.matchedClusterId === null || parsed.matchedClusterId === undefined
    ? null
    : String(parsed.matchedClusterId).trim();

  if (matchedClusterId && !allowedIds.has(matchedClusterId)) {
    throw new QwenProxyError('Qwen3 trả về matchedClusterId không tồn tại.', 502, 'INVALID_MODEL_RESPONSE');
  }

  const suggestedTitle = typeof parsed.suggestedTitle === 'string'
    ? parsed.suggestedTitle.trim().slice(0, 160)
    : '';
  if (!matchedClusterId && !suggestedTitle) {
    throw new QwenProxyError('Qwen3 không trả về tiêu đề cho cụm mới.', 502, 'INVALID_MODEL_RESPONSE');
  }

  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords
        .filter((keyword) => typeof keyword === 'string' && keyword.trim())
        .slice(0, 6)
        .map((keyword) => keyword.trim().slice(0, 80))
    : [];
  if (keywords.length === 0) {
    throw new QwenProxyError('Qwen3 không trả về từ khóa hợp lệ.', 502, 'INVALID_MODEL_RESPONSE');
  }

  const rawConfidence = Number(parsed.confidence);
  const confidence = Number.isFinite(rawConfidence)
    ? Math.min(1, Math.max(0, rawConfidence))
    : 0.9;

  return {
    matchedClusterId,
    suggestedTitle: matchedClusterId ? null : suggestedTitle,
    keywords,
    category: typeof parsed.category === 'string' && parsed.category.trim()
      ? parsed.category.trim().slice(0, 80)
      : 'technical',
    confidence
  };
}

function createQwenProxy({ env = process.env, fetchImpl = global.fetch } = {}) {
  const config = getConfig(env);
  const classificationCache = new Map();

  async function fetchUpstream(pathname, options = {}) {
    requireConfigured(config);
    const startedAt = Date.now();
    let response;

    try {
      response = await fetchImpl(`${config.apiBase}${pathname}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
          ...(options.headers || {})
        },
        signal: AbortSignal.timeout(config.timeoutMs)
      });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new QwenProxyError(
        timedOut ? 'Qwen3 phản hồi quá thời gian cho phép.' : 'Không thể kết nối tới Qwen3.',
        timedOut ? 504 : 502,
        timedOut ? 'QWEN_TIMEOUT' : 'QWEN_UNREACHABLE'
      );
    }

    if (!response.ok) {
      throw new QwenProxyError(
        response.status === 401 || response.status === 403
          ? 'Qwen3 từ chối thông tin xác thực.'
          : 'Qwen3 trả về lỗi từ dịch vụ upstream.',
        502,
        response.status === 401 || response.status === 403
          ? 'QWEN_AUTH_FAILED'
          : 'QWEN_UPSTREAM_ERROR'
      );
    }

    let json;
    try {
      json = await response.json();
    } catch (error) {
      throw new QwenProxyError('Qwen3 trả về phản hồi không phải JSON.', 502, 'INVALID_MODEL_RESPONSE');
    }

    return { json, latencyMs: Date.now() - startedAt };
  }

  async function health() {
    const { json, latencyMs } = await fetchUpstream('/models', { method: 'GET' });
    const models = Array.isArray(json.data) ? json.data : [];
    const modelAvailable = models.some((item) => item?.id === config.model);
    if (!modelAvailable) {
      throw new QwenProxyError('Không tìm thấy model Qwen3 đã cấu hình.', 502, 'QWEN_MODEL_NOT_FOUND');
    }

    return { configured: true, reachable: true, model: config.model, latencyMs };
  }

  async function classifyUncached(input) {
    const payload = {
      model: config.model,
      messages: buildClassificationMessages(input.question, input.clusters),
      temperature: 0.1,
      max_tokens: 256,
      stream: false,
      reasoning_effort: 'none',
      response_format: { type: 'json_object' }
    };

    const { json, latencyMs } = await fetchUpstream('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const content = json?.choices?.[0]?.message?.content;
    const result = parseClassification(content, input.clusters);

    return {
      ok: true,
      result,
      meta: {
        model: config.model,
        latencyMs,
        tokensUsed: Number.isFinite(json?.usage?.total_tokens) ? json.usage.total_tokens : null
      }
    };
  }

  async function classify(payload) {
    const input = validateInput(payload);
    const cacheKey = `${input.questionId}\u0000${input.question}`;
    if (classificationCache.has(cacheKey)) return classificationCache.get(cacheKey);

    if (classificationCache.size >= MAX_CACHE_ENTRIES) {
      classificationCache.delete(classificationCache.keys().next().value);
    }

    const pending = classifyUncached(input).catch((error) => {
      classificationCache.delete(cacheKey);
      throw error;
    });
    classificationCache.set(cacheKey, pending);
    return pending;
  }

  return { classify, health, config: { ...config, apiKey: config.apiKey ? '[configured]' : '' } };
}

module.exports = {
  QwenProxyError,
  createQwenProxy,
  getConfig,
  parseClassification,
  validateInput
};
