/**
 * @file  programming_sim_worker_main.cpp
 * @brief `mkddc-programming-sim-worker` — tiến trình mô phỏng EPHEMERAL của một
 *        phiên Simulation (`ADR-053`, `T59-814`).
 *
 *        Đây KHÔNG phải service thường trú. Nó sống đúng bằng vòng đời một
 *        phiên, nhận lệnh qua ống riêng do supervisor thừa kế cho, và không có
 *        bất kỳ handle nào tới production: không SHM, không socket Core/iobus,
 *        không `/dev`, không RETAIN/journal. Ba lớp cùng bảo đảm điều đó và
 *        không lớp nào một mình đủ:
 *
 *          1. Link list hẹp — worker chỉ link loader/executor thuần, không link
 *             `core_domain` (PointTable/PriorityResolver/PointWriter). Cổng
 *             `scripts/verify_programming_sim_worker_boundary.py` đọc symbol
 *             thật sau link, không suy từ cây thư mục.
 *          2. Hàng rào tiến trình tự dựng — xem `sim_sandbox.hpp`.
 *          3. Supervisor phía Go — quota, TTL, kill/reap.
 *
 *        Giao thức là JSON theo dòng trên stdin/stdout. Dùng ống thừa kế thay
 *        vì socket có đường dẫn: một đường dẫn trên hệ thống tập tin là một thứ
 *        có thể bị đoán, bị tạo trước hoặc bị thay; một FD thừa kế thì không.
 *        `PREPARE` mang artifact dạng nhị phân ngay sau dòng lệnh, có khai độ
 *        dài — base64 sẽ làm gói 16 MiB phình lên hơn 21 MiB mà không đổi lại
 *        được gì.
 */

#include <algorithm>
#include <cerrno>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <fcntl.h>
#include <unistd.h>
#include <sys/socket.h>
#include <sys/un.h>

#include <sodium.h>
#include <nlohmann/json.hpp>

#include <array>
#include <fstream>

#include "mkddc_shm.h"

#include "sanitizer_build.hpp"
#include "programming/simulation/sim_error.hpp"
#include "programming/simulation/sim_sandbox.hpp"
#include "programming/simulation/sim_session.hpp"
#include "st/st_profile_generated.hpp"

/* Ngoài anonymous namespace: LSan tra symbol này theo tên C nên nó phải có liên
 * kết ngoài. */
MKDDC_SANDBOX_DISABLES_LEAK_CHECK()

namespace {

using json = nlohmann::json;
using core::programming::sim::SimObservation;
using core::programming::sim::SimSession;

constexpr int kProtocolVersion = 1;
constexpr const char* kWorkerVersion = "1.0.0";
/* Trần dòng lệnh. Artifact KHÔNG đi trong dòng nên trần này chỉ cần đủ cho
 * metadata; một dòng dài hơn là dấu hiệu giao thức bị lạm dụng, không phải một
 * yêu cầu hợp lệ. */
constexpr std::size_t kMaxLineBytes = 256 * 1024;
constexpr std::size_t kMaxArtifactBytes = 16u * 1024u * 1024u;
/* Trần không gian địa chỉ của hàng rào tiến trình. `0` = giữ nguyên giới hạn
 * hiện có; xem `sanitizer_build.hpp` để biết vì sao lane sanitizer phải miễn
 * trần này. Mọi thành phần khác của hàng rào vẫn áp đủ. */
constexpr unsigned long kAddressSpaceBytes =
    core::kShadowSanitizerBuild ? 0ul : 192ul * 1024ul * 1024ul;


/* Đọc theo dòng trên fd 0 và GIỮ phần dư sau '\n'. Nếu dùng stdio thường thì
 * phần nhị phân của `PREPARE` đã nằm trong bộ đệm của thư viện và không lấy lại
 * được — lỗi này chỉ lộ ra khi artifact đủ lớn. */
class LineReader {
public:
    bool read_line(std::string* out)
    {
        for (;;) {
            const std::size_t newline = buffer_.find('\n');
            if (newline != std::string::npos) {
                *out = buffer_.substr(0, newline);
                buffer_.erase(0, newline + 1);
                return true;
            }
            if (buffer_.size() > kMaxLineBytes) return false;
            char chunk[4096];
            const ssize_t got = ::read(STDIN_FILENO, chunk, sizeof(chunk));
            if (got <= 0) return false;
            buffer_.append(chunk, static_cast<std::size_t>(got));
        }
    }

    bool read_exact(std::size_t count, std::vector<uint8_t>* out)
    {
        out->clear();
        out->reserve(count);
        const std::size_t from_buffer = std::min(count, buffer_.size());
        out->insert(out->end(), buffer_.begin(),
                    buffer_.begin() + static_cast<std::ptrdiff_t>(from_buffer));
        buffer_.erase(0, from_buffer);
        while (out->size() < count) {
            char chunk[65536];
            const std::size_t want = std::min(sizeof(chunk), count - out->size());
            const ssize_t got = ::read(STDIN_FILENO, chunk, want);
            if (got <= 0) return false;
            out->insert(out->end(), chunk, chunk + got);
        }
        return true;
    }

private:
    std::string buffer_;
};

void write_line(const json& payload)
{
    const std::string encoded = payload.dump() + "\n";
    std::size_t written = 0;
    while (written < encoded.size()) {
        const ssize_t got = ::write(STDOUT_FILENO, encoded.data() + written,
                                    encoded.size() - written);
        if (got <= 0) return;
        written += static_cast<std::size_t>(got);
    }
}

json failure(const std::string& command_id, const char* code, const std::string& detail)
{
    return json{{"ok", false},
                {"commandId", command_id},
                {"errorCode", code != nullptr ? code : core::programming::sim::kErrProtocol},
                {"detail", detail}};
}

const char* type_name(core::StType type)
{
    return core::st_type_name(type);
}

json encode_value(const core::StValue& value)
{
    switch (value.type) {
    case core::StType::BOOL: return json(value.b);
    case core::StType::REAL: return json(value.r);
    case core::StType::TIME: return json(value.t);
    case core::StType::INT:
    case core::StType::DINT:
    case core::StType::UINT: return json(value.i);
    }
    return json(nullptr);
}

/* Giải mã giá trị typed. Kiểu ĐI KÈM lệnh và phải khớp manifest: nếu suy kiểu
 * từ hình dạng JSON thì `1` và `1.0` trở thành hai kiểu khác nhau tuỳ cách
 * client serialize, và biên kiểm kiểu biến thành biên kiểm định dạng. */
bool decode_value(const json& node, const std::string& declared_type, core::StValue* out)
{
    if (declared_type == "BOOL") {
        if (!node.is_boolean()) return false;
        *out = core::StValue::make_bool(node.get<bool>());
        return true;
    }
    if (declared_type == "REAL") {
        if (!node.is_number()) return false;
        *out = core::StValue::make_real(node.get<float>());
        return true;
    }
    if (declared_type == "TIME") {
        if (!node.is_number_integer()) return false;
        *out = core::StValue::make_time(node.get<int64_t>());
        return true;
    }
    if (declared_type == "INT" || declared_type == "DINT" || declared_type == "UINT") {
        if (!node.is_number_integer()) return false;
        const int64_t raw = node.get<int64_t>();
        if (raw < INT32_MIN || raw > INT32_MAX) return false;
        core::StType type = core::StType::DINT;
        if (declared_type == "INT") type = core::StType::INT;
        if (declared_type == "UINT") type = core::StType::UINT;
        *out = core::StValue::make_integer(type, static_cast<int32_t>(raw));
        return true;
    }
    return false;
}

json encode_observations(const std::vector<SimObservation>& observations)
{
    json array = json::array();
    for (const SimObservation& observation : observations) {
        array.push_back(json{
            {"observationId", observation.observation_id},
            {"programId", observation.program_name},
            {"variable", observation.variable},
            {"kind", observation.kind == core::programming::sim::SimObservationKind::OUTPUT
                         ? "OUTPUT" : "INPUT"},
            {"dataType", type_name(observation.type)},
            {"quality", observation.has_value ? "GOOD" : "UNAVAILABLE"},
            {"value", observation.has_value ? encode_value(observation.value) : json(nullptr)},
        });
    }
    return array;
}

json encode_manifest(const SimSession& session)
{
    json inputs = json::array();
    for (const auto& descriptor : session.inputs()) {
        json entry{
            {"observationId", descriptor.observation_id},
            {"programId", descriptor.program_name},
            {"variable", descriptor.variable},
            {"sourceKind", core::programming::sim::sim_source_kind_name(descriptor.source_kind)},
            {"dataType", type_name(descriptor.type)},
            {"simulationWritable", true},
        };
        if (descriptor.has_range) {
            entry["min"] = descriptor.range_min;
            entry["max"] = descriptor.range_max;
        } else {
            entry["min"] = nullptr;
            entry["max"] = nullptr;
        }
        entry["unit"] = descriptor.unit.empty() ? json(nullptr) : json(descriptor.unit);
        inputs.push_back(std::move(entry));
    }

    json programs = json::array();
    for (const auto& program : session.programs()) {
        programs.push_back(json{
            {"programId", program.program_name},
            {"periodMs", program.period_ms},
            {"order", program.order},
        });
    }

    return json{
        {"baseTickMs", session.base_tick_ms()},
        {"programs", programs},
        {"simulationInputs", inputs},
        {"observations", encode_observations(session.observations())},
    };
}

/* Chế độ bằng chứng: áp hàng rào rồi thử mở đúng những thứ mà worker BỊ CẤM
 * chạm, in ra errno của từng lần thử. Có mode này thì mục 2 của kế hoạch
 * zero-physical-output là một lệnh chạy lại được, không phải một đoạn mô tả. */
int run_sandbox_probe()
{
    core::programming::sim::SandboxReport report;
    std::string error;
    const bool applied = core::programming::sim::apply_sandbox(kAddressSpaceBytes, &report, &error);

    json probes = json::array();
    /* Tám target dưới đây phải là ĐƯỜNG DẪN SẢN PHẨM THẬT, không phải tên gần
     * giống. Hàng rào từ chối ở lớp syscall TRƯỚC khi phân giải đường dẫn, nên
     * một đường dẫn không tồn tại vẫn trả `EACCES` y hệt một đường dẫn tồn tại:
     * cổng errno ở `scripts/verify_programming_sim_worker.py` sẽ vẫn xanh trong
     * khi thứ cần chứng minh chưa từng được thử. Trước `#605` có năm trong tám
     * cái tên đã trôi khỏi nguồn chuẩn theo đúng kiểu đó.
     *
     * Vì vậy: SHM lấy thẳng macro của hợp đồng, ba đường dẫn còn lại ghi kèm
     * `file:line` của nơi sản phẩm dựng chúng. Cổng tĩnh trong
     * `scripts/verify_programming_sim_worker_boundary.py` canh danh sách này. */
    const char* paths[] = {
        /* `contracts/shm/mkddc_shm.h:59` — không chép chuỗi, lấy đúng macro. */
        KX_SHM_IO_PATH,
        /* `contracts/shm/mkddc_shm.h:60` */
        KX_SHM_PLC_PATH,
        "/dev/mem",
        "/dev/ttyS0",
        /* RETAIN là THƯ MỤC chứ không phải một file `.bin`:
         * `apps/core/bootstrap/main.cpp:470` dựng `programming_state + "/retain"`. */
        "/data/mkddc/programming/retain",
        /* `apps/core/bootstrap/main.cpp:500` —
         * `programming_state + "/journal/lifecycle.bin"`. */
        "/data/mkddc/programming/journal/lifecycle.bin",
        /* `apps/core/bootstrap/main.cpp:119` và
         * `contracts/ipc/programming_v1/README.md:7`. */
        "/run/mkddc/programming-v1.sock",
        "/etc/shadow",
    };
    static_assert(sizeof(paths) / sizeof(paths[0]) == 8,
                  "Bề mặt probe cố định 8 đường dẫn + 1 phép thử AF_UNIX socket; "
                  "mở rộng bề mặt là thay đổi phạm vi bằng chứng, không phải sửa lỗi.");
    for (const char* path : paths) {
        errno = 0;
        const int fd = ::open(path, O_RDONLY);
        const int captured = errno;
        if (fd >= 0) ::close(fd);
        probes.push_back(json{
            {"target", path},
            {"kind", "open"},
            {"denied", fd < 0},
            {"errno", fd < 0 ? captured : 0},
            {"errnoText", fd < 0 ? std::strerror(captured) : "OPENED"},
        });
    }

    errno = 0;
    const int sock = ::socket(AF_UNIX, SOCK_STREAM, 0);
    const int socket_errno = errno;
    if (sock >= 0) ::close(sock);
    probes.push_back(json{
        {"target", "AF_UNIX socket"},
        {"kind", "socket"},
        {"denied", sock < 0},
        {"errno", sock < 0 ? socket_errno : 0},
        {"errnoText", sock < 0 ? std::strerror(socket_errno) : "CREATED"},
    });

    bool all_denied = true;
    for (const json& probe : probes) {
        if (!probe.at("denied").get<bool>()) all_denied = false;
    }

    write_line(json{
        {"mode", "sandbox-probe"},
        {"sandboxApplied", applied},
        {"sandboxError", error},
        {"workerVersion", kWorkerVersion},
        {"closedInheritedFds", report.closed_inherited_fds},
        {"fileWritesDenied", report.file_writes_denied},
        {"noNewPrivs", report.no_new_privs},
        {"seccompInstalled", report.seccomp_installed},
        {"addressSpaceBytes", report.address_space_bytes},
        {"allDenied", all_denied},
        {"probes", probes},
    });
    return (applied && all_denied) ? 0 : 1;
}

int run_protocol_loop(const std::string& expected_token, const core::StLoaderOptions& loader_options)
{
    LineReader reader;
    SimSession session;
    session.set_loader_options(loader_options);
    bool greeted = false;
    std::string line;

    while (reader.read_line(&line)) {
        json request;
        try {
            request = json::parse(line);
        } catch (const json::exception&) {
            write_line(failure("", core::programming::sim::kErrProtocol, "dòng lệnh không phải JSON"));
            return 2;
        }
        if (!request.is_object()) {
            write_line(failure("", core::programming::sim::kErrProtocol, "lệnh phải là object"));
            return 2;
        }
        const std::string command = request.value("cmd", std::string());
        const std::string command_id = request.value("commandId", std::string());

        if (!greeted) {
            /* Bắt tay phải là lệnh ĐẦU TIÊN và phải mang token của phiên. Token
             * do supervisor sinh và truyền qua môi trường: một tiến trình khác
             * cắm được vào ống cũng không đoán được nó. */
            if (command != "HELLO") {
                write_line(failure(command_id, core::programming::sim::kErrProtocol,
                                   "lệnh đầu tiên phải là HELLO"));
                return 2;
            }
            if (request.value("token", std::string()) != expected_token ||
                expected_token.empty()) {
                write_line(failure(command_id, core::programming::sim::kErrProtocol,
                                   "token phiên không khớp"));
                return 2;
            }
            if (request.value("protocolVersion", 0) != kProtocolVersion) {
                write_line(failure(command_id, core::programming::sim::kErrProtocol,
                                   "protocol version không khớp"));
                return 2;
            }
            greeted = true;
            write_line(json{{"ok", true},
                            {"commandId", command_id},
                            {"workerVersion", kWorkerVersion},
                            {"protocolVersion", kProtocolVersion},
                            {"profileCode", core::st_profile_generated::kProfileCode},
                            {"targetAbi", core::st_profile_generated::kTargetAbi}});
            continue;
        }

        if (command == "PREPARE") {
            const uint64_t declared = request.value("artifactBytes", static_cast<uint64_t>(0));
            if (declared == 0 || declared > kMaxArtifactBytes) {
                write_line(failure(command_id, core::programming::sim::kErrLimit,
                                   "artifactBytes ngoài biên"));
                return 2;
            }
            std::vector<uint8_t> artifact;
            if (!reader.read_exact(static_cast<std::size_t>(declared), &artifact)) {
                write_line(failure(command_id, core::programming::sim::kErrProtocol,
                                   "thiếu byte artifact đã khai"));
                return 2;
            }
            const char* error_code = nullptr;
            std::string detail;
            if (!session.prepare(artifact, core::st_profile_generated::kProfileCode,
                                 core::st_profile_generated::kTargetAbi, &error_code, &detail)) {
                write_line(failure(command_id, error_code, detail));
                continue;
            }
            json response = encode_manifest(session);
            response["ok"] = true;
            response["commandId"] = command_id;
            response["virtualTimeMs"] = session.virtual_time_ms();
            response["snapshotSequence"] = session.snapshot_sequence();
            write_line(response);
            continue;
        }

        if (command == "SET_INPUT") {
            const std::string observation_id = request.value("observationId", std::string());
            const std::string declared_type = request.value("dataType", std::string());
            core::StValue value;
            if (!request.contains("value") ||
                !decode_value(request.at("value"), declared_type, &value)) {
                write_line(failure(command_id, core::programming::sim::kErrInputValue,
                                   "giá trị không khớp kiểu đã khai"));
                continue;
            }
            const char* error_code = nullptr;
            if (!session.set_input(observation_id, value, &error_code)) {
                write_line(failure(command_id, error_code, observation_id));
                continue;
            }
            write_line(json{{"ok", true},
                            {"commandId", command_id},
                            {"observationId", observation_id},
                            {"snapshotSequence", session.snapshot_sequence()}});
            continue;
        }

        if (command == "STEP") {
            const char* error_code = nullptr;
            std::string detail;
            if (!session.step(&error_code, &detail)) {
                write_line(failure(command_id, error_code, detail));
                continue;
            }
            write_line(json{{"ok", true},
                            {"commandId", command_id},
                            {"virtualTimeMs", session.virtual_time_ms()},
                            {"snapshotSequence", session.snapshot_sequence()},
                            {"resetEpoch", session.reset_epoch()},
                            {"observations", encode_observations(session.observations())}});
            continue;
        }

        if (command == "RESET") {
            const char* error_code = nullptr;
            std::string detail;
            if (!session.reset(&error_code, &detail)) {
                write_line(failure(command_id, error_code, detail));
                continue;
            }
            write_line(json{{"ok", true},
                            {"commandId", command_id},
                            {"virtualTimeMs", session.virtual_time_ms()},
                            {"snapshotSequence", session.snapshot_sequence()},
                            {"resetEpoch", session.reset_epoch()},
                            {"observations", encode_observations(session.observations())}});
            continue;
        }

        if (command == "READ") {
            write_line(json{{"ok", true},
                            {"commandId", command_id},
                            {"virtualTimeMs", session.virtual_time_ms()},
                            {"snapshotSequence", session.snapshot_sequence()},
                            {"resetEpoch", session.reset_epoch()},
                            {"observations", encode_observations(session.observations())}});
            continue;
        }

        if (command == "TRACE") {
            const uint64_t cursor = request.value("cursor", static_cast<uint64_t>(0));
            uint64_t limit = request.value("limit", static_cast<uint64_t>(256));
            if (limit == 0 || limit > 1024) limit = 1024;
            json samples = json::array();
            const auto& all = session.trace();
            for (uint64_t index = cursor; index < all.size() && samples.size() < limit; ++index) {
                json values = json::array();
                for (const core::StValue& value : all[index].values) {
                    values.push_back(encode_value(value));
                }
                samples.push_back(json{{"virtualTimeMs", all[index].virtual_time_ms},
                                       {"snapshotSequence", all[index].snapshot_sequence},
                                       {"values", values}});
            }
            write_line(json{{"ok", true},
                            {"commandId", command_id},
                            {"samples", samples},
                            {"nextCursor", cursor + samples.size()},
                            {"total", all.size()},
                            {"dropped", session.trace_dropped()}});
            continue;
        }

        if (command == "STOP") {
            write_line(json{{"ok", true}, {"commandId", command_id}, {"stopped", true}});
            return 0;
        }

        write_line(failure(command_id, core::programming::sim::kErrCommandState,
                           "lệnh không được hỗ trợ: " + command));
    }
    /* Ống đóng mà chưa có `STOP`: supervisor đã biến mất. Thoát ngay thay vì
     * sống mồ côi — một worker không còn ai giám sát là đúng thứ mà quota/TTL
     * không còn với tới được. */
    return greeted ? 0 : 2;
}

} // namespace

int main(int argc, char** argv)
{
    bool probe_mode = false;
    std::vector<std::string> trusted_key_paths;
    for (int index = 1; index < argc; ++index) {
        const std::string argument = argv[index];
        if (argument == "--sandbox-probe") probe_mode = true;
        else if (argument == "--st-trusted-key" && index + 1 < argc) {
            trusted_key_paths.push_back(argv[++index]);
        } else if (argument == "--version") {
            std::printf("%s\n", kWorkerVersion);
            return 0;
        } else if (argument == "--provenance") {
            /* T63-002: `artifact_manifest.py` lấy commit từ chính binary. Không
             * dòng nào dùng `MKDDC_GIT_COMMIT` thì compiler bỏ chuỗi và
             * `record`/`deploy-record` từ chối worker. Cờ riêng, vì `--version`
             * là `workerVersion` mà web đọc — đổi định dạng của nó là đổi hợp đồng. */
            std::printf("version=%s git_commit=%s build_time=%s toolchain=%s\n",
                        MKDDC_BUILD_VERSION, MKDDC_GIT_COMMIT, MKDDC_BUILD_TIME, MKDDC_TOOLCHAIN);
            return 0;
        }
    }

    /* `sodium_init()` TRƯỚC hàng rào: nó có thể thăm dò nguồn ngẫu nhiên của hệ
     * thống, và sau khi seccomp đã cấm `openat` thì lần thăm dò đó thất bại. */
    if (sodium_init() < 0) {
        write_line(json{{"ok", false},
                        {"errorCode", core::programming::sim::kErrProtocol},
                        {"detail", "sodium_init thất bại"}});
        return 2;
    }

    if (probe_mode) return run_sandbox_probe();

    const char* token = ::getenv("MKDDC_SIM_SESSION_TOKEN");
    const std::string expected_token = token != nullptr ? token : "";
    /* Xoá token khỏi môi trường trước khi làm bất cứ việc gì khác: môi trường
     * của tiến trình đọc được từ ngoài, và một token còn nằm đó là một token
     * đã hết bí mật. */
    ::unsetenv("MKDDC_SIM_SESSION_TOKEN");

    /* Đọc khoá tin cậy TRƯỚC hàng rào: sau khi seccomp cấm `openat`, worker
     * không mở được file nào nữa. Đây cũng là lý do khoá đi bằng ĐƯỜNG DẪN ở
     * dòng lệnh chứ không bằng một lệnh giao thức — lệnh tới sau hàng rào.
     *
     * Tập khoá này phải TRÙNG với tập Core đang dùng. Worker chỉ tin khoá nhúng
     * lúc build sẽ từ chối mọi artifact ký bằng khoá THIẾT BỊ, tức mô phỏng
     * không bao giờ chạy được trên một bo thật. */
    core::StLoaderOptions loader_options;
    std::vector<std::array<uint8_t, 32>> trusted_keys;
    for (const std::string& path : trusted_key_paths) {
        std::ifstream key_file(path);
        std::string hex;
        if (!key_file || !(key_file >> hex) || hex.size() != 64) {
            write_line(json{{"ok", false},
                            {"errorCode", core::programming::sim::kErrProtocol},
                            {"detail", "khoá tin cậy không đọc được hoặc sai độ dài"}});
            return 2;
        }
        std::array<uint8_t, 32> key{};
        for (std::size_t byte = 0; byte < 32; ++byte) {
            key[byte] = static_cast<uint8_t>(std::stoul(hex.substr(byte * 2, 2), nullptr, 16));
        }
        trusted_keys.push_back(key);
    }
    if (!trusted_keys.empty()) {
        if (trusted_keys.size() > core::kMaxTrustedKeys) {
            write_line(json{{"ok", false},
                            {"errorCode", core::programming::sim::kErrLimit},
                            {"detail", "vượt số khoá tin cậy tối đa"}});
            return 2;
        }
        for (std::size_t index = 0; index < trusted_keys.size(); ++index) {
            loader_options.trusted_keys[index] = trusted_keys[index].data();
        }
        loader_options.trusted_key_count = trusted_keys.size();
    }

    core::programming::sim::SandboxReport report;
    std::string sandbox_error;
    if (!core::programming::sim::apply_sandbox(kAddressSpaceBytes, &report, &sandbox_error)) {
        write_line(json{{"ok", false},
                        {"errorCode", core::programming::sim::kErrProtocol},
                        {"detail", "không dựng được hàng rào: " + sandbox_error}});
        return 2;
    }

    return run_protocol_loop(expected_token, loader_options);
}
