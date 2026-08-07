package app

// REST API Scheduler Engine v3.1 — 14 endpoint đặc tả §15
// (Plan 50 SCHD-124, 126..132).
//
// MQTT ngoài phạm vi Rev A (ADR-023 QĐ-2), nhưng NGỮ NGHĨA mà đặc tả §14 đòi là
// bắt buộc và nằm ở đây: revision, correlation_id, ACK/NACK, timeout, retry có
// trần, và chống áp dụng lặp cùng một revision. Khi gắn MQTT về sau chỉ thay
// lớp vận chuyển, hợp đồng này không đổi.

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

const maxSchedules = 64

// Bốn quyền thao tác riêng theo ADR-023 QĐ-5. Hệ thống giữ 3 vai trò
// viewer/operator/admin; quyền dưới đây là lớp bổ sung cho thao tác nguy hiểm.
const (
	permSchedulePublish  = "schedule.publish"
	permScheduleRollback = "schedule.rollback"
	permScheduleDelete   = "schedule.delete"
	permSchedulePriority = "schedule.priority"
)

// schedulePermissions ánh xạ vai trò → quyền. Giữ ở một chỗ để bảng phân quyền
// trong tài liệu và mã nguồn không trôi khỏi nhau.
var schedulePermissions = map[Role][]string{
	RoleAdmin: {permSchedulePublish, permScheduleRollback, permScheduleDelete, permSchedulePriority},
}

func principalHasSchedulePermission(p *Principal, permission string) bool {
	if p == nil {
		return false
	}
	for _, granted := range schedulePermissions[p.Role] {
		if granted == permission {
			return true
		}
	}
	return false
}

// requireSchedulePermission trả false và đã ghi response khi thiếu quyền.
// Thông báo nêu ĐÍCH DANH quyền còn thiếu — "forbidden" trống rỗng không giúp
// người dùng biết phải xin gì.
func (a *App) requireSchedulePermission(w http.ResponseWriter, r *http.Request, permission string) bool {
	if principalHasSchedulePermission(principalFromContext(r.Context()), permission) {
		return true
	}
	writeError(w, http.StatusForbidden, fmt.Sprintf("thiếu quyền %s", permission))
	return false
}

func scheduleActor(r *http.Request) string {
	if p := principalFromContext(r.Context()); p != nil && p.Username != "" {
		return p.Username
	}
	return "-"
}

func nowRFC3339() string { return time.Now().UTC().Format(time.RFC3339) }

// scheduleControllerID nhận diện controller trong nhật ký audit. Cấu hình
// không có trường định danh riêng nên dùng hostname — thật và ổn định hơn một
// hằng số bịa.
func scheduleControllerID() string {
	if h, err := os.Hostname(); err == nil && h != "" {
		return h
	}
	return ""
}

func strPtr(s string) *string { return &s }

// ── GET /api/v1/schedules ─────────────────────────────────────────────────

func (a *App) handleGetSchedules(w http.ResponseWriter, r *http.Request) {
	list, _, err := a.loadSchedulesWithNotes(r.Context())
	if err != nil {
		writeScheduleLoadError(w, err)
		return
	}
	a.attachScheduleRuntime(list)
	// P1-09: không nhét thông báo tiếng Việt vào HTTP header (header chỉ an
	// toàn với ASCII). Giao diện nhận biết qua cờ `migrated_from_v1` trên từng
	// lịch — trường vốn đã có trong hợp đồng cho đúng việc này.
	writeJSON(w, http.StatusOK, list)
}

// ── POST /api/v1/schedules ────────────────────────────────────────────────

func (a *App) handleCreateSchedule(w http.ResponseWriter, r *http.Request) {
	var incoming ScheduleObject
	if err := decodeConfigBody(w, r, &incoming); err != nil {
		writeScheduleFindings(w, []ScheduleValidationFinding{{
			Code: errSchedBadWeekly, Path: "$", Message: err.Error(), Severity: "error",
		}})
		return
	}

	scheduleMutex.Lock()
	defer scheduleMutex.Unlock()

	list, _, err := a.loadSchedulesWithNotes(r.Context())
	if err != nil {
		writeScheduleLoadError(w, err)
		return
	}
	if len(list) >= maxSchedules {
		writeError(w, http.StatusConflict,
			fmt.Sprintf("đã đạt trần %d lịch trên một controller", maxSchedules))
		return
	}
	if incoming.ScheduleID == "" {
		incoming.ScheduleID = nextScheduleID(list)
	}
	if _, exists := findSchedule(list, incoming.ScheduleID); exists {
		writeError(w, http.StatusConflict, fmt.Sprintf("%s đã tồn tại", incoming.ScheduleID))
		return
	}

	actor := scheduleActor(r)
	now := nowRFC3339()
	incoming.SchemaVersion = scheduleSchemaVersion
	incoming.Status = scheduleStatusDraft
	incoming.Revision = 1
	incoming.CorePriorityLevel = scheduleCorePriorityLevel
	incoming.MigratedFromV1 = false
	incoming.Runtime = nil
	incoming.CreatedAt, incoming.CreatedBy = now, actor
	incoming.UpdatedAt, incoming.UpdatedBy = now, actor
	normalizeSchedule(&incoming)

	if findings := validateScheduleObject(&incoming); scheduleFindingsHaveError(findings) {
		writeScheduleFindings(w, findings)
		return
	}

	list = append(list, incoming)
	if err := a.writeScheduleFile(list, nil); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.recordScheduleChange(r, incoming, "CREATE", "", nil, &incoming.Revision, "success", nil)
	writeJSON(w, http.StatusCreated, incoming)
}

// ── GET /api/v1/schedules/{id} ────────────────────────────────────────────

func (a *App) handleGetSchedule(w http.ResponseWriter, r *http.Request) {
	list, obj, ok := a.mustLoadSchedule(w, r)
	if !ok {
		return
	}
	_ = list
	one := []ScheduleObject{obj}
	a.attachScheduleRuntime(one)
	writeJSON(w, http.StatusOK, one[0])
}

// ── PUT /api/v1/schedules/{id} ────────────────────────────────────────────

func (a *App) handleUpdateSchedule(w http.ResponseWriter, r *http.Request) {
	var incoming ScheduleObject
	if err := decodeConfigBody(w, r, &incoming); err != nil {
		writeScheduleFindings(w, []ScheduleValidationFinding{{
			Code: errSchedBadWeekly, Path: "$", Message: err.Error(), Severity: "error",
		}})
		return
	}

	scheduleMutex.Lock()
	defer scheduleMutex.Unlock()

	id := r.PathValue("id")
	list, _, err := a.loadSchedulesWithNotes(r.Context())
	if err != nil {
		writeScheduleLoadError(w, err)
		return
	}
	idx, ok := findSchedule(list, id)
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Sprintf("%s không tồn tại", id))
		return
	}
	current := list[idx]

	// Khoá lạc quan: revision cũ hơn nghĩa là ai đó đã sửa trong lúc mình soạn.
	// Ghi đè im lặng ở đây là mất công của người khác.
	if incoming.Revision != current.Revision {
		writeScheduleFindings(w, []ScheduleValidationFinding{{
			Code: errSchedRevisionConflict, Path: "$.revision", Severity: "error",
			Message: fmt.Sprintf("bản trên máy chủ đang ở revision %d, bản gửi lên là %d — "+
				"hãy tải lại rồi chỉnh lại", current.Revision, incoming.Revision),
		}})
		return
	}
	if incoming.PriorityForWriting != current.PriorityForWriting &&
		!a.requireSchedulePermission(w, r, permSchedulePriority) {
		return
	}

	actor := scheduleActor(r)
	incoming.SchemaVersion = scheduleSchemaVersion
	incoming.ScheduleID = current.ScheduleID
	incoming.Revision = current.Revision + 1
	incoming.CorePriorityLevel = scheduleCorePriorityLevel
	incoming.MigratedFromV1 = false // đã review nên cờ di trú hết hiệu lực
	incoming.Runtime = nil          // runtime là sự thật của controller, không nhận từ client
	incoming.CreatedAt, incoming.CreatedBy = current.CreatedAt, current.CreatedBy
	incoming.UpdatedAt, incoming.UpdatedBy = nowRFC3339(), actor
	// Sửa nội dung thì bản đang chạy trên controller không còn khớp nữa.
	incoming.Status = scheduleStatusDraft
	normalizeSchedule(&incoming)

	if findings := validateScheduleObject(&incoming); scheduleFindingsHaveError(findings) {
		writeScheduleFindings(w, findings)
		return
	}

	list[idx] = incoming
	if err := a.writeScheduleFile(list, nil); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	before := current.Revision
	a.recordScheduleChange(r, incoming, "UPDATE", "", &before, &incoming.Revision, "success", nil)
	writeJSON(w, http.StatusOK, incoming)
}

// ── DELETE /api/v1/schedules/{id} ─────────────────────────────────────────

func (a *App) handleDeleteSchedule(w http.ResponseWriter, r *http.Request) {
	if !a.requireSchedulePermission(w, r, permScheduleDelete) {
		return
	}

	scheduleMutex.Lock()
	defer scheduleMutex.Unlock()

	id := r.PathValue("id")
	list, _, err := a.loadSchedulesWithNotes(r.Context())
	if err != nil {
		writeScheduleLoadError(w, err)
		return
	}
	idx, ok := findSchedule(list, id)
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Sprintf("%s không tồn tại", id))
		return
	}
	victim := list[idx]

	// Đặc tả §9.3: lưu bản cuối vào audit TRƯỚC khi xoá. Nhả target là hệ quả
	// của việc lịch biến mất khỏi cấu hình — core relinquish ở vòng quét kế
	// tiếp qua release_missing().
	before := victim.Revision
	a.recordScheduleChange(r, victim, "DELETE", r.URL.Query().Get("reason"), &before, nil, "success", nil)

	list = append(list[:idx], list[idx+1:]...)
	if err := a.writeScheduleFile(list, nil); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// QĐ-9: chuyển lịch sử sang vùng lưu trữ, KHÔNG xoá. Audit của một lịch đã
	// biến mất đúng là thứ auditor cần nhất.
	if err := a.archiveScheduleState(id, time.Now()); err != nil && a.logger != nil {
		a.logger.Printf("WARN schedule.archive id=%s err=%v", id, err)
	}
	if applied, _ := a.dispatchReload(reloadSIGHUPCore); !applied {
		// Đã xoá khỏi cấu hình nhưng controller vẫn đang chạy bản cũ. 204 ở đây
		// là nói dối; 500 cũng sai vì việc ghi ĐÃ xong. 202 mô tả đúng: đã nhận,
		// chưa hoàn tất.
		writeJSON(w, http.StatusAccepted, map[string]any{
			"result":     "PENDING_CONTROLLER",
			"scheduleId": id,
			"message": "đã xoá khỏi cấu hình nhưng controller chưa nạp lại; " +
				"lịch cũ còn chạy tới khi nạp lại được",
		})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── POST /api/v1/schedules/{id}/validate ──────────────────────────────────

func (a *App) handleValidateSchedule(w http.ResponseWriter, r *http.Request) {
	scheduleMutex.Lock()
	defer scheduleMutex.Unlock()

	id := r.PathValue("id")
	list, _, err := a.loadSchedulesWithNotes(r.Context())
	if err != nil {
		writeScheduleLoadError(w, err)
		return
	}
	idx, ok := findSchedule(list, id)
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Sprintf("%s không tồn tại", id))
		return
	}

	findings := validateScheduleObject(&list[idx])
	result := ScheduleValidationResult{
		Valid:    !scheduleFindingsHaveError(findings),
		Findings: findings,
	}
	if result.Findings == nil {
		result.Findings = []ScheduleValidationFinding{}
	}
	if result.Valid {
		result.Status = scheduleStatusValidated
		if list[idx].Status == scheduleStatusDraft {
			list[idx].Status = scheduleStatusValidated
			if err := a.writeScheduleFile(list, nil); err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
	} else {
		result.Status = scheduleStatusError
	}
	a.recordScheduleChange(r, list[idx], "VALIDATE", "", nil, nil,
		map[bool]string{true: "success", false: "failed"}[result.Valid], nil)
	writeJSON(w, http.StatusOK, result)
}

// ── POST /api/v1/schedules/{id}/publish ───────────────────────────────────

// schedulePublishTimeout là hạn chờ ACK từ controller (đặc tả §21 đòi dưới 5 s).
const schedulePublishTimeout = 5 * time.Second

// schedulePublishAttempts là trần retry. Không có trần thì một controller chết
// biến publish thành vòng lặp vô hạn.
const schedulePublishAttempts = 3

// appliedCorrelations chống áp dụng lặp cùng một (schedule_id, correlation_id).
// Đặc tả §14.4 đòi controller idempotent; ở kiến trúc Rev A thì backend là nơi
// duy nhất phát lệnh nên nó giữ trách nhiệm này.
//
// P1-08: có TTL và trần. Không có thì map lớn dần theo mỗi lần publish và
// không bao giờ nhỏ lại — một tiến trình chạy nhiều tháng trên bo sẽ tích luỹ.
const (
	scheduleCorrelationTTL = 24 * time.Hour
	scheduleCorrelationMax = 512
)

type scheduleCorrelationEntry struct {
	result SchedulePublishResult
	at     time.Time
}

var appliedCorrelations = map[string]scheduleCorrelationEntry{}

// rememberCorrelation lưu kết quả và dọn bản quá hạn. Gọi khi đang giữ
// scheduleMutex.
func rememberCorrelation(key string, result SchedulePublishResult, now time.Time) {
	for k, v := range appliedCorrelations {
		if now.Sub(v.at) > scheduleCorrelationTTL {
			delete(appliedCorrelations, k)
		}
	}
	if len(appliedCorrelations) >= scheduleCorrelationMax {
		// Quá trần thì bỏ bản cũ nhất. Mất một khoá chống-lặp đã 24 giờ tuổi ít
		// hại hơn để bộ nhớ phình vô hạn.
		var oldestKey string
		var oldest time.Time
		for k, v := range appliedCorrelations {
			if oldestKey == "" || v.at.Before(oldest) {
				oldestKey, oldest = k, v.at
			}
		}
		delete(appliedCorrelations, oldestKey)
	}
	appliedCorrelations[key] = scheduleCorrelationEntry{result: result, at: now}
}

func (a *App) handlePublishSchedule(w http.ResponseWriter, r *http.Request) {
	if !a.requireSchedulePermission(w, r, permSchedulePublish) {
		return
	}
	var req SchedulePublishRequest
	if err := decodeConfigBody(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.Reason) == "" {
		writeScheduleFindings(w, []ScheduleValidationFinding{{
			Code: errSchedPublishFailed, Path: "$.reason", Severity: "error",
			Message: "bắt buộc — lý do được lưu vào nhật ký audit",
		}})
		return
	}

	scheduleMutex.Lock()
	defer scheduleMutex.Unlock()

	id := r.PathValue("id")
	list, _, err := a.loadSchedulesWithNotes(r.Context())
	if err != nil {
		writeScheduleLoadError(w, err)
		return
	}
	idx, ok := findSchedule(list, id)
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Sprintf("%s không tồn tại", id))
		return
	}
	obj := list[idx]

	if req.CorrelationID != "" {
		key := id + "|" + req.CorrelationID
		if prev, seen := appliedCorrelations[key]; seen {
			// Gửi lại cùng correlation_id KHÔNG được áp dụng lần hai.
			writeJSON(w, http.StatusOK, prev.result)
			return
		}
	}

	if req.Revision != obj.Revision {
		writeScheduleFindings(w, []ScheduleValidationFinding{{
			Code: errSchedRevisionConflict, Path: "$.revision", Severity: "error",
			Message: fmt.Sprintf("máy chủ đang ở revision %d, yêu cầu publish revision %d",
				obj.Revision, req.Revision),
		}})
		return
	}
	// Chỉ lịch hợp lệ mới được publish (đặc tả §13.2).
	if findings := validateScheduleObject(&obj); scheduleFindingsHaveError(findings) {
		writeScheduleFindings(w, findings)
		return
	}

	// Trạng thái ghi vào tệp TRƯỚC khi nạp; nếu controller từ chối thì hoàn tác.
	previousStatus := obj.Status
	list[idx].Status = scheduleStatusPublished
	if err := a.writeScheduleFile(list, nil); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	result := SchedulePublishResult{Revision: obj.Revision, CorrelationID: req.CorrelationID}
	var applied bool
	for attempt := 1; attempt <= schedulePublishAttempts; attempt++ {
		result.Attempts = attempt
		applied, _ = a.dispatchReload(reloadSIGHUPCore)
		if applied {
			break
		}
		if attempt < schedulePublishAttempts {
			// P1-07: NHẢ khoá trước khi ngủ. Ngủ trong vùng khoá làm mọi
			// endpoint lịch khác đứng chờ — publish hàng loạt 10 lịch khi
			// controller không phản hồi sẽ khoá cả trang hơn 30 giây.
			scheduleMutex.Unlock()
			time.Sleep(schedulePublishTimeout / time.Duration(schedulePublishAttempts))
			scheduleMutex.Lock()
		}
	}

	if !applied {
		// Publish hỏng thì revision đang chạy KHÔNG đổi (đặc tả §13.2).
		list[idx].Status = previousStatus
		if err := a.writeScheduleFile(list, nil); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		result.Result = "TIMEOUT"
		result.ErrorCode = strPtr(errSchedPublishFailed)
		result.ErrorMessage = strPtr("controller không phản hồi; revision đang chạy giữ nguyên")
		a.recordScheduleChange(r, obj, "PUBLISH", req.Reason, &obj.Revision, &obj.Revision,
			"failed", strPtr(errSchedPublishFailed))
		writeJSON(w, http.StatusGatewayTimeout, result)
		return
	}

	result.Result = "ACCEPTED"
	result.AppliedAt = strPtr(nowRFC3339())
	if req.CorrelationID != "" {
		rememberCorrelation(id+"|"+req.CorrelationID, result, time.Now())
	}
	published := list[idx]
	_ = a.appendScheduleRevision(published, scheduleActor(r), req.Reason, nil)
	a.recordScheduleChange(r, published, "PUBLISH", req.Reason, &obj.Revision, &published.Revision,
		"success", nil)
	writeJSON(w, http.StatusOK, result)
}

// ── POST /api/v1/schedules/{id}/enable | disable ──────────────────────────

func (a *App) handleEnableSchedule(w http.ResponseWriter, r *http.Request) {
	a.setScheduleEnabled(w, r, true)
}

func (a *App) handleDisableSchedule(w http.ResponseWriter, r *http.Request) {
	a.setScheduleEnabled(w, r, false)
}

func (a *App) setScheduleEnabled(w http.ResponseWriter, r *http.Request, enabled bool) {
	scheduleMutex.Lock()
	defer scheduleMutex.Unlock()

	id := r.PathValue("id")
	list, _, err := a.loadSchedulesWithNotes(r.Context())
	if err != nil {
		writeScheduleLoadError(w, err)
		return
	}
	idx, ok := findSchedule(list, id)
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Sprintf("%s không tồn tại", id))
		return
	}

	before := list[idx].Revision
	list[idx].Enabled = enabled
	list[idx].Revision++
	list[idx].UpdatedAt, list[idx].UpdatedBy = nowRFC3339(), scheduleActor(r)
	if !enabled {
		// Đặc tả §9.2: tắt lịch là ngừng đánh giá VÀ relinquish tại priority
		// đang dùng — core thực hiện việc nhả ở vòng quét kế tiếp.
		list[idx].Status = scheduleStatusDisabled
	} else if list[idx].Status == scheduleStatusDisabled {
		list[idx].Status = scheduleStatusPublished
	}

	if err := a.writeScheduleFile(list, nil); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	applied, _ := a.dispatchReload(reloadSIGHUPCore)
	action := map[bool]string{true: "ENABLE", false: "DISABLE"}[enabled]
	outcome := map[bool]string{true: "success", false: "failed"}[applied]
	a.recordScheduleChange(r, list[idx], action, "", &before, &list[idx].Revision, outcome, nil)

	one := []ScheduleObject{list[idx]}
	if applied {
		a.attachScheduleRuntime(one)
	} else {
		// Cấu hình ĐÃ ghi nhưng controller chưa nạp lại, nên nó vẫn đang chạy
		// bản cũ. Đó đúng là định nghĩa của OUT_OF_SYNC — nói bằng trạng thái
		// có sẵn trong hợp đồng, thay vì trả 500 (làm như chưa ghi gì) hay 200
		// im lặng (làm như đã có hiệu lực).
		one[0].Status = scheduleStatusOutOfSync
	}
	writeJSON(w, http.StatusOK, one[0])
}

// ── GET /api/v1/schedules/{id}/revisions ──────────────────────────────────

func (a *App) handleGetScheduleRevisions(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := a.mustLoadSchedule(w, r); !ok {
		return
	}
	entries, err := a.listScheduleRevisions(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, entries)
}

// ── POST /api/v1/schedules/{id}/rollback ──────────────────────────────────

func (a *App) handleRollbackSchedule(w http.ResponseWriter, r *http.Request) {
	if !a.requireSchedulePermission(w, r, permScheduleRollback) {
		return
	}
	var req ScheduleRollbackRequest
	if err := decodeConfigBody(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.Reason) == "" {
		writeScheduleFindings(w, []ScheduleValidationFinding{{
			Code: errSchedRollbackFailed, Path: "$.reason", Severity: "error",
			Message: "bắt buộc — rollback phải giải thích được về sau",
		}})
		return
	}

	scheduleMutex.Lock()
	defer scheduleMutex.Unlock()

	id := r.PathValue("id")
	list, _, err := a.loadSchedulesWithNotes(r.Context())
	if err != nil {
		writeScheduleLoadError(w, err)
		return
	}
	idx, ok := findSchedule(list, id)
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Sprintf("%s không tồn tại", id))
		return
	}
	current := list[idx]

	old, err := a.loadScheduleRevision(id, req.TargetRevision)
	if err != nil {
		writeScheduleFindings(w, []ScheduleValidationFinding{{
			Code: errSchedRollbackFailed, Path: "$.target_revision", Severity: "error",
			Message: err.Error(),
		}})
		return
	}

	// Rollback tạo revision MỚI, không viết lại lịch sử.
	restored := old
	restored.Revision = current.Revision + 1
	restored.Status = scheduleStatusDraft
	restored.CorePriorityLevel = scheduleCorePriorityLevel
	restored.Runtime = nil
	restored.CreatedAt, restored.CreatedBy = current.CreatedAt, current.CreatedBy
	restored.UpdatedAt, restored.UpdatedBy = nowRFC3339(), scheduleActor(r)
	normalizeSchedule(&restored)

	list[idx] = restored
	if err := a.writeScheduleFile(list, nil); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	target := req.TargetRevision
	_ = a.appendScheduleRevision(restored, scheduleActor(r), req.Reason, &target)
	a.recordScheduleChange(r, restored, "ROLLBACK", req.Reason, &current.Revision,
		&restored.Revision, "success", nil)
	writeJSON(w, http.StatusOK, restored)
}

// ── GET /api/v1/schedules/{id}/runtime ────────────────────────────────────

func (a *App) handleGetScheduleRuntime(w http.ResponseWriter, r *http.Request) {
	_, obj, ok := a.mustLoadSchedule(w, r)
	if !ok {
		return
	}
	one := []ScheduleObject{obj}
	a.attachScheduleRuntime(one)
	if one[0].Runtime == nil {
		// Controller chưa báo. Trả khối rỗng có cấu trúc để giao diện hiển thị
		// gạch ngang, thay vì để nó tự bịa số 0.
		writeJSON(w, http.StatusOK, ScheduleRuntimeState{Targets: []ScheduleTargetRuntime{}})
		return
	}
	writeJSON(w, http.StatusOK, one[0].Runtime)
}

// ── GET /api/v1/schedules/{id}/audit ──────────────────────────────────────

func (a *App) handleGetScheduleAudit(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := a.mustLoadSchedule(w, r); !ok {
		return
	}
	entries, err := a.listScheduleAudit(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, entries)
}

// ── Tiện ích dùng chung ───────────────────────────────────────────────────

func (a *App) mustLoadSchedule(w http.ResponseWriter, r *http.Request) ([]ScheduleObject, ScheduleObject, bool) {
	list, _, err := a.loadSchedulesWithNotes(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return nil, ScheduleObject{}, false
	}
	id := r.PathValue("id")
	idx, ok := findSchedule(list, id)
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Sprintf("%s không tồn tại", id))
		return nil, ScheduleObject{}, false
	}
	return list, list[idx], true
}

// writeScheduleLoadError phân biệt "tệp còn định dạng cũ" với lỗi đọc thật.
// Định dạng cũ không phải lỗi máy chủ — nó là một bước quản trị chưa chạy, và
// người dùng cần biết chính xác điều đó.
func writeScheduleLoadError(w http.ResponseWriter, err error) {
	if errors.Is(err, errScheduleLegacyFormat) {
		writeError(w, http.StatusConflict,
			"schedule.conf còn ở định dạng cũ và chưa được di trú; di trú chạy lúc khởi động "+
				"dịch vụ, hãy khởi động lại mkddc-web rồi kiểm tra lại các lịch")
		return
	}
	writeError(w, http.StatusInternalServerError, err.Error())
}

func writeScheduleFindings(w http.ResponseWriter, findings []ScheduleValidationFinding) {
	if findings == nil {
		findings = []ScheduleValidationFinding{}
	}
	writeJSON(w, http.StatusBadRequest, ScheduleValidationResult{
		Valid: false, Status: scheduleStatusError, Findings: findings,
	})
}

// recordScheduleChange ghi audit theo lịch (đặc tả §20, đủ 10 trường) và cả
// dòng audit hệ thống hiện có.
func (a *App) recordScheduleChange(r *http.Request, obj ScheduleObject, action, reason string,
	before, after *uint64, result string, errorCode *string) {
	actor := scheduleActor(r)
	entry := ScheduleAuditEntry{
		At:             nowRFC3339(),
		Actor:          actor,
		Action:         action,
		ScheduleID:     obj.ScheduleID,
		RevisionBefore: before,
		RevisionAfter:  after,
		Reason:         reason,
		Changes:        scheduleChangeSummary(action, obj),
		ControllerID:   scheduleControllerID(),
		Result:         result,
		ErrorCode:      errorCode,
		SourceIP:       r.RemoteAddr,
	}
	_ = a.appendScheduleAudit(entry)
	a.audit.Change(actor, "schedule."+strings.ToLower(action), obj.ScheduleID, result, r.RemoteAddr)
}

func scheduleChangeSummary(action string, obj ScheduleObject) string {
	targets := make([]string, 0, len(obj.TargetObjects))
	for _, t := range obj.TargetObjects {
		if t.PointID != "" {
			targets = append(targets, t.PointID)
		}
	}
	return fmt.Sprintf("%s %s (%s, priority %d, %d target: %s)",
		action, obj.ScheduleName, obj.ValueType, obj.PriorityForWriting,
		len(obj.TargetObjects), strings.Join(targets, ", "))
}
