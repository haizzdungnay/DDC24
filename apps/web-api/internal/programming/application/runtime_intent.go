package application

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"mkddc-web/internal/programming/coreipc"
	"mkddc-web/internal/programming/domain"
	programmingstore "mkddc-web/internal/programming/store"
)

const intentCallTimeout = 3 * time.Second

// setProgramEnabledPayload là payload IPC `SET_PROGRAM_ENABLED`:
// `[instanceId, enabled]`. `operationId` đi ở envelope chung như mọi mutation.
type setProgramEnabledPayload struct {
	_          struct{} `cbor:",toarray"`
	InstanceID string
	Enabled    bool
}

// IntentRuntime là phần Core mà service này cần. Tách interface thay vì nhận cả
// client để test không phải dựng một socket thật chỉ để kiểm luật RBAC.
type IntentRuntime interface {
	Call(context.Context, coreipc.Request) (coreipc.Response, error)
}

// ProgramIntentView là hình chiếu public: ý định VÀ trạng thái thật, cạnh nhau.
//
// Hai trường riêng biệt có chủ ý. "Đã bật" là điều người vận hành muốn; "đang
// chạy" là điều thiết bị đang làm. Gộp chúng sẽ làm một Program bật-nhưng-FAULTED
// trông y hệt một Program chưa ai bật — và đó đúng là lúc người vận hành cần
// phân biệt nhất.
type ProgramIntentView struct {
	ProgramID      string `json:"programId"`
	DesiredEnabled bool   `json:"desiredEnabled"`
	Generation     int64  `json:"generation"`
	RuntimeState   string `json:"runtimeState"`
	UpdatedBy      string `json:"updatedBy"`
	UpdatedAtUTCMS int64  `json:"updatedAtUtcMs"`
}

type SetProgramIntentCommand struct {
	SchemaVersion  string
	ProjectID      string
	ProgramID      string
	DesiredEnabled bool
	IdempotencyKey string
	CorrelationID  string
}

type RuntimeIntentServiceOptions struct {
	Store        *programmingstore.Store
	Runtime      IntentRuntime
	ControllerID string
	Now          func() time.Time
	NewID        func() string
}

type RuntimeIntentService struct {
	store        *programmingstore.Store
	runtime      IntentRuntime
	controllerID string
	now          func() time.Time
	newID        func() string
}

func NewRuntimeIntentService(options RuntimeIntentServiceOptions) (*RuntimeIntentService, error) {
	if options.Store == nil || options.ControllerID == "" {
		return nil, fmt.Errorf("RuntimeIntentService thiếu tham số bắt buộc")
	}
	// `Now`/`NewID` có mặc định sản xuất; test tiêm bản tất định. Bắt caller
	// phải khai cả hai sẽ làm mỗi điểm khởi tạo lặp lại cùng một dòng và mỗi
	// dòng là một chỗ để viết sai.
	if options.Now == nil {
		options.Now = time.Now
	}
	if options.NewID == nil {
		options.NewID = uuid.NewString
	}
	return &RuntimeIntentService{store: options.Store, runtime: options.Runtime,
		controllerID: options.ControllerID, now: options.Now, newID: options.NewID}, nil
}

// SetProgramEnabled ghi intent rồi đẩy xuống Core và ghi lại read-back.
//
// Thứ tự có chủ ý: STORE TRƯỚC, Core sau. Intent là thứ bền vững phải sống qua
// mất điện và qua việc Core chưa sẵn sàng; đẩy xuống Core trước rồi mới ghi sẽ
// để lại một thiết bị đã đổi hành vi mà không ai biết ai ra lệnh nếu tiến trình
// chết ở giữa.
func (s *RuntimeIntentService) SetProgramEnabled(ctx context.Context, actor Actor,
	command SetProgramIntentCommand) (MutationResult, error) {
	if command.SchemaVersion != "1.0" || !isUUID(command.ProjectID) ||
		!validText(command.ProgramID, 1, 64) {
		return MutationResult{}, ErrInvalidRequest
	}
	// Actor rỗng nghĩa là middleware auth chưa chạy. Không chặn ở đây thì store
	// từ chối bằng một lỗi không có sentinel và lớp HTTP dịch nó thành 503
	// "retryable" — bảo client thử lại một thứ không bao giờ thành công.
	if !validText(actor.ID, 1, 128) || !validText(actor.Role, 1, 32) {
		return MutationResult{}, ErrInvalidRequest
	}
	keyHash, err := idempotencyHash(command.IdempotencyKey)
	if err != nil {
		return MutationResult{}, err
	}
	requestHash, err := semanticHash(map[string]any{"projectId": command.ProjectID,
		"programId": command.ProgramID, "desiredEnabled": command.DesiredEnabled})
	if err != nil {
		return MutationResult{}, err
	}
	if command.DesiredEnabled {
		// Trần 16 Enabled ép ở đây, TRƯỚC khi ghi intent: intent là thứ bền vững,
		// nên một intent vượt trần sẽ sống lại ở mỗi lần khởi động và bị Core từ
		// chối mãi mãi mà không ai thấy vì sao.
		//
		// Core ép lại trần này một lần nữa ở `start()` — nơi Program thực sự bắt
		// đầu tác động lên đầu ra. Hai lớp không thừa: lớp này cho người dùng một
		// câu trả lời hiểu được, lớp kia bảo đảm bất biến kể cả khi intent tới từ
		// đường khác.
		enabled, err := s.store.CountEnabledPrograms(ctx, command.ProjectID)
		if err != nil {
			return MutationResult{}, err
		}
		current, err := s.store.ListProgramRuntimeIntents(ctx, command.ProjectID)
		if err != nil {
			return MutationResult{}, err
		}
		alreadyEnabled := false
		for _, intent := range current {
			if intent.ProgramID == command.ProgramID && intent.DesiredEnabled {
				alreadyEnabled = true
			}
		}
		if !alreadyEnabled && enabled >= domain.MaxProgramsEnabled {
			return MutationResult{}, &ProgramLimitError{Limit: domain.MaxProgramsEnabled, Actual: enabled + 1}
		}
	}

	identity := programmingstore.ProgramIntentIdentity{
		ProjectID: command.ProjectID, ActorID: actor.ID, Role: actor.Role,
		AuditID: s.newID(), CorrelationID: command.CorrelationID, At: s.now(),
		IdempotencyKeySHA256: keyHash, RequestSHA256: requestHash,
	}
	mutation, err := s.store.SetProgramEnableIntent(ctx, identity, command.ProgramID, command.DesiredEnabled)
	if err != nil {
		return MutationResult{}, err
	}
	// Replay: intent đã ghi từ lần trước, không đẩy lại xuống Core. Đẩy lại sẽ
	// biến một lần gửi lại vì mạng thành một lệnh vận hành thứ hai.
	if !mutation.Replay {
		s.pushToCore(ctx, command, mutation.Intent)
	}
	stored, err := s.readIntent(ctx, command.ProjectID, command.ProgramID)
	if err != nil {
		return MutationResult{}, err
	}
	return MutationResult{
		Resource: map[string]any{"projectId": command.ProjectID, "programId": command.ProgramID,
			"desiredEnabled": stored.DesiredEnabled, "generation": stored.Generation,
			"runtimeState": stored.RuntimeState},
		AuditID: mutation.AuditID, Replay: mutation.Replay,
	}, nil
}

// pushToCore đẩy intent xuống Core và ghi read-back. Lỗi ở đây KHÔNG làm hỏng
// mutation: intent đã bền vững, và Core sẽ được đối chiếu lại ở lần đọc trạng
// thái kế tiếp. Trạng thái ghi lại là `UNKNOWN` chứ không phải trạng thái mong
// muốn — đoán rằng lệnh đã tới nơi là đúng thứ làm người vận hành tin nhầm.
func (s *RuntimeIntentService) pushToCore(ctx context.Context, command SetProgramIntentCommand,
	intent programmingstore.ProgramRuntimeIntent) {
	state := "UNKNOWN"
	defer func() {
		_ = s.store.RecordProgramRuntimeState(ctx, command.ProjectID, command.ProgramID, state, s.now())
	}()
	if s.runtime == nil {
		return
	}
	payload, err := coreipc.EncodePayload(setProgramEnabledPayload{
		InstanceID: command.ProgramID, Enabled: command.DesiredEnabled})
	if err != nil {
		return
	}
	request := coreipc.NewRequest(coreipc.ActionSetProgramEnabled, uuidBytes(s.newID()),
		uuidBytes(s.newID()), s.controllerID, intent.UpdatedBy, command.CorrelationID,
		coreipc.FutureDeadline(intentCallTimeout), payload)
	callCtx, cancel := context.WithTimeout(ctx, intentCallTimeout)
	defer cancel()
	response, err := s.runtime.Call(callCtx, request)
	if err != nil {
		return
	}
	switch response.Result {
	case coreipc.ResultOK:
		// SET_PROGRAM_ENABLED là lệnh đồng bộ: Core chỉ trả OK sau khi
		// scheduler đã đạt trạng thái đích. Giữ STARTING/STOPPING sau OK
		// sẽ làm UI kẹt vĩnh viễn ở một chuyển tiếp không hề tồn tại.
		if command.DesiredEnabled {
			state = "RUNNING"
		} else {
			state = "DISABLED"
		}
	case coreipc.ResultRejected:
		state = "FAULTED"
	}
}

// ListProgramIntents trả toàn bộ intent + trạng thái của một Project.
func (s *RuntimeIntentService) ListProgramIntents(ctx context.Context, projectID string) ([]ProgramIntentView, error) {
	if !isUUID(projectID) {
		return nil, ErrInvalidRequest
	}
	intents, err := s.store.ListProgramRuntimeIntents(ctx, projectID)
	if err != nil {
		return nil, err
	}
	views := make([]ProgramIntentView, 0, len(intents))
	for _, intent := range intents {
		views = append(views, ProgramIntentView{ProgramID: intent.ProgramID,
			DesiredEnabled: intent.DesiredEnabled, Generation: intent.Generation,
			RuntimeState: intent.RuntimeState, UpdatedBy: intent.UpdatedBy,
			UpdatedAtUTCMS: intent.UpdatedAtUTCMS})
	}
	return views, nil
}

func (s *RuntimeIntentService) readIntent(ctx context.Context, projectID, programID string) (programmingstore.ProgramRuntimeIntent, error) {
	intents, err := s.store.ListProgramRuntimeIntents(ctx, projectID)
	if err != nil {
		return programmingstore.ProgramRuntimeIntent{}, err
	}
	for _, intent := range intents {
		if intent.ProgramID == programID {
			return intent, nil
		}
	}
	return programmingstore.ProgramRuntimeIntent{}, programmingstore.ErrNotFound
}

// ProgramLimitError mang đúng mã lỗi trần Program của DDD §5.2. Nó là lỗi riêng
// chứ không phải `ErrInvalidRequest` vì người dùng cần biết CON SỐ trần, không
// chỉ biết là request sai.
type ProgramLimitError struct {
	Limit  int
	Actual int
}

func (e *ProgramLimitError) Error() string {
	return fmt.Sprintf("vượt trần %d Program Enabled (yêu cầu %d)", e.Limit, e.Actual)
}

func (e *ProgramLimitError) PublicCode() string { return "PRG-ERR-PROGRAM-LIMIT-001" }

var _ error = (*ProgramLimitError)(nil)

func asProgramLimitError(err error) (*ProgramLimitError, bool) {
	var limit *ProgramLimitError
	if errors.As(err, &limit) {
		return limit, true
	}
	return nil, false
}

// recoveryResetPayload — payload wire của `RECOVERY_RESET`: một phần tử duy
// nhất là actor. Không có revision, không có instance: lệnh này KHÔNG chọn gói
// nào, nó chỉ gỡ khoá một giao dịch đã hỏng.
type recoveryResetPayload struct {
	_       struct{} `cbor:",toarray"`
	ActorID string
}

// RecoveryResetCommand — yêu cầu gỡ khoá `RECOVERY_REQUIRED`.
type RecoveryResetCommand struct {
	SchemaVersion  string
	Reason         string
	IdempotencyKey string
	CorrelationID  string
}

// RecoveryResetResult — kết quả đồng bộ.
type RecoveryResetResult struct {
	Applied    bool   `json:"applied"`
	DetailCode string `json:"detailCode,omitempty"`
	AuditID    string `json:"auditId"`
}

// RecoveryReset gỡ khoá Core khỏi `RECOVERY_REQUIRED`.
//
// # VÌ SAO CẦN MỘT LỆNH RIÊNG
//
// `RECOVERY_REQUIRED` là ngõ cụt có chủ ý: Core không đoán gói nào còn dùng
// được. Nhưng trước T59-702 nó cũng không có LỐI RA — mọi mutation trả
// `IPC-RECOVERY-REQUIRED`, nên cách duy nhất để bo chạy lại là xoá journal bằng
// tay, tức là xoá sổ vận hành để thoát một trạng thái vận hành. Gặp thật trên bo
// Foxlinx ngày 2026-08-23: journal `COMMITTED` còn đó nhưng artifact đã bị dọn,
// và mọi Commission mới đều bị Core từ chối.
//
// # VÌ SAO ĐỒNG BỘ, KHÔNG QUA KHUNG OPERATION
//
// Đây là một round-trip không có giai đoạn: Core hoặc gỡ được, hoặc không. Không
// có candidate để rollback, không có first-cycle để chờ. Đưa nó vào khung
// operation nhiều pha sẽ thêm một trạng thái `UNKNOWN` cho một lệnh vốn không
// thể ở giữa chừng.
//
// Lệnh KHÔNG nạp gói nào. Sau khi gỡ, Core ở `IDLE` không Active và giữ
// safe-state; muốn chạy lại phải Commission tường minh.
func (s *RuntimeIntentService) RecoveryReset(ctx context.Context, actor Actor,
	command RecoveryResetCommand) (RecoveryResetResult, error) {
	if command.SchemaVersion != "1.0" || !validText(command.Reason, 1, 500) {
		return RecoveryResetResult{}, ErrInvalidRequest
	}
	if !validText(actor.ID, 1, 128) || !validText(actor.Role, 1, 32) {
		return RecoveryResetResult{}, ErrInvalidRequest
	}
	if s.runtime == nil {
		return RecoveryResetResult{}, coreipc.ErrCoreUnavailable
	}
	payload, err := coreipc.EncodePayload(recoveryResetPayload{ActorID: actor.ID})
	if err != nil {
		return RecoveryResetResult{}, err
	}
	request := coreipc.NewRequest(coreipc.ActionRecoveryReset, uuidBytes(s.newID()),
		uuidBytes(s.newID()), s.controllerID, actor.ID, command.CorrelationID,
		coreipc.FutureDeadline(intentCallTimeout), payload)
	callCtx, cancel := context.WithTimeout(ctx, intentCallTimeout)
	defer cancel()
	response, callErr := s.runtime.Call(callCtx, request)

	detail := ""
	if callErr == nil && response.DetailCode != nil {
		detail = *response.DetailCode
	}
	applied := callErr == nil && response.Result == coreipc.ResultOK
	resultCode := "REJECTED"
	if applied {
		resultCode = "APPLIED"
	} else if callErr != nil {
		resultCode = "CORE_UNAVAILABLE"
	}

	// Audit ghi CẢ lần từ chối. Một lệnh gỡ khoá bị từ chối cũng là thông tin
	// vận hành: nó nói ai đã thử, lúc nào, và Core trả lý do gì.
	details, _ := json.Marshal(map[string]any{"reason": command.Reason,
		"detailCode": detail, "applied": applied})
	auditID := s.newID()
	if _, auditErr := s.store.CommitAudit(ctx, programmingstore.AuditInput{
		AuditID: auditID, ActorID: actor.ID, Role: actor.Role,
		Action: "PROGRAMMING_RECOVERY_RESET", TargetType: "controller", TargetID: s.controllerID,
		OccurredAtUTCMS: s.now().UnixMilli(), ResultCode: resultCode,
		CorrelationID: command.CorrelationID, DetailsJSON: details,
	}); auditErr != nil {
		return RecoveryResetResult{}, auditErr
	}
	if callErr != nil {
		return RecoveryResetResult{}, coreipc.ErrCoreUnavailable
	}
	if !applied {
		return RecoveryResetResult{Applied: false, DetailCode: detail, AuditID: auditID}, nil
	}
	return RecoveryResetResult{Applied: true, DetailCode: detail, AuditID: auditID}, nil
}
