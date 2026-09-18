const fs = require('fs');
const path = require('path');
const { createQwenProxy } = require('../qwen_proxy');

const questions = [
  'Docker báo port already in use thì sửa thế nào?',
  'Python bị ModuleNotFoundError khi chạy bài lab.',
  'Làm sao gọi API từ frontend JavaScript?',
  'WebSocket không kết nối được tới Node server.',
  'CUDA out of memory khi train model PyTorch.',
  'Git báo merge conflict thì xử lý thế nào?',
  'Cách deploy Docker container lên server là gì?',
  'CVAT bị lỗi health check 500 ở bước 3.',
  'Deadline nộp bài lab của workshop là khi nào?',
  'Model Qwen có hỗ trợ JSON mode không?'
];

const percentile = (samples, value) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(value / 100 * sorted.length) - 1)] || 0;
};

async function run() {
  if (!process.env.QWEN_API_KEY) throw new Error('Thiếu QWEN_API_KEY; benchmark thật không thể chạy.');
  const proxy = createQwenProxy();
  await proxy.health();
  const warmup = await proxy.warmup();
  const latencies = [];
  for (let index = 0; index < questions.length; index++) {
    const response = await proxy.classify({ questionId: `BENCH_${index + 1}`, question: questions[index], clusters: [] });
    latencies.push(response.meta.latencyMs);
  }
  const report = {
    generatedAt: new Date().toISOString(),
    model: proxy.config.model,
    coldWarmupLatencyMs: warmup.latencyMs,
    warm: { samples: latencies.length, p50LatencyMs: percentile(latencies, 50), p95LatencyMs: percentile(latencies, 95), targetP95Ms: 3000, passed: percentile(latencies, 95) <= 3000 }
  };
  const outputDir = path.join(__dirname, 'reports');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'qwen-benchmark.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.warm.passed) process.exitCode = 1;
}

run().catch((error) => { console.error(`Qwen benchmark failed: ${error.message}`); process.exit(1); });
