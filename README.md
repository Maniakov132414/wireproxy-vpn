# Multi-Country Wireproxy + Dynamic Rotating Proxy Pool (Netflix & Asia Optimized)

Hệ thống biến các cấu hình WireGuard VPN từ **ProtonVPN Plus** thành cụm **Proxy xoay đa quốc gia (Rotating Proxy Pool)** và các cổng SOCKS5 / HTTP riêng lẻ, phục vụ bot cào dữ liệu, bypass Cloudflare/Netflix, và chạy 24/7 trên Cloud (Railway).

---

## 1. Cơ chế hoạt động & Điểm nổi bật

* **Cổng Master Proxy Đa Giao Thức (`10800`)**: Lắng nghe trên cổng `10800` với cơ chế **Smart Protocol Sniffer**. Tự động phân tích byte đầu tiên để hỗ trợ cả **HTTP/HTTPS CONNECT** và **SOCKS5** trên cùng một cổng duy nhất.
* **Xoay ngẫu nhiên 5 request / lần (Sticky 5 Requests)**: Mỗi node trực chiến giữ kết nối ổn định cho đúng **5 requests** liên tiếp rồi mới tự động chuyển sang node ngẫu nhiên tiếp theo. Giúp các luồng kiểm tra cookie / phiên đăng nhập hoàn tất trọn vẹn mà không bị nhảy IP giữa chừng khiến Netflix WAF nghi ngờ.
* **Tối ưu hóa cự ly gần cho Railway Southeast Asia (Singapore)**: Toàn bộ **22 máy chủ** được tuyển chọn 100% nằm trong khu vực Đông Nam Á & Đông Á có kết nối cáp quang trực tiếp tới Singapore: **Singapore (5 node, ping < 3ms)**, **Việt Nam (8 node, ping ~25ms)**, **Hồng Kông (2 node, ping ~30ms)**, **Đài Loan (1 node, ping ~45ms)**, **Nhật Bản (5 node, ping ~55ms)**, **Hàn Quốc (1 node, ping ~65ms)**. Loại bỏ 100% độ trễ xuyên lục địa.
* **Chống nghẽn khi spam đa luồng (Anti-Spam & Fast Failover 12s)**: Thời gian chờ bắt tay CONNECT được nâng lên 12 giây, đồng thời nếu node gặp sự cố sẽ lập tức thử lại ngay trên node khác trong pool, không trả lỗi 502/504 vội vàng cho bot.
* **Hàng đợi đệm sẵn (Pre-warmed Buffer, 7 server)**: Luôn duy trì sẵn 7 máy chủ trực chiến luân phiên. Khi bot chạy 25 luồng, tải được chia đều chỉ ~3-4 luồng / server, đảm bảo mượt mà và không lo nghẽn port.
* **Tự động ngủ khi không hoạt động (Auto-Sleep 90s)**: Sau 90 giây không có request từ bot, toàn bộ tiến trình Wireproxy sẽ tự động tắt để giải phóng 100% slot thiết bị của Proton. Khi có request mới đến, hệ thống sẽ tự động thức dậy trong 1-2 giây.
* **Không cần Mật khẩu (No Auth)**: Cổng proxy mở trực tiếp, bot kết nối vào dùng ngay mà không cần cấu hình User/Pass rườm rà.

---

## 2. Bảng phân bổ Node & Cổng nội bộ

Hệ thống gồm **22 máy chủ tối ưu hóa độ trễ cho Railway Singapore**:

| STT | Node | Quốc gia & Vị trí | Cổng HTTP | Cổng SOCKS5 | Ping tới Railway (SG) | Trạng thái |
| :-: | :--- | :--- | :-: | :-: | :-: | :-: |
| 1 | `SG120` | 🇸🇬 Singapore (SG#120) | `25417` | `25416` | ~2ms | Verified Live |
| 2 | `SG124` | 🇸🇬 Singapore (SG#124) | `25419` | `25418` | ~2ms | Verified Live |
| 3 | `SG171` | 🇸🇬 Singapore (SG#171) | `25421` | `25420` | ~2ms | Verified Live |
| 4 | `SG175` | 🇸🇬 Singapore (SG#175) | `25423` | `25422` | ~2ms | Verified Live |
| 5 | `SG192` | 🇸🇬 Singapore (SG#192) | `25425` | `25424` | ~2ms | Verified Live |
| 6 | `VN1` | 🇻🇳 Hà Nội (VN#1) | `25401` | `25400` | ~25ms | Verified Live |
| 7 | `VN2` | 🇻🇳 Hà Nội (VN#2) | `25403` | `25402` | ~25ms | Verified Live |
| 8 | `VN3` | 🇻🇳 Hà Nội (VN#3) | `25405` | `25404` | ~25ms | Verified Live |
| 9 | `VN4` | 🇻🇳 Hà Nội (VN#4) | `25407` | `25406` | ~25ms | Verified Live |
| 10 | `VN5` | 🇻🇳 Hà Nội (VN#5) | `25409` | `25408` | ~25ms | Verified Live |
| 11 | `VN6` | 🇻🇳 Hà Nội (VN#6) | `25411` | `25410` | ~25ms | Verified Live |
| 12 | `VN7` | 🇻🇳 Hà Nội (VN#7) | `25413` | `25412` | ~25ms | Verified Live |
| 13 | `VN8` | 🇻🇳 Hà Nội (VN#8) | `25415` | `25414` | ~25ms | Verified Live |
| 14 | `HK29` | 🇭🇰 Hồng Kông (HK#29) | `25437` | `25436` | ~30ms | Verified Live |
| 15 | `HK35` | 🇭🇰 Hồng Kông (HK#35) | `25439` | `25438` | ~30ms | Verified Live |
| 16 | `TW13` | 🇹🇼 Đài Bắc (TW#13) | `25441` | `25440` | ~45ms | Verified Live |
| 17 | `JP188` | 🇯🇵 Tokyo (JP#188) | `25427` | `25426` | ~55ms | Verified Live |
| 18 | `JP201` | 🇯🇵 Osaka (JP#201) | `25429` | `25428` | ~55ms | Verified Live |
| 19 | `JP202` | 🇯🇵 Osaka (JP#202) | `25431` | `25430` | ~55ms | Verified Live |
| 20 | `JP203` | 🇯🇵 Osaka (JP#203) | `25433` | `25432` | ~55ms | Verified Live |
| 21 | `JP206` | 🇯🇵 Osaka (JP#206) | `25435` | `25434` | ~55ms | Verified Live |
| 22 | `KR20` | 🇰🇷 Seoul (KR#20) | `25443` | `25442` | ~65ms | Verified Live |

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
| `POOL_SIZE` | `6` | Số lượng server luôn được giữ ấm (khuyên dùng 6 để an toàn dưới trần 10 slot của Proton) |
| `MAX_REQUESTS_PER_NODE` | `60` | Số lượt request tối đa trước khi xoay node |
| `IDLE_TIMEOUT_MS` | `90000` | Thời gian không có request (90s) để đưa hệ thống vào chế độ ngủ tiết kiệm slot |

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


