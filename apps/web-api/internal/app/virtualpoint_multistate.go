package app

import (
	"fmt"
	"sort"
	"strings"
)

/* `ISS-PIO-17`/`F-PIO-014` — KIỂU MULTISTATE CHO VIRTUAL POINT (đề bài §15).
 *
 * Triệu chứng: Core có sẵn `msv[KX_N_MSV]` (8 slot) và `SchedulePointKind` đã
 * biết `'MSV'`, nhưng KHÔNG có đường nào khai danh sách state/label:
 *
 *     0 = Off · 1 = Auto · 2 = Manual · 3 = Emergency
 *
 * Nên tám slot đó không ai với tới được từ sản phẩm.
 *
 * Danh sách state ở đây KHÔNG phải nhãn trang trí. Nó cưỡng chế ba thứ:
 *   1. Lệnh ghi một state KHÔNG được khai bị TỪ CHỐI (`checkVirtualPointState`).
 *   2. Giá trị khởi tạo phải là một state có thật.
 *   3. Giao diện hiện nhãn thay cho con số trần.
 *
 * Chưa cưỡng chế (nêu rõ thay vì để người đọc tự đoán): `state_text` và
 * `number_of_states` của đối tượng BACnet MSV vẫn là mặc định của
 * `bacnet_objects.cpp`. Nhãn muốn tới đó phải đi qua một đường cấu hình mà
 * `iobus` hiện KHÔNG có — `virtual_points.conf` do web-api đọc, không phải
 * iobus — nên đó là một mẩu việc riêng, không phải phần bỏ quên của mẩu này.
 */

// virtualPointStateMinCount — dưới hai state thì không có gì để chọn, và một
// "multistate" một state là một hằng số đội lốt điểm.
const virtualPointStateMinCount = 2

// virtualPointStateMaxCount — trần thực dụng. BACnet MSV đánh số state bằng
// một số nguyên nhỏ và bảng nhãn dài hơn thế không còn dùng nổi trên HMI.
const virtualPointStateMaxCount = 64

// virtualPointStateMaxValue — state là chỉ số rời rạc, không phải giá trị đo.
// Trần này giữ nó nằm gọn trong `uint32` mà `dataType` quảng cáo.
const virtualPointStateMaxValue = 65535

// validateVirtualPointStates kiểm danh sách state của MỘT điểm.
//
// Ghi lỗi vào `errs` theo đúng đường dẫn trường, để giao diện chỉ được vào ô
// sai thay vì báo "cấu hình hỏng" ở mức cả điểm.
func validateVirtualPointStates(item VirtualPoint, base string, errs *[]configValidationError) {
	if !virtualPointMultistate(item.SignalType) {
		// Khai `states` cho kiểu khác là hiểu nhầm cần nói ra: nó sẽ không
		// cưỡng chế gì cả, và im lặng bỏ qua sẽ để người dùng tin rằng có.
		if len(item.States) > 0 {
			addConfigErr(errs, base+".states", "states chỉ dùng cho signalType multistate")
		}
		return
	}
	if len(item.States) < virtualPointStateMinCount {
		addConfigErr(errs, base+".states", fmt.Sprintf("multistate cần ít nhất %d state", virtualPointStateMinCount))
		return
	}
	if len(item.States) > virtualPointStateMaxCount {
		addConfigErr(errs, base+".states", fmt.Sprintf("multistate nhận tối đa %d state", virtualPointStateMaxCount))
		return
	}

	seenValue := map[int]int{}
	seenLabel := map[string]int{}
	for index, state := range item.States {
		path := fmt.Sprintf("%s.states[%d]", base, index)
		if state.Value < 0 || state.Value > virtualPointStateMaxValue {
			addConfigErr(errs, path+".value", fmt.Sprintf("must be integer in range 0..%d", virtualPointStateMaxValue))
		}
		if first, dup := seenValue[state.Value]; dup {
			addConfigErr(errs, path+".value", fmt.Sprintf("trùng giá trị với states[%d]", first))
		} else {
			seenValue[state.Value] = index
		}

		label := strings.TrimSpace(state.Label)
		if label == "" {
			addConfigErr(errs, path+".label", "nhãn state không được rỗng")
			continue
		}
		// So không phân biệt hoa thường: hai nhãn "Auto" và "auto" trên cùng
		// một điểm là hai lựa chọn người vận hành không phân biệt nổi.
		key := strings.ToLower(label)
		if first, dup := seenLabel[key]; dup {
			addConfigErr(errs, path+".label", fmt.Sprintf("trùng nhãn với states[%d]", first))
		} else {
			seenLabel[key] = index
		}
	}
}

func virtualPointMultistate(signalType string) bool {
	return strings.ToLower(strings.TrimSpace(signalType)) == virtualPointSignalMultistate
}

// normalizeVirtualPointStates cắt khoảng trắng nhãn và sắp theo `value`.
//
// Sắp xếp là quyết định có chủ ý: thứ tự khai báo không mang thông tin gì, còn
// một danh sách sắp theo giá trị thì đọc được ngay trên HMI và trên tệp cấu
// hình. Nó KHÔNG đánh số lại — giá trị là danh tính của state, không phải vị
// trí trong mảng.
func normalizeVirtualPointStates(states []VirtualPointState) []VirtualPointState {
	if len(states) == 0 {
		return nil
	}
	next := make([]VirtualPointState, len(states))
	copy(next, states)
	for i := range next {
		next[i].Label = strings.TrimSpace(next[i].Label)
	}
	sort.SliceStable(next, func(a, b int) bool { return next[a].Value < next[b].Value })
	return next
}

// virtualPointStateError là lỗi ghi vào một state KHÔNG được khai.
//
// Kiểu riêng chứ không phải `error` trần, vì `handleForcePoint` phải ánh xạ nó
// thành 400 (lỗi của yêu cầu) chứ không phải 409 (xung đột trạng thái).
type virtualPointStateError struct {
	PointID string
	Value   int64
	States  []VirtualPointState
}

func (e virtualPointStateError) Error() string {
	return fmt.Sprintf("%s: state %d không có trong danh sách khai báo (%s)",
		e.PointID, e.Value, describeVirtualPointStates(e.States))
}

func describeVirtualPointStates(states []VirtualPointState) string {
	if len(states) == 0 {
		return "chưa khai state nào"
	}
	parts := make([]string, 0, len(states))
	for _, state := range states {
		parts = append(parts, fmt.Sprintf("%d=%s", state.Value, state.Label))
	}
	return strings.Join(parts, ", ")
}

// checkVirtualPointState từ chối lệnh ghi vào state chưa khai.
//
// KHÔNG kẹp về state gần nhất: kẹp im lặng trả 200 cho một lệnh đã bị đổi
// nghĩa, và với một điểm chế độ vận hành thì "gần nhất" không có nghĩa gì —
// giữa `Manual` và `Emergency` không có nửa đường.
func checkVirtualPointState(item VirtualPoint, value any) error {
	if !virtualPointMultistate(item.SignalType) {
		return nil
	}
	number, ok := virtualPointNumber(value)
	if !ok {
		return virtualPointStateError{PointID: item.ID, States: item.States}
	}
	/* Số phân số KHÔNG được cắt phần thập phân để so.
	 *
	 * `int64(2.5)` cho 2 — một state có thật — nên nếu cắt ở đây thì lệnh ghi
	 * `2.5` sẽ ÂM THẦM trở thành `Manual`. Đó đúng là kiểu hỏng mà `checkVirtualPointState`
	 * sinh ra để chặn: một lệnh bị đổi nghĩa mà vẫn trả về thành công. */
	state := int64(number)
	if number != float64(state) {
		return virtualPointStateError{PointID: item.ID, Value: state, States: item.States}
	}
	for _, declared := range item.States {
		if int64(declared.Value) == state {
			return nil
		}
	}
	return virtualPointStateError{PointID: item.ID, Value: state, States: item.States}
}

// virtualPointStateLabel trả nhãn của một giá trị. Rỗng = giá trị không thuộc
// danh sách; consumer hiện con số trần chứ KHÔNG bịa nhãn.
func virtualPointStateLabel(item VirtualPoint, value any) string {
	number, ok := virtualPointNumber(value)
	if !ok {
		return ""
	}
	for _, state := range item.States {
		if int64(state.Value) == int64(number) {
			return state.Label
		}
	}
	return ""
}

/* validateVirtualPointStateValues kiểm `value`/`initialValue` của một điểm
 * multistate PHẢI là state đã khai.
 *
 * Tách khỏi `validateVirtualPointStates` vì hai câu hỏi khác nhau: cái kia hỏi
 * "danh sách có hợp lệ không", cái này hỏi "giá trị đang lưu có thuộc danh sách
 * không". Một cấu hình khai đúng danh sách nhưng `value: 7` sẽ khởi động ở một
 * state không tồn tại, và Core không có cách nào biết điều đó. */
func validateVirtualPointStateValues(item VirtualPoint, base string, errs *[]configValidationError) {
	if !virtualPointMultistate(item.SignalType) || len(item.States) == 0 {
		return
	}
	if item.Value != nil {
		if err := checkVirtualPointState(item, item.Value); err != nil {
			addConfigErr(errs, base+".value", err.Error())
		}
	}
	if item.InitialValue != nil {
		if err := checkVirtualPointState(item, item.InitialValue); err != nil {
			addConfigErr(errs, base+".initialValue", err.Error())
		}
	}
}
