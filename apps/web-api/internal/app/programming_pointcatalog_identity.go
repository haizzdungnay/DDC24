package app

import (
	"strings"

	webModbus "mkddc-web/internal/modbusrtu"
	programmingapplication "mkddc-web/internal/programming/application"
)

/* ISS-PIO-09 — dựng danh tính THEO NGUỒN cho từng hàng Point Catalog.
 *
 * Dữ liệu để dựng ba chuỗi này (dải kỹ thuật của kênh vật lý, chính sách khởi
 * động lại của VP, vùng thanh ghi + mã hàm của điểm Modbus) nằm ở CẤU HÌNH,
 * không nằm trong `PointDTO` mà runtime báo về. Vì thế adapter đọc thêm cấu
 * hình ở đây thay vì bắt FE tự suy — FE không có đường nào biết một điểm
 * `holding_register` sẽ đi bằng FC03.
 *
 * Lỗi đọc cấu hình KHÔNG làm hỏng cả catalog: danh tính theo nguồn là lớp
 * TRÌNH BÀY, còn `pointId`/`category`/giá trị/quality vẫn đúng và vẫn dùng
 * được. Mất phần trang trí thì hàng vẫn map được; chặn cả catalog vì mất phần
 * trang trí thì không ai map được gì.
 */

type pointCatalogIdentitySource struct {
	local   map[string]programmingapplication.PointSourceIdentity
	virtual map[string]programmingapplication.PointSourceIdentity
	// modbusDeviceLabel: deviceId CANONICAL (`bus-1-slave-4`) → tên người vận
	// hành đặt (`CK508-04`). Hai hệ danh tính này khác nhau có chủ đích; xem
	// `canonicalModbusDeviceIDs`.
	modbusDeviceLabel map[string]string
	modbusPoint       map[string]webModbus.Point
}

func (adapter programmingPointCatalogAdapter) pointCatalogIdentitySource() pointCatalogIdentitySource {
	source := pointCatalogIdentitySource{
		local:             map[string]programmingapplication.PointSourceIdentity{},
		virtual:           map[string]programmingapplication.PointSourceIdentity{},
		modbusDeviceLabel: map[string]string{},
		modbusPoint:       map[string]webModbus.Point{},
	}

	if ioCfg, err := readConfig(adapter.app, configGroupIO, ConfigIO{}); err == nil {
		addLocal := func(rows []map[string]any, prefix, loKey, hiKey string) {
			for _, row := range rows {
				channel, _, good := intField(row, "ch")
				if !good {
					continue
				}
				id := formatPointID(prefix, channel)
				signalType, _, _ := stringField(row, "type")
				if signalType == "" {
					// AO khai kiểu tín hiệu ở `mode`, không phải `type`.
					signalType, _, _ = stringField(row, "mode")
				}
				unit, _, _ := stringField(row, "unit")
				source.local[id] = programmingapplication.PointSourceIdentity{
					DisplayID:    id,
					SourceDetail: programmingapplication.LocalSourceDetail(signalType, unit, optionalNumber(row, loKey), optionalNumber(row, hiKey)),
				}
			}
		}
		addLocal(ioCfg.UI, "UI", "scale_lo", "scale_hi")
		addLocal(ioCfg.AO, "AO", "min_pv", "max_pv")
		// DO không có dải kỹ thuật: nó là tiếp điểm. Bịa `0…1` cho nó là mô tả
		// một thứ không tồn tại trong cấu hình.
		addLocal(ioCfg.DO, "DO", "", "")
	}

	if vpCfg, err := readConfig(adapter.app, configGroupVirtualPoints, defaultVirtualPointsConfig()); err == nil {
		for _, item := range vpCfg.Items {
			identity := programmingapplication.PointSourceIdentity{
				DisplayID:    item.ID,
				SourceDetail: programmingapplication.VirtualSourceDetail(virtualPointEffectiveWritable(item), item.RestartPolicy),
			}
			// Đăng ký CẢ HAI khoá: catalog phát `pointId` là slot Core đã bind
			// (`AV-01`) khi có, còn `VP1` khi chưa — tra hụt một khoá là mất
			// danh tính của đúng nhóm điểm chưa bind.
			if item.ID != "" {
				source.virtual[strings.ToUpper(item.ID)] = identity
			}
			if item.BoundPointID != "" {
				bound := identity
				bound.DisplayID = item.BoundPointID
				source.virtual[strings.ToUpper(item.BoundPointID)] = bound
			}
		}
	}

	if cfg, err := readConfig(adapter.app, configGroupFieldbus, ConfigFieldbus{}); err == nil {
		canonical := canonicalModbusDeviceIDs(cfg)
		for _, device := range cfg.Devices {
			if id, ok := canonical[device.DeviceID]; ok {
				source.modbusDeviceLabel[id] = device.DeviceID
			}
		}
		for _, point := range cfg.Points {
			id, ok := canonical[point.DeviceID]
			if !ok {
				continue
			}
			source.modbusPoint[modbusCatalogKey(id, point.PointID)] = point
		}
	}
	return source
}

// optionalNumber đọc một biên số. Khoá vắng hoặc sai kiểu ⇒ `nil` = CHƯA KHAI,
// khác hẳn `0` — `0` là một biên hợp lệ và rất hay gặp (`scale_lo: 0`).
func optionalNumber(row map[string]any, key string) *float64 {
	if key == "" {
		return nil
	}
	value, present, ok := numberField(row, key)
	if !present || !ok {
		return nil
	}
	return &value
}

// applyPointSourceIdentity gắn danh tính theo nguồn vào một entry đã dựng.
func (source pointCatalogIdentitySource) apply(entry *programmingapplication.PointCatalogEntry) {
	switch entry.Category {
	case "MB_RTU":
		entry.DisplayID = programmingapplication.ModbusDisplayID(entry.ExtIndex)
		entry.DeviceLabel = source.modbusDeviceLabel[entry.DeviceID]
		/* Điểm có trong runtime nhưng KHÔNG còn trong cấu hình cho ra một
		 * `webModbus.Point` rỗng, và `ModbusSourceDetail` tự trả chuỗi rỗng vì
		 * không có vùng thanh ghi lẫn mã hàm nào để in. Không cần chốt chặn
		 * riêng ở đây: một `if !ok { return }` thêm vào chỉ là nhánh chết —
		 * trông như đang bảo vệ mà thực ra không đổi kết quả nào, và nhánh chết
		 * là chỗ lỗi ẩn mình lâu nhất. */
		point := source.modbusPoint[modbusCatalogKey(entry.DeviceID, entry.PointID)]
		functionCode := 0
		if point.ReadWrite == "read_write" {
			// Điểm ghi được thì mã hàm đáng quan tâm là mã GHI: đó là thứ sẽ
			// chạm vào thiết bị. Vùng chỉ đọc không có mã ghi và rơi về mã đọc.
			if code, known := webModbus.WriteFunctionCode(point.RegisterType); known {
				functionCode = code
			}
		}
		if functionCode == 0 {
			if code, known := webModbus.ReadFunctionCode(point.RegisterType); known {
				functionCode = code
			}
		}
		entry.SourceDetail = programmingapplication.ModbusSourceDetail(
			webModbus.RegisterAbbreviation(point.RegisterType), point.Address, true, functionCode)
	case "VP":
		if identity, ok := source.virtual[strings.ToUpper(entry.PointID)]; ok {
			entry.PointSourceIdentity = identity
		}
	default:
		if identity, ok := source.local[strings.ToUpper(entry.PointID)]; ok {
			entry.PointSourceIdentity = identity
		}
	}
}
