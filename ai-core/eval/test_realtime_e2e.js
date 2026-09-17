/**
 * End-to-End WebSocket Test for Dual-Role Realtime Communication
 * Tests:
 * 1. Connection of Lecturer & Student
 * 2. Student question submission -> Lecturer ingestion
 * 3. Lecturer FAQ resolution -> Broadcast to Student live feed
 * 4. Subsequent student question matching FAQ -> Instant Echo reply delivered
 */

const WebSocket = require('ws');
const http = require('http');

function resetSession() {
  return new Promise((resolve) => {
    const req = http.request({ host: 'localhost', port: 3000, path: '/api/reset-session', method: 'POST' }, () => resolve());
    req.on('error', () => resolve());
    req.end();
  });
}

async function runE2ETest() {
  console.log("=== BẮT ĐẦU KIỂM THỬ REALTIME WEBSOCKET ===");
  await resetSession();

  const lecturerWs = new WebSocket('ws://localhost:3000/ws');
  const studentWs = new WebSocket('ws://localhost:3000/ws');

  let studentReceivedFaq = false;
  let studentReceivedEcho = false;
  let lecturerReceivedQuestion = false;

  const testId = Date.now().toString().slice(-4);
  const keywordUnique = `chude_${testId}`;
  const initialQuestion = `Thầy ơi cho em hỏi về lỗi kết nối ${keywordUnique} trong bài thực hành?`;
  const echoQuestion = `Em cũng bị lỗi kết nối ${keywordUnique}, khắc phục sao ạ?`;

  await new Promise((resolve) => {
    let connected = 0;
    lecturerWs.on('open', () => {
      console.log("✓ Lecturer WS kết nối thành công");
      lecturerWs.send(JSON.stringify({ type: 'register_role', role: 'lecturer', name: 'Giảng viên Test' }));
      if (++connected === 2) resolve();
    });
    studentWs.on('open', () => {
      console.log("✓ Student WS kết nối thành công");
      studentWs.send(JSON.stringify({ type: 'register_role', role: 'student', name: `S${testId}` }));
      if (++connected === 2) resolve();
    });
  });

  lecturerWs.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'new_student_question' && msg.question.content.includes(keywordUnique)) {
      console.log(`[Lecturer Dashboard] Nhận được câu hỏi mới từ ${msg.question.user}: "${msg.question.content}"`);
      lecturerReceivedQuestion = true;

      // Simulate lecturer resolving this question into an FAQ
      setTimeout(() => {
        console.log("[Lecturer Dashboard] Thầy bấm '🎙️ Giải thích' -> Trích xuất FAQ chuẩn...");
        const faq = {
          id: `FAQ_${testId}`,
          canonicalQuestion: `Cách khắc phục lỗi kết nối ${keywordUnique}`,
          answer: `Chạy lệnh docker restart để tái khởi động dịch vụ ${keywordUnique}.`,
          keywords: [keywordUnique, "kết nối", "thực hành", "lỗi"],
          resolvedAt: new Date().toLocaleTimeString('vi-VN'),
          servedStudentsCount: 1
        };
        lecturerWs.send(JSON.stringify({
          type: 'broadcast_faq_resolved',
          faq: faq
        }));
      }, 400);
    }
  });

  studentWs.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'new_faq_available' && msg.faq.canonicalQuestion.includes(keywordUnique)) {
      console.log(`[Student Mobile] Nhận được FAQ mới từ Thầy: "${msg.faq.canonicalQuestion}"`);
      studentReceivedFaq = true;

      // Now student sends a duplicate/echo question:
      setTimeout(() => {
        console.log(`[Student Mobile] Học viên gửi câu hỏi lặp lại: "${echoQuestion}"`);
        studentWs.send(JSON.stringify({
          type: 'student_submit_question',
          content: echoQuestion,
          author: `S${testId}`
        }));
      }, 400);
    }

    if (msg.type === 'instant_echo_reply' && msg.studentMsg.includes(keywordUnique)) {
      console.log(`[Student Mobile] 🎉 NHẬN ĐƯỢC INSTANT ECHO-REPLY TỪ AI: "${msg.answer}"`);
      studentReceivedEcho = true;
    }
  });

  // Step 1: Student submits initial question
  console.log(`[Student Mobile] Học viên gửi câu hỏi ban đầu: "${initialQuestion}"`);
  studentWs.send(JSON.stringify({
    type: 'student_submit_question',
    content: initialQuestion,
    author: `S${testId}`
  }));

  // Wait for flow to complete
  await new Promise(r => setTimeout(r, 4500));

  lecturerWs.close();
  studentWs.close();

  console.log("\n=== KẾT QUẢ KIỂM THỬ ===");
  console.log(`1. Lecturer nhận câu hỏi realtime: ${lecturerReceivedQuestion ? '✅ ĐẠT' : '❌ LỖI'}`);
  console.log(`2. Student nhận broadcast FAQ realtime: ${studentReceivedFaq ? '✅ ĐẠT' : '❌ LỖI'}`);
  console.log(`3. Hệ thống trả lời tự động Echo-Reply: ${studentReceivedEcho ? '✅ ĐẠT' : '❌ LỖI'}`);

  if (lecturerReceivedQuestion && studentReceivedFaq && studentReceivedEcho) {
    console.log(">>> TẤT CẢ TÍNH NĂNG REALTIME HOẠT ĐỘNG HOÀN HẢO! <<<");
  } else {
    process.exit(1);
  }
}

runE2ETest().catch(e => {
  console.error("Test error:", e);
  process.exit(1);
});
