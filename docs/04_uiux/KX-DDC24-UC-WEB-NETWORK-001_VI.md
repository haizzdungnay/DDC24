# Use case Web — Cài đặt → Mạng (`/settings/network`)

> **Document ID:** KX-DDC24-UC-WEB-NETWORK-001-VI
> **Phiên bản:** 1.0
> **Ngày lập:** 2026-07-31
> **Owner:** Product Owner + SW Lead
> **Phạm vi:** Trang Web `/settings/network` — panel ETHERNET (giao dịch an toàn),
> panel NORTHBOUND (BACnet/WiFi) và panel SOUTHBOUND (Modbus RTU).
> **Không bao gồm:** Panel mạng của HMI cục bộ (đã có `UC-HMI-016…019`), cấu hình
> WiFi credentials, VLAN, route tĩnh, firewall.
> **Contract nền:** [ADR-017](../adr/ADR-017-settings-network-tabs-and-state-contract.md) ·
> [`shared/netcfg_protocol_v1.schema.json`](../../shared/netcfg_protocol_v1.schema.json)
> **Đặc tả trình bày:** [KX-DDC24-UX-WEB-NETWORK-001](KX-DDC24-UX-WEB-NETWORK-001_VI.md)

---

## 1. Vì sao tài liệu này tồn tại

Rà soát 2026-07-31 phát hiện kho tài liệu chỉ có hai họ use case là `UC-HMI` (19
mục) và `UC-LOCAL` (14 mục) — **không có bất kỳ use case nào cho Web** (finding
G-01). Trang cấu hình rủi ro nhất của sản phẩm đang được xây dựng mà mọi bất biến
an toàn chỉ tồn tại trong mã nguồn và trong bộ unit test, không có tiêu chí nghiệm
thu hành vi để QA hay auditor kiểm chứng.

Tài liệu này lấp khoảng trống đó. Mỗi use case dưới đây đều có **kịch bản E2E chạy
thật trên phần cứng** tương ứng (xem §4), không phải mock.

## 2. Vai trò

| Vai trò | Quyền trên trang này |
|---|---|
| `viewer`, `operator` | **Chỉ đọc** toàn bộ trạng thái authority (ADR-017 §2.7). Mọi nút mutation bị vô hiệu hoá ở giao diện và bị backend từ chối bằng 403. |
| `admin` | Đọc + thực hiện giao dịch mạng và lưu cấu hình BACnet/WiFi. |

> Ghi chú thiết kế: trước 2026-07-31 route bị bọc `RequireAdmin` nên viewer/operator
> không vào được trang, khiến quyền chỉ-đọc ở backend trở thành mã chết (F-06).

---

## 3. Danh mục use case

### UC-WEB-NET-001 — Xem trạng thái mạng authoritative

| Field | Nội dung |
|---|---|
| Actor | viewer / operator / admin |
| Tiền điều kiện | Session hợp lệ; `mkddc-netcfg` đang chạy |
| Main flow | Mở trang → hiển thị tách bạch ACTIVE/KERNEL, CONFIGURED PROFILE, PENDING CANDIDATE, MANAGEMENT HOST, TRANSACTION |
| Alternate | Authority không phản hồi → hiện lỗi và cho thử lại; **không** rơi về giá trị lấy từ file cấu hình |
| Acceptance | `active` đến từ kernel; `capabilities` đúng `["dns","management-hostname"]`; badge Ethernet phản ánh carrier thật; khi authority mất kết nối thì trạng thái là **UNKNOWN**, không phải `online` |

### UC-WEB-NET-002 — Đọc số liệu northbound/southbound thật

| Field | Nội dung |
|---|---|
| Actor | viewer / operator / admin |
| Main flow | Bốn thẻ KPI + bảng slave Modbus hiển thị số đo do `mkddc-iobus` publish |
| Alternate | Chưa có slave nào ⇒ bảng rỗng có thông báo; slave chưa được poll ⇒ trạng thái `unknown`, các ô số đo hiển thị `—` |
| Acceptance | **Không ô nào hiển thị `0` hay `online` khi chưa có số đo thật.** `bmsLink` lấy từ cờ bind BACnet thật, không suy ra từ `bip.enabled` + ip/port trong file. `Poll health` phải hạ xuống dưới 100% khi có slave offline. `Serial` rỗng hiển thị "chưa nạp" thay vì bịa mã |

### UC-WEB-NET-003 — Phân quyền chỉ-đọc

| Field | Nội dung |
|---|---|
| Actor | viewer / operator |
| Main flow | Mở trang → xem đủ trạng thái → mọi nút mutation ở trạng thái vô hiệu hoá |
| Alternate | Gọi thẳng API mutation → backend trả **403** |
| Acceptance | `GET /api/v1/network/transaction` = 200; `POST /api/v1/network/transaction/*` = 403; `PUT /api/v1/network` = 403 |

### UC-WEB-NET-004 — Kiểm tra candidate trước khi áp dụng

| Field | Nội dung |
|---|---|
| Actor | admin |
| Main flow | Nhập candidate → lỗi định dạng hiện **ngay tại ô nhập** kèm `aria-invalid`; nút Validate/Stage bị khoá khi form sai; candidate hợp lệ → Validate trả `accepted` |
| Alternate | Địa chỉ mạng/broadcast, gateway khác subnet, IPv4 sai định dạng, interface `lo`, DNS `auto` đi với `static` → bị từ chối |
| Acceptance | Ràng buộc phía client **phản chiếu đúng** luật của backend và của `mkddc-netcfg`, không lỏng hơn; authority vẫn là nơi quyết định cuối cùng |

### UC-WEB-NET-005 — Đổi địa chỉ Ethernet (luồng 2 nút)

> **Sửa đổi 2026-07-31 (rev 1.1).** Bản trước phơi thẳng 5 nút mang tên lệnh giao
> thức — `Validate / Stage / Apply / Confirm / Rollback` — ra mặt người vận hành.
> Đó là rò rỉ chi tiết hiện thực: người dùng phải tự học một máy trạng thái để đổi
> một địa chỉ IP. Nay gom còn **2 nút**, giữ nguyên vòng đời an toàn bên dưới.

| Field | Nội dung |
|---|---|
| Actor | admin |
| Tiền điều kiện | Đã mở giao diện qua hostname quản trị ổn định; Ethernet có carrier |
| Thanh nút | Đúng **hai** nút: **Kiểm tra** và **Lưu thay đổi** |
| Main flow | Sửa draft → **Lưu thay đổi** → hệ thống tự `stage` rồi `apply` → **hộp thoại xác nhận tự bật**, hiển thị địa chỉ cũ → mới và đồng hồ đếm ngược MM:SS → người dùng bấm **Giữ thay đổi** → `confirm` → xong |
| Alternate 1 | Bấm **Hoàn tác ngay** trong hộp thoại → `rollback` về last-known-good |
| Alternate 2 | Người dùng **mất kết nối** vì địa chỉ vừa đổi → không bấm được gì → authority **tự hoàn tác** khi hết 120 giây, thiết bị quay lại địa chỉ cũ |
| Alternate 3 | `stage` hoặc `apply` bị authority từ chối → hiện lý do, **không** mở hộp thoại xác nhận |
| Acceptance | Thanh nút KHÔNG chứa chữ `Stage`, `Apply`, `Confirm`, `Rollback`. Hộp thoại nêu rõ *"nếu mất kết nối, thiết bị tự quay lại cấu hình cũ sau MM:SS"*. `Lưu thay đổi` vẫn bị khoá khi chưa có carrier, chưa vào bằng hostname ổn định, hoặc form không hợp lệ. Thành công chỉ báo sau `confirmed` của authority |

**Vì sao không gom tiếp thành một nút "Lưu" duy nhất:** bước xác nhận là thứ duy nhất
phân biệt "đổi IP thành công" với "tự cắt đường vào thiết bị". Bỏ nó đi thì một địa
chỉ sai = một chuyến xe ra hiện trường. Cơ chế được **giấu đi**, không được **bỏ đi**.

### UC-WEB-NET-005b — Vòng đời chi tiết (tham chiếu contract)

| Field | Nội dung |
|---|---|
| Actor | admin |
| Tiền điều kiện | Đã mở giao diện qua hostname quản trị ổn định; Ethernet có carrier |
| Main flow | Stage → PENDING hiện candidate → Apply → trạng thái `awaiting_confirmation` + đếm ngược **MM:SS** + đối chiếu địa chỉ cũ→mới → Confirm trong hạn → `confirmed` |
| Alternate | Không confirm kịp 120 giây → authority **tự hoàn tác** về last-known-good |
| Acceptance | Apply bị khoá khi chưa có carrier hoặc chưa vào bằng hostname ổn định; kernel thật sự nhận địa chỉ mới; sau Confirm địa chỉ được giữ; thành công chỉ báo từ `confirmed` của authority |

### UC-WEB-NET-006 — Hoàn tác chủ động

| Field | Nội dung |
|---|---|
| Actor | admin |
| Main flow | Trong `staged`/`applying`/`awaiting_confirmation` → Rollback → `rolled_back` → kernel quay lại last-known-good |
| Alternate | Helper/host khởi động lại giữa giao dịch → phục hồi theo journal bền vững |
| Acceptance | Địa chỉ trước đó được khôi phục ở tầng kernel, không chỉ ở tầng file |

### UC-WEB-NET-007 — Cấu hình DNS

| Field | Nội dung |
|---|---|
| Actor | admin |
| Main flow | Chọn `Giữ nguyên profile` / `Tự động (DHCP)` / `Thủ công` → DNS đi **cùng đúng giao dịch IP**, cùng journal, cùng confirm/rollback |
| Alternate | `auto` chỉ hợp lệ với DHCP; `manual` yêu cầu 1..4 địa chỉ IPv4 canonical, không trùng |
| Acceptance | `pending.dns` echo đúng những gì đã gửi; **giữ nguyên IP mà chỉ đổi DNS phải thực hiện được** (không bị chặn nhầm bằng `DUPLICATE_ADDRESS`) |

### UC-WEB-NET-008 — Chuyển sang DHCP

| Field | Nội dung |
|---|---|
| Actor | admin |
| Main flow | Chọn DHCP → các ô địa chỉ bị vô hiệu hoá → Stage → Apply → chờ lease thật → Confirm |
| Alternate | Không có DHCP server hoặc không nhận được lease trước hạn → tự hoàn tác, **không báo thành công giả** |
| Acceptance | Candidate DHCP **không mang** `ipv4`/`netmask`/`gateway` (schema v1); địa chỉ hiển thị lấy từ authority/kernel chứ không phải từ candidate |

### UC-WEB-NET-009 — Lưu cấu hình BACnet/WiFi

| Field | Nội dung |
|---|---|
| Actor | admin |
| Main flow | Sửa Device ID / tên / cổng BACnet / WiFi → bấm Lưu → **hộp thoại nêu rõ hậu quả** (khởi động lại field bus, gián đoạn tạm thời BACnet/IP và Modbus) → xác nhận → áp dụng thật |
| Alternate | Huỷ ở hộp thoại → không ghi gì. Dịch vụ áp dụng không sẵn sàng → thông báo bằng ngôn ngữ người vận hành, nêu rõ cấu hình đã lưu và khi nào có hiệu lực |
| Acceptance | Cấu hình **thực sự có hiệu lực** (kiểm bằng cổng BACnet đang bind thật đổi theo), không chỉ được ghi xuống file; thông báo không chứa mã hạng mục nội bộ |

### UC-WEB-NET-010 — Nhật ký kiểm toán

| Field | Nội dung |
|---|---|
| Actor | admin (hệ quả), auditor (người đọc) |
| Main flow | Mỗi mutation sinh **đúng một** bản ghi audit kèm người dùng, hành động, mã giao dịch, kết quả |
| Alternate | Đọc trạng thái (`status`) **không** sinh bản ghi audit |
| Acceptance | Audit không chứa candidate, địa chỉ, DNS hay token |

---

## 4. Truy vết use case → kiểm chứng

| Use case | Unit test | E2E trên phần cứng thật |
|---|---|---|
| UC-WEB-NET-001 | `NetworkPage.test.tsx` (nhóm authority flow) | ✅ |
| UC-WEB-NET-002 | `networkapi_test.go`, `NetworkPage.test.tsx` (nhóm truthful telemetry) | ✅ |
| UC-WEB-NET-003 | `TestNetworkTransactionViewerCanReadButCannotMutate`, `ShellNavigation.test.tsx` | ✅ |
| UC-WEB-NET-004 | `TestValidateNetcfgCandidateMatchesCppAuthorityPolicy`, nhóm candidate validation | ✅ |
| UC-WEB-NET-005 | `NetcfgEngine.StaticStageApplyConfirmIsDurableAndIdempotent` | ✅ |
| UC-WEB-NET-006 | `NetcfgEngine.DeadlineAutomaticallyRollsBack` | ✅ |
| UC-WEB-NET-007 | `NetcfgLinuxPlatform.RestagingTheAddressTheInterfaceAlreadyHoldsIsNotADuplicate` | ✅ |
| UC-WEB-NET-008 | `NetcfgSerialization.DhcpCandidateOmitsAddressFieldsPerSchema`, `NetcfgEngine.DhcpWaitsForARealLeaseBeforeConfirmation` | ✅ |
| UC-WEB-NET-009 | `reloadhelper_test.go` | ✅ |
| UC-WEB-NET-010 | `TestNetworkTransactionAuditSkipsStatusAndRecordsDNSMutationOnce` | ✅ |

Bằng chứng chạy thật: [`docs/07_records/test-evidence/fw-som/2026-07-31-network-page-board-e2e.md`](../07_records/test-evidence/fw-som/2026-07-31-network-page-board-e2e.md)

## 5. Lịch sử sửa đổi

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-07-31 | Bản đầu tiên. Đóng finding G-01 (không có use case nào cho Web). 10 use case kèm ma trận truy vết tới unit test và E2E phần cứng. |
