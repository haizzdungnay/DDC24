# System Architecture

**ID:** ARCH-SYS-001
**Trạng thái:** Active
**Cập nhật:** 2026-07-22

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

Base SKU Rev A cung cấp 16 UI + 4 AO + 4 DO; true isolated DI là capability tùy chọn, không thuộc baseline.

## Trách nhiệm

- Core sở hữu graph execution, PLC-state SHM, scan scheduling, arbitration, interlock và safe-state.
- Iobus sở hữu IO SHM, Kinexus-IOP session, scaling điện, Modbus và BACnet adapter.
- Web sở hữu HTTP/WebSocket, auth, persistent config, commissioning và local HMI auth/audit broker. Broker local không biến HMI thành Web UI và không yêu cầu browser/network.
- HMI đọc trạng thái local từ SHM và chỉ phát setpoint/mode/override/release/ACK/service request qua interface được phê duyệt; không ghi command trực tiếp vào SHM hoặc phần cứng.
- MCU lấy mẫu/actuate I/O, trả frame IOP và thực thi watchdog/safe behavior độc lập.

## Luồng dữ liệu

Input: terminal → protection/mux/ADC → MCU → IOP `IO_RESP` → iobus conversion/reliability → IO SHM → core graph → web/protocol/HMI. Output: graph/protocol request hoặc HMI request đã qua local broker → core priority/interlock/safety → IO SHM command → iobus validation → IOP command → MCU/DAC/relay.

## Local HMI command boundary

- Surface local được giới hạn ở `Home/Points/Control/Alarms/Service`; Web UI không nằm trong phạm vi thiết kế HMI local.
- `mkddc-web` broker xác thực session/role, lấy authoritative point policy, validate request và ghi audit. `mkddc-core` quyết định priority winner, interlock, safe-state và effective output.
- `mkddc-hmi` chỉ giữ opaque short-lived session và request ID; không giữ password/PIN production trong file cấu hình.
- Alarm ACK được broker/alarm authority xử lý bền vững; local alarm ring chỉ là cache trình bày.
- Không đổi SHM ABI cho command path: SHM tiếp tục là state snapshot; command/result/query dùng Unix-domain IPC versioned.

Config được Web ghi sau validation; consumer reload theo ranh giới được thiết kế. Thay đổi AO electrical mode cần restart phối hợp để không tạo mismatch giữa engineering value và mode MCU.

## Failure boundaries

- Mất Web/HMI không dừng control local.
- Mất local broker/core command endpoint làm Control/ACK/Service disable và HMI read-only; không queue mutation để phát lại mù khi service trở lại.
- Mất core heartbeat hoặc command hợp lệ đưa output về policy an toàn.
- Mất IOP quá fault threshold tạo reliability fault; MCU timeout 200 ms thực thi safe behavior.
- SHM magic/layout mismatch phải fail fast thay vì đọc offset cũ.

Deployment unit, package và tên executable phải được kiểm tra từ build/packaging hiện hành trước release; HMI chưa được coi là package mặc định chỉ vì source tồn tại.
