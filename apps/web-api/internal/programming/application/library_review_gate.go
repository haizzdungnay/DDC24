package application

import (
	"mkddc-web/internal/programming/domain"
	programmingstore "mkddc-web/internal/programming/store"
)

/*
effectiveLibraryFeatureState trả trạng thái duyệt HIỆU LỰC của một entry cho
client (PGM-04, Quick Library, chèn từ thư viện vào editor).

`REVIEW_REQUIRED` trong registry SYSTEM là nhãn tĩnh: nó nằm trong danh tính
thực thi (`contentSha256`) và KHÔNG đổi khi feature được duyệt. Việc duyệt là
token Controls/Safety trong product profile, và Core đọc bảng sinh từ token đó
để quyết định Check. Issue #802: sau khi `PID` được ký token, Check nhận PID
nhưng API vẫn trả `REVIEW_REQUIRED`, nên mọi nút Chèn PID ở UI vẫn bị khoá —
PID dùng được ở Core mà không dùng được từ thư viện.

Phủ ở đây bằng CHÍNH bảng sinh từ profile (`domain.ReviewGatedFeatures`), cùng
nguồn mà Core dùng, để hai nơi không thể nói khác nhau. Fail-closed: chỉ áp cho
scope SYSTEM, và chỉ khi bảng có đúng feature đó VÀ đã duyệt; entry
`REVIEW_REQUIRED` không có trong bảng vẫn giữ nguyên nhãn.
*/
func effectiveLibraryFeatureState(scope, entryID, featureState string,
	approved func(featureID string) bool) string {
	if scope != programmingstore.LibraryScopeSystem ||
		featureState != string(domain.LibraryFeatureReviewRequired) {
		return featureState
	}
	if approved(entryID) {
		return string(domain.LibraryFeatureAvailable)
	}
	return featureState
}

// reviewGateApproved đọc bảng review-gate sinh từ product profile.
func reviewGateApproved(featureID string) bool {
	for _, item := range domain.ReviewGatedFeatures {
		if item.FeatureID == featureID {
			return item.Approved && item.ApprovalToken != ""
		}
	}
	return false
}
