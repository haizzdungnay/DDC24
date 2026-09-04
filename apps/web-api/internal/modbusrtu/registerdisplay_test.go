package modbusrtu

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestReadFunctionCodesCoverTheFourStandardAreas(t *testing.T) {
	for registerType, want := range map[string]int{
		"coil": 1, "discrete_input": 2, "holding_register": 3, "input_register": 4,
	} {
		got, ok := ReadFunctionCode(registerType)
		if !ok || got != want {
			t.Fatalf("ReadFunctionCode(%q) = %d, %v; muốn %d, true", registerType, got, ok, want)
		}
	}
	if _, ok := ReadFunctionCode("khong_ton_tai"); ok {
		t.Fatal("vùng lạ vẫn được cấp mã hàm")
	}
}

func TestWriteFunctionCodeOnlyForWritableAreas(t *testing.T) {
	for registerType, want := range map[string]int{"coil": 5, "holding_register": 6} {
		got, ok := WriteFunctionCode(registerType)
		if !ok || got != want {
			t.Fatalf("WriteFunctionCode(%q) = %d, %v", registerType, got, ok)
		}
	}
	// `discrete_input`/`input_register` là read-only theo chính đặc tả Modbus.
	// Cấp cho chúng một mã ghi là mời người dùng thử một lệnh không tồn tại.
	for _, registerType := range []string{"discrete_input", "input_register"} {
		if _, ok := WriteFunctionCode(registerType); ok {
			t.Fatalf("vùng chỉ đọc %q vẫn có mã ghi", registerType)
		}
	}
}

func TestRegisterAbbreviationRefusesToInventSymbols(t *testing.T) {
	if got := RegisterAbbreviation("holding_register"); got != "HR" {
		t.Fatalf("RegisterAbbreviation = %q", got)
	}
	if got := RegisterAbbreviation("khong_ton_tai"); got != "" {
		t.Fatalf("vùng lạ được bịa ký hiệu %q", got)
	}
}

/* Cổng chống trôi: `BuildProfile` (thứ GHI XUỐNG `fieldbus.conf` và quyết định
 * dây thật đi FC nào) phải dùng CHÍNH `ReadFunctionCode`, không phải một bảng
 * chép tay thứ hai. Hai bảng song song là cách chắc chắn nhất để màn hình nói
 * FC03 trong khi dây nói FC04, và không cổng nào bắt được. */
func TestBuildProfileUsesTheSharedFunctionCodeTable(t *testing.T) {
	raw, err := os.ReadFile("persistence.go")
	if err != nil {
		t.Fatalf("không đọc được persistence.go: %v", err)
	}
	source := string(raw)
	if !strings.Contains(source, "ReadFunctionCode(point.RegisterType)") {
		t.Fatal("BuildProfile không gọi ReadFunctionCode")
	}
	inline := regexp.MustCompile(`map\[string\]int\{"coil":\s*1`)
	if inline.MatchString(source) {
		t.Fatal("persistence.go dựng lại bảng FC riêng — hai nguồn sự thật")
	}
}
