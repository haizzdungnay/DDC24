/**
 * @file  fuzz_st_parser.cpp
 * @brief Fuzz harness cho đường source ST: lexer -> parser -> semantic.
 *
 *        Đây là bề mặt nhận input từ ngoài của FW SOM (BE gửi source lên).
 *        Bất biến kiểm ở đây: với BẤT KỲ chuỗi byte nào, `parse_st_program`
 *        và `typecheck_st_program` phải kết thúc có kiểm soát — không crash,
 *        không tràn stack, không đọc ngoài biên, không treo.
 *
 *        Lỗi F-01 (tràn stack với biểu thức lồng sâu) đúng là loại lỗi mà
 *        harness này sinh ra để bắt.
 *
 *        VỀ CHỮ KÝ (`T59-607`) — vì sao harness phải KÝ trước khi nạp:
 *        `serialize_st_ir` trả về artifact CHƯA ký; từ khi loader bắt buộc chữ
 *        ký (`IR-E-007`), "biên dịch được ⇒ nạp được" không còn là bất biến
 *        đúng, mà "biên dịch được ⇒ ký được ⇒ nạp được" mới là. Harness cũ giữ
 *        mệnh đề cũ nên trap ngay ở file seed ĐẦU TIÊN: job fuzz đỏ ở giây 0 và
 *        chưa từng fuzz được byte nào. Ở đây tách làm hai bất biến — artifact
 *        chưa ký PHẢI bị từ chối, artifact đã ký PHẢI nạp được — nên cả hai
 *        chiều của chính sách toàn vẹn đều có người canh.
 */
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "st/st_compile.hpp"
#include "st/st_ir.hpp"
#include "st/st_loader.hpp"
#include "st/st_limits.hpp"

namespace {

/* Khoá ký dùng chung cho cả tiến trình fuzz. Sinh một lần: `crypto_sign_keypair`
 * đắt hơn nhiều so với một vòng parse, sinh lại mỗi input sẽ biến harness thành
 * bài đo tốc độ libsodium chứ không phải bài đo parser. */
struct FuzzSigningKey {
    uint8_t public_key[32] = {0};
    uint8_t secret_key[64] = {0};
    bool    ready = false;

    FuzzSigningKey() { ready = core::generate_signing_keypair(public_key, secret_key); }
};

const FuzzSigningKey& signing_key()
{
    static const FuzzSigningKey key;
    return key;
}

}  // namespace

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size)
{
    const std::string source(reinterpret_cast<const char*>(data), size);

    core::StIrModule module;
    core::StDiagnostic diag;
    if (core::compile_st_source(source, &module, &diag)) {
        std::vector<uint8_t> artifact;
        std::string error;
        if (core::serialize_st_ir(module, &artifact, &error)) {
            core::StLoaderOptions options;

            /* Bất biến 1 — artifact CHƯA ký không được nạp khi profile đòi chữ
             * ký, và phải bị từ chối bằng đúng mã `IR-E-007`. Một artifact chưa
             * ký lọt qua là lỗ hổng chuỗi cung ứng, không phải sai sót nhỏ. */
            if (options.integrity_mode == core::StIntegrityMode::SIGNATURE_REQUIRED) {
                core::StLoadedProgram unsigned_loaded;
                core::StLoadError unsigned_error;
                if (core::load_st_artifact(artifact.data(), artifact.size(), options,
                                           &unsigned_loaded, &unsigned_error))
                    __builtin_trap();
                if (unsigned_error.code != core::st_ir_error::kMissingSignature) __builtin_trap();
            }

            /* Bất biến 2 — vòng khứ hồi thật: compile -> serialize -> sign ->
             * load phải đi trọn. Đây là mệnh đề mà dòng trap cũ định kiểm. */
            const FuzzSigningKey& key = signing_key();
            if (key.ready) {
                std::vector<uint8_t> signed_artifact = artifact;
                if (!core::sign_st_artifact(&signed_artifact, key.secret_key)) __builtin_trap();

                options.public_key = key.public_key;
                core::StLoadedProgram loaded;
                core::StLoadError load_error;
                if (!core::load_st_artifact(signed_artifact.data(), signed_artifact.size(),
                                            options, &loaded, &load_error))
                    __builtin_trap();
            }
        } else if (error.empty()) {
            __builtin_trap();
        }
    } else {
        /* Thất bại thì phải luôn có mã chẩn đoán ổn định. Đây là hợp đồng với
         * BE: không có đường thoát nào trả false mà không nói vì sao. */
        if (diag.code.empty()) __builtin_trap();
    }
    return 0;
}
