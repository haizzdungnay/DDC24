# Foxlinx — deploy `mkddc-core` mang lý do Program hỏng (2026-08-30)

| Thuộc tính | Giá trị |
|---|---|
| Bo | `SOM-DDC-24-foxlinx` — `root@mekong-fac.ddns.net:2223` |
| Nền tảng | Linux OK1126B-buildroot 6.1.141 aarch64; `/` còn 7,4 GB |
| Phạm vi | `mkddc-core` — đưa `lastFaultCode`/`lastFaultLine`/`faultCount` ra tới API |
| Mức bằng chứng | **TARGET** cho §3–§4; HOST cho cross-build |

Lát này đóng nốt phần target của việc đã merge ở PR #342. Khi đó web-api đã
biết đọc ba trường, nhưng Core trên bo vẫn là bản 28/08 chưa phát ra chúng, nên
API trả `null` — **đúng nghĩa "không đọc được"**, không phải "chưa từng fault".

## 1. Cross-build

| Mục | Giá trị |
|---|---|
| Toolchain | `platform/cmake/toolchain-aarch64-linux-gnu.cmake` |
| Cờ | `Release`, `MKDDC_ENABLE_MODBUS=ON`, `MKDDC_ENABLE_BACNET=ON` |
| Linker | `-static-libstdc++ -static-libgcc` |
| configure / build | exit **0** / exit **0** |
| SHA-256 | `b87d5e718b9f020fd4b80c98763e0ba63576dcb293e6f0f3a8e6cb600e868d71` |

Hai bẫy đã kiểm **trước** khi copy, không suy từ lệnh đã chạy:

- **`GLIBCXX`** — bo chỉ có tới `3.4.30`. Đã bật `-static-libstdc++` ngay từ đầu
  thay vì chờ hỏng rồi sửa; `objdump -p` cho thấy `NEEDED` chỉ còn `libsodium.so.23`,
  `libm`, `libc`, `ld-linux-aarch64` — **không** có `libstdc++`, và
  `strings | grep GLIBCXX_3.4` không ra dòng nào. `libsodium.so.23` đã có sẵn ở
  `/usr/lib` trên bo.
- **Binary nhầm đường** — cây build có hai bản `mkddc-core`; bản ở
  `build/release-arm64/pkg/…` là **của 23/08**. Deploy nhầm bản đó sẽ là một lát
  im lặng: service vẫn `active`, API vẫn 200, ba trường vẫn `null`. Đã chọn theo
  tem thời gian (30/08 15:10) và kiểm chuỗi trong binary trước khi copy.

Ghi thêm: `BUILD_EXIT` được đọc từ dòng ghi trong log, **không** lấy exit code
mà tiến trình nền báo về — exit đó là của `tail` ở cuối chuỗi lệnh.

## 2. Sao lưu và đường lùi

`cp -a /usr/sbin/mkddc-core /usr/sbin/mkddc-core.bak-20260830`
(SHA-256 `4f7e9a7a3bdfb82429959b7cca1b49d189b6f0f90775073107333a783db07d84`).

Rollback = `install -m 0755` bản `.bak` đè lại rồi `systemctl restart mkddc-core`.
Hợp đồng là **additive**, nên web-api mới đọc được Core cũ; chiều đó chỉ mất ba
trường chẩn đoán, không mất chức năng điều khiển. **Đường lùi này chưa được diễn
tập** trong lát này — cùng loại rủi ro với `RSK-PGM04-101`.

## 3. Kết quả trên bo

`systemctl is-active` = `active`, `NRestarts` = **0** sau 6 s và vẫn active khi
đo lại — không phải vòng restart.

A/B trên chính hai binary đang nằm trên bo, đây là bằng chứng quyết định:

| Binary | `strings \| grep lastFaultCode` |
|---|---|
| `mkddc-core.bak-20260830` (cũ) | **không có** |
| `mkddc-core` (mới) | **có** |

`GET /programming/projects/{id}/programs` sau deploy — ba trạng thái phân biệt
đúng như thiết kế, quan sát được cùng một lúc trong một phản hồi:

| Dòng | `coreState` | `lastFaultCode` | Nghĩa |
|---|---|---|---|
| 1 program Core biết | `DISABLED` | `""` | Core biết, **chưa từng** fault |
| 10 program còn lại | `null` | `null` | Core **không có mục** cho chúng |

Đây chính là lý do ba trường phải là con trỏ chứ không phải `string`: nếu dùng
`string`, cả hai nhóm trên đều ra `""` và một Program đang FAULTED trên Core
chưa nâng cấp sẽ bị báo là "chưa từng hỏng".

## 4. Quan sát phụ — vòng đối chiếu VP tự lành

Nhật ký ngay sau restart:

```
AUDIT web_cmd id=147150588475724 user=virtual-point-sync point=AV3 op=write value=12 result=accepted
```

Đây là vòng đối chiếu VP 10 giây (cũng thuộc PR #342) phát hiện `av_[]` của Core
đã reset và ghi lại giá trị cấu hình — **bằng chứng TARGET** cho nhánh tự lành,
thứ trước đây chỉ có test HOST. Nó chạy đúng vào tình huống nó được viết ra để
xử lý, mà không ai phải can thiệp.

## 5. Thử lấy mã fault THẬT — tới đâu và dừng ở đâu

Ba trạng thái ở §3 chứng minh **đường dây** hoạt động, nhưng chưa chứng minh một
Program **đang FAULTED** hiện đúng lý do. Đã thử đóng nốt bằng một POU lỗi có
chủ đích, project `FAULTPROBE-20260830`
(`1bb1cc91-867b-4bbb-9360-2979b4f10d97`):

```
Ticks   := Ticks + 1;
Divisor := INT_TO_REAL(Ticks) - INT_TO_REAL(Ticks);
Result  := 100.0 / Divisor;
```

Số chia dẫn từ biến đếm thay vì viết `0.0` trực tiếp, để phép chia không bị gấp
hằng và bị chặn ở kiểm tĩnh — mục tiêu là lỗi **lúc chạy** (`ST-RT-002`), không
phải lỗi biên dịch.

Kết quả từng bước:

| Bước | Kết quả |
|---|---|
| `upsertObject` + `upsertProgram` | 200 |
| Check lần 1 | **FAILED** `ST-SYN-001` (3:15) |
| Check lần 2 | **PASSED** |
| Mô phỏng `STEP_CYCLE` | phiên → `FAILED`, `failureCode` **`SIM-E-004`** |
| Commission | **bị chặn — không thực hiện** |

Hai điều học được, đều là hành vi thật của sản phẩm chứ không phải sự cố thao tác:

- **Bản ST này không nhận giá trị khởi tạo trong `VAR`.** `Ticks : INT := 0;` bị
  từ chối `ST-SYN-001` đúng tại cột của `:=`. Đây là giới hạn của tập con, cần
  biết khi viết tài liệu ngôn ngữ — IEC 61131-3 đầy đủ có cho phép.
- **`SIM-E-004` = `kErrExecFault`** — worker mô phỏng **đã thực thi và gặp lỗi
  lúc chạy**, đúng như thiết kế phép thử. Nhưng mã ST chi tiết không lấy được:
  sau khi phiên `FAILED`, `GET …/trace` trả 503, và đường mô phỏng vốn **không**
  ghi vào `programs[].lastFaultCode` — nó là đường khác.

Ngoài lề, đã dọn một phiên mô phỏng `PAUSED` treo từ lát AHU trước đó
(`6a02d542-…`) vì hạn ngạch là **1 phiên**; không dọn thì không tạo được phiên nào.

## 6. Điều KHÔNG được suy ra

- **Chưa có** bằng chứng target cho một Program **đang FAULTED** hiển thị mã
  thật qua `programs[].lastFaultCode`. Bước duy nhất còn thiếu là **Commission**
  gói lỗi lên bộ điều khiển đang chạy; bước đó đã **bị chặn và tôi không lách**.
  Nó kích hoạt một chương trình lên thiết bị điều khiển thật, nên là quyết định
  của chủ sở hữu chứ không phải của tôi. Cần chấp thuận rõ ràng để chạy nốt.
- `FAULTPROBE-20260830` còn nằm trên bo ở dạng **Draft/Revision chưa Commission**
  — chưa bao giờ active, không ảnh hưởng điều khiển. API không có đường xoá
  project nên nó ở lại cho tới khi có người dọn.
- **Không** phải release: đây là thay binary tại chỗ trên bo lab.
- **Không** nâng bất kỳ verdict Verification nào; `VS-PROG-U03` vẫn `NOT_RUN`.
