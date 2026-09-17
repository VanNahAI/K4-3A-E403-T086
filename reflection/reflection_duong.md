# Reflection Cá Nhân — Dương Dương (AI Engineer & QA)
**Mã học viên:** 2A202602498 · **Lớp:** 3A · **Nhóm:** K4-3A-E403-Curator  

---

### 1. Vai trò & Phần việc trực tiếp đảm nhiệm
- **Vai trò chính:** AI Engineer & Quality Assurance Lead.
- **Phần việc cụ thể:**
  - Thiết kế `codebase/ai_engine.js`: Hỗ trợ kết nối linh hoạt giữa OpenRouter Mini API và Local Ollama Qwen2.5-3B.
  - Thiết kế logic đối soát bộ đệm tri thức (Echo-Responder Cache) để tự động nhận diện câu hỏi đã có đáp án với độ tin cậy $\ge 85\%$.
  - Xây dựng tập Golden Set 24 cases (`eval/golden_set.json`) phủ trọn 4 lớp chỗ khó.
  - Viết runner tự động hóa `eval/run_eval.js` và xuất báo cáo `eval/eval_results_run1.md` đạt 87.5% qua bộ.
  - Xây dựng công cụ chẩn đoán Thẻ Giám Khảo Sandbox cho vòng Q&A tại CP6.

### 2. AI đã hỗ trợ như thế nào trong công việc
- Sử dụng LLM để sinh các câu hỏi adversarial (prompt injection, jailbreak thử nghiệm vào Lớp ③) để kiểm tra độ bền vững của bộ lọc Regex + Prompt Guardrails.
- Hỗ trợ viết script runner tự động trong Node.js để đối soát kết quả JSON nhanh chóng.

### 3. Bài học từ Case Thất Bại của chính nhóm (Fail Case Lesson)
- **Case thất bại:** Trong lượt chạy đầu tiên của tập Golden Set, case `GS17` (*"Lab 2 nộp muộn bị trừ điểm thế nào và link nộp ở đâu ạ?"*) bị fail do AI bắt vội từ khóa "nộp muộn" rồi tự động gửi đáp án vế 1, bỏ quên vế 2 ("link nộp ở đâu").
- **Bài học rút ra:** Đa ý định (Multi-intent) là cạm bẫy kinh điển trong AI hội thoại. Không được vội vàng gộp câu khi phát hiện từ khóa mạnh mà phải thiết kế cơ chế phát hiện liên từ ("và", "kèm theo") để tách câu hỏi kép thành 2 nhiệm vụ xử lý riêng biệt. Đây là kinh nghiệm quý giá cho phiên bản tiếp theo.
