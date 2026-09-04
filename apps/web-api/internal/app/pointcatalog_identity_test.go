package app

import (
	"testing"

	webModbus "mkddc-web/internal/modbusrtu"
	programmingapplication "mkddc-web/internal/programming/application"
)

/* `ISS-PIO-09` (F-PIO-026, đề bài §29) — hàng Point phải hiện DANH TÍNH THEO
 * NGUỒN. Trước bản vá, một điểm Modbus đọc ra
 * `MB_RTU:bus-1-slave-3:VFD_Frequency`: không thanh ghi, không mã hàm, và
 * `bus-1-slave-3` là danh tính canonical của tầng Programming chứ không phải
 * cái tên người vận hành đặt cho thiết bị trong tủ. */

func identityFixture() pointCatalogIdentitySource {
	return pointCatalogIdentitySource{
		local: map[string]programmingapplication.PointSourceIdentity{
			"UI-01": {DisplayID: "UI-01", SourceDetail: "0-10V → 0…50 °C"},
		},
		virtual: map[string]programmingapplication.PointSourceIdentity{
			"AV-01": {DisplayID: "AV-01", SourceDetail: "RW · RETAIN"},
		},
		modbusDeviceLabel: map[string]string{"bus-1-slave-3": "VFD-01"},
		modbusPoint: map[string]webModbus.Point{
			modbusCatalogKey("bus-1-slave-3", "VFD_Frequency"): {
				PointID: "VFD_Frequency", RegisterType: "holding_register", Address: 102, ReadWrite: "read",
			},
			modbusCatalogKey("bus-1-slave-3", "VFD_Command"): {
				PointID: "VFD_Command", RegisterType: "holding_register", Address: 40, ReadWrite: "read_write",
			},
		},
	}
}

func TestIdentityGivesModbusRowRegisterFunctionCodeAndDeviceName(t *testing.T) {
	entry := programmingapplication.PointCatalogEntry{
		Category: "MB_RTU", DeviceID: "bus-1-slave-3", PointID: "VFD_Frequency", ExtIndex: 14,
	}
	identityFixture().apply(&entry)

	if entry.DisplayID != "MB-014" {
		t.Fatalf("displayId = %q; chờ MB-014", entry.DisplayID)
	}
	if entry.DeviceLabel != "VFD-01" {
		t.Fatalf("deviceLabel = %q; `bus-1-slave-3` là danh tính canonical, không phải tên trong tủ", entry.DeviceLabel)
	}
	if entry.SourceDetail != "HR 102 · FC03" {
		t.Fatalf("sourceDetail = %q; chờ `HR 102 · FC03`", entry.SourceDetail)
	}
}

// Điểm ghi được thì mã hàm đáng quan tâm là mã GHI — đó là thứ sẽ chạm vào
// thiết bị. Hiện FC03 cho một điểm sắp bị ghi là mô tả nhầm hành động.
func TestIdentityShowsWriteFunctionCodeForWritableModbusPoint(t *testing.T) {
	entry := programmingapplication.PointCatalogEntry{
		Category: "MB_RTU", DeviceID: "bus-1-slave-3", PointID: "VFD_Command", ExtIndex: 2,
	}
	identityFixture().apply(&entry)
	if entry.SourceDetail != "HR 40 · FC06" {
		t.Fatalf("sourceDetail = %q; chờ `HR 40 · FC06`", entry.SourceDetail)
	}
}

// `ISS-PIO-31`: slot chưa cấp thì KHÔNG có `MB-nnn`. Bịa số ở đây sẽ dựng một
// định danh runtime cho điểm mà runtime chưa hề cấp chỗ.
func TestIdentityLeavesModbusDisplayIdEmptyWhenSlotUnassigned(t *testing.T) {
	entry := programmingapplication.PointCatalogEntry{
		Category: "MB_RTU", DeviceID: "bus-1-slave-3", PointID: "VFD_Frequency", ExtIndex: 0,
	}
	identityFixture().apply(&entry)
	if entry.DisplayID != "" {
		t.Fatalf("displayId = %q dù chưa cấp slot", entry.DisplayID)
	}
	// Thanh ghi vẫn biết được — mất slot không có nghĩa mất luôn cấu hình điểm.
	if entry.SourceDetail != "HR 102 · FC03" {
		t.Fatalf("sourceDetail = %q", entry.SourceDetail)
	}
}

// Điểm Modbus có trong runtime nhưng KHÔNG còn trong cấu hình: không được bịa
// thanh ghi. Đây chính là trạng thái mà đường Check gọi là "không còn trong
// cấu hình đang chạy" — hàng phải nói đúng như vậy bằng cách im lặng.
func TestIdentityRefusesToInventRegisterForPointMissingFromConfig(t *testing.T) {
	entry := programmingapplication.PointCatalogEntry{
		Category: "MB_RTU", DeviceID: "bus-1-slave-3", PointID: "DA_BI_XOA", ExtIndex: 9,
	}
	identityFixture().apply(&entry)
	if entry.SourceDetail != "" {
		t.Fatalf("sourceDetail = %q; điểm không còn trong cấu hình mà vẫn có thanh ghi", entry.SourceDetail)
	}
	if entry.DeviceLabel != "VFD-01" {
		t.Fatalf("deviceLabel = %q; thiết bị vẫn còn nên nhãn vẫn đúng", entry.DeviceLabel)
	}
}

func TestIdentityGivesLocalAndVirtualRowsTheirDetail(t *testing.T) {
	local := programmingapplication.PointCatalogEntry{Category: "LOCAL", PointID: "UI-01"}
	identityFixture().apply(&local)
	if local.DisplayID != "UI-01" || local.SourceDetail != "0-10V → 0…50 °C" {
		t.Fatalf("hàng vật lý = %+v", local.PointSourceIdentity)
	}

	virtual := programmingapplication.PointCatalogEntry{Category: "VP", PointID: "AV-01"}
	identityFixture().apply(&virtual)
	if virtual.DisplayID != "AV-01" || virtual.SourceDetail != "RW · RETAIN" {
		t.Fatalf("hàng điểm ảo = %+v", virtual.PointSourceIdentity)
	}
}

// Điểm không tra được trong cấu hình thì ba trường phải RỖNG — FE sẽ hiện
// `pointId`. Điền tạm ở đây là biến "chưa biết" thành một lời khẳng định.
func TestIdentityStaysEmptyForUnknownPoint(t *testing.T) {
	entry := programmingapplication.PointCatalogEntry{Category: "LOCAL", PointID: "UI-99"}
	identityFixture().apply(&entry)
	if entry.DisplayID != "" || entry.SourceDetail != "" || entry.DeviceLabel != "" {
		t.Fatalf("điểm lạ vẫn có danh tính: %+v", entry.PointSourceIdentity)
	}
}
