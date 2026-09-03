package app

import "testing"

/* `ISS-PIO-07`/`F-PIO-006` — bốn trường đề bài §5 đòi phải LÊN TỚI Catalog.
 *
 * Thiếu `equipment` là mất mát cụ thể nhất: `ADR-042` đã dựng khái niệm thiết bị
 * công nghệ cho trang Giám sát, nhưng tab Ánh xạ không lọc theo `AHU-01` được. */

func TestPointCatalogCarriesDescriptionEnabledEquipment(t *testing.T) {
	entry := toPointCatalogEntry(PointDTO{
		ID: "UI-01", Kind: "UI", Name: "Supply air", SignalType: "0-10V",
		Note: "cảm biến ống gió sau coil", Enabled: true, Equipment: "AHU-01",
	})
	if entry.Description != "cảm biến ống gió sau coil" {
		t.Fatalf("description = %q", entry.Description)
	}
	if !entry.Enabled {
		t.Fatalf("enabled = false dù điểm đang dùng")
	}
	if entry.Equipment != "AHU-01" {
		t.Fatalf("equipment = %q; không có nó thì tab Ánh xạ không lọc theo thiết bị được", entry.Equipment)
	}
}

// `enabled: false` phải đi ra ngoài như một câu trả lời, không bị nuốt.
func TestPointCatalogReportsDisabledPoints(t *testing.T) {
	entry := toPointCatalogEntry(PointDTO{ID: "UI-02", Kind: "UI", Enabled: false})
	if entry.Enabled {
		t.Fatalf("điểm đã tắt vẫn báo enabled")
	}
}

/* `sourceRef` có TIỀN TỐ, và tiền tố là bắt buộc chứ không phải trang trí: một
 * `deviceId` Modbus và một mã kênh trên bo là hai không gian tên khác nhau. */
func TestPointCatalogSourceRefIsNamespaced(t *testing.T) {
	local := toPointCatalogEntry(PointDTO{ID: "UI-01", Kind: "UI"})
	if local.SourceRef != "iop:UI-01" {
		t.Fatalf("sourceRef điểm cục bộ = %q; chờ iop:UI-01", local.SourceRef)
	}
	modbus := toPointCatalogEntry(PointDTO{ID: "PUMP_CMD", Kind: "modbus_rtu", BusID: 1, SlaveAddr: 4})
	if modbus.SourceRef != "modbus:bus-1-slave-4" {
		t.Fatalf("sourceRef điểm Modbus = %q", modbus.SourceRef)
	}
	bound := toPointCatalogEntry(PointDTO{ID: "VP1", Kind: "virtual", BoundPointID: "AV-01"})
	if bound.SourceRef != "core:AV-01" {
		t.Fatalf("sourceRef VP đã bind = %q", bound.SourceRef)
	}
}

/* VP chưa bind slot nào thì THẬT SỰ chưa có gì sinh ra giá trị cho nó. Rỗng là
 * câu trả lời đúng — điền tạm một giá trị ở đây sẽ là bịa ra một nguồn. */
func TestPointCatalogSourceRefEmptyWhenNothingProducesTheValue(t *testing.T) {
	unbound := toPointCatalogEntry(PointDTO{ID: "VP9", Kind: "virtual"})
	if unbound.SourceRef != "" {
		t.Fatalf("VP chưa bind có sourceRef = %q; chờ rỗng", unbound.SourceRef)
	}
}

/* Điểm Modbus KHÔNG có trường mô tả trong `fieldbus.conf`. Rỗng ở đó là sự thật
 * về hợp đồng, không phải thiếu sót của đường chở — ghi lại để không ai "sửa"
 * nó bằng cách điền bừa tên điểm vào mô tả. */
func TestModbusPointHasNoDescriptionByContract(t *testing.T) {
	entry := toPointCatalogEntry(PointDTO{ID: "PUMP_CMD", Kind: "modbus_rtu", Name: "Bơm 1", BusID: 1, SlaveAddr: 4})
	if entry.Description != "" {
		t.Fatalf("điểm Modbus có description = %q dù hợp đồng không có trường đó", entry.Description)
	}
}
