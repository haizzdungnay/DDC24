package capabilities

import (
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

const iopHeaderPath = "../../../../contracts/iop/iop_protocol.h"

// Cổng chống trôi HAI CHIỀU: hằng Go ở gói này là GƯƠNG của `iop_protocol.h`,
// và một cái gương không tự biết mình lệch. Test đọc chính tệp header rồi so
// từng bit, nên đổi bit ở firmware mà quên đổi ở Go (hoặc ngược lại) là lỗi
// test — không phải một sự cố hiện trường nơi bo báo "có RTD" mà web đọc thành
// "có DI".
func TestBoardCapBitsMatchContractHeader(t *testing.T) {
	raw, err := os.ReadFile(iopHeaderPath)
	if err != nil {
		t.Fatalf("không đọc được %s: %v", iopHeaderPath, err)
	}
	header := parseCapBits(t, string(raw))
	want := map[string]uint16{
		"IOP_BOARD_CAP_UI_16": BoardCapUI16,
		"IOP_BOARD_CAP_DI_8":  BoardCapDI8,
		"IOP_BOARD_CAP_DO_4":  BoardCapDO4,
		"IOP_BOARD_CAP_AO_4":  BoardCapAO4,
		"IOP_BOARD_CAP_RTD":   BoardCapRTD,
	}
	if len(header) != len(want) {
		t.Fatalf("header có %d bit năng lực, gói Go gương %d: %v", len(header), len(want), header)
	}
	for name, goValue := range want {
		headerValue, ok := header[name]
		if !ok {
			t.Fatalf("%s có trong Go nhưng không có trong %s", name, iopHeaderPath)
		}
		if headerValue != goValue {
			t.Fatalf("%s: header = 0x%04X, Go = 0x%04X", name, headerValue, goValue)
		}
	}
}

// Bằng chứng cổng trên THẬT SỰ bắt được trôi: đổi một bit trong bản sao header
// và khẳng định phép so sánh đổi kết quả. Một cổng không có tiêm lỗi đi kèm có
// thể ngừng kiểm mà vẫn xanh.
func TestBoardCapDriftGateFiresOnInjectedMismatch(t *testing.T) {
	raw, err := os.ReadFile(iopHeaderPath)
	if err != nil {
		t.Fatalf("không đọc được %s: %v", iopHeaderPath, err)
	}
	mutated := strings.Replace(string(raw), "#define IOP_BOARD_CAP_RTD     (1u << 4)", "#define IOP_BOARD_CAP_RTD     (1u << 7)", 1)
	if mutated == string(raw) {
		t.Fatalf("không tiêm được lỗi: dòng IOP_BOARD_CAP_RTD trong header đã đổi dạng")
	}
	if got := parseCapBits(t, mutated)["IOP_BOARD_CAP_RTD"]; got == BoardCapRTD {
		t.Fatalf("tiêm lỗi rồi mà vẫn khớp 0x%04X — bộ so sánh đã ngừng kiểm", got)
	}
}

var capBitPattern = regexp.MustCompile(`#define\s+(IOP_BOARD_CAP_[A-Z0-9_]+)\s+\(1u\s*<<\s*(\d+)\)`)

func parseCapBits(t *testing.T, header string) map[string]uint16 {
	t.Helper()
	bits := map[string]uint16{}
	for _, match := range capBitPattern.FindAllStringSubmatch(header, -1) {
		shift, err := strconv.Atoi(match[2])
		if err != nil {
			t.Fatalf("bit %s có dịch không đọc được: %v", match[1], err)
		}
		bits[match[1]] = uint16(1) << shift
	}
	return bits
}

func blockByKind(t *testing.T, doc Document, kind string) Block {
	t.Helper()
	for _, block := range doc.Blocks {
		if block.Kind == kind {
			return block
		}
	}
	t.Fatalf("không có khối %s trong tài liệu capability", kind)
	return Block{}
}

func modeByID(t *testing.T, channel Channel, id string) Mode {
	t.Helper()
	for _, mode := range channel.Modes {
		if mode.ID == id {
			return mode
		}
	}
	t.Fatalf("kênh %s không công bố mode %s", channel.ID, id)
	return Mode{}
}

// Ca trung tâm của `ISS-PIO-12`: chưa hỏi được bo thì KHÔNG được mời chọn nhiệt
// trở. "Chưa biết" phải hành xử như "chưa được phép", không như "cho phép".
func TestRTDWithheldWhenBoardCapUnknown(t *testing.T) {
	doc := Build(BoardCap{})
	if doc.BoardCapKnown {
		t.Fatalf("BoardCap rỗng mà tài liệu báo đã biết")
	}
	if doc.BoardCapMap != nil {
		t.Fatalf("chưa hỏi được mà vẫn phát board_cap_map = %q", *doc.BoardCapMap)
	}
	ui := blockByKind(t, doc, "UI")
	if ui.Presence != PresenceUnknown || ui.Count != ABIUniversalInputs {
		t.Fatalf("khối UI khi chưa biết: presence=%s count=%d", ui.Presence, ui.Count)
	}
	for _, id := range []string{"PT100", "PT1000"} {
		mode := modeByID(t, ui.Channels[0], id)
		if mode.Availability != AvailabilityWithheld || mode.Reason != reasonRTDUnknown {
			t.Fatalf("%s khi chưa hỏi được: availability=%s reason=%q", id, mode.Availability, mode.Reason)
		}
	}
	if mode := modeByID(t, ui.Channels[0], "0-10V"); mode.Availability != AvailabilityUnverified {
		t.Fatalf("0-10V khi chưa biết phải là unverified, nhận %s", mode.Availability)
	}
}

// Có bằng chứng DƯƠNG là bo không gắn mạch RTD ⇒ lý do phải khác hẳn ca chưa
// hỏi được. Hai tình huống này dẫn tới hai hành động khác nhau của người vận
// hành (đợi iobus lên, hay đổi phần cứng), nên API không được nói giống nhau.
func TestRTDWithheldWithDistinctReasonWhenBoardLacksCircuit(t *testing.T) {
	doc := Build(BoardCap{Map: BoardCapUI16 | BoardCapAO4 | BoardCapDO4, Known: true})
	ui := blockByKind(t, doc, "UI")
	if ui.Presence != PresenceYes || ui.Count != ABIUniversalInputs {
		t.Fatalf("khối UI khi đã xác nhận: presence=%s count=%d", ui.Presence, ui.Count)
	}
	mode := modeByID(t, ui.Channels[0], "PT100")
	if mode.Availability != AvailabilityWithheld || mode.Reason != reasonRTDAbsent {
		t.Fatalf("PT100 khi bo không có RTD: availability=%s reason=%q", mode.Availability, mode.Reason)
	}
	if mode.Reason == reasonRTDUnknown {
		t.Fatalf("lý do 'không có mạch' trùng lý do 'chưa hỏi được'")
	}
	if got := modeByID(t, ui.Channels[0], "0-10V"); got.Availability != AvailabilityConfirmed {
		t.Fatalf("0-10V trên khối đã xác nhận phải confirmed, nhận %s", got.Availability)
	}
}

func TestRTDConfirmedWhenBoardAdvertisesIt(t *testing.T) {
	doc := Build(BoardCap{Map: BoardCapUI16 | BoardCapAO4 | BoardCapDO4 | BoardCapRTD, Known: true})
	ui := blockByKind(t, doc, "UI")
	for _, id := range []string{"PT100", "PT1000"} {
		if mode := modeByID(t, ui.Channels[0], id); mode.Availability != AvailabilityConfirmed {
			t.Fatalf("%s khi bo quảng cáo RTD: %s (%s)", id, mode.Availability, mode.Reason)
		}
	}
	if doc.BoardCapMap == nil || *doc.BoardCapMap != "0x001D" {
		t.Fatalf("board_cap_map phát ra sai: %v", doc.BoardCapMap)
	}
}

// `DS_MK-DDC-24_VI` §174: point DI chỉ được tạo KHI capability map xác nhận.
// Không có xác nhận thì không có kênh nào — bịa ra 8 kênh DI trên bo không cắm
// module là mời người ta đấu dây vào chỗ không có gì.
func TestOptionalDIRequiresPositiveProof(t *testing.T) {
	unknown := blockByKind(t, Build(BoardCap{}), "DI")
	if unknown.Presence != PresenceUnknown || unknown.Count != 0 || len(unknown.Channels) != 0 {
		t.Fatalf("DI khi chưa biết: presence=%s count=%d channels=%d", unknown.Presence, unknown.Count, len(unknown.Channels))
	}
	if unknown.ABICapacity != ABIDigitalInputs || !unknown.Optional {
		t.Fatalf("DI phải công bố abi_capacity=%d và optional=true, nhận %d/%v", ABIDigitalInputs, unknown.ABICapacity, unknown.Optional)
	}

	absent := blockByKind(t, Build(BoardCap{Map: BoardCapUI16, Known: true}), "DI")
	if absent.Presence != PresenceNo || absent.Count != 0 {
		t.Fatalf("DI khi bo nói không có: presence=%s count=%d", absent.Presence, absent.Count)
	}

	present := blockByKind(t, Build(BoardCap{Map: BoardCapUI16 | BoardCapDI8, Known: true}), "DI")
	if present.Presence != PresenceYes || present.Count != ABIDigitalInputs || len(present.Channels) != ABIDigitalInputs {
		t.Fatalf("DI khi bo xác nhận: presence=%s count=%d channels=%d", present.Presence, present.Count, len(present.Channels))
	}
	// Định danh phải nằm trong KHÔNG GIAN ĐIỂM SẴN CÓ (`UI-17`..`UI-24`), không
	// phải một dãy `DI-01..DI-08` mới. Issue này dẹp nguồn sự thật trùng lặp —
	// đẻ thêm một hệ định danh thứ hai cho cùng kênh vật lý là tái phạm đúng lỗi
	// đó ở tầng khác.
	if present.Channels[0].ID != "UI-17" || present.Channels[7].ID != "UI-24" {
		t.Fatalf("định danh kênh DI sai: %s..%s", present.Channels[0].ID, present.Channels[7].ID)
	}
	if present.Channels[0].Index != 1 || present.Channels[7].Index != 8 {
		t.Fatalf("index kênh DI phải là 1..8 trong module, nhận %d..%d", present.Channels[0].Index, present.Channels[7].Index)
	}
}

// Khối bắt buộc mà bo nói KHÔNG có ⇒ count = 0. Đây là ca "bo lạ/hỏng": ABI vẫn
// có ô, nhưng không được công bố kênh mà bo phủ nhận.
func TestMandatoryBlockAbsentWhenBoardDeniesIt(t *testing.T) {
	doc := Build(BoardCap{Map: BoardCapDI8, Known: true})
	for _, kind := range []string{"UI", "AO", "DO"} {
		block := blockByKind(t, doc, kind)
		if block.Presence != PresenceNo || block.Count != 0 || len(block.Channels) != 0 {
			t.Fatalf("khối %s bị bo phủ nhận: presence=%s count=%d channels=%d", kind, block.Presence, block.Count, len(block.Channels))
		}
	}
}

// Hợp đồng IOP chỉ có 5 bit, không bit nào phủ NTC/ánh sáng/xung/chiết áp. Nói
// "confirmed" cho chúng là bịa; giấu đi là xoá chức năng đang chạy thật. Mức
// thứ ba tồn tại đúng vì khoảng trống đó, và test này ghim nó lại để khoảng
// trống không âm thầm biến thành một lời khẳng định.
func TestUncoveredModesStayUnverifiedEvenOnConfirmedBoard(t *testing.T) {
	doc := Build(BoardCap{Map: BoardCapUI16 | BoardCapAO4 | BoardCapDO4 | BoardCapRTD, Known: true})
	ui := blockByKind(t, doc, "UI")
	for _, id := range []string{"NTC10k", "NTC20k", "light", "pulse", "potentiometer"} {
		mode := modeByID(t, ui.Channels[0], id)
		if mode.Availability != AvailabilityUnverified || mode.Reason != reasonNoCapBit {
			t.Fatalf("%s trên bo đã xác nhận đủ bit: availability=%s reason=%q", id, mode.Availability, mode.Reason)
		}
	}
}

// Ranh giới "không MỜI chọn" và "không CHO ghi": chặn ghi chỉ ở ca có bằng
// chứng dương. Chặn cả ca chưa hỏi được sẽ làm mọi bo không chạy iobus mất khả
// năng lưu lại chính cấu hình nhiệt trở đang dùng thật.
func TestRTDWriteBlockedOnlyWithPositiveProofOfAbsence(t *testing.T) {
	if got := RTDModeBlockedBy(BoardCap{}, "PT100"); got != "" {
		t.Fatalf("chưa hỏi được mà đã chặn ghi PT100: %q", got)
	}
	if got := RTDModeBlockedBy(BoardCap{Map: BoardCapUI16, Known: true}, "PT1000"); got != reasonRTDAbsent {
		t.Fatalf("bo nói không có RTD mà không chặn ghi PT1000: %q", got)
	}
	if got := RTDModeBlockedBy(BoardCap{Map: BoardCapUI16 | BoardCapRTD, Known: true}, "PT100"); got != "" {
		t.Fatalf("bo có RTD mà vẫn chặn ghi PT100: %q", got)
	}
	if got := RTDModeBlockedBy(BoardCap{Map: BoardCapUI16, Known: true}, "0-10V"); got != "" {
		t.Fatalf("mode không phải nhiệt trở mà bị chặn: %q", got)
	}
}

// `Has` không được trả true khi chưa biết: đó chính là chỗ mà "thiếu bằng chứng"
// dễ bị đọc nhầm thành "bằng chứng".
func TestHasNeverTrueWithoutKnowledge(t *testing.T) {
	if (BoardCap{Map: 0xFFFF}).Has(BoardCapRTD) {
		t.Fatalf("Has trả true trên bản đồ chưa xác nhận")
	}
}
