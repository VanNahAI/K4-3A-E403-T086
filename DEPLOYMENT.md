# Hướng dẫn chạy phiên có xác thực

Phiên realtime yêu cầu `LECTURER_ACCESS_TOKEN` để cấp quyền cho giảng viên.
Không đặt token trong URL, mã nguồn hoặc Git.

## Chạy trên Windows PowerShell

```powershell
$env:LECTURER_ACCESS_TOKEN = "thay-bang-chuoi-bi-mat-dai"
$env:PORT = "3000"
$env:MAX_REQUEST_BODY_BYTES = "1048576"
$env:ZOOM_MEETING_URL = "https://us06web.zoom.us/j/meeting-id"
$env:ZOOM_MEETING_ID = "meeting-id"
$env:ZOOM_PASSCODE = "mat-khau-zoom"
$env:ZOOM_TOPIC = "AI20K Workshop"
$env:ZOOM_SPEAKER = "Ten giang vien"
$env:ZOOM_WEBHOOK_SECRET_TOKEN = "secret-token-tu-Zoom-Marketplace"
$env:ENABLE_SIMULATION = "false"
npm start
```

## Chạy trên Linux/macOS

```bash
export LECTURER_ACCESS_TOKEN="thay-bang-chuoi-bi-mat-dai"
export PORT=3000
export MAX_REQUEST_BODY_BYTES=1048576
export ZOOM_MEETING_URL="https://us06web.zoom.us/j/meeting-id"
export ZOOM_MEETING_ID="meeting-id"
export ZOOM_PASSCODE="mat-khau-zoom"
export ZOOM_TOPIC="AI20K Workshop"
export ZOOM_SPEAKER="Ten giang vien"
export ZOOM_WEBHOOK_SECRET_TOKEN="secret-token-tu-Zoom-Marketplace"
export ENABLE_SIMULATION=false
npm start
```

Mở `/` và chọn vai trò giảng viên. Nhập đúng token khi bắt đầu buổi học.
Token chỉ được giữ trong `sessionStorage` của tab hiện tại.

Endpoint kiểm tra trạng thái triển khai: `GET /api/health`. Endpoint chỉ trả
trạng thái cấu hình, không trả token hay mật khẩu Zoom.

## Nhận chat native từ Zoom Desktop

Ứng dụng có endpoint webhook:

```text
POST /api/zoom/webhook
```

Trong Zoom Marketplace, tạo app có Meeting event `meeting.chat_message_sent`,
đặt Event Notification Endpoint URL thành:

```text
https://<domain-public>/api/zoom/webhook
```

Sau đó lấy Secret Token của webhook đưa vào `ZOOM_WEBHOOK_SECRET_TOKEN`. Zoom
sẽ gửi cả bước URL validation và chữ ký `x-zm-signature`; server kiểm tra cả hai
trước khi đưa tin nhắn vào luồng `/lecturer`. Endpoint này cần HTTPS public,
không thể nhận webhook từ `localhost`.

Tin nhắn native được chuẩn hóa thành `new_student_question`, có tên người gửi,
thời gian, nội dung và cờ `source: zoom_webhook`. Khi tin trùng FAQ, lecturer
vẫn nhìn thấy câu hỏi ở trạng thái auto-resolved. Việc gửi câu trả lời ngược
trở lại cửa sổ Zoom cần thêm quyền/API gửi chat của Zoom; webhook nhận tin một
chiều không tự gửi trả lời vào meeting.

## Kiểm thử realtime

```powershell
$env:LECTURER_ACCESS_TOKEN = "test-lecturer-token"
$env:TEST_PORT = "3000"
npm run test:realtime
```

Nếu server không có `LECTURER_ACCESS_TOKEN`, các API quản trị sẽ bị khóa và
không thể bắt đầu phiên giảng viên.

Phòng Zoom mô phỏng bị tắt mặc định. Chỉ dùng `ENABLE_SIMULATION=true` khi cần
chạy bộ giao diện legacy để kiểm thử; triển khai thật phải dùng URL Zoom thật
trong biến môi trường `ZOOM_MEETING_URL`. Cấu hình này được kiểm tra trước khi
mở phiên, nên server sẽ không tạo phiên nếu link Zoom chưa hợp lệ.

Các API yêu cầu quyền giảng viên gồm:

- `POST /api/session/start`
- `POST /api/reset-session`
- `POST /api/config-zoom`
- `POST /api/zoom-import`

Webhook Zoom được xác thực riêng bằng `ZOOM_WEBHOOK_SECRET_TOKEN`, không dùng
`LECTURER_ACCESS_TOKEN`.

Trong môi trường Internet thật vẫn cần triển khai HTTPS/WSS, reverse proxy,
rate limit và cơ chế đăng nhập người dùng đầy đủ; token dùng ở bước này là
lớp bảo vệ tối thiểu cho prototype đang chuyển sang triển khai thật.

Server đã có giới hạn body JSON, giới hạn payload WebSocket, giới hạn tần suất
message theo kết nối, security headers cơ bản và graceful shutdown. Reverse
proxy vẫn cần giới hạn tốc độ theo IP ở lớp public.

## Deploy production bằng Docker + Caddy

Trên máy chủ đã trỏ DNS của domain về IP máy chủ:

```bash
cp .env.example .env.production
# Điền token và thông tin Zoom thật trong .env.production
export DOMAIN=qa.example.com
docker compose -f docker-compose.production.yml up -d --build
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs -f workshop-curator
```

Trên PowerShell:

```powershell
Copy-Item .env.example .env.production
# Điền token và thông tin Zoom thật trong .env.production
$env:DOMAIN = "qa.example.com"
docker compose -f docker-compose.production.yml up -d --build
docker compose -f docker-compose.production.yml ps
```

Caddy tự cấp HTTPS cho domain và chuyển tiếp cả HTTP lẫn WebSocket tới
container ứng dụng. Kiểm tra sau khi chạy:

```bash
curl https://qa.example.com/api/health
```

Không commit `.env.production`. Nếu dùng Render/Railway/Fly.io thay Docker
Compose, dùng cùng các biến môi trường trong `.env.example`, start command
`npm start`, health check path `/api/health`, và bật WebSocket support.
