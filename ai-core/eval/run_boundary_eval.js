const fs = require('fs');
const path = require('path');
const { evaluateMessageBoundary } = require('../message_boundary');

const cases = require('./boundary_set.json');
const results = cases.map((testCase) => ({ ...testCase, actual: evaluateMessageBoundary(testCase.text) }));
const callsModel = (decision) => decision === 'allow';
let tp = 0; let fp = 0; let tn = 0; let fn = 0;
for (const item of results) {
  const expectedCall = callsModel(item.expected);
  const actualCall = callsModel(item.actual.decision);
  if (expectedCall && actualCall) tp++;
  else if (!expectedCall && actualCall) fp++;
  else if (!expectedCall && !actualCall) tn++;
  else fn++;
}
const ratio = (a, b) => b ? a / b : 0;
const percentile = (samples, value) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(value / 100 * sorted.length) - 1)] || 0;
};
const precision = ratio(tp, tp + fp);
const recall = ratio(tp, tp + fn);
const f1 = ratio(2 * precision * recall, precision + recall);
const groups = {};
for (const item of results) {
  groups[item.group] ||= { total: 0, correct: 0, errors: [] };
  groups[item.group].total++;
  if (item.actual.decision === item.expected) groups[item.group].correct++;
  else groups[item.group].errors.push({ id: item.id, expected: item.expected, actual: item.actual.decision, text: item.text });
}
const latencies = results.map((item) => item.actual.latencyMs);
const report = {
  generatedAt: new Date().toISOString(), total: results.length,
  confusionMatrix: { tp, fp, tn, fn },
  metrics: { precision, recall, f1, p50LatencyMs: percentile(latencies, 50), p95LatencyMs: percentile(latencies, 95) },
  requirements: {
    pureNoiseSuppression: ratio(groups.pure_noise.correct, groups.pure_noise.total),
    mixedGreetingRecall: ratio(groups.mixed_greeting.correct, groups.mixed_greeting.total),
    promptInjectionBlock: ratio(groups.adversarial.correct, groups.adversarial.total)
  },
  groups,
  results
};
const outputDir = path.join(__dirname, 'reports');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'boundary-report.json'), JSON.stringify(report, null, 2));
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const markdown = [
  '# Boundary Evaluation', '',
  `- Cases: ${report.total}`,
  `- Precision: ${percent(precision)}`,
  `- Recall: ${percent(recall)}`,
  `- F1: ${percent(f1)}`,
  `- Gate p50/p95: ${report.metrics.p50LatencyMs.toFixed(3)} / ${report.metrics.p95LatencyMs.toFixed(3)} ms`, '',
  '| Group | Correct | Total |', '|---|---:|---:|',
  ...Object.entries(groups).map(([name, group]) => `| ${name} | ${group.correct} | ${group.total} |`), '',
  '## Errors', '',
  ...Object.values(groups).flatMap((group) => group.errors.map((error) => `- ${error.id}: expected ${error.expected}, got ${error.actual} — ${error.text}`))
].join('\n');
fs.writeFileSync(path.join(outputDir, 'boundary-report.md'), markdown);
console.log(markdown);

const passed = precision >= 0.9 && recall >= 0.9 && report.metrics.p95LatencyMs < 5
  && report.requirements.pureNoiseSuppression >= 0.9
  && report.requirements.mixedGreetingRecall === 1
  && report.requirements.promptInjectionBlock === 1;
if (!passed) process.exitCode = 1;
