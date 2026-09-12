package modbusrtu

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// FlexBool là boolean đọc được cả `true`/`false` lẫn `1`/`0`.
//
// # VÌ SAO CẦN
//
// `fieldbus.conf` có hai bên đọc, và hai bên từng bất đồng về kiểu của
// `enabled`: iobus (C++) đọc bằng `strtol` nên chỉ hiểu SỐ, còn BE (Go) khai
// `bool` nên chỉ hiểu true/false. Không tồn tại giá trị nào cả hai cùng chấp
// nhận. Trên bo Foxlinx ngày 2026-08-06, một file có `"enabled": 1` làm toàn bộ
// tính năng Modbus RTU chết:
//
//	parse config /data/config/fieldbus.conf: json: cannot unmarshal number
//	into Go struct field Bus.buses.enabled of type bool
//
// Hỏng ở một trường phụ của MỘT bus mà kéo sập cả trang: danh sách bus rỗng,
// không thêm được thiết bị, không sửa được gì — kể cả sửa chính chỗ hỏng. Người
// vận hành không có đường thoát nào từ giao diện.
//
// Nay iobus đọc được cả hai dạng (`jget_bool`) và BE cũng vậy. Chiều GHI vẫn
// luôn là `true`/`false` chuẩn JSON — nới lỏng ở đầu đọc, giữ nghiêm ở đầu ghi.
type FlexBool bool

func (b FlexBool) MarshalJSON() ([]byte, error) {
	return json.Marshal(bool(b))
}

func (b *FlexBool) UnmarshalJSON(data []byte) error {
	trimmed := bytes.TrimSpace(data)
	switch {
	case bytes.Equal(trimmed, []byte("true")):
		*b = true
		return nil
	case bytes.Equal(trimmed, []byte("false")):
		*b = false
		return nil
	case bytes.Equal(trimmed, []byte("null")):
		// Giữ nguyên giá trị đang có: `null` nghĩa là "không nói gì".
		return nil
	}
	var number json.Number
	if err := json.Unmarshal(trimmed, &number); err == nil {
		value, convErr := number.Float64()
		if convErr == nil {
			*b = value != 0
			return nil
		}
	}
	// Chuỗi "true"/"1" cũng gặp trong file sửa tay; nhận nốt cho hết đường.
	var text string
	if err := json.Unmarshal(trimmed, &text); err == nil {
		switch text {
		case "true", "1", "yes", "on":
			*b = true
			return nil
		case "false", "0", "no", "off", "":
			*b = false
			return nil
		}
	}
	return fmt.Errorf("giá trị boolean không hiểu được: %s", string(trimmed))
}
