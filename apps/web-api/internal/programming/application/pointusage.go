package application

import (
	"context"
	"encoding/json"
	"sort"
	"strings"

	programmingstore "mkddc-web/internal/programming/store"
)

/* ISS-PIO-18 — "ai đang dùng điểm này" phải trả lời được cả phía Programming.
 *
 * TRIỆU CHỨNG: `virtualpoint_usage.go` khai `Kind: alarm | schedule | program`
 * và nêu đúng động cơ — "một chương trình ST mất binding" — nhưng chỉ quét
 * `alarm-settings` và `schedules`. Không nguồn nào sinh `Kind = "program"`. Xoá
 * một VP đang được một chương trình bind cho ra danh sách RỖNG kèm
 * `incomplete = false`: một lời khẳng định SAI, đúng thứ mà chính chú thích của
 * tệp đó cảnh báo.
 *
 * Một danh sách rỗng KÈM `incomplete=false` nguy hiểm hơn hẳn một lỗi ồn ào: nó
 * là câu trả lời "đã kiểm, không ai dùng" cho một câu hỏi chưa từng được hỏi.
 *
 * PHẠM VI QUÉT, và vì sao đúng hai chỗ này:
 *   - DRAFT của mọi Project: đây là nơi binding sống trước khi niêm phong, và
 *     là thứ người dùng sẽ Commission tiếp theo.
 *   - Revision ĐANG CHẠY: đây là mã đang điều khiển thiết bị lúc này.
 * Revision đã niêm phong nhưng KHÔNG chạy là lịch sử bất biến — xoá một VP
 * không làm hỏng chúng ở hiện tại, và liệt kê chúng sẽ làm loãng danh sách bằng
 * những mục người vận hành không hành động được.
 */

// PointReference là một binding Programming trỏ tới điểm đang hỏi.
type PointReference struct {
	ProjectID   string
	ProjectName string
	// Scope: `draft` (bản đang soạn) hoặc `active-revision` (mã đang chạy).
	Scope string
	// RevisionID rỗng khi Scope = `draft`.
	RevisionID string
	ProgramID  string
	Variable   string
	Direction  string
	// PointID là chuỗi ghi TRONG binding, giữ nguyên văn để người đọc đối chiếu
	// được với thứ họ thấy trên tab Ánh xạ.
	PointID string
	// Category rỗng khi binding không mang trường đó (hình dạng v2).
	Category string
}

// PointMatcher trả lời "binding này có trỏ tới điểm đang hỏi không".
//
// Nhận cả `category` lẫn `pointId` vì hai hình dạng binding cùng tồn tại thật:
// bản v1 (tab Ánh xạ) lồng `point: {category, pointId}`, bản v2 gọn hơn chỉ có
// `pointId` phẳng và KHÔNG có category. Người gọi quyết định luật so khớp —
// ngữ nghĩa "thế nào là một điểm ảo" thuộc về tầng app, không phải tầng này.
type PointMatcher func(category, pointID string) bool

// PointReferenceScan là kết quả quét, kèm phần KHÔNG đọc được.
type PointReferenceScan struct {
	References []PointReference
	// Errors là các nguồn không đọc được. Có phần tử ⇒ danh sách trên KHÔNG đầy
	// đủ và người gọi phải nói ra điều đó trước khi ai bấm xoá.
	Errors []string
}

// maxUsageScanProjects là trần số Project quét trong một lần hỏi.
//
// Có trần vì endpoint này nằm trên đường người dùng bấm "xoá" và phải trả lời
// nhanh. Chạm trần KHÔNG được im lặng: `FindPointReferences` ghi một dòng vào
// `Errors`, nên câu trả lời hạ xuống "chưa quét hết" thay vì "không ai dùng".
const maxUsageScanProjects = 200

// usageScanPageSize là cỡ trang khi đọc Project.
//
// `Store.ListProjects` từ chối limit > 101, nên KHÔNG thể hỏi cả trần trong một
// lần gọi — phải phân trang thật. Xin 100 rồi lặp: hạ trần xuống 100 cho gọn mã
// sẽ biến một giới hạn KỸ THUẬT của tầng store thành một giới hạn SẢN PHẨM im
// lặng, và một hệ có 150 Project sẽ được trả lời "không ai dùng" cho 50 Project
// chưa từng đọc tới.
const usageScanPageSize = 100

// FindPointReferences quét binding Programming tìm tham chiếu tới một điểm.
//
// Không gọi `ListProjects`: hàm đó hỏi Core để dán nhãn Revision và trả lỗi khi
// Core im. Ở đây Core im chỉ được phép làm KẾT QUẢ KÉM ĐẦY ĐỦ (một dòng trong
// `Errors`), không được làm cả câu trả lời biến mất — người vận hành vẫn cần
// biết Draft nào đang bind điểm này kể cả lúc Core đang tắt.
func (s *ProjectService) FindPointReferences(ctx context.Context, match PointMatcher) (PointReferenceScan, error) {
	scan := PointReferenceScan{References: []PointReference{}}
	if s == nil || s.store == nil || match == nil {
		return scan, nil
	}

	var snapshots []programmingstore.ProjectSnapshot
	truncated := false
	afterAt, afterID := int64(0), ""
	for {
		page, err := s.store.ListProjects(ctx, afterAt, afterID, usageScanPageSize)
		if err != nil {
			return scan, err
		}
		snapshots = append(snapshots, page...)
		if len(page) < usageScanPageSize {
			break
		}
		if len(snapshots) >= maxUsageScanProjects {
			truncated = true
			snapshots = snapshots[:maxUsageScanProjects]
			break
		}
		last := page[len(page)-1]
		afterAt, afterID = last.Project.UpdatedAtUTCMS, last.Project.ProjectID
	}

	activeRevisionID := ""
	if active, err := s.resolveActiveRevision(ctx); err != nil {
		scan.Errors = append(scan.Errors, "programming-active-revision: "+err.Error())
	} else if active.Resolved {
		activeRevisionID = active.RevisionID
	} else {
		/* `Resolved=false` nghĩa là CHƯA BIẾT Revision nào đang chạy — Core im,
		 * hoặc Core báo một Revision mà DB Web không có. Đây không phải "không
		 * có Revision nào chạy": nói ra sự khác biệt đó, vì im lặng ở đây biến
		 * "chưa hỏi được mã đang chạy" thành "mã đang chạy không dùng điểm này". */
		scan.Errors = append(scan.Errors, "programming-active-revision: chưa xác định được Revision đang chạy")
	}

	for _, snapshot := range snapshots {
		name := snapshot.Project.Name
		refs, err := bindingReferences(snapshot.Draft.ContentJSON, match)
		if err != nil {
			scan.Errors = append(scan.Errors, "programming-draft "+snapshot.Project.ProjectID+": "+err.Error())
		}
		for _, ref := range refs {
			ref.ProjectID = snapshot.Project.ProjectID
			ref.ProjectName = name
			ref.Scope = "draft"
			scan.References = append(scan.References, ref)
		}
	}

	if activeRevisionID != "" {
		revision, err := s.store.GetRevision(ctx, activeRevisionID)
		if err != nil {
			scan.Errors = append(scan.Errors, "programming-active-revision: "+err.Error())
		} else {
			refs, err := manifestBindingReferences(revision.Revision.ManifestJSON, match)
			if err != nil {
				scan.Errors = append(scan.Errors, "programming-active-revision: "+err.Error())
			}
			for _, ref := range refs {
				ref.ProjectID = revision.Revision.ProjectID
				ref.ProjectName = projectNameOf(snapshots, revision.Revision.ProjectID)
				ref.Scope = "active-revision"
				ref.RevisionID = activeRevisionID
				scan.References = append(scan.References, ref)
			}
		}
	}

	if truncated {
		scan.Errors = append(scan.Errors,
			"programming-draft: vượt trần quét, còn Project chưa kiểm")
	}

	sort.SliceStable(scan.References, func(i, j int) bool {
		left, right := scan.References[i], scan.References[j]
		if left.Scope != right.Scope {
			// `active-revision` lên trước `draft`: mã đang chạy là hậu quả tức thì.
			return left.Scope < right.Scope
		}
		if left.ProjectID != right.ProjectID {
			return left.ProjectID < right.ProjectID
		}
		return left.Variable < right.Variable
	})
	return scan, nil
}

func projectNameOf(snapshots []programmingstore.ProjectSnapshot, projectID string) string {
	for _, snapshot := range snapshots {
		if snapshot.Project.ProjectID == projectID {
			return snapshot.Project.Name
		}
	}
	return ""
}

// bindingReferences đọc binding từ tài liệu Draft canonical.
func bindingReferences(contentJSON []byte, match PointMatcher) ([]PointReference, error) {
	if len(contentJSON) == 0 {
		return nil, nil
	}
	var document map[string]any
	if err := json.Unmarshal(contentJSON, &document); err != nil {
		return nil, err
	}
	items, _ := document["bindings"].([]any)
	refs := make([]PointReference, 0, len(items))
	for _, item := range items {
		binding, ok := item.(map[string]any)
		if !ok {
			continue
		}
		category, pointID := bindingTarget(binding)
		if pointID == "" || !match(category, pointID) {
			continue
		}
		refs = append(refs, PointReference{
			ProgramID: stringOf(binding["programId"]),
			Variable:  stringOf(binding["variable"]),
			Direction: stringOf(binding["direction"]),
			PointID:   pointID,
			Category:  category,
		})
	}
	return refs, nil
}

// manifestBindingReferences đọc binding từ manifest của một Revision đã seal.
// Ở đó hình dạng là PHẲNG (`category`/`pointId` ngay trên thân binding) — xem
// `checks_manifest.go:validateManifestBindings`.
func manifestBindingReferences(manifestJSON []byte, match PointMatcher) ([]PointReference, error) {
	if len(manifestJSON) == 0 {
		return nil, nil
	}
	var document struct {
		Bindings []struct {
			ProgramID string `json:"programId"`
			Variable  string `json:"variable"`
			Direction string `json:"direction"`
			Category  string `json:"category"`
			PointID   string `json:"pointId"`
		} `json:"bindings"`
	}
	if err := json.Unmarshal(manifestJSON, &document); err != nil {
		return nil, err
	}
	refs := make([]PointReference, 0, len(document.Bindings))
	for _, binding := range document.Bindings {
		if binding.PointID == "" || !match(binding.Category, binding.PointID) {
			continue
		}
		refs = append(refs, PointReference{
			ProgramID: binding.ProgramID, Variable: binding.Variable, Direction: binding.Direction,
			PointID: binding.PointID, Category: binding.Category,
		})
	}
	return refs, nil
}

/* bindingTarget lấy `(category, pointId)` từ MỘT binding, chấp cả hai hình dạng
 * đang cùng tồn tại trong tài liệu Draft:
 *
 *   v1 (tab Ánh xạ ghi):  {"bindingId", "variableId", "point": {"category", "pointId"}, ...}
 *   v2 (`upsertBindingV2`): {"bindingId", "programId", "variable", "pointId", "direction"}
 *
 * Đọc `point` lồng TRƯỚC: khi cả hai cùng có mặt thì `point` là thứ tab Ánh xạ
 * và lớp Check dùng, nên nó là nguồn đúng. Bản v2 không có `category`, và điều
 * đó được chuyển nguyên vẹn lên `PointMatcher` dưới dạng chuỗi rỗng thay vì bịa
 * ra một category — người quyết định luật so khớp phải biết mình đang thiếu gì.
 */
func bindingTarget(binding map[string]any) (category, pointID string) {
	if point, ok := binding["point"].(map[string]any); ok {
		category = stringOf(point["category"])
		pointID = stringOf(point["pointId"])
		if pointID != "" {
			return category, pointID
		}
	}
	return stringOf(binding["category"]), stringOf(binding["pointId"])
}

func stringOf(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}
