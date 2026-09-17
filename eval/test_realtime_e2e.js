/**
 * End-to-End WebSocket Test for the local workshop session.
 *
 * Covers the reported regressions:
 * 1. A student question reaches the lecturer in realtime.
 * 2. A resolved FAQ reaches students already in the room.
 * 3. A student who joins after the answer receives the existing FAQ.
 * 4. A paraphrased repeat question receives the answer automatically.
 * 5. The lecturer still sees that repeat question as an echo-resolved event.
 * 6. Starting a new session clears the server FAQ cache.
 * 7. An exact repeat with a generic one-word keyword still receives the answer.
 * 8. A different intent sharing "hôm nay" and "Lab 02" is not auto-resolved.
 */

const WebSocket = require('ws');
const http = require('http');
const PORT = Number(process.env.TEST_PORT || 3000);
const LECTURER_ACCESS_TOKEN = String(process.env.LECTURER_ACCESS_TOKEN || '').trim();

function requestJson(path, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: PORT, path, method, headers }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        let json = {};
        try { json = body ? JSON.parse(body) : {}; } catch (error) {}
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function closeQuietly(ws) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
}

async function runE2ETest() {
  console.log('=== BẮT ĐẦU KIỂM THỬ REALTIME WEBSOCKET ===');
  if (!LECTURER_ACCESS_TOKEN) {
    throw new Error('Thiếu LECTURER_ACCESS_TOKEN. Hãy cấu hình biến môi trường trước khi chạy test realtime.');
  }
  const lecturerHeaders = { Authorization: `Bearer ${LECTURER_ACCESS_TOKEN}` };
  await requestJson('/api/reset-session', 'POST', lecturerHeaders);
  const startResult = await requestJson('/api/session/start', 'POST', lecturerHeaders);
  if (startResult.status !== 200 || !startResult.body.session?.isOpen) {
    throw new Error('Không thể mở session test.');
  }

  const lecturerWs = new WebSocket(`ws://localhost:${PORT}/ws`);
  const firstStudentWs = new WebSocket(`ws://localhost:${PORT}/ws`);
  await Promise.all([waitForOpen(lecturerWs), waitForOpen(firstStudentWs)]);

  lecturerWs.send(JSON.stringify({
    type: 'register_role',
    role: 'lecturer',
    name: 'Giảng viên Test',
    token: LECTURER_ACCESS_TOKEN
  }));
  firstStudentWs.send(JSON.stringify({ type: 'register_role', role: 'student', name: 'S_FIRST' }));

  const testId = Date.now().toString().slice(-5);
  const keywordUnique = `chude_${testId}`;
  const initialQuestion = `Thầy ơi cho em hỏi về lỗi kết nối ${keywordUnique} trong bài thực hành?`;
  const echoQuestion = `Em cũng bị lỗi kết nối ${keywordUnique}, khắc phục sao ạ?`;
  const faq = {
    id: `FAQ_${testId}`,
    canonicalQuestion: `Cách khắc phục lỗi kết nối ${keywordUnique}`,
    answer: `Chạy lệnh docker restart để tái khởi động dịch vụ ${keywordUnique}.`,
    keywords: [keywordUnique, 'kết nối', 'thực hành', 'lỗi'],
    resolvedAt: new Date().toLocaleTimeString('vi-VN'),
    servedStudentsCount: 1
  };

  let lecturerReceivedQuestion = false;
  let lecturerReceivedEchoQuestion = false;
  let firstStudentReceivedFaq = false;
  let lateStudentReceivedFaq = false;
  let lateStudentReceivedEcho = false;
  let agendaRepeatReceivedEcho = false;
  let endTimeStayedSeparate = false;
  let endTimeWronglyEchoed = false;
  let secondStudentWs;
  const agendaQuestion = 'Buổi Lab 02 hôm nay học gì?';
  const endTimeQuestion = 'Hôm nay kết thúc lúc mấy giờ?';
  const agendaFaq = {
    id: `FAQ_AGENDA_${testId}`,
    canonicalQuestion: `Vướng mắc: ${agendaQuestion}`,
    answer: 'Hôm nay lớp học xử lý dữ liệu và gán nhãn cho Lab 02.',
    keywords: ['lab'],
    resolvedAt: new Date().toLocaleTimeString('vi-VN'),
    servedStudentsCount: 1
  };

  lecturerWs.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'new_student_question' && msg.question?.content.includes(keywordUnique)) {
      if (msg.isEcho) lecturerReceivedEchoQuestion = true;
      else lecturerReceivedQuestion = true;
    }
    if (msg.type === 'new_student_question' && msg.question?.content === endTimeQuestion) {
      endTimeStayedSeparate = !msg.isEcho;
    }
  });

  firstStudentWs.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'new_faq_available' && msg.faq?.id === faq.id) {
      firstStudentReceivedFaq = true;
      firstStudentWs.send(JSON.stringify({
        type: 'student_submit_question',
        content: echoQuestion,
        author: 'S_FIRST'
      }));
    }
    if (msg.type === 'instant_echo_reply' && msg.studentMsg === agendaQuestion) {
      agendaRepeatReceivedEcho = true;
    }
    if (msg.type === 'instant_echo_reply' && msg.studentMsg === endTimeQuestion) {
      endTimeWronglyEchoed = true;
    }
  });

  console.log(`[Student 1] Gửi câu hỏi ban đầu: "${initialQuestion}"`);
  firstStudentWs.send(JSON.stringify({
    type: 'student_submit_question',
    content: initialQuestion,
    author: 'S_FIRST'
  }));

  await new Promise(resolve => setTimeout(resolve, 300));
  lecturerWs.send(JSON.stringify({ type: 'broadcast_faq_resolved', faq }));

  // This student connects after the FAQ was resolved; the handshake must
  // include the current FAQ instead of requiring a replay or page refresh.
  secondStudentWs = new WebSocket(`ws://localhost:${PORT}/ws`);
  secondStudentWs.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'connected' && msg.activeFaqs?.some(item => item.id === faq.id)) {
      lateStudentReceivedFaq = true;
      secondStudentWs.send(JSON.stringify({
        type: 'student_submit_question',
        content: echoQuestion,
        author: 'S_LATE'
      }));
    }
    if (msg.type === 'instant_echo_reply' && msg.studentMsg?.includes(keywordUnique)) {
      lateStudentReceivedEcho = true;
    }
  });
  await waitForOpen(secondStudentWs);
  secondStudentWs.send(JSON.stringify({ type: 'register_role', role: 'student', name: 'S_LATE' }));

  await new Promise(resolve => setTimeout(resolve, 1200));

  lecturerWs.send(JSON.stringify({ type: 'broadcast_faq_resolved', faq: agendaFaq }));
  await new Promise(resolve => setTimeout(resolve, 100));
  firstStudentWs.send(JSON.stringify({ type: 'student_submit_question', content: agendaQuestion, author: 'S_FIRST' }));
  firstStudentWs.send(JSON.stringify({ type: 'student_submit_question', content: endTimeQuestion, author: 'S_FIRST' }));
  await new Promise(resolve => setTimeout(resolve, 500));

  // Verify a fresh lecturer session does not inherit the previous FAQ.
  const newSession = await requestJson('/api/session/start', 'POST', lecturerHeaders);
  const freshStudent = new WebSocket(`ws://localhost:${PORT}/ws`);
  const freshState = await new Promise(resolve => {
    freshStudent.once('message', data => resolve(JSON.parse(data.toString())));
    freshStudent.once('open', () => {
      freshStudent.send(JSON.stringify({ type: 'register_role', role: 'student', name: 'S_FRESH' }));
    });
  });
  const oldFaqRemoved = newSession.status === 200 &&
    freshState.type === 'connected' &&
    Array.isArray(freshState.activeFaqs) &&
    !freshState.activeFaqs.some(item => item.id === faq.id);

  closeQuietly(lecturerWs);
  closeQuietly(firstStudentWs);
  closeQuietly(secondStudentWs);
  closeQuietly(freshStudent);

  console.log('\n=== KẾT QUẢ KIỂM THỬ ===');
  console.log(`1. Lecturer nhận câu hỏi realtime: ${lecturerReceivedQuestion ? '✅ ĐẠT' : '❌ LỖI'}`);
  console.log(`2. Student đang trong lớp nhận FAQ: ${firstStudentReceivedFaq ? '✅ ĐẠT' : '❌ LỖI'}`);
  console.log(`3. Student vào sau nhận FAQ từ handshake: ${lateStudentReceivedFaq ? '✅ ĐẠT' : '❌ LỖI'}`);
  console.log(`4. Student vào sau nhận auto-reply: ${lateStudentReceivedEcho ? '✅ ĐẠT' : '❌ LỖI'}`);
  console.log(`5. Lecturer thấy câu hỏi lặp đã auto-resolve: ${lecturerReceivedEchoQuestion ? '✅ ĐẠT' : '❌ LỖI'}`);
  console.log(`6. Session mới làm sạch FAQ cũ: ${oldFaqRemoved ? '✅ ĐẠT' : '❌ LỖI'}`);
  console.log(`7. Câu hỏi y hệt nhận lại đáp án đã trả lời: ${agendaRepeatReceivedEcho ? '✅ ĐẠT' : '❌ LỖI'}`);
  console.log(`8. Ý định giờ kết thúc không bị gộp với nội dung Lab: ${endTimeStayedSeparate && !endTimeWronglyEchoed ? '✅ ĐẠT' : '❌ LỖI'}`);

  if (lecturerReceivedQuestion && firstStudentReceivedFaq && lateStudentReceivedFaq &&
      lateStudentReceivedEcho && lecturerReceivedEchoQuestion && oldFaqRemoved &&
      agendaRepeatReceivedEcho && endTimeStayedSeparate && !endTimeWronglyEchoed) {
    console.log('>>> TẤT CẢ TÍNH NĂNG REALTIME HOẠT ĐỘNG ĐÚNG! <<<');
  } else {
    process.exitCode = 1;
  }
}

runE2ETest().catch(error => {
  console.error('Test error:', error);
  process.exitCode = 1;
});
