package modbusrtu

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"
)

// canonicalConfig là dạng ỔN ĐỊNH của cấu hình dùng để tính checksum (MBR-B206).
//
// Vì sao không marshal thẳng `Config`:
//
//  1. `RS485`/`Slaves`/`TCPSlaves` là `map[string]any`. `encoding/json` sắp key
//     map theo thứ tự tăng dần nên chuỗi ổn định, NHƯNG giá trị bên trong lại
//     có thể là `int` hay `float64` tuỳ đường vào (đọc từ file JSON cho
//     float64; dựng trong bộ nhớ cho int) và hai kiểu đó marshal khác nhau
//     ("19200" vs "19200"). Đủ để cùng một cấu hình cho ra hai checksum.
//  2. Ba khối đó là dữ liệu SINH RA từ buses/devices/points. Đưa chúng vào
//     checksum nghĩa là checksum phụ thuộc thuật toán sinh, nên một lần tinh
//     chỉnh cách sinh file cho iobus sẽ làm mọi cấu hình đang chạy đổi checksum
//     và FE báo "cấu hình đã thay đổi" trong khi không ai sửa gì.
//
// Canonical form chỉ gồm NGUỒN CHÂN LÝ, sắp xếp xác định theo khoá.
type canonicalConfig struct {
	Buses          []Bus    `json:"buses"`
	Devices        []Device `json:"devices"`
	Points         []Point  `json:"points"`
	PollDefaultMs  int      `json:"poll_default_ms"`
	OfflineProbeMs int      `json:"offline_probe_ms"`
}

// CanonicalJSON trả về dạng tuần tự hoá ổn định của cấu hình.
// KHÔNG chứa `revision` và `checksum`: checksum phải mô tả NỘI DUNG, còn
// revision là siêu dữ liệu của lần apply. Trộn hai thứ làm hai cấu hình giống
// hệt nhau ở hai revision khác nhau có checksum khác nhau, và mất luôn khả
// năng phát hiện "apply lại đúng thứ đang chạy".
func CanonicalJSON(cfg Config) ([]byte, error) {
	canonical := canonicalConfig{
		Buses:          append([]Bus(nil), cfg.Buses...),
		Devices:        append([]Device(nil), cfg.Devices...),
		Points:         append([]Point(nil), cfg.Points...),
		PollDefaultMs:  cfg.PollDefaultMs,
		OfflineProbeMs: cfg.OfflineProbeMs,
	}
	for i := range canonical.Buses {
		canonical.Buses[i] = NormalizeBus(canonical.Buses[i])
	}
	for i := range canonical.Devices {
		canonical.Devices[i] = NormalizeDevice(canonical.Devices[i])
	}
	for i := range canonical.Points {
		canonical.Points[i] = NormalizePoint(canonical.Points[i])
	}
	// Thứ tự khai báo KHÔNG được ảnh hưởng checksum: đổi chỗ hai thiết bị trên
	// UI không phải là đổi cấu hình.
	sort.SliceStable(canonical.Buses, func(i, j int) bool {
		return canonical.Buses[i].BusID < canonical.Buses[j].BusID
	})
	sort.SliceStable(canonical.Devices, func(i, j int) bool {
		return strings.ToLower(canonical.Devices[i].DeviceID) <
			strings.ToLower(canonical.Devices[j].DeviceID)
	})
	sort.SliceStable(canonical.Points, func(i, j int) bool {
		return strings.ToLower(canonical.Points[i].PointID) <
			strings.ToLower(canonical.Points[j].PointID)
	})
	return json.Marshal(canonical)
}

// Checksum là SHA-256 hex của canonical JSON.
func Checksum(cfg Config) (string, error) {
	raw, err := CanonicalJSON(cfg)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}
