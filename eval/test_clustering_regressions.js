const assert = require('node:assert/strict');

const storage = new Map([['curator_provider', 'mock']]);
global.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  }
};
global.window = {};

require('../codebase/ai_engine.js');

async function run() {
  const engine = window.engine;
  const agendaQuestion = 'Buổi Lab 02 hôm nay học gì?';
  const endTimeQuestion = 'Hôm nay kết thúc lúc mấy giờ?';

  await engine.processMessage(agendaQuestion, 'Minh Quân (S0129)');
  await engine.processMessage(endTimeQuestion, 'Lan Anh (S0188)');

  assert.equal(engine.clusters.length, 2, 'Hai ý định agenda và giờ kết thúc phải ở hai cụm riêng');

  for (const student of ['Hải (S0201)', 'Nam (S0202)', 'Mai (S0203)']) {
    const result = await engine.processMessage(agendaQuestion, student);
    assert.equal(result.type, 'incremented', 'Câu hỏi lặp lại phải được cộng vào đúng cụm');
  }

  const agendaCluster = engine.clusters.find(cluster =>
    cluster.quotes.some(quote => quote.content === agendaQuestion)
  );
  const endTimeCluster = engine.clusters.find(cluster =>
    cluster.quotes.some(quote => quote.content === endTimeQuestion)
  );

  assert.ok(agendaCluster, 'Không tìm thấy cụm nội dung Lab 02');
  assert.ok(endTimeCluster, 'Không tìm thấy cụm giờ kết thúc');
  assert.notEqual(agendaCluster.id, endTimeCluster.id, 'Hai ý định không được gộp chung');
  assert.equal(agendaCluster.count, 4, 'Cụm phải giữ đủ 4 câu hỏi trùng');
  assert.equal(agendaCluster.quotes.length, 4, 'Phải lưu đủ 4 câu hỏi gốc để giảng viên mở xem');
  assert.deepEqual(
    new Set(agendaCluster.quotes.map(quote => quote.user)),
    new Set(['Minh Quân (S0129)', 'Hải (S0201)', 'Nam (S0202)', 'Mai (S0203)']),
    'Mỗi câu hỏi gốc phải giữ đúng danh tính sinh viên'
  );

  const faq = await engine.extractFaqFromAnswer(
    agendaCluster.id,
    'Hôm nay lớp học xử lý dữ liệu và gán nhãn cho Lab 02.'
  );
  assert.ok(faq, 'Giảng viên phải tạo được FAQ sau khi trả lời');

  const echoed = await engine.processMessage(agendaQuestion, 'Học viên vào sau (S0300)');
  assert.equal(echoed.type, 'echo_resolved', 'Người hỏi lại sau khi giảng viên trả lời phải nhận đáp án tự động');
  assert.equal(echoed.data.matchedFaq.id, faq.id, 'Đáp án tự động phải dùng đúng FAQ đã được giảng viên xác nhận');

  console.log('PASS clustering regression: separated intents, 4 quotes retained, answered repeat auto-resolved');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
