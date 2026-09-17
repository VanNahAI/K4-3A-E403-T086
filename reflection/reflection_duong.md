# Reflection Cá Nhân — Dương Dương (AI Engineer & QA)
**Mã học viên:** 2A202602498 · **Lớp:** 3A · **Nhóm:** K4-3A-E403-Curator  

---

### 1. Vai trò & Phần việc trực tiếp đảm nhiệm
- **Vai trò chính:** AI Engineer & Quality Assurance Lead.
- **Phần việc cụ thể:**
  - Thiết kế `codebase/ai_engine.js`: Hỗ trợ kết nối linh hoạt giữa OpenRouter Mini API và Local Ollama Qwen2.5-3B.
  - Thiết kế logic đối soát bộ đệm tri thức (Echo-Responder Cache) để tự động nhận diện câu hỏi đã có đáp án với độ tin cậy $\ge 85\%$.
  - Xây dựng tập Golden Set 25 cases (`eval/golden_set.json`) phủ trọn 4 lớp chỗ khó, mỗi lớp có ít nhất 2 case.
  - Viết runner tự động hóa `eval/run_eval.js`, bổ sung kiểm tra điều kiện cứng Prompt Injection và xuất báo cáo `eval/eval_results_run1.md` đạt 100% qua bộ sau vòng sửa CP4.
  - Xây dựng công cụ chẩn đoán Thẻ Giám Khảo Sandbox cho vòng Q&A tại CP6.

### 2. AI đã hỗ trợ như thế nào trong công việc
- Sử dụng LLM để sinh các câu hỏi adversarial (prompt injection, jailbreak thử nghiệm vào Lớp ③) để kiểm tra độ bền vững của bộ lọc Regex + Prompt Guardrails.
- Hỗ trợ viết script runner tự động trong Node.js để đối soát kết quả JSON nhanh chóng.

### 3. Bài học từ Case Thất Bại của chính nhóm (Fail Case Lesson)
- **Case thất bại ở lượt đầu:** `GS17` (*"Lab 2 nộp muộn bị trừ điểm thế nào và link nộp ở đâu ạ?"*) bị fail do hệ thống bắt vội từ khóa "nộp muộn", có nguy cơ bỏ quên vế "link nộp ở đâu".
- **Bài học rút ra:** Đa ý định (Multi-intent) là cạm bẫy kinh điển trong AI hội thoại. Tôi bổ sung cơ chế phát hiện liên từ và chuyển câu sang hàng đợi `Cần tách ý`, sau đó chạy lại trọn bộ để xác nhận GS17 đạt mà không làm vỡ các case cũ.
