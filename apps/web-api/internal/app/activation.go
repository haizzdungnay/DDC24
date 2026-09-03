package app

import (
	"context"
	"fmt"
	"strings"
	"time"
)

/* `ISS-PIO-33` — an toàn khi KÍCH HOẠT cấu hình I/O vật lý.
 *
 * Vòng đời đầy đủ là `Edit → Validate → Apply → Read-back Verify`. Ba bước đầu
 * đã có: validate ở `configschema` (`ISS-PIO-27`), apply nguyên tử + rollback ở
 * `applyIOBundle`. Bước thứ tư thì KHÔNG — và thiếu nó, mọi thứ trước đó chỉ
 * chứng minh "web đã ghi xong tệp", không chứng minh "phần cứng đã đổi mode".
 *
 * Khoảng cách đó có thật, không phải giả thiết. `iobus` chỉ gửi `SET_AO_CFG`
 * khi IOP đang ở trạng thái poll; và khi MCU **NACK**, nó ghi `ao_mode[] = 0`
 * (giữ 0-10V) rồi chạy tiếp. Trước bản vá này, web đáp `200 success` cho một
 * cấu hình 4-20 mA mà bo vẫn đang chạy 0-10 V — người vận hành đấu dây theo
 * dòng, đọc ra điện áp, và không có chỗ nào trong giao diện nói ra điều đó.
 */

// ActivationAOMode là đối chiếu MỘT kênh AO: cấu hình đòi gì, phần cứng báo gì.
type ActivationAOMode struct {
	Channel   int    `json:"ch"`
	Requested string `json:"requested"`
	Applied   string `json:"applied"`
}

// ActivationReport là bước Read-back Verify, LUÔN có mặt trong đáp ứng.
//
// Yêu cầu "không có trạng thái trung gian mà người vận hành không nhìn thấy"
// nghĩa là: im lặng không phải một lựa chọn. Kể cả khi không kiểm chứng được thì
// vẫn phải nói ra là không kiểm chứng được, kèm lý do.
type ActivationReport struct {
	// Status: `verified` (phần cứng khớp cấu hình), `unverified` (chưa đọc được
	// bằng chứng), `mismatch` (đọc được và KHÁC — cấu hình đã bị rollback).
	Status  string             `json:"status"`
	Reason  string             `json:"reason,omitempty"`
	AOModes []ActivationAOMode `json:"aoModes,omitempty"`
}

const (
	ActivationVerified   = "verified"
	ActivationUnverified = "unverified"
	ActivationMismatch   = "mismatch"
)

// AOModeReader đọc `ao_mode[]` từ `io_shm` — mode mà `iobus` ghi SAU khi MCU
// ACK `SET_AO_CFG`, tức mode phần cứng THẬT SỰ đang chạy.
type AOModeReader interface {
	ReadAOModes() ([]uint8, error)
}

const (
	aoModeVolt    = 0
	aoModeCurrent = 1
	// `iobus` cần một nhịp sau SIGHUP để nạp lại config, bắt tay `SET_AO_CFG` và
	// ghi kết quả vào SHM. Chờ tối đa ngần này rồi mới kết luận; kết luận sớm sẽ
	// biến độ trễ bình thường thành "mismatch" và gây rollback oan.
	activationVerifyBudget   = 3 * time.Second
	activationVerifyInterval = 100 * time.Millisecond
)

func aoModeName(raw uint8) string {
	if raw == aoModeCurrent {
		return "4-20mA"
	}
	return "0-10V"
}

// expectedAOModes dịch cấu hình AO thành `ao_mode[]` mong đợi.
//
// Kênh không được liệt kê giữ mặc định 0-10 V — khớp đúng `iobus_config.cpp`,
// nơi `ao_mode[]` được khởi tạo `V0_10` trước khi parse. Đoán khác đi ở đây sẽ
// tạo ra "mismatch" cho một cấu hình hoàn toàn hợp lệ.
func expectedAOModes(cfg ConfigIO) []uint8 {
	modes := make([]uint8, kxNAO)
	for _, row := range cfg.AO {
		channel, ok, good := intField(row, "ch")
		if !ok || !good || channel < 1 || channel > kxNAO {
			continue
		}
		if mode, ok, good := stringField(row, "mode"); ok && good && mode == "4-20mA" {
			modes[channel-1] = aoModeCurrent
		}
	}
	return modes
}

func aoModeComparison(expected, applied []uint8) []ActivationAOMode {
	rows := make([]ActivationAOMode, 0, len(expected))
	for i, want := range expected {
		got := uint8(aoModeVolt)
		if i < len(applied) {
			got = applied[i]
		}
		rows = append(rows, ActivationAOMode{Channel: i + 1, Requested: aoModeName(want), Applied: aoModeName(got)})
	}
	return rows
}

func sameAOModes(expected, applied []uint8) bool {
	if len(applied) < len(expected) {
		return false
	}
	for i, want := range expected {
		if applied[i] != want {
			return false
		}
	}
	return true
}

// verifyActivation thực hiện bước Read-back Verify.
//
// Ba kết cục, và ranh giới giữa chúng là ranh giới giữa "không có bằng chứng" và
// "có bằng chứng ngược lại":
//
//   - `verified`   — đọc được `ao_mode[]` và nó khớp cấu hình.
//   - `unverified` — KHÔNG đọc được, hoặc đọc được nhưng IOP chưa ở trạng thái
//     poll nên `SET_AO_CFG` chưa từng được gửi. Đây là THIẾU BẰNG CHỨNG, không
//     phải bằng chứng hỏng, nên KHÔNG rollback: vứt bỏ chỉnh sửa của người vận
//     hành vì ta không quan sát được là phạt nhầm người.
//   - `mismatch`   — đọc được, IOP đang poll, và mode vẫn khác. MCU đã từ chối
//     (`SET_AO_CFG` NACK ⇒ `iobus` giữ 0-10V). Đây là bằng chứng hỏng, và caller
//     PHẢI rollback.
func (a *App) verifyActivation(ctx context.Context, cfg ConfigIO) ActivationReport {
	reader, ok := a.core.(AOModeReader)
	if !ok {
		return ActivationReport{Status: ActivationUnverified, Reason: "core client hiện tại không đọc được io_shm nên không kiểm chứng được mode AO"}
	}
	expected := expectedAOModes(cfg)
	deadline := time.Now().Add(activationVerifyBudget)
	var applied []uint8
	var lastErr error
	for {
		applied, lastErr = reader.ReadAOModes()
		if lastErr == nil && sameAOModes(expected, applied) {
			return ActivationReport{Status: ActivationVerified, AOModes: aoModeComparison(expected, applied)}
		}
		if !time.Now().Before(deadline) {
			break
		}
		time.Sleep(activationVerifyInterval)
	}
	if lastErr != nil {
		return ActivationReport{Status: ActivationUnverified, Reason: fmt.Sprintf("không đọc được ao_mode[] từ io_shm: %v", lastErr)}
	}
	comparison := aoModeComparison(expected, applied)
	// IOP chưa poll ⇒ `iobus` KHÔNG gửi `SET_AO_CFG` lần nào. Gọi đó là
	// "mismatch" rồi rollback sẽ đổ lỗi cho cấu hình vì một sự thật về MCU.
	if status, _ := a.core.ReadStatus(ctx); status.IOP.Status != "normal" && status.IOP.Status != "safe_state" {
		return ActivationReport{
			Status:  ActivationUnverified,
			Reason:  fmt.Sprintf("IOP đang ở trạng thái %q nên iobus chưa gửi SET_AO_CFG; mode AO chưa được xác nhận ở phần cứng", status.IOP.Status),
			AOModes: comparison,
		}
	}
	return ActivationReport{
		Status:  ActivationMismatch,
		Reason:  "MCU không nhận mode AO (SET_AO_CFG bị NACK nên iobus giữ 0-10V): " + describeAOMismatch(comparison),
		AOModes: comparison,
	}
}

func describeAOMismatch(rows []ActivationAOMode) string {
	var parts []string
	for _, row := range rows {
		if row.Requested != row.Applied {
			parts = append(parts, fmt.Sprintf("AO-%02d yêu cầu %s nhưng phần cứng đang %s", row.Channel, row.Requested, row.Applied))
		}
	}
	return strings.Join(parts, "; ")
}
