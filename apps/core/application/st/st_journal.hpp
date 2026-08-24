/**
 * @file  st_journal.hpp
 * @brief Journal bền vững cho giao dịch safe-boundary swap của một Program
 *        Instance, theo DDD-LIFE-PROG-001 §7 (Safe-boundary transaction và
 *        power-loss).
 *
 *        Đây là PHẦN CORE-SIDE của bất biến "mất điện đúng lúc đang tráo
 *        chương trình thì máy khởi động lên chạy cái gì?" — không phải Check/
 *        Commission/Restore state machine phía BE (đó là TASK-PROG-403,
 *        DB-backed). File này chỉ ghi và đọc lại 5 phase append-only, có
 *        checksum riêng từng bản ghi để đọc lại đúng "bản ghi hợp lệ cuối
 *        cùng" ngay cả khi bản ghi CUỐI bị cắt cụt do mất điện giữa lúc ghi —
 *        đó là tình huống BÌNH THƯỜNG mà thiết kế này phải xử lý êm, không
 *        phải lỗi.
 *
 *        Component này KHÔNG tự thực hiện safe-boundary swap (đó là
 *        StScheduler::apply_pending_activations, đã có từ TASK-PROG-300) và
 *        KHÔNG tự quyết định policy khi phục hồi — decide_boot_action() chỉ
 *        trả lại HÀNH ĐỘNG theo bảng phục hồi đã duyệt; caller (bootstrap,
 *        còn mở — xem ghi chú TASK-PROG-400) chịu trách nhiệm THỰC THI.
 */
#ifndef CORE_ST_JOURNAL_HPP
#define CORE_ST_JOURNAL_HPP

#include <cstdint>
#include <string>

namespace core {

/* Đúng 5 phase của DDD-LIFE-PROG-001 §7, theo thứ tự xảy ra. Giá trị số là
 * wire format — không đổi số của phase đã có, chỉ nối thêm cuối. */
enum class StJournalPhase : uint8_t {
    PREPARED = 0,          /* candidate đã verify, chưa chạm safe boundary */
    COMMIT_INTENT = 1,     /* cam kết tráo, TRƯỚC khi đổi con trỏ active */
    ACTIVE_CANDIDATE = 2,  /* con trỏ đã đổi, chưa chạy cycle nào */
    FIRST_CYCLE_OK = 3,    /* cycle đầu chạy xong không lỗi, chưa checkpoint */
    COMMITTED = 4,         /* checkpoint active + LKG xong */
    /* T59-702 — operator xác nhận bỏ giao dịch không thể phục hồi.
     *
     * Vì sao phải là một phase trong journal chứ không phải xoá file: `RECOVERY_
     * REQUIRED` là ngõ cụt — mọi action IPC trả `Unavailable`, nên đường thoát
     * duy nhất trước đây là xoá journal bằng tay trên bo, tức là **xoá sổ vận
     * hành** để thoát một trạng thái vận hành. Ghi thêm một bản ghi giữ nguyên
     * lịch sử và để lại dấu ai đã quyết định bỏ.
     *
     * Bản ghi này KHÔNG nạp gói nào: sau reset, Core ở `IDLE` không Active, giữ
     * safe-state, và chờ một Commission tường minh. */
    RECOVERY_RESET = 5,
};

const char* st_journal_phase_name(StJournalPhase phase);

/* op/hash field bounded — journal là fixed-size record, không phải blob tự
 * do. 64 byte đủ cho UUID (36 ký tự) và hex SHA-256 (64 ký tự) riêng biệt. */
constexpr std::size_t kStJournalFieldMax = 64;

struct StJournalRecord {
    StJournalPhase phase = StJournalPhase::PREPARED;
    uint64_t       timestamp_ns = 0;
    std::string    operation_id;      /* <=64 byte, thường là idempotency key */
    std::string    old_active_hash;   /* <=64 byte hex; rỗng nếu chưa từng có active */
    std::string    candidate_hash;    /* <=64 byte hex SHA-256 artifact */
    std::string    plan_hash;         /* <=64 byte hex — TransitionPlan §6 */
};

enum class StJournalReadStatus : uint8_t {
    EMPTY,    /* chưa từng ghi gì — lần chạy đầu tiên, không phải lỗi */
    OK,       /* có >=1 bản ghi hợp lệ; `record` là bản ghi HỢP LỆ CUỐI CÙNG */
    CORRUPT,  /* bản ghi ĐẦU TIÊN đã hỏng — không có mốc nào tin được */
};

struct StJournalReadResult {
    StJournalReadStatus status = StJournalReadStatus::EMPTY;
    StJournalRecord     record;              /* hợp lệ chỉ khi status == OK */
    uint64_t            valid_record_count = 0;
    /* >0 nếu phần đuôi file có byte thừa không đủ thành một record hoàn
     * chỉnh — dấu hiệu BÌNH THƯỜNG của việc mất điện giữa lúc ghi record kế
     * tiếp, không phải hỏng dữ liệu (mọi record trước đó vẫn `valid_record_
     * count`). */
    uint64_t            truncated_tail_bytes = 0;
};

/* Hành động phục hồi tại boot, đúng 5 dòng bảng DDD-LIFE-PROG-001 §7.
 * KHÔNG tự thực thi gì — chỉ là quyết định thuần, test được không cần I/O. */
enum class StJournalBootAction : uint8_t {
    /* "trước COMMIT_INTENT" HOẶC journal trống: candidate (nếu có) chưa từng
     * chạm safe boundary — giữ active cũ, bỏ candidate. */
    KEEP_OLD_ACTIVE_DISCARD_CANDIDATE,
    /* "COMMIT_INTENT nhưng chưa ACTIVE_CANDIDATE": có Ý ĐỊNH tráo nhưng chưa
     * chắc con trỏ đã đổi hay chưa (mất điện đúng lúc atomic swap) — coi như
     * chưa đổi (an toàn hơn), giữ active cũ, đánh dấu operation failed để BE
     * biết mà reconcile, không âm thầm coi là thành công. */
    KEEP_OLD_ACTIVE_MARK_OPERATION_FAILED,
    /* "ACTIVE_CANDIDATE chưa FIRST_CYCLE_OK": con trỏ đã đổi nhưng chưa
     * chứng minh chạy được — dùng LKG (KHÔNG phải candidate, KHÔNG phải
     * active cũ), và candidate không được tự động publish lại. */
    USE_LKG_CANDIDATE_NOT_AUTO_PUBLISHED,
    /* "FIRST_CYCLE_OK chưa COMMITTED": cycle đầu đã qua nhưng chưa
     * checkpoint — verify lại hash active/checkpoint rồi mới quyết định
     * finish (nếu khớp) hay LKG (nếu không), KHÔNG được chạy lại giao dịch
     * hai lần. */
    VERIFY_ACTIVE_THEN_FINISH_OR_LKG,
    /* "COMMITTED": giao dịch đã xong hoàn toàn — dùng đúng active đã commit. */
    USE_COMMITTED_ACTIVE,
    /* Bản ghi ĐẦU TIÊN hỏng — không có mốc nào tin được. Không chọn candidate
     * mới; boot bằng LKG đã checksum nếu có; raise incident (§7: "raise
     * incident. SafetyManager độc lập vẫn chạy"). */
    NO_VALID_RECORD_RAISE_INCIDENT,
    /* "RECOVERY_RESET": operator đã bỏ giao dịch cũ một cách tường minh. Boot
     * sạch, không Active, không candidate — chờ Commission mới. */
    COLD_START_AFTER_RECOVERY_RESET,
};

StJournalBootAction st_journal_decide_boot_action(const StJournalReadResult& read);

/* Journal append-only cho MỘT Program Instance. `path` do caller cấp — file
 * này không tự suy STATE_DIR, giữ đúng nguyên tắc của StRetainStore (mỗi
 * component chỉ biết đường dẫn CỦA MÌNH, không tự lắp ráp cấu trúc thư mục
 * toàn hệ). */
class StJournal {
public:
    explicit StJournal(std::string path) : path_(std::move(path)) {}

    /* Nối một record vào cuối file: ghi + fsync fd + fsync thư mục cha, TRƯỚC
     * khi enqueue safe boundary (§7: "fsync ở non-RT trước khi enqueue
     * boundary") — hàm này luôn chạy ngoài đường RT. Trả false nếu field
     * vượt kStJournalFieldMax hoặc I/O lỗi; KHÔNG ghi record nửa vời (mở
     * O_APPEND, ghi toàn bộ record trong một lần write() rồi fsync — không
     * có cách nào để lại ít hơn một record trừ khi crash GIỮA write(), đúng
     * tình huống đọc lại phải xử lý êm). */
    bool append(const StJournalRecord& record);

    /* Đọc toàn bộ file, trả bản ghi HỢP LỆ CUỐI CÙNG. Không có file -> EMPTY.
     * Record đầu hỏng -> CORRUPT. Record cuối bị cắt cụt (đuôi file ngắn hơn
     * một record) không làm hỏng các record trước đó. */
    StJournalReadResult read_last() const;

    /* Xoá journal — dùng sau khi COMMITTED đã được BE project vào DB xong,
     * không còn cần giữ lịch sử giao dịch NÀY nữa (journal ghi lại MỘT giao
     * dịch tại một thời điểm, không phải audit log vĩnh viễn — audit bền
     * vững là DB phía BE). */
    bool erase() const;

private:
    std::string path_;
};

} // namespace core

#endif /* CORE_ST_JOURNAL_HPP */
