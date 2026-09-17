# 🧠 AI Core Module

The intelligent engine powering the **Workshop Question Curator** platform. Responsible for intent classification, semantic question clustering, 4-layer guardrails, and real-time LLM integration.

---

## 📁 Directory Layout

```text
ai-core/
├── ai_engine.js          # Unified AI Engine (Semantic NLP + OpenRouter/Ollama LLM)
├── mock_engine.js        # Deterministic engine for offline regression testing
├── eval/
│   ├── golden_set.json   # 24 test cases covering 4 difficulty layers
│   ├── run_eval.js       # Automated evaluation benchmark runner
│   ├── test_realtime_e2e.js # Dual-role WebSocket end-to-end test
│   └── eval_results_run1.md # Latest benchmark results (87.5% passed)
├── AGENTS.md             # Developer & AI Agent coding rules for this module
└── README.md             # This document
```

---

## 🚀 Quick Usage

### In Node.js / Server Environment:
```javascript
const UnifiedAIEngine = require('./ai_engine.js');
const engine = new UnifiedAIEngine();

// Process a student question
const result = await engine.processMessage("Em cài pytorch bị lỗi CUDA version mismatch ạ", "Học viên A");
console.log(result.type); // "active_cluster"
```

### In Browser:
```html
<script src="/ai-core/ai_engine.js"></script>
<script>
  const engine = new UnifiedAIEngine();
  // engine is ready
</script>
```

---

## 🧪 Running Evaluations

```powershell
# Run the 24-case Golden Set benchmark
node ai-core/eval/run_eval.js

# Run the WebSocket Realtime E2E test
node ai-core/eval/test_realtime_e2e.js
```
