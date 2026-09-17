# Reflection Cá Nhân — Chu Văn Nhân (Product Lead)
**Mã học viên:** 2A202602668 · **Lớp:** 3A · **Nhóm:** K4-3A-E403-Curator  

---

### 1. Vai trò & Phần việc trực tiếp đảm nhiệm
- **Vai trò chính:** Product Lead kiêm Điều phối tiến độ các mốc (CP1 $\rightarrow$ CP6).
- **Phần việc cụ thể:**
  - Viết bản Canvas CP1 và hoàn thiện bản đặc tả `spec.md` (§1–§9) theo đúng chuẩn `03-ai-spec-template.md`.
  - Trực tiếp khai phá dữ liệu từ `data/discord-pack/`, đếm 779 tin nhắn học viên để chứng minh 68.0% câu hỏi lặp lại (Evidence Standard B).
  - Phỏng vấn $n=20$ học viên và 3 giảng viên/TA trong khoá theo phương pháp Mom Test (Evidence Standard A).
  - Soạn kịch bản thuyết trình 6 slide (`demo_slides.md`) và điều phối buổi thử nghiệm người dùng (R6).

### 2. AI đã hỗ trợ như thế nào trong công việc
- Sử dụng LLM để hỗ trợ phân loại sơ bộ các nhóm intent từ file chatlog 1.092 dòng giúp tiết kiệm 4 giờ đọc tay.
- Sử dụng AI để sinh các câu hỏi phản biện theo HAX Playbook nhằm phát hiện sớm các kịch bản rủi ro (đặc biệt là nguy cơ học viên vào muộn liên tục hỏi lại câu cũ).

### 3. Bài học từ Case Thất Bại của chính nhóm (Fail Case Lesson)
- **Case thất bại:** Ở mốc CP1 ban đầu, nhóm cam kết Non-goal: *"AI tuyệt đối không trả lời học viên"*. Nhưng khi chạy thử nghiệm, nhóm nhận ra học viên hỏi lại đúng câu cũ rất nhiều. Việc cấm AI trả lời khiến giảng viên vẫn phải nói đi nói lại 1 câu.
- **Bài học rút ra:** Không nên áp dụng tư duy nhị phân (hoàn toàn không trả lời vs hoàn toàn tự động). Giải pháp chuẩn mực là **Conditional Automation theo Cost-of-Error**: Khi chưa có căn cứ thì cấm AI bịa; nhưng khi giảng viên đã trả lời xong thì AI có thể dùng chính lời giảng viên làm Ground Truth để tự động trả lời cho các câu hỏi tương tự đến sau. Điều này biến tính năng Echo-Responder thành điểm sáng lớn nhất của dự án.
