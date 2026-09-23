# Multi-Country Wireproxy + Dynamic Rotating Proxy Pool

Hệ thống biến các cấu hình WireGuard VPN từ **ProtonVPN Plus** thành cụm **Proxy xoay đa quốc gia (Rotating Proxy Pool)** và các cổng SOCKS5 / HTTP riêng lẻ, phục vụ bot cào dữ liệu, bypass Cloudflare/Netflix, và chạy 24/7 trên Cloud (Railway).

---

## 1. Cơ chế hoạt động & Điểm nổi bật

* **Cổng Master Proxy (`10800`)**: Lắng nghe mọi request HTTP/HTTPS và phân phối đến các cụm máy chủ sạch của ProtonVPN.
* **Xong là Tắt & Bật mới ngay lập tức (Ephemeral One-Shot Rotation)**: Mỗi khi 1 máy chủ VPN xử lý xong 1 request/kết nối của bot, tiến trình đó sẽ **tự động tắt ngay lập tức**, đồng thời hệ thống tự động kích hoạt máy chủ tiếp theo từ hàng đợi. Đảm bảo IP luôn luôn thay đổi liên tục cho từng tác vụ.
* **Hàng đợi đệm sẵn (Pre-warmed Buffer, mặc định 5 server)**: Luôn duy trì sẵn 4–5 máy chủ trực chiến cùng lúc. Khi máy chủ cũ vừa tắt đi thì máy chủ mới đã được bật sẵn sàng từ trước, **hoàn toàn không có độ trễ kết nối**.
* **Không cần Mật khẩu (No Auth)**: Cổng proxy mở trực tiếp, bot kết nối vào dùng ngay mà không cần cấu hình User/Pass rườm rà.
* **An toàn tuyệt đối dưới trần 10 kết nối**: Vì chỉ giữ tối đa 4–5 server cùng lúc, hệ thống không bao giờ bị đụng giới hạn 10 kết nối đồng thời của ProtonVPN Plus, đường truyền luôn đạt 100% tốc độ cao nhất.
* **Không yêu cầu quyền Root**: Chạy Wireproxy ở tầng người dùng (Userspace WireGuard), không cần cài driver card mạng ảo TUN/TAP, tương thích hoàn hảo trong Docker container trên Railway.

---

## 2. Bảng phân bổ Node & Địa chỉ IP

Hệ thống hiện tại gồm **42 cụm máy chủ** trên **28 quốc gia** (Đặc biệt có **11 máy chủ Việt Nam** và **5 máy chủ Singapore**):

| STT | Node | Quốc gia & Vị trí | Cổng HTTP | Cổng SOCKS5 | Nhà mạng / ASN | Trạng thái |
| :-: | :--- | :--- | :-: | :-: | :--- | :-: |
| 1 | `VN` | 🇻🇳 Hà Nội (VN#8) | `25345` | `25344` | M247 Europe SRL | Hoạt động |
| 2 | `VN1` | 🇻🇳 Hà Nội (VN#1) *(Mới)* | `25413` | `25412` | M247 Europe SRL | Hoạt động |
| 3 | `VN2` | 🇻🇳 Hà Nội (VN#2) | `25367` | `25366` | M247 Europe SRL | Hoạt động |
| 4 | `VN3` | 🇻🇳 Hà Nội (VN#3) *(Mới)* | `25415` | `25414` | M247 Europe SRL | Hoạt động |
| 5 | `VN4` | 🇻🇳 Hà Nội (VN#4) | `25361` | `25360` | M247 Europe SRL | Hoạt động |
| 6 | `VN6` | 🇻🇳 Hà Nội (VN#6) *(Mới)* | `25417` | `25416` | M247 Europe SRL | Hoạt động |
| 7 | `VN7` | 🇻🇳 Hà Nội (VN#7) *(Mới)* | `25419` | `25418` | M247 Europe SRL | Hoạt động |
| 8 | `VN9` | 🇻🇳 Hà Nội (VN#9) | `25365` | `25364` | M247 Europe SRL | Hoạt động |
| 9 | `VN10` | 🇻🇳 Hà Nội (VN#10) *(Mới)* | `25421` | `25420` | M247 Europe SRL | Hoạt động |
| 10 | `VN11` | 🇻🇳 Hà Nội (VN#11) *(Mới)* | `25423` | `25422` | M247 Europe SRL | Hoạt động |
| 11 | `VN12` | 🇻🇳 Hà Nội (VN#12) *(Mới)* | `25425` | `25424` | M247 Europe SRL | Hoạt động |
| 12 | `SG` | 🇸🇬 Singapore (SG#196) | `25347` | `25346` | Proton AG | Hoạt động |
| 13 | `SG120` | 🇸🇬 Singapore (SG#120) *(Mới)* | `25427` | `25426` | Proton AG | Hoạt động |
| 14 | `SG171` | 🇸🇬 Singapore (SG#171) | `25371` | `25370` | Proton AG | Hoạt động |
| 15 | `SG175` | 🇸🇬 Singapore (SG#175) | `25363` | `25362` | Proton AG | Hoạt động |
| 16 | `SG228` | 🇸🇬 Singapore (SG#228) | `25369` | `25368` | Proton AG | Hoạt động |
| 17 | `JP` | 🇯🇵 Tokyo (JP#188) | `25349` | `25348` | xTom GmbH | Hoạt động |
| 18 | `HK` | 🇭🇰 Hồng Kông (HK#35) | `25353` | `25352` | M247 Europe SRL | Hoạt động |
| 19 | `KR` | 🇰🇷 Seoul (KR#24) | `25355` | `25354` | M247 Europe SRL | Hoạt động |
| 20 | `TW` | 🇹🇼 Cao Hùng (TW#21) | `25357` | `25356` | M247 Europe SRL | Hoạt động |
| 21 | `TH` | 🇹🇭 Thái Lan (TH#3) | `25383` | `25382` | M247 Europe SRL | Hoạt động |
| 22 | `MY` | 🇲🇾 Malaysia (MY#11) | `25385` | `25384` | M247 Europe SRL | Hoạt động |
| 23 | `PH` | 🇵🇭 Philippines (PH#1) | `25405` | `25404` | Datacamp Limited | Hoạt động |
| 24 | `ID` | 🇮🇩 Indonesia (ID#14) | `25407` | `25406` | Datacamp Limited | Hoạt động |
| 25 | `IN` | 🇮🇳 Ấn Độ (IN#14) | `25387` | `25386` | Datacamp Limited | Hoạt động |
| 26 | `AU` | 🇦🇺 Úc (AU#109) | `25381` | `25380` | HostRoyale Tech | Hoạt động |
| 27 | `NZ` | 🇳🇿 New Zealand (NZ#20) | `25411` | `25410` | Datacamp Limited | Hoạt động |
| 28 | `US` | 🇺🇸 Hoa Kỳ (US-AZ#84) | `25351` | `25350` | M247 Europe SRL | Hoạt động |
| 29 | `CA` | 🇨🇦 Canada (CA#93) | `25379` | `25378` | M247 Europe SRL | Hoạt động |
| 30 | `BR` | 🇧🇷 Brazil (BR#20) | `25409` | `25408` | Datacamp Limited | Hoạt động |
| 31 | `UK` | 🇬🇧 London (UK#186) | `25359` | `25358` | Datacamp Limited | Hoạt động |
| 32 | `DE` | 🇩🇪 Đức (DE#187) | `25373` | `25372` | Datacamp Limited | Hoạt động |
| 33 | `NL` | 🇳🇱 Hà Lan (NL#343) | `25375` | `25374` | Datacamp Limited | Hoạt động |
| 34 | `FR` | 🇫🇷 Pháp (FR#167) | `25377` | `25376` | Datacamp Limited | Hoạt động |
| 35 | `CH` | 🇨🇭 Thụy Sĩ (CH#289) | `25389` | `25388` | Proton AG | Hoạt động |
| 36 | `SE` | 🇸🇪 Thụy Điển (SE#76) | `25391` | `25390` | Datacamp Limited | Hoạt động |
| 37 | `IT` | 🇮🇹 Ý (IT#19) | `25393` | `25392` | Datacamp Limited | Hoạt động |
| 38 | `ES` | 🇪🇸 Tây Ban Nha (ES#71) | `25395` | `25394` | Datacamp Limited | Hoạt động |
| 39 | `BE` | 🇧🇪 Bỉ (BE#43) | `25397` | `25396` | Datacamp Limited | Hoạt động |
| 40 | `DK` | 🇩🇰 Đan Mạch (DK#52) | `25399` | `25398` | Datacamp Limited | Hoạt động |
| 41 | `NO` | 🇳🇴 Na Uy (NO#21) | `25401` | `25400` | Datacamp Limited | Hoạt động |
| 42 | `FI` | 🇫🇮 Phần Lan (FI#1) | `25403` | `25402` | Datacamp Limited | Hoạt động |

---

## 3. Hướng dẫn cài đặt và cấu hình chi tiết trên Railway

### Bước 1: Tạo dự án từ GitHub
1. Đăng nhập vào [Railway](https://railway.com).
2. Nhấn nút **New Project** (hoặc góc trên bên phải bấm `+ New`).
3. Chọn **Deploy from GitHub repo**.
4. Chọn repository **`wireproxy-vpn`** (đặt ở chế độ Private).
5. Railway sẽ tự động tiến hành build Dockerfile (thời gian build chỉ mất khoảng 15–25 giây vì sử dụng binary biên dịch sẵn).

### Bước 2: Cấu hình TCP Proxy để lấy Public IP/Port
HTTP Proxy thông thường trên Railway chỉ xử lý web qua cổng 80/443, do đó để bot bên ngoài kết nối được cổng proxy `10800`, **bắt buộc phải tạo TCP Proxy**:

1. Bấm vào Service vừa deploy trên giao diện Railway.
2. Chuyển sang tab **Settings**.
3. Kéo xuống phần **Networking**:
   - Ở mục **Public Networking**, bấm vào nút **Add TCP Proxy**.
4. Trong ô cấu hình mở ra:
   - **Port**: Nhập chính xác số `10800` (đây là cổng của `rotator.js`).
   - Nhấn **Save** hoặc xác nhận.
5. Ngay sau đó, Railway sẽ cấp một địa chỉ Public dạng:
   ```text
   roundhouse.proxy.rlwy.net:54321
   ```
   *(Tên domain và port `54321` sẽ do Railway ngẫu nhiên cấp cho service của bạn).*

### Bước 3: Cấu hình biến môi trường (Tùy chọn)
Chuyển sang tab **Variables** trong Railway nếu bạn muốn tùy biến:

| Tên biến | Giá trị mặc định | Ý nghĩa |
| :--- | :--- | :--- |
| `POOL_SIZE` | `5` | Số lượng server luôn được bật sẵn chờ nhận request (khuyên dùng 4–5 để an toàn dưới trần 10 kết nối) |

---

## 4. Cách sử dụng Proxy cho Bot

Cổng proxy **không yêu cầu mật khẩu**. Bạn chỉ cần copy địa chỉ TCP Proxy từ Railway và điền thẳng vào bot:
```text
http://roundhouse.proxy.rlwy.net:54321
```

**Kiểm tra nhanh bằng cURL từ máy ngoài:**
```bash
curl -x http://roundhouse.proxy.rlwy.net:54321 https://ipinfo.io/json
```
*(Mỗi request gửi qua, bạn sẽ nhận được một địa chỉ IP thuộc quốc gia khác nhau. Sau khi request kết thúc, server đó tự tắt và một server mới được kích hoạt ngay lập tức).*

---

## 5. Thêm máy chủ WireGuard mới (Tự động 100%)

Khi bạn muốn bổ sung thêm quốc gia hoặc máy chủ mới:

1. Tải file WireGuard `.conf` từ ProtonVPN về máy tính.
2. Chạy lệnh PowerShell:
   ```powershell
   .\add-server.ps1 -FilePath "C:\duong-dan\wg-moi.conf" -Name "ten-quoc-gia" -Push
   ```
3. **Cơ chế tự động:**
   * Script tự cấp phát dải port SOCKS5 và HTTP tiếp theo.
   * Tạo file config vào thư mục `configs/`.
   * Tự động `git commit` và `git push` lên GitHub.
   * **Railway tự động nhận code mới -> Rebuild lại sau 20s mà địa chỉ TCP Proxy cấp cho bot VẪN GIỮ NGUYÊN.**

---

## 6. Kiểm tra toàn bộ danh sách IP (IP Tester)

Trong thư mục dự án có sẵn script kiểm tra đồng thời tất cả các node:
```bash
node test-all-ips.js
```
Script sẽ gửi request song song qua tất cả 14 cổng proxy, xuất bảng đo đạc gồm IP thực tế, quốc gia, độ trễ và nhà mạng.

---

## 7. Quản lý cục bộ trên Windows

* **Khởi chạy toàn bộ hệ thống trên máy cá nhân**:
  ```powershell
  .\start-pool.ps1
  ```
* **Dừng toàn bộ các tiến trình**:
  ```powershell
  .\stop-pool.ps1
  ```

