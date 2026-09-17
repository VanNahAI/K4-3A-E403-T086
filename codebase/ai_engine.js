/**
 * Workshop Question Curator — Unified AI Engine (ai_engine.js)
 * Supports:
 *   1. OpenRouter Mini Models (Cloud Instant Demo — OpenAI-compatible REST API)
 *   2. Local Ollama (localhost:11434)
 *   3. Intelligent Local Fallback Heuristics (Offline & Zero-Latency)
 *
 * Core Capabilities:
 *   - Semantic Clustering & Layer 1-4 Guardrails (HAX G1, G2, G9, G10, G11)
 *   - Live Lecturer Voice / Text Answer Extraction -> Canonical FAQ Ground Truth
 *   - Instant Echo-Responder: Intercepts subsequent student questions matching cached FAQs
 *   - Cháy Chat Radar: 30s velocity spike detector
 *   - 1-Click Discord K4 Post-Workshop Recap Generator
 *   - Thẻ Giám Khảo Live Sandbox Diagnostic for CP6
 */

const KNOWLEDGE_BASE = [
  {
    id: "cluster_deadline_lab2",
    title: "Hạn nộp và quy chế trễ hạn của Lab 2",
    keywords: ["lab 2", "lab2", "deadline", "hạn", "nộp muộn", "trễ", "muộn", "23h59", "23:59", "gia hạn"],
    baseConfidence: 0.94
  },
  {
    id: "cluster_cvat_step3",
    title: "Lỗi cài đặt CVAT & OPA bước 3 (Healthcheck 500)",
    keywords: ["cvat", "opa", "bước 3", "step 3", "policy bundle", "migration", "500", "health check", "docker"],
    baseConfidence: 0.92
  },
  {
    id: "cluster_zoom_syntax",
    title: "Cú pháp đặt tên tài khoản Zoom & Điểm danh Workshop",
    keywords: ["tên zoom", "đặt tên zoom", "cú pháp", "điểm danh ws", "điểm danh workshop", "myvinuni", "quét qr", "zoom", "qr"],
    baseConfidence: 0.89
  },
  {
    id: "cluster_team_formation",
    title: "Thời hạn & quy định thành lập đội nhóm tự do",
    keywords: ["đồng đội", "ghép đội", "lập team", "lập nhóm", "hạn tìm", "đội tự do", "thành viên", "bạn cùng nhóm"],
    baseConfidence: 0.91
  },
  {
    id: "cluster_xp_ranking",
    title: "Tra cứu điểm XP cá nhân & Lệnh /rank",
    keywords: ["điểm cộng", "xp", "/rank", "bảng xếp hạng", "xem điểm", "lịch sử xp", "thứ hạng"],
    baseConfidence: 0.93
  },
  {
    id: "cluster_standup_daily",
    title: "Khung giờ và quy định nộp Daily Standup (0h–10h)",
    keywords: ["daily-standup", "standup", "daly-standup", "0h-10h", "hết hạn standup", "quên nộp standup"],
    baseConfidence: 0.88
  }
];

const LOCAL_CLUSTER_MATCH_THRESHOLD = 3;
const SEMANTIC_STOPWORDS = new Set([
  "ai", "anh", "ba", "bai", "ban", "buoi", "cac", "cho", "chu", "co", "cua",
  "de", "duoc", "em", "gi", "hom", "hoi", "hoc", "la", "lam", "luc", "may",
  "minh", "mot", "nao", "nay", "nhung", "o", "phan", "sao", "thay", "the",
  "thi", "trong", "va", "ve", "voi"
]);
const GENERIC_ENTITY_TERMS = new Set([
  "lab", "lab 2", "lab2", "zoom", "workshop", "bai", "thuc hanh", "cvat", "docker"
]);

function normalizeSemanticText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferQuestionIntent(value) {
  const text = normalizeSemanticText(value);
  if (/deadline|han nop|nop (muon|tre)|gia han|tru diem/.test(text)) return "submission_deadline";
  if (/hoc gi|noi dung|chu de|agenda|chuong trinh|kien thuc.*hom nay/.test(text)) return "session_agenda";
  if (/ket thuc|tan hoc|hoc den|may gio (xong|nghi)|bao gio (xong|nghi)/.test(text)) return "session_end_time";
  if (/diem danh|quet qr|myvinuni|ten zoom|dat ten/.test(text)) return "attendance";
  if (/ghep doi|lap team|lap nhom|dong doi|thanh vien/.test(text)) return "team_formation";
  if (/diem xp|\/rank|xep hang|thu hang/.test(text)) return "xp_ranking";
  if (/(cvat|opa|docker).*(loi|error|500|port|health|migration)|(loi|error|500|port).*(cvat|opa|docker)/.test(text)) {
    return "technical_setup";
  }
  return null;
}

function meaningfulSemanticTokens(value) {
  return normalizeSemanticText(value)
    .split(" ")
    .filter(token => token.length >= 2 && !SEMANTIC_STOPWORDS.has(token));
}

function clusterSearchText(cluster) {
  const firstQuote = cluster && Array.isArray(cluster.quotes) && cluster.quotes[0]
    ? cluster.quotes[0].content
    : "";
  return [
    cluster && cluster.title,
    cluster && Array.isArray(cluster.keywords) ? cluster.keywords.join(" ") : "",
    firstQuote
  ].filter(Boolean).join(" ");
}

function scoreExistingClusterMatch(text, cluster) {
  const normalizedText = normalizeSemanticText(text);
  const quotes = Array.isArray(cluster.quotes) ? cluster.quotes : [];

  // Exact repeats must always stay in the same topic.
  if (quotes.some(quote => normalizeSemanticText(quote.content) === normalizedText)) return 100;

  const incomingIntent = inferQuestionIntent(text);
  const clusterIntent = inferQuestionIntent(clusterSearchText(cluster));
  if (incomingIntent && clusterIntent && incomingIntent !== clusterIntent) return 0;

  let score = incomingIntent && clusterIntent && incomingIntent === clusterIntent ? 4 : 0;
  const incomingTokens = new Set(meaningfulSemanticTokens(text));
  const clusterTokens = new Set(meaningfulSemanticTokens(clusterSearchText(cluster)));
  let overlap = 0;
  for (const token of incomingTokens) {
    if (clusterTokens.has(token)) overlap++;
  }
  score += Math.min(overlap, 4) * 1.2;

  for (const keyword of cluster.keywords || []) {
    const normalizedKeyword = normalizeSemanticText(keyword);
    if (!normalizedKeyword || GENERIC_ENTITY_TERMS.has(normalizedKeyword)) continue;
    if (normalizedText.includes(normalizedKeyword)) {
      score += normalizedKeyword.includes(" ") ? 2 : 1.5;
    }
  }

  return score;
}

function scoreKnowledgeBaseMatch(text, knowledgeItem) {
  const normalizedText = normalizeSemanticText(text);
  let score = 0;
  for (const keyword of knowledgeItem.keywords || []) {
    const normalizedKeyword = normalizeSemanticText(keyword);
    if (!normalizedKeyword || !normalizedText.includes(normalizedKeyword)) continue;
    if (GENERIC_ENTITY_TERMS.has(normalizedKeyword)) {
      score += 0.5;
    } else if (normalizedKeyword.includes(" ") || /^[0-9]{3,}$/.test(normalizedKeyword)) {
      score += 2.5;
    } else if (normalizedKeyword.length >= 5) {
      score += 2;
    } else {
      score += 1;
    }
  }
  return score;
}

class UnifiedAIEngine {
  constructor() {
    // OpenRouter / Model Config
    this.provider = localStorage.getItem('curator_provider') || 'openrouter'; // 'openrouter', 'ollama', 'mock'
    this.openRouterKey = localStorage.getItem('curator_openrouter_key') || '';
    this.openRouterModel = localStorage.getItem('curator_openrouter_model') || 'meta-llama/llama-3.2-3b-instruct:free';
    this.ollamaUrl = 'http://localhost:11434/v1';
    this.ollamaModel = 'qwen2.5:3b-instruct';

    // Core Data Stores
    this.messages = [];
    this.clusters = [];
    this.reviewQueue = [];
    this.filtered = [];
    this.answered = [];
    
    // Live Knowledge Cache & Echo-Responder
    this.resolvedFaqs = [];
    this.echoResolved = [];

    this.messageIdCounter = 1000;
    this.faqIdCounter = 1;

    // Radar Velocity Tracking: clusterId -> array of timestamps
    this.velocityTracker = {};
    this.activeRadarSpike = null;
    this.radarListeners = [];

    // Telemetry & Latency
    this.lastLatencyMs = 0;
    this.lastTokensUsed = 0;
  }

  setOpenRouterConfig(apiKey, model) {
    this.openRouterKey = apiKey ? apiKey.trim() : '';
    if (model) this.openRouterModel = model.trim();
    localStorage.setItem('curator_openrouter_key', this.openRouterKey);
    localStorage.setItem('curator_openrouter_model', this.openRouterModel);
  }

  setProvider(provider) {
    this.provider = provider;
    localStorage.setItem('curator_provider', provider);
  }

  onRadarSpike(callback) {
    this.radarListeners.push(callback);
  }

  notifyRadar(spikeData) {
    this.activeRadarSpike = spikeData;
    this.radarListeners.forEach(cb => cb(spikeData));
  }

  dismissRadar() {
    this.activeRadarSpike = null;
    this.radarListeners.forEach(cb => cb(null));
  }

  /**
   * Helper to call LLM via OpenRouter or Local Ollama
   */
  async callLLM(prompt, systemPrompt = "Bạn là trợ lý AI xử lý Q&A cho workshop khoá AI Thực Chiến AI20k.") {
    const startTime = Date.now();
    let url = "https://openrouter.ai/api/v1/chat/completions";
    let headers = { "Content-Type": "application/json" };
    let model = this.openRouterModel;

    if (this.provider === 'ollama') {
      url = `${this.ollamaUrl}/chat/completions`;
      model = this.ollamaModel;
    } else {
      if (!this.openRouterKey) {
        throw new Error("Chưa nhập OpenRouter API Key!");
      }
      headers["Authorization"] = `Bearer ${this.openRouterKey}`;
      headers["HTTP-Referer"] = "https://ai20k-workshop-curator.local";
      headers["X-Title"] = "Workshop Question Curator";
    }

    const payload = {
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      temperature: 0.2
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000)
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`LLM Error (${resp.status}): ${errText.substring(0, 120)}`);
    }

    const json = await resp.json();
    this.lastLatencyMs = Date.now() - startTime;
    if (json.usage) {
      this.lastTokensUsed = json.usage.total_tokens;
    }
    return json.choices[0].message.content.trim();
  }

  /**
   * Helper to perform intelligent semantic extraction and dynamic titling
   */
  extractSemanticFeatures(rawText) {
    let clean = rawText
      .replace(/^(thầy ơi\s*|cho em hỏi\s*|thầy cho em hỏi\s*|cho mình hỏi\s*|mọi người cho em hỏi\s*|ad ơi\s*|mọi người ơi\s*|thầy ơi\s*)+/gi, '')
      .replace(/^(làm sao để\s*|tại sao\s*|em muốn hỏi là\s*|cho hỏi\s*|em thắc mắc là\s*)+/gi, '')
      .replace(/(\s*ạ|\s*với ạ|\s*ạ thầy|\s*ạ mn|\s*nhé|\s*vậy ạ)+$/gi, '')
      .trim();

    if (clean.length < 5) clean = rawText.trim();
    clean = clean.charAt(0).toUpperCase() + clean.slice(1);

    const stopwords = [
      "lỗi", "em", "thầy", "cho", "hỏi", "bị", "là", "sao", "thế", "nào", "ạ",
      "với", "trong", "bài", "ở", "của", "và", "được", "không", "hôm", "nay",
      "buổi", "học", "gì", "lúc", "mấy"
    ];
    const words = clean.toLowerCase().split(/[,\.\?\!\s\(\)\:\;]+/).filter(w => w.length >= 3 && !stopwords.includes(w));
    const keywords = Array.from(new Set(words)).slice(0, 6);

    let title = clean;
    if (title.length > 55) {
      title = title.substring(0, 52) + "...";
    }

    return { title: `Vướng mắc: ${title}`, keywords: keywords };
  }

  /**
   * Semantic Analysis using OpenRouter / LLM
   */
  async analyzeWithLLM(text, existingClusters) {
    if (this.provider === 'mock' || (this.provider === 'openrouter' && !this.openRouterKey)) {
      return null;
    }

    const clustersSummary = existingClusters.map(c => `- [ID: ${c.id}] "${c.title}" (từ khóa: ${(c.keywords || []).join(', ')})`).join('\n');

    const prompt = `Bạn là hệ thống AI phân loại câu hỏi trong lớp học workshop công nghệ.
Học viên vừa gửi câu hỏi: "${text}"

Các nhóm câu hỏi hiện có trong lớp:
${clustersSummary || "(Chưa có nhóm nào)"}

Yêu cầu:
1. Nếu câu hỏi có cùng bản chất ngữ nghĩa với 1 nhóm có sẵn, trả về "matchedClusterId".
2. Nếu là chủ đề mới, hãy tạo "suggestedTitle" (dưới 10 từ, chuẩn hóa tiếng Việt, nêu rõ bản chất vấn đề) và trích xuất 3-5 "keywords".
3. Không được gom nhóm chỉ vì trùng các từ chung như "hôm nay", "buổi học", "Lab 02". Ví dụ "hôm nay học gì" và "hôm nay kết thúc lúc mấy giờ" là hai ý định khác nhau.

Chỉ trả về định dạng JSON thuần túy (không kèm giải thích hay markdown backticks):
{
  "matchedClusterId": null,
  "suggestedTitle": "Tiêu đề chuẩn hóa dưới 10 từ",
  "keywords": ["từ khóa 1", "từ khóa 2", "từ khóa 3"],
  "confidence": 0.94
}`;

    try {
      const response = await this.callLLM(prompt, "Bạn là AI phân tích ngữ nghĩa câu hỏi học tập, luôn trả về JSON hợp lệ.");
      const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      return parsed;
    } catch (err) {
      console.warn("LLM call skipped/failed, using intelligent local semantic extractor:", err.message);
      return null;
    }
  }

  /**
   * Process incoming student message with 4 difficulty layers
   * and Instant Echo-Reply matching.
   */
  async processMessage(rawText, author = null) {
    this.messageIdCounter++;
    const msgId = `M${this.messageIdCounter}`;
    const timestamp = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const user = author || `S${Math.floor(1000 + Math.random() * 9000)}`;

    const msgObj = {
      id: msgId,
      user: user,
      content: rawText.trim(),
      timestamp: timestamp,
      rawTimestampMs: Date.now()
    };

    this.messages.unshift(msgObj);
    const lower = rawText.toLowerCase().trim();

    // =========================================================================
    // LAYER ③ CHECK: Prompt Injection & Adversarial Tampering
    // =========================================================================
    const injectionPatterns = [
      "ignore all", "ignore previous", "delete all", "delete cluster",
      "system:", "drop table", "reply with hacked", "bỏ qua hướng dẫn",
      "xóa tất cả", "chiếm quyền", "đóng vai hacker"
    ];
    if (injectionPatterns.some(p => lower.includes(p))) {
      const item = {
        ...msgObj,
        reason: "Phát hiện Prompt Injection / Tấn công hệ thống (Layer ③)",
        category: "Adversarial Injection",
        layer: "③"
      };
      this.filtered.unshift(item);
      return { type: "filtered", data: item };
    }

    // =========================================================================
    // LAYER ③ CHECK: Greetings, Casual Banter, Off-Topic Spam
    // =========================================================================
    if (
      lower.startsWith("chào") || lower.startsWith("hello") || lower.startsWith("hi ") ||
      lower.includes("ăn cơm chưa") || lower.includes("đi vệ sinh") || lower.includes("chúc buổi học") ||
      lower === "." || lower === "..." || lower === "alo" || lower === "test" || lower.length < 2
    ) {
      const item = {
        ...msgObj,
        reason: "Tin nhắn chào hỏi / Ngoài phạm vi học thuật (Layer ③)",
        category: "Greeting / Off-topic",
        layer: "③"
      };
      this.filtered.unshift(item);
      return { type: "filtered", data: item };
    }

    // =========================================================================
    // ECHO-RESPONDER: Match against Live Resolved Knowledge Cache (FAQ Ground Truth)
    // =========================================================================
    const matchedFaq = this.matchWithResolvedFaqs(lower);
    if (matchedFaq) {
      const echoItem = {
        id: `ECHO_${Date.now()}_${Math.floor(Math.random() * 100)}`,
        studentMsg: msgObj,
        matchedFaq: matchedFaq,
        answerDelivered: matchedFaq.answer,
        timestamp: timestamp,
        confidence: 0.94
      };
      this.echoResolved.unshift(echoItem);
      return { type: "echo_resolved", data: echoItem };
    }

    // =========================================================================
    // LAYER ② CHECK: Ambiguous / Short / Lacking Context
    // =========================================================================
    if (
      rawText.length < 12 || 
      lower === "thầy ơi em chưa hiểu" || 
      lower.includes("nói lại đi") || 
      lower === "?" || 
      lower === "hả" || 
      lower === "chưa hiểu lắm ạ"
    ) {
      const item = {
        ...msgObj,
        title: `Yêu cầu làm rõ: "${rawText}"`,
        reason: "Câu hỏi thiếu ngữ cảnh cụ thể, cần người dạy làm rõ (Layer ②)",
        confidence: 0.65,
        layer: "②"
      };
      this.reviewQueue.unshift(item);
      return { type: "review", data: item };
    }

    // =========================================================================
    // LAYER ④ & SEMANTIC CLUSTERING (LLM & Semantic NLP)
    // =========================================================================
    let matchedCluster = null;
    let maxScore = 0;
    const modelBadge = this.provider === 'openrouter' && this.openRouterKey ? `OpenRouter Mini` : `AI Engine (Semantic NLP)`;
    const latencyText = this.lastLatencyMs ? `${(this.lastLatencyMs / 1000).toFixed(2)}s` : `~0.3s`;

    // 1. Attempt LLM analysis if provider active
    const llmResult = await this.analyzeWithLLM(rawText, this.clusters);
    if (llmResult && llmResult.matchedClusterId) {
      const cl = this.clusters.find(c => c.id === llmResult.matchedClusterId || c.clusterId === llmResult.matchedClusterId);
      const incomingIntent = inferQuestionIntent(rawText);
      const existingIntent = cl ? inferQuestionIntent(clusterSearchText(cl)) : null;
      if (cl && !(incomingIntent && existingIntent && incomingIntent !== existingIntent)) {
        matchedCluster = cl;
        maxScore = 10;
      }
    }

    // 2. If no LLM match, perform local semantic matching
    if (!matchedCluster) {
      for (const cl of this.clusters) {
        const score = scoreExistingClusterMatch(rawText, cl);
        if (score > maxScore) {
          maxScore = score;
          matchedCluster = cl;
        }
      }

      if (maxScore < LOCAL_CLUSTER_MATCH_THRESHOLD) {
        matchedCluster = null;
        maxScore = 0;
        for (const kb of KNOWLEDGE_BASE) {
          const score = scoreKnowledgeBaseMatch(rawText, kb);
          if (score > maxScore) {
            maxScore = score;
            matchedCluster = kb;
          }
        }
      }
    }

    if (matchedCluster && maxScore >= LOCAL_CLUSTER_MATCH_THRESHOLD) {
      let existing = this.clusters.find(c => c.clusterId === (matchedCluster.clusterId || matchedCluster.id) || c.id === matchedCluster.id);
      if (existing) {
        existing.count += 1;
        existing.lastUpdated = timestamp;
        existing.quotes.unshift(msgObj);
        existing.modelSource = modelBadge;
        existing.latencyMs = latencyText;

        this.trackVelocity(existing);
        this.sortClusters();
        return { type: "incremented", data: existing };
      } else {
        const newCluster = {
          id: `cluster_${Date.now()}_${Math.floor(Math.random() * 100)}`,
          clusterId: matchedCluster.id,
          title: matchedCluster.title,
          keywords: matchedCluster.keywords || [],
          count: 1,
          confidence: matchedCluster.baseConfidence || 0.91,
          lastUpdated: timestamp,
          quotes: [msgObj],
          modelSource: modelBadge,
          latencyMs: latencyText
        };
        this.clusters.push(newCluster);

        this.trackVelocity(newCluster);
        this.sortClusters();
        return { type: "new_cluster", data: newCluster };
      }
    }

    // 3. Dynamic new cluster via LLM or Semantic NLP
    let clusterTitle = "";
    let clusterKeywords = [];
    let conf = 0.88;

    if (llmResult && llmResult.suggestedTitle) {
      clusterTitle = llmResult.suggestedTitle;
      clusterKeywords = llmResult.keywords || [];
      conf = llmResult.confidence || 0.94;
    } else {
      const extracted = this.extractSemanticFeatures(rawText);
      clusterTitle = extracted.title;
      clusterKeywords = extracted.keywords;
    }

    const dynamicCluster = {
      id: `cluster_${Date.now()}_${this.messageIdCounter}`,
      clusterId: `custom_${Date.now()}_${this.messageIdCounter}`,
      title: clusterTitle,
      keywords: clusterKeywords,
      count: 1,
      confidence: conf,
      lastUpdated: timestamp,
      quotes: [msgObj],
      modelSource: modelBadge,
      latencyMs: latencyText
    };
    this.clusters.push(dynamicCluster);
    this.trackVelocity(dynamicCluster);
    this.sortClusters();
    return { type: "new_cluster", data: dynamicCluster };
  }

  /**
   * Check if incoming message matches any resolved FAQ
   */
  matchWithResolvedFaqs(lowerText) {
    if (this.resolvedFaqs.length === 0) return null;

    let bestFaq = null;
    let maxMatch = 0;

    for (const faq of this.resolvedFaqs) {
      const faqText = [faq.canonicalQuestion, faq.originalClusterTitle, ...(faq.keywords || [])]
        .filter(Boolean)
        .join(" ");
      const normalizedIncoming = normalizeSemanticText(lowerText);
      const normalizedQuestion = normalizeSemanticText(faq.canonicalQuestion || faq.originalClusterTitle);
      const incomingIntent = inferQuestionIntent(lowerText);
      const faqIntent = inferQuestionIntent(faqText);

      if (normalizedIncoming.length >= 12 && (
        normalizedIncoming === normalizedQuestion ||
        normalizedQuestion.endsWith(normalizedIncoming) ||
        normalizedIncoming.endsWith(normalizedQuestion)
      )) return faq;

      if (incomingIntent && faqIntent && incomingIntent !== faqIntent) continue;

      let hits = 0;
      for (const kw of faq.keywords) {
        if (lowerText.includes(kw.toLowerCase())) {
          hits += 1;
        }
      }
      if (hits > maxMatch) {
        maxMatch = hits;
        bestFaq = faq;
      }

      const faqTokens = new Set(meaningfulSemanticTokens(faqText));
      const overlap = meaningfulSemanticTokens(lowerText).filter(token => faqTokens.has(token)).length;
      const semanticScore = overlap + (incomingIntent && faqIntent && incomingIntent === faqIntent ? 2 : 0);
      if (semanticScore > maxMatch) {
        maxMatch = semanticScore;
        bestFaq = faq;
      }
    }

    if (maxMatch >= 2 || (maxMatch >= 1 && bestFaq.keywords.some(k => k.length > 5 && lowerText.includes(k)))) {
      return bestFaq;
    }
    return null;
  }

  /**
   * Cháy Chat Radar: Track velocity in 30s sliding window
   */
  trackVelocity(cluster) {
    const now = Date.now();
    if (!this.velocityTracker[cluster.id]) {
      this.velocityTracker[cluster.id] = [];
    }

    this.velocityTracker[cluster.id].push(now);
    this.velocityTracker[cluster.id] = this.velocityTracker[cluster.id].filter(t => now - t <= 30000);

    const spikeCount = this.velocityTracker[cluster.id].length;
    if (spikeCount >= 4) {
      this.notifyRadar({
        clusterId: cluster.id,
        title: cluster.title,
        spikeCount: spikeCount,
        windowSec: 30,
        recommendation: `Dừng chia sẻ màn hình 2 phút để giải quyết dứt điểm thắc mắc này trước khi tiếp tục.`
      });
    }
  }

  sortClusters() {
    this.clusters.sort((a, b) => b.count - a.count);
  }

  /**
   * Extract canonical FAQ from Lecturer Explanation (Voice or Text)
   * Calls OpenRouter / Ollama LLM if configured, else smart heuristic
   */
  async extractFaqFromAnswer(clusterId, rawExplanationText, speechMeta = null) {
    const cluster = this.clusters.find(c => c.id === clusterId);
    if (!cluster) return null;

    const timestamp = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    let canonicalQ = cluster.title;
    let cleanAnswer = rawExplanationText.trim();
    let keywords = cluster.keywords && cluster.keywords.length > 0 
      ? [...cluster.keywords] 
      : ["lab", "deadline", "hạn nộp", "lỗi"];

    // Try calling OpenRouter / Ollama if available
    if ((this.provider === 'openrouter' && this.openRouterKey) || this.provider === 'ollama') {
      try {
        const prompt = `Chủ đề câu hỏi học viên: "${cluster.title}"
Các câu hỏi gốc: ${cluster.quotes.slice(0, 3).map(q => q.content).join(" | ")}
Lời giải thích của Giảng viên: "${rawExplanationText}"

Hãy trích xuất thành 1 cặp FAQ ngắn gọn, chuẩn xác. Trả về đúng định dạng JSON:
{
  "canonical_question": "câu hỏi đại diện rõ ràng",
  "verified_answer": "câu trả lời súc tích, giữ nguyên các mốc giờ, số điểm trừ hoặc mã lỗi",
  "keywords": ["từ khóa 1", "từ khóa 2", "từ khóa 3"]
}`;

        const rawRes = await this.callLLM(prompt, "Bạn là trợ lý đúc kết FAQ chuẩn cho khoá học AI20k. Chỉ trả về JSON thuần.");
        const cleanJsonStr = rawRes.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanJsonStr);

        if (parsed.canonical_question) canonicalQ = parsed.canonical_question;
        if (parsed.verified_answer) cleanAnswer = parsed.verified_answer;
        if (parsed.keywords && Array.isArray(parsed.keywords)) keywords = parsed.keywords;
      } catch (err) {
        console.warn("LLM extraction fallback to local heuristic:", err);
      }
    }

    const faqItem = {
      id: `FAQ_${this.faqIdCounter++}`,
      clusterId: cluster.id,
      canonicalQuestion: canonicalQ,
      answer: cleanAnswer,
      keywords: keywords,
      resolvedAt: timestamp,
      servedStudentsCount: cluster.count,
      speechMeta: speechMeta,
      originalClusterTitle: cluster.title
    };

    this.resolvedFaqs.unshift(faqItem);

    // Remove from active clusters and move to answered list
    const idx = this.clusters.findIndex(c => c.id === clusterId);
    if (idx !== -1) {
      const answeredItem = this.clusters.splice(idx, 1)[0];
      answeredItem.answeredAt = timestamp;
      answeredItem.verifiedFaq = faqItem;
      this.answered.unshift(answeredItem);
    }

    return faqItem;
  }

  markAnsweredDirect(clusterId) {
    const idx = this.clusters.findIndex(c => c.id === clusterId);
    if (idx !== -1) {
      const item = this.clusters.splice(idx, 1)[0];
      item.answeredAt = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      this.answered.unshift(item);
      return item;
    }
    return null;
  }

  splitCluster(clusterId, selectedQuoteIds) {
    const cluster = this.clusters.find(c => c.id === clusterId);
    if (!cluster) return false;

    const remainingQuotes = [];
    const splitQuotes = [];

    cluster.quotes.forEach(q => {
      if (selectedQuoteIds.includes(q.id)) {
        splitQuotes.push(q);
      } else {
        remainingQuotes.push(q);
      }
    });

    if (splitQuotes.length === 0) return false;

    cluster.quotes = remainingQuotes;
    cluster.count = remainingQuotes.length;

    const newCluster = {
      id: `cluster_split_${Date.now()}_${this.messageIdCounter}`,
      clusterId: `split_${Date.now()}_${this.messageIdCounter}`,
      title: `Chủ đề tách: ${splitQuotes[0].content.substring(0, 45)}...`,
      count: splitQuotes.length,
      confidence: 0.88,
      lastUpdated: splitQuotes[0].timestamp,
      quotes: splitQuotes
    };

    if (cluster.count === 0) {
      const idx = this.clusters.indexOf(cluster);
      this.clusters.splice(idx, 1);
    }

    this.clusters.push(newCluster);
    this.sortClusters();
    return true;
  }

  acceptReviewItem(itemIndex) {
    if (itemIndex >= 0 && itemIndex < this.reviewQueue.length) {
      const item = this.reviewQueue.splice(itemIndex, 1)[0];
      const cluster = {
        id: `cluster_rev_${Date.now()}`,
        clusterId: `rev_${Date.now()}`,
        title: item.title,
        count: 1,
        confidence: 0.85,
        lastUpdated: item.timestamp,
        quotes: [item]
      };
      this.clusters.push(cluster);
      this.sortClusters();
      return cluster;
    }
    return null;
  }

  /**
   * 1-Click Discord K4 Post-Workshop Recap Generator
   */
  generateDiscordRecap() {
    const dateStr = new Date().toLocaleDateString('vi-VN');
    const timeStr = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

    let md = `# 📢 [AI20K · BẢN TIN RECAP Q&A WORKSHOP] — ${dateStr} (${timeStr})\n\n`;
    md += `*Bản tin tổng hợp tự động từ **Workshop Question Curator** phục vụ học viên & Trợ giảng.*\n\n`;

    md += `### 📊 1. Thống kê phiên học\n`;
    md += `- **Tổng số tin nhắn tiếp nhận:** \`${this.messages.length}\` câu hỏi.\n`;
    md += `- **Số chủ đề trọng điểm đã giải đáp:** \`${this.answered.length}\` chủ đề.\n`;
    md += `- **Số câu hỏi lặp được tự động giải đáp tức thì (Echo-Responder):** \`${this.echoResolved.length}\` lượt (tiết kiệm ~${Math.round(this.echoResolved.length * 1.5)} phút gián đoạn cho Giảng viên).\n`;
    md += `- **Tin nhắn spam / rác đã lọc an toàn:** \`${this.filtered.length}\` tin.\n\n`;

    md += `### ✅ 2. Top thắc mắc đã được giải đáp chính thức (Ground Truth)\n\n`;
    if (this.resolvedFaqs.length > 0) {
      this.resolvedFaqs.forEach((faq, idx) => {
        md += `**#${idx + 1} — ${faq.canonicalQuestion}** (Đã giải thích lúc ${faq.resolvedAt})\n`;
        md += `> 💡 **Giải đáp chính thức:** ${faq.answer}\n`;
        md += `> 👥 *Phục vụ ${faq.servedStudentsCount} lượt hỏi trực tiếp.*\n\n`;
      });
    } else if (this.answered.length > 0) {
      this.answered.forEach((a, idx) => {
        md += `**#${idx + 1} — ${a.title}**\n`;
        md += `> Đã được giảng viên giải đáp trực tiếp trên lớp.\n\n`;
      });
    } else {
      md += `*Chưa có chủ đề nào được đánh dấu hoàn thành.*\n\n`;
    }

    if (this.clusters.length > 0) {
      md += `### ⚠️ 3. Các vấn đề tồn đọng cần Lab Coach / TA hỗ trợ trên Discord\n\n`;
      this.clusters.slice(0, 3).forEach((cl, idx) => {
        md += `- **[${cl.title}]** (\`${cl.count}\` học viên đang chờ): Cần gửi hướng dẫn chi tiết vào kênh \`#lab-support\`.\n`;
      });
      md += `\n`;
    }

    const engineName = this.provider === 'openrouter' ? `OpenRouter (${this.openRouterModel})` : (this.provider === 'ollama' ? 'Local Qwen2.5-3B' : 'Built-in Intelligent Engine');
    md += `---\n*Generated by **Workshop Question Curator** via ${engineName} (AI20k Batch 04).*`;
    return md;
  }

  /**
   * Thẻ Giám Khảo Sandbox: 4-Layer Taxonomy Diagnostic for CP6
   */
  classifyJudgeChallenge(promptText) {
    const text = promptText.trim();
    const lower = text.toLowerCase();

    // 1. Layer ③: Prompt Injection / Out of scope
    if (
      lower.includes("ignore") || lower.includes("delete") || lower.includes("system:") ||
      lower.includes("drop") || lower.includes("hacked") || lower.includes("cho em xin điểm") ||
      lower.includes("hack") || lower.includes("thầy cho em 10 điểm")
    ) {
      return {
        layer: "③ Ngoài phạm vi / Thẩm quyền",
        category: "Prompt Injection / Vượt thẩm quyền",
        riskScore: "Cao (High Risk)",
        action: "Chặn ngay lập tức (Block & Move to Filtered Tab)",
        haxPrinciple: "HAX G1 (Làm rõ phạm vi) & PAIR Graceful Failure",
        explanation: "Phát hiện chỉ thị can thiệp cấu trúc hệ thống hoặc đòi hỏi vượt quyền hạn trợ lý Q&A."
      };
    }

    // 2. Layer ②: Ambiguity / Missing context
    if (text.length < 10 || lower.includes("chưa hiểu") || lower === "?" || lower === "sao thế") {
      return {
        layer: "② Mơ hồ / Thiếu thông tin",
        category: "Ambiguous Query",
        riskScore: "Trung bình (Medium Risk)",
        action: "Đưa vào hàng đợi '⚠️ Cần duyệt', không tự tiện trả lời bừa",
        haxPrinciple: "HAX G10 (Thu hẹp phạm vi khi nghi ngờ)",
        explanation: "Đầu vào thiếu dữ kiện kỹ thuật, hệ thống chuyển giao cho trợ giảng thay vì suy đoán sai."
      };
    }

    // 3. Layer ①: Hallucination / Ungrounded
    if (lower.includes("đề thi cuối kỳ") || lower.includes("học bổng bao nhiêu") || lower.includes("tiền học")) {
      return {
        layer: "① Nguồn sự thật (Ground Truth)",
        category: "Ungrounded Question",
        riskScore: "Trung bình (Hallucination Risk)",
        action: "Từ chối trả lời tự động, cảnh báo ngoài tài liệu buổi học",
        haxPrinciple: "HAX G2 (Làm rõ mức độ tin cậy) & PAIR Factuality",
        explanation: "Thông tin không nằm trong phạm vi workshop hiện tại, AI từ chối suy đoán số liệu."
      };
    }

    // 4. Layer ④: Domain-specific Technical
    return {
      layer: "④ Đặc thù Domain Kỹ thuật",
      category: "Technical Stack (CVAT/OPA/Docker/Git/VLearn)",
      riskScore: "Thấp (Safe & Actionable)",
      action: "Gom cụm ngữ nghĩa theo tần suất và đẩy vào hàng đợi Giảng viên",
      haxPrinciple: "HAX G11 (Giải thích nguyên nhân) & G9 (Sửa dễ dàng)",
      explanation: "Nhận diện đúng cú pháp kỹ thuật đặc thù của khoá học AI20k, bảo toàn nguyên văn log lỗi."
    };
  }

  clearAll() {
    this.messages = [];
    this.clusters = [];
    this.reviewQueue = [];
    this.filtered = [];
    this.answered = [];
    this.resolvedFaqs = [];
    this.echoResolved = [];
    this.velocityTracker = {};
    this.dismissRadar();
  }
}

window.engine = new UnifiedAIEngine();
