package application

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"

	"mkddc-web/internal/programming/coreipc"
	"mkddc-web/internal/programming/domain"
	programmingstore "mkddc-web/internal/programming/store"
)

const intentCallTimeout = 3 * time.Second
const intentReconcileInterval = 2 * time.Second

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
	intentMu     sync.Mutex
	lifecycleMu  sync.Mutex
	cancel       context.CancelFunc
	wg           sync.WaitGroup

	// Trạng thái sức khoẻ của vòng reconcile nền. `healthMu` RIÊNG với
	// `intentMu` có chủ ý: `ReconcileOnce` giữ `intentMu` suốt cả vòng đẩy
	// xuống Core, nên dùng chung một khoá sẽ biến `LastReconcileError()` thành
	// lời gọi chặn theo nhịp IPC — đúng thứ một API đọc trạng thái không được làm.
	healthMu         sync.Mutex
	lastReconcileErr error
	reconcileStreak  int

	// `logf` mặc định là `log.Printf`; test tiêm bản đếm để chứng minh luật
	// chống spam. Không phiên bản sản xuất nào đổi nó.
	logf func(format string, args ...any)

	// `reconcileOnce` là điểm nối để test tiêm một lỗi lặp lại rồi cho lành lại.
	// `ReconcileOnce` thật đọc store SQLite, và cách duy nhất bắt nó lỗi trong
	// test là đóng store — thao tác KHÔNG đảo ngược được, nên không kiểm được
	// nhánh "thành công sau chuỗi lỗi". Mặc định trỏ thẳng vào `ReconcileOnce`.
	reconcileOnce func(context.Context) (int, error)
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
	service := &RuntimeIntentService{store: options.Store, runtime: options.Runtime,
		controllerID: options.ControllerID, now: options.Now, newID: options.NewID,
		logf: log.Printf}
	service.reconcileOnce = service.ReconcileOnce
	return service, nil
}

// SetProgramEnabled ghi intent rồi đẩy xuống Core và ghi lại read-back.
//
// Thứ tự có chủ ý: STORE TRƯỚC, Core sau. Intent là thứ bền vững phải sống qua
// mất điện và qua việc Core chưa sẵn sàng; đẩy xuống Core trước rồi mới ghi sẽ
// để lại một thiết bị đã đổi hành vi mà không ai biết ai ra lệnh nếu tiến trình
// chết ở giữa.
func (s *RuntimeIntentService) SetProgramEnabled(ctx context.Context, actor Actor,
	command SetProgramIntentCommand) (MutationResult, error) {
	s.intentMu.Lock()
	defer s.intentMu.Unlock()
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

// Start đánh dấu observation của boot cũ là UNKNOWN rồi replay intent bền vững
// xuống Core. Core tự boot mọi Program ở Disabled; chỉ vòng này mới có quyền
// khôi phục desiredEnabled=true sau khi cả topology và socket đã sẵn sàng.
func (s *RuntimeIntentService) Start(parent context.Context) error {
	if s == nil {
		return nil
	}
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	if s.cancel != nil {
		return nil
	}
	if err := s.store.MarkAllProgramRuntimeStatesUnknown(parent, s.now()); err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(parent)
	s.cancel = cancel
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		ticker := time.NewTicker(intentReconcileInterval)
		defer ticker.Stop()
		for {
			s.reconcileTick(ctx)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return nil
}

func (s *RuntimeIntentService) Close() {
	if s == nil {
		return
	}
	s.lifecycleMu.Lock()
	cancel := s.cancel
	s.cancel = nil
	s.lifecycleMu.Unlock()
	if cancel != nil {
		cancel()
		s.wg.Wait()
	}
}

// reconcileTick chạy đúng một vòng reconcile rồi ghi lại kết quả vào trạng thái
// sức khoẻ và quyết định có log hay không.
//
// Tách khỏi thân goroutine để test chứng minh được luật chống spam mà không phải
// chờ `time.Ticker` thật: một test dựa trên đồng hồ treo tường để đếm dòng log là
// một test sẽ đỏ ngẫu nhiên trên máy chậm.
//
// Context bị huỷ là đường tắt máy bình thường, KHÔNG phải sự cố: `Close()` huỷ
// context rồi mới `wg.Wait()`, nên vòng đang chạy dở gần như luôn trả về một lỗi
// context. Ghi nó vào trạng thái sức khoẻ sẽ để lại "lỗi gần nhất" là một lỗi
// tắt máy trên mọi lần shutdown sạch — cùng lý do `checks.go:520` kẹp điều kiện
// `ctx.Err() == nil` trước khi log.
func (s *RuntimeIntentService) reconcileTick(ctx context.Context) (int, error) {
	replayed, err := s.reconcileOnce(ctx)
	if ctx.Err() != nil {
		return replayed, err
	}
	if err == nil {
		if recovered := s.noteReconcileSuccess(); recovered > 0 {
			s.logf("INFO programming_runtime_intent_worker recovered_after=%d", recovered)
		}
		return replayed, nil
	}
	// Bậc lùi theo luỹ thừa 2 (tick lỗi thứ 1, 2, 4, 8, 16...). Vòng này chạy mỗi
	// 2 giây; log mỗi tick sẽ là 43200 dòng/ngày cho MỘT sự cố đứng yên, và khối
	// lượng đó chôn mất mọi thứ khác trong log. Chuỗi luỹ thừa 2 giữ số dòng tăng
	// theo log2 của thời gian hỏng: sự cố vẫn tự nói ra, và vẫn tiếp tục nói ra
	// đủ thưa để đọc được. `streak` in kèm để một dòng đơn lẻ không bị hiểu nhầm
	// là "vừa hỏng lần đầu" khi thật ra đã hỏng suốt vài giờ.
	if streak := s.noteReconcileFailure(err); isPowerOfTwo(streak) {
		s.logf("WARN programming_runtime_intent_worker err=%v streak=%d", err, streak)
	}
	return replayed, err
}

// noteReconcileFailure cập nhật chuỗi lỗi liên tiếp và trả về độ dài chuỗi sau
// khi cập nhật. Lỗi ĐỔI DẠNG thì chuỗi đếm lại từ 1 — một lỗi mới là tin mới và
// phải được nói ra ngay, chứ không bị nuốt vì lỗi cũ đang trong quãng im lặng.
func (s *RuntimeIntentService) noteReconcileFailure(err error) int {
	s.healthMu.Lock()
	defer s.healthMu.Unlock()
	if s.lastReconcileErr == nil || s.lastReconcileErr.Error() != err.Error() {
		s.reconcileStreak = 1
	} else {
		s.reconcileStreak++
	}
	s.lastReconcileErr = err
	return s.reconcileStreak
}

// noteReconcileSuccess xoá trạng thái lỗi và trả về độ dài chuỗi lỗi vừa kết
// thúc (0 nếu vòng trước đã lành).
func (s *RuntimeIntentService) noteReconcileSuccess() int {
	s.healthMu.Lock()
	defer s.healthMu.Unlock()
	streak := s.reconcileStreak
	s.reconcileStreak = 0
	s.lastReconcileErr = nil
	return streak
}

// LastReconcileError trả về lỗi gần nhất của vòng reconcile nền, hoặc `nil` khi
// vòng gần nhất thành công. An toàn khi gọi đồng thời với goroutine nền.
func (s *RuntimeIntentService) LastReconcileError() error {
	if s == nil {
		return nil
	}
	s.healthMu.Lock()
	defer s.healthMu.Unlock()
	return s.lastReconcileErr
}

// ConsecutiveReconcileFailures trả về số vòng reconcile lỗi liên tiếp tính đến
// hiện tại. An toàn khi gọi đồng thời với goroutine nền.
func (s *RuntimeIntentService) ConsecutiveReconcileFailures() int {
	if s == nil {
		return 0
	}
	s.healthMu.Lock()
	defer s.healthMu.Unlock()
	return s.reconcileStreak
}

func isPowerOfTwo(n int) bool {
	return n > 0 && n&(n-1) == 0
}

// ReconcileOnce chỉ replay hàng UNKNOWN. REJECTED được giữ FAULTED để không
// tự restart một Program lỗi vô hạn; lỗi transport giữ UNKNOWN và được thử lại
// ở tick sau. Hàm public để target harness có thể chứng minh restart mà không
// phải chờ sleep.
func (s *RuntimeIntentService) ReconcileOnce(ctx context.Context) (int, error) {
	s.intentMu.Lock()
	defer s.intentMu.Unlock()
	intents, err := s.store.ListAllProgramRuntimeIntents(ctx)
	if err != nil {
		return 0, err
	}
	replayed := 0
	for _, intent := range intents {
		if intent.RuntimeState != "UNKNOWN" {
			continue
		}
		command := SetProgramIntentCommand{SchemaVersion: "1.0", ProjectID: intent.ProjectID,
			ProgramID: intent.ProgramID, DesiredEnabled: intent.DesiredEnabled,
			CorrelationID: s.newID()}
		s.pushToCore(ctx, command, intent)
		replayed++
		if ctx.Err() != nil {
			return replayed, ctx.Err()
		}
	}
	return replayed, nil
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
