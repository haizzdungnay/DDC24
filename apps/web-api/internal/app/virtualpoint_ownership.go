package app

import (
	"fmt"
	"strings"
)

/* ISS-PIO-16 — phơi quyền sở hữu VP (WEB / PROGRAM) ra ngoài (F-PIO-017, đề bài §16).
 *
 * BỐI CẢNH: backend đã tách đúng HAI TRỤC từ trước —
 *   `writable` : operator có sửa giá trị từ dashboard không;
 *   `source`   : AI SỞ HỮU slot — web-api (`WEB`) hay chương trình ST (`PROGRAM`).
 *
 * TRIỆU CHỨNG: trục thứ hai không hề tồn tại ở bề mặt sản phẩm. `source` không
 * có trong type frontend, không có ô nào đặt, không có nhãn nào hiện. Người kỹ
 * sư nhìn thấy một VP "chỉ đọc" mà không có bất kỳ manh mối nào vì sao.
 *
 * VÀ TỆ HƠN THẾ — LỖI PHÁT HIỆN KHI LÀM ISSUE NÀY: một VP `source: PROGRAM`
 * khai `writable: true` vẫn NHẬN lệnh ghi từ `PUT /points/{id}`. Lệnh đi trọn:
 * cấu hình được ghi, HTTP trả 200. Nhưng `syncVirtualPointToCore` cố ý không
 * đẩy xuống slot do chương trình sở hữu, và đường đọc thì overlay thẳng từ slot
 * Core — nên giá trị hiện trên màn hình KHÔNG BAO GIỜ đổi. Người vận hành bấm
 * "Write", thấy báo thành công, và thiết bị không nhúc nhích. Không lỗi, không
 * cảnh báo, không nhật ký.
 *
 * CÁCH SỬA:
 *   - Lệnh ghi vào VP do chương trình sở hữu bị TỪ CHỐI, kèm câu nói rõ ai đang
 *     sở hữu và làm gì để lấy lại quyền ghi.
 *   - `readWrite`/`writable` trong PointDTO nói SỰ THẬT VẬN HÀNH: một điểm mà
 *     mọi lệnh ghi đều bị từ chối thì không phải `read_write`.
 *   - `source` được chuẩn hoá và phơi lên hợp đồng + giao diện.
 *
 * 409 chứ không 400: đây KHÔNG phải lỗi của yêu cầu — client sửa con số hay
 * sửa header đều không giúp gì. Nó là xung đột trạng thái: điểm đang thuộc về
 * một chương trình đang chạy. Cách gỡ là đổi quyền sở hữu, một hành động cấu
 * hình, nên câu trả lời phải chỉ đúng về phía đó.
 */

const (
	// virtualPointSourceWeb — web-api sở hữu slot và đồng bộ giá trị cấu hình
	// xuống Core. Mặc định, và là hành vi của mọi cấu hình đã có.
	virtualPointSourceWeb = "WEB"
)

// virtualPointSources là tập hợp lệ, dùng chung cho validate và hợp đồng.
var virtualPointSources = []string{virtualPointSourceWeb, virtualPointSourceProgram}

/* normalizeVirtualPointSource chuẩn hoá về đúng một trong hai giá trị.
 *
 * Rỗng ⇒ `WEB`. Giá trị LẠ cũng ⇒ `WEB` chứ không phải lỗi tại đây: hàm này
 * chạy cả trên đường ĐỌC một tệp cấu hình đã nằm trên đĩa, và ở đó việc đúng là
 * hiểu theo hành vi cũ chứ không phải làm cả danh sách điểm biến mất.
 * `validateConfigVirtualPoints` mới là nơi từ chối — và nó phải kiểm giá trị
 * THÔ, xem `rawSource` ở đó.
 */
func normalizeVirtualPointSource(source string) string {
	if strings.EqualFold(strings.TrimSpace(source), virtualPointSourceProgram) {
		return virtualPointSourceProgram
	}
	return virtualPointSourceWeb
}

// validVirtualPointSource kiểm giá trị THÔ, dùng ở đường ghi API.
func validVirtualPointSource(source string) bool {
	for _, allowed := range virtualPointSources {
		if strings.EqualFold(strings.TrimSpace(source), allowed) {
			return true
		}
	}
	return false
}

// virtualPointOwnedByProgram — slot này do chương trình ST ghi mỗi chu kỳ.
func virtualPointOwnedByProgram(item VirtualPoint) bool {
	return normalizeVirtualPointSource(item.Source) == virtualPointSourceProgram
}

/* virtualPointEffectiveWritable — operator có THẬT SỰ ghi được điểm này không.
 *
 * `writable` một mình không trả lời được câu đó: một VP `writable: true` do
 * chương trình sở hữu vẫn từ chối mọi lệnh ghi. Phơi `writable` thô lên giao
 * diện chính là cách sinh ra nút "Write" bấm vào không có gì xảy ra.
 */
func virtualPointEffectiveWritable(item VirtualPoint) bool {
	return item.Writable && !virtualPointOwnedByProgram(item)
}

// virtualPointOwnershipError là lỗi "điểm do chương trình sở hữu".
//
// Kiểu riêng để nơi gọi phân biệt được với các lỗi ghi khác và trả đúng mã.
type virtualPointOwnershipError struct {
	PointID string
	Bound   string
}

func (e *virtualPointOwnershipError) Error() string {
	bound := e.Bound
	if bound == "" {
		bound = "(chưa bind)"
	}
	return fmt.Sprintf(
		"điểm ảo %s do chương trình ST sở hữu (source=PROGRAM, slot %s): chương trình ghi slot này mỗi chu kỳ nên web-api không ghi vào; "+
			"muốn ghi tay thì đổi quyền sở hữu của điểm về WEB trong cấu hình điểm ảo, hoặc sửa chính chương trình",
		e.PointID, bound)
}

// checkVirtualPointWriteOwnership chặn lệnh ghi vào điểm do chương trình sở hữu.
//
// Trả `nil` khi được phép ghi tiếp.
func checkVirtualPointWriteOwnership(item VirtualPoint) error {
	if !virtualPointOwnedByProgram(item) {
		return nil
	}
	return &virtualPointOwnershipError{PointID: item.ID, Bound: item.BoundPointID}
}
