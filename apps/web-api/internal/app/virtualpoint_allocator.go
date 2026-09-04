package app

import (
	"fmt"
	"sort"
	"strings"
)

/* `ISS-PIO-03`/`F-PIO-003` — ALLOCATOR SLOT CHO VIRTUAL POINT.
 *
 * Triệu chứng: một Virtual Point tạo từ giao diện **không bao giờ** map được vào
 * biến chương trình. FE không có ô `boundPointId`, backend không tự gán, nên
 * `pointCatalogPointID()` trả `"VP12"`, `supportEligibility()` thấy prefix `VP`
 * ∉ {AV, BV, MSV} và kết luận `UNSUPPORTED_IDENTITY`. Đường duy nhất là gọi
 * thẳng `PUT /virtual-points/{id}` với `boundPointId` thủ công — một tính năng
 * chỉ dùng được bằng `curl`.
 *
 * Gói này cấp phát slot đó, và mỗi quy tắc dưới đây trả lời đúng một gạch đầu
 * dòng trong điều kiện đóng của issue. */

// vpSlotPool là một dải slot Core mà VP có thể chiếm.
type vpSlotPool struct {
	Prefix   string
	Capacity int
}

/* QUY TẮC CẤP PHÁT theo `signalType`.
 *
 * `string`/`datetime` KHÔNG có pool: Core không có slot nào mang kiểu đó, nên
 * VP kiểu ấy vẫn là overlay cấu hình. Trả về "không cấp phát" là câu trả lời
 * ĐÚNG cho chúng, không phải một thiếu sót.
 *
 * `MSV` là dòng mà `ISS-PIO-17` thêm vào: từ nay `multistate` dẫn tới tám slot
 * `msv[KX_N_MSV]` mà Core đã có sẵn nhưng trước đó không ai với tới được. */
func vpPoolFor(signalType string) (vpSlotPool, bool) {
	switch strings.ToLower(strings.TrimSpace(signalType)) {
	case virtualPointSignalBoolean:
		return vpSlotPool{Prefix: "BV", Capacity: kxNBV}, true
	case virtualPointSignalInteger, virtualPointSignalFloat:
		return vpSlotPool{Prefix: "AV", Capacity: kxNAV}, true
	case virtualPointSignalMultistate:
		return vpSlotPool{Prefix: "MSV", Capacity: kxNMSV}, true
	}
	return vpSlotPool{}, false
}

// vpSlotLedger là sổ cấp phát dựng lại TỪ CHÍNH cấu hình đang lưu.
//
// PERSISTENCE không cần thêm tệp trạng thái nào: `virtual_points.conf` đã bền
// qua reboot, và nó ghi đủ ai đang giữ slot nào. Một sổ riêng sẽ là nguồn sự
// thật thứ hai — và hai nguồn cho cùng một dữ kiện là cách chúng lệch nhau.
type vpSlotLedger struct {
	takenBy map[string]string // "AV-03" -> VP id
	// highWater[prefix] là chỉ số lớn nhất TỪNG được cấp trong pool đó, suy ra
	// từ các slot đang bị chiếm. Xem `allocate` để biết vì sao nó quan trọng.
	highWater map[string]int
}

func buildVPSlotLedger(items []VirtualPoint) vpSlotLedger {
	ledger := vpSlotLedger{takenBy: map[string]string{}, highWater: map[string]int{}}
	for _, item := range items {
		if item.BoundPointID == "" {
			continue
		}
		slot := canonicalBoundPointID(item.BoundPointID)
		ledger.takenBy[slot] = canonicalVirtualPointID(item.ID)
		if prefix, channel, ok := parsePointID(slot); ok && channel > ledger.highWater[prefix] {
			ledger.highWater[prefix] = channel
		}
	}
	return ledger
}

func (l vpSlotLedger) free(pool vpSlotPool) []string {
	var slots []string
	for channel := 1; channel <= l.highWater[pool.Prefix]; channel++ {
		slot := formatPointID(pool.Prefix, channel)
		if _, taken := l.takenBy[slot]; !taken {
			slots = append(slots, slot)
		}
	}
	sort.Strings(slots)
	return slots
}

/* allocate cấp một slot mới cho `signalType`.
 *
 * QUY TẮC: luôn lấy chỉ số NGAY SAU mốc cao nhất từng cấp, không bao giờ tự
 * nhặt lại một slot đã được trả về.
 *
 * Vì sao không tái dùng tự động — đây là điểm cốt lõi của gạch đầu dòng
 * "delete/reuse an toàn, KHÔNG dựng lại binding cũ": một Program bind vào
 * `AV-3`. Xoá VP đang giữ `AV-3` rồi tạo VP mới, nếu allocator nhặt lại `AV-3`
 * thì chương trình **âm thầm chuyển sang ghi vào VP khác** — Catalog vẫn có
 * mục `AV-3` nên Check vẫn nói "khớp". Đó đúng lớp lỗi mà `ISS-PIO-31` vừa dẹp
 * xong ở phía Modbus, và tái tạo nó ở phía VP thì vô nghĩa.
 *
 * Slot đã trả lại KHÔNG mất: người vận hành vẫn đặt `boundPointId` thủ công để
 * thu hồi — nhưng đó là một hành động CÓ CHỦ Ý, được nhìn thấy, chứ không phải
 * một hệ quả im lặng của việc tạo điểm mới.
 *
 * HẾT SLOT: trả lỗi nêu rõ pool nào cạn, trần bao nhiêu, và **liệt kê chính xác
 * những slot có thể thu hồi**. Một thông báo "hết chỗ" mà không nói thu hồi
 * được gì thì đẩy người vận hành vào ngõ cụt. */
func (l vpSlotLedger) allocate(signalType string) (string, error) {
	pool, ok := vpPoolFor(signalType)
	if !ok {
		return "", nil
	}
	next := l.highWater[pool.Prefix] + 1
	if next > pool.Capacity {
		reclaimable := l.free(pool)
		if len(reclaimable) == 0 {
			return "", fmt.Errorf("hết slot %s (trần %d) và không có slot nào để thu hồi",
				pool.Prefix, pool.Capacity)
		}
		return "", fmt.Errorf("hết slot %s (trần %d); thu hồi thủ công một trong các slot đã trả lại: %s",
			pool.Prefix, pool.Capacity, strings.Join(reclaimable, ", "))
	}
	return formatPointID(pool.Prefix, next), nil
}

func (l *vpSlotLedger) take(slot, vpID string) {
	l.takenBy[slot] = vpID
	if prefix, channel, ok := parsePointID(slot); ok && channel > l.highWater[prefix] {
		l.highWater[prefix] = channel
	}
}

/* assignVirtualPointSlots cấp `boundPointId` cho mọi VP chưa có.
 *
 * COLLISION: sổ được dựng từ TOÀN BỘ cấu hình trước, nên một slot đang bị ai đó
 * giữ không bao giờ được phát lại — kể cả khi VP giữ nó đang `enabled = false`.
 * Bỏ qua VP tắt sẽ khiến bật lại một VP cũ trở thành hành động cướp slot.
 *
 * Hàm KHÔNG đụng tới VP đã có `boundPointId`: gán đè sẽ là tự ý đổi đích của
 * một binding đang chạy.
 */
func assignVirtualPointSlots(cfg ConfigVirtualPoints) (ConfigVirtualPoints, []configValidationError) {
	ledger := buildVPSlotLedger(cfg.Items)
	var errs []configValidationError
	for index := range cfg.Items {
		item := &cfg.Items[index]
		if item.BoundPointID != "" {
			continue
		}
		slot, err := ledger.allocate(item.SignalType)
		if err != nil {
			addConfigErr(&errs, fmt.Sprintf("items[%d].boundPointId", index), err.Error())
			continue
		}
		if slot == "" {
			continue // signalType không có pool — đúng, không phải thiếu sót
		}
		item.BoundPointID = slot
		ledger.take(slot, canonicalVirtualPointID(item.ID))
	}
	return cfg, errs
}
