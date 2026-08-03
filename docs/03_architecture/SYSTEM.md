# System Architecture

**ID:** ARCH-SYS-001
**Trạng thái:** Active
**Cập nhật:** 2026-08-03

## Ranh giới source As-Built

- `apps/core`, `apps/iobus`, `apps/netcfg`, `apps/hmi`, `apps/web-api` và
  `apps/web-ui` giữ ownership theo process; không app nào import source
  implementation của app khác.
- `contracts/iop`, `contracts/shm`, `contracts/config` và `contracts/openapi`
  là authority duy nhất cho contract trong phạm vi migration.
- `firmware/stm32` chỉ phụ thuộc IOP/config contract; không phụ thuộc SHM hoặc
  Linux app.
- `platform/cmake`, `platform/packaging` và `platform/systemd` chỉ build/deploy
  artifact, không trở thành runtime dependency của domain.
- Core và Iobus dùng target CMake theo `domain → application → adapters →
  bootstrap`; guard repository và negative test chặn dependency ngược.

## Topology

```text
Browser                    mkddc-hmi (feature-gated)
   │ REST/WS          read SHM │  │ local authenticated UDS
   ▼                           │  ▼
mkddc-web ◄──── auth/audit broker ┘
   │ validated command
   ▼
mkddc-core
       graph / priority / safety
                 │ shared memory
                 ▼
           mkddc-iobus
 BACnet/IP · Modbus · IOP UART
                 │ isolated UART
                 ▼
            STM32G0B1
     ADC · UI · AO DAC · relay DO
```

Ba service lõi là `mkddc-core`, `mkddc-iobus`, `mkddc-web`. `mkddc-hmi` là service presentation thứ tư chỉ được build khi `MKDDC_ENABLE_HMI=ON`.

`mkddc-netcfg` theo ADR-017 đã được implement như SOM platform authority hẹp và không phải core control process. Service sở hữu activation/rollback network của Linux qua bounded UDS; việc thiếu hoặc lỗi helper chỉ làm network mutation unavailable, không làm dừng core/iobus/MCU.

Base SKU Rev A cung cấp 16 UI + 4 AO + 4 DO; true isolated DI là capability tùy chọn, không thuộc baseline.

## Trách nhiệm

- Core sở hữu graph execution, PLC-state SHM, scan scheduling, arbitration, interlock và safe-state.
- Iobus sở hữu IO SHM, Kinexus-IOP session, scaling điện, Modbus và BACnet adapter.
- Web sở hữu HTTP/WebSocket, auth, persistent config, commissioning và local HMI auth/audit broker. Broker local không biến HMI thành Web UI và không yêu cầu browser/network.
- HMI đọc trạng thái local từ SHM và chỉ phát setpoint/mode/override/release/ACK/service request qua interface được phê duyệt; không ghi command trực tiếp vào SHM hoặc phần cứng.
- MCU lấy mẫu/actuate I/O, trả frame IOP và thực thi watchdog/safe behavior độc lập.
- Network authority đọc active kernel state, validate/stage candidate, apply/confirm/rollback Ethernet và giữ last-known-good. Web/broker sở hữu identity, role, audit và adapter; Web/HMI không được trực tiếp gọi shell, netlink hoặc sửa networkd files.

## Luồng dữ liệu

Input: terminal → protection/mux/ADC → MCU → IOP `IO_RESP` → iobus conversion/reliability → IO SHM → core graph → web/protocol/HMI. Output: graph/protocol request hoặc HMI request đã qua local broker → core priority/interlock/safety → IO SHM command → iobus validation → IOP command → MCU/DAC/relay.

## Local HMI command boundary

- Surface local được giới hạn ở `Home/Points/Control/Alarms/Service`; Web UI không nằm trong phạm vi thiết kế HMI local.
- `mkddc-web` broker xác thực session/role, lấy authoritative point policy, validate request và ghi audit. `mkddc-core` quyết định priority winner, interlock, safe-state và effective output.
- `mkddc-hmi` chỉ giữ opaque short-lived session và request ID; không giữ password/PIN production trong file cấu hình.
- Alarm ACK được broker/alarm authority xử lý bền vững; local alarm ring chỉ là cache trình bày.
- Không đổi SHM ABI cho command path: SHM tiếp tục là state snapshot; command/result/query dùng Unix-domain IPC versioned.

Config được Web ghi sau validation; consumer reload theo ranh giới được thiết kế. Thay đổi AO electrical mode cần restart phối hợp để không tạo mismatch giữa engineering value và mode MCU.

## Network commissioning boundary

```text
Web FE ──REST──┐
               ▼
Local HMI ─UDS─► mkddc-web broker ─versioned UDS─► mkddc-netcfg ─► Linux network
                    auth/audit                       transaction
                                                       │ address event
                                                       ▼
                                             iobus BACnet hot-rebind
```

- Rev A local panel chỉ cấu hình Ethernet IPv4 static/DHCP trong `Service`; Web có thể cung cấp form rộng hơn nhưng phải dùng cùng transaction authority.
- `active` lấy từ kernel, `desired/pending` lấy từ transaction/config; không được thay thế lẫn nhau.
- Static apply ưu tiên make-before-break: add IP mới, cho client/local panel confirm, rồi mới bỏ IP cũ. Transaction chưa confirm phải rollback tối đa 120 s và phục hồi được sau helper/host restart.
- Web đã listen wildcard nên phục vụ tại địa chỉ mới khi kernel activate. BACnet adapter phải hot-rebind và phát `I-Am`; không restart toàn bộ iobus vì process đó còn sở hữu IOP/UART.
- Core, IOP scan, SHM và STM32 không tham gia đổi IP. Mất northbound trong thời gian chuyển địa chỉ không được thay đổi effective output ngoài policy lỗi truyền thông đã phê duyệt.

## Failure boundaries

- Mất Web/HMI không dừng control local.
- Mất network authority hoặc apply thất bại giữ/khôi phục last-known-good; HMI/Web phải hiện failed/rolling-back thay vì success.
- Mất local broker/core command endpoint làm Control/ACK/Service disable và HMI read-only; không queue mutation để phát lại mù khi service trở lại.
- Mất core heartbeat hoặc command hợp lệ đưa output về policy an toàn.
- Mất IOP quá fault threshold tạo reliability fault; MCU timeout 200 ms thực thi safe behavior.
- SHM magic/layout mismatch phải fail fast thay vì đọc offset cũ.

Deployment unit, package và tên executable phải được kiểm tra từ build/packaging hiện hành trước release. `mkddc-netcfg` và HMI đã có install wiring; HMI vẫn feature-gated và chỉ được enable khi target có connector DRM 240×320/320×240 cùng touch/button phù hợp.
