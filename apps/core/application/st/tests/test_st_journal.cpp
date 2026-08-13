/**
 * @file  test_st_journal.cpp
 * @brief TASK-PROG-400 — journal bền vững safe-boundary theo
 *        DDD-LIFE-PROG-001 §7: append/checksum, đọc lại "bản ghi hợp lệ cuối
 *        cùng" kể cả khi đuôi file bị cắt cụt (mất điện giữa lúc ghi), và
 *        bảng quyết định phục hồi 5 dòng.
 */
#include <gtest/gtest.h>

#include <fstream>
#include <string>
#include <vector>

#include <unistd.h>

#include "st/st_journal.hpp"

namespace core {
namespace {

std::string temp_path()
{
    char buf[] = "/tmp/mkddc-journal-test-XXXXXX";
    const int fd = ::mkstemp(buf);
    if (fd >= 0) ::close(fd);
    ::unlink(buf); /* chỉ mượn tên; file do StJournal tạo */
    return buf;
}

StJournalRecord make_record(StJournalPhase phase, const std::string& op)
{
    StJournalRecord r;
    r.phase = phase;
    r.timestamp_ns = 123456789;
    r.operation_id = op;
    r.old_active_hash = "aaaa";
    r.candidate_hash = "bbbb";
    r.plan_hash = "cccc";
    return r;
}

} // namespace

TEST(StJournal, EmptyFileGivesEmptyStatusAndKeepOldActiveAction)
{
    StJournal j(temp_path());
    const StJournalReadResult r = j.read_last();
    EXPECT_EQ(r.status, StJournalReadStatus::EMPTY);
    EXPECT_EQ(st_journal_decide_boot_action(r), StJournalBootAction::KEEP_OLD_ACTIVE_DISCARD_CANDIDATE);
}

TEST(StJournal, AppendThenReadRoundTrips)
{
    const std::string path = temp_path();
    StJournal j(path);
    ASSERT_TRUE(j.append(make_record(StJournalPhase::PREPARED, "op-1")));

    const StJournalReadResult r = j.read_last();
    ASSERT_EQ(r.status, StJournalReadStatus::OK);
    EXPECT_EQ(r.record.phase, StJournalPhase::PREPARED);
    EXPECT_EQ(r.record.timestamp_ns, 123456789u);
    EXPECT_EQ(r.record.operation_id, "op-1");
    EXPECT_EQ(r.record.old_active_hash, "aaaa");
    EXPECT_EQ(r.record.candidate_hash, "bbbb");
    EXPECT_EQ(r.record.plan_hash, "cccc");
    EXPECT_EQ(r.valid_record_count, 1u);
    EXPECT_EQ(r.truncated_tail_bytes, 0u);
    ::unlink(path.c_str());
}

TEST(StJournal, MultipleAppendsReturnsOnlyLastRecord)
{
    const std::string path = temp_path();
    StJournal j(path);
    ASSERT_TRUE(j.append(make_record(StJournalPhase::PREPARED, "op-1")));
    ASSERT_TRUE(j.append(make_record(StJournalPhase::COMMIT_INTENT, "op-1")));
    ASSERT_TRUE(j.append(make_record(StJournalPhase::ACTIVE_CANDIDATE, "op-1")));

    const StJournalReadResult r = j.read_last();
    ASSERT_EQ(r.status, StJournalReadStatus::OK);
    EXPECT_EQ(r.record.phase, StJournalPhase::ACTIVE_CANDIDATE);
    EXPECT_EQ(r.valid_record_count, 3u);
    ::unlink(path.c_str());
}

TEST(StJournal, TruncatedTailRecordDoesNotCorruptPriorRecords)
{
    /* Mô phỏng mất điện GIỮA LÚC ghi record thứ ba: hai record đầu đã fsync
     * xong, record thứ ba chỉ có vài byte đầu trên đĩa. */
    const std::string path = temp_path();
    StJournal j(path);
    ASSERT_TRUE(j.append(make_record(StJournalPhase::PREPARED, "op-1")));
    ASSERT_TRUE(j.append(make_record(StJournalPhase::COMMIT_INTENT, "op-1")));
    {
        std::ofstream f(path, std::ios::binary | std::ios::app);
        const char garbage[10] = {0x4D, 0x4B, 0x4A, 0x4C, 0x01, 0x00, 0x02, 0x00, 0x11, 0x22};
        f.write(garbage, sizeof(garbage));
    }

    const StJournalReadResult r = j.read_last();
    ASSERT_EQ(r.status, StJournalReadStatus::OK)
        << "đuôi bị cắt cụt không được làm mất hai record đã fsync trước đó";
    EXPECT_EQ(r.record.phase, StJournalPhase::COMMIT_INTENT);
    EXPECT_EQ(r.valid_record_count, 2u);
    EXPECT_EQ(r.truncated_tail_bytes, 10u);
    ::unlink(path.c_str());
}

TEST(StJournal, CorruptFirstRecordIsUnrecoverable)
{
    const std::string path = temp_path();
    {
        std::ofstream f(path, std::ios::binary);
        std::vector<char> junk(300, static_cast<char>(0xFF));
        f.write(junk.data(), static_cast<std::streamsize>(junk.size()));
    }
    StJournal j(path);
    const StJournalReadResult r = j.read_last();
    EXPECT_EQ(r.status, StJournalReadStatus::CORRUPT);
    EXPECT_EQ(st_journal_decide_boot_action(r), StJournalBootAction::NO_VALID_RECORD_RAISE_INCIDENT);
    ::unlink(path.c_str());
}

TEST(StJournal, FieldsLongerThanLimitAreRejected)
{
    StJournal j(temp_path());
    StJournalRecord r = make_record(StJournalPhase::PREPARED, std::string(65, 'x'));
    EXPECT_FALSE(j.append(r)) << "operation_id 65 byte vượt kStJournalFieldMax(64)";
}

TEST(StJournal, EraseRemovesFileAndIsIdempotent)
{
    const std::string path = temp_path();
    StJournal j(path);
    ASSERT_TRUE(j.append(make_record(StJournalPhase::PREPARED, "op-1")));
    ASSERT_EQ(j.read_last().status, StJournalReadStatus::OK);

    ASSERT_TRUE(j.erase());
    EXPECT_EQ(j.read_last().status, StJournalReadStatus::EMPTY);
    EXPECT_TRUE(j.erase()) << "xoá file đã không còn tồn tại vẫn phải là no-op thành công";
}

TEST(StJournal, DecideBootActionCoversAllFivePhasesPerDesignTable)
{
    struct Case { StJournalPhase phase; StJournalBootAction expect; };
    const Case cases[] = {
        {StJournalPhase::PREPARED, StJournalBootAction::KEEP_OLD_ACTIVE_DISCARD_CANDIDATE},
        {StJournalPhase::COMMIT_INTENT, StJournalBootAction::KEEP_OLD_ACTIVE_MARK_OPERATION_FAILED},
        {StJournalPhase::ACTIVE_CANDIDATE, StJournalBootAction::USE_LKG_CANDIDATE_NOT_AUTO_PUBLISHED},
        {StJournalPhase::FIRST_CYCLE_OK, StJournalBootAction::VERIFY_ACTIVE_THEN_FINISH_OR_LKG},
        {StJournalPhase::COMMITTED, StJournalBootAction::USE_COMMITTED_ACTIVE},
    };
    for (const Case& c : cases) {
        StJournalReadResult r;
        r.status = StJournalReadStatus::OK;
        r.record.phase = c.phase;
        EXPECT_EQ(st_journal_decide_boot_action(r), c.expect)
            << "phase=" << st_journal_phase_name(c.phase);
    }
}

} // namespace core
