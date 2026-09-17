# Student App — Agentic Coding Guide & Architecture Specification (`student-app/AGENTS.md`)

> **For AI Coding Agents (Antigravity, Cursor, Claude Code, GitHub Copilot) & Teammates:**
> Read this file before making any modifications or enhancements to the student experience.

---

## 1. Role & Mission of Student App
The `student-app` module delivers a **frictionless, zero-login Q&A experience** for workshop attendees:
1. **Mobile Web Portal (`student.html`):** Designed for smartphones accessed via the classroom QR code.
2. **In-Meeting PiP Companion (`pip_student.html`):** A floating, compact companion window that stays on top of Zoom without interrupting the live presentation.
3. **Pre-submit Deflection:** Scans active verified FAQs as the student types in real time. If a match is found, shows the answer immediately so the student gets unblocked without waiting.
4. **Instant Echo Reply:** If a student submits a question that was already answered by the lecturer, the system pops up the **Verified Ground Truth Answer** in $< 5$ms.

---

## 2. WebSocket Communication Protocol

The student client connects to `ws://localhost:3000/ws` (or LAN IP).

### Outgoing Messages (Student -> Server):
```json
// 1. Role registration upon WebSocket open
{
  "type": "register_role",
  "role": "student",
  "name": "Minh Quân (S0129)",
  "studentId": "S0129"
}

// 2. Question submission
{
  "type": "student_submit_question",
  "content": "Em bị lỗi CUDA out of memory khi train model ạ",
  "author": "Minh Quân (S0129)",
  "studentId": "S0129"
}
```

### Incoming Messages (Server -> Student):
```json
// 1. Initial connection payload
{
  "type": "connected",
  "activeFaqs": [ /* verified FAQ array */ ]
}

// 2. Instant Echo Reply (When question matches answered topic)
{
  "type": "instant_echo_reply",
  "studentMsg": "Em bị lỗi CUDA...",
  "answer": "Giảm batch size từ 16 xuống 4 hoặc bật fp16",
  "resolvedAt": "14:25:30",
  "faqTitle": "Khắc phục lỗi CUDA out of memory"
}

// 3. Newly explained FAQ broadcast
{
  "type": "new_faq_available",
  "faq": { "canonicalQuestion": "...", "answer": "...", "keywords": [...] }
}
```

---

## 3. UI/UX Rules for Coding Agents
1. **Mobile First & Touch Targets:** All interactive buttons must have a minimum tap area of $44 \times 44$px. No horizontal scrolling on screens $\ge 320$px.
2. **Deflection Logic:** Keep keyword matching fast and ignore stop words (`["lỗi", "em", "thầy", "cho", "hỏi", "bị", "là", "sao", "thế", "nào", "ạ"]`).
3. **Local State:** Always cache `curator_student_id` and `curator_my_questions` in `localStorage` so refreshing the page does not lose personal question history.
4. **Non-Intrusive Echo Modal:** The echo popup modal must have a clear "Đã hiểu, cảm ơn Thầy! ✓" dismiss button.
