/* `ISS-STED-13` / `F-STED-011` — CORPUS VĂN PHẠM DÙNG CHUNG.
 *
 * FE có BA bộ đọc ST độc lập với compiler (tô màu, chỉ mục ký hiệu, và một
 * parser đầy đủ 1.181 dòng cho nút Định dạng). Chống trôi trước đây chỉ phủ
 * DANH SÁCH TỪ KHOÁ; văn phạm, hệ kiểu và quy tắc scope không có gì canh.
 *
 * Tệp này là một nửa của cổng: nó đòi compiler chấp nhận/từ chối đúng như
 * corpus nói. Nửa kia (`stGrammarCorpus.test.ts`) đòi formatter của FE cũng
 * vậy. Thêm một luật văn phạm mà chỉ sửa một bên sẽ làm ĐỎ ở bên kia — đó là
 * toàn bộ giá trị của việc hai phía đọc CÙNG một tệp.
 */

#include <fstream>
#include <sstream>
#include <string>

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

#include "st/st_diagnostic.hpp"
#include "st/st_parser.hpp"
#include "st/st_program.hpp"

namespace core {
namespace {

nlohmann::json load_corpus()
{
    const std::string path =
        std::string(PROGRAMMING_PROFILE_CONTRACT_DIR) + "/st_grammar_corpus_v1.json";
    std::ifstream input(path);
    EXPECT_TRUE(input.good()) << "không mở được corpus: " << path;
    std::stringstream buffer;
    buffer << input.rdbuf();
    return nlohmann::json::parse(buffer.str());
}

} // namespace

TEST(StGrammarCorpus, CorpusIsNonEmptyAndCoversBothVerdicts)
{
    const nlohmann::json corpus = load_corpus();
    ASSERT_TRUE(corpus.contains("vectors"));
    const nlohmann::json& vectors = corpus["vectors"];
    ASSERT_GE(vectors.size(), 10u);

    /* Corpus chỉ toàn ca ĐƯỢC CHẤP NHẬN là một corpus không kiểm được điều
     * quan trọng nhất: cấu trúc ngoài subset phải bị TỪ CHỐI. Một cổng chỉ
     * nhìn một chiều sẽ xanh cả khi compiler nuốt mọi thứ. */
    std::size_t accepted = 0;
    std::size_t rejected = 0;
    for (const nlohmann::json& vector : vectors)
        (vector.at("accepted").get<bool>() ? accepted : rejected) += 1;
    EXPECT_GE(accepted, 5u);
    EXPECT_GE(rejected, 5u);
}

TEST(StGrammarCorpus, EveryVectorMatchesCompilerVerdict)
{
    const nlohmann::json corpus = load_corpus();
    for (const nlohmann::json& vector : corpus["vectors"]) {
        const std::string id = vector.at("id").get<std::string>();
        const std::string source = vector.at("source").get<std::string>();
        const bool expected = vector.at("accepted").get<bool>();

        StProgram program;
        StDiagnostic diagnostic;
        const bool actual = parse_st_program(source, &program, &diagnostic);

        if (expected) {
            EXPECT_TRUE(actual) << "vector '" << id << "' đáng lẽ hợp lệ nhưng compiler từ chối: "
                                << diagnostic.code << " — " << diagnostic.message;
        } else {
            EXPECT_FALSE(actual) << "vector '" << id
                                 << "' đáng lẽ NGOÀI subset nhưng compiler chấp nhận. "
                                    "Hoặc corpus sai, hoặc subset vừa mở rộng mà chưa ai công bố.";
        }
    }
}

/* Mã lỗi được ghi trong corpus phải là mã THẬT compiler phát ra, không phải mã
 * minh hoạ. Một corpus ghi mã sai dạy người đọc `grep` nhầm chỗ — đúng chế độ
 * hỏng mà `ISS-STED-10` vừa đóng ở tài liệu thiết kế. */
TEST(StGrammarCorpus, RejectedVectorsCarryTheRealDiagnosticCode)
{
    const nlohmann::json corpus = load_corpus();
    for (const nlohmann::json& vector : corpus["vectors"]) {
        if (vector.at("accepted").get<bool>()) continue;
        if (!vector.contains("rejectedWith")) continue;
        const std::string id = vector.at("id").get<std::string>();
        const std::string expected_code = vector.at("rejectedWith").get<std::string>();

        StProgram program;
        StDiagnostic diagnostic;
        ASSERT_FALSE(parse_st_program(vector.at("source").get<std::string>(), &program, &diagnostic))
            << "vector '" << id << "'";
        EXPECT_EQ(std::string(diagnostic.code), expected_code)
            << "vector '" << id << "' ghi mã " << expected_code << " nhưng compiler phát "
            << diagnostic.code;
    }
}

} // namespace core
