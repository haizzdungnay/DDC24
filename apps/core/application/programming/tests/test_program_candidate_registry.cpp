/**
 * @file  test_program_candidate_registry.cpp
 * @brief T59-406 — sổ candidate, rút theo lý do, và đường rơi về sau khi rút.
 *
 *        Chuỗi output của kiến trúc §7:
 *          Program candidate → owner registry → PriorityResolver → Interlock
 *          → SafeState → OutputWriter.
 *
 *        Test này khoá hai đầu của mắt xích giữa: sổ trả lời đúng "ai đang giữ
 *        điểm nào và vì sao không còn giữ", và khi candidate bị rút thì trọng
 *        tài rơi về ĐÚNG mức tiếp theo — không kẹt ở giá trị cuối của Program
 *        đã chết.
 */
#include <gtest/gtest.h>

#include <string>

#include <fstream>
#include <regex>
#include <sstream>
#include <vector>

#include "priority/priority_resolver.hpp"
#include "programming/program_candidate_registry.hpp"
#include "st/st_compile.hpp"
#include "st/st_ir.hpp"
#include "st/st_process_image.hpp"
#include "st/st_scheduler.hpp"
#include "st/st_test_key.hpp"

namespace core {
namespace {

using programming::CandidateWithdrawReason;
using programming::ProgramCandidateRegistry;

} // namespace

/* Một output vật lý có TỐI ĐA một Program owner (DDD §4.6). Check đã ép ở lớp
 * trước, nhưng gói có thể tới từ bundle import hoặc writer khác phiên bản —
 * runtime không được tin lớp trước ở một bất biến an toàn. */
TEST(ProgramCandidateRegistry, SecondProgramCannotClaimSamePoint)
{
    ProgramCandidateRegistry registry;
    std::string error;
    ASSERT_TRUE(registry.claim("P_ahu", PointKind::AO, 3, 1, &error)) << error;
    EXPECT_FALSE(registry.claim("P_boiler", PointKind::AO, 3, 1, &error));
    EXPECT_NE(error.find("P_ahu"), std::string::npos) << error;
    EXPECT_EQ(registry.owner_of(PointKind::AO, 3), "P_ahu");

    /* Điểm khác thì không liên quan: bất biến là "một ĐIỂM một owner", không
     * phải "một Program một điểm". */
    EXPECT_TRUE(registry.claim("P_boiler", PointKind::AO, 4, 1, &error)) << error;
    EXPECT_TRUE(registry.claim("P_ahu", PointKind::BO, 3, 1, &error)) << error;
    EXPECT_EQ(registry.active_count(), 3u);
}

/* Rút phải mang LÝ DO. "Đã rút" mà không nói vì sao buộc người vận hành đoán
 * giữa một lệnh chủ ý và một sự cố — hai thứ cần hai phản ứng khác nhau. */
TEST(ProgramCandidateRegistry, WithdrawRecordsReasonAndKeepsHistory)
{
    ProgramCandidateRegistry registry;
    std::string error;
    ASSERT_TRUE(registry.claim("P_ahu", PointKind::AO, 3, 10, &error)) << error;
    ASSERT_TRUE(registry.claim("P_ahu", PointKind::BO, 1, 10, &error)) << error;
    ASSERT_TRUE(registry.claim("P_boiler", PointKind::AO, 4, 10, &error)) << error;

    EXPECT_EQ(registry.withdraw_instance("P_ahu", CandidateWithdrawReason::OPERATOR_DISABLE, 20), 2u);
    EXPECT_EQ(registry.active_count(), 1u);
    /* Bản ghi KHÔNG bị xoá: câu hỏi "vì sao van này về default" phải còn câu
     * trả lời đúng vào lúc cần nó nhất. */
    const auto* claim = registry.find(PointKind::AO, 3);
    ASSERT_NE(claim, nullptr);
    EXPECT_FALSE(claim->active);
    EXPECT_EQ(claim->withdraw_reason, CandidateWithdrawReason::OPERATOR_DISABLE);
    EXPECT_EQ(claim->generation, 20u);
    /* `owner_of` trả rỗng cho claim đã rút: nó trả lời "AI ĐANG giữ", không
     * phải "ai đã từng giữ". */
    EXPECT_EQ(registry.owner_of(PointKind::AO, 3), "");
    /* Program khác không bị lây. */
    EXPECT_EQ(registry.owner_of(PointKind::AO, 4), "P_boiler");
}

/* Cùng Program claim lại sau khi bị rút = hồi phục, không phải xung đột. */
TEST(ProgramCandidateRegistry, SameProgramMayReclaimAfterWithdraw)
{
    ProgramCandidateRegistry registry;
    std::string error;
    ASSERT_TRUE(registry.claim("P_ahu", PointKind::AO, 3, 10, &error)) << error;
    registry.withdraw_instance("P_ahu", CandidateWithdrawReason::FAULT_TTL_EXPIRED, 20);
    EXPECT_EQ(registry.owner_of(PointKind::AO, 3), "");

    ASSERT_TRUE(registry.claim("P_ahu", PointKind::AO, 3, 30, &error)) << error;
    EXPECT_EQ(registry.owner_of(PointKind::AO, 3), "P_ahu");
    const auto* claim = registry.find(PointKind::AO, 3);
    ASSERT_NE(claim, nullptr);
    EXPECT_EQ(claim->withdraw_reason, CandidateWithdrawReason::NONE);
    /* Nhưng Program KHÁC vẫn không được chiếm chỗ đã rút: quyền sở hữu thuộc
     * package, không thuộc thứ tự tới trước. */
    ASSERT_TRUE(registry.claim("P_ahu", PointKind::AO, 5, 30, &error)) << error;
    registry.withdraw_instance("P_ahu", CandidateWithdrawReason::OPERATOR_DISABLE, 31);
    EXPECT_FALSE(registry.claim("P_boiler", PointKind::AO, 5, 32, &error));
}

/* Nạp package mới xoá sạch sổ. Giữ claim của gói cũ nghĩa là trả lời SAI câu
 * "ai đang giữ điểm này". */
TEST(ProgramCandidateRegistry, ClearDropsPreviousPackageOwnership)
{
    ProgramCandidateRegistry registry;
    std::string error;
    ASSERT_TRUE(registry.claim("P_old", PointKind::AO, 3, 1, &error)) << error;
    registry.clear();
    EXPECT_EQ(registry.size(), 0u);
    EXPECT_EQ(registry.owner_of(PointKind::AO, 3), "");
    EXPECT_TRUE(registry.claim("P_new", PointKind::AO, 3, 2, &error)) << error;
    EXPECT_EQ(registry.owner_of(PointKind::AO, 3), "P_new");
}

/* Đường rơi về sau khi rút: mức 5 nhả thì trọng tài chọn mức tiếp theo đang
 * active; không còn mức nào thì về DEFAULT (mức 6). Đây là điều làm cho việc
 * rút candidate có nghĩa — rút mà đầu ra kẹt ở giá trị cuối của Program đã chết
 * thì rút chỉ là một dòng log. */
TEST(ProgramCandidateRegistry, WithdrawnCandidateFallsThroughToNextPriority)
{
    PriorityResolver resolver;
    resolver.set_default_ao(3, 0.0f);
    resolver.set_default_do(1, false);

    /* Giá trị nằm trong dải điện của mode 0-10V: resolver từ chối lệnh sai đơn
     * vị, và một test dùng số ngoài dải sẽ đo nhầm phép từ chối đó thành lỗi
     * trọng tài. */
    ASSERT_TRUE(resolver.set_ao(PRIO_SCHEDULE, 3, 4.0f));
    ASSERT_TRUE(resolver.set_ao(PRIO_LOCAL_LOGIC, 3, 8.0f));
    ASSERT_TRUE(resolver.set_do(PRIO_LOCAL_LOGIC, 1, true));

    /* Mức cao hơn (số nhỏ hơn) thắng: SCHEDULE=4 thắng LOCAL_LOGIC=5. */
    OutputCmd resolved = resolver.resolve();
    EXPECT_TRUE(resolved.ao_valid[3]);
    EXPECT_FLOAT_EQ(resolved.ao[3], 4.0f);
    EXPECT_TRUE(resolved.do_valid[1]);
    EXPECT_TRUE(resolved.dout[1]);

    /* Rút mức 4: rơi xuống mức 5 của Program. */
    ASSERT_TRUE(resolver.release_ao(PRIO_SCHEDULE, 3));
    resolved = resolver.resolve();
    EXPECT_FLOAT_EQ(resolved.ao[3], 8.0f);

    /* Rút nốt mức 5: về DEFAULT, KHÔNG kẹt ở 80. */
    ASSERT_TRUE(resolver.release_ao(PRIO_LOCAL_LOGIC, 3));
    ASSERT_TRUE(resolver.release_do(PRIO_LOCAL_LOGIC, 1));
    resolved = resolver.resolve();
    EXPECT_FLOAT_EQ(resolved.ao[3], 0.0f) << "đầu ra kẹt ở giá trị của Program đã bị rút";
    EXPECT_FALSE(resolved.dout[1]);
}

namespace {

std::vector<uint8_t> program_with_output(const std::string& name, int channel)
{
    std::ostringstream source;
    source << "PROGRAM " << name << "\n"
           << "VAR_OUTPUT cmd : REAL; END_VAR\n"
           << "  cmd := 5.0;\n"
           << "END_PROGRAM\n";
    StIrModule module;
    StDiagnostic diagnostic;
    EXPECT_TRUE(compile_st_source(source.str(), &module, &diagnostic))
        << diagnostic.code << ": " << diagnostic.message;
    /* Gắn binding output AO thủ công: nguồn ST không khai binding, đó là dữ liệu
     * của io_map chứ không của ngôn ngữ. */
    StIrIoBinding binding;
    binding.slot = 0;
    binding.is_output = true;
    binding.point_kind = StPointKind::AO;
    binding.point_index = static_cast<uint16_t>(channel + 1); /* 1-based */
    binding.type = StType::REAL;
    binding.scale_min = 0.0f;
    binding.scale_max = 10.0f;
    module.io_bindings.push_back(binding);
    std::vector<uint8_t> bytes;
    std::string error;
    EXPECT_TRUE(serialize_st_ir(module, &bytes, &error)) << error;
    EXPECT_TRUE(sign_st_artifact(&bytes, st_test_secret_key()));
    return bytes;
}

} // namespace

/* Đường đầy đủ: Program chạy → sổ ghi owner → operator Disable → candidate bị
 * rút kèm LÝ DO → trọng tài rơi về default. Đây là điều làm cho cả chuỗi có
 * nghĩa; thiếu bất kỳ mắt xích nào thì van kẹt ở giá trị cuối của Program đã
 * dừng. */
TEST(ProgramCandidateRegistry, DisableWithdrawsCandidateAndOutputFallsToDefault)
{
    StScheduler scheduler(StSchedulerProfile::REV_A);
    std::string error;
    StTaskConfig task;
    task.id = "main";
    task.period_ms = 1000;
    task.budget_ms = 199;
    ASSERT_TRUE(scheduler.add_task(task, &error)) << error;
    ASSERT_TRUE(scheduler.add_program("main", "P_ahu", 0, &error)) << error;
    ASSERT_TRUE(scheduler.request_activation("P_ahu", program_with_output("Ahu", 2), &error)) << error;
    scheduler.tick(0);
    ASSERT_TRUE(scheduler.start("P_ahu", &error)) << error;

    PriorityResolver resolver;
    resolver.set_default_ao(2, 0.0f);
    ProgramCandidateRegistry registry;
    ASSERT_TRUE(st_register_instance_candidates(*scheduler.find_program("P_ahu"), &registry,
                                                scheduler.base_step_count(), &error)) << error;
    EXPECT_EQ(registry.owner_of(PointKind::AO, 2), "P_ahu");

    PointTable table;
    StIoBridgeStats stats;
    scheduler.tick(1000ULL * 1000000ULL);
    ASSERT_TRUE(st_apply_all_outputs(&scheduler, &resolver, &table, &stats));
    OutputCmd resolved = resolver.resolve();
    EXPECT_TRUE(resolved.ao_valid[2]);
    EXPECT_FLOAT_EQ(resolved.ao[2], 5.0f);

    /* Operator dừng Program: rút NGAY tại safe boundary, không chờ TTL. */
    ASSERT_TRUE(scheduler.stop("P_ahu", &error)) << error;
    EXPECT_EQ(st_withdraw_stale_outputs(&scheduler, &resolver, 0, &registry, &stats), 1u);

    const auto* claim = registry.find(PointKind::AO, 2);
    ASSERT_NE(claim, nullptr);
    EXPECT_FALSE(claim->active);
    EXPECT_EQ(claim->withdraw_reason, CandidateWithdrawReason::OPERATOR_DISABLE);

    resolved = resolver.resolve();
    EXPECT_FLOAT_EQ(resolved.ao[2], 0.0f)
        << "đầu ra kẹt ở giá trị cuối của Program đã dừng";
}

/* Không có đường Program → SHM/IOP/MCU trực tiếp (kiến trúc §7). Kiểm bằng cách
 * đọc CHÍNH mã nguồn của lớp process image: mọi đường ra AO/DO phải đi qua
 * `PriorityResolver`. Một test hành vi không chứng minh được điều này — nó chỉ
 * chứng minh đường hợp lệ chạy đúng, không chứng minh KHÔNG CÓ đường thứ hai. */
TEST(ProgramCandidateRegistry, NoDirectPathFromProgramToIoLayer)
{
    std::ifstream source(std::string(CORE_SOURCE_DIR) + "/application/st/st_process_image.cpp");
    ASSERT_TRUE(source.good()) << "không đọc được st_process_image.cpp";
    std::stringstream buffer;
    buffer << source.rdbuf();
    const std::string text = buffer.str();

    /* Ba tên này là cửa đi thẳng xuống lớp I/O, bỏ qua trọng tài. */
    for (const char* forbidden : {"plc_shm", "iop_write", "shm_write", "->ao[", "->dout["}) {
        EXPECT_EQ(text.find(forbidden), std::string::npos)
            << "lớp process image chạm thẳng lớp I/O qua '" << forbidden << "'";
    }
    /* Và đường hợp lệ phải THỰC SỰ có mặt — nếu không, test trên chỉ đang xác
     * nhận một file rỗng. */
    EXPECT_NE(text.find("PRIO_LOCAL_LOGIC"), std::string::npos);
    EXPECT_NE(text.find("resolver"), std::string::npos);
}

} // namespace core
