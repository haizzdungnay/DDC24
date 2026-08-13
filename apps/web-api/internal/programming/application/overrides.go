package application

import (
	"context"
	"fmt"
)

// OverrideEntry chiếu một override thủ công đang giữ output — DM-PROG-001
// §3.10 "Output sample". `ActorID` rỗng khi registry không biết ai đã force
// (ví dụ override có từ trước khi Web restart) — KHÔNG được bịa một actor để
// lấp chỗ trống (RSK-PROG-010); FE phải hiện `—` cho trường hợp đó.
type OverrideEntry struct {
	Category          string `json:"category"`
	PointID           string `json:"pointId"`
	DeviceID          string `json:"deviceId,omitempty"`
	Value             any    `json:"value"`
	Source            string `json:"source"`
	ActorID           string `json:"actorId,omitempty"`
	EffectivePriority int    `json:"effectivePriority,omitempty"`
	RemainingS        *int64 `json:"remainingS"`
}

type OverrideProvider interface {
	ListActiveOverrides(ctx context.Context) ([]OverrideEntry, error)
}

type OverridePage struct {
	Items      []OverrideEntry `json:"items"`
	NextCursor *string         `json:"nextCursor,omitempty"`
}

// ListOverrides — `GET /overrides`. `activeOnly` luôn `true` trong thực tế vì
// provider chỉ bao giờ chiếu Point đang thật sự bị force (không có khái niệm
// "override đã hết hạn còn lưu" ở tầng adapter này); tham số vẫn được nhận để
// khớp `?activeOnly=true` của hợp đồng, không phải vì có nhánh khác.
func (s *RuntimeService) ListOverrides(ctx context.Context, limit int) (OverridePage, error) {
	if s.overrides == nil {
		return OverridePage{}, fmt.Errorf("Programming override provider chưa cấu hình")
	}
	if limit <= 0 || limit > 500 {
		limit = 500
	}
	entries, err := s.overrides.ListActiveOverrides(ctx)
	if err != nil {
		return OverridePage{}, err
	}
	if len(entries) > limit {
		entries = entries[:limit]
	}
	return OverridePage{Items: entries}, nil
}
