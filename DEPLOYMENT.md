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
trước khi đưa tin nhắn vào companion Host của CP3. Endpoint này cần HTTPS public,
không thể nhận webhook từ `localhost`.

Tin nhắn native được chuẩn hóa thành `new_student_question`, có tên người gửi,
thời gian, nội dung và cờ `source: zoom_webhook`. Khi tin trùng FAQ, lecturer
vẫn nhìn thấy câu hỏi ở trạng thái auto-resolved. Việc gửi câu trả lời ngược
trở lại cửa sổ Zoom cần thêm quyền/API gửi chat của Zoom; webhook nhận tin một
chiều không tự gửi trả lời vào meeting.

## Chạy Curator AI bên trong Zoom Meeting

General App trong Zoom Marketplace cần cấu hình **Surface > Meetings** như sau:

```text
Home URL:
https://heftiness-ship-laboring.ngrok-free.dev/zoom-app

Domain Allow List:
heftiness-ship-laboring.ngrok-free.dev
appssdk.zoom.us
```

Bật **Zoom App SDK**, sau đó trong **Add APIs** chọn bốn API:

- `getRunningContext`
- `getUserContext`
- `getMeetingContext`
- `getAppContext`

Scope `zoomapp:inmeeting` phải được giữ lại. Khi Host hoặc Co-host mở ứng dụng
trong một Meeting thật, SDK tự lấy Meeting ID, đồng bộ bộ lọc webhook và mở
phiên realtime. Participant/Guest mở cùng ứng dụng sẽ thấy companion Học viên
của CP3 để gửi câu hỏi, nhận FAQ và auto-reply. Ngoài ra, Event Subscription
`meeting.chat_message_sent` vẫn đưa câu hỏi từ Chat gốc của Zoom vào companion
Host; luồng webhook này chỉ nhận dữ liệu một chiều từ Zoom.

Home URL `/zoom-app` là bộ định tuyến vai trò: Host/Co-host được đưa vào
`/zoom-app/lecturer` với giao diện cockpit CP3; Participant/Guest được đưa vào
`/zoom-app/student` với giao diện hỏi đáp học viên CP3. Không đặt Home URL trực
tiếp thành `/lecturer`, vì như vậy mọi người tham gia đều nhìn thấy cùng một
giao diện giảng viên.

OAuth Redirect URL vẫn là `/api/zoom/oauth/callback`. Sau khi bấm **Add app
now**, callback chuyển sang `/zoom-auth-success`; trang này chỉ xác nhận đã thêm
app và không mở dashboard `/lecturer`.

Đường dẫn `/zoom` và giao diện phòng họp giả không thuộc luồng triển khai này.

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

Với cấu hình hiện tại chỉ cần **General app 984**. App này vừa cung cấp Zoom App
Surface, vừa có Event Subscription trong **Features > Access**. Hãy đặt URL
`/api/zoom/webhook`, bật event `Meeting Chat Message Sent` /
`meeting.chat_message_sent`, rồi dùng Secret Token của chính General app 984
trong `.env.production`. Không trộn Secret Token của một app Zoom khác.

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

## Kiểm thử Zoom App bằng ngrok trên Windows

Để tránh Caddy tự chuyển hướng HTTP sang HTTPS khi dùng domain `localhost`,
dùng file override chỉ mở ứng dụng Node trên máy local:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-zoom-ngrok.ps1
```

Giữ cửa sổ ngrok luôn mở. Endpoint OAuth và webhook khi đó dùng:

```text
https://heftiness-ship-laboring.ngrok-free.dev/api/zoom/oauth/callback
https://heftiness-ship-laboring.ngrok-free.dev/api/zoom/webhook
```

Nếu ngrok cấp domain khác, cập nhật lại các URL này trong Zoom Marketplace và
`ZOOM_OAUTH_REDIRECT_URI` rồi recreate container.

Không commit `.env.production`. Nếu dùng Render/Railway/Fly.io thay Docker
Compose, dùng cùng các biến môi trường trong `.env.example`, start command
`npm start`, health check path `/api/health`, và bật WebSocket support.
