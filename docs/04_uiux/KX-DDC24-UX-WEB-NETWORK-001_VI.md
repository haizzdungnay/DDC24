# UI/UX Spec — Web · Cài đặt → Mạng (`/settings/network`)

> **Document ID:** KX-DDC24-UX-WEB-NETWORK-001-VI
> **Trạng thái:** Active | **Phiên bản:** 1.0 | **Ngày lập:** 2026-07-31
> **Chủ quản:** Product Owner + SW Lead
> **Phạm vi:** Đặc tả trình bày và tương tác của trang Web `/settings/network`.
> **Không bao gồm:** Panel mạng HMI cục bộ (xem `KX-DDC24-UX-HMI-001_VI` §9), WiFi
> credential, VLAN, route tĩnh, firewall — đều ngoài phạm vi trang này.
> **Tài liệu liên quan:** [ADR-017](../adr/ADR-017-settings-network-tabs-and-state-contract.md) ·
> [UC-WEB-NETWORK-001](KX-DDC24-UC-WEB-NETWORK-001_VI.md) ·
> [UX-SYSTEM-001](KX-DDC24-UX-SYSTEM-001_VI.md) (token & component) ·
> [CONFIG_SCHEMA](../02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md) §2

---

## 1. Vì sao tài liệu này tồn tại

Rà soát 2026-07-31 ghi nhận: **không có wireframe hay UI spec nào cho Web** trong
toàn bộ `docs/` (finding G-02), trong khi phía HMI thì có. Hệ quả là bố cục, thứ tự
ưu tiên thông tin, cách trình bày đếm ngược và đối chiếu địa chỉ hoàn toàn do lập
trình viên tự quyết, không có cơ sở để review thiết kế.

Tài liệu này là **authority về trình bày** cho trang. Contract dữ liệu vẫn thuộc
ADR-017 và `shared/netcfg_protocol_v1.schema.json` (theo thứ tự thẩm quyền ở
`docs/00_governance/CONTROL.md`).

## 2. Nguyên tắc bắt buộc

| # | Nguyên tắc | Vì sao |
|---|---|---|
| P1 | **Không suy diễn.** Thiếu số đo thì hiển thị `—`; thiếu trạng thái thì `UNKNOWN`. Tuyệt đối không thay bằng `0`, `online` hay `offline`. | ADR-017 §2.9 "không báo success từ desired file". Vi phạm P1 chính là finding F-02/F-03/F-04. |
| P2 | **Tách bạch bốn tầng sự thật** ACTIVE/KERNEL · CONFIGURED PROFILE · PENDING CANDIDATE · EDITABLE DRAFT, mỗi tầng một khối riêng có nhãn. | ADR-017 §2.9 |
| P3 | **Thành công chỉ đến từ authority.** Không báo thành công từ nội dung form hay từ file cấu hình. | ADR-017 §2.9 |
| P4 | **Mọi kết thúc bất thường phải giải thích được** và gợi ý bước tiếp theo. | Kỹ thuật viên ở hiện trường không có log. |
| P5 | **Thao tác gây gián đoạn phải xác nhận trước**, nêu rõ hậu quả. | Lưu BACnet/WiFi khởi động lại field bus. |
| P6 | **Chặn sớm tại chỗ nhập**, không bắt người dùng gửi rồi mới biết sai. | Nielsen #5 |

## 3. Bố cục tổng thể

Trang là **một luồng cuộn dọc**, không dùng tab. Thứ tự từ trên xuống theo mức độ
khẩn cấp khi vận hành: trạng thái tức thời → thao tác rủi ro cao → cấu hình dịch vụ
→ bảng tham chiếu.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Mạng                                                  [ ETH CARRIER  ]   │  ← H1 + badge trạng thái ETH
│ Ethernet an toàn qua netcfg · BACnet/IP lên BMS · Modbus RTU xuống…      │
├──────────────────────────────────────────────────────────────────────────┤
│ ┌────────────┐ ┌──────────────┐ ┌────────────────┐ ┌──────────────────┐ │
│ │ Thiết bị   │ │ BACnet/IP UDP│ │ Slave Modbus   │ │ Sức khoẻ poll    │ │  ← 4 thẻ KPI
│ │ DDC24-LAB  │ │ 47808        │ │ 2/3 online     │ │ 67%              │ │
│ └────────────┘ └──────────────┘ └────────────────┘ └──────────────────┘ │
├──────────────────────────────────────────────────────────────────────────┤
│ ETHERNET — Giao dịch an toàn                                             │
│ Trạng thái active lấy từ kernel qua mkddc-netcfg; thay đổi phải          │
│ Stage → Apply → Confirm, nếu không sẽ tự rollback.                       │
│                                                                          │
│ ⚠ [banner] Mở giao diện bằng hostname ổn định trước khi Apply: …        │  ← chỉ hiện khi chưa đạt
│ ⚠ [banner] Liên kết Ethernet chưa sẵn sàng; hãy cắm cáp trước khi Apply.│
│                                                                          │
│ ┌────────────┐┌────────────┐┌────────────┐┌────────────┐┌─────────────┐ │
│ │ACTIVE /    ││CONFIGURED  ││PENDING     ││MANAGEMENT  ││GIAO DỊCH    │ │  ← 5 thẻ, P2
│ │KERNEL      ││PROFILE     ││CANDIDATE   ││HOST        ││             │ │
│ │Interface   ││Interface   ││State       ││Hostname    ││[ CHỜ XÁC   │ │
│ │Admin       ││Address     ││…           ││mDNS        ││  NHẬN ]     │ │
│ │Carrier     ││Gateway     ││            ││Stable      ││   01:42     │ │  ← MM:SS, không phải giây thô
│ │Kernel link ││DNS         ││            ││Current     ││─────────────│ │
│ │Address     ││Mode        ││            ││origin      ││Địa chỉ cũ   │ │  ← đối chiếu old→new
│ │Gateway     ││            ││            ││            ││Địa chỉ mới  │ │
│ │DNS · Mode  ││            ││            ││            ││[lý do lỗi]  │ │  ← P4
│ │Reason      ││            ││            ││            ││             │ │
│ └────────────┘└────────────┘└────────────┘└────────────┘└─────────────┘ │
│                                                                          │
│ EDITABLE DRAFT                                                           │
│ Candidate có thể chỉnh sửa; không phải bản sao realtime của ACTIVE.      │
│ ┌──────────┐┌──────────┐┌──────────┐┌──────────┐                        │
│ │Interface ││Chế độ    ││IPv4      ││Subnet    │                        │
│ │end1      ││[Static ▾]││192.168…  ││255.255…  │                        │
│ └──────────┘└──────────┘└──────────┘└──────────┘                        │
│ ┌──────────┐┌──────────┐┌──────────┐                                    │
│ │Gateway   ││Chế độ DNS││Máy chủ DNS│                                   │
│ │          ││[Giữ ▾]   ││          │                                    │
│ │⚠ lỗi ngay││          ││          │                                    │  ← P6, aria-invalid
│ └──────────┘└──────────┘└──────────┘                                    │
│                                                                          │
│ [Kiểm tra] [Chuẩn bị] [Áp dụng] [Xác nhận] [Hoàn tác]                   │
├──────────────────────────────────────────────────────────────────────────┤
│ NORTHBOUND — BACnet/IP lên BMS                    [ Lưu BACnet/WiFi ]   │
│ ┌─────────────────────────────┐ ┌──────────────────────────────────┐    │
│ │ Tên thiết bị │ BACnet ID    │ │ BMS Link          [ ONLINE ]     │    │
│ │ BACnet name  │ Cổng UDP     │ │ 192.168.1.50 → UDP/47808         │    │
│ └─────────────────────────────┘ │ WiFi                      [ON]   │    │
│                                 │ Tên TB │ Serial │ FW │ Vai trò   │    │
│                                 └──────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────────────────┤
│ SOUTHBOUND — RS-485 Modbus RTU Master                                    │
│ ┌────┬───────────────┬─────────┬────────────┬──────────┬─────────────┐  │
│ │Addr│ Slave / Hồ sơ │ Baud    │ Trạng thái │ Tỉ lệ lỗi│ Poll gần…   │  │
│ ├────┼───────────────┼─────────┼────────────┼──────────┼─────────────┤  │
│ │ 10 │ Meter-A       │ 19200   │ [ONLINE]   │ 1.0%     │ 12 ms       │  │
│ │ 20 │ VFD-B         │ 19200   │ [OFFLINE]  │ 25%      │ quá hạn     │  │
│ │ 30 │ IO-C          │ 19200   │ [UNKNOWN]  │ —        │ —           │  │  ← P1: chưa đo = "—"
│ └────┴───────────────┴─────────┴────────────┴──────────┴─────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

Khi chưa cấu hình slave nào: thay bảng bằng khối rỗng có hướng dẫn, **không** hiện
bảng trống không nhãn.

## 4. Đặc tả từng khối

### 4.1 Badge trạng thái ETH (header)

| Điều kiện | Nhãn | Tông |
|---|---|---|
| `active.carrier = true` | `ETH CARRIER` | good |
| `active.carrier = false` | `ETH NO CARRIER` | fault |
| Không đọc được authority | `ETH UNKNOWN` | neutral |

**Cấm:** rơi về giá trị suy ra từ file cấu hình khi authority mất kết nối (P1/P3).

### 4.2 Bốn thẻ KPI

| Thẻ | Nguồn | Quy tắc |
|---|---|---|
| Thiết bị | `device.conf` | Rỗng → `—` |
| BACnet/IP UDP | **cổng đang bind thật** | Chưa bind → hiện cổng cấu hình kèm `(chưa áp dụng)` và tông cảnh báo |
| Slave Modbus | đếm slave `online` / tổng | Cảnh báo khi có slave không online |
| Sức khoẻ poll | tỉ lệ slave `online` trên số slave **đã có số đo** | Chưa slave nào có số đo → `—`. **Không bao giờ** hiển thị 100% khi có slave offline |

### 4.3 Thẻ GIAO DỊCH

- Badge trạng thái song ngữ, không in raw enum.
- Đếm ngược định dạng **MM:SS** khi `applying`/`awaiting_confirmation`, in đậm, tông cảnh báo.
- Khi có `pending`: hiện hai dòng **Địa chỉ cũ** → **Địa chỉ mới** ngay trong thẻ,
  không bắt người dùng tự so hai thẻ cách xa nhau.
- Khi `rejected` **hoặc** `failed` **hoặc** `rolled_back`: hiện lý do + câu hướng
  dẫn bước tiếp theo (P4).
- `aria-live="polite"` cho vùng trạng thái + đếm ngược.

### 4.4 Thanh nút — CHỈ hai nút

> **Rev 1.1 (2026-07-31).** Bản trước phơi 5 nút mang đúng tên lệnh giao thức
> (`Validate/Stage/Apply/Confirm/Rollback`) ra mặt người vận hành, bắt họ phải học
> một máy trạng thái chỉ để đổi một địa chỉ IP. Đó là rò rỉ chi tiết hiện thực.

```
[ Kiểm tra ]   [ Lưu thay đổi ]
```

| Nút | Bật khi | Hành động thật |
|---|---|---|
| **Kiểm tra** | admin · không có giao dịch đang chạy · form hợp lệ | `validate` |
| **Lưu thay đổi** | admin · form hợp lệ · **có carrier** · **đang vào bằng hostname ổn định** | `stage` rồi `apply` liên tiếp |

`Confirm` và `Rollback` **không còn là nút thường trực**. Chúng chỉ tồn tại trong hộp
thoại ở §4.4b, xuất hiện đúng lúc cần rồi biến mất.

Với role không phải admin: hiển thị đầy đủ trạng thái, **cả hai nút vô hiệu hoá**.

### 4.4b Hộp thoại xác nhận (tự bật sau khi áp dụng)

Khi giao dịch vào `applying`/`awaiting_confirmation`, hộp thoại **tự mở** và không
đóng được bằng cách bấm ra ngoài:

```
┌──────────────────────────────────────────────┐
│  Đã áp dụng địa chỉ mới                      │
│                                              │
│  Cũ:   192.168.1.52                          │
│  Mới:  192.168.1.101                         │
│                                              │
│  Bạn vẫn xem được trang này?                 │
│  Nếu mất kết nối, thiết bị TỰ quay lại       │
│  cấu hình cũ sau   01:42                     │
│                                              │
│   [ Giữ thay đổi ]      [ Hoàn tác ngay ]    │
└──────────────────────────────────────────────┘
```

| Yêu cầu | Lý do |
|---|---|
| Nêu tường minh **địa chỉ cũ → địa chỉ mới** | Người dùng phải biết mình vừa đổi gì |
| Đếm ngược **MM:SS**, `aria-live="polite"` | Thời gian còn lại phải đọc được ngay |
| Câu *"nếu mất kết nối, thiết bị tự quay lại cấu hình cũ sau …"* | Đây là thông tin quan trọng nhất: nó nói cho người dùng biết **họ an toàn**, kể cả khi trang đứng hình |
| **Giữ thay đổi** → `confirm` · **Hoàn tác ngay** → `rollback` | |
| Không có nút đóng/`Esc` | Đóng nhầm sẽ để giao dịch treo tới lúc tự rollback mà người dùng không biết |
| Hết giờ mà không ai bấm | Authority tự rollback; hộp thoại chuyển sang thông báo đã hoàn tác |

**Trường hợp quan trọng nhất — người dùng mất kết nối vì chính địa chỉ vừa đổi:**
hộp thoại đứng hình, không gọi được `confirm`, và đó chính là kịch bản mà auto-rollback
120 giây được thiết kế để cứu. Giao diện **không** được cố gắng "thử lại" trong tình
huống này.

### 4.5 Kiểm tra đầu vào tại chỗ (P6)

Ràng buộc client **phản chiếu đúng** luật backend/authority, không lỏng hơn:

| Trường | Ràng buộc |
|---|---|
| IPv4 | 4 octet canonical 0–255; không phải loopback/multicast/broadcast; không phải địa chỉ mạng hoặc broadcast của subnet |
| Subnet mask | Dãy bit 1 liên tục, prefix 1..30 |
| Gateway | IPv4 hợp lệ, **cùng subnet**, khác địa chỉ thiết bị, không phải network/broadcast |
| DNS thủ công | 1..4 địa chỉ IPv4 canonical, không trùng |
| DNS `auto` | Chỉ đi cùng DHCP |

Lỗi hiển thị **ngay dưới ô**, ô nhận `aria-invalid="true"` và `aria-describedby` trỏ
tới thông báo. Thông báo lỗi **không** nằm trong `<label>` (sẽ làm hỏng accessible
name của ô).

### 4.6 Panel NORTHBOUND

- Nút Lưu mở **hộp thoại xác nhận** nêu rõ: khởi động lại dịch vụ field bus, gián
  đoạn tạm thời BACnet/IP và Modbus RTU, điều khiển tại chỗ vẫn chạy (P5).
- `Serial` rỗng → hiển thị "chưa nạp", **không** bịa mã và không hiện `N/A` cứng.
- `Firmware` lấy từ phiên bản đang chạy thật.
- Thông báo kết quả dùng ngôn ngữ người vận hành; **cấm** lọt mã hạng mục nội bộ
  ra giao diện.

### 4.7 Bảng SOUTHBOUND

Mỗi ô là số đo **riêng của slave đó**. Thiếu số đo → `—` kèm tooltip giải thích.
Hàng `unknown` **không** tô màu trạng thái (không gợi ý khoẻ hay hỏng).

## 5. Ngôn ngữ

Toàn bộ nhãn, tiêu đề panel, tuỳ chọn select, nhãn cột, badge trạng thái giao dịch
và thông báo đều đi qua cơ chế song ngữ. **Cấm chuỗi trộn cứng VI/EN** trong cùng
một nhãn.

Giữ nguyên tiếng Anh cho: tên interface (`end1`), thuật ngữ giao thức
(`BACnet/IP`, `Modbus RTU`, `DHCP`, `DNS`, `UDP`), và nhãn bốn tầng sự thật
(`ACTIVE / KERNEL`, `CONFIGURED PROFILE`, `PENDING CANDIDATE`, `EDITABLE DRAFT`) —
đây là thuật ngữ contract, dịch ra sẽ mất truy vết tới ADR-017.

## 6. Tiếp cận (WCAG 2.1 AA)

| Yêu cầu | Áp dụng |
|---|---|
| 4.1.2 Name/Role/Value | Toggle dùng `role="switch"` + `aria-checked`; hộp thoại dùng `role="dialog"` + `aria-modal` |
| 3.3.1 Error Identification | `aria-invalid` + lỗi văn bản liền kề |
| 3.3.3 Error Suggestion | Thông báo nêu cách sửa, không chỉ nêu sai |
| 4.1.3 Status Messages | `aria-live="polite"` cho trạng thái giao dịch và đếm ngược |

## 7. Lịch sử sửa đổi

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-07-31 | Bản đầu tiên. Đóng finding G-02 (không có wireframe/UI spec nào cho Web). |
