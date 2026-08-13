package app

import (
	"context"
	"fmt"

	programmingapplication "mkddc-web/internal/programming/application"
)

// programmingPointCatalogAdapter chiếu `PointDTO` (authority Point hiện hữu
// của toàn hệ thống — LOCAL qua SHM Core, VP qua `overlayVirtualPoints`,
// Modbus RTU qua `EXT_PHYSICAL`) sang `PointCatalogEntry` của Programming.
// Đặt ở `internal/app` (không phải `internal/programming/application`) vì
// hướng phụ thuộc chỉ được một chiều: `app` đã import `programming/*`, chiều
// ngược lại sẽ tạo import cycle — đây là "accept interfaces, return structs"
// đúng nghĩa Go, không phải một API/domain model song song (không có store,
// không có identity mới; Point Catalog authority vẫn là chỗ cũ).
//
// Rev A: chỉ ba category LOCAL/VP/MB_RTU (OD-PROG-007); Kind từ producer thật
// (`pointKindFromID`, "virtual", "modbus_rtu") quyết định category — không tự
// suy đoán hay tạo category thứ tư.
type programmingPointCatalogAdapter struct{ app *App }

func (a *App) programmingPointCatalog() programmingapplication.PointCatalogProvider {
	return programmingPointCatalogAdapter{app: a}
}

func (adapter programmingPointCatalogAdapter) ListPointCatalog(ctx context.Context) ([]programmingapplication.PointCatalogEntry, error) {
	points, err := adapter.app.ReadPoints(ctx)
	if err != nil {
		return nil, err
	}
	entries := make([]programmingapplication.PointCatalogEntry, 0, len(points))
	for _, point := range points {
		entries = append(entries, toPointCatalogEntry(point))
	}
	return entries, nil
}

func toPointCatalogEntry(point PointDTO) programmingapplication.PointCatalogEntry {
	category, deviceID := pointCatalogCategory(point)
	direction, writable := pointCatalogDirection(point)
	return programmingapplication.PointCatalogEntry{
		Category: category, PointID: point.ID, DeviceID: deviceID, Name: pointCatalogName(point),
		DataType: pointCatalogDataType(point), Unit: point.Unit, Direction: direction, Writable: writable,
		Quality: pointCatalogQuality(point), Value: point.Value, ObservedAt: point.UpdatedAt,
	}
}

func pointCatalogCategory(point PointDTO) (category, deviceID string) {
	switch point.Kind {
	case "virtual", "VP":
		return "VP", ""
	case "modbus_rtu":
		return "MB_RTU", fmt.Sprintf("bus-%d-slave-%d", point.BusID, point.SlaveAddr)
	default:
		return "LOCAL", ""
	}
}

func pointCatalogName(point PointDTO) string {
	if point.Name != "" {
		return point.Name
	}
	return point.ID
}

func pointCatalogDirection(point PointDTO) (direction string, writable bool) {
	switch point.Kind {
	case "AO", "DO":
		return "READ_WRITE", true
	case "virtual", "modbus_rtu":
		if point.Writable {
			return "READ_WRITE", true
		}
		return "READ", false
	default:
		return "READ", false
	}
}

func pointCatalogDataType(point PointDTO) string {
	switch point.Kind {
	case "DO":
		return "BOOL"
	case "AO", "UI":
		if _, ok := point.Value.(bool); ok {
			return "BOOL"
		}
		return "REAL"
	default:
		if _, ok := point.Value.(bool); ok {
			return "BOOL"
		}
		return "REAL"
	}
}

// pointCatalogQuality chuẩn hoá quality producer về đúng sáu mức Programming
// (DM-PROG-001 — GOOD/UNCERTAIN/BAD/STALE/OFFLINE/UNKNOWN); giá trị lạ hoặc
// rỗng về UNKNOWN, KHÔNG suy đoán thành GOOD (RSK-PROG-010).
func pointCatalogQuality(point PointDTO) string {
	switch point.Quality {
	case "GOOD", "UNCERTAIN", "BAD", "STALE", "OFFLINE", "UNKNOWN":
		return point.Quality
	case "CONFIG_ERROR":
		return "BAD"
	default:
		return "UNKNOWN"
	}
}
