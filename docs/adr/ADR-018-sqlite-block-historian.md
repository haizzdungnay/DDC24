# ADR-018: SQLite block historian và policy ghi theo point

> **Trạng thái:** Accepted | **Phiên bản:** 1.13 | **Ngày duyệt:** 2026-07-22 | **Owner:** Product Owner + SW Lead
> **Amendment 1.13:** Trends presets/Auto use a bounded 24-hour RAM presentation cache; Custom uses database-only hot/archive history. Source-less callers retain unified compatibility. The total historian RAM contract remains 64 MiB (16 MiB raw tail + 48 MiB presentation cache).

## 1. Bối cảnh

Historian cũ dùng một `TrendConfig` chung, sampler 10..300 giây, prune theo số record và truy vấn tối đa 24 giờ. Cách này không đáp ứng lịch ghi riêng cho từng point, dữ liệu nhanh 1/3/5 giây, hot tier 48 giờ, rolling archive retention theo interval, truy vấn qua nhiều tier hoặc phục hồi an toàn sau mất điện.

Historian không được làm chậm scan loop hoặc làm gián đoạn điều khiển khi storage lỗi.

## 2. Quyết định

1. `mkddc-core` chỉ phát snapshot đọc, bất biến, từ cùng một scan sau priority resolve và safe-state. Core không ghi database.
2. `mkddc-web` sở hữu policy, scheduler, RAM cache, SQLite hot database, archive, migration, recovery và query.
3. Policy database logging áp dụng riêng cho UI-01..16, AO-01..04, DO-01..04 và VP numeric/boolean. VP diagnostic logging vẫn là cơ chế riêng.
4. Mỗi policy persist các input `enabled`, interval, `retentionDays` và `startAtUtc`; trạng thái `off`, `scheduled`, `recording` được dẫn xuất, không persist. Health `healthy`, `degraded`, `error` là trục độc lập; dùng một trong 11 interval được contract cho phép; bắt đầu ngay theo giờ server hoặc tại UTC tương lai.
5. Historian có bounded RAM raw tail cho interval 1/3/5 giây, RAM presentation cache aggregate 15 giây giữ 24 giờ, hot SQLite giữ 48 giờ và archive immutable có rolling retention được chọn trong giới hạn của interval. Raw tail và presentation cache có budget lần lượt 16 MiB và 48 MiB.
6. Identity lịch sử là `{canonicalPointId, generation}`. Đổi tag/display name không đổi identity; xóa rồi tạo lại point phải tăng generation.
7. Scheduler dùng monotonic clock cho boundary. Restart, clock jump, queue overflow, snapshot thiếu và storage failure tạo gap; không backfill và không hold-last.
8. Query không có `source` merge tương thích theo ưu tiên `RAM > hot > archive`. `source=cache` chỉ đọc presentation cache và bị giới hạn 24 giờ; `source=database` chỉ đọc hot/archive. Frontend không tự merge tier; presets/Auto gửi `cache`, Custom gửi `database`.
9. Dữ liệu historian cũ phải được backup và migrate idempotent. Không xóa tự động database cũ hoặc database corrupt.
10. Storage lỗi không chặn live data hoặc control. Policy mới có thể bị từ chối `507`; recording vẫn là state theo lịch nhưng health chuyển `error`, và backend ghi/reconstruct gap khi phục hồi.

Maximum retention Rev A là product contract deterministic: `1s=30d`, `3s=60d`, `5s=90d`, `15s=180d`, `30s=365d`, `1m=730d`, `3m=1095d`, `5m=1460d`, `15m=1825d`, `30m=2555d`, `60m=3650d`. Admin được chọn giá trị nhỏ hơn tới 1 ngày. Với `1s|3s|5s`, raw fine-resolution chỉ ở RAM tail; archive dài hạn là aggregate 15 giây, nên maximum retention không cam kết raw sample ở interval gốc.

## 3. Hệ quả

- Cần coherent snapshot contract mới giữa core và web.
- Cần thay `TrendStore`/`Sampler` cũ sau khi pipeline mới đạt GREEN.
- Cần budget RAM, disk và query trên target Orange Pi/eMMC.
- Query có thể trả partial data kèm gaps khi một tier lỗi; mọi tier lỗi trả `503`.
- Cache được warm từ durable hot rows khi web khởi động rồi chỉ nhận row sau commit SQLite thành công; preset không read-through database. Vì vậy restart warmup failure làm cache query fail rõ ràng thay vì âm thầm đổi nguồn.
- Hot data chỉ được prune sau archive watermark durable.
- Physical rolling-prune và evidence-bound prepare/commit/boot-reconcile engine đã implement/test code-local, nhưng production writer/query authority và prune chỉ được enable sau final maintenance backup/quiesce, activation/cutover reconciliation và benchmark target; readiness/shadow mode giữ guard fail-closed và không xóa history.
- Schema v4 persist immutable proof nối verified migration phase/manifest/policy với native-backup SHA/schema/quick-check/size, full-keyspace digest và deterministic accepted/rejected outcome. Caller boolean không cấp migration authority; durable evidence hoặc active config checksum/revision mismatch làm writer/query/prune fail closed.
- Schema v5 bổ sung durable legacy-quiesce epoch/token và maintenance-only coordinator theo thứ tự write fence/checkpoint → stop/wait physical + VP legacy samplers → final backup → full migration/evidence → missed-boundary gaps → activation. Bounded board activation đã chạy đúng thứ tự; không có startup/HTTP auto-trigger. Prune scheduling, physical fault/power-cut, target eMMC/endurance, browser/manual E2E, long soak và legacy removal vẫn là release gates.
- Offline `historian-maintenance` CLI chỉ chạy khi service-presence file absent, output nằm trong migration directory, manifest/window identity khớp, stable UTC hợp lệ và operator đưa exact confirmation; CLI không có prune flag và không thay thế board maintenance/rollback rehearsal.
- `historian-rollback-verify` mở fixture schema v5 read-only, kiểm tra quick-check, authority matrix và exact durable-evidence joins; active/degraded không được bật legacy writer, future schema fail closed và verifier không migrate/mutate fixture.
- `historian-rollback-package` build hai binary native riêng tên, ghi SHA-256/size/Go build metadata, chạy current và rollback candidate trên fixture legacy+active, hash DB family (`-wal/-shm/-journal`) cùng archive/evidence trước/sau và publish manifest release evidence atomic. Gate chỉ chứng minh native host package; ARM64/board execution, power-cut và production cutover vẫn mở.
- ARM64 preflight phải fail closed nếu fixture board chưa ở schema hỗ trợ. Evidence 2026-07-21 xác nhận current/candidate ARM64 cùng từ chối frozen schema-v1 fixture, giữ SHA không đổi; kết quả này không được dùng thay schema-v5 legacy+active parity, power-cut hoặc cutover gate.
- Prebuilt-native mode cho phép board không có Go kiểm tra trực tiếp hai packaged binaries. Final ARM64 schema-v5 legacy+active parity và bounded live-board cutover đều GREEN với native manifest, unchanged DB/archive/evidence hashes và evidence-bound active marker; physical power-cut, eMMC endurance, long soak, prune và legacy removal vẫn mở.
- Filesystem atomic rename của prepared `historian.conf` là commit point duy nhất; SQLite active marker có thể retry sau commit, còn prepared-state mismatch/revision thiếu thì fail closed và giữ live/control + legacy authority.
- Capacity projection code/local chưa thay thế benchmark codec, write amplification, free-space và endurance trên eMMC đích.

## 4. Phương án loại bỏ

- **Một SQLite table duy nhất:** đơn giản nhưng không giữ được dữ liệu nhanh, retention dài và bounded query cost cùng lúc.
- **Core ghi SQLite:** phá real-time boundary và đưa I/O storage vào scan path.
- **Frontend giữ/merge lịch sử:** tạo nhiều nguồn dữ liệu và mất history khi reload.
- **Prune theo số record:** retention thay đổi theo interval và có thể xóa dữ liệu trước archive.

## 5. Nguồn triển khai

- [Plan 42](../03_implementation/42_HISTORIAN_FE_PROTOTYPE_PLAN.md)
- [Runtime model](../02_design/software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md)
- [OpenAPI](../../contracts/openapi/openapi.yaml)
- [Config schema](../02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md)
- [Task checklist](../03_implementation/11_TASK_CHECKLIST.md)

## 6. Verification bắt buộc

- Core snapshot coherence và scan latency.
- Go race, migration interruption, power-cut reopen, corruption recovery và tier merge.
- FE test/lint/typecheck/build, keyboard và accessibility.
- E2E restart/clock/disk/gap và benchmark Orange Pi/eMMC.

Không claim release trước khi `COR-HIST-001`, `WEB-HIST-001..005` và `E2E-HIST-001` Done.
