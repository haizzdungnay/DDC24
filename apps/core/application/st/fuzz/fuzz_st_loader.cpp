/**
 * @file  fuzz_st_loader.cpp
 * @brief Fuzz harness cho artifact loader.
 *
 *        Đây là harness QUAN TRỌNG NHẤT của dự án. Theo
 *        TYPED_IR_ARTIFACT_SPEC §6.1, sau khi load thành công executor KHÔNG
 *        kiểm biên nữa — mọi slot, đích nhảy và chỉ số FB đã được loader
 *        chứng minh nằm trong biên. Nghĩa là một lỗi lọt qua loader không
 *        phải lỗi logic mà là lỗi AN TOÀN BỘ NHỚ.
 *
 *        Bất biến kiểm: với bất kỳ chuỗi byte nào, `load_st_artifact` hoặc
 *        từ chối có mã lỗi, hoặc trả về một chương trình mà `execute` chạy
 *        được an toàn.
 */
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

#include "st/st_exec.hpp"
#include "st/st_ir.hpp"
#include "st/st_loader.hpp"

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size)
{
    /* VÁ LẠI SHA-256 TRƯỚC KHI LOAD — bước này quyết định harness có giá trị
     * hay không.
     *
     * Đo thực nghiệm trên 1000 đột biến ngẫu nhiên của một artifact hợp lệ:
     *   IR-E-005 (sai hash)  947
     *   mọi mã còn lại        53
     * Nghĩa là nếu không vá hash, ~95% input chết ở bước 7 và fuzzer KHÔNG BAO
     * GIỜ chạm tới bảng section, bảng biến hay luồng lệnh — đúng phần mà một
     * lỗi kiểm thiếu sẽ thành truy cập ngoài biên. Chạy 8 triệu lần như vậy
     * chỉ chứng minh "SHA-256 hoạt động", điều đã biết.
     *
     * Vá hash KHÔNG làm yếu kiểm thử: tính toàn vẹn đã có test riêng
     * (StIr.RejectModifiedPayloadByHash, SingleBitFlipAlwaysRejected). Ở đây
     * ta cố ý bỏ qua nó để fuzz phần LOGIC PHÂN TÍCH bên trong. */
    std::vector<uint8_t> buf(data, data + size);
    if (buf.size() >= 128) {
        /* THỨ TỰ QUAN TRỌNG: xoá cờ kSigned TRƯỚC, rồi mới tính hash.
         * Bỏ bước xoá cờ thì loader vẫn cố verify chữ ký (đã bị zero) và
         * 947/1000 input chết ở IR-E-006 — nghẽn chỉ dịch từ hash sang chữ ký
         * chứ không mở ra. Cờ nằm ở offset 26-27 và TRONG vùng được hash, nên
         * phải sửa trước khi tính digest. */
        buf[26] = static_cast<uint8_t>(buf[26] & ~core::st_ir::kFlagSigned);
        std::memset(buf.data() + 32, 0, 32);   /* xoá trường hash */
        std::memset(buf.data() + 64, 0, 64);   /* xoá chữ ký */
        uint8_t digest[32];
        if (core::compute_artifact_sha256(buf.data(), buf.size(), digest))
            std::memcpy(buf.data() + 32, digest, 32);
    }
    data = buf.data();
    size = buf.size();

    core::StLoadedProgram prog;
    core::StLoadError err;
    core::StLoaderOptions opts;
    /* Bỏ qua chữ ký: mục tiêu là fuzz LOGIC PHÂN TÍCH CẤU TRÚC. Nếu bắt buộc
     * ký, gần như mọi input ngẫu nhiên đều dừng ở bước verify chữ ký và fuzzer
     * không bao giờ chạm tới bảng section, bảng biến hay luồng lệnh — tức là
     * không fuzz được đúng phần nguy hiểm. */
    opts.integrity_mode = core::StIntegrityMode::HASH_ONLY;

    if (!core::load_st_artifact(data, size, opts, &prog, &err)) {
        /* Từ chối thì phải có mã ổn định — BE dựa vào mã này để xử lý. */
        if (err.code.empty()) __builtin_trap();
        return 0;
    }

    /* Load thành công: executor tin tuyệt đối vào loader, nên đây là chỗ lỗi
     * kiểm thiếu của loader sẽ biến thành truy cập ngoài biên. Chạy vài chu kỳ
     * để chạm được cả nhánh FB có trạng thái. */
    core::StExecFault fault;
    for (int i = 0; i < 4; i++)
        core::execute_st_program(&prog, static_cast<int64_t>(i) * 1000000000LL, &fault);
    return 0;
}
