# ADR-017: Settings/Network — contract trạng thái mạng

> **Trạng thái:** Accepted | **Phiên bản:** 1.2 | **Ngày duyệt:** 2026-07-22 | **Cập nhật contract:** 2026-07-31 | **Owner:** Product Owner + SW Lead

> **Ghi chú sửa tiêu đề (2026-07-31, finding G-04):** tiêu đề cũ là
> "Settings/Network **tabs** và contract trạng thái mạng", nhưng từ "tabs" chỉ xuất
> hiện đúng một lần ở chính dòng tiêu đề — thân ADR không định nghĩa tab nào, và
> hiện thực cũng không có tab (trang là một luồng cuộn với các panel). Bỏ chữ
> "tabs" để tiêu đề khớp nội dung. Quyết định §2.9 vẫn giữ nguyên yêu cầu **hiển
> thị tách bạch** ACTIVE/KERNEL · CONFIGURED · PENDING · EDITABLE DRAFT — đó là
> yêu cầu về phân tách thông tin, không phải về widget tab.

## 1. Bối cảnh

Địa chỉ ghi trong `network.conf`, profile đã lưu trong NetworkManager và trạng thái kernel
đang hoạt động là ba nguồn khác nhau. Nếu Web hoặc HMI coi file cấu hình là trạng thái thật,
thiết bị có thể báo đổi IP thành công dù interface chưa có carrier, chưa nhận DHCP lease hoặc
đã tự rollback. Thay đổi IP cũng có thể làm mất phiên quản trị giữa chừng nếu không giữ
last-known-good và một origin quản trị ổn định.

Network mutation cần đặc quyền hệ điều hành nhưng Core, IOP/UART và local HMI không được chạy
shell hoặc sở hữu trực tiếp quyền thay đổi network. BACnet/IP phải rebind datalink sau đổi địa
chỉ mà không restart toàn bộ `mkddc-iobus`.

## 2. Quyết định

1. `mkddc-netcfg` là authority duy nhất cho Ethernet IPv4 và DNS của profile
   NetworkManager. Helper chạy độc lập dưới systemd, dùng IPC local JSON v1 qua
   `/run/mkddc-netcfg/netcfg.sock`; Web và HMI không sửa trực tiếp trạng thái Linux.

   **Ranh giới interface (bắt buộc, bổ sung 2026-07-31):** authority chỉ quản lý
   **đúng một** interface Ethernet, khai báo bằng `NETCFG_INTERFACE` trong
   `/etc/mkddc/netcfg.conf` (mặc định `end1`) và thực thi bằng allowlist trong
   helper — request nhắm tới interface khác bị từ chối bằng `INTERFACE_NOT_ALLOWED`.

   Cụ thể **KHÔNG thuộc phạm vi và không được authority chạm tới**:
   - `wlan0` và mọi interface Wi-Fi. Wi-Fi là **đường quản trị dự phòng** để truy
     cập DDC khi Ethernet đang được cấu hình lại hoặc mất liên lạc; nếu authority
     đụng vào nó thì một lần đổi IP hỏng sẽ cắt luôn cả hai đường và bắt buộc phải
     cử người tới hiện trường. Bật/tắt Wi-Fi ở `network.conf.wifi` là cấu hình
     **dịch vụ**, không phải mutation mạng, và đi qua `PUT /api/v1/network`.
   - `lo`, bridge, VLAN, bond, tunnel và mọi interface ảo.
   - Route tĩnh, firewall, VLAN tagging.

   Hệ quả vận hành: mọi quy trình đổi địa chỉ Ethernet phải giả định người vận hành
   có thể đang truy cập qua Wi-Fi, và đường Wi-Fi đó phải còn nguyên trong suốt và
   sau giao dịch.

   **Mặc định nhà máy:** `network.conf.eth.mode = "dhcp"` (xem
   [CONFIG_SCHEMA §2](../02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md)). Thiết
   bị xuất xưởng nhận địa chỉ từ DHCP; chuyển sang IPv4 tĩnh là thao tác commissioning
   có chủ đích, thực hiện qua transaction ở §2.5.
2. Protocol v1 là strict, bounded và capability-discovered:
   - frame tối đa 8192 byte, line-delimited JSON, `version=1`, `requestId` tối đa 64 ký tự;
   - từ chối unknown field ở request, candidate và object `dns`, unknown action/version,
     payload sai theo action và transition không hợp lệ;
   - response luôn công bố exact capability `dns` và `management-hostname`; client không được
     suy diễn capability từ việc một field tình cờ xuất hiện;
   - `status` là read-only; `validate`, `stage`, `apply`, `confirm`, `rollback` là action
     transaction có request-id idempotency và reason code ổn định.
3. Response phân biệt rõ:
   - `active`: kernel-observed state, gồm interface, operational link, `adminUp`, `carrier`,
     health `reasonCode`, mode, IPv4/prefix, gateway và `dnsServers`;
   - `configured`: profile NetworkManager đã lưu, không khẳng định profile đang active;
   - `pending`: candidate của transaction hiện hành;
   - `management`: `{hostname, mdnsName, stable}` chỉ đọc.
4. Candidate gồm Ethernet `{interface, mode, ipv4?, netmask?, gateway?}` và optional
   `dns:{mode,servers}`. Thiếu `dns` nghĩa là bảo toàn DNS của profile hiện tại.
   `dns.mode=auto` chỉ hợp lệ với Ethernet DHCP và `servers=[]`. `dns.mode=manual` yêu cầu
   1..4 địa chỉ IPv4 canonical, duy nhất. DNS đi cùng đúng transaction IP, journal,
   confirm/rollback; không có đường ghi DNS ngoài transaction.
5. Transaction là `validate -> stage -> apply -> awaiting_confirmation -> confirm` hoặc
   rollback. Helper giữ last-known-good, tự rollback trong tối đa 120 giây nếu không confirm
   hoặc health check thất bại và phục hồi transaction sau restart theo journal bền vững.
6. Hostname quản trị không thuộc candidate và không được mutate qua authority/Web/HMI.
   `management.hostname`/`mdnsName` chỉ để hiển thị stable origin. Provisioning hoặc đổi
   hostname chỉ dùng `packaging/configure-web-hostname.sh` với preflight, backup và rollback.
   `network.conf.hostname` là field tương thích/cấu hình dịch vụ, không phải bằng chứng và
   không có quyền đổi hostname hệ điều hành.
7. Web API tách quyền theo operation:
   - `GET /api/v1/network/transaction` là status read (`viewer|operator|admin`);
   - `POST /api/v1/network/transaction/{action}` chỉ dành cho `admin`;
   - rejected authority response vẫn giữ HTTP 200 cùng reason/state; adapter/socket failure
     trả 502/503; mọi POST mutation được audit một lần và không log candidate, DNS, token.
8. Local HMI đặt luồng commissioning trong surface **Service**, nhưng Service không phải role.
   `network_status` là read-only cho session hợp lệ; mọi network mutation local-HMI yêu cầu
   role `admin`, đi qua broker/audit rồi mới tới helper. HMI bị chặn kết nối trực tiếp
   `netcfg.sock`.
9. Frontend phải hiển thị riêng ACTIVE/KERNEL, CONFIGURED PROFILE, PENDING CANDIDATE và
   EDITABLE DRAFT; không báo success từ desired file. Production dùng REST/WebSocket
   same-origin để có thể reconnect qua hostname quản trị ổn định sau đổi IP.
10. Đổi địa chỉ không restart `mkddc-core` hoặc dừng IOP/UART/STM32 scan. BACnet/IP rebind
    datalink và phát `I-Am`; Web, Modbus TCP và client khác phải tự phục hồi theo test target.

## 3. Hệ quả

- `network.conf.eth` chỉ là compatibility shadow read-only; active state luôn lấy từ authority.
- Client cũ không hiểu capability/DNS/management phải bỏ qua field response mới nhưng không
  được tự gửi field chưa hỗ trợ. Client muốn mutate DNS phải thấy capability `dns` trước.
- Stable management hostname trở thành dependency của quy trình IP handoff; mDNS/DNS không
  sẵn sàng là lỗi preflight, không phải lý do tắt rollback.
- Code-local Web adapter/FE migration không thay thế physical commissioning evidence.
- Overall Network gate vẫn RED cho tới khi hoàn thành physical Ethernet, DHCP/gateway,
  reboot/power-loss/disk fault, target mDNS/IP handoff, REST/WebSocket reconnect, BACnet packet
  capture, Modbus reconnect, physical control continuity, connected-panel HMI usability và
  security approval.

## 4. Phương án loại bỏ

- **Web/HMI gọi `nmcli` hoặc shell trực tiếp:** mở rộng đặc quyền và không có transaction
  authority duy nhất.
- **Ghi `network.conf` rồi restart service:** không chứng minh kernel state, dễ mất đường quản
  trị và phá continuity.
- **Đổi hostname trong cùng IP transaction:** làm thay đổi đồng thời cả địa chỉ lẫn stable
  origin, khiến recovery khó xác định.
- **DNS ghi riêng ngoài transaction:** rollback IP nhưng giữ DNS mới có thể làm profile
  last-known-good không còn nhất quán.

## 5. Nguồn triển khai

- [Interface contracts](../04_design/INTERFACES.md)
- [OpenAPI](../02_design/interfaces/openapi.yaml)
- [Config schema](../02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md)
- [SOM plan](../03_implementation/22_SOM_SRC_IMPLEMENTATION_PLAN.md)
- [Web plan](../03_implementation/09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md)
- [HMI plan](../03_implementation/08_MKDDC_HMI_IMPLEMENTATION_GUIDE.md)
- `shared/netcfg_protocol_v1.schema.json`

## 6. Verification bắt buộc

- Schema/fixture chéo C++/Go/TypeScript cho strict unknown-field, capability, DNS và management.
- Unit/fault test validate, stage/apply/confirm/rollback, journal/restart, UID/allowlist và audit.
- Web API/FE test cho authenticated-read vs Admin-only mutation, authoritative state, same-origin và reconnect.
- Target/HIL cho physical Ethernet DHCP/static/DNS, duplicate IP, reboot/power-loss, stable
  hostname handoff, BACnet `I-Am`, Modbus reconnect, continuous control và HMI panel.

Không đổi Network gate sang GREEN chỉ từ host test, mock E2E, interface dummy hoặc service
deployment không có physical commissioning link.
