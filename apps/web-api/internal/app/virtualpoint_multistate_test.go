package app

import (
	"strings"
	"testing"
)

/* `ISS-PIO-17`/`F-PIO-014` — kiểu `multistate` cho Virtual Point (đề bài §15).
 *
 * Core có sẵn `msv[KX_N_MSV]` và `SchedulePointKind` đã biết `'MSV'`, nhưng
 * trước bản vá KHÔNG có đường nào khai danh sách state/label — nên tám slot đó
 * không ai với tới được từ sản phẩm. */

func multistateFixture() VirtualPoint {
	return VirtualPoint{
		ID: "VP1", SignalType: virtualPointSignalMultistate, Enabled: true, Writable: true,
		States: []VirtualPointState{
			{Value: 0, Label: "Off"}, {Value: 1, Label: "Auto"},
			{Value: 2, Label: "Manual"}, {Value: 3, Label: "Emergency"},
		},
	}
}

func stateMessages(t *testing.T, item VirtualPoint) map[string]string {
	t.Helper()
	var errs []configValidationError
	validateVirtualPointStates(item, "items[0]", &errs)
	validateVirtualPointStateValues(item, "items[0]", &errs)
	out := map[string]string{}
	for _, err := range errs {
		out[err.Path] = err.Message
	}
	return out
}

func TestMultistateIsAValidSignalType(t *testing.T) {
	if !validVirtualPointSignalType(virtualPointSignalMultistate) {
		t.Fatal("multistate bị từ chối như một signalType lạ")
	}
}

func TestMultistateAcceptsTheSpecExample(t *testing.T) {
	if messages := stateMessages(t, multistateFixture()); len(messages) != 0 {
		t.Fatalf("ví dụ 0=Off/1=Auto/2=Manual/3=Emergency bị từ chối: %#v", messages)
	}
}

func TestMultistateNeedsAtLeastTwoStates(t *testing.T) {
	// Một "multistate" một state là một hằng số đội lốt điểm.
	item := multistateFixture()
	item.States = []VirtualPointState{{Value: 0, Label: "Off"}}
	if messages := stateMessages(t, item); !strings.Contains(messages["items[0].states"], "ít nhất") {
		t.Fatalf("danh sách một state đi lọt: %#v", messages)
	}

	item.States = nil
	if messages := stateMessages(t, item); messages["items[0].states"] == "" {
		t.Fatalf("multistate không khai state nào đi lọt: %#v", messages)
	}
}

func TestMultistateRejectsDuplicateValuesAndLabels(t *testing.T) {
	item := multistateFixture()
	item.States = []VirtualPointState{
		{Value: 1, Label: "Auto"}, {Value: 1, Label: "Manual"},
	}
	if messages := stateMessages(t, item); !strings.Contains(messages["items[0].states[1].value"], "trùng giá trị") {
		t.Fatalf("hai state cùng giá trị đi lọt: %#v", messages)
	}

	// Nhãn so KHÔNG phân biệt hoa thường: "Auto" và "auto" trên cùng một điểm
	// là hai lựa chọn người vận hành không phân biệt nổi trên màn hình.
	item.States = []VirtualPointState{{Value: 0, Label: "Auto"}, {Value: 1, Label: "auto"}}
	if messages := stateMessages(t, item); !strings.Contains(messages["items[0].states[1].label"], "trùng nhãn") {
		t.Fatalf("hai nhãn khác hoa thường đi lọt: %#v", messages)
	}
}

func TestMultistateRejectsEmptyLabelAndNegativeValue(t *testing.T) {
	item := multistateFixture()
	item.States = []VirtualPointState{{Value: 0, Label: "  "}, {Value: -1, Label: "Auto"}}
	messages := stateMessages(t, item)
	if messages["items[0].states[0].label"] == "" {
		t.Fatalf("nhãn rỗng đi lọt: %#v", messages)
	}
	if messages["items[0].states[1].value"] == "" {
		t.Fatalf("state âm đi lọt: %#v", messages)
	}
}

// Khai `states` cho kiểu khác là hiểu nhầm cần nói ra: nó sẽ không cưỡng chế gì
// cả, và im lặng bỏ qua sẽ để người dùng tin rằng có.
func TestStatesOnNonMultistateIsAConfigError(t *testing.T) {
	item := multistateFixture()
	item.SignalType = virtualPointSignalInteger
	if messages := stateMessages(t, item); messages["items[0].states"] == "" {
		t.Fatalf("states khai ở signalType integer đi lọt: %#v", messages)
	}
}

func TestMultistateValueMustBeADeclaredState(t *testing.T) {
	item := multistateFixture()
	item.Value = int64(7)
	if messages := stateMessages(t, item); messages["items[0].value"] == "" {
		t.Fatalf("giá trị 7 ngoài danh sách đi lọt: %#v", messages)
	}

	item.Value = int64(2)
	item.InitialValue = int64(9)
	if messages := stateMessages(t, item); messages["items[0].initialValue"] == "" {
		t.Fatalf("giá trị khởi tạo ngoài danh sách đi lọt: %#v", messages)
	}
}

func TestCheckVirtualPointStateRefusesUndeclaredState(t *testing.T) {
	item := multistateFixture()
	if err := checkVirtualPointState(item, int64(3)); err != nil {
		t.Fatalf("state đã khai bị từ chối: %v", err)
	}
	err := checkVirtualPointState(item, int64(4))
	if err == nil {
		t.Fatal("state chưa khai được chấp nhận")
	}
	// Thông điệp phải NÓI RA danh sách hợp lệ: một lỗi chỉ nói "sai" bắt người
	// vận hành đi mở tệp cấu hình mới biết mình được chọn gì.
	if !strings.Contains(err.Error(), "0=Off") || !strings.Contains(err.Error(), "3=Emergency") {
		t.Fatalf("thông điệp không liệt kê state hợp lệ: %v", err)
	}
}

// KHÔNG kẹp về state gần nhất: giữa `Manual` và `Emergency` không có nửa đường,
// và kẹp im lặng trả 200 cho một lệnh đã bị đổi nghĩa.
func TestCheckVirtualPointStateNeverClamps(t *testing.T) {
	item := multistateFixture()
	for _, value := range []any{int64(-1), int64(99), 2.5, "auto"} {
		if err := checkVirtualPointState(item, value); err == nil {
			t.Fatalf("giá trị %v được chấp nhận thay vì bị từ chối", value)
		}
	}
}

func TestCheckVirtualPointStateIgnoresOtherSignalTypes(t *testing.T) {
	item := multistateFixture()
	item.SignalType = virtualPointSignalInteger
	if err := checkVirtualPointState(item, int64(999)); err != nil {
		t.Fatalf("điểm không phải multistate bị kiểm state: %v", err)
	}
}

func TestNormalizeStatesSortsByValueAndTrimsLabels(t *testing.T) {
	states := normalizeVirtualPointStates([]VirtualPointState{
		{Value: 3, Label: "  Emergency "}, {Value: 0, Label: "Off"}, {Value: 1, Label: "Auto"},
	})
	if len(states) != 3 || states[0].Value != 0 || states[1].Value != 1 || states[2].Value != 3 {
		t.Fatalf("không sắp theo giá trị: %#v", states)
	}
	if states[2].Label != "Emergency" {
		t.Fatalf("nhãn chưa cắt khoảng trắng: %q", states[2].Label)
	}
}

// Sắp xếp KHÔNG được đánh số lại: `value` là danh tính của state, không phải vị
// trí trong mảng. Đánh số lại sẽ làm mọi binding và mọi lịch trình đang trỏ tới
// state cũ âm thầm đổi nghĩa.
func TestNormalizeStatesNeverRenumbers(t *testing.T) {
	states := normalizeVirtualPointStates([]VirtualPointState{
		{Value: 10, Label: "Auto"}, {Value: 20, Label: "Manual"},
	})
	if states[0].Value != 10 || states[1].Value != 20 {
		t.Fatalf("giá trị state bị đánh số lại: %#v", states)
	}
}

func TestMultistateAllocatesIntoMSVPool(t *testing.T) {
	pool, ok := vpPoolFor(virtualPointSignalMultistate)
	if !ok {
		t.Fatal("multistate không có pool slot — tám slot msv[] vẫn không ai với tới được")
	}
	if pool.Prefix != "MSV" || pool.Capacity != kxNMSV {
		t.Fatalf("pool = %+v; chờ MSV/%d", pool, kxNMSV)
	}
}

func TestMultistateDataTypeIsUint32AndIECUint(t *testing.T) {
	// Phụ thuộc mà thân issue nêu: MSV phải ra được UINT.
	item := multistateFixture()
	dto := virtualPointDTO(item)
	if dto.DataType != "uint32" {
		t.Fatalf("dataType = %q; chờ uint32", dto.DataType)
	}
	if got := virtualSignalTypeToIEC(virtualPointSignalMultistate); got != "UINT" {
		t.Fatalf("kiểu IEC = %q; chờ UINT", got)
	}
}

func TestPointDTOCarriesStatesAndResolvesLabelServerSide(t *testing.T) {
	item := multistateFixture()
	item.Value = int64(2)
	dto := virtualPointDTO(item)
	if len(dto.States) != 4 {
		t.Fatalf("DTO không chở danh sách state: %#v", dto.States)
	}
	if dto.StateLabel != "Manual" {
		t.Fatalf("stateLabel = %q; chờ Manual", dto.StateLabel)
	}
}

// Giá trị ngoài danh sách ⇒ nhãn RỖNG, và giao diện hiện con số trần. Bịa một
// nhãn ở đây là nói dối về trạng thái thiết bị.
func TestStateLabelEmptyWhenValueIsNotADeclaredState(t *testing.T) {
	item := multistateFixture()
	if label := virtualPointStateLabel(item, int64(9)); label != "" {
		t.Fatalf("stateLabel = %q cho state không khai", label)
	}
}

func TestMultistateIsLoggable(t *testing.T) {
	// Lịch sử chuyển chế độ chính là thứ cần nhất khi truy nguyên một sự cố.
	if !virtualPointLoggableSignalType(virtualPointSignalMultistate) {
		t.Fatal("multistate không ghi log được")
	}
}

func TestMultistateValueNormalizesToInteger(t *testing.T) {
	value, ok := normalizeVirtualPointValue(virtualPointSignalMultistate, 2)
	if !ok {
		t.Fatal("số nguyên 2 không chuẩn hoá được")
	}
	if typed, isInt := value.(int64); !isInt || typed != 2 {
		t.Fatalf("giá trị = %#v; chờ int64(2)", value)
	}
	/* Chuỗi KHÔNG được nhận, giống hệt `integer`/`float`: `virtualPointNumber`
	 * cố ý không parse chuỗi, và mở ngoại lệ riêng cho multistate sẽ tạo ra hai
	 * mức nghiêm ngặt khác nhau trên cùng một API ghi điểm. */
	if _, ok := normalizeVirtualPointValue(virtualPointSignalMultistate, "2"); ok {
		t.Fatal("chuỗi \"2\" được nhận — lệch với integer/float")
	}
	if _, ok := normalizeVirtualPointValue(virtualPointSignalMultistate, 2.5); ok {
		t.Fatal("state phân số được chấp nhận")
	}
	if _, ok := normalizeVirtualPointValue(virtualPointSignalMultistate, -1); ok {
		t.Fatal("state âm được chấp nhận")
	}
}
