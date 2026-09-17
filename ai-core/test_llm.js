/**
 * Live OpenRouter Model Connectivity & Semantic Clustering Verification Tool
 * 
 * Usage:
 *   node ai-core/test_llm.js [OPTIONAL_API_KEY] [OPTIONAL_MODEL]
 * 
 * Example:
 *   node ai-core/test_llm.js sk-or-v1-... google/gemini-2.0-flash-exp:free
 */

const fs = require('fs');
const path = require('path');

// 1. Auto-load .env
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
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

const apiKey = process.argv[2] || process.env.OPENROUTER_API_KEY;
const model = process.argv[3] || process.env.OPENROUTER_MODEL || 'nex-agi/nex-n2.5-mini:free';

console.log("================================================================================");
console.log("🤖 WORKSHOP QUESTION CURATOR — LIVE OPENROUTER MODEL TESTER");
console.log("================================================================================");
console.log(`📌 Model mục tiêu: ${model}`);

if (!apiKey) {
  console.log(`❌ CHƯA CÓ OPENROUTER API KEY!`);
  console.log(`\n👉 Cách thiết lập:`);
  console.log(`   1. Mở file .env tại thư mục gốc và dán:`);
  console.log(`      OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxx`);
  console.log(`   2. Hoặc chạy trực tiếp:`);
  console.log(`      node ai-core/test_llm.js sk-or-v1-xxxxxxxxxxxx\n`);
  process.exit(1);
}

const maskedKey = `${apiKey.slice(0, 10)}...${apiKey.slice(-4)}`;
console.log(`🔑 API Key phát hiện: ${maskedKey}`);
console.log(`⏳ Đang gửi request test trích xuất & phân cụm ngữ nghĩa...\n`);

async function callOpenRouter(prompt) {
  const startTime = Date.now();
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://ai20k-workshop-curator.local",
      "X-Title": "Workshop Question Curator CLI Test"
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: "system", content: "Bạn là AI phân tích ngữ nghĩa câu hỏi học tập, luôn trả về JSON hợp lệ." },
        { role: "user", content: prompt }
      ],
      temperature: 0.1
    }),
    signal: AbortSignal.timeout(12000)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const latency = Date.now() - startTime;
  const rawContent = data.choices[0].message.content.trim();
  
  let parsed;
  try {
    const clean = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
    parsed = JSON.parse(clean);
  } catch (e) {
    const match = rawContent.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
    else throw new Error(`Không thể parse JSON từ model: ${rawContent.slice(0, 150)}`);
  }

  return { parsed, latency, tokens: data.usage ? data.usage.total_tokens : 0 };
}

async function run() {
  try {
    // TEST CASE 1: New Question Title Extraction
    const q1 = "Em cài PyTorch trên Colab nhưng bị lỗi CUDA out of memory, làm sao khắc phục ạ?";
    console.log(`[TEST 1] Gửi câu hỏi mới: "${q1}"`);

    const prompt1 = `Bạn là hệ thống AI phân loại câu hỏi trong lớp học workshop công nghệ.
Học viên vừa gửi câu hỏi: "${q1}"

Các nhóm câu hỏi hiện có trong lớp:
(Chưa có nhóm nào)

Yêu cầu:
1. Nếu câu hỏi có cùng bản chất ngữ nghĩa với 1 nhóm có sẵn, trả về "matchedClusterId".
2. Nếu là chủ đề mới, hãy tạo "suggestedTitle" (dưới 10 từ, chuẩn hóa tiếng Việt, nêu rõ bản chất vấn đề) và trích xuất 3-5 "keywords".
3. Toàn bộ "suggestedTitle" và các từ khóa "keywords" BẮT BUỘC 100% viết bằng Tiếng Việt chuẩn (tuyệt đối không dùng tiếng Trung).

Chỉ trả về định dạng JSON thuần túy (không kèm giải thích hay markdown backticks):
{
  "matchedClusterId": null,
  "suggestedTitle": "Tiêu đề chuẩn hóa dưới 10 từ",
  "keywords": ["từ khóa 1", "từ khóa 2", "từ khóa 3"],
  "confidence": 0.95
}`;

    const res1 = await callOpenRouter(prompt1);
    console.log(`⚡ Phản hồi trong: ${res1.latency}ms (Tokens: ${res1.tokens})`);
    console.log(`   🎯 Tiêu đề chuẩn hóa: "${res1.parsed.suggestedTitle}"`);
    console.log(`   🏷️  Từ khóa trích xuất: [${(res1.parsed.keywords || []).join(', ')}]`);
    console.log(`   📊 Độ tin cậy: ${res1.parsed.confidence}\n`);

    // TEST CASE 2: Semantic Clustering against Existing Cluster
    const mockClusterId = "cluster_colab_cuda_oom";
    const q2 = "Thầy ơi em chạy colab bị tràn RAM GPU Colab thì chỉnh batch size nhỏ lại được không?";
    console.log(`[TEST 2] Gửi câu hỏi số 2 kiểm tra gộp nhóm (Semantic Clustering): "${q2}"`);

    const prompt2 = `Bạn là hệ thống AI phân loại câu hỏi trong lớp học workshop công nghệ.
Học viên vừa gửi câu hỏi: "${q2}"

Các nhóm câu hỏi hiện có trong lớp:
- [ID: ${mockClusterId}] "${res1.parsed.suggestedTitle}" (từ khóa: ${(res1.parsed.keywords || []).join(', ')})

Yêu cầu:
1. Nếu câu hỏi có cùng bản chất ngữ nghĩa với 1 nhóm có sẵn, trả về "matchedClusterId".
2. Nếu là chủ đề mới, hãy tạo "suggestedTitle" (dưới 10 từ, chuẩn hóa tiếng Việt, nêu rõ bản chất vấn đề) và trích xuất 3-5 "keywords".

Chỉ trả về định dạng JSON thuần túy:
{
  "matchedClusterId": null,
  "suggestedTitle": null,
  "keywords": [],
  "confidence": 0.95
}`;

    const res2 = await callOpenRouter(prompt2);
    console.log(`⚡ Phản hồi trong: ${res2.latency}ms (Tokens: ${res2.tokens})`);
    console.log(`   🔍 Matched Cluster ID: ${res2.parsed.matchedClusterId}`);

    const isMatch = res2.parsed.matchedClusterId && String(res2.parsed.matchedClusterId).includes("cluster_colab_cuda_oom");
    if (isMatch) {
      console.log(`   ✅ CHÍNH XÁC: Model đã nhận diện câu hỏi 2 thuộc cùng chủ đề với câu hỏi 1!`);
    } else {
      console.log(`   ℹ️  Model phân loại câu hỏi 2 với tiêu đề: "${res2.parsed.suggestedTitle}"`);
    }

    console.log("\n================================================================================");
    console.log("🎉 KẾT QUẢ: KẾT NỐI OPENROUTER LIVE MODEL THÀNH CÔNG 100%!");
    console.log("================================================================================");
  } catch (err) {
    console.error(`\n❌ LỖI KẾT NỐI OPENROUTER:`, err.message);
    process.exit(1);
  }
}

run();
