---
name: mekong-ddc-review
description: Review chuyên biệt cho DDC, IoT Gateway, SCADA/HMI. Dùng khi kiểm tra protocol, fake MCU, I/O mapping, BACnet, Modbus, runtime, historian, alarm, dashboard và docs.
allowed-tools: Read Grep Glob Bash(git *) Bash(find *) Bash(ls *) Bash(cat *) Bash(sed *) Bash(rg *)
---

# MEKONG DDC / IoT / HMI Review

Luôn trả lời bằng tiếng Việt.

## Nguyên tắc: review xong phải sửa, không chừa việc

Skill này chỉ có quyền đọc, nên bản thân nó không sửa được. Nhưng review **không
phải là điểm dừng**. Sau khi có kết quả review, nếu lỗi nằm trong phạm vi việc
user đã giao thì **thoát skill và sửa ngay trong cùng phiên**, rồi chạy lại test
và cập nhật CHANGELOG.

- Ghi finding vào docs là bước bổ sung, **không thay thế** việc sửa.
- Không kết thúc bằng một danh sách "nên làm tiếp" cho những thứ chính mình sửa
  được.
- Mục "Việc cần làm tiếp" bên dưới chỉ được chứa việc **thật sự ngoài phạm vi**
  hoặc **bị chặn**, và mỗi mục phải ghi rõ bị chặn bởi cái gì, cần gì để mở khoá.
  Nếu không có mục nào như vậy thì ghi "không có".

Bối cảnh:
- DDC/IoT phải ưu tiên ổn định công nghiệp.
- Phần cứng chưa xong thì không ép firmware MCU thật.
- Fake MCU/simulator được chấp nhận nếu parser/runtime/test khớp spec.
- Mọi thay đổi protocol phải có versioning/spec/ADR/changelog.
- HMI không được nhầm Active với Connected.
- Runtime phải có timeout, reconnect, safe-state, health và log đủ debug.

Checklist:
1. Protocol / I/O:
   - frame size
   - endian
   - CRC/checksum
   - version
   - channel mapping
   - fault flags
   - AI/AO/DI/DO mapping
   - fake MCU có khớp parser thật không

2. Runtime:
   - polling rate
   - timeout
   - retry
   - reconnect
   - safe-state
   - watchdog/health
   - non-blocking behavior
   - log đủ để debug hiện trường

3. BACnet / Modbus:
   - object mapping
   - reliability/state text
   - unit/scaling
   - offline behavior
   - exception/error handling

4. HMI / Dashboard:
   - online/offline
   - last seen
   - alarm severity
   - API/DB/worker status
   - historian/trend
   - command/audit

5. Docs Governance:
   - docs có khớp code không
   - ADR có tồn tại nếu đổi kiến trúc/protocol
   - changelog có ghi thay đổi behavior không

Output bắt buộc (tiêu đề và nội dung bằng tiếng Việt, chỉ giữ nguyên thuật ngữ kỹ thuật không có bản dịch tương đương):

## Kết luận
PASS / FAIL

## Lỗi nghiêm trọng (Critical DDC)
Lỗi ảnh hưởng protocol/runtime/safety.

## Lỗi Protocol
Lỗi mapping/frame/version/fault flags.

## Lỗi Runtime
Lỗi timeout/retry/safe-state/log.

## Lỗi HMI
Lỗi dashboard/alarm/historian/UX.

## Lỗi tài liệu
Sai lệch docs/spec/ADR.

## Test bắt buộc
Test bắt buộc phải bổ sung/chạy lại.

## Đã sửa trong phiên
Lỗi thuộc phạm vi được giao và đã sửa xong, kèm test đã chạy lại.

## Việc cần làm tiếp
Chỉ ghi việc thật sự ngoài phạm vi hoặc bị chặn; mỗi mục nêu rõ **bị chặn bởi cái
gì** và **cần gì để mở khoá**. Không có thì ghi "không có".
