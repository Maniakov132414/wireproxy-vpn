# Multi-Country Wireproxy + Dynamic Rotating Proxy Pool (Netflix & Asia Optimized)

Hệ thống biến các cấu hình WireGuard VPN từ **ProtonVPN Plus** thành cụm **Proxy xoay đa quốc gia (Rotating Proxy Pool)** và các cổng SOCKS5 / HTTP riêng lẻ, phục vụ bot cào dữ liệu, bypass Cloudflare/Netflix, và chạy 24/7 trên Cloud (Railway).

---

## 1. Cơ chế hoạt động & Điểm nổi bật

* **Cổng Master Proxy Đa Giao Thức (`10800`)**: Lắng nghe trên cổng `10800` với cơ chế **Smart Protocol Sniffer**. Tự động phân tích byte đầu tiên để hỗ trợ cả **HTTP/HTTPS CONNECT** và **SOCKS5** trên cùng một cổng duy nhất.
* **Xoay ngẫu nhiên 3 request / lần (Sticky 3 Requests)**: Mỗi node trực chiến giữ kết nối ổn định cho đúng **3 requests** liên tiếp rồi mới tự động chuyển sang node kế tiếp (ưu tiên node ít tải nhất). Giúp các luồng kiểm tra cookie / phiên đăng nhập hoàn tất trọn vẹn mà không bị nhảy IP giữa chừng khiến Netflix WAF nghi ngờ.
* **Tối ưu hóa cự ly gần cho Railway Southeast Asia (Singapore)**: Lõi **73 máy chủ** trực chiến tuyển chọn từ khu vực Đông Nam Á & Đông Á có kết nối cáp quang trực tiếp tới Singapore: **Singapore (12 node, ping < 3ms)**, **Việt Nam (12 node, ping ~25ms)**, **Nhật Bản (24 node, ping ~55ms)**, **Malaysia (6 node, ping ~4ms)**, **Hồng Kông (3 node, ping ~30ms)**, Philippines, Thái Lan, Indonesia, Campuchia, Ấn Độ... 18 node EU/US/Oceania còn lại là nhánh dự phòng, luôn đứng cuối hàng đợi xoay.
* **Chống nghẽn khi spam đa luồng (Anti-Spam & Fast Failover 12s)**: Thời gian chờ bắt tay CONNECT được nâng lên 12 giây, đồng thời nếu node gặp sự cố sẽ lập tức thử lại ngay trên node khác trong pool, không trả lỗi 502/504 vội vàng cho bot.
* **Hàng đợi đệm sẵn (Pre-warmed Buffer, 8 server)**: Luôn duy trì sẵn 8 máy chủ trực chiến luân phiên (an toàn dưới trần 10 slot thiết bị của Proton). Khi bot chạy 25 luồng, tải được chia đều chỉ ~3-4 luồng / server, đảm bảo mượt mà và không lo nghẽn port.
* **Tự động ngủ khi không hoạt động (Auto-Sleep 5 phút + Wake Burst 3 node)**: Sau 5 phút không có request từ bot, toàn bộ tiến trình Wireproxy sẽ tự động tắt để giải phóng 100% slot thiết bị của Proton. Khi có request mới đến, hệ thống khởi động **song song 3 node** cùng lúc (thay vì lần lượt) nên tunnel sống lại chỉ trong 2-4 giây - request đầu tiên không còn bị read timeout.
* **Không cần Mật khẩu (No Auth)**: Cổng proxy mở trực tiếp, bot kết nối vào dùng ngay mà không cần cấu hình User/Pass rườm rà.

---

## 2. Bảng phân bổ Node & Cổng nội bộ

Hệ thống gồm **91 máy chủ** trải rộng trên 3 nhóm khu vực: **lõi Đông Nam Á / Đông Á gần Railway Singapore** (Singapore, Việt Nam, Nhật Bản, Hồng Kông, Đài Loan, Hàn Quốc... ưu tiên xoay trước nhờ độ trễ thấp) và **nhánh mở rộng EU / US / Oceanic** (Đức, Pháp, Hà Lan, Anh, Mỹ, Úc... tự động đứng cuối hàng ưu tiên, chỉ được gọi khi cần thêm IP mới):

| STT | Node | Quốc gia & Vị trí | Cổng HTTP | Cổng SOCKS5 | Ping tới Railway (SG) | Trạng thái |
| :-: | :--- | :--- | :-: | :-: | :-: | :-: |
| 1 | `SG120` | 🇸🇬 Singapore (SG#120) | `25417` | `25416` | ~2ms | Verified Live |
| 2 | `SG124` | 🇸🇬 Singapore (SG#124) | `25419` | `25418` | ~2ms | Verified Live |
| 3 | `SG171` | 🇸🇬 Singapore (SG#171) | `25421` | `25420` | ~2ms | Verified Live |
| 4 | `SG175` | 🇸🇬 Singapore (SG#175) | `25423` | `25422` | ~2ms | Verified Live |
| 5 | `SG192` | 🇸🇬 Singapore (SG#192) | `25425` | `25424` | ~2ms | Verified Live |
| 6 | `SG179` | 🇸🇬 Singapore (SG#179) | `25455` | `25454` | ~2ms | Verified Live |
| 7 | `SG196` | 🇸🇬 Singapore (SG#196) | `25457` | `25456` | ~2ms | Verified Live |
| 8 | `SG220` | 🇸🇬 Singapore (SG#220) | `25459` | `25458` | ~2ms | Verified Live |
| 9 | `SG224` | 🇸🇬 Singapore (SG#224) | `25461` | `25460` | ~2ms | Verified Live |
| 10 | `SG228` | 🇸🇬 Singapore (SG#228) | `25463` | `25462` | ~2ms | Verified Live |
| 11 | `SG271` | 🇸🇬 Singapore (SG#271) | `25465` | `25464` | ~2ms | Verified Live |
| 12 | `SG275` | 🇸🇬 Singapore (SG#275) | `25467` | `25466` | ~2ms | Verified Live |
| 13 | `VN1` | 🇻🇳 Hà Nội (VN#1) | `25401` | `25400` | ~25ms | Verified Live |
| 14 | `VN2` | 🇻🇳 Hà Nội (VN#2) | `25403` | `25402` | ~25ms | Verified Live |
| 15 | `VN3` | 🇻🇳 Hà Nội (VN#3) | `25405` | `25404` | ~25ms | Verified Live |
| 16 | `VN4` | 🇻🇳 Hà Nội (VN#4) | `25407` | `25406` | ~25ms | Verified Live |
| 17 | `VN5` | 🇻🇳 Hà Nội (VN#5) | `25409` | `25408` | ~25ms | Verified Live |
| 18 | `VN6` | 🇻🇳 Hà Nội (VN#6) | `25411` | `25410` | ~25ms | Verified Live |
| 19 | `VN7` | 🇻🇳 Hà Nội (VN#7) | `25413` | `25412` | ~25ms | Verified Live |
| 20 | `VN8` | 🇻🇳 Hà Nội (VN#8) | `25415` | `25414` | ~25ms | Verified Live |
| 21 | `VN9` | 🇻🇳 Hà Nội (VN#9) | `25501` | `25500` | ~25ms | Verified Live |
| 22 | `VN10` | 🇻🇳 Hà Nội (VN#10) | `25503` | `25502` | ~25ms | Verified Live |
| 23 | `VN11` | 🇻🇳 Hà Nội (VN#11) | `25505` | `25504` | ~25ms | Verified Live |
| 24 | `VN12` | 🇻🇳 Hà Nội (VN#12) | `25507` | `25506` | ~25ms | Verified Live |
| 25 | `JP188` | 🇯🇵 Tokyo (JP#188) | `25427` | `25426` | ~55ms | Verified Live |
| 26 | `JP201` | 🇯🇵 Osaka (JP#201) | `25429` | `25428` | ~55ms | Verified Live |
| 27 | `JP202` | 🇯🇵 Osaka (JP#202) | `25431` | `25430` | ~55ms | Verified Live |
| 28 | `JP203` | 🇯🇵 Osaka (JP#203) | `25433` | `25432` | ~55ms | Verified Live |
| 29 | `JP206` | 🇯🇵 Osaka (JP#206) | `25435` | `25434` | ~55ms | Verified Live |
| 30 | `JP207` | 🇯🇵 Tokyo (JP#207) | `25509` | `25508` | ~55ms | Verified Live |
| 31 | `JP211` | 🇯🇵 Tokyo (JP#211) | `25511` | `25510` | ~55ms | Verified Live |
| 32 | `JP212` | 🇯🇵 Tokyo (JP#212) | `25513` | `25512` | ~55ms | Verified Live |
| 33 | `JP213` | 🇯🇵 Tokyo (JP#213) | `25515` | `25514` | ~55ms | Verified Live |
| 34 | `JP215` | 🇯🇵 Tokyo (JP#215) | `25517` | `25516` | ~55ms | Verified Live |
| 35 | `JP216` | 🇯🇵 Tokyo (JP#216) | `25519` | `25518` | ~55ms | Verified Live |
| 36 | `JP217` | 🇯🇵 Tokyo (JP#217) | `25521` | `25520` | ~55ms | Verified Live |
| 37 | `JP219` | 🇯🇵 Tokyo (JP#219) | `25523` | `25522` | ~55ms | Verified Live |
| 38 | `JP232` | 🇯🇵 Tokyo (JP#232) | `25525` | `25524` | ~55ms | Verified Live |
| 39 | `JP236` | 🇯🇵 Tokyo (JP#236) | `25527` | `25526` | ~55ms | Verified Live |
| 40 | `JP263` | 🇯🇵 Tokyo (JP#263) | `25529` | `25528` | ~55ms | Verified Live |
| 41 | `JP284` | 🇯🇵 Tokyo (JP#284) | `25531` | `25530` | ~55ms | Verified Live |
| 42 | `JP288` | 🇯🇵 Tokyo (JP#288) | `25533` | `25532` | ~55ms | Verified Live |
| 43 | `JP332` | 🇯🇵 Tokyo (JP#332) | `25535` | `25534` | ~55ms | Verified Live |
| 44 | `JP336` | 🇯🇵 Tokyo (JP#336) | `25537` | `25536` | ~55ms | Verified Live |
| 45 | `JP363` | 🇯🇵 Tokyo (JP#363) | `25539` | `25538` | ~55ms | Verified Live |
| 46 | `JP388` | 🇯🇵 Tokyo (JP#388) | `25541` | `25540` | ~55ms | Verified Live |
| 47 | `JP432` | 🇯🇵 Tokyo (JP#432) | `25543` | `25542` | ~55ms | Verified Live |
| 48 | `JP436` | 🇯🇵 Tokyo (JP#436) | `25545` | `25544` | ~55ms | Verified Live |
| 49 | `MY11` | 🇲🇾 Kuala Lumpur (MY#11) | `25469` | `25468` | ~4ms | Verified Live |
| 50 | `MY15` | 🇲🇾 Kuala Lumpur (MY#15) | `25471` | `25470` | ~4ms | Verified Live |
| 51 | `MY19` | 🇲🇾 Kuala Lumpur (MY#19) | `25473` | `25472` | ~4ms | Verified Live |
| 52 | `MY21` | 🇲🇾 Kuala Lumpur (MY#21) | `25475` | `25474` | ~4ms | Verified Live |
| 53 | `MY25` | 🇲🇾 Kuala Lumpur (MY#25) | `25477` | `25476` | ~4ms | Verified Live |
| 54 | `MY33` | 🇲🇾 Kuala Lumpur (MY#33) | `25499` | `25498` | ~4ms | Verified Live |
| 55 | `ID14` | 🇮🇩 Jakarta (ID#14) | `25453` | `25452` | ~15ms | Verified Live |
| 56 | `KH1` | 🇰🇭 Phnom Penh (KH#1) | `25451` | `25450` | ~20ms | Verified Live |
| 57 | `TH3` | 🇹🇭 Bangkok (TH#3) | `25479` | `25478` | ~25ms | Verified Live |
| 58 | `TH7` | 🇹🇭 Bangkok (TH#7) | `25481` | `25480` | ~25ms | Verified Live |
| 59 | `TH12` | 🇹🇭 Bangkok (TH#12) | `25483` | `25482` | ~25ms | Verified Live |
| 60 | `TH16` | 🇹🇭 Bangkok (TH#16) | `25485` | `25484` | ~25ms | Verified Live |
| 61 | `HK29` | 🇭🇰 Hồng Kông (HK#29) | `25437` | `25436` | ~30ms | Verified Live |
| 62 | `HK35` | 🇭🇰 Hồng Kông (HK#35) | `25439` | `25438` | ~30ms | Verified Live |
| 63 | `HK39` | 🇭🇰 Hồng Kông (HK#39) | `25497` | `25496` | ~30ms | Verified Live |
| 64 | `PH1` | 🇵🇭 Manila (PH#1) | `25487` | `25486` | ~35ms | Verified Live |
| 65 | `PH2` | 🇵🇭 Manila (PH#2) | `25489` | `25488` | ~35ms | Verified Live |
| 66 | `PH3` | 🇵🇭 Manila (PH#3) | `25491` | `25490` | ~35ms | Verified Live |
| 67 | `PH4` | 🇵🇭 Manila (PH#4) | `25493` | `25492` | ~35ms | Verified Live |
| 68 | `BD2` | 🇧🇩 Dhaka (BD#2) | `25447` | `25446` | ~35ms | Verified Live |
| 69 | `BT1` | 🇧🇹 Thimphu (BT#1) | `25449` | `25448` | ~40ms | Verified Live |
| 70 | `IN14` | 🇮🇳 Mumbai (IN#14) | `25445` | `25444` | ~45ms | Verified Live |
| 71 | `TW13` | 🇹🇼 Đài Bắc (TW#13) | `25441` | `25440` | ~45ms | Verified Live |
| 72 | `KR20` | 🇰🇷 Seoul (KR#20) | `25443` | `25442` | ~65ms | Verified Live |
| 73 | `KR28` | 🇰🇷 Seoul (KR#28) | `25495` | `25494` | ~65ms | Verified Live |
| 74 | `TW21` | 🇹🇼 Đài Bắc (TW#21) | `25375` | `25374` | ~50ms | Backup |
| 75 | `AU-109` | 🇦🇺 Sydney (AU#109) | `25345` | `25344` | ~90ms | Backup |
| 76 | `NZ-20` | 🇳🇿 Auckland (NZ#20) | `25371` | `25370` | ~120ms | Backup |
| 77 | `DE-187` | 🇩🇪 Frankfurt (DE#187) | `25355` | `25354` | ~180ms | Backup |
| 78 | `FR-167` | 🇫🇷 Paris (FR#167) | `25363` | `25362` | ~180ms | Backup |
| 79 | `NL-343` | 🇳🇱 Amsterdam (NL#343) | `25367` | `25366` | ~180ms | Backup |
| 80 | `BE-43` | 🇧🇪 Brussels (BE#43) | `25347` | `25346` | ~185ms | Backup |
| 81 | `UK-186` | 🇬🇧 London (UK#186) | `25377` | `25376` | ~190ms | Backup |
| 82 | `CH-289` | 🇨🇭 Zurich (CH#289) | `25353` | `25352` | ~185ms | Backup |
| 83 | `IT-19` | 🇮🇹 Milan (IT#19) | `25365` | `25364` | ~185ms | Backup |
| 84 | `ES-71` | 🇪🇸 Madrid (ES#71) | `25359` | `25358` | ~190ms | Dead - tự loại |
| 85 | `SE-76` | 🇸🇪 Stockholm (SE#76) | `25373` | `25372` | ~200ms | Backup |
| 86 | `NO-21` | 🇳🇴 Oslo (NO#21) | `25369` | `25368` | ~200ms | Backup |
| 87 | `DK-52` | 🇩🇰 Copenhagen (DK#52) | `25357` | `25356` | ~195ms | Backup |
| 88 | `FI-1` | 🇫🇮 Helsinki (FI#1) | `25361` | `25360` | ~210ms | Dead - tự loại |
| 89 | `CA-93` | 🇨🇦 Montreal (CA#93) | `25351` | `25350` | ~250ms | Backup |
| 90 | `US-AZ-84` | 🇺🇸 Phoenix, Arizona (US#84) | `25379` | `25378` | ~230ms | Backup |
| 91 | `BR-20` | 🇧🇷 São Paulo (BR#20) | `25349` | `25348` | ~320ms | Backup |

*Ghi chú: 18 node từ hàng 74-91 là **nhánh dự phòng mở rộng** - chỉ được khởi động khi cần thêm IP mới, đứng sau toàn bộ node Á Động trong hàng đợi xoay. Hai node `ES-71` và `FI-1` đã chết ở phía Proton, rotator tự phát hiện qua handshake probe và bỏ qua vĩnh viễn.*

---

## 3. Triển khai trên Railway

### Bước 1: Deploy lên Railway
Dự án đã liên kết trực tiếp với GitHub repo `wireproxy-vpn` và deploy tự động lên dịch vụ Railway.

### Bước 2: Cấu hình TCP Proxy
1. Trong Railway Settings của service `wireproxy-vpn`, vào phần **Networking**.
2. Thêm **TCP Proxy** trỏ tới cổng nội bộ `10800`.
3. Địa chỉ truy cập public sẽ có định dạng:
   ```text
   altaria.proxy.rlwy.net:13082
   ```

### Bước 3: Biến môi trường
Các biến môi trường có thể tùy chỉnh trong tab **Variables**:

| Tên biến | Mặc định | Ý nghĩa |
| :--- | :---: | :--- |
| `POOL_SIZE` | `8` | Số lượng server luôn được giữ ấm (khuyên dùng 8 để an toàn dưới trần 10 slot của Proton) |
| `STICKY_REQUESTS` | `3` | Số request dính vào một node trước khi xoay sang node kế tiếp |
| `MAX_REQUESTS_PER_NODE` | `200` | Số lượt phục vụ trước khi node nghỉ (drain: chờ request đang chạy xong mới tắt) |
| `IDLE_TIMEOUT_MS` | `300000` | Thời gian không có request (5 phút) để đưa hệ thống vào chế độ ngủ tiết kiệm slot |
| `WAKE_BURST` | `3` | Số node khởi động **song song** khi toàn bộ pool đang ngủ (giúp request đầu tiên sau khi thức dậy không bị timeout) |

**Cơ chế chịu tải cao (thread storm)**: Không có giới hạn request cứng nào - mọi request đều được nhận ngay lập tức. Sau mỗi 3 request hệ thống xoay sang node kế tiếp, chọn theo trọng số **ít tải nhất trước** để 100 luồng tự trải đều thay vì dồn vào một node. Khi node bị nghỉ việc (lỗi 5 lần liên tiếp hoặc hết hạn 200 lượt), node đó **vẫn mở port cho tới khi các request đang chạy hoàn tất** (graceful drain) rồi mới tắt.

---

## 4. Cách sử dụng Proxy cho Bot / Checker

### Cấu hình trong `proxy.txt`:
Do cổng Master hỗ trợ cả HTTP và SOCKS5, bạn có thể điền:
```text
http://altaria.proxy.rlwy.net:13082
```
hoặc:
```text
socks5://altaria.proxy.rlwy.net:13082
```

### Kiểm tra bằng cURL:
```bash
# Kiểm tra HTTP
curl -x http://altaria.proxy.rlwy.net:13082 http://api.ipify.org

# Kiểm tra kết nối tới Netflix
curl -I -x http://altaria.proxy.rlwy.net:13082 https://www.netflix.com
```

### Khuyến nghị số luồng (Threads):
* Với Netflix Cookie Checker, khuyến nghị chạy từ **15 đến 25 threads** để đảm bảo tốc độ phản hồi ổn định (khoảng 2.0s - 2.5s / cookie) mà không bị Netflix WAF chặn tạm thời (HTTP 403/429).

---

## 5. Quản lý cục bộ trên Windows (Tùy chọn)

* **Khởi chạy toàn bộ hệ thống trên máy cá nhân**:
  ```powershell
  .\start-pool.ps1
  ```
* **Dừng toàn bộ các tiến trình**:
  ```powershell
  .\stop-pool.ps1
  ```


