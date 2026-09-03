package application

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

func modbusEntry() PointCatalogEntry {
	return PointCatalogEntry{
		Category: "MB_RTU", PointID: "RETURN_TEMP", DeviceID: "bus-1-slave-3",
		DataType: "REAL", Direction: "READ_WRITE", Writable: true, Quality: "GOOD",
	}
}

func TestPointEligibilityLocalInputAndOutput(t *testing.T) {
	cases := []struct {
		name       string
		entry      PointCatalogEntry
		wantInput  string
		wantOutput string
	}{
		{
			name:       "UI đọc được, ghi vào là sai vật lý",
			entry:      PointCatalogEntry{Category: "LOCAL", PointID: "UI-03", DataType: "REAL", Direction: "READ"},
			wantInput:  MapEligibilitySupported,
			wantOutput: MapEligibilityIncompatible,
		},
		{
			name:       "AO nhận cả hai chiều",
			entry:      PointCatalogEntry{Category: "LOCAL", PointID: "AO-02", DataType: "REAL", Direction: "READ_WRITE", Writable: true},
			wantInput:  MapEligibilitySupported,
			wantOutput: MapEligibilitySupported,
		},
		{
			name:       "prefix ngoài allowlist io_map",
			entry:      PointCatalogEntry{Category: "LOCAL", PointID: "XX-01", DataType: "REAL", Direction: "READ"},
			wantInput:  MapEligibilityUnsupportedIdentity,
			wantOutput: MapEligibilityUnsupportedIdentity,
		},
		{
			name:       "DI khai REAL trái luật kiểu của Core",
			entry:      PointCatalogEntry{Category: "LOCAL", PointID: "DI-01", DataType: "REAL", Direction: "READ"},
			wantInput:  MapEligibilityUnsupportedIdentity,
			wantOutput: MapEligibilityUnsupportedIdentity,
		},
		{
			// F-PROG-ASBUILT-016 đã gỡ chặn chiều ghi của VP; ranh giới còn lại
			// là quyền sở hữu, và nó đã nằm trong `direction`/`writable`.
			name:       "VP do chương trình sở hữu nhận VAR_OUTPUT",
			entry:      PointCatalogEntry{Category: "VP", PointID: "AV-04", DataType: "REAL", Direction: "READ_WRITE", Writable: true},
			wantInput:  MapEligibilitySupported,
			wantOutput: MapEligibilitySupported,
		},
		{
			name:       "VP do web-api sở hữu chỉ đọc",
			entry:      PointCatalogEntry{Category: "VP", PointID: "AV-04", DataType: "REAL", Direction: "READ"},
			wantInput:  MapEligibilitySupported,
			wantOutput: MapEligibilityIncompatible,
		},
		{
			// Core đòi dạng `PREFIX-DIGITS`: thiếu gạch thì `UI3`/`UI30` nhập nhằng.
			name:       "định danh thiếu gạch nối bị từ chối như Core",
			entry:      PointCatalogEntry{Category: "LOCAL", PointID: "UI3", DataType: "REAL", Direction: "READ"},
			wantInput:  MapEligibilityUnsupportedIdentity,
			wantOutput: MapEligibilityUnsupportedIdentity,
		},
		{
			// Kênh đánh số từ 1; `UI-000` là chỉ số không tồn tại.
			name:       "số thứ tự toàn 0 bị từ chối như Core",
			entry:      PointCatalogEntry{Category: "LOCAL", PointID: "UI-000", DataType: "REAL", Direction: "READ"},
			wantInput:  MapEligibilityUnsupportedIdentity,
			wantOutput: MapEligibilityUnsupportedIdentity,
		},
		{
			name:       "category lạ bị từ chối fail-closed",
			entry:      PointCatalogEntry{Category: "BACNET", PointID: "AI-01", DataType: "REAL", Direction: "READ"},
			wantInput:  MapEligibilityUnsupportedByCore,
			wantOutput: MapEligibilityUnsupportedByCore,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := EvaluatePointMapEligibility(testCase.entry)
			if got.Input.Status != testCase.wantInput {
				t.Fatalf("input status = %s, muốn %s (lý do: %v)", got.Input.Status, testCase.wantInput, got.Input.Reasons)
			}
			if got.Output.Status != testCase.wantOutput {
				t.Fatalf("output status = %s, muốn %s (lý do: %v)", got.Output.Status, testCase.wantOutput, got.Output.Reasons)
			}
			assertReasonInvariant(t, got.Input)
			assertReasonInvariant(t, got.Output)
		})
	}
}

// assertReasonInvariant khoá bất biến "chặn thì phải nói vì sao". Một trạng thái
// chặn không kèm lý do là thứ FE không hiển thị nổi, và người dùng lại rơi đúng
// vào tình cảnh mà ISS-PIO-32 sinh ra để chấm dứt.
func assertReasonInvariant(t *testing.T, decision MapEligibility) {
	t.Helper()
	if decision.Status == MapEligibilitySupported && len(decision.Reasons) != 0 {
		t.Fatalf("SUPPORTED mà vẫn kèm lý do: %v", decision.Reasons)
	}
	if decision.Status != MapEligibilitySupported && len(decision.Reasons) == 0 {
		t.Fatalf("trạng thái %s không kèm lý do nào", decision.Status)
	}
}

// TestModbusUnlocksWhenCatalogPublishesExtIndex là bằng chứng cho điều kiện đóng
// thứ ba của ISS-PIO-32: Core mở một năng lực ⇒ FE tự nhận. Ở đây "năng lực mở"
// được mô phỏng bằng đúng dữ liệu còn thiếu (`extIndex` của ISS-PIO-31), và
// không dòng FE nào phải đổi để nhận nó.
func TestModbusUnlocksWhenCatalogPublishesExtIndex(t *testing.T) {
	pending := EvaluatePointMapEligibility(modbusEntry())
	if pending.Input.Status != MapEligibilityUnsupportedByCore {
		t.Fatalf("khi chưa có extIndex phải chặn, nhận %s", pending.Input.Status)
	}
	if !strings.Contains(strings.Join(pending.Input.Reasons, " "), "extIndex") {
		t.Fatalf("lý do phải nói ra thứ còn thiếu, nhận %v", pending.Input.Reasons)
	}
	// Lý do CŨ ở FE nói sai tầng; bản mới không được nói lại câu đó.
	if strings.Contains(strings.Join(pending.Input.Reasons, " "), "chưa resolve MB_RTU") {
		t.Fatalf("lý do vẫn đổ lỗi nhầm cho Core: %v", pending.Input.Reasons)
	}

	published := modbusEntry()
	published.ExtIndex = 7
	opened := EvaluatePointMapEligibility(published)
	if opened.Input.Status != MapEligibilitySupported || opened.Output.Status != MapEligibilitySupported {
		t.Fatalf("có extIndex thì phải mở cả hai chiều, nhận input=%s output=%s (%v / %v)",
			opened.Input.Status, opened.Output.Status, opened.Input.Reasons, opened.Output.Reasons)
	}

	readOnly := published
	readOnly.Direction = "READ"
	readOnly.Writable = false
	if got := EvaluatePointMapEligibility(readOnly); got.Output.Status != MapEligibilityIncompatible {
		t.Fatalf("điểm Modbus chỉ đọc không được nhận VAR_OUTPUT, nhận %s", got.Output.Status)
	}
}

func TestModbusRejectsTimeAndBadDeviceID(t *testing.T) {
	timed := modbusEntry()
	timed.ExtIndex = 2
	timed.DataType = "TIME"
	if got := EvaluatePointMapEligibility(timed); got.Input.Status != MapEligibilityUnsupportedIdentity {
		t.Fatalf("Core từ chối TIME cho MB_RTU, nhận %s", got.Input.Status)
	}

	orphan := modbusEntry()
	orphan.ExtIndex = 2
	orphan.DeviceID = ""
	if got := EvaluatePointMapEligibility(orphan); got.Input.Status != MapEligibilityUnsupportedIdentity {
		t.Fatalf("MB_RTU thiếu deviceId phải bị từ chối, nhận %s", got.Input.Status)
	}
}

// TestPointEligibilityMatchesCoreIoMap là CỔNG CHỐNG TRÔI.
//
// Bảng prefix ở Go là bản chép của `st_io_map.cpp`. Bản chép không có người canh
// chính là cách lỗi này đã sinh ra ở FE: nó đúng vào ngày viết, rồi Core đi tiếp
// một mình. Test này đọc thẳng file C++ và so, nên lần lệch tiếp theo đỏ ngay.
func TestPointEligibilityMatchesCoreIoMap(t *testing.T) {
	source := readCoreIoMapSource(t)

	localBlock := blockAfter(t, source, `entry.category == "LOCAL"`)
	vpBlock := blockAfter(t, source, `entry.category == "VP"`)

	assertPrefixSet(t, "LOCAL", localBlock, localPrefixType)
	assertPrefixSet(t, "VP", vpBlock, vpPrefixType)

	// Chiều ghi của LOCAL: Core cho phép đúng AO/DO.
	if !strings.Contains(localBlock, `!expect_output || prefix == "AO" || prefix == "DO"`) {
		t.Fatal("luật chiều ghi LOCAL ở st_io_map.cpp đã đổi; cập nhật localWritablePrefixes cùng lúc")
	}
	for prefix := range localPrefixType {
		if want := prefix == "AO" || prefix == "DO"; localWritablePrefixes[prefix] != want {
			t.Fatalf("localWritablePrefixes[%s] = %t, Core cho phép ghi = %t", prefix, localWritablePrefixes[prefix], want)
		}
	}

	// Hình dạng định danh: `splitNumberedID` là bản chép của `split_numbered_id`.
	shape := blockAfter(t, source, "bool split_numbered_id(")
	for _, rule := range []string{
		`point_id.find('-')`,
		"dash == 0",
		"digits.empty()",
		"all_zero",
	} {
		if !strings.Contains(shape, rule) {
			t.Fatalf("luật định danh %q không còn ở st_io_map.cpp; cập nhật splitNumberedID cùng lúc", rule)
		}
	}

	// MB_RTU: Core từ chối đúng kiểu TIME.
	modbusBlock := blockAfter(t, source, `entry.category == "MB_RTU"`)
	if !strings.Contains(modbusBlock, "entry.type != StType::TIME") {
		t.Fatal("luật kiểu của MB_RTU ở st_io_map.cpp đã đổi; cập nhật modbusEligibility cùng lúc")
	}
}

func readCoreIoMapSource(t *testing.T) string {
	t.Helper()
	root := repositoryRoot(t)
	path := filepath.Join(root, "apps", "core", "application", "st", "st_io_map.cpp")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("không đọc được authority C++ %s: %v", path, err)
	}
	return string(data)
}

func repositoryRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for depth := 0; depth < 10; depth++ {
		if _, err := os.Stat(filepath.Join(dir, "apps", "core", "application", "st", "st_io_map.cpp")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	t.Fatal("không tìm thấy gốc repository từ thư mục test")
	return ""
}

// blockAfter cắt đoạn mã ngay sau một nhánh `entry.category == "..."`. Cắt thô
// nhưng đủ: nếu Core đổi cấu trúc tới mức không tìm thấy mốc, test đỏ — đúng
// điều cần, vì lúc đó bảng chép ở đây cũng không còn đáng tin.
func blockAfter(t *testing.T, source, marker string) string {
	t.Helper()
	index := strings.Index(source, marker)
	if index < 0 {
		t.Fatalf("không thấy mốc %q trong st_io_map.cpp — cấu trúc authority đã đổi", marker)
	}
	rest := source[index:]
	if end := strings.Index(rest, "} else if"); end > 0 {
		return rest[:end]
	}
	if len(rest) > 1200 {
		return rest[:1200]
	}
	return rest
}

var cppPrefixPattern = regexp.MustCompile(`prefix == "([A-Z]+)"`)

func assertPrefixSet(t *testing.T, category, block string, table map[string]string) {
	t.Helper()
	seen := map[string]bool{}
	for _, match := range cppPrefixPattern.FindAllStringSubmatch(block, -1) {
		seen[match[1]] = true
	}
	core := make([]string, 0, len(seen))
	for prefix := range seen {
		core = append(core, prefix)
	}
	mine := make([]string, 0, len(table))
	for prefix := range table {
		mine = append(mine, prefix)
	}
	sort.Strings(core)
	sort.Strings(mine)
	if strings.Join(core, ",") != strings.Join(mine, ",") {
		t.Fatalf("allowlist %s lệch: st_io_map.cpp có [%s], bảng Go có [%s]",
			category, strings.Join(core, ","), strings.Join(mine, ","))
	}
}
