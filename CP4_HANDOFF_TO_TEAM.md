# CP4 → testcuaQuang: Tài liệu bàn giao Curator AI cho team

> Tài liệu này mô tả phần đã hoàn thành sau mốc CP4, cách cài đặt API key và Zoom App, cách chạy ứng dụng thật, cách kiểm thử luồng giảng viên/học viên, và cách xử lý lỗi.
>
> Không đưa secret thật, Client Secret, webhook token, OpenRouter key hoặc access token thật vào Git, README, ảnh chụp màn hình hay tin nhắn nhóm.

## 1. Trạng thái hiện tại

- Nhánh bàn giao: testcuaQuang.
- Nhánh mốc tham chiếu: CP4.
- CP4 đã khóa chất lượng ở mức 25/25 test case đạt, 100% chặn prompt injection và không crash theo spec.md.
- Sau CP4, prototype đã được đưa sang luồng Zoom thật:
  - Zoom Workplace mở đúng giao diện theo vai trò.
  - Host/Co-host nhìn thấy cockpit giảng viên của thiết kế CP3.
  - Participant/Guest nhìn thấy giao diện học viên của thiết kế CP3.
  - Chat native của Zoom được gửi về server qua webhook có chữ ký.
  - Câu hỏi được chuyển vào WebSocket và cập nhật cockpit giảng viên.
  - OAuth của General App được xử lý ở server và có trang thành công riêng.
  - Có cấu hình Docker + Caddy cho production.
  - Có hướng dẫn chạy local + ngrok để kiểm thử tài khoản Zoom thật.

### Các commit chính sau CP4

| Commit | Nội dung | Kết quả |
|---|---|---|
| 594f3f5 | Sửa XSS khi hiển thị dữ liệu người dùng | Render nội dung chat an toàn hơn |
| 913fee6 | Xác thực và phân quyền giảng viên | API quản trị yêu cầu Bearer token |
| a2bdb35 | Chuyển luồng tham gia sang Zoom thật | Production không phụ thuộc phòng giả |
| 381564f | Hardening server | Giới hạn request/WebSocket, security headers, shutdown |
| 9defed6 | Docker + Caddy | Có cấu hình build production và HTTPS proxy |
| b45bb4f | Nhận chat native qua webhook | Verify chữ ký, URL validation, lọc meeting, chống duplicate |
| ff1ee24 | Callback OAuth cho Zoom App | Đổi code lấy token ở server, không trả token ra browser |

## 2. Luồng vai trò trong Zoom

Home URL phải trỏ đến:

~~~text
https://<PUBLIC_DOMAIN>/zoom-app
~~~

Không đặt Home URL trực tiếp là /lecturer. /lecturer chỉ còn là route cũ và server redirect về /zoom-app.

~~~text
Zoom Apps SDK
    |
    | getRunningContext() + getUserContext()
    v
/zoom-app
    |
    | host hoặc cohost
    +----> /zoom-app/lecturer?zoom_app=1
    |          -> cockpit giảng viên CP3
    |
    | participant, guest hoặc role khác
    +----> /zoom-app/student?zoom_app=1
               -> giao diện hỏi đáp học viên CP3
~~~

Người dùng phải đang ở trong Meeting thật. Nếu mở app ngoài Meeting, zoom_entry.js hiển thị yêu cầu tham gia Meeting.

### Host/Co-host

1. Zoom mở /zoom-app.
2. zoom_entry.js lấy runningContext và userContext.
3. Host/Co-host được chuyển sang /zoom-app/lecturer.
4. zoom_app.js lấy getAppContext() và gửi context mã hóa đến POST /api/zoom/bootstrap.
5. Server kiểm tra issuer, audience, thời hạn và vai trò.
6. App lấy Meeting ID từ getMeetingContext().
7. App gọi POST /api/config-zoom để gắn webhook với Meeting ID thật.
8. App gọi POST /api/session/start để mở phiên mới.
9. Cockpit kết nối WebSocket /ws với role lecturer.

### Participant/Guest

- Participant/Guest được chuyển sang /zoom-app/student.
- Giao diện học viên kết nối WebSocket nhưng không có quyền lecturer.
- Form hỏi đáp trong app đi theo luồng realtime CP3.
- Chat gốc của Zoom đi qua event meeting.chat_message_sent.
- Server verify chữ ký, kiểm tra Meeting ID, chống duplicate rồi broadcast new_student_question tới cockpit giảng viên.
- Nếu câu hỏi khớp FAQ đã được xác nhận, UI có thể hiển thị auto-resolved.

Webhook hiện là luồng nhận dữ liệu một chiều. App chưa tự gửi câu trả lời ngược vào Chat gốc của Zoom; câu trả lời được hiển thị trong companion/cockpit.

## 3. File cần biết

### Server

- server.js: HTTP, REST, WebSocket, OAuth callback, Zoom bootstrap, webhook validation và ingest chat.
- .env.example: biến môi trường mẫu, không chứa secret thật.
- Dockerfile: image Node production.
- docker-compose.production.yml: app + Caddy.
- docker-compose.ngrok.yml: publish app Node ở 127.0.0.1:3000.
- Caddyfile: reverse proxy HTTPS cho domain thật.

### Zoom App

- codebase/zoom_entry.html: Home URL và bộ định tuyến vai trò.
- codebase/zoom_entry.js: lấy role và redirect lecturer/student.
- codebase/zoom_app.js: cấu hình SDK, bootstrap Host, lấy Meeting ID, mở session.
- codebase/zoom_student.js: kiểm tra context và lấy identity/Meeting ID.
- codebase/pip_companion.html: layout cockpit lecturer và student CP3.
- codebase/pip_companion.js: WebSocket, đếm tin, gom cụm, FAQ và echo UI.
- codebase/auth_client.js: giữ token lecturer trong sessionStorage.

### AI và test

- codebase/ai_engine.js: OpenRouter, Ollama và fallback heuristic.
- codebase/app.js: dashboard legacy, cấu hình AI, voice mirror và recap.
- eval/test_zoom_role_routing.js: kiểm tra host/co-host → lecturer và participant/guest → student.
- eval/test_zoom_panel_routes.js: kiểm tra route/assets Zoom App.
- eval/test_zoom_app_bootstrap.js: kiểm tra bootstrap context.
- eval/test_zoom_webhook.js: kiểm tra validation, chữ ký, accept, duplicate và meeting ID.
- eval/test_realtime_e2e.js: kiểm tra realtime.
- eval/test_clustering_regressions.js: regression AI/clustering.

## 4. API key và secret

Không trộn các credential sau:

| Credential | Nơi tạo | Dùng cho |
|---|---|---|
| LECTURER_ACCESS_TOKEN | Tự tạo tại máy deploy | Bảo vệ API quản trị |
| OpenRouter API key | OpenRouter | Gọi LLM cloud từ AI Engine |
| Zoom Client ID/Secret | Zoom Marketplace → App Credentials | OAuth và Zoom App Context |
| Zoom Webhook Secret Token | Features → Access → Event Subscription | Xác minh request webhook |

### 4.1. Tạo LECTURER_ACCESS_TOKEN

Token này không phải Zoom token. Tạo chuỗi random trên PowerShell:

~~~powershell
([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
~~~

Lưu vào .env.production:

~~~dotenv
LECTURER_ACCESS_TOKEN=chuoi-random-dai
~~~

Không đặt token vào URL, QR code, Git hoặc ảnh chụp. Client chỉ lưu token tạm trong sessionStorage.

### 4.2. Tạo OpenRouter API key

1. Mở https://openrouter.ai/keys.
2. Đăng nhập tài khoản team.
3. Chọn Create Key.
4. Đặt tên theo máy/người dùng, ví dụ curator-demo-quang.
5. Copy key ngay sau khi tạo; không commit key.
6. Mở dashboard host tại /host.
7. Mở Cấu hình AI.
8. Chọn provider OpenRouter.
9. Dán vào OpenRouter API Key.
10. Chọn model:

~~~text
meta-llama/llama-3.2-3b-instruct:free
~~~

11. Bấm Lưu cấu hình.

Key hiện lưu trong localStorage của browser và gửi trực tiếp đến OpenRouter. Đây là cách dùng cho prototype/demo; production thật nên chuyển LLM call về server-side proxy.

Không có OpenRouter key thì chọn Built-in Intelligent Heuristic để chạy offline, hoặc Local Ollama với model qwen2.5:3b-instruct ở localhost:11434.

### 4.3. Lấy Zoom Client ID/Secret

Có thể dùng General app 984 trong Development.

1. Mở https://marketplace.zoom.us/develop/apps.
2. Vào Created apps.
3. Mở General app 984.
4. Chọn Development → Basic Information.
5. Tìm App Credentials.
6. Copy Client ID vào ZOOM_OAUTH_CLIENT_ID.
7. Copy Client Secret vào ZOOM_OAUTH_CLIENT_SECRET.

Không bấm Regenerate nếu chưa thống nhất với team, vì credential cũ trong .env.production sẽ mất hiệu lực.

### 4.4. Lấy Zoom Webhook Secret Token

Đây là token riêng của Event Subscription, không phải Client Secret và không phải LECTURER_ACCESS_TOKEN.

1. Trong General app 984, vào Features.
2. Chọn Access.
3. Bật Event Subscription.
4. Chọn hoặc tạo subscription Zoom Meeting Chat.
5. Chọn Webhook/event notification.
6. Điền:

~~~text
https://<PUBLIC_DOMAIN>/api/zoom/webhook
~~~

7. Thêm event In-meeting chat message received, có thể hiển thị tên kỹ thuật meeting.chat_message_sent.
8. Lưu subscription.
9. Copy Secret Token của đúng General app 984 vào:

~~~dotenv
ZOOM_WEBHOOK_SECRET_TOKEN=secret-token-cua-general-app-984
~~~

Zoom có thể gửi URL validation. Server phải trả plainToken và encryptedToken; không sửa response thủ công.

### 4.5. Scope

Trong Scopes, giữ/thêm tối thiểu:

~~~text
zoomapp:inmeeting
meeting:read:chat_message
~~~

Sau khi đổi scope hoặc Event Subscription, phải Generate Authorization URL mới và authorize lại app.

## 5. Cấu hình Zoom App

### Surface

Trong Features → Surface:

1. Home URL:

~~~text
https://<PUBLIC_DOMAIN>/zoom-app
~~~

2. Domain Allow List:

~~~text
<PUBLIC_DOMAIN>
appssdk.zoom.us
~~~

3. Select where to use your app: chọn Meetings.
4. Bật Zoom App SDK.
5. Trong Add APIs chọn:

~~~text
getRunningContext
getUserContext
getMeetingContext
getAppContext
~~~

Không cần bật Meeting SDK, Contact Center SDK hoặc Phone SDK cho luồng hiện tại.

### Các mục không cần chọn

- Embed: không cần; không nhúng Meeting SDK ngoài.
- Connect: không cần upload API spec.
- Custom Form: để trống.
- Actions and Triggers: để trống.
- Plugin SDK: không cần.
- Guest Mode, In-Client OAuth, Collaborate Mode: chỉ bật khi có nghiệp vụ riêng.

### OAuth Redirect URL

Trong Basic Information → OAuth Information đặt chính xác:

~~~text
https://<PUBLIC_DOMAIN>/api/zoom/oauth/callback
~~~

URL phải khớp tuyệt đối với ZOOM_OAUTH_REDIRECT_URI, gồm protocol, hostname và path.

Success path:

~~~text
/zoom-auth-success
~~~

OAuth code được đổi ở server. Token không trả về browser/log. Grant hiện chỉ giữ trong memory process.

## 6. .env.production

Tạo file:

~~~powershell
Copy-Item .env.example .env.production
~~~

Điền các biến:

~~~dotenv
LECTURER_ACCESS_TOKEN=token-giang-vien-random
PORT=3000
MAX_REQUEST_BODY_BYTES=1048576

ZOOM_MEETING_URL=https://us06web.zoom.us/j/MEETING_ID
ZOOM_MEETING_ID=MEETING_ID
ZOOM_PASSCODE=mat-khau-meeting
ZOOM_TOPIC=AI20K Workshop
ZOOM_SPEAKER=Ten giang vien

ZOOM_WEBHOOK_SECRET_TOKEN=secret-token-tu-event-subscription
ZOOM_OAUTH_CLIENT_ID=client-id-tu-app-credentials
ZOOM_OAUTH_CLIENT_SECRET=client-secret-tu-app-credentials
ZOOM_OAUTH_REDIRECT_URI=https://PUBLIC_DOMAIN/api/zoom/oauth/callback
ZOOM_OAUTH_SUCCESS_PATH=/zoom-auth-success

ENABLE_SIMULATION=false
~~~

| Biến | Bắt buộc | Ý nghĩa |
|---|---:|---|
| LECTURER_ACCESS_TOKEN | Có cho fallback local | Bearer token bảo vệ API |
| PORT | Không, mặc định 3000 | HTTP/WebSocket port |
| MAX_REQUEST_BODY_BYTES | Không | Giới hạn body JSON |
| ZOOM_MEETING_URL | Có khi mở session | Link Meeting thật |
| ZOOM_MEETING_ID | Nên có | Filter webhook theo Meeting |
| ZOOM_PASSCODE | Tùy | Passcode Meeting |
| ZOOM_TOPIC | Tùy | Tên buổi học |
| ZOOM_SPEAKER | Tùy | Tên giảng viên |
| ZOOM_WEBHOOK_SECRET_TOKEN | Có để nhận chat | Verify x-zm-signature |
| ZOOM_OAUTH_CLIENT_ID | Có | Client ID General App |
| ZOOM_OAUTH_CLIENT_SECRET | Có | Client Secret General App |
| ZOOM_OAUTH_REDIRECT_URI | Có | Redirect URI tuyệt đối |
| ZOOM_OAUTH_SUCCESS_PATH | Không | Trang xác nhận authorize |
| ENABLE_SIMULATION | Production phải false | Tắt phòng giả |

Node không tự đọc .env.production. Chạy trực tiếp phải export biến vào process hoặc dùng Docker Compose.
+
## 7. Chạy local trên Windows + ngrok

Đây là cách khuyến nghị cho demo Zoom thật trên máy Windows.

### 7.1. Kiểm tra Node và repo

~~~powershell
node --version
npm.cmd --version
git status --short
~~~

Nên dùng Node 22 LTS trở lên. Cài dependency:

~~~powershell
npm.cmd ci --omit=dev
~~~

### 7.2. Nạp .env.production rồi chạy server trực tiếp

Mở PowerShell tại root repo. Đoạn lệnh sau nạp biến mà không in secret ra màn hình:

~~~powershell
$envFile = Join-Path (Get-Location) '.env.production'
Get-Content -LiteralPath $envFile | ForEach-Object {
  if ($_ -match '^\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.*)\\s*$') {
    $name = $Matches[1]
    $value = $Matches[2].Trim()
    Set-Item -Path ("Env:" + $name) -Value $value
  }
}
$env:PORT = '3000'
npm.cmd start
~~~

Kiểm tra:

~~~powershell
curl.exe -sS http://127.0.0.1:3000/api/health
~~~

### 7.3. Chạy ngrok

Đăng nhập ngrok một lần:

~~~powershell
ngrok config add-authtoken <NGROK_AUTHTOKEN>
~~~

Chạy tunnel:

~~~powershell
ngrok http http://127.0.0.1:3000 --url https://<PUBLIC_DOMAIN>
~~~

Không dùng ngrok http https://localhost:443 hoặc flag --verify-tls=false. App Node local là HTTP; ngrok chịu trách nhiệm TLS public.

Kiểm tra tunnel:

~~~powershell
Invoke-RestMethod http://127.0.0.1:4040/api/tunnels |
  Select-Object -ExpandProperty tunnels |
  Select-Object name, public_url, proto, config
~~~

Tunnel phải trỏ đến https://<PUBLIC_DOMAIN> -> http://127.0.0.1:3000.

### 7.4. Kiểm tra public endpoint

~~~powershell
curl.exe -k -i https://<PUBLIC_DOMAIN>/api/health
~~~

Nếu thấy ERR_NGROK_3004, ngrok còn sống nhưng app local ở cổng 3000 đã tắt/crash. Kiểm tra:

~~~powershell
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
~~~

### 7.5. Script Docker hiện có

start-zoom-ngrok.ps1 dùng Docker Compose. Nếu gặp docker-credential-desktop not found, Docker chưa sẵn sàng; dùng direct Node + ngrok. Ngrok vẫn có thể giữ nguyên tunnel.

## 8. Local Test và cấp quyền OAuth

Sau khi local server và ngrok trả /api/health thành công:

1. Mở General app 984 trong Zoom Marketplace.
2. Chọn Development → Local Test.
3. Bấm Generate ở Authorization URL.
4. Mở URL mới.
5. Đăng nhập đúng Zoom account.
6. Bấm Allow.
7. Kết quả đúng:

~~~text
https://<PUBLIC_DOMAIN>/zoom-auth-success?zoom_auth=success
~~~

Authorization code chỉ dùng một lần và có thời hạn ngắn. Nếu callback báo Zoom không chấp nhận mã cấp quyền, quay lại Local Test → Generate và dùng URL mới. Nếu callback báo ERR_NGROK_3004, kiểm tra app Node còn chạy.

## 9. Chạy thử Meeting thật

### Flow kiểm thử

1. Tài khoản A mở Zoom Workplace và tạo Meeting thật.
2. A chọn Apps → My Apps → General app 984.
3. App mở /zoom-app và tự vào /zoom-app/lecturer vì A là Host/Co-host.
4. Chờ app mở session.
5. Tài khoản B tham gia cùng Meeting.
6. B mở General app 984 và tự vào /zoom-app/student.
7. B gửi trong Chat gốc của Zoom, ví dụ:

~~~text
Hôm nay học chủ đề gì?
Deadline của Lab 2 là khi nào?
Em bị lỗi Docker ở bước 3 thì xử lý thế nào?
~~~

8. Zoom gửi meeting.chat_message_sent tới /api/zoom/webhook.
9. Server verify chữ ký và Meeting ID.
10. Cockpit A nhận new_student_question qua WebSocket và cập nhật chỉ số.

Kiểm tra webhook:

~~~powershell
Invoke-RestMethod https://<PUBLIC_DOMAIN>/api/health | ConvertTo-Json -Depth 5
~~~

- zoomWebhook.received: số request Zoom gửi.
- zoomWebhook.signatureRejected: request sai chữ ký/quá hạn.
- zoomWebhook.validationRequests: URL validation thành công.
- zoomWebhook.acceptedMessages: chat mới đã đưa vào session.
- zoomWebhook.ignoredMessages: duplicate, sai Meeting ID, session chưa mở hoặc event khác.
- zoomWebhook.lastEvent và lastOutcome: event/kết quả cuối.
+
## 10. REST/WebSocket API chính

| Method | Path | Auth | Chức năng |
|---|---|---|---|
| GET | /api/health | Không | Trạng thái server/cấu hình/webhook diagnostics |
| GET | /api/config-zoom | Không | Đọc public meeting config |
| POST | /api/config-zoom | Lecturer token hoặc Zoom App session | Gắn Meeting ID/topic thật |
| POST | /api/session/start | Lecturer token hoặc Zoom App session | Mở phiên mới, clear state |
| GET | /api/session/state | Không | Đọc trạng thái phiên |
| POST | /api/session/join | Không | Participant kiểm tra phiên |
| POST | /api/reset-session | Lecturer token | Đóng/xóa phiên |
| POST | /api/zoom/bootstrap | Zoom App context | Xác minh Host/Co-host, cấp token ngắn hạn |
| GET | /api/zoom/oauth/callback | OAuth code | Đổi code lấy Zoom token ở server |
| POST | /api/zoom/webhook | Zoom signature | URL validation và native chat |
| POST | /api/zoom-import | Lecturer token | Import chat text cũ |
| WS | /ws | Role registration | Đồng bộ lecturer/student |

## 11. Kiểm thử code trước khi push

~~~powershell
npm.cmd test
npm.cmd run test:zoom-role
npm.cmd run test:zoom-panel
npm.cmd run test:zoom-app
npm.cmd run test:zoom-webhook
npm.cmd run test:realtime
~~~

Kết quả tối thiểu:

~~~text
hostGetsLecturerCockpit: ✅ ĐẠT
coHostGetsLecturerCockpit: ✅ ĐẠT
participantGetsStudentUi: ✅ ĐẠT
guestGetsStudentUi: ✅ ĐẠT
entryLoadsRoleRouter: ✅ ĐẠT
lecturerLoadsCp3Companion: ✅ ĐẠT
studentLoadsCp3Companion: ✅ ĐẠT
~~~

Webhook regression cần đạt:

~~~text
webhookAccepted: ✅ ĐẠT
lecturerReceivedNativeChat: ✅ ĐẠT
duplicateIgnored: ✅ ĐẠT
crcValidated: ✅ ĐẠT
invalidSignatureRejected: ✅ ĐẠT
~~~

## 12. Lỗi thường gặp

### ERR_NGROK_3200

Endpoint ngrok offline. Mở lại tunnel:

~~~powershell
ngrok http http://127.0.0.1:3000 --url https://<PUBLIC_DOMAIN>
~~~

### ERR_NGROK_3004

Ngrok online nhưng upstream không có response:

~~~powershell
curl.exe http://127.0.0.1:3000/api/health
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
~~~

Không có listener port 3000 thì khởi động lại server Node.

### 404 Not Found

Thường do tunnel nhầm port, Caddy/ứng dụng khác ở localhost, thiếu /api/health hoặc forward IPv6. Dùng 127.0.0.1:3000 thay localhost trong target ngrok.

### docker-credential-desktop not found

Docker CLI không gọi được credential helper. Đây không phải lỗi code app. Dùng direct Node + ngrok hoặc sửa PATH/Docker Desktop.

### Zoom không hiện app trong My apps

Kiểm tra:

1. Đã bấm Add app now trong Local Test chưa.
2. Có đăng nhập đúng Zoom account đã authorize chưa.
3. App có ở Development/Local Test không.
4. Có đang ở Meeting thật không.
5. Surface → Meetings và Zoom App SDK đã bật chưa.
6. Home URL có là /zoom-app, không phải /lecturer chưa.
7. Domain Allow List có đúng domain ngrok hiện tại chưa.

### OAuth code không hợp lệ

Tạo URL mới bằng Local Test → Generate. Không dùng lại URL callback có ?code=....

### Sai giao diện lecturer/student

Không mở trực tiếp /lecturer. Home URL phải là /zoom-app; getUserContext().role mới quyết định vai trò.

### Chat học viên không làm cockpit đổi

Kiểm tra:

1. Host đã mở app và sessionOpen là true chưa.
2. zoomWebhook.received có tăng không.
3. Endpoint có đúng /api/zoom/webhook không.
4. Secret Token có đúng app/subscription không.
5. Scope meeting:read:chat_message còn không.
6. Event meeting.chat_message_sent đã lưu chưa.
7. Đã re-authorize sau khi đổi scope/event chưa.
8. Webhook có dùng đúng public tunnel không.
9. Tin nhắn có gửi sau khi session mở và trong đúng Meeting ID không.
+
## 13. Checklist trước demo/push

### Code

- [ ] git status không có .env.production hoặc secret.
- [ ] npm.cmd test đạt.
- [ ] Role routing đạt.
- [ ] Panel route đạt.
- [ ] Webhook đạt.
- [ ] OAuth callback không log token.

### Zoom

- [ ] Home URL là /zoom-app.
- [ ] Domain Allow List đúng public domain.
- [ ] Meetings + Zoom App SDK đã bật.
- [ ] Bốn API SDK đã thêm.
- [ ] Scope zoomapp:inmeeting và meeting:read:chat_message đã có.
- [ ] Event Subscription đang bật.
- [ ] Endpoint webhook đúng public URL.
- [ ] Event chat đã chọn.
- [ ] OAuth Redirect URL khớp tuyệt đối với env.
- [ ] Đã Generate Authorization URL mới và authorize.

### Runtime

- [ ] Local /api/health trả status: ok.
- [ ] Public /api/health trả status: ok.
- [ ] Ngrok forward 127.0.0.1:3000.
- [ ] Host tự vào /zoom-app/lecturer.
- [ ] Participant tự vào /zoom-app/student.
- [ ] acceptedMessages tăng sau native Zoom chat.

## 14. Giới hạn còn lại

- OAuth grant giữ trong memory; restart server sẽ mất grant.
- Webhook nhận chat một chiều; chưa gửi answer ngược vào Zoom Chat.
- OpenRouter key nằm ở browser localStorage; production thật cần server-side proxy.
- Ngrok free domain có thể đổi; khi đổi phải cập nhật Zoom URLs và redirect URI.
- Docker startup script phụ thuộc Docker Desktop credential helper; direct Node + ngrok ổn định hơn cho demo local hiện tại.
- Production thật cần HTTPS/WSS ổn định, rate limit theo IP, persistent token store mã hóa, quản lý user/tenant và rotation secret.

## 15. Quy tắc bàn giao

1. Clone repo và checkout testcuaQuang.
2. Đọc file này trước khi sửa Zoom config.
3. Không commit .env.production.
4. Không copy Client Secret, Webhook Secret hoặc OpenRouter key vào chat/issue.
5. Khi đổi public domain, cập nhật Home URL, Domain Allow List, OAuth Redirect URL, Event Notification Endpoint URL và ZOOM_OAUTH_REDIRECT_URI.
6. Sau khi đổi scope/event, Generate Authorization URL mới.
7. Trước khi kết luận webhook hỏng, kiểm tra /api/health và http://127.0.0.1:4040/api/tunnels.
8. Khi sửa route Zoom, chạy lại test_zoom_role_routing.js và test_zoom_panel_routes.js.




