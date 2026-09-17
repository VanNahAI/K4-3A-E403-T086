# Reflection Cá Nhân — Nguyễn Khắc Quang (Frontend Engineer)
**Mã học viên:** 2A20260285 · **Lớp:** 3A · **Nhóm:** K4-3A-E403-Curator  

---

### 1. Vai trò & Phần việc trực tiếp đảm nhiệm
- **Vai trò chính:** Frontend & Interaction Engineer.
- **Phần việc cụ thể:**
  - Xây dựng giao diện Realtime Dual Workspace trên Vanilla CSS/JS (`codebase/index.html`, `style.css`, `app.js`).
  - Triển khai tính năng **Web Speech API Live Microphone Mirror**: Cho phép Giảng viên nói trực tiếp vào laptop để nhận diện giọng nói tiếng Việt thời gian thực mà không cần thêm API cloud.
  - Thiết kế các tương tác Human-AI theo chuẩn HAX: Accordion trích dẫn tin gốc (HAX G11), Modal tách nhóm (HAX G9), và Cháy Chat Radar banner (HAX G12).
  - Tích hợp Modal xuất bản tin Discord K4 Recap dạng Markdown.

### 2. AI đã hỗ trợ như thế nào trong công việc
- Sử dụng Claude / Gemini để gợi ý cấu trúc CSS animation (hiệu ứng sóng âm thanh sound-wave khi bật mic, hiệu ứng nhấp nháy đỏ của Radar banner).
- Hỗ trợ viết nhanh logic lắng nghe event SpeechRecognition của trình duyệt.

### 3. Bài học từ Case Thất Bại của chính nhóm (Fail Case Lesson)
- **Case thất bại:** Trong buổi thử nghiệm người dùng với học viên Chu Minh Quân, bạn ấy đã lúng túng không nhìn thấy nút trích dẫn tin gốc vì giao diện dùng nút màu xám nhạt chìm vào nền tối.
- **Bài học rút ra (Vibe-coding rule):** Giao diện đẹp không có nghĩa là giao diện dễ dùng. Trong bối cảnh lớp học căng thẳng, các nút tương tác kiểm chứng (Explainability - HAX G11) phải có độ tương phản thị giác cao và nhãn rõ ràng ("Xem N tin gốc ▾") để người dùng không mất thời gian tìm kiếm. Tôi đã lập tức sửa lại style CSS ngay sau phiên test đó.
