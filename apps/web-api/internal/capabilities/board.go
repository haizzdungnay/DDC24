// Package capabilities là NGUỒN SỰ THẬT DUY NHẤT cho câu hỏi "bo này có bao
// nhiêu kênh, và mỗi kênh nhận được mode nào".
//
// `F-PIO-008`/`F-PIO-009` (`REV-PIO-3SRC-001`): trước gói này, cùng một dữ kiện
// được viết lại ở BỐN nơi độc lập — `core_client.go` (`kxNUI/kxNDI/kxNAO/kxNDO`),
// `overview.go` (`DigitalInputs: 0` viết cứng), `points/catalog.go` (`Limits`,
// thiếu hẳn DI) và FE `shared/utils.ts` (`VISIBLE_UI_CHANNELS = 16`). Bốn nguồn
// sự thật cho một dữ kiện nghĩa là ba trong bốn có thể sai mà không ai biết.
//
// Gói này tách BẠCH hai điều mà bốn nơi kia gộp làm một:
//
//   - SỨC CHỨA ABI (`ABI*`): bảng point trong `contracts/shm/mkddc_shm.h` có bao
//     nhiêu ô. Đây là hằng biên dịch THẬT — offset của mọi trường phía sau được
//     tính từ nó, nên nó không thể và không được phép động.
//   - BO THỰC SỰ CÓ GÌ: đến từ `BOARD_CAP_MAP` mà MCU trả ở handshake IOP, được
//     `iobus` chở vào `io_shm` (`ISS-PIO-11`/#388).
//
// Bốn hằng số cũ đều tự nhận là vế thứ hai trong khi thực chất là vế thứ nhất.
package capabilities

import "fmt"

// Sức chứa của bảng point trong `contracts/shm/mkddc_shm.h`. KHÔNG phải "bo có
// bấy nhiêu kênh" — chỉ là "ABI dành sẵn bấy nhiêu ô". Mọi offset SHM phía Go
// được tính từ đúng bốn hằng này, nên chúng là hằng biên dịch.
//
// ISS-634: `TestShmPointTableCapacitiesMatchHeader`
// (`internal/app/shm_contract_sync_test.go`) đọc chính `mkddc_shm.h` và so bốn
// hằng này với `KX_N_UI/KX_N_DI/KX_N_AO/KX_N_DO`, nên hợp đồng đổi mà đây quên
// đổi là lỗi test chứ không phải lỗi hiện trường. Cổng đặt ở package `app` vì
// helper parse header là code test của package đó và `app` import được
// `capabilities`; đừng chép một bộ parser thứ hai vào đây.
const (
	ABIUniversalInputs = 16
	ABIDigitalInputs   = 8
	ABIAnalogOutputs   = 4
	ABIDigitalOutputs  = 4
)

// Gương của `IOP_BOARD_CAP_*` trong `contracts/iop/iop_protocol.h`.
// `TestBoardCapBitsMatchContractHeader` đọc chính tệp header đó và so từng bit,
// nên một bên đổi mà bên kia quên là lỗi test chứ không phải lỗi hiện trường.
const (
	BoardCapUI16 uint16 = 1 << 0
	BoardCapDI8  uint16 = 1 << 1
	BoardCapDO4  uint16 = 1 << 2
	BoardCapAO4  uint16 = 1 << 3
	BoardCapRTD  uint16 = 1 << 4
)

// BoardCap là bản đồ năng lực đọc từ `io_shm`.
//
// `Known = false` nghĩa là CHƯA HỎI ĐƯỢC (iobus chưa handshake, chưa chạy, hoặc
// segment ngắn hơn ABI v6). Nó KHÔNG có nghĩa "bo không có năng lực nào" — đây
// đúng là chỗ mà nguyên tắc "thiếu bằng chứng không phải bằng chứng" phải được
// giữ, vì hai tình huống đó dẫn tới hai hành vi UI trái ngược.
type BoardCap struct {
	Map   uint16
	Known bool
}

// Has trả lời "bo CÓ năng lực này" — và chỉ trả `true` khi có BẰNG CHỨNG.
// Khi chưa hỏi được thì luôn là `false`: nơi gọi cần phân biệt "không có" với
// "chưa biết" phải hỏi thêm `Known`.
func (c BoardCap) Has(bit uint16) bool { return c.Known && c.Map&bit != 0 }

// Trạng thái hiểu biết về một khối kênh. Ba giá trị, không phải hai: gộp
// "chưa biết" vào "không có" chính là cách `overview.go` từng công bố
// `DigitalInputs: 0` cho một bo có thể đang cắm module DI.
const (
	PresenceYes     = "yes"
	PresenceNo      = "no"
	PresenceUnknown = "unknown"
)

// Mức tin cậy của một mode. Ba mức vì hợp đồng IOP chỉ có 5 bit năng lực, không
// phủ hết 12 mode UI: nói "hỗ trợ" cho một mode không có bit nào chứng minh là
// bịa, còn giấu nó đi thì xoá mất chức năng đang chạy thật.
const (
	// Có bit năng lực xác nhận, hoặc thuộc khối bắt buộc đã được xác nhận.
	AvailabilityConfirmed = "confirmed"
	// Không có bit nào phủ mode này ⇒ không xác nhận được, cũng không phủ nhận
	// được. FE phải cho chọn nhưng nói rõ là chưa xác nhận.
	AvailabilityUnverified = "unverified"
	// Có bằng chứng là KHÔNG có, hoặc mode đòi bằng chứng mà chưa hỏi được.
	AvailabilityWithheld = "withheld"
)

type Mode struct {
	ID           string `json:"id"`
	Availability string `json:"availability"`
	Reason       string `json:"reason,omitempty"`
}

type Channel struct {
	ID    string `json:"id"`
	Index int    `json:"index"`
	Modes []Mode `json:"modes"`
}

type Block struct {
	Kind string `json:"kind"`
	// Presence là câu trả lời cho "khối này có mặt không" — `yes`/`no`/`unknown`.
	Presence string `json:"presence"`
	// Count là số kênh thật sự công bố ở `Channels`, không phải sức chứa ABI.
	Count int `json:"count"`
	// ABICapacity là số ô mà `mkddc_shm.h` dành sẵn. Công bố ra ngoài để một
	// consumer thấy `count < abi_capacity` biết ngay đó là "bo không có/chưa xác
	// nhận" chứ không phải "API cắt bớt".
	ABICapacity int       `json:"abi_capacity"`
	Optional    bool      `json:"optional"`
	Channels    []Channel `json:"channels"`
}

type Document struct {
	// BoardCapKnown = false ⇒ mọi `presence`/`availability` dưới đây là suy ra
	// từ ABI, không phải từ bo. Trường này luôn được đọc TRƯỚC.
	BoardCapKnown bool `json:"board_cap_known"`
	// BoardCapMap chỉ có mặt khi đã hỏi được — không phát `0x0000` cho ca chưa
	// biết, vì `0x0000` là một bản đồ hợp lệ nghĩa là "không có năng lực nào".
	BoardCapMap *string `json:"board_cap_map,omitempty"`
	Blocks      []Block `json:"blocks"`
}

// Tập mode hợp lệ theo hợp đồng cấu hình. `configapi.go` validate BẰNG CHÍNH
// các lát này, nên enum của validator và enum của endpoint capability không thể
// lệch nhau — đó là cùng một biến.
var (
	UIModes = []string{"none", "0-10V", "2-10V", "4-20mA", "PT100", "PT1000", "NTC10k", "NTC20k", "dry", "potentiometer", "light", "pulse"}
	AOModes = []string{"0-10V", "4-20mA"}
	DOModes = []string{"open", "closed"}
	DIModes = []string{"dry", "pulse"}
)

// Mode UI đòi mạch nhiệt trở RTD. Đây là tiêu chí thứ ba của `ISS-PIO-12`:
// `IOP_BOARD_CAP_RTD` phải được HỎI trước khi mời người dùng chọn nhiệt trở.
var rtdModes = map[string]bool{"PT100": true, "PT1000": true}

// Mode không có bit năng lực nào phủ. Ghi ra đây thành danh sách có tên để chỗ
// này là một khiếm khuyết hợp đồng NHÌN THẤY ĐƯỢC, chứ không phải một khoảng
// lặng: `iop_protocol.h` chỉ có 5 bit, không bit nào nói về mạch NTC, cảm biến
// ánh sáng hay đầu vào xung.
var uncoveredModes = map[string]bool{
	"NTC10k": true, "NTC20k": true, "light": true, "pulse": true, "potentiometer": true,
}

const (
	reasonRTDUnknown   = "chưa hỏi được IOP_BOARD_CAP_RTD nên chưa biết bo có mạch nhiệt trở"
	reasonRTDAbsent    = "IOP_BOARD_CAP_RTD không có trong BOARD_CAP_MAP: bo không gắn mạch nhiệt trở"
	reasonNoCapBit     = "hợp đồng IOP chưa có bit năng lực cho mode này nên không xác nhận được bằng bo"
	reasonBlockUnknown = "chưa hỏi được BOARD_CAP_MAP nên khối kênh này mới chỉ suy ra từ ABI"
)

// Build dựng tài liệu capability từ bản đồ năng lực đọc được.
//
// Hai hướng fail-closed KHÔNG đối xứng, và sự bất đối xứng đó là có chủ ý:
//
//   - Khối TUỲ CHỌN (DI) đòi BẰNG CHỨNG DƯƠNG mới công bố. `DS_MK-DDC-24_VI`
//     §174 nói rõ chỉ tạo point cho SKU isolated-DI "khi capability map xác
//     nhận"; bịa ra 8 kênh DI trên một bo không cắm module là mời người vận hành
//     đấu dây vào chỗ không có gì.
//   - Khối BẮT BUỘC (UI/AO/DO — chính là `IOP_BOARD_CAP_REV_A`) khi chưa hỏi
//     được thì vẫn công bố theo sức chứa ABI nhưng đánh dấu `unknown` và mọi
//     mode ở mức `unverified`. Giấu chúng đi sẽ làm TOÀN BỘ trang cấu hình trống
//     rỗng mỗi khi iobus chưa kịp handshake — một chế độ hỏng tệ hơn hẳn cái nó
//     tránh, trong khi bo không có ba khối này thì `iobus` đã từ chối chạy.
func Build(cap BoardCap) Document {
	doc := Document{BoardCapKnown: cap.Known}
	if cap.Known {
		hex := formatCapMap(cap.Map)
		doc.BoardCapMap = &hex
	}
	doc.Blocks = []Block{
		buildBlock(cap, "UI", "UI", 0, BoardCapUI16, ABIUniversalInputs, false, UIModes),
		// DI dùng ĐỊNH DANH ĐIỂM SẴN CÓ `UI-17`..`UI-24`, không phải `DI-01`.
		// Toàn hệ thống đã ánh xạ khối `bi[8]` của SHM vào không gian UI với độ
		// lệch 16 (`core_client.go` `canonicalPointID`, `pointtags.go`). Đặt ra
		// một dãy `DI-01..DI-08` ở đây sẽ đẻ thêm đúng cái mà issue này đang
		// dẹp: một nguồn định danh thứ hai cho cùng một kênh vật lý. Trường
		// `index` vẫn giữ số thứ tự 1..8 trong module DI để không mất thông tin
		// đấu dây.
		buildBlock(cap, "DI", "UI", ABIUniversalInputs, BoardCapDI8, ABIDigitalInputs, true, DIModes),
		buildBlock(cap, "AO", "AO", 0, BoardCapAO4, ABIAnalogOutputs, false, AOModes),
		buildBlock(cap, "DO", "DO", 0, BoardCapDO4, ABIDigitalOutputs, false, DOModes),
	}
	return doc
}

// Count trả về số kênh công bố của một khối; 0 khi không có khối đó.
func (d Document) Count(kind string) int {
	for _, block := range d.Blocks {
		if block.Kind == kind {
			return block.Count
		}
	}
	return 0
}

func buildBlock(cap BoardCap, kind, prefix string, idOffset int, bit uint16, abiCapacity int, optional bool, modes []string) Block {
	block := Block{Kind: kind, ABICapacity: abiCapacity, Optional: optional, Channels: []Channel{}}
	count := 0
	switch {
	case cap.Has(bit):
		block.Presence = PresenceYes
		count = abiCapacity
	case cap.Known:
		block.Presence = PresenceNo
	case optional:
		// Chưa biết + tuỳ chọn ⇒ không công bố kênh nào. Xem giải thích ở Build.
		block.Presence = PresenceUnknown
	default:
		block.Presence = PresenceUnknown
		count = abiCapacity
	}
	block.Count = count
	// Mọi kênh trong cùng một khối có cùng mạch nên có cùng tập mode: dựng MỘT
	// lần rồi dùng chung. Đề bài §6.1 đòi công bố "theo từng kênh" và tài liệu
	// vẫn công bố đúng như thế — chỗ này chỉ là không tính lại 16 lần cùng một
	// câu trả lời.
	channelModes := buildModes(cap, block.Presence, modes)
	for i := 1; i <= count; i++ {
		block.Channels = append(block.Channels, Channel{
			ID:    formatChannelID(prefix, idOffset+i),
			Index: i,
			Modes: channelModes,
		})
	}
	return block
}

func buildModes(cap BoardCap, presence string, modes []string) []Mode {
	out := make([]Mode, 0, len(modes))
	for _, id := range modes {
		out = append(out, buildMode(cap, presence, id))
	}
	return out
}

func buildMode(cap BoardCap, presence string, id string) Mode {
	if rtdModes[id] {
		switch {
		case cap.Has(BoardCapRTD):
			return Mode{ID: id, Availability: AvailabilityConfirmed}
		case cap.Known:
			return Mode{ID: id, Availability: AvailabilityWithheld, Reason: reasonRTDAbsent}
		default:
			return Mode{ID: id, Availability: AvailabilityWithheld, Reason: reasonRTDUnknown}
		}
	}
	if uncoveredModes[id] {
		return Mode{ID: id, Availability: AvailabilityUnverified, Reason: reasonNoCapBit}
	}
	if presence == PresenceUnknown {
		return Mode{ID: id, Availability: AvailabilityUnverified, Reason: reasonBlockUnknown}
	}
	return Mode{ID: id, Availability: AvailabilityConfirmed}
}

func formatCapMap(value uint16) string {
	return fmt.Sprintf("0x%04X", value)
}

func formatChannelID(prefix string, index int) string {
	return fmt.Sprintf("%s-%02d", prefix, index)
}

// RTDModeBlockedBy trả về lý do khi một mode nhiệt trở bị CẤM ghi vào cấu hình,
// và "" khi được phép.
//
// Cấm chỉ ở ca có BẰNG CHỨNG DƯƠNG là bo không có mạch RTD (`Known && !RTD`).
// Ca "chưa hỏi được" KHÔNG cấm: chặn ở đó sẽ làm mọi bo không chạy iobus mất
// khả năng lưu cấu hình nhiệt trở đang dùng thật — một cách hỏng tệ hơn cái nó
// định tránh. Đây là ranh giới giữa "không MỜI chọn" (endpoint capability lo)
// và "không CHO ghi" (hàm này lo).
func RTDModeBlockedBy(cap BoardCap, mode string) string {
	if !rtdModes[mode] {
		return ""
	}
	if cap.Known && !cap.Has(BoardCapRTD) {
		return reasonRTDAbsent
	}
	return ""
}
