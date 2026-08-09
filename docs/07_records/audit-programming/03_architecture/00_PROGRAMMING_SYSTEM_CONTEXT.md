# Bối cảnh hệ thống và ranh giới kiến trúc Programming

| Thuộc tính | Giá trị |
|---|---|
| ID | `ARCH-PROG-001` |
| Phiên bản | 0.2 |
| Trạng thái | `IN REVIEW — DESIGN NOT APPROVED` |
| Nguồn | Product v2.2 §6–7; ADR-005/020/023; quyết định ADR-024 |

## Mục lục

1. Kết luận
2. AS-BUILT tại record 2026-08-08
3. Bối cảnh target ba process
4. Boundary và authority
5. Bất biến
6. Nội dung mở
7. Thuật ngữ
8. Lịch sử và phê duyệt

## 1. Kết luận

Programming phải nằm trong kiến trúc ba process; bộ tài liệu không tạo service
thứ tư. AS-BUILT hiện tại và target design phải tách rõ: graph runtime đang là
đường control production, trong khi Programming ST/FBD chưa được production wire.

## 2. AS-BUILT tại record 2026-08-08

| Thành phần | Trạng thái có evidence |
|---|---|
| Graph runtime | `mkddc-core` nạp `graph.json`; graph là đường local logic production hiện hành và có thể sở hữu `scan_ms`. |
| ST runtime component | Source/host test tồn tại nhưng production bootstrap để `st_sched = nullptr`; không có package Programming active. |
| FBD | Chưa có model/compiler→shared typed IR production. |
| Web/BE authority | Chưa có Project/Revision/Check/Commission/Restore production contract. |
| Evidence | 0/12 Product capability COMPLETE; `VR-PROG-001..013 = RED`. |

AS-BUILT trên là record trạng thái, không được dùng để tự chọn target design.

## 3. Bối cảnh target ba process

```text
Engineering client
       |
       v
mkddc-web  -- lifecycle/monitor authority contract --> mkddc-core
                                                        |
                                          Point/process-image contract
                                                        |
                                                        v
                                                   mkddc-iobus
                                                        |
                              Local I/O / Virtual Point / Modbus RTU
```

Compiler/Check có thể được allocation trong process hiện hữu nhưng phải chạy
ngoài RT path và có resource isolation. Allocation cuối, IPC/URL/schema chưa được khóa.

## 4. Boundary và authority

| Boundary | Authority bắt buộc | Ràng buộc |
|---|---|---|
| Client↔web | Session/RBAC, Draft/correlation | Browser cache không là Draft authority; không optimistic success |
| web↔core | Revision/lifecycle/runtime result | Check≠Deployment≠Activation; read-back authority |
| core↔iobus | Point identity/value/quality/timestamp, poll/config ACK | Core sở hữu Point Table; iobus sở hữu Modbus Master; activation không restart iobus |
| runtime↔persistence | Revision/artifact/RETAIN integrity/compatibility | Atomic/LKG/fail closed |
| runtime↔output | Program mức 5, resolver, SafetyManager | Không trộn graph/program; không uncontrolled output |
| runtime↔systemd/MCU | base-step watchdog và IOP poll continuity | Watchdog kick sau step; poll gap `<200 ms` |

## 5. Bất biến

1. Runtime không chạy source hoặc artifact ngoại nhập chưa build/verify target.
2. Revision/artifact identity nhất quán từ Draft tới Active.
3. Program Active chạy local, không phụ thuộc Web session.
4. Chỉ ba Point category Rev A; TCP/BACnet bị reject.
5. Cutover chỉ một owner mức 5; dual-run fail closed.
6. Online Monitor read-only mặc định và phân biệt Draft/Active/Unknown.
7. Plant safe-state chỉ do SafetyManager condition độc lập đã duyệt.

## 6. Nội dung mở

Allocation cụ thể, API/schema, type/capacity, FBD, Task/WCET, RETAIN, monitor,
cutover/migration và watchdog remain blocked bởi `OD-PROG-001..015`, đặc biệt
`CONF-PROG-015`/`OD-PROG-012, OD-PROG-013, OD-PROG-014`.

## 7. Thuật ngữ

Xem [DICT-PROG-001](../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

## 8. Lịch sử và phê duyệt

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-08-08 | Context audit ban đầu. |
| 0.2 | 2026-08-09 | Sửa AS-BUILT graph/st_sched và thêm boundary watchdog/IOP/cutover. |

Sign-off: Architecture `PENDING`; Product `PENDING`; Controls/Safety `PENDING`; Verification `PENDING`.
