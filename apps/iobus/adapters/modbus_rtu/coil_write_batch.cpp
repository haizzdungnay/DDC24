/**
 * @file  coil_write_batch.cpp
 * @brief U-07 — kế hoạch gom lệnh ghi coil liền kề thành FC15 (hàm thuần).
 */
#include "coil_write_batch.hpp"

#include <algorithm>
#include <map>

namespace iobus::fieldbus {

std::vector<WritePlanTx> plan_write_transactions(const std::vector<WritePlanItem>& items,
                                                 uint16_t max_coils_per_write)
{
    std::vector<WritePlanTx> plan;
    plan.reserve(items.size());

    auto single = [&](size_t idx) {
        WritePlanTx tx;
        tx.items.push_back(idx);
        tx.start_addr = items[idx].addr;
        plan.push_back(std::move(tx));
    };

    if (max_coils_per_write <= 1) {
        for (size_t i = 0; i < items.size(); i++) single(i);
        return plan;
    }
    const uint16_t limit = std::min<uint16_t>(max_coils_per_write, kMaxCoilsPerWrite);

    /* Địa chỉ coil lặp lại trong đầu vào — tính trên MỌI lệnh ghi coil, kể cả
     * mục không gom được: một lệnh readback cho coil 3 đứng giữa hai lệnh
     * thường cho coil 3 vẫn là ba lệnh phải đi đúng thứ tự. */
    std::map<uint16_t, size_t> coil_uses;
    for (const auto& it : items)
        if (is_coil_write_fc(it.fc)) coil_uses[it.addr]++;

    std::vector<size_t> run;
    auto flush_run = [&]() {
        if (run.empty()) return;
        std::vector<size_t> by_addr = run;
        std::stable_sort(by_addr.begin(), by_addr.end(),
                         [&](size_t a, size_t b) { return items[a].addr < items[b].addr; });
        std::vector<WritePlanTx> chunks;
        for (size_t idx : by_addr) {
            WritePlanTx* last = chunks.empty() ? nullptr : &chunks.back();
            const bool extends =
                last != nullptr && last->items.size() < limit &&
                static_cast<uint32_t>(items[last->items.back()].addr) + 1u ==
                    static_cast<uint32_t>(items[idx].addr);
            if (extends) {
                last->items.push_back(idx);
            } else {
                WritePlanTx tx;
                tx.items.push_back(idx);
                tx.start_addr = items[idx].addr;
                chunks.push_back(std::move(tx));
            }
        }
        /* Dải nào chứa lệnh cũ nhất thì đi trước — không để một coil địa chỉ
         * thấp vừa vào hàng đợi chen lên trước lệnh đã chờ lâu hơn. */
        auto oldest = [](const WritePlanTx& tx) {
            return *std::min_element(tx.items.begin(), tx.items.end());
        };
        std::stable_sort(chunks.begin(), chunks.end(),
                         [&](const WritePlanTx& a, const WritePlanTx& b) { return oldest(a) < oldest(b); });
        for (auto& c : chunks) plan.push_back(std::move(c));
        run.clear();
    };

    for (size_t i = 0; i < items.size(); i++) {
        const WritePlanItem& it = items[i];
        const bool groupable = it.groupable && is_coil_write_fc(it.fc) && coil_uses[it.addr] == 1;
        if (groupable) {
            run.push_back(i);
            continue;
        }
        flush_run();
        single(i);
    }
    flush_run();
    return plan;
}

} // namespace iobus::fieldbus
