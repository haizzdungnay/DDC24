package application

import (
	"context"
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
		uuidBytes(s.newID()), s.controllerID, "", command.CorrelationID,
		coreipc.FutureDeadline(intentCallTimeout), payload)
	callCtx, cancel := context.WithTimeout(ctx, intentCallTimeout)
	defer cancel()
	response, err := s.runtime.Call(callCtx, request)
	if err != nil {
		return
	}
	switch response.Result {
	case coreipc.ResultOK:
		// Core nhận lệnh nhưng Program chưa chắc đã ở trạng thái cuối: bật một
		// Program đi qua STARTING, tắt đi qua STOPPING. Ghi trạng thái CHUYỂN
		// TIẾP chứ không ghi thẳng RUNNING/DISABLED — nói nó đã tới đích khi nó
		// mới lên đường là nói dối người vận hành.
		if command.DesiredEnabled {
			state = "STARTING"
		} else {
			state = "STOPPING"
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
