package app

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

/* ISS-PIO-14 — chính sách giá trị Virtual Point sau khởi động lại (đề bài §13).
 *
 * TRIỆU CHỨNG: `VirtualPoint` chỉ có `value`, và `syncBoundVirtualPointsToCore`
 * đẩy lại chính `value` đó lúc khởi động. Nhưng mọi lệnh ghi runtime cũng ghi đè
 * `value` trong `virtual_points.conf`. Nên hành vi thật là "khởi động lại ở giá
 * trị GHI CUỐI CÙNG", và **không có lựa chọn nào khác** — trong khi đề bài đòi
 * người dùng chọn giữa *Retain last value* và *Initial value*.
 *
 * Điều tệ nhất không phải thiếu lựa chọn mà là MỘT TRƯỜNG GÁNH HAI NGHĨA: người
 * dùng đặt 20 °C làm mặc định, một kỹ thuật viên ép 35 để thử, và giá trị 20
 * biến mất khỏi cấu hình vĩnh viễn. Không có đường nào lấy lại nó.
 *
 * CÁCH SỬA: tách `initialValue` khỏi `value`, và thêm `restartPolicy`.
 *
 * GIỚI HẠN, ghi rõ thay vì để người đọc tự phát hiện: chính sách áp lúc
 * **web-api khởi động**. Nếu CHỈ Core khởi động lại, vòng đối chiếu đẩy lại
 * `value` hiện hành chứ không phải `initialValue` — `plc_shm` không có "boot id"
 * nên web-api không phân biệt được "Core vừa dựng lại SHM" với "ai đó vừa ghi
 * đè slot", đúng như chú thích của `runVirtualPointReconciler` đã nêu. Đoán bừa
 * ở đây sẽ kéo một điểm đang chạy về giá trị khởi tạo giữa ca vận hành.
 */

const (
	// virtualPointRestartRetain giữ giá trị cuối. Mặc định, vì đó là hành vi mà
	// mọi cấu hình đang chạy vẫn có — nạp một tệp cũ không được âm thầm đổi cách
	// thiết bị khởi động.
	virtualPointRestartRetain = "retain"
	// virtualPointRestartInitial quay về `initialValue` khi web-api khởi động.
	virtualPointRestartInitial = "initial"
)

// virtualPointRestartPolicies là tập hợp lệ, dùng chung cho validate và hợp đồng.
var virtualPointRestartPolicies = []string{virtualPointRestartRetain, virtualPointRestartInitial}

// normalizeVirtualPointRestartPolicy chuẩn hoá về một trong hai giá trị hợp lệ.
//
// Rỗng ⇒ `retain`. Giá trị LẠ cũng ⇒ `retain` chứ không phải lỗi tại đây:
// `validateConfigVirtualPoints` mới là nơi từ chối, còn hàm này chạy cả trên
// đường ĐỌC một tệp cấu hình đã nằm trên đĩa — ở đó việc đúng là hiểu nó theo
// hành vi cũ, không phải làm cả danh sách điểm biến mất.
func normalizeVirtualPointRestartPolicy(policy string) string {
	if strings.EqualFold(strings.TrimSpace(policy), virtualPointRestartInitial) {
		return virtualPointRestartInitial
	}
	return virtualPointRestartRetain
}

// virtualPointBootValue trả giá trị điểm phải mang NGAY SAU khi web-api khởi động.
//
// `initial` mà chưa đặt `initialValue` ⇒ mặc định theo kiểu tín hiệu, KHÔNG rơi
// về `Value`: `Value` chính là thứ lệnh ghi runtime đã làm bẩn, nên dùng nó ở
// đây sẽ biến `initial` thành `retain` một cách im lặng — tệ hơn không có tuỳ
// chọn nào, vì màn hình khi ấy nói một đằng và thiết bị làm một nẻo.
func virtualPointBootValue(item VirtualPoint) any {
	if normalizeVirtualPointRestartPolicy(item.RestartPolicy) != virtualPointRestartInitial {
		return item.Value
	}
	if item.InitialValue != nil {
		return item.InitialValue
	}
	return defaultVirtualPointValue(item.SignalType)
}

/* applyRestartPolicyOnBoot đặt lại `value` của các điểm khai `restartPolicy:
 * initial` về giá trị khởi tạo, MỘT LẦN, lúc web-api khởi động.
 *
 * Vì sao ghi vào cấu hình chứ không chỉ đẩy xuống Core: vòng đối chiếu 10 giây
 * so slot Core với `value` trong cấu hình. Nếu chỉ đẩy `initialValue` xuống Core
 * mà không sửa cấu hình, vòng kế tiếp sẽ thấy "lệch" và kéo ngược về giá trị cũ
 * — điểm sẽ nhấp nháy giữa hai giá trị mỗi 10 giây, một lỗi khó chịu hơn hẳn
 * lỗi đang sửa.
 *
 * Trả về số điểm đã đặt lại để nơi gọi ghi nhật ký; im lặng ở đây nghĩa là một
 * thay đổi giá trị vật lý xảy ra mà không dấu vết nào.
 */
func (a *App) applyRestartPolicyOnBoot(ctx context.Context) int {
	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()

	cfg, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		return 0
	}
	cfg = normalizeVirtualPointsConfig(cfg)
	before := clonePointVirtualConfig(cfg)
	reset := 0
	for i := range cfg.Items {
		item := cfg.Items[i]
		if normalizeVirtualPointRestartPolicy(item.RestartPolicy) != virtualPointRestartInitial {
			continue
		}
		want := virtualPointBootValue(item)
		if sameVirtualPointValue(item.Value, want, item.SignalType) {
			continue
		}
		cfg.Items[i].Value = want
		reset++
	}
	if reset == 0 {
		return 0
	}
	if err := a.writeVirtualPointsConfigFile(cfg); err != nil {
		if a.logger != nil {
			a.logger.Printf("WARN virtual-point restart policy: không ghi được cấu hình: %v", err)
		}
		return 0
	}
	/* Vết audit cho một thay đổi giá trị do HỆ THỐNG thực hiện (`ISS-PIO-37` đòi
	 * mọi thay đổi cấu hình Point để lại vết `old → new`). Không có actor người
	 * dùng nên actor là `system`; im lặng ở đây nghĩa là giá trị một điểm vật lý
	 * đổi mà không dấu vết nào — đúng thứ #391 vừa vá. */
	a.audit.ChangeWithDetail("system", "virtual-points.restart-policy", configGroupVirtualPoints.file,
		"applied", "boot", summarizeConfigDiff(before, cfg))
	if a.logger != nil {
		a.logger.Printf("INFO virtual-point restart policy: %d điểm quay về giá trị khởi tạo", reset)
	}
	_ = ctx
	return reset
}

/* writeVirtualPointsConfigFile ghi thẳng tệp cấu hình VP.
 *
 * KHÔNG đi qua `writeVirtualPointsConfig`: phễu đó cần một `*http.Request` (để
 * lấy actor cho audit), cấp lại slot, bump `generation` và kiểm tag. Ở đường
 * khởi động không có request, và việc đang làm chỉ ĐẶT LẠI GIÁ TRỊ — nó không
 * đổi danh tính điểm nào, nên bump `generation` sẽ là một lời nói dối: mọi ST
 * Program bind các điểm đó sẽ thấy thế hệ nhảy và tưởng điểm đã bị dựng lại.
 */
func (a *App) writeVirtualPointsConfigFile(cfg ConfigVirtualPoints) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	path := a.configPath(configGroupVirtualPoints.file)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return writeConfigFileAtomic(path, data, 0o644)
}

// sameVirtualPointValue so hai giá trị VP theo đúng kiểu tín hiệu của điểm.
//
// Tái dùng chính bộ so của vòng đối chiếu (`virtualPointMatchesSlot`) thay vì
// so `any` bằng `==`: `1` đọc từ JSON là `float64`, còn hằng số trong mã là
// `int64`, nên `==` sẽ báo "khác nhau" cho hai giá trị bằng nhau và làm bản vá
// này ghi lại tệp cấu hình ở MỌI lần khởi động.
func sameVirtualPointValue(left, right any, signalType string) bool {
	if signalType == virtualPointSignalBoolean {
		leftBool, okLeft := virtualPointBool(left)
		rightBool, okRight := virtualPointBool(right)
		return okLeft && okRight && leftBool == rightBool
	}
	leftNum, okLeft := virtualPointFloat(left)
	rightNum, okRight := virtualPointFloat(right)
	if okLeft && okRight {
		return leftNum == rightNum
	}
	// Chuỗi/datetime: so nguyên văn sau khi cắt khoảng trắng.
	return strings.TrimSpace(virtualPointText(left)) == strings.TrimSpace(virtualPointText(right))
}

func virtualPointText(value any) string {
	text, _ := value.(string)
	return text
}

// validVirtualPointRestartPolicy kiểm giá trị THÔ, dùng ở đường ghi API.
func validVirtualPointRestartPolicy(policy string) bool {
	for _, allowed := range virtualPointRestartPolicies {
		if strings.EqualFold(strings.TrimSpace(policy), allowed) {
			return true
		}
	}
	return false
}
