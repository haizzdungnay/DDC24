# Bằng chứng HOST — `SCALE`/`DEADBAND`/`HYSTERESIS` (`T59-804`, phần 4)

| Thuộc tính | Giá trị |
|---|---|
| Ngày | 2026-08-26 |
| Nhánh | `feat/t59-804-scale-deadband-hysteresis` |
| Phạm vi | `T59-804` / `PGM02-V22-WP-03` — đóng nốt danh sách block của plan |
| Authority | `DDD-CTRL-PROG-001` §7A.6/§7A.7 (pin TRƯỚC khi code) |
| Lớp bằng chứng | **HOST/LOCAL** |

## 1. Cách hiện thực và vì sao

| Block | Cách hiện thực | Lý do |
|---|---|---|
| `SCALE` | **Khai triển** thành `SUB/SUB/MUL/SUB/DIV/ADD` | Một lệnh IR mang tối đa BA toán hạng nguồn, `SCALE` cần năm. Nới định dạng artifact để nhét vừa một phép tuyến tính là đổi thứ đắt nhất lấy thứ rẻ nhất |
| `DEADBAND` | **Khai triển** thành `SUB/ABS/GT/SEL` | Cùng lý do; đồng thời giữ nó là hàm THUẦN |
| `HYSTERESIS` | FB thật, wire `StFbType = 9` | Trong dải `LOW..HIGH` phải GIỮ trạng thái chu kỳ trước — đó là trạng thái, nên nó là FB |

`dispatch` trong registry mang giá trị mới `EXPANSION` để nói đúng điều đang xảy
ra, thay vì khai `FUNC_TABLE` rồi để người đọc IR đi tìm một opcode không tồn
tại.

## 2. Ba quyết định ngữ nghĩa

1. **`SCALE` không tự kẹp dải ra.** Kẹp ngầm biến cảm biến ngoài dải thành giá
   trị biên trông hợp lệ — đúng thứ che mất lỗi hiện trường. Cần kẹp thì gọi
   `LIMIT`.
2. **`DEADBAND` trả `REF` khi trong dải**, không trả giá trị cũ. Trả giá trị cũ
   là hành vi có trạng thái, và nó sẽ biến một hàm thuần thành FB.
3. **`HYSTERESIS` fault khi `HIGH <= LOW`** (`ST-RT-006`): dải trễ đảo ngược
   không có nghĩa vật lý, và đoán ý người khai sẽ tạo ra bộ điều khiển bật/tắt
   liên tục ở đúng ngưỡng.

## 3. Một quyết định đổi giữa chừng — và bằng chứng khiến nó đổi

Bản đầu đưa cả `SCALE`, `DEADBAND`, `HYSTERESIS` vào danh sách **từ khoá** như
`TON`/`PID`. Hai bộ test của chính dự án đỏ ngay: một FUNCTION_BLOCK người dùng
tên `Hysteresis` và một FUNCTION người dùng tên `Scale`.

Đó là dữ liệu, không phải phiền toái. `TON`/`TOF`/`TP`/`CTU`/`CTD`/`R_TRIG`/
`F_TRIG`/`PID` là định danh CHUẨN IEC — người dùng IEC 61131-3 vốn đã coi chúng
là từ dành riêng. `SCALE`/`DEADBAND` là phần mở rộng của chúng ta và là từ tiếng
Anh thông dụng; giữ chúng làm từ khoá là lấy mất một cái tên mà người dùng có
quyền dùng cho POU của họ. Hơn nữa **tiền lệ trong chính compiler**: các hàm
thuần `ABS`/`MIN`/`MAX`/`LIMIT`/`SEL`/`SQRT` chưa bao giờ là từ khoá.

Kết luận đã áp: `HYSTERESIS` giữ từ khoá (mọi FB type đều vậy — bất biến "tên
type dựng sẵn không bao giờ là định danh người dùng" đáng giá hơn một cái tên);
`SCALE`/`DEADBAND` KHÔNG là từ khoá, đúng nhóm hàm thuần. Fixture FB đổi tên
`Hysteresis` → `BandGuard`, không làm yếu phép kiểm nào.

## 4. Cổng đã đo

| Cổng | Kết quả |
|---|---|
| CTest | **1297/1297 PASS** |
| Conformance | **37 pair + 9 stateTrace**; phủ 46/46 entry registry |
| `go vet` + `go test ./... -count=1` | PASS |
| FE vitest | **143 file / 1568 test PASS** |
| FE lint + build | PASS; chunk Programming **104,12 KiB gzip** |
| E2E mock | **31 PASS / 5 skip / 0 fail** |
| E2E real-backend | **1/1 PASS**; parity catalog BE↔registry khớp ở 46 entry |
| 4 script hợp đồng + `verify-project.sh --component layout` | PASS |

## 5. Còn thiếu

- Chưa đo trên bo cho sáu block mới của `T59-804`.
- `PID` vẫn `REVIEW_REQUIRED`; `PI` vẫn là entry ma bị verify chặn.
- `WP-03` còn hai phần: dock dùng chung ST+FBD, và typed metadata public trong
  OpenAPI.
- `VS-PROG-U13` chưa chạy; `RELEASE_READY` NO-GO.
