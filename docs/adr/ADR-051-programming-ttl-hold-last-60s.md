# ADR-051: TTL hold-last của Program là 60 giây đồng hồ, không phải "giữ vô hạn"

- Date: 2026-08-21
- Owner: Product Owner/CTO (quyết định) · Controls + Core (đề xuất kỹ thuật)
- Status: **Accepted** — chốt trong phiên làm việc 2026-08-21, đóng blocker
  "Hold TTL chưa ký" ở [`DDD-CTRL-PROG-001`](../02_design/software/PROGRAMMING_CONTROL_SEMANTICS.md) §15
- Related: `DDD-CTRL-PROG-001` §6/§14/§15 ·
  [`DDD-SW-PROG-UNIFIED-001`](../02_design/software/PROGRAMMING_UNIFIED_PRODUCT_DETAILED_DESIGN.md) §7.1/§9 ·
  [`RSK-PROG-002`](../07_records/PROGRAMMING_RISK_REGISTER.md) ·
  [ADR-027](ADR-027-programming-bootstrap-va-quyen-so-huu-chu-ky-scan.md) (base step 500..2000 ms) ·
  [ADR-029](ADR-029-programming-overrun-la-task-fault.md) (hold-last là hành vi đúng khi Task fault) ·
  `T59-406`

## Vấn đề (1 câu)

Cơ chế TTL hold-last đã có từ `TASK-PROG-401` nhưng con số vẫn là `0` — nghĩa là
khi một Program chết, thiết bị giữ lệnh cuối cùng của nó **vô thời hạn**.

## Vì sao `0` không phải một lựa chọn trung lập

`0` trông giống "chưa quyết định", nhưng nó là một quyết định: *giữ mãi mãi*. Hậu
quả tại hiện trường là một van đứng ở 73% không vì ai ra lệnh mà vì chương trình
đã chết — và không có mốc thời gian nào để người vận hành biết trạng thái đó là
điều khiển thật hay là xác chết của một lệnh cũ. `FAULTED` là trạng thái **chốt**:
hồi phục cần thao tác người. Giữ vô hạn để "đợi người tới reset" nghĩa là bán kính
thời gian của sự cố bằng thời gian tới ca trực sau.

## Quyết định

1. **TTL hold-last = 60 giây**, áp dụng đồng nhất cho mọi Program và mọi Point
   class trong Product hiện hành.
2. **TTL đo bằng đồng hồ, không bằng số vòng quét.** `hold_ttl_ns` so với mốc
   `output_commit_now_ns` của lần publish thành công gần nhất, dùng chính đồng hồ
   đã chụp một lần cho cả tick.
3. **TTL đo tuổi của LỆNH, không đo trạng thái.** Mọi instance đã từng publish mà
   lệnh cuối già hơn TTL đều bị rút, dù đang `FAULTED`, `ROLLED_BACK`, hay
   `RUNNING` trong một Task đã bị disable.
4. **`STOPPED`/`DISABLED` vẫn rút NGAY** tại safe boundary — lệnh dừng có chủ ý
   của người vận hành không phải chờ hết TTL.
5. **Instance chưa từng publish không bị ghi sổ rút**: không giữ gì thì không có
   gì để rút, và một dòng "đã rút" ở đó chỉ làm nhiễu đúng lúc cần đọc sổ.
6. **`0` = tắt TTL chỉ còn là affordance cho test/chẩn đoán.** Đường bootstrap sản
   phẩm luôn mang giá trị đã ký; cờ `--program-hold-ttl-ms` từ chối `0` và mọi giá
   trị vượt trần 600 s.

## Vì sao đúng 60 giây

| Ràng buộc | Vì sao nó chặn dưới/chặn trên |
|---|---|
| `>= 2x` chu kỳ Task chậm nhất (30 s) | Lúc Program chết, lệnh cuối đã có thể già đúng một chu kỳ. TTL nhỏ hơn 2x chu kỳ làm thời gian giữ THỰC TẾ dao động tới tận 0 — không hứa được gì với người vận hành. Ràng buộc này được `static_assert` canh theo `allowedPeriodMs` của profile, nên profile mọc thêm lớp chu kỳ chậm hơn sẽ gãy build chứ không gãy ngoài hiện trường. |
| Dải fail-safe quen thuộc của thiết bị BAS (10..60 s) | Người vận hành đã quen watchdog/fail-safe của gear khác trong cùng tủ; nằm ngoài dải này thì hành vi của DDC trở thành thứ phải giải thích riêng. |
| Ngắn hơn hằng số thời gian nhiệt của tải (phút → hàng chục phút) | Cụm thiết bị không chạy mù đủ lâu để lệch trạng thái trước khi mức ưu tiên tiếp theo/`default` tiếp quản. |

60 s là điểm duy nhất thoả cả ba: chặn dưới 60 s (2×30 s), chặn trên là dải BAS.

## Vì sao KHÔNG khoá TTL theo Point class

`DDD-CTRL-PROG-001` §6 từng ghi "decision phải khóa theo Point class". Quyết định
này **đóng** mục đó bằng một con số duy nhất, không phải hoãn nó:

- Đích rơi về đã là **theo từng điểm** (mức ưu tiên tiếp theo → `default` của
  chính điểm đó). Thêm TTL theo class là thêm núm thứ hai điều khiển một kết quả
  mà `default` của điểm đã quyết định.
- Hai con số nghĩa là hai con số phải giải thích được khi có sự cố, trong khi
  chưa có dữ liệu hiện trường nào phân biệt được chúng.

Mở lại chỉ khi có evidence hiện trường cho thấy một class thật sự cần thời gian
khác — khi đó là một ADR mới, không phải một cờ cấu hình lặng lẽ.

## Vì sao con số KHÔNG nằm trong `product_profile_v2.json`

`DDD-CTRL-PROG-001` §14 yêu cầu "đọc capability/profile đã duyệt, không hard-code
số đề xuất trong tài liệu". Câu đó nhắm vào việc **đoán số chưa ký**. Sau khi số
đã ký, đặt nó vào profile lại sai chỗ: SHA-256 của profile được ghim trong mọi
build manifest artifact và trong `g1_contract_join_v1.json`, nên mỗi lần chỉnh một
hẹn giờ an toàn sẽ thành một sự kiện **tương thích artifact** — trong khi không
artifact nào phụ thuộc con số này. TTL nằm ở `core::st_hold_ttl` cùng ADR này làm
authority, có `static_assert` ràng vào `allowedPeriodMs` của profile để hai bên
không trôi khỏi nhau, và có cờ CLI cho commissioning/HIL.

## Hệ quả

- Đầu ra do một Program đã chết giữ tối đa 60 s; sau đó `PriorityResolver` chọn
  mức tiếp theo, cuối cùng là `default` của điểm. Interlock/SafeState không đổi.
- Sổ candidate ghi lý do `FAULT_TTL_EXPIRED`, phân biệt được với `OPERATOR_DISABLE`
  và `PACKAGE_REPLACED` khi truy vấn "vì sao van này về default".
- Site cần số khác cho commissioning/HIL dùng `--program-hold-ttl-ms` (1..600000);
  đổi mặc định sản phẩm thì phải supersede ADR này.
- Evidence: host/local (`ctest` 1205/1205 tại 2026-08-21). Target/HIL vẫn chưa đo;
  hàng "Safety interaction chưa có HIL evidence" ở §15 KHÔNG được ADR này đóng.

## Rollback

Supersede bằng ADR mới. Không được hạ TTL về `0` bằng cấu hình: `0` chỉ tồn tại
cho test, và bootstrap từ chối nó.
