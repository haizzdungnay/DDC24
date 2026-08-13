package application

import (
	"context"
	"fmt"
)

// PointCatalogEntry chiếu một Point canonical cho binding — DM-PROG-001 §3.5.
// Category theo đúng ba giá trị đã khoá ở OD-PROG-007: LOCAL/VP/MB_RTU;
// KHÔNG được phát minh category thứ tư.
type PointCatalogEntry struct {
	Category   string `json:"category"`
	PointID    string `json:"pointId"`
	DeviceID   string `json:"deviceId,omitempty"`
	Name       string `json:"name"`
	DataType   string `json:"dataType"`
	Unit       string `json:"unit,omitempty"`
	Direction  string `json:"direction"`
	Writable   bool   `json:"writable"`
	Quality    string `json:"quality"`
	Value      any    `json:"value"`
	ObservedAt string `json:"observedAt,omitempty"`
}

// PointCatalogProvider được `internal/app` implement (adapter quanh
// `App.ReadPoints`) và tiêm vào từ `internal/app/main.go` — `application`
// không được import `internal/app` (ngược hướng phụ thuộc), nên interface
// đứng ở đây theo đúng nguyên tắc Go "accept interfaces, return structs".
type PointCatalogProvider interface {
	ListPointCatalog(ctx context.Context) ([]PointCatalogEntry, error)
}

type PointCatalogPage struct {
	Items      []PointCatalogEntry `json:"items"`
	NextCursor *string             `json:"nextCursor,omitempty"`
}

// ListPointCatalog KHÔNG cache — mỗi request đọc lại authority thật. Rev A
// catalog đủ nhỏ để không cần phân trang thật; tham số `limit` vẫn được tôn
// trọng để không phá hợp đồng khi catalog lớn hơn trong tương lai.
func (s *RuntimeService) ListPointCatalog(ctx context.Context, limit int) (PointCatalogPage, error) {
	if s.catalog == nil {
		return PointCatalogPage{}, fmt.Errorf("Programming point catalog provider chưa cấu hình")
	}
	if limit <= 0 || limit > 500 {
		limit = 500
	}
	entries, err := s.catalog.ListPointCatalog(ctx)
	if err != nil {
		return PointCatalogPage{}, err
	}
	if len(entries) > limit {
		entries = entries[:limit]
	}
	return PointCatalogPage{Items: entries}, nil
}
