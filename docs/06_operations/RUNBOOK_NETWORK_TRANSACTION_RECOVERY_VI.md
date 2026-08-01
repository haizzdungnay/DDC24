# Runbook — Khôi phục giao dịch mạng bị kẹt hoặc thất bại

> **Document ID:** KX-DDC24-RUNBOOK-NETCFG-001-VI
> **Phiên bản:** 1.0 | **Ngày lập:** 2026-07-31
> **Đối tượng:** Kỹ thuật viên hiện trường và kỹ sư vận hành
> **Áp dụng cho:** `mkddc-netcfg` trên MK-DDC-24 (SOM)
> **Bối cảnh:** đóng finding G-06 — trước đây không có thủ tục nào cho tình huống
> trang `settings/network` hiển thị badge đỏ `FAILED`.

---

## 1. Nguyên tắc trước khi làm bất cứ điều gì

1. **Không sửa trực tiếp `network.conf`.** `network.conf.eth` chỉ là bản sao tương
   thích, không phải trạng thái thật (ADR-017 §3). Sửa nó không đổi được gì và làm
   chẩn đoán khó hơn.
2. **Không `nmcli` tay khi giao dịch còn treo.** Authority giữ last-known-good
   trong journal; can thiệp song song sẽ làm rollback tự động khôi phục sai.
3. **Xác định đường quản trị của chính bạn trước.** Nếu đang SSH/HTTP qua đúng
   interface sắp thao tác thì phải chuyển sang đường khác (interface phụ, WiFi,
   console) trước khi làm gì.

```bash
ip route get 1.1.1.1        # interface nào đang mang phiên của bạn
ip -br addr                 # địa chỉ hiện tại của mọi interface
```

## 2. Đọc trạng thái thật

```bash
systemctl is-active mkddc-netcfg
echo '{"version":1,"requestId":"ops-1","action":"status"}' \
  | sudo -u mkddc socat - UNIX-CONNECT:/run/mkddc-netcfg/netcfg.sock
```

Các trường cần đọc: `state`, `reasonCode`, `transactionId`, `active`, `configured`,
`pending`.

## 3. Xử lý theo trạng thái

| `state` | Ý nghĩa | Việc cần làm |
|---|---|---|
| `idle` | Không có giao dịch | Không cần làm gì |
| `staged` | Đã chuẩn bị, chưa áp dụng | Bấm **Hoàn tác** trên giao diện, hoặc gửi `rollback` kèm `transactionId` |
| `applying` / `awaiting_confirmation` | Đang trong cửa sổ 120 giây | Nếu mạng đã đúng: **Xác nhận**. Nếu không: **Hoàn tác**, hoặc chờ hết hạn để authority tự hoàn tác |
| `confirmed` | Đã xong | Không cần làm gì |
| `rolled_back` | Đã khôi phục | Kiểm tra `active` khớp mong đợi rồi tiếp tục |
| `failed` | Kết thúc bất thường | Theo §4 |

Lệnh hoàn tác thủ công khi giao diện không dùng được:

```bash
TX=<transactionId lấy từ status>
printf '{"version":1,"requestId":"ops-rb","action":"rollback","transactionId":"%s"}\n' "$TX" \
  | sudo -u mkddc socat - UNIX-CONNECT:/run/mkddc-netcfg/netcfg.sock
```

## 4. Khi `state = failed`

Giao diện hiển thị lý do ngay dưới badge. Nếu không đọc được, lấy từ journal:

```bash
sudo journalctl -u mkddc-netcfg --since '-30min' | grep netcfg.request
```

| `reasonCode` | Nguyên nhân | Xử lý |
|---|---|---|
| `PREVIOUS_STATE_NOT_RESTORABLE` | Authority không đọc lại được profile hiện hành để làm last-known-good | Xem §5 — thường do **profile NetworkManager trùng tên** |
| `DUPLICATE_ADDRESS` | Đã có thiết bị khác dùng địa chỉ này | Chọn địa chỉ khác, hoặc gỡ thiết bị trùng khỏi mạng |
| `PREFLIGHT_UNAVAILABLE` | Thiếu `arping` | Cài `iputils-arping` |
| `NO_CARRIER` | Chưa cắm cáp | Cắm cáp rồi thử lại |
| `KERNEL_STATE_UNAVAILABLE` | Không đọc được trạng thái interface | Kiểm tra interface còn tồn tại và NetworkManager đang chạy |
| `INVALID_TRANSITION` | Gửi hành động không hợp lệ với trạng thái hiện tại | Đọc lại `status` rồi gửi đúng hành động |
| `TRANSACTION_IN_PROGRESS` | Còn giao dịch chưa kết thúc | Hoàn tác/xác nhận giao dịch đó trước (§3) |

## 5. Profile NetworkManager trùng tên

Triệu chứng: `configured` là `null` và `active.mode` là `unknown` dù `ip addr` cho
thấy địa chỉ vẫn đúng; mọi lần Stage đều bị từ chối bằng
`PREVIOUS_STATE_NOT_RESTORABLE`.

```bash
nmcli -t -f UUID,NAME,DEVICE,TYPE connection show
```

Nếu thấy nhiều dòng cùng NAME cho cùng một interface, xoá profile thừa (giữ lại
profile đang active — cột DEVICE có tên interface):

```bash
sudo nmcli connection delete uuid <UUID-của-profile-KHÔNG-active>
sudo systemctl restart mkddc-netcfg
```

> Bản `mkddc-netcfg` từ 2026-07-31 tra cứu theo UUID nên không còn bị lỗi này. Thủ
> tục trên dùng cho thiết bị chạy bản cũ hoặc để dọn profile rác.

## 6. Phục hồi sau mất điện giữa giao dịch

Authority ghi journal bền vững tại `/data/mkddc/netcfg-transaction.json` và tự tiếp
tục hoàn tác khi khởi động lại. Việc cần làm chỉ là đọc `status` và xác nhận
`active` đã đúng.

Chỉ khi journal hỏng và authority không khởi động được:

```bash
sudo systemctl stop mkddc-netcfg
sudo cp /data/mkddc/netcfg-transaction.json /data/mkddc/netcfg-transaction.json.bad
sudo rm /data/mkddc/netcfg-transaction.json
sudo systemctl start mkddc-netcfg
```

> Xoá journal làm **mất last-known-good**. Chỉ làm khi đã xác nhận `ip addr` hiện
> tại là cấu hình mong muốn, và giữ lại bản `.bad` để phân tích sau.

## 7. Khi nào phải leo thang

- Mất đường quản trị và không có console tại chỗ.
- `mkddc-netcfg` khởi động lại lặp (`systemctl show mkddc-netcfg -p NRestarts`).
- Rollback báo thành công nhưng kernel không quay lại địa chỉ cũ.

Kèm theo khi leo thang: output `status`, `journalctl -u mkddc-netcfg` 30 phút gần
nhất, `nmcli connection show`, `ip -br addr`.

## 8. Lịch sử sửa đổi

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-07-31 | Bản đầu tiên, đóng finding G-06. |
