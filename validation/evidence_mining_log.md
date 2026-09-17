# Evidence B — Nhật ký mining Discord K4

## 1. Nguồn và phạm vi

- Nguồn: `data/discord-pack/k4_messages.csv` trong bộ dữ liệu Hackathon do BTC cung cấp.
- Khoảng thời gian dữ liệu: 12–14/09/2026.
- Tổng số bản ghi: **1.092 tin nhắn**.
- Tin nhắn của người dùng (`is_bot = False`): **779**.
- Tin nhắn bot: **313**.
- Dữ liệu đã được BTC ẩn danh; nhóm không sao chép toàn bộ file nguồn vào repo công khai.

## 2. Phương pháp đếm có thể kiểm lại

Nhóm lọc toàn bộ 779 tin nhắn người dùng, chuyển nội dung về dạng không phân biệt hoa/thường và đếm một tin nếu khớp ít nhất một biểu thức của chủ đề. Đây là phép đếm bảo thủ: chỉ dùng cụm từ rõ nghĩa, không suy diễn các tin không khớp.

| Chủ đề | Biểu thức dùng để lọc | Số tin | Số tác giả ẩn danh |
|---|---|---:|---:|
| Deadline/quy chế nộp muộn | `deadline`, `hạn nộp`, `nộp muộn`, `nộp trễ`, `quá hạn`, `gia hạn` | 16 | 15 |
| Điểm danh/Zoom/QR | `điểm danh`, `zoom`, `myvinuni`, `quét qr`, `mã qr` | 49 | 31 |
| Thiết lập CVAT/OPA | `cvat`, `opa`, `healthcheck`, `health check`, `bước 3`, `step 3` | 17 | 7 |
| Ghép đội/nhóm | `ghép đội`, `ghép nhóm`, `lập team`, `lập nhóm`, `đồng đội`, `đội tự do`, `tìm team`, `tìm nhóm` | 19 | 11 |
| XP/xếp hạng | `xp`, `/rank`, `điểm cộng`, `xem điểm`, `bảng xếp hạng`, `thứ hạng` | 39 | 25 |

Hợp của năm nhóm có **133/779 tin nhắn người dùng (17,1%)**. Một tin có thể khớp nhiều biểu thức nhưng chỉ được tính một lần trong số 133. Các số theo từng chủ đề dùng để mô tả độ phủ, không cộng trực tiếp thành tỷ lệ chung.

Lệnh kiểm tra trên PowerShell:

```powershell
$human = @(Import-Csv .\k4_messages.csv | Where-Object { $_.is_bot -eq 'False' })
$patterns = [ordered]@{
  deadline   = 'deadline|hạn nộp|nộp muộn|nộp trễ|quá hạn|gia hạn'
  attendance = 'điểm danh|zoom|myvinuni|quét qr|mã qr'
  technical  = 'cvat|\bopa\b|healthcheck|health check|bước 3|step 3'
  team       = 'ghép đội|ghép nhóm|lập team|lập nhóm|đồng đội|đội tự do|tìm team|tìm nhóm'
  xp         = '\bxp\b|/rank|điểm cộng|xem điểm|bảng xếp hạng|thứ hạng'
}

foreach ($topic in $patterns.Keys) {
  $matches = @($human | Where-Object { $_.content -match $patterns[$topic] })
  [pscustomobject]@{
    Topic = $topic
    Messages = $matches.Count
    Authors = @($matches.author | Sort-Object -Unique).Count
  }
}

$union = @($human | Where-Object {
  $content = $_.content
  @($patterns.Values | Where-Object { $content -match $_ }).Count -gt 0
})
$union.Count
```

## 3. Ví dụ nguyên văn có mã nguồn

1. `M03823`: “[@BOT] đặt tên zoom như thế nào”
2. `M69081`: “có điểm danh ws không ạ”
3. `M19124`: “a ơi sao deadline ghép đội tự do end sớm vậy a?”
4. `M33002`: “Hạn tìm đồng đội đến bao giờ thế mọi người ơi!!!”
5. `M51326`: “em chạy tới bước 3 thì bị lỗi như này ạ”
6. `M91580`: “[#channel] Xem điểm cộng ở đâu vậy”
7. `M82163`: “[@BOT] cái daly-standup sao m ghi là hết hôm nay nhưng nộp bài thì m kêu hết hạn.”

## 4. Diễn giải và giới hạn

- Năm nhóm chủ đề xuất hiện ở nhiều tác giả khác nhau, cho thấy nhu cầu điều phối các câu hỏi lặp theo chủ đề thay vì đọc một danh sách chat phẳng.
- Kết quả là tần suất tin nhắn khớp chủ đề, không phải tỷ lệ “câu hỏi trùng hoàn toàn”.
- Bộ dữ liệu chỉ bao phủ ba ngày onboarding và các kênh public; không đại diện cho toàn bộ khóa học.
- Evidence B là bằng chứng chính có thể tái lập cho CP4. Khảo sát ẩn danh trong `validation/problem_survey_log.md` được dùng làm bằng chứng bổ trợ.
