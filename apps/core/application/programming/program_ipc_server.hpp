#ifndef CORE_APPLICATION_PROGRAMMING_PROGRAM_IPC_SERVER_HPP
#define CORE_APPLICATION_PROGRAMMING_PROGRAM_IPC_SERVER_HPP

#include <array>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <string>
#include <unordered_map>
#include <vector>

#include "programming/programming_runtime_coordinator.hpp"
#include "st/st_value_trace.hpp"

namespace core::programming {

constexpr uint16_t PROGRAM_IPC_PROTOCOL_MAJOR = 1;
/* T59-504 nâng minor 2 -> 3: STATUS thêm snapshot Published Signal ở phần tử
 * thứ năm. Client minor cũ không giải mã array dài hơn, nên phải nhận biết
 * phiên bản thay vì âm thầm coi payload hỏng. */
constexpr uint16_t PROGRAM_IPC_PROTOCOL_MINOR = 3;
constexpr std::size_t PROGRAM_IPC_MAX_FRAME = 64U * 1024U;
constexpr std::size_t PROGRAM_IPC_MAX_PAYLOAD = 32U * 1024U;
constexpr std::size_t PROGRAM_IPC_MAX_QUEUE = 32;
constexpr std::size_t PROGRAM_IPC_CACHE_LIMIT = 128;

enum class ProgramAction {
    Capabilities,
    Status,
    Stage,
    Activate,
    OperationStatus,
    Restore,
    TraceStart,
    RetainReset,
    /* T59-405 — intent Enable/Disable cho MỘT Program. Là action riêng chứ không
     * phải tham số của ACTIVATE: "chương trình nào đang chạy" và "gói nào đang
     * hoạt động" là hai quyết định khác nhau, và gộp chúng sẽ buộc mọi lần bật
     * một Program phải đi qua đường Commission. */
    SetProgramEnabled,
    /* T59-408 — trace giá trị. `TRACE_START`/`TRACE_STOP` là mutation (đổi trạng
     * thái lấy mẫu của Core); `TRACE_READ` chỉ đọc. Tách `TRACE_READ` ra khỏi
     * hai cái kia vì trộn một lệnh đọc vào nhóm mutation sẽ buộc nó phải mang
     * `operationId` và đi qua kiểm idempotency mà nó không cần. */
    TraceStop,
    TraceRead,
};

enum class ProgramResult {
    Ok,
    Staged,
    Accepted,
    Rejected,
    Unavailable,
    Busy,
};

enum class ProgramCodecError {
    None,
    FrameTooLarge,
    FrameTruncated,
    InvalidEnvelope,
    UnsupportedMajor,
    UnsupportedMinor,
    PayloadHashMismatch,
};

struct ProgramRequest {
    uint16_t protocol_major = PROGRAM_IPC_PROTOCOL_MAJOR;
    uint16_t protocol_minor = PROGRAM_IPC_PROTOCOL_MINOR;
    std::string schema_version = "1.0";
    std::vector<uint8_t> request_id;
    std::vector<uint8_t> operation_id;
    std::string controller_id;
    std::string actor_id;
    uint64_t deadline_mono_ns = 0;
    std::array<uint8_t, 32> payload_hash{};
    ProgramAction action = ProgramAction::Capabilities;
    std::string correlation_id;
    std::vector<uint8_t> payload;
};

struct ProgramResponse {
    uint16_t protocol_major = PROGRAM_IPC_PROTOCOL_MAJOR;
    uint16_t protocol_minor = PROGRAM_IPC_PROTOCOL_MINOR;
    std::string schema_version = "1.0";
    std::vector<uint8_t> request_id;
    std::vector<uint8_t> operation_id;
    std::string correlation_id;
    ProgramResult result = ProgramResult::Unavailable;
    bool has_active_revision = false;
    std::string active_revision_id;
    bool has_lkg_revision = false;
    std::string lkg_revision_id;
    bool keeps_running = true;
    bool has_detail_code = false;
    std::string detail_code;
    std::string component = "core.programming.ipc";
    std::vector<uint8_t> payload;
};

struct PeerCredentials {
    bool valid = false;
    uint32_t uid = 0;
    uint32_t gid = 0;
    int32_t pid = 0;
};

std::vector<uint8_t> EncodeFrame(const std::vector<uint8_t>& cbor,
                                 ProgramCodecError* error = nullptr);
bool DecodeFrame(const std::vector<uint8_t>& frame, std::vector<uint8_t>* cbor,
                 ProgramCodecError* error = nullptr);
std::vector<uint8_t> EncodeRequestFrame(const ProgramRequest& request,
                                        ProgramCodecError* error = nullptr);
bool DecodeRequestFrame(const std::vector<uint8_t>& frame, ProgramRequest* request,
                        ProgramCodecError* error = nullptr);
std::vector<uint8_t> EncodeResponseFrame(const ProgramResponse& response,
                                         ProgramCodecError* error = nullptr);
bool DecodeResponseFrame(const std::vector<uint8_t>& frame, ProgramResponse* response,
                         ProgramCodecError* error = nullptr);
PeerCredentials ReadPeerCredentials(int socket_fd);

class ProgramIpcServer {
public:
    explicit ProgramIpcServer(uint32_t allowed_peer_uid,
                              ProgrammingRuntimeCoordinator* coordinator = nullptr)
        : allowed_peer_uid_(allowed_peer_uid), coordinator_(coordinator) {}

    // Pure non-RT boundary: decode/validate/cache/dispatch skeleton. Empty
    // response means peer/frame rejected and caller must close the connection.
    std::vector<uint8_t> HandleFrame(const std::vector<uint8_t>& frame,
                                     const PeerCredentials& peer,
                                     uint64_t now_mono_ns);

    /* T59-408 — trace giá trị của Core. nullptr = ba action trace trả
     * `IPC-TRACE-UNAVAILABLE` thay vì im lặng thành công: một `TRACE_START`
     * "thành công" mà không có nơi lấy mẫu là lời hứa suông. */
    void set_value_trace(StValueTrace* trace, const StScheduler* scheduler)
    {
        value_trace_ = trace;
        trace_scheduler_ = scheduler;
    }

#ifdef CORE_BUILD_TESTS
    void set_queue_depth_for_test(std::size_t depth) { queue_depth_ = depth; }
    std::size_t cache_size_for_test() const { return cache_.size(); }
#endif

private:
    struct CachedResponse {
        std::vector<uint8_t> request_frame;
        std::vector<uint8_t> response_frame;
    };

    /* Ba action trace gộp một chỗ: chúng chia chung phép kiểm "có bus trace
     * không" và chung cách trả lỗi. */
    ProgramResponse handle_trace(const ProgramRequest& request, uint64_t now_mono_ns) const;

    ProgramResponse make_response(const ProgramRequest& request, ProgramResult result,
                                  const char* detail_code,
                                  std::vector<uint8_t> payload = {}) const;
    void cache_response(const std::string& request_key, const std::vector<uint8_t>& request,
                        const std::vector<uint8_t>& response);

    uint32_t allowed_peer_uid_ = 0;
    std::size_t queue_depth_ = 0;
    std::unordered_map<std::string, CachedResponse> cache_;
    std::deque<std::string> cache_order_;
    ProgrammingRuntimeCoordinator* coordinator_ = nullptr;
    StValueTrace* value_trace_ = nullptr;
    /* Cần để phân giải tên biến → slot lúc `TRACE_START`. Đi cùng `value_trace_`
     * vì hai thứ chỉ có nghĩa cùng nhau. */
    const StScheduler* trace_scheduler_ = nullptr;
};

} // namespace core::programming

#endif
