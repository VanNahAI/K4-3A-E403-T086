/**
 * Zoom In-Meeting Stage Logic (zoom_room.js)
 * Manages Zoom meeting controls, slide presentation, and PiP companion integration.
 */

let currentRole = 'student';
let currentName = 'Minh Quân (S0129)';
let currentId = 'S0129';

let isMicMuted = false;
let isVideoStopped = false;
let currentSlideIdx = 2; // Slide 3
let isPiPMinimized = false;
let roomAccessState = 'checking';
let roomAccessPoll = null;

const slidesData = [
  {
    tag: "AI20K · PHẦN 1: TỔNG QUAN HỆ THỐNG",
    title: "1. Giới thiệu kiến trúc trợ lý Curator AI trong lớp học",
    bullets: [
      "Thu thập tin nhắn thời gian thực từ luồng chat Zoom và Web học viên.",
      "Ứng dụng mô hình nén & OpenRouter Mini để phân loại ngữ nghĩa.",
      "Tự động gom cụm câu hỏi cùng bản chất với độ chính xác ≥ 85%."
    ],
    code: "curl -X POST http://localhost:3000/api/zoom-import"
  },
  {
    tag: "AI20K · PHẦN 2: THỰC HÀNH DOCKER & PORT",
    title: "2. Khởi tạo container và giải quyết xung đột cổng 8080",
    bullets: [
      "Kiểm tra cổng dịch vụ mạng trước khi chạy docker-compose.",
      "Đổi cổng ánh xạ sang 8081 nếu cổng 8080 đang bị chiếm dụng.",
      "Đảm bảo tài nguyên GPU RTX 3050 sẵn sàng cho việc suy luận."
    ],
    code: "docker run -d -p 8081:8080 --name ai_cvat vlearn/cvat:latest"
  },
  {
    tag: "AI20K · KỸ THUẬT TRIỂN KHAI THỰC CHIẾN",
    title: "Lab 02 — Setup Môi Trường & Tối Ưu Mô Hình AI",
    bullets: [
      "Khởi động môi trường Docker & gán cổng dịch vụ (CVAT / Label Studio).",
      "Cấu hình API Key & kiểm tra phân bổ tài nguyên GPU RTX 3050 (4GB VRAM).",
      "Tích hợp cơ chế Echo-Responder tự động chặn lặp câu hỏi."
    ],
    code: "docker run -d -p 8080:8080 --name ai_lab_cvat vlearn/cvat:latest"
  },
  {
    tag: "AI20K · PHẦN 4: KHIÊN ECHO-RESPONDER",
    title: "4. Cơ chế tự động trả lời tức thì cho câu hỏi lặp lại (< 5ms)",
    bullets: [
      "Giảng viên giải thích một lần qua giọng nói (Web Speech API).",
      "AI tự động lưu Ground Truth FAQ vào kho tri thức buổi học.",
      "Học viên hỏi lại câu tương tự sẽ nhận ngay popup đáp án chính thức."
    ],
    code: "matchWithServerFaqs(studentQuestion) -> sendInstantEchoReply()"
  },
  {
    tag: "AI20K · PHẦN 5: TỔNG KẾT & RECAP",
    title: "5. Báo cáo hậu kỳ & Xuất bản tin Discord Recap 1-click",
    bullets: [
      "Tổng kết 6 chỉ số KPI hiệu quả buổi học.",
      "Tự động định dạng Markdown đăng vào kênh #qna-workshop.",
      "Lưu trữ báo cáo phiên học dưới dạng tệp JSON."
    ],
    code: "generateDiscordRecap() -> Copy to Clipboard"
  }
];

window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  currentRole = params.get('role') || 'student';
  currentName = params.get('name') || (currentRole === 'lecturer' ? 'TS. Nguyễn Thành Nhân (Host)' : 'Minh Quân (S0129)');
  currentId = params.get('id') || (currentRole === 'lecturer' ? 'HOST' : 'S0129');

  // Set top role pill
  document.getElementById('room-role-pill').textContent = 
    currentRole === 'lecturer' ? `Giảng viên: ${currentName}` : `Học viên: ${currentName}`;

  // Set attendee video avatar
  if (currentRole === 'student') {
    document.getElementById('room-self-nametag').textContent = `Bạn (${currentName})`;
    const initials = currentName.split(' ').map(w => w[0]).filter(Boolean).slice(-2).join('');
    document.getElementById('room-self-avatar').textContent = initials || 'HV';
  } else {
    // Lecturer view: hide self duplicate tile or show host
    document.getElementById('video-tile-self').style.display = 'none';
  }

  enterLocalMeeting(params);
});

async function enterLocalMeeting(params) {
  try {
    let response;
    if (currentRole === 'lecturer') {
      // The portal marks a deliberate "start a new meeting" action. The
      // fallback also makes a direct /room?role=lecturer link usable.
      if (params.get('newSession') === '1') {
        response = await fetch('/api/session/start', { method: 'POST' });
      } else {
        const stateResponse = await fetch('/api/session/state');
        const state = await stateResponse.json();
        response = state.isOpen
          ? stateResponse
          : await fetch('/api/session/start', { method: 'POST' });
      }
    } else {
      response = await fetch('/api/session/join', { method: 'POST' });
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      showMeetingClosed(error.message || 'Giảng viên chưa bắt đầu cuộc họp.');
      return;
    }

    roomAccessState = 'open';
    stopRoomAccessPolling();

    // Load PiP Companion only after access is granted. This prevents a
    // student from asking questions through the embedded panel while locked.
    const pipSrc = `/pip?role=${encodeURIComponent(currentRole)}&name=${encodeURIComponent(currentName)}&id=${encodeURIComponent(currentId)}`;
    document.getElementById('pip-companion-iframe').src = pipSrc;

    makeDraggable(document.getElementById('pip-overlay'), document.getElementById('pip-drag-handle'));
    renderCurrentSlide();
  } catch (error) {
    showMeetingClosed('Không thể kết nối tới phiên học thử nghiệm. Vui lòng thử lại.');
  }
}

function showMeetingClosed(message) {
  roomAccessState = 'closed';
  document.getElementById('meeting-closed-message').textContent = message;
  document.getElementById('meeting-closed-overlay').classList.remove('hidden');
  document.querySelector('.zoom-app-container').classList.add('hidden');
  startRoomAccessPolling();
}

function startRoomAccessPolling() {
  stopRoomAccessPolling();
  roomAccessPoll = setInterval(async () => {
    if (roomAccessState !== 'closed' || currentRole !== 'student') return;
    try {
      const response = await fetch('/api/session/join', { method: 'POST' });
      if (response.ok) window.location.reload();
    } catch (error) {
      // Keep the waiting-room message visible while the server is offline.
    }
  }, 3000);
}

function stopRoomAccessPolling() {
  if (roomAccessPoll) {
    clearInterval(roomAccessPoll);
    roomAccessPoll = null;
  }
}

function retryMeetingAccess() {
  window.location.reload();
}

// Slide Controls
function renderCurrentSlide() {
  const data = slidesData[currentSlideIdx];
  if (!data) return;

  document.querySelector('.slide-tag').textContent = data.tag;
  document.getElementById('slide-main-title').textContent = data.title;
  document.getElementById('slide-num-text').textContent = `Slide ${currentSlideIdx + 1} / ${slidesData.length}`;

  const bulletsList = document.querySelector('.slide-bullet-list');
  bulletsList.innerHTML = data.bullets.map(b => `<li>${b}</li>`).join('');

  document.querySelector('.slide-code-box code').textContent = data.code;
}

function prevSlide() {
  if (currentSlideIdx > 0) {
    currentSlideIdx--;
    renderCurrentSlide();
  }
}

function nextSlide() {
  if (currentSlideIdx < slidesData.length - 1) {
    currentSlideIdx++;
    renderCurrentSlide();
  }
}

// Zoom Toolbar Controls
function toggleZoomMic() {
  isMicMuted = !isMicMuted;
  const icon = document.getElementById('icon-zoom-mic');
  const label = document.getElementById('label-zoom-mic');

  if (isMicMuted) {
    icon.textContent = '🔇';
    label.textContent = 'Bật tiếng';
    label.style.color = '#ef4444';
  } else {
    icon.textContent = '🎙️';
    label.textContent = 'Tắt tiếng';
    label.style.color = '';
  }
}

function toggleZoomVideo() {
  isVideoStopped = !isVideoStopped;
  const icon = document.getElementById('icon-zoom-cam');
  const label = document.getElementById('label-zoom-cam');
  const tile = document.getElementById('video-tile-self');

  if (isVideoStopped) {
    icon.textContent = '🚫';
    label.textContent = 'Bật Video';
    label.style.color = '#ef4444';
    if (tile) tile.style.opacity = '0.3';
  } else {
    icon.textContent = '📹';
    label.textContent = 'Dừng Video';
    label.style.color = '';
    if (tile) tile.style.opacity = '1';
  }
}

function togglePiPOverlay() {
  const pip = document.getElementById('pip-overlay');
  const btn = document.getElementById('btn-toggle-ai-pip');

  if (pip.style.display === 'none') {
    pip.style.display = 'flex';
    btn.classList.add('active');
  } else if (pip.classList.contains('minimized')) {
    pip.classList.remove('minimized');
    document.getElementById('btn-minimize-pip').textContent = '−';
  } else {
    // Hide
    pip.style.display = 'none';
    btn.classList.remove('active');
  }
}

function toggleMinimizePiP() {
  const pip = document.getElementById('pip-overlay');
  const btn = document.getElementById('btn-minimize-pip');

  if (pip.classList.contains('minimized')) {
    pip.classList.remove('minimized');
    btn.textContent = '−';
  } else {
    pip.classList.add('minimized');
    btn.textContent = '+';
  }
}

function popOutPiPWindow() {
  const pipUrl = `/pip?role=${encodeURIComponent(currentRole)}&name=${encodeURIComponent(currentName)}&id=${encodeURIComponent(currentId)}`;
  const width = 430;
  const height = 720;
  const left = window.screen.availWidth - width - 20;
  const top = 40;

  window.open(
    pipUrl, 
    'CuratorAI_PiP', 
    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=no`
  );

  // Hide embedded overlay after popping out
  document.getElementById('pip-overlay').style.display = 'none';
  document.getElementById('btn-toggle-ai-pip').classList.remove('active');
}

function triggerZoomReaction(emoji) {
  const toast = document.createElement('div');
  toast.textContent = `${currentName}: ${emoji}`;
  toast.style.position = 'absolute';
  toast.style.bottom = '80px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.background = 'rgba(0, 0, 0, 0.75)';
  toast.style.color = '#fff';
  toast.style.padding = '8px 16px';
  toast.style.borderRadius = '20px';
  toast.style.fontSize = '0.9rem';
  toast.style.zIndex = '100';
  toast.style.animation = 'popIn 0.2s ease';

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function leaveMeeting() {
  if (confirm("Bạn có chắc muốn rời khỏi phòng học Zoom?")) {
    window.location.href = '/';
  }
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => console.log(err));
  } else {
    document.exitFullscreen().catch(err => console.log(err));
  }
}

// Draggable utility for the overlay window
function makeDraggable(element, handle) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  handle.onmousedown = dragMouseDown;

  function dragMouseDown(e) {
    e.preventDefault();
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
    handle.style.cursor = 'grabbing';
  }

  function elementDrag(e) {
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    element.style.top = (element.offsetTop - pos2) + "px";
    element.style.left = (element.offsetLeft - pos1) + "px";
    element.style.bottom = 'auto';
    element.style.right = 'auto';
  }

  function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;
    handle.style.cursor = 'grab';
  }
}
