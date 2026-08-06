package modbusrtu

import (
	"encoding/json"
	"os"
	"strings"
)

// PortCapability mô tả MỘT cổng serial mà nền tảng thật sự có (MBR-B211).
type PortCapability struct {
	Port        string `json:"port"`
	Alias       string `json:"alias"`
	Description string `json:"description"`
	MaxBaud     int    `json:"max_baud"`
}

// CapabilityManifest là danh sách cổng RS-485 hợp lệ của board.
//
// Vì sao phải là ALLOWLIST chứ không phải chuỗi tự do: bản trước nhận bất kỳ
// chuỗi ≤128 byte làm `rs485_port`. Hệ quả quan sát được trên board production
// (D-14): FE mặc định `/dev/ttyS3` — một cổng KHÔNG TỒN TẠI trên Foxlinx — nên
// cấu hình lưu được, checksum hợp lệ, revision tăng, và lỗi chỉ lộ ra ở tầng
// iobus dưới dạng "không mở được cổng". Người vận hành nhìn thấy một cấu hình
// "đã lưu thành công" mà không bao giờ chạy.
//
// Allowlist đẩy lỗi đó lên ngay lúc validate, kèm danh sách cổng hợp lệ.
type CapabilityManifest struct {
	Ports []PortCapability `json:"ports"`
}

// DefaultCapabilityManifest phản ánh khảo sát phần cứng Foxlinx SOM-DDC-24
// ngày 2026-08-05 (OD-MBRTU-001 CLOSED, hai bus vật lý qua symlink).
func DefaultCapabilityManifest() CapabilityManifest {
	return CapabilityManifest{Ports: []PortCapability{
		{Port: "/dev/rs485-1", Alias: "ttyS5", Description: "RS485-1 (cổng chính)", MaxBaud: 115200},
		{Port: "/dev/rs485-2", Alias: "ttyS1", Description: "RS485-2 (Header P16, UART1 M1)", MaxBaud: 115200},
	}}
}

// LoadCapabilityManifest đọc manifest từ đĩa; thiếu file ⇒ dùng mặc định.
//
// Manifest hỏng KHÔNG được im lặng rơi về mặc định: một board khác cấu hình
// cổng khác, và chấp nhận mặc định ở đó sẽ cho qua một cấu hình không chạy
// được. Trả lỗi để caller quyết định.
func LoadCapabilityManifest(path string) (CapabilityManifest, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return DefaultCapabilityManifest(), nil
		}
		return CapabilityManifest{}, err
	}
	var manifest CapabilityManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return CapabilityManifest{}, err
	}
	if len(manifest.Ports) == 0 {
		return DefaultCapabilityManifest(), nil
	}
	return manifest, nil
}

func (m CapabilityManifest) Allows(port string) bool {
	target := strings.TrimSpace(port)
	for _, p := range m.Ports {
		if p.Port == target {
			return true
		}
	}
	return false
}

func (m CapabilityManifest) PortList() string {
	names := make([]string, 0, len(m.Ports))
	for _, p := range m.Ports {
		names = append(names, p.Port)
	}
	return strings.Join(names, ", ")
}

func (m CapabilityManifest) MaxBaudFor(port string) int {
	for _, p := range m.Ports {
		if p.Port == strings.TrimSpace(port) {
			return p.MaxBaud
		}
	}
	return 0
}
