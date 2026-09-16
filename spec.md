# AI SPEC (Bản nộp Checkpoint 1) — Workshop Question Curator
**Nhóm:** K4-3A · **Lớp:** 3A · **Phòng:** E402/E403  
**Hướng:** [x] Track E — Làn mở (AI20k) · **Loại:** [x] Tính năng mới  

---

## 📋 CANVAS CHECKPOINT 1 (7 DÒNG NỘP TA)

1. **HƯỚNG:** Track E · Làn mở — **Workshop Question Curator**: Tổng hợp và ưu tiên câu hỏi realtime trong Zoom.
2. **JOB EXECUTOR:** Giảng viên hoặc Trợ giảng (TA) đang dạy workshop trên Zoom, vừa trình bày bài vừa theo dõi luồng Chat và Q&A của học viên.
3. **PAIN (Nỗi đau cụ thể):** Câu hỏi gửi đến liên tục và trôi rất nhanh với nhiều cách diễn đạt khác nhau; giảng viên/TA phải đọc lướt thủ công từng dòng, không biết câu nào đang được lặp lại nhiều nhất, dễ bỏ sót vấn đề chung và làm gián đoạn nhịp giảng dạy.
4. **BẰNG CHỨNG ĐẦU TIÊN (Evidence):** Dữ liệu proxy K4 có 1.092 tin Discord, trong đó 779 tin người dùng gửi với >68% câu hỏi trùng ý định cốt lõi nhưng phân tán câu chữ (76 tin deadline, 50 tin điểm danh Zoom/QR, 38 tin lỗi lab/CVAT). Các câu hỏi lặp lại rõ rệt: `M03823` (*"đặt tên zoom như thế nào"*), `M69081` (*"có điểm danh ws không ạ"*), `M19124` vs `M33002` (*"deadline ghép đội tự do"*), `M51326` (*"lỗi bước 3 CVAT"*).
5. **LÁT CẮT MỘT CÂU:** **Một giảng viên · theo dõi Q&A Zoom trong workshop · AI gom và xếp hạng câu hỏi theo số lần lặp · giảng viên xử lý Top 5 trước khi buổi học kết thúc.**
6. **AUTOMATION DỰ KIẾN & WILLING USERS:**
   - *Mức tự động hóa:* **Conditional Automation** — AI tự gom cụm câu trùng ý và đếm số lần lặp mỗi 5–10 giây; câu mấp mé (confidence thấp) đưa vào mục chờ duyệt, AI tuyệt đối không tự trả lời học viên.
   - *Willing Users dự kiến (≥2 người):* 1 Giảng viên/TA phòng lab + 4 học viên trong lớp tham gia gửi câu hỏi stream thật để thử nghiệm.
7. **PHÂN CÔNG VAI TRÒ CỤ THỂ:**
   - **Thành viên 1:** Product Lead — Canvas, Spec, Bằng chứng & điều phối các mốc.
   - **Thành viên 2:** Frontend — Giao diện Realtime Dashboard Top 10 + Bộ giả lập luồng Zoom Chat.
   - **Thành viên 3:** AI Engineer — Pipeline gom cụm ngữ nghĩa (Clustering), đếm tần suất và chuẩn hóa câu đại diện.
   - **Thành viên 4:** QA & Testing — Xây dựng Golden Set 20 case, đo lường độ chính xác và chuẩn bị demo.

---

## 🎯 CHI TIẾT GỌN CHO MỐC CP1

### 1. Job Statement & Problem Statement (Tuyệt đối không chữ "AI")
- **Core JTBD:** Khi đang điều phối buổi học trực tuyến đông người, người dạy muốn nhanh chóng nhận biết và giải đáp những thắc mắc phổ biến nhất của người học mà không làm gián đoạn nhịp giảng dạy.
- **Problem Statement:** Giảng viên và trợ giảng trong các buổi học trực tuyến đông người gặp tình trạng quá tải thông tin khi các thắc mắc của học viên bị phân mảnh thành hàng chục câu hỏi khác nhau về câu chữ nhưng trùng lặp về bản chất và trôi nhanh trong hộp thoại, dẫn đến việc mất nhiều thời gian đọc lọc thủ công, bỏ sót các lỗ hổng kiến thức mang tính hệ thống của lớp học và làm gián đoạn mạch truyền đạt.

### 2. Bảng Impact tóm tắt

| Ứng viên | Quy mô | Tần suất | Thiệt hại mỗi lần | Khả thi 48h | Quyết định |
|---|---|---|---|:---:|:---:|
| **Workshop Question Curator** | **350 học viên + 2 GV/TA** | **2 buổi/tuần** | Mất 15-20' đọc chat, sót 30% vướng mắc chung | Rất cao | **CHỌN** |
| Git Deadline Appeal Auditor | 40 học viên | 1 lần/tuần | Tốn 2-3h soi git log từng người | Cao | Loại (tần suất hẹp) |
| XP & Attendance Anomaly Hunter | 80 học viên | 1 lần/tuần | Tốn 10'/học viên tra cứu lịch sử | TB | Loại (hệ thống đóng) |

### 3. Non-goals (3 điều cam kết KHÔNG làm)
1. Không tự động sinh câu trả lời gửi lại cho học viên (giảng viên là người trả lời duy nhất).
2. Không tự động post tin nhắn can thiệp vào Zoom chat của lớp.
3. Không thu thập hay đánh giá danh tính học viên (hoàn toàn ẩn danh).
