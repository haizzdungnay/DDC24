package application

import (
	"context"
	"encoding/json"
	"fmt"

	"mkddc-web/internal/programming/domain"
	programmingstore "mkddc-web/internal/programming/store"
)

// `ISS-PIO-31` / `AC-PIO-ID-01`+`AC-PIO-ID-02` — SLOT `ext` KHÔNG PHẢI DANH TÍNH.
//
// LỖ HỔNG ĐANG CÓ
// ---------------
// Binding bền lưu `point.extIndex` do FE ghi lúc chọn điểm, và đường Check
// CHUYỂN TIẾP thẳng con số đó xuống compiler (`ioMapFromRevision`). Nhưng slot
// `ext` được `iobus` cấp TUẦN TỰ trên tập thiết bị/điểm đang bật, nên ba thao
// tác cấu hình bình thường — đổi `pointId`, thêm/tắt điểm, tắt thiết bị — đều
// làm nó dịch chỗ. Một binding đã Commission trỏ `PUMP-02#14` sau khi tắt
// `VFD-01` sẽ trỏ vào thanh ghi của điểm KHÁC, và `st_io_map.cpp` chỉ kiểm
// `ext_index ∈ [1, KX_N_EXT]` nên 14 vẫn "hợp lệ": chương trình ghi lệnh bơm
// sai chỗ, không một dòng cảnh báo.
//
// NGUYÊN TẮC Ở ĐÂY
// ----------------
//  1. Danh tính bền của một điểm Modbus là `(deviceId, pointId)` — hai trường
//     người dùng đặt. `extIndex` chỉ là HANDLE RUNTIME, phân giải lại mỗi lần
//     nạp cấu hình (`AC-PIO-ID-01`).
//  2. Check phân giải lại `extIndex` từ cấu hình ĐANG CHẠY, không tin con số
//     lưu trong binding (`AC-PIO-ID-02`).
//  3. Lệch giữa số đã lưu và số phân giải lại ⇒ CHẶN, không tự remap. Tự remap
//     là im lặng đổi ý nghĩa của một binding người vận hành đã duyệt
//     (`AC-PIO-ID-03`).
//  4. Không có nguồn phân giải ⇒ CHẶN mọi binding MB_RTU. Thiếu bằng chứng
//     không phải bằng chứng khớp.

// ModbusSlot là một điểm Modbus cùng slot runtime của nó, theo quy ước 1-based
// của artifact/io_map.
type ModbusSlot struct {
	DeviceID string `json:"deviceId"`
	PointID  string `json:"pointId"`
	ExtIndex int    `json:"extIndex"`
	// Bốn trường dưới là PHẦN CÒN LẠI của chuỗi `AC-PIO-ID-02`:
	// `pointId → extIndex → bus / device / register / datatype / access`.
	//
	// Chỉ so `extIndex` là chưa đủ vì slot có thể GIỮ NGUYÊN số trong khi thứ
	// nó trỏ tới đã đổi hẳn: sửa `address`, đổi `holding_register` thành
	// `input_register`, đổi `uint16` thành `int32`, hay hạ `read_write` xuống
	// `read`. Cả bốn đều không làm slot dịch chỗ, và đều làm binding đã duyệt
	// đọc/ghi một thứ khác.
	RegisterType string `json:"registerType,omitempty"`
	Address      int    `json:"address,omitempty"`
	// AddressKnown nói `Address` có phải một giá trị ĐỌC ĐƯỢC hay chỉ là zero
	// value. Cần nó vì `address = 0` là thanh ghi hợp lệ (`modbusrtu/
	// validate.go`: `0..65535`), nên không thể dùng `Address != 0` làm dấu hiệu
	// "trường có mặt" như với ba trường chuỗi bên trên.
	//
	// Phía snapshot sống luôn đặt `true` (đọc thẳng từ cấu hình đang chạy);
	// phía manifest đặt theo việc JSON CÓ mang `address` hay không.
	AddressKnown bool   `json:"-"`
	DataType     string `json:"dataType,omitempty"`
	ReadWrite    string `json:"readWrite,omitempty"`
}

// SameTarget trả true khi hai mô tả trỏ tới CÙNG một thứ trên dây.
//
// So sánh bỏ qua trường rỗng ở phía manifest: package sinh TRƯỚC bản vá này
// không mang bốn trường mới, và coi "thiếu dữ liệu" là "lệch" sẽ chặn mọi
// package cũ dù chúng có thể vẫn đúng. Thiếu dữ liệu được xử lý ở tầng gọi
// (`AC-PIO-ID-03`), không bằng cách im lặng coi như khớp ở đây.
func (s ModbusSlot) SameTarget(other ModbusSlot) bool {
	if other.RegisterType != "" && s.RegisterType != other.RegisterType {
		return false
	}
	if other.AddressKnown && s.Address != other.Address {
		return false
	}
	if other.DataType != "" && s.DataType != other.DataType {
		return false
	}
	if other.ReadWrite != "" && s.ReadWrite != other.ReadWrite {
		return false
	}
	return true
}

// ModbusSlotSnapshot là ẢNH CHỤP bố cục slot tại một thời điểm.
//
// Chụp một lần cho mỗi lần Check chứ không tra từng binding: hai binding của
// cùng một package phải được phân giải trên CÙNG một cấu hình, nếu không một
// thay đổi xảy ra giữa chừng sẽ cho ra một package nửa cũ nửa mới.
type ModbusSlotSnapshot struct {
	// ConfigRevision nhận diện cấu hình đã dùng để phân giải. Rỗng nghĩa là
	// nguồn không phát hành mốc — khi đó fingerprint chỉ dựa vào chính các slot.
	ConfigRevision string
	Slots          []ModbusSlot
}

// VerifyBinding trả lý do CHẶN, hoặc chuỗi rỗng khi binding vẫn đúng.
//
// Đây là AUTHORITY duy nhất của `AC-PIO-ID-02`, gom cả hai nửa:
//
//  1. slot còn phân giải được từ danh tính bền và khớp số đã đóng dấu;
//  2. thứ slot TRỎ TỚI (register / address / datatype / access) không đổi.
//
// Cả Check, Commission lẫn bộ bằng chứng `5a…5g` của `ISS-PIO-36` đều đi qua
// đây. Ba đường gọi cùng một hàm là điều kiện để bằng chứng nói về đúng thứ
// đang chạy — ba bản cài riêng thì bằng chứng chỉ chứng minh cho chính nó.
func (s ModbusSlotSnapshot) VerifyBinding(binding ModbusSlot) string {
	if _, reason := resolveModbusExtIndex(&s, binding.DeviceID, binding.PointID,
		binding.ExtIndex); reason != "" {
		return reason
	}
	current, found := s.Lookup(binding.DeviceID, binding.PointID)
	if !found {
		return fmt.Sprintf("điểm %s#%s không còn trong cấu hình đang chạy", binding.DeviceID, binding.PointID)
	}
	if !current.SameTarget(binding) {
		return fmt.Sprintf("điểm %s#%s giữ nguyên slot %d nhưng đã trỏ sang thứ khác "+
			"(register/địa chỉ/kiểu/quyền); cần rebind rồi Commission lại",
			binding.DeviceID, binding.PointID, binding.ExtIndex)
	}
	return ""
}

// ModbusSlotProvider được `internal/app` implement (adapter quanh cấu hình
// fieldbus + `modbusrtu.BuildExtLayout`). `application` KHÔNG import
// `internal/app` — interface đứng ở đây theo đúng hướng phụ thuộc, giống
// `PointCatalogProvider`.
type ModbusSlotProvider interface {
	ResolveModbusSlots(ctx context.Context) (ModbusSlotSnapshot, error)
}

// Lookup tra theo danh tính bền.
func (s ModbusSlotSnapshot) Lookup(deviceID, pointID string) (ModbusSlot, bool) {
	for _, slot := range s.Slots {
		if slot.DeviceID == deviceID && slot.PointID == pointID {
			return slot, true
		}
	}
	return ModbusSlot{}, false
}

// AtExtIndex tra ngược để nói ĐÚNG người dùng đang trỏ vào cái gì. Một thông
// báo "slot 14 nay thuộc về VFD-02#PRESSURE" cho người vận hành biết ngay mức
// độ nguy hiểm; "extIndex không khớp" thì không.
func (s ModbusSlotSnapshot) AtExtIndex(extIndex int) (ModbusSlot, bool) {
	for _, slot := range s.Slots {
		if slot.ExtIndex == extIndex {
			return slot, true
		}
	}
	return ModbusSlot{}, false
}

// resolveModbusExtIndex phân giải slot cho MỘT binding và trả lý do chặn nếu
// không phân giải được hoặc lệch với số đã lưu.
//
// `stored == 0` là binding CHƯA từng được đóng dấu slot — không phải lệch, mà
// là lần phân giải đầu tiên.
func resolveModbusExtIndex(snapshot *ModbusSlotSnapshot, deviceID, pointID string, stored int) (int, string) {
	if snapshot == nil {
		return 0, fmt.Sprintf("không có nguồn phân giải slot Modbus nên không xác minh được binding %s#%s; "+
			"Check dừng thay vì tin con số đã lưu", deviceID, pointID)
	}
	slot, ok := snapshot.Lookup(deviceID, pointID)
	if !ok {
		reason := fmt.Sprintf("điểm %s#%s không còn trong cấu hình đang chạy "+
			"(bị tắt, bị xoá, hoặc thiết bị đã tắt)", deviceID, pointID)
		if stored > 0 {
			if occupant, taken := snapshot.AtExtIndex(stored); taken {
				reason += fmt.Sprintf("; slot %d mà binding đang mang nay thuộc về %s#%s",
					stored, occupant.DeviceID, occupant.PointID)
			}
		}
		return 0, reason
	}
	if stored != 0 && stored != slot.ExtIndex {
		reason := fmt.Sprintf("binding %s#%s mang slot %d nhưng điểm đó nay ở slot %d",
			deviceID, pointID, stored, slot.ExtIndex)
		if occupant, taken := snapshot.AtExtIndex(stored); taken {
			reason += fmt.Sprintf("; slot %d nay thuộc về %s#%s", stored, occupant.DeviceID, occupant.PointID)
		}
		reason += "; cần rebind rồi Commission lại — hệ thống KHÔNG tự chuyển slot"
		return 0, reason
	}
	return slot.ExtIndex, ""
}

// verifyModbusSlots đối chiếu manifest as-built của một Check PASSED với bố cục
// slot HIỆN TẠI, ngay trước khi activate (`AC-PIO-ID-02`).
//
// Vì sao không đủ nếu chỉ kiểm ở Check: giữa lúc Check xanh và lúc bấm
// Commission, cấu hình fieldbus vẫn có thể đổi — tắt một thiết bị, đổi tên một
// điểm, thêm một điểm. Một package "đã PASSED" không nói gì về cấu hình HIỆN
// TẠI, và đúng khoảng trống đó là nơi lỗi ghi sai thanh ghi đi qua.
//
// Không tự remap ở đây, cũng như ở Check: lệch ⇒ chặn, người vận hành rebind
// rồi Check lại. Bản LKG đang chạy giữ nguyên (`AC-PIO-ID-03`).
func (s *OperationService) verifyModbusSlots(ctx context.Context, check programmingstore.Check) error {
	mismatches, err := s.modbusSlotMismatches(ctx, check)
	if err != nil {
		return err
	}
	if len(mismatches) > 0 {
		return publicOperationError(domain.ErrMapIdentity, true)
	}
	return nil
}

// modbusSlotMismatches đối chiếu manifest as-built với bố cục slot HIỆN TẠI và
// trả về DANH SÁCH lý do lệch, tách bạch khỏi các lỗi "không kiểm được".
//
// Vì sao tách hai loại kết quả (`ISS-PIO-38`, #492):
//   - `err != nil` là "KHÔNG kiểm được" — manifest không đọc nổi, chưa có
//     resolver, hoặc cấu hình fieldbus không phân giải được. Không chứng minh
//     được slot khớp thì cũng không được coi là khớp; ca này CHẶN cả COMMISSION
//     lẫn RESTORE và KHÔNG có đường thoát, vì đường thoát đòi người vận hành đọc
//     một cảnh báo cụ thể mà ở đây ta không có gì cụ thể để đưa ra.
//   - danh sách lệch (`err == nil`, `len > 0`) là "kiểm được, và lệch". Đây mới
//     là ca `AC-PIO-ID-02` mô tả, và là ca RESTORE được phép đi qua bằng một
//     xác nhận tường minh có ghi audit (#492 phương án 3).
//
// Trả về chuỗi mô tả từng lệch — không phải một cờ bool — để audit của một
// RESTORE có đường thoát ghi lại ĐÚNG những binding nào đã lệch, chứ không chỉ
// "đã ghi đè điều gì đó".
func (s *OperationService) modbusSlotMismatches(ctx context.Context, check programmingstore.Check) ([]string, error) {
	bindings, err := manifestModbusBindings(check.ResultJSON)
	if err != nil {
		return nil, err
	}
	if len(bindings) == 0 {
		return nil, nil
	}
	if s.modbusSlots == nil {
		return nil, publicOperationError(domain.ErrMapIdentity, true)
	}
	snapshot, err := s.modbusSlots.ResolveModbusSlots(ctx)
	if err != nil {
		return nil, err
	}
	var mismatches []string
	for _, binding := range bindings {
		/* Một hàm, không hai. `VerifyBinding` gom cả hai nửa của
		 * `AC-PIO-ID-02` — slot còn đúng, và thứ slot trỏ tới còn đúng — nên
		 * Commission, Check và bộ bằng chứng `5a…5g` không thể trôi khỏi nhau. */
		if reason := snapshot.VerifyBinding(binding); reason != "" {
			mismatches = append(mismatches, reason)
		}
	}
	return mismatches, nil
}

// manifestModbusBindings đọc phần binding MB_RTU của manifest as-built.
//
// Manifest rỗng hoặc không đọc được KHÔNG được coi là "không có binding Modbus":
// đó là một package không tự mô tả được, và cho nó đi tiếp là bỏ đúng phép kiểm
// này. Trả lỗi để Commission dừng.
func manifestModbusBindings(resultJSON []byte) ([]ModbusSlot, error) {
	if len(resultJSON) == 0 {
		return nil, nil
	}
	var document struct {
		Manifest struct {
			Bindings []struct {
				Category     string `json:"category"`
				PointID      string `json:"pointId"`
				DeviceID     string `json:"deviceId"`
				ExtIndex     int    `json:"extIndex"`
				RegisterType string `json:"registerType"`
				// `*int`: phân biệt "manifest cũ không mang address" với
				// "address = 0", vì 0 là thanh ghi hợp lệ.
				Address    *int   `json:"address"`
				ModbusType string `json:"modbusDataType"`
				ReadWrite  string `json:"readWrite"`
			} `json:"bindings"`
		} `json:"manifest"`
	}
	if err := json.Unmarshal(resultJSON, &document); err != nil {
		return nil, publicOperationError(domain.ErrMapIdentity, true)
	}
	result := make([]ModbusSlot, 0, len(document.Manifest.Bindings))
	for _, binding := range document.Manifest.Bindings {
		if binding.Category != "MB_RTU" {
			continue
		}
		slot := ModbusSlot{DeviceID: binding.DeviceID, PointID: binding.PointID,
			ExtIndex: binding.ExtIndex, RegisterType: binding.RegisterType,
			DataType: binding.ModbusType, ReadWrite: binding.ReadWrite}
		if binding.Address != nil {
			slot.Address = *binding.Address
			slot.AddressKnown = true
		}
		result = append(result, slot)
	}
	return result, nil
}
