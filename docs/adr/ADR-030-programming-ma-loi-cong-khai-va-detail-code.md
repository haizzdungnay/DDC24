# ADR-030: Mã lỗi công khai `PRG-ERR-*` và vòng đời của detail code hiện hữu

- Date: 2026-08-10
- Owner: System Architect (phê duyệt) · Backend Lead + Core Lead (đề xuất)
- Status: **Accepted** — Product Owner/CTO + System Architect phê duyệt theo `AUTH-PROG-2026-08-11-03`; Verification review chuyển hậu kiểm
- Đóng xung đột: `ARCH-CONF-PROG-005` tại [`ARCH-PROG-001`](../03_architecture/PROGRAMMING_ARCHITECTURE.md) §11
- Related: [`IFSPEC-PROG-001`](../02_design/interfaces/PROGRAMMING_INTERFACE_SPEC.md) §9, §14 ·
  [`RSK-PROG-014`](../07_records/PROGRAMMING_RISK_REGISTER.md)

## Vấn đề (1 câu)

Source đã có ba họ mã lỗi thật (`IR-E-*`, `ST-*`, `API-E-*`) còn thiết kế Target
đề xuất họ `PRG-ERR-*`; nếu không chốt quan hệ giữa hai lớp thì FE sẽ phụ thuộc
mã nội bộ và retry sai chỗ — đúng rủi ro `RSK-PROG-014`.

## Bối cảnh As-Built

Họ `IR-E-*` không phải đề xuất, nó đang chạy:

```text
apps/core/application/st/st_loader.hpp:28-42
  IR-E-001 kBadHeader      IR-E-006 kBadSignature    IR-E-011 kBadTable
  IR-E-002 kBadMagic       IR-E-007 kMissingSignature IR-E-012 kBadIoBinding
  IR-E-003 kBadSchema      IR-E-008 kBadSectionTable  IR-E-013 kBadProfile
  IR-E-004 kBadAbi         IR-E-009 kMissingSection   IR-E-014 kBadCode
  IR-E-005 kBadHash        IR-E-010 kResourceLimit    IR-E-015 kOutOfMemory
```

`ST-LEX/SYN/TYPE/LIM-*` do parser sinh; `API-E-*` là mã của control API hiện hữu.

## Quyết định

1. **Hai lớp, không phải hai hệ thống song song.**
   - `PRG-ERR-*` là **mã công khai duy nhất** mà FE và mọi client bên ngoài được
     phép rẽ nhánh theo. Authority là `IFSPEC-PROG-001` §9.
   - `IR-E-*`, `ST-*`, `API-E-*`, `RT-RETAIN-*` là **detail code**, đi kèm trong
     trường `detailCode` để phục vụ chẩn đoán và hỗ trợ kỹ thuật.
2. **Không đổi tên, không đổi nghĩa mã nội bộ.** `IR-E-013` vẫn là
   `kBadProfile` mãi mãi. Đổi số hiệu của một mã đang chạy làm hỏng mọi log và
   runbook cũ mà không đem lại giá trị nào.
3. **Ánh xạ là toàn phần (exhaustive) và kiểm được bằng test.** Mỗi detail code
   phải có đúng một `PRG-ERR-*`; thêm detail code mới mà thiếu ánh xạ là lỗi
   build, không phải cảnh báo. Bảng ánh xạ hiện hành ở `IFSPEC-PROG-001` §14.
4. **Detail code không rò ra ngoài dưới dạng ngữ nghĩa.** FE hiển thị được
   `detailCode` cho kỹ thuật viên, nhưng cấm dùng nó làm điều kiện rẽ nhánh; cấm
   parse `message`. Test `FE-T-002` phải fail nếu FE rẽ nhánh theo `detailCode`.
5. **Không deprecate `API-E-*` trong Rev A.** Control API hiện hữu vẫn phục vụ
   đường phát triển host; nó chỉ được gỡ khi đường Programming production thay thế
   hoàn toàn, và việc đó cần một ADR riêng.
6. **Mã mới phải sinh ra ở đúng lớp.** Lỗi phát hiện tại loader → `IR-E-*` mới +
   ánh xạ; lỗi thuộc hợp đồng REST → `PRG-ERR-*` mới. Không tạo mã `PRG-ERR-*`
   bên trong core, và không tạo `IR-E-*` bên trong BE.

## Phương án bị loại

| Phương án | Vì sao loại |
|---|---|
| Đổi toàn bộ `IR-E-*` thành `PRG-ERR-*` | Hỏng log/runbook đang dùng; core sẽ phải biết tới khái niệm HTTP |
| Cho FE đọc trực tiếp `IR-E-*` | FE gắn chặt vào chi tiết loader; mỗi lần core thêm mã là FE hồi quy |
| Ánh xạ “best effort”, thiếu thì trả generic | Che lỗi thật; một mã mới sẽ âm thầm biến thành `UNAVAILABLE` và bị retry sai |

## Hệ quả

- `PROG-103` (error catalog) sinh ra một file ánh xạ machine-readable, dùng chung
  cho BE Go và test FE — không phải bảng chỉ nằm trong Markdown.
- Test bắt buộc: liệt kê toàn bộ detail code trong source, khẳng định `0` mã thiếu
  ánh xạ; và một ca “mã lạ” phải ra `PRG-ERR-UNAVAILABLE-001` **kèm** log cảnh báo
  ánh xạ thiếu, không im lặng.

## Điều kiện sau quyết định trước khi đóng lát cắt triển khai

| Điều kiện | Bằng chứng |
|---|---|
| Bảng ánh xạ machine-readable tồn tại và exhaustive | test “0 mã thiếu ánh xạ” |
| FE không rẽ nhánh theo `detailCode` | `FE-T-002` |
| `403/409/422/503/504` ánh xạ đúng lớp | `IF-T-009` + `BE-T-008` |

## Chữ ký

| Vai trò | Trạng thái | Ngày |
|---|---|---|
| System Architect | **ACCEPT — Phạm Đình Chương; ủy quyền điện tử `AUTH-PROG-2026-08-10-01`, Codex ghi biên bản** | 2026-08-10 |
| Backend Lead + Core Lead | Đề xuất | 2026-08-10 |
| Verification Lead | **WAIVED FOR IMPLEMENTATION — review hậu kiểm** | 2026-08-11 |
