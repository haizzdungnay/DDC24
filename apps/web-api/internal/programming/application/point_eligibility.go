package application

import (
	"fmt"
	"strings"
)

// ISS-PIO-32 — MỘT authority duy nhất quyết định một Point có bind được vào
// biến của Program hay không.
//
// VÌ SAO FILE NÀY TỒN TẠI
// -----------------------
// Trước đó FE tự giữ một bản luật thứ hai (`mappingViewModel.ts`): allowlist
// prefix `UI/DI/AO/DO/AV/BV/MSV`, bảng `PREFIX_TYPE`, và hai câu chặn cứng theo
// category. Bản thứ hai ấy ĐÃ TRÔI khỏi Core theo cả hai hướng:
//
//   1. FE nói *"Core Rev A chưa resolve MB_RTU trong ST io_map"* — sai:
//      `st_io_map.cpp` resolve `MB_RTU` → `StPointKind::EXT` từ trước baseline,
//      và `checks_invariants.go` còn có luật chống trùng thanh ghi riêng cho nó.
//   2. FE nói *"VP hiện chỉ hỗ trợ VAR_INPUT"* — cũng sai:
//      `F-PROG-ASBUILT-016` đã gỡ chặn chiều ghi, và `pointCatalogDirection`
//      ở web-api đã trả `READ_WRITE` cho VP do CHƯƠNG TRÌNH sở hữu. Luật cứng ở
//      FE vì thế chặn một năng lực đang chạy được.
//
// Người dùng đọc một lý do sai còn tệ hơn không đọc gì: họ đi sửa nhầm chỗ. Từ
// đây server quyết định và PHÁT KÈM LÝ DO; FE chỉ trình bày.
//
// RANH GIỚI CỦA AUTHORITY NÀY
// ---------------------------
// Nó trả lời câu hỏi thuộc về ĐIỂM: identity có nằm trong allowlist io_map của
// Core không, category có bind được chưa, và chiều nào hợp lệ. Nó KHÔNG so
// kiểu/đơn vị với một biến cụ thể — việc đó cần cả hai vế và vẫn do lớp trình
// bày ghép, dựa trên `dataType`/`unit`/`writable` do CHÍNH server phát ra.

// MapEligibilityStatus giữ đúng tập trạng thái mà FE hiển thị. Thêm giá trị mới
// là thay đổi hợp đồng, không phải chi tiết cài đặt.
const (
	MapEligibilitySupported           = "SUPPORTED"
	MapEligibilityUnsupportedByCore   = "UNSUPPORTED_BY_CORE"
	MapEligibilityUnsupportedIdentity = "UNSUPPORTED_IDENTITY"
	MapEligibilityIncompatible        = "INCOMPATIBLE"
)

// MapEligibility là quyết định cho MỘT chiều binding.
//
// `Reasons` luôn rỗng khi `Status == SUPPORTED`, và luôn KHÁC rỗng khi không:
// một trạng thái chặn mà không kèm lý do là thứ FE không có cách nào hiển thị
// cho ra hồn, nên bất biến đó được test khoá lại.
type MapEligibility struct {
	Status  string   `json:"status"`
	Reasons []string `json:"reasons"`
}

// PointMapEligibility là quyết định cho CẢ HAI chiều, phát kèm mỗi entry của
// Point Catalog.
type PointMapEligibility struct {
	Input  MapEligibility `json:"input"`
	Output MapEligibility `json:"output"`
}

// localPrefixType và vpPrefixType chép ĐÚNG bảng của `st_io_map.cpp`
// (`local_prefix_to_point_kind` / `vp_prefix_to_point_kind` cùng nhánh
// `type_valid`). Chúng KHÔNG được sửa rời: `TestPointEligibilityMatchesCoreIoMap`
// đọc thẳng file C++ và bắt lệch — vì bảng chép tay không có người canh chính
// là cách lỗi này đã sinh ra ở FE.
var (
	localPrefixType = map[string]string{"UI": "REAL", "DI": "BOOL", "AO": "REAL", "DO": "BOOL"}
	vpPrefixType    = map[string]string{"AV": "REAL", "BV": "BOOL", "MSV": "UINT"}
)

// localWritablePrefixes — chỉ AO/DO là đích ghi vật lý. UI/DI là đầu vào; ghi
// vào đó không phải "chưa hỗ trợ" mà là sai vật lý.
var localWritablePrefixes = map[string]bool{"AO": true, "DO": true}

// splitNumberedID chép ĐÚNG `split_numbered_id` của `st_io_map.cpp`: định danh
// phải là `PREFIX-DIGITS`, dấu gạch bắt buộc và không được đứng đầu, phần sau
// gạch phải toàn chữ số và KHÔNG được toàn số 0.
//
// Ba luật nhỏ ấy đều có lý do: thiếu gạch thì `UI3` và `UI30` nhập nhằng; toàn
// số 0 là chỉ số kênh không tồn tại (kênh đánh số từ 1). Cài lỏng hơn Core ở
// đây nghĩa là mời người dùng chọn một binding mà compiler sẽ từ chối ở Check —
// đúng loại "hỏng muộn" mà ISS-PIO-32 sinh ra để chấm dứt.
func splitNumberedID(pointID string) (prefix string, ok bool) {
	dash := strings.Index(pointID, "-")
	if dash <= 0 {
		return "", false
	}
	digits := pointID[dash+1:]
	if digits == "" {
		return "", false
	}
	allZero := true
	for _, char := range digits {
		if char < '0' || char > '9' {
			return "", false
		}
		if char != '0' {
			allZero = false
		}
	}
	if allZero {
		return "", false
	}
	return pointID[:dash], true
}

func blocked(status, reason string) MapEligibility {
	return MapEligibility{Status: status, Reasons: []string{reason}}
}

func supported() MapEligibility {
	return MapEligibility{Status: MapEligibilitySupported, Reasons: []string{}}
}

// EvaluatePointMapEligibility là authority. Không có đường nào khác được phép
// quyết định eligibility — kể cả FE.
func EvaluatePointMapEligibility(entry PointCatalogEntry) PointMapEligibility {
	switch entry.Category {
	case "LOCAL":
		return localEligibility(entry)
	case "VP":
		return vpEligibility(entry)
	case "MB_RTU":
		return modbusEligibility(entry)
	default:
		reason := fmt.Sprintf("Category %q không nằm trong allowlist io_map của Core (LOCAL, VP, MB_RTU)", entry.Category)
		return PointMapEligibility{
			Input:  blocked(MapEligibilityUnsupportedByCore, reason),
			Output: blocked(MapEligibilityUnsupportedByCore, reason),
		}
	}
}

func localEligibility(entry PointCatalogEntry) PointMapEligibility {
	prefix, numbered := splitNumberedID(entry.PointID)
	expected, known := localPrefixType[prefix]
	if !numbered || !known || entry.DeviceID != "" {
		reason := fmt.Sprintf("Điểm LOCAL phải có định danh %s kèm số thứ tự và không mang deviceId; Core từ chối %q",
			strings.Join(sortedPrefixes(localPrefixType), "/"), entry.PointID)
		return PointMapEligibility{
			Input:  blocked(MapEligibilityUnsupportedIdentity, reason),
			Output: blocked(MapEligibilityUnsupportedIdentity, reason),
		}
	}
	if entry.DataType != expected {
		reason := fmt.Sprintf("Core yêu cầu %s cho điểm %s, catalog đang phát %s", expected, prefix, entry.DataType)
		return PointMapEligibility{
			Input:  blocked(MapEligibilityUnsupportedIdentity, reason),
			Output: blocked(MapEligibilityUnsupportedIdentity, reason),
		}
	}

	result := PointMapEligibility{Input: supported(), Output: supported()}
	if !localWritablePrefixes[prefix] {
		result.Output = blocked(MapEligibilityIncompatible,
			fmt.Sprintf("%s là ngõ vào vật lý; chỉ AO/DO nhận được VAR_OUTPUT", prefix))
	}
	return applyServerDirection(entry, result)
}

func vpEligibility(entry PointCatalogEntry) PointMapEligibility {
	prefix, numbered := splitNumberedID(entry.PointID)
	expected, known := vpPrefixType[prefix]
	if !numbered || !known || entry.DeviceID != "" {
		reason := fmt.Sprintf("Điểm VP phải có định danh %s kèm số thứ tự và không mang deviceId; Core từ chối %q",
			strings.Join(sortedPrefixes(vpPrefixType), "/"), entry.PointID)
		return PointMapEligibility{
			Input:  blocked(MapEligibilityUnsupportedIdentity, reason),
			Output: blocked(MapEligibilityUnsupportedIdentity, reason),
		}
	}
	if entry.DataType != expected {
		reason := fmt.Sprintf("Core yêu cầu %s cho điểm %s, catalog đang phát %s", expected, prefix, entry.DataType)
		return PointMapEligibility{
			Input:  blocked(MapEligibilityUnsupportedIdentity, reason),
			Output: blocked(MapEligibilityUnsupportedIdentity, reason),
		}
	}

	/* Chiều ghi của VP do QUYỀN SỞ HỮU quyết định, không do compiler cấm
	 * (`F-PROG-ASBUILT-016`). `pointCatalogDirection` đã mã hoá đúng ranh giới
	 * đó thành `direction`/`writable`, nên `applyServerDirection` bên dưới là
	 * nơi duy nhất cần đọc: VP do web-api sở hữu ra `READ`, và VAR_OUTPUT vào
	 * đó sẽ bị vòng đối chiếu cấu hình kéo về mỗi 10 giây. */
	return applyServerDirection(entry, PointMapEligibility{Input: supported(), Output: supported()})
}

func modbusEligibility(entry PointCatalogEntry) PointMapEligibility {
	if !validModbusDeviceID(entry.DeviceID) {
		reason := fmt.Sprintf("Điểm MB_RTU phải mang deviceId dạng bus-<n>-slave-<m>; catalog đang phát %q", entry.DeviceID)
		return PointMapEligibility{
			Input:  blocked(MapEligibilityUnsupportedIdentity, reason),
			Output: blocked(MapEligibilityUnsupportedIdentity, reason),
		}
	}
	/* Core RESOLVE được MB_RTU (`st_io_map.cpp` → `StPointKind::EXT`); thứ còn
	 * thiếu là dữ liệu: binding cần `extIndex` — slot EXT do Catalog cấp — mà
	 * catalog chưa phát (ISS-PIO-31). Nói "Core chưa hỗ trợ" ở đây là đổ lỗi
	 * nhầm tầng và làm người dùng đi tìm ở compiler.
	 *
	 * Khi ISS-PIO-31 phát `extIndex`, chính hàm này mở khoá — không cần sửa FE,
	 * và cũng không cần sửa dòng nào ở đây. */
	if entry.ExtIndex <= 0 {
		reason := "Catalog chưa phát extIndex cho điểm Modbus nên chưa dựng được binding (ISS-PIO-31); Core đã resolve MB_RTU"
		return PointMapEligibility{
			Input:  blocked(MapEligibilityUnsupportedByCore, reason),
			Output: blocked(MapEligibilityUnsupportedByCore, reason),
		}
	}
	if strings.EqualFold(entry.DataType, "TIME") {
		reason := "Core từ chối kiểu TIME cho điểm MB_RTU trong io_map"
		return PointMapEligibility{
			Input:  blocked(MapEligibilityUnsupportedIdentity, reason),
			Output: blocked(MapEligibilityUnsupportedIdentity, reason),
		}
	}
	return applyServerDirection(entry, PointMapEligibility{Input: supported(), Output: supported()})
}

// applyServerDirection áp `direction`/`writable` mà chính server đã tính. Đây là
// chỗ ownership của VP và cờ writable của Modbus đi vào quyết định, nên không
// tầng nào phải suy lại chúng.
func applyServerDirection(entry PointCatalogEntry, result PointMapEligibility) PointMapEligibility {
	if !strings.EqualFold(entry.Direction, "READ") && !strings.EqualFold(entry.Direction, "READ_WRITE") {
		result.Input = blocked(MapEligibilityIncompatible,
			fmt.Sprintf("Point không cho đọc (direction=%s) nên không nhận được VAR_INPUT", entry.Direction))
	}
	if result.Output.Status == MapEligibilitySupported {
		writable := entry.Writable && (strings.EqualFold(entry.Direction, "WRITE") || strings.EqualFold(entry.Direction, "READ_WRITE"))
		if !writable {
			result.Output = blocked(MapEligibilityIncompatible,
				fmt.Sprintf("Point không cho ghi (direction=%s, writable=%t) nên không nhận được VAR_OUTPUT",
					entry.Direction, entry.Writable))
		}
	}
	return result
}

func validModbusDeviceID(deviceID string) bool {
	return strings.HasPrefix(deviceID, "bus-") && strings.Contains(deviceID, "-slave-")
}

func sortedPrefixes(table map[string]string) []string {
	keys := make([]string, 0, len(table))
	for key := range table {
		keys = append(keys, key)
	}
	for outer := 1; outer < len(keys); outer++ {
		for inner := outer; inner > 0 && keys[inner] < keys[inner-1]; inner-- {
			keys[inner], keys[inner-1] = keys[inner-1], keys[inner]
		}
	}
	return keys
}
