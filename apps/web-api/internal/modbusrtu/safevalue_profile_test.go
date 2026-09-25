package modbusrtu

import (
	"encoding/json"
	"testing"
)

// F06 (EV-PROG-FBD-ST-MB-20260925): iobus chỉ ghi được `safe_value` khi Program
// bị Disable/Stop nếu giá trị đó có trong profile. Điểm read-only hoặc
// `safe_value` không đọc được thì KHÔNG được ghi khoá — bịa 0 là ra lệnh tắt.
func TestBuildProfileEmitsSafeValueForWritablePointsOnly(t *testing.T) {
	device := Device{DeviceID: "CK508-04"}
	points := []Point{
		{PointID: "DO_ON", DeviceID: "CK508-04", RegisterType: "coil", Address: 0,
			DataType: "bool", Enabled: FlexBool(true), ReadWrite: "read_write", SafeValue: true},
		{PointID: "DO_OFF", DeviceID: "CK508-04", RegisterType: "coil", Address: 1,
			DataType: "bool", Enabled: FlexBool(true), ReadWrite: "read_write", SafeValue: false},
		{PointID: "AO_SP", DeviceID: "CK508-04", RegisterType: "holding_register", Address: 10,
			DataType: "uint16", Enabled: FlexBool(true), ReadWrite: "read_write", SafeValue: "12.5"},
		{PointID: "DO_NONE", DeviceID: "CK508-04", RegisterType: "coil", Address: 2,
			DataType: "bool", Enabled: FlexBool(true), ReadWrite: "read_write", SafeValue: nil},
		{PointID: "DI_RO", DeviceID: "CK508-04", RegisterType: "discrete_input", Address: 3,
			DataType: "bool", Enabled: FlexBool(true), ReadWrite: "read", SafeValue: true},
	}
	raw, err := BuildProfile(device, points)
	if err != nil {
		t.Fatalf("BuildProfile: %v", err)
	}
	var profile struct {
		Points []map[string]any `json:"points"`
	}
	if err := json.Unmarshal(raw, &profile); err != nil {
		t.Fatal(err)
	}
	got := map[string]any{}
	for _, row := range profile.Points {
		if value, ok := row["safe_value"]; ok {
			got[row["name"].(string)] = value
		}
	}
	want := map[string]float64{"DO_ON": 1, "DO_OFF": 0, "AO_SP": 12.5}
	for name, value := range want {
		if got[name] != value {
			t.Fatalf("%s: safe_value=%v, muốn %v (profile %s)", name, got[name], value, raw)
		}
	}
	for _, name := range []string{"DO_NONE", "DI_RO"} {
		if _, exists := got[name]; exists {
			t.Fatalf("%s không được mang safe_value: %s", name, raw)
		}
	}
}
