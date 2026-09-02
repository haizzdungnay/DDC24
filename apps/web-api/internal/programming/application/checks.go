package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	programmingartifact "mkddc-web/internal/programming/artifact"
	programmingcompiler "mkddc-web/internal/programming/compiler"
	"mkddc-web/internal/programming/domain"
	programmingstore "mkddc-web/internal/programming/store"
)

const (
	checkTargetProfile   = "MK-DDC-24-REV-A"
	checkStoreProfile    = "MKDDC24_REVA"
	checkCompilerVersion = "fwsom-st-1.2.0"
)

type RequestCheckCommand struct {
	RevisionID     string
	SchemaVersion  string
	TargetProfile  string
	IdempotencyKey string
	CorrelationID  string
}

type CheckAccepted struct {
	CheckID       string
	State         string
	StatusURL     string
	RequestHash   string
	AcceptedAt    string
	CorrelationID string
	Replay        bool
}

type DiagnosticView struct {
	Code       string         `json:"code"`
	DetailCode string         `json:"detailCode"`
	Severity   string         `json:"severity"`
	Message    string         `json:"message,omitempty"`
	MessageKey string         `json:"messageKey"`
	Location   map[string]any `json:"location"`
	Args       map[string]any `json:"args,omitempty"`
}

type ArtifactView struct {
	ArtifactID      string `json:"artifactId"`
	SHA256          string `json:"sha256"`
	ByteSize        int64  `json:"byteSize"`
	Profile         string `json:"profile"`
	TargetABI       int64  `json:"targetAbi"`
	CompilerVersion string `json:"compilerVersion"`
	LibraryVersion  string `json:"libraryVersion"`
	// ISS-STED-19: bộ ba tương thích phải đi CÙNG artifact, không chỉ nằm ở
	// endpoint capabilities. Một artifact tách khỏi ngữ cảnh sinh ra nó (lưu
	// lại, gửi đi, đọc lại sau) mà không mang phiên bản ngôn ngữ thì không ai
	// nói được nó biên dịch dưới hồ sơ nào.
	StLanguageProfileVersion string `json:"stLanguageProfileVersion"`
}

// SymbolView là một biến giao diện của POU, do COMPILER công bố.
//
// `ISS-STED-13` — FE dựng chỉ mục ký hiệu bằng regex và không có cách nào biết
// mình đọc lệch khỏi compiler. Bảng này cho nó một thứ để đối chiếu; lệch ⇒ FE
// hạ xuống "không xác định được" thay vì hiển thị thông tin sai.
type SymbolView struct {
	// PouId cần thiết vì một Check phủ NHIỀU POU: một danh sách phẳng không
	// nói được cổng nào thuộc POU nào.
	PouID     string `json:"pouId"`
	Name      string `json:"name"`
	Direction string `json:"direction"`
	Type      string `json:"type"`
	Slot      int    `json:"slot"`
}

type CheckView struct {
	CheckID     string           `json:"checkId"`
	RevisionID  string           `json:"revisionId"`
	State       string           `json:"state"`
	Diagnostics []DiagnosticView `json:"diagnostics"`
	// Symbols rỗng là một câu trả lời THẬT ("POU không khai cổng nào"), khác
	// với việc thiếu hẳn trường — nên nó luôn được phát, không `omitempty`.
	Symbols      []SymbolView  `json:"symbols"`
	Artifact     *ArtifactView `json:"artifact,omitempty"`
	CreatedAt    string        `json:"createdAt"`
	StartedAt    *string       `json:"startedAt,omitempty"`
	CompletedAt  *string       `json:"completedAt,omitempty"`
	AttemptCount int           `json:"attemptCount"`
}

type checkResultDocument struct {
	SchemaVersion string           `json:"schemaVersion"`
	Diagnostics   []DiagnosticView `json:"diagnostics"`
	// `ISS-STED-13` — lưu cùng kết quả Check để đọc lại được sau, không phải
	// chỉ tồn tại trong lần chạy worker. Một bảng đối chiếu chỉ có lúc vừa
	// compile xong thì FE mở lại trang là mất.
	Symbols  []SymbolView    `json:"symbols,omitempty"`
	Manifest json.RawMessage `json:"manifest,omitempty"`
}

type CheckServiceOptions struct {
	Store         *programmingstore.Store
	Runner        programmingcompiler.Runner
	Packager      programmingcompiler.Packager
	Artifacts     *programmingartifact.Store
	TargetID      string
	LeaseDuration time.Duration
	Now           func() time.Time
	NewID         func() string
	// ModbusSlots phân giải lại slot `ext` từ cấu hình ĐANG CHẠY
	// (`ISS-PIO-31`). Nil ⇒ Check CHẶN mọi binding MB_RTU: thiếu nguồn xác
	// minh thì con số lưu trong binding không có gì bảo chứng.
	ModbusSlots ModbusSlotProvider
}

type CheckService struct {
	store         *programmingstore.Store
	runner        programmingcompiler.Runner
	packager      programmingcompiler.Packager
	artifacts     *programmingartifact.Store
	targetID      string
	leaseDuration time.Duration
	now           func() time.Time
	newID         func() string
	workerID      string
	modbusSlots   ModbusSlotProvider
	wake          chan struct{}
	cancel        context.CancelFunc
	wg            sync.WaitGroup
	mu            sync.Mutex
}

func NewCheckService(options CheckServiceOptions) (*CheckService, error) {
	if options.Store == nil || options.Runner == nil || options.Artifacts == nil || !validText(options.TargetID, 1, 128) {
		return nil, fmt.Errorf("Programming Check dependencies/target là bắt buộc")
	}
	if options.LeaseDuration == 0 {
		options.LeaseDuration = 30 * time.Second
	}
	if options.LeaseDuration < time.Second || options.LeaseDuration > 10*time.Minute {
		return nil, fmt.Errorf("Check lease không hợp lệ")
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	if options.NewID == nil {
		options.NewID = uuid.NewString
	}
	return &CheckService{store: options.Store, runner: options.Runner, packager: options.Packager,
		artifacts: options.Artifacts, targetID: options.TargetID, leaseDuration: options.LeaseDuration, now: options.Now, newID: options.NewID,
		modbusSlots: options.ModbusSlots,
		workerID:    "check-worker-" + options.NewID(), wake: make(chan struct{}, 1)}, nil
}

func (s *CheckService) Start(parent context.Context) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		return
	}
	ctx, cancel := context.WithCancel(parent)
	s.cancel = cancel
	s.wg.Add(1)
	go func() { defer s.wg.Done(); s.run(ctx) }()
}

func (s *CheckService) Close() {
	if s == nil {
		return
	}
	s.mu.Lock()
	cancel := s.cancel
	s.cancel = nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
		s.wg.Wait()
	}
}

func (s *CheckService) RequestCheck(ctx context.Context, actor Actor, command RequestCheckCommand) (CheckAccepted, error) {
	if command.SchemaVersion != "1.0" || command.TargetProfile != checkTargetProfile || !isUUID(command.RevisionID) {
		return CheckAccepted{}, ErrInvalidRequest
	}
	keyHash, err := idempotencyHash(command.IdempotencyKey)
	if err != nil {
		return CheckAccepted{}, err
	}
	requestHash, err := semanticHash(map[string]any{"revisionId": command.RevisionID, "schemaVersion": command.SchemaVersion,
		"targetProfile": command.TargetProfile, "targetId": s.targetID})
	if err != nil {
		return CheckAccepted{}, err
	}
	revision, err := s.store.GetRevision(ctx, command.RevisionID)
	if err != nil {
		return CheckAccepted{}, err
	}
	var libraryDigest *[sha256.Size]byte
	if revision.Revision.LibraryRevisionID != "" {
		libraryRevision, err := s.store.GetLibraryRevision(ctx, revision.Revision.LibraryRevisionID)
		if err != nil {
			return CheckAccepted{}, err
		}
		value := libraryRevision.ManifestSHA256
		libraryDigest = &value
	}
	inputHash := checkInputHash(revision, s.targetID, libraryDigest)
	now := s.now().UTC()
	check, err := s.store.EnqueueCheck(ctx, programmingstore.EnqueueCheckParams{CheckID: s.newID(), RevisionID: command.RevisionID,
		TargetID: s.targetID, InputSHA256: inputHash, Profile: checkStoreProfile, CompilerVersion: checkCompilerVersion,
		ActorID: actor.ID, Role: actor.Role, AuditID: s.newID(), CorrelationID: command.CorrelationID, At: now,
		IdempotencyKeySHA256: keyHash, RequestSHA256: requestHash})
	if err != nil {
		return CheckAccepted{}, err
	}
	select {
	case s.wake <- struct{}{}:
	default:
	}
	return CheckAccepted{CheckID: check.CheckID, State: check.State, StatusURL: "/api/v1/programming/checks/" + check.CheckID,
		RequestHash: hex.EncodeToString(requestHash[:]), AcceptedAt: formatTime(check.CreatedAtUTCMS),
		CorrelationID: command.CorrelationID, Replay: check.Replay}, nil
}

func (s *CheckService) GetCheck(ctx context.Context, checkID string) (CheckView, error) {
	if !isUUID(checkID) {
		return CheckView{}, ErrInvalidRequest
	}
	check, err := s.store.GetCheck(ctx, checkID)
	if err != nil {
		return CheckView{}, err
	}
	return checkView(check)
}

func (s *CheckService) ProcessNext(ctx context.Context) (bool, error) {
	failedResult, _ := json.Marshal(checkResultDocument{SchemaVersion: "1.0", Diagnostics: []DiagnosticView{workerDiagnostic("ST-WORKER-CRASH")}})
	if _, err := s.store.FailExhaustedChecks(ctx, s.now(), s.newID, failedResult); err != nil {
		return false, err
	}
	check, claimed, err := s.store.ClaimCheck(ctx, s.workerID, s.now(), s.leaseDuration)
	if err != nil || !claimed {
		return claimed, err
	}
	revision, err := s.store.GetRevision(ctx, check.RevisionID)
	if err != nil {
		return true, err
	}
	/* `ISS-PIO-31`/`AC-PIO-ID-02` — chụp bố cục slot MỘT LẦN cho cả package.
	 * Tra từng binding sẽ cho hai binding của cùng một package được phân giải
	 * trên hai cấu hình khác nhau nếu ai đó sửa cấu hình giữa chừng. */
	var slots *ModbusSlotSnapshot
	if s.modbusSlots != nil {
		snapshot, slotErr := s.modbusSlots.ResolveModbusSlots(ctx)
		if slotErr != nil {
			return true, slotErr
		}
		slots = &snapshot
	}
	inputs, scopeDiagnostics := compilerInputs(revision, slots)
	if len(scopeDiagnostics) == 0 {
		inputs, err = s.attachPOULinkInputs(ctx, revision, inputs)
		if err != nil {
			return true, err
		}
	}
	// Bất biến cấp package được kiểm TRƯỚC khi biên dịch: một package có hai
	// Program cùng ghi một output là package sai bất kể từng Program compile
	// sạch hay không, và biên dịch 32 Program rồi mới báo là lãng phí đúng thứ
	// người dùng đang chờ. Gộp cùng scope diagnostics để một lần Check nói hết.
	objectViews := revisionObjectViews(revision)
	topology, budget := packageTopology(revision.Revision.DocumentSchemaVersion, objectViews)
	scopeDiagnostics = append(scopeDiagnostics, packageTopologyDiagnostics(topology)...)
	scopeDiagnostics = append(scopeDiagnostics, packageInvariantDiagnostics(objectViews)...)
	if len(scopeDiagnostics) > 0 {
		return true, s.complete(ctx, check, "FAILED", scopeDiagnostics, nil)
	}
	publishedSignals := compilerPublishedSignals(objectViews)
	for index := range inputs {
		inputs[index].PublishedSignals = append(
			[]programmingcompiler.PublishedSignalContract(nil), publishedSignals...)
	}
	// Biên dịch TỪNG Program và gộp kết quả. Một Program hỏng không dừng phần
	// còn lại: người dùng phải thấy hết lỗi của package trong MỘT lần Check.
	diagnostics := make([]DiagnosticView, 0)
	// ISS-STED-02: quyết định FAILED bám SEVERITY, không bám "có diagnostic hay
	// không". Trước đây `len(diagnostics) > 0` là tiêu chí, nên ngay khi
	// compiler bắt đầu phát WARNING thì mọi chương trình hợp lệ có một biến
	// thừa sẽ trượt Check — đúng cái mà `ST_SUBSET_SPEC` §12.6 cấm ("cảnh báo
	// không chặn sinh artifact").
	hasError := false
	// ISS-STED-18: băm nguồn TỪNG POU MỘT LẦN trước vòng biên dịch. Băm bên
	// trong vòng sẽ băm lại cùng một POU liên kết cho mỗi Program dùng nó.
	provenance := newDiagnosticProvenance(check.RevisionID, inputs)
	results := make([]programmingcompiler.Result, 0, len(inputs))
	symbols := make([]SymbolView, 0)
	for _, input := range inputs {
		result, err := s.runner.Compile(ctx, input)
		if errors.Is(err, programmingcompiler.ErrTimeout) {
			return true, s.complete(ctx, check, "TIMED_OUT", []DiagnosticView{workerDiagnostic("ST-WORKER-TIMEOUT")}, nil)
		}
		if err != nil {
			// Crash/output lỗi giữ RUNNING cho tới lease expiry để cùng input được
			// thử đúng một lần nữa. Lần hai vẫn chết sẽ được FailExhaustedChecks đóng.
			return true, err
		}
		/* `ISS-STED-13` — gắn `pouId` NGAY TẠI ĐÂY, cùng lối với diagnostic:
		 * compiler chạy trên một nguồn mỗi lần nên nó không biết mình đang ở
		 * POU nào; chỉ vòng lặp này biết. Gộp phẳng mà không gắn sẽ cho FE một
		 * danh sách cổng không nói được của ai. */
		for _, symbol := range result.Symbols {
			symbols = append(symbols, SymbolView{
				PouID: input.SourceID, Name: symbol.Name, Direction: symbol.Direction,
				Type: symbol.Type, Slot: symbol.Slot,
			})
		}
		programDiagnostics := make([]DiagnosticView, 0, len(result.Diagnostics))
		for _, item := range result.Diagnostics {
			view := compilerDiagnostic(item)
			// Với package nhiều Program, một mã lỗi không kèm Program nào là
			// một mã lỗi không dùng được: người đọc không biết mở file nào.
			if view.Location == nil {
				view.Location = map[string]any{}
			}
			// Ghi đè cả khi khoá đã có nhưng RỖNG: compiler một-nguồn không
			// biết mình đang ở Program nào, nên nó luôn trả chuỗi rỗng.
			if existing, _ := view.Location["programId"].(string); existing == "" {
				view.Location["programId"] = input.SourceID
			}
			provenance.stamp(&view)
			if view.Severity == "ERROR" {
				hasError = true
			}
			programDiagnostics = append(programDiagnostics, view)
		}
		if !result.OK {
			hasError = true
			if len(programDiagnostics) == 0 {
				programDiagnostics = append(programDiagnostics, workerDiagnostic("ST-CLI-IO"))
			}
			diagnostics = append(diagnostics, programDiagnostics...)
			continue
		}
		diagnostics = append(diagnostics, programDiagnostics...)
		results = append(results, result)
	}
	if hasError || len(results) < len(inputs) {
		return true, s.complete(ctx, check, "FAILED", diagnostics, nil)
	}
	// Published Signal chỉ hợp lệ khi compiler đã lower đúng MỘT lệnh publish
	// vào artifact của đúng producer. Không được dùng khai báo Draft/manifest
	// làm bằng chứng thay cho `results[].SignalRefs` thực tế.
	if signalDiagnostics := compiledSignalPublishDiagnostics(objectViews, inputs, results); len(signalDiagnostics) > 0 {
		return true, s.complete(ctx, check, "FAILED", signalDiagnostics, nil)
	}

	artifacts := make([]packageProgramArtifact, 0, len(results))
	programIDsByObject := make(map[string]string, len(topology))
	for _, item := range topology {
		programIDsByObject[item.ObjectID] = item.ProgramID
	}
	for index, result := range results {
		relative, err := s.artifacts.Put(result.ArtifactSHA256, result.Artifact)
		if err != nil {
			return true, err
		}
		if err := s.artifacts.Verify(relative, result.ArtifactSHA256, int64(len(result.Artifact))); err != nil {
			return true, err
		}
		programID, found := programIDsByObject[inputs[index].SourceID]
		if !found {
			return true, fmt.Errorf("topology thiếu Program object %s đã biên dịch", inputs[index].SourceID)
		}
		artifacts = append(artifacts, packageProgramArtifact{
			ProgramID: programID, SHA256: hex.EncodeToString(result.ArtifactSHA256[:]),
			ByteSize: int64(len(result.Artifact)), RelativePath: relative,
			SchemaVersion: result.ArtifactSchemaVersion, TargetABI: result.TargetABI,
			CompilerVersion: result.CompilerVersion, LibraryVersion: result.LibraryVersion,
			IntegrityMode: result.IntegrityMode,
		})
	}
	manifestLibraryLock := packageLibraryLockFrom(objectViews, revision.Revision.LibraryRevisionID)
	if revision.Revision.LibraryRevisionID != "" {
		libraryRevision, err := s.store.GetLibraryRevision(ctx, revision.Revision.LibraryRevisionID)
		if err != nil {
			return true, err
		}
		manifestLibraryLock.ProjectLibraryVersion = libraryRevision.Version
		manifestLibraryLock.ProjectManifestSHA256 = hex.EncodeToString(libraryRevision.ManifestSHA256[:])
	}
	manifestInput := packageManifestInput{
		Artifacts: artifacts, ProgramManifests: programManifestsOf(results),
		Topology: topology, Budget: budget,
		PouGraph: packagePouGraph(objectViews),
		Signals:  packageManifestSignals(objectViews), Bindings: packageManifestBindings(objectViews),
		LibraryLock:   manifestLibraryLock,
		IntegrityMode: results[0].IntegrityMode,
	}
	manifest, err := buildPackageCheckManifest(manifestInput)
	if err != nil {
		return true, err
	}

	// Hàng `artifacts` là thứ Commission STAGE sang Core. Một Program giữ đúng
	// artifact v1 của nó; nhiều Program phải được bọc thành container v2 bằng
	// CHÍNH writer production — trỏ hàng này vào artifact của Program đầu tiên
	// sẽ là nói dối rằng cả package đã sẵn sàng stage.
	storeArtifact, packageInfo, err := s.packageArtifact(ctx, check, revision.Revision.DocumentSchemaVersion,
		inputs, results, artifacts, topology,
		packageSignals(objectViews))
	if err != nil {
		return true, err
	}
	if packageInfo != nil {
		manifestInput.ContainerSHA256 = hex.EncodeToString(packageInfo.SHA256[:])
		manifestInput.ContainerBytes = packageInfo.ByteSize
		manifest, err = buildPackageCheckManifest(manifestInput)
		if err != nil {
			return true, err
		}
	}
	/* Chỉ đường PASSED mang bảng cổng: một Check FAILED nghĩa là compiler
	 * chưa dựng xong bảng ký hiệu, và công bố một bảng dở dang để FE đối chiếu
	 * sẽ tạo ra chính thứ lệch giả mà cổng này sinh ra để chống. */
	return true, s.completeWithSymbols(ctx, check, "PASSED", diagnostics, symbols,
		&completion{artifact: storeArtifact, manifest: manifest})
}

type completion struct {
	artifact *programmingstore.Artifact
	manifest json.RawMessage
}

func (s *CheckService) complete(ctx context.Context, check programmingstore.Check, state string, diagnostics []DiagnosticView, success *completion) error {
	return s.completeWithSymbols(ctx, check, state, diagnostics, nil, success)
}

func (s *CheckService) completeWithSymbols(ctx context.Context, check programmingstore.Check, state string,
	diagnostics []DiagnosticView, symbols []SymbolView, success *completion) error {
	result := checkResultDocument{SchemaVersion: "1.0", Diagnostics: diagnostics, Symbols: symbols}
	var artifact *programmingstore.Artifact
	if success != nil {
		result.Manifest = success.manifest
		artifact = success.artifact
	}
	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	_, err = s.store.CompleteCheck(ctx, programmingstore.CompleteCheckParams{CheckID: check.CheckID, LeaseOwner: s.workerID,
		State: state, ResultJSON: raw, Artifact: artifact, AuditID: s.newID(), At: s.now()})
	return err
}

func (s *CheckService) run(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		for {
			// T59-607 — lỗi của ProcessNext PHẢI được nói ra.
			//
			// Trước đây nó bị nuốt bằng `_`. Khi worker claim được một Check rồi
			// hỏng ở giữa (ví dụ compiler trả metadata không hợp lệ), Check nằm
			// `RUNNING` cho tới hết lease rồi bị `FailExhaustedChecks` đóng bằng
			// một mã chung — không dòng log nào nói vì sao. Chẩn đoán khi đó phải
			// dựng lại toàn bộ stack và dump goroutine, đúng thứ vừa xảy ra.
			processed, err := s.ProcessNext(ctx)
			if err != nil && ctx.Err() == nil {
				log.Printf("WARN programming_check_worker err=%v", err)
			}
			if !processed || ctx.Err() != nil {
				break
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-s.wake:
		case <-ticker.C:
		}
	}
}

func checkInputHash(revision programmingstore.RevisionSnapshot, targetID string,
	libraryManifestSHA256 *[sha256.Size]byte) [32]byte {
	digest := sha256.New()
	_, _ = digest.Write(revision.Revision.ManifestSHA256[:])
	for _, object := range revision.Objects {
		_, _ = digest.Write(object.PayloadSHA256[:])
	}
	for _, pou := range revision.POUObjects {
		_, _ = digest.Write(pou.ContentSHA256[:])
	}
	_, _ = digest.Write([]byte(revision.Revision.LibraryRevisionID))
	if libraryManifestSHA256 != nil {
		_, _ = digest.Write(libraryManifestSHA256[:])
	}
	_, _ = digest.Write([]byte{0})
	_, _ = digest.Write([]byte(targetID + "\x00" + checkStoreProfile + "\x00" + checkCompilerVersion))
	var output [32]byte
	copy(output[:], digest.Sum(nil))
	return output
}

// compilerInputs dựng input cho MỌI Program của Revision, sắp theo `objectId` để
// thứ tự biên dịch — và do đó thứ tự diagnostic — không phụ thuộc thứ tự đọc DB.
// Một Check chạy lại trên cùng Revision phải cho đúng cùng dãy kết quả, nếu
// không thì "deterministic build" chỉ là lời nói.
func compilerInputs(revision programmingstore.RevisionSnapshot, slots *ModbusSlotSnapshot) ([]programmingcompiler.Input, []DiagnosticView) {
	var programs []programmingstore.RevisionObject
	userPou := 0
	for _, object := range revision.Objects {
		switch object.Kind {
		case "PROGRAM":
			programs = append(programs, object)
		case "FUNCTION", "FUNCTION_BLOCK":
			userPou++
		}
	}
	if userPou > domain.MaxUserPou {
		return nil, []DiagnosticView{scopeDiagnostic("", domain.MaxUserPou)}
	}
	// Trần capacity sản phẩm lấy từ profile, không phải hằng viết trong code.
	// DDD §5.2 dành riêng `PRG-ERR-PROGRAM-LIMIT-001` cho vi phạm trần package —
	// không gộp vào `PRG-ERR-SCOPE-001`.
	if len(programs) == 0 || len(programs) > domain.MaxProgramsTotal {
		return nil, []DiagnosticView{programLimitDiagnostic(len(programs), domain.MaxProgramsTotal)}
	}
	sort.Slice(programs, func(left, right int) bool { return programs[left].ObjectID < programs[right].ObjectID })

	inputs := make([]programmingcompiler.Input, 0, len(programs))
	// GỘP diagnostic thay vì dừng ở Program đầu tiên hỏng. Dừng sớm bắt người
	// dùng sửa từng lỗi một rồi chạy lại Check — với 32 Program đó là 32 vòng.
	diagnostics := make([]DiagnosticView, 0)
	for _, program := range programs {
		input, diagnostic := programCompilerInput(revision, program, slots)
		if diagnostic != nil {
			diagnostics = append(diagnostics, *diagnostic)
			continue
		}
		inputs = append(inputs, input)
	}
	if len(diagnostics) > 0 {
		return nil, diagnostics
	}
	return inputs, nil
}

// attachPOULinkInputs nối ảnh canonical `pou_objects` và Control Library đã
// pin vào từng compiler job. Mỗi Program vẫn biên dịch riêng để diagnostic có
// đúng sourceId, nhưng mọi job nhìn cùng một tập helper đã seal và cùng một
// library lock; source/path không bao giờ lấy từ filesystem của người dùng.
func (s *CheckService) attachPOULinkInputs(ctx context.Context,
	revision programmingstore.RevisionSnapshot,
	inputs []programmingcompiler.Input) ([]programmingcompiler.Input, error) {
	if revision.Revision.DocumentSchemaVersion < 2 {
		return inputs, nil
	}
	if len(revision.POUObjects) == 0 {
		return nil, fmt.Errorf("Revision v2 thiếu ảnh canonical pou_objects")
	}
	pouByID := make(map[string]programmingstore.RevisionPOUObject, len(revision.POUObjects))
	for _, pou := range revision.POUObjects {
		pouByID[pou.ObjectID] = pou
	}

	libraryVersion := ""
	libraryEntries := []programmingstore.LibraryEntry{}
	if revision.Revision.LibraryRevisionID != "" {
		libraryRevision, err := s.store.GetLibraryRevision(ctx, revision.Revision.LibraryRevisionID)
		if err != nil {
			return nil, err
		}
		if libraryRevision.Scope != programmingstore.LibraryScopeProject ||
			(libraryRevision.State != programmingstore.LibraryStatePublished &&
				libraryRevision.State != programmingstore.LibraryStateDeprecated) ||
			libraryRevision.ProjectID != revision.Revision.ProjectID {
			return nil, fmt.Errorf("Revision pin Control Library không hợp lệ")
		}
		libraryVersion = libraryRevision.Version
		libraryEntries, err = s.store.ListLibraryEntries(ctx, libraryRevision.LibraryRevisionID)
		if err != nil {
			return nil, err
		}
	}
	entryByID := make(map[string]programmingstore.LibraryEntry, len(libraryEntries))
	lockEntries := make([]programmingcompiler.LibraryLockEntry, 0, len(libraryEntries))
	for _, entry := range libraryEntries {
		if entry.Kind != programmingstore.LibraryKindFunction &&
			entry.Kind != programmingstore.LibraryKindFunctionBlock {
			continue
		}
		entryByID[entry.EntryID] = entry
		lockEntries = append(lockEntries, programmingcompiler.LibraryLockEntry{
			EntryID: entry.EntryID, Name: entry.Name, Kind: entry.Kind, Version: libraryVersion,
			Origin: "PROJECT",
		})
	}
	sort.Slice(lockEntries, func(left, right int) bool {
		return strings.ToUpper(lockEntries[left].Name) < strings.ToUpper(lockEntries[right].Name)
	})
	lock := programmingcompiler.LibraryLock{}
	if revision.Revision.LibraryRevisionID != "" {
		lock = programmingcompiler.LibraryLock{
			SystemVersion: domain.SystemLibraryVersion, ProjectRevisionID: revision.Revision.LibraryRevisionID,
			Entries: lockEntries,
		}
	}

	requirementsOf := func(dependencies []programmingstore.LibraryDependency) ([]programmingcompiler.LibraryRequirement, error) {
		result := make([]programmingcompiler.LibraryRequirement, 0, len(dependencies))
		for _, dependency := range dependencies {
			entry, found := entryByID[dependency.EntryID]
			if !found || dependency.Version != libraryVersion {
				return nil, fmt.Errorf("dependency Control Library %s không khớp lock", dependency.EntryID)
			}
			result = append(result, programmingcompiler.LibraryRequirement{
				Name: entry.Name, Version: dependency.Version, Origin: "PROJECT",
			})
		}
		sort.Slice(result, func(left, right int) bool {
			return strings.ToUpper(result[left].Name) < strings.ToUpper(result[right].Name)
		})
		return result, nil
	}

	localSources := make([]programmingcompiler.LinkedPOUSource, 0, len(revision.POUObjects)+len(libraryEntries))
	for _, pou := range revision.POUObjects {
		if pou.Kind == "PROGRAM" {
			continue
		}
		requirements, err := requirementsOf(pou.Dependencies)
		if err != nil {
			return nil, err
		}
		localSources = append(localSources, programmingcompiler.LinkedPOUSource{
			Name: pou.Name, Kind: pou.Kind, Language: pou.Language, Source: append([]byte(nil), pou.SourceBlob...),
			Origin: "PROJECT", RequiresLibrary: requirements,
		})
	}
	for _, entry := range libraryEntries {
		if entry.Kind != programmingstore.LibraryKindFunction &&
			entry.Kind != programmingstore.LibraryKindFunctionBlock {
			continue
		}
		requirements, err := requirementsOf(entry.Dependencies)
		if err != nil {
			return nil, err
		}
		localSources = append(localSources, programmingcompiler.LinkedPOUSource{
			Name: entry.Name, Kind: entry.Kind, Language: entry.Language, Source: append([]byte(nil), entry.Source...),
			Origin: "PROJECT", FromLibrary: true, LibraryEntryID: entry.EntryID, Version: libraryVersion,
			RequiresLibrary: requirements,
		})
	}
	sort.Slice(localSources, func(left, right int) bool {
		return strings.ToUpper(localSources[left].Name) < strings.ToUpper(localSources[right].Name)
	})

	for index := range inputs {
		root, found := pouByID[inputs[index].SourceID]
		if !found || root.Kind != "PROGRAM" {
			return nil, fmt.Errorf("Program %s thiếu ảnh canonical POU", inputs[index].SourceID)
		}
		requirements, err := requirementsOf(root.Dependencies)
		if err != nil {
			return nil, err
		}
		// Source canonical thắng payload UI; hai bản lệch nhau là hỏng snapshot,
		// không được âm thầm compile bản tiện đọc hơn.
		if inputs[index].Language != root.Language || !bytes.Equal(inputs[index].Source, root.SourceBlob) {
			return nil, fmt.Errorf("Program %s lệch revision_objects/pou_objects", root.ObjectID)
		}
		inputs[index].LinkedPOUs = append([]programmingcompiler.LinkedPOUSource(nil), localSources...)
		inputs[index].RootRequiresLibrary = requirements
		inputs[index].LibraryLock = lock
	}
	return inputs, nil
}

func programCompilerInput(revision programmingstore.RevisionSnapshot,
	program programmingstore.RevisionObject, slots *ModbusSlotSnapshot) (programmingcompiler.Input, *DiagnosticView) {
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(program.PayloadJSON, &payload); err != nil {
		diagnostic := scopeDiagnostic(program.ObjectID, 0)
		return programmingcompiler.Input{}, &diagnostic
	}
	// Document v2 (T59-301) đặt identity ở `objectId` và mã nguồn ở `source`;
	// v1 dùng `programId`/`document`. Đọc cả hai tên là điều kiện để một Revision
	// đã seal TRƯỚC khi nâng model vẫn Check lại được — bỏ đường v1 là làm mất
	// khả năng kiểm lại lịch sử của chính mình.
	var programID, language string
	identity := payload["objectId"]
	if len(identity) == 0 {
		identity = payload["programId"]
	}
	document := payload["source"]
	if len(document) == 0 {
		document = payload["document"]
	}
	if json.Unmarshal(identity, &programID) != nil || json.Unmarshal(payload["language"], &language) != nil ||
		programID != program.ObjectID || (language != "ST" && language != "FBD") || len(document) == 0 {
		diagnostic := scopeDiagnostic(program.ObjectID, 0)
		return programmingcompiler.Input{}, &diagnostic
	}
	var source []byte
	var text string
	if json.Unmarshal(document, &text) == nil {
		source = []byte(text)
	} else if language == "FBD" {
		var value any
		if json.Unmarshal(document, &value) != nil {
			diagnostic := scopeDiagnostic(programID, 0)
			return programmingcompiler.Input{}, &diagnostic
		}
		source, _ = json.Marshal(value)
	} else {
		diagnostic := scopeDiagnostic(programID, 0)
		return programmingcompiler.Input{}, &diagnostic
	}
	if len(source) == 0 || len(source) > domain.MaxSourceBytes {
		diagnostic := scopeDiagnostic(programID, domain.MaxSourceBytes)
		return programmingcompiler.Input{}, &diagnostic
	}
	// `programID` ở trên là objectId của POU/source-map. Mapping và runtime dùng
	// stable `programConfig.programId`; v1 không có config nên hai giá trị trùng.
	runtimeProgramID := programID
	if raw := payload["programConfig"]; len(raw) > 0 {
		var config struct {
			ProgramID string `json:"programId"`
		}
		if json.Unmarshal(raw, &config) != nil || !isUUID(config.ProgramID) {
			diagnostic := scopeDiagnostic(programID, 0)
			return programmingcompiler.Input{}, &diagnostic
		}
		runtimeProgramID = config.ProgramID
	}
	ioMap, diagnostic := ioMapFromRevision(revision, runtimeProgramID, slots)
	if diagnostic != nil {
		return programmingcompiler.Input{}, diagnostic
	}
	return programmingcompiler.Input{SourceID: programID, ProgramID: runtimeProgramID,
		Language: language, Source: source, IoMap: ioMap}, nil
}

// ioMapFromRevision dựng Binding Manifest (F-PROG-ASBUILT-013/D-07,
// REV-PROG-ASBUILT-GAP-2026-08-14 §4) từ các RevisionObject kind VARIABLE/
// BINDING của revision đã seal — đây là dữ liệu Mapping tab đã ghi qua
// upsertVariable/upsertBinding (draft.go), KHÔNG phải nguồn mới. Trước bản vá
// này compilerInput() chưa từng đọc hai collection này nên io_bindings luôn
// rỗng trong artifact bất kể Mapping tab cấu hình đúng đến đâu (F-013).
//
// Chỉ biến class INPUT/OUTPUT mới tham gia io_map (khớp VAR_INPUT/VAR_OUTPUT
// ST) — biến class khác nhưng vẫn có binding là dữ liệu hỏng (không lẽ xảy ra
// qua Mapping tab UI hiện tại, nhưng payload Draft không có schema validation
// chặt cho field này ở draft.go nên vẫn phải tự kiểm ở đây, fail-closed thay
// vì gửi io_map sai lặng lẽ cho compiler). category/writable/pointId gửi
// nguyên trạng cho compiler tự reject (VP/MB_RTU, sai kiểu, trùng...) — không
// lặp logic validate ở BE, `resolve_io_bindings()` là authority duy nhất.
func ioMapFromRevision(revision programmingstore.RevisionSnapshot, programID string,
	slots *ModbusSlotSnapshot) ([]programmingcompiler.IoMapEntry, *DiagnosticView) {
	type variableInfo struct {
		name      string
		programID string
		class     string
		dataType  string
	}
	// Document v2 (T59-301) đặt biến vào `locals` của chính POU thay vì một
	// Revision object kind VARIABLE riêng. Đọc từ POU giữ ĐÚNG MỘT nguồn: nhân
	// bản biến ra object thứ hai chỉ để lớp này đọc được là cách hai bản trôi
	// khỏi nhau ngay lần sửa sau.
	variables := make(map[string]variableInfo)
	for _, object := range revision.Objects {
		if object.Kind != "PROGRAM" && object.Kind != "FUNCTION" && object.Kind != "FUNCTION_BLOCK" {
			continue
		}
		var payload struct {
			ObjectID      string `json:"objectId"`
			ProgramConfig struct {
				ProgramID string `json:"programId"`
			} `json:"programConfig"`
			Locals []struct {
				VariableID string `json:"variableId"`
				ProgramID  string `json:"programId"`
				Name       string `json:"name"`
				Type       string `json:"type"`
				Class      string `json:"class"`
			} `json:"locals"`
		}
		if err := json.Unmarshal(object.PayloadJSON, &payload); err != nil {
			diagnostic := scopeDiagnostic(programID, 0)
			return nil, &diagnostic
		}
		for _, local := range payload.Locals {
			if local.VariableID == "" || local.Name == "" || local.Type == "" {
				diagnostic := scopeDiagnostic(programID, 0)
				return nil, &diagnostic
			}
			owner := local.ProgramID
			if owner == "" {
				owner = payload.ProgramConfig.ProgramID
				if owner == "" {
					owner = object.ObjectID
				}
			}
			variables[local.VariableID] = variableInfo{name: local.Name, programID: owner,
				class: local.Class, dataType: local.Type}
		}
	}
	var entries []programmingcompiler.IoMapEntry
	for _, object := range revision.Objects {
		if object.Kind != "BINDING" {
			continue
		}
		var payload struct {
			BindingID  string `json:"bindingId"`
			VariableID string `json:"variableId"`
			Point      struct {
				Category string `json:"category"`
				PointID  string `json:"pointId"`
				DeviceID string `json:"deviceId"`
				// `ISS-PIO-31` — con số này là DẤU VẾT của lần bind trước, KHÔNG
				// phải danh tính và KHÔNG được chuyển tiếp thẳng.
				//
				// Trước bản vá, BE chuyển tiếp nó xuống compiler. Slot `ext`
				// được `iobus` cấp tuần tự trên tập thiết bị/điểm đang bật, nên
				// đổi tên điểm, thêm/tắt điểm hay tắt thiết bị đều làm nó dịch
				// chỗ — và binding cũ vẫn "hợp lệ" vì `st_io_map.cpp` chỉ kiểm
				// dải `[1, KX_N_EXT]`. Nay nó chỉ dùng để ĐỐI CHIẾU với slot
				// phân giải lại từ cấu hình đang chạy.
				ExtIndex int `json:"extIndex"`
			} `json:"point"`
			DataType string `json:"dataType"`
			Unit     string `json:"unit"`
			Writable bool   `json:"writable"`
		}
		if err := json.Unmarshal(object.PayloadJSON, &payload); err != nil || payload.BindingID != object.ObjectID ||
			payload.Point.PointID == "" || payload.Point.Category == "" || payload.DataType == "" {
			diagnostic := scopeDiagnostic(programID, 0)
			return nil, &diagnostic
		}
		variable, found := variables[payload.VariableID]
		if !found {
			diagnostic := scopeDiagnostic(programID, 0)
			return nil, &diagnostic
		}
		// Binding của Program KHÁC không phải lỗi — nó chỉ không thuộc io_map
		// đang dựng. Trước bản vá này điều kiện `variable.programID != programID`
		// nằm chung với `!found` và trả diagnostic, nên MỌI package từ hai Program
		// trở lên có binding đều FAILED ngay ở Program đầu tiên: hàm này chạy một
		// lần cho từng Program nhưng lại duyệt binding của cả package.
		if variable.programID != programID {
			continue
		}
		var direction string
		switch variable.class {
		case "INPUT":
			direction = "input"
		case "OUTPUT":
			direction = "output"
		default:
			diagnostic := scopeDiagnostic(programID, 0)
			return nil, &diagnostic
		}
		extIndex := payload.Point.ExtIndex
		if payload.Point.Category == "MB_RTU" {
			/* `AC-PIO-ID-02` — phân giải lại từ danh tính bền, và CHẶN khi
			 * không phân giải được hoặc lệch. Không tự remap: đổi slot trong im
			 * lặng là đổi ý nghĩa một binding người vận hành đã duyệt. */
			resolved, reason := resolveModbusExtIndex(slots, payload.Point.DeviceID, payload.Point.PointID,
				payload.Point.ExtIndex)
			if reason != "" {
				diagnostic := modbusSlotDiagnostic(programID, variable.name, payload.Point.PointID,
					payload.Point.ExtIndex, resolved, reason)
				return nil, &diagnostic
			}
			extIndex = resolved
		}
		entries = append(entries, programmingcompiler.IoMapEntry{
			Variable: variable.name, Direction: direction, PointID: payload.Point.PointID,
			Type: variable.dataType, Unit: payload.Unit, Category: payload.Point.Category,
			DeviceID: payload.Point.DeviceID, ExtIndex: extIndex,
			Writable: payload.Writable,
		})
	}
	return entries, nil
}

// normalizeSeverity chuẩn hoá severity từ compiler về tập enum hợp lệ: WARNING, INFO, ERROR.
// Mặc định an toàn là ERROR: bất kỳ severity lạ hoặc rỗng nào cũng được coi là lỗi nghiêm trọng,
// tuyệt đối không để severity lạ lọt qua dưới dạng cảnh báo rồi làm Check PASSED sai.
func normalizeSeverity(severity string) string {
	switch strings.ToUpper(strings.TrimSpace(severity)) {
	case "WARNING":
		return "WARNING"
	case "INFO":
		return "INFO"
	default:
		return "ERROR"
	}
}

// Đường dẫn tuyệt đối POSIX / Windows drive / Windows UNC. Ba mẫu này bắt đúng
// thứ có thể lộ hạ tầng: chuỗi có phân cách thư mục và neo tuyệt đối.
//
// KHÔNG có mẫu bắt token "tmp"/"temp"/"scratch" trần: message của compiler ST
// mang tên biến của người dùng, và `temp_setpoint`, `tmp_avg`, `scratch_val` là
// tên biến bình thường bậc nhất trong mã HVAC. Xoá theo tiền tố như vậy sẽ đục
// thủng chính thông điệp mà #352 yêu cầu giữ nguyên vẹn, mà không chặn thêm
// được đường dẫn nào — mọi đường dẫn thật đều đã có phân cách và bị ba mẫu
// dưới đây bắt.
var (
	reAbsPathPosix = regexp.MustCompile(`/(?:[a-zA-Z0-9._-]+/)+[a-zA-Z0-9._-]*`)
	reAbsPathWin   = regexp.MustCompile(`[a-zA-Z]:\\(?:[^\s\\/:*?"<>|\r\n]+\\)*[^\s\\/:*?"<>|\r\n]*`)
	reAbsPathUNC   = regexp.MustCompile(`\\\\(?:[^\s\\/:*?"<>|\r\n]+\\)+[^\s\\/:*?"<>|\r\n]*`)
)

// sanitizeCompilerMessage làm sạch message từ compiler trước khi chuyển tiếp tới UI.
//
// Mối đe doạ: compiler C++ chạy trên host/worker, message của nó có thể vô tình
// mang đường dẫn file cục bộ (lộ username, cấu trúc thư mục máy chủ, scratch
// root) hoặc ký tự điều khiển. Ba lớp xử lý: xoá đường dẫn tuyệt đối, loại ký
// tự điều khiển, cắt trần 512 byte.
//
// Cắt trên BIÊN RUNE chứ không cắt giữa byte: cắt giữa một chuỗi UTF-8 nhiều
// byte sinh ký tự thay thế trên UI. `for i := range msg` cho đúng chỉ số byte
// đầu mỗi rune, nên lấy biên lớn nhất còn lọt trần là một lượt duyệt O(n).
// Không bỏ dần rune cuối trong vòng lặp: mỗi vòng như vậy dựng lại cả chuỗi,
// nên một message dài bất thường (độ dài do đầu vào chi phối) biến thành O(n²).
func sanitizeCompilerMessage(msg string) string {
	if msg == "" {
		return ""
	}
	msg = reAbsPathWin.ReplaceAllString(msg, "")
	msg = reAbsPathUNC.ReplaceAllString(msg, "")
	msg = reAbsPathPosix.ReplaceAllString(msg, "")
	msg = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, msg)
	msg = strings.TrimSpace(msg)
	const maxLen = 512
	if len(msg) > maxLen {
		cut := 0
		for i := range msg {
			if i > maxLen {
				break
			}
			cut = i
		}
		msg = strings.TrimSpace(msg[:cut])
	}
	return msg
}

// ---- ISS-STED-18: Diagnostic Provenance Contract ----------------------------
//
// Một diagnostic phải TỰ CHỨNG MINH nó thuộc về nguồn nào. Không có provenance
// thì việc gạch lỗi trong trình soạn thảo tạo ra một lỗi nguy hiểm hơn lỗi đang
// có: gạch một chỗ trên buffer đã đổi, tức chỉ vào dòng KHÔNG CÒN là dòng sinh
// ra lỗi đó — và người dùng không có cách nào biết mình đang bị chỉ sai.
//
// Bốn trường, mỗi trường trả lời một câu hỏi khác nhau:
//
//	revisionId                — kết quả này thuộc revision nào?
//	pouId                     — thuộc POU nào?
//	sourceSha256              — thuộc ĐÚNG nội dung nào của POU đó?
//	stLanguageProfileVersion  — sinh dưới hồ sơ ngôn ngữ nào?
//
// `sourceSha256` băm TỪNG POU, không băm cả gói. Băm cả gói thì sửa POU A sẽ
// làm mọi lỗi của POU B thành STALE, và người dùng mất luôn kết quả còn đúng.
type diagnosticProvenance struct {
	revisionID string
	// sourceByPOU: pouId -> sha256 hex của chính nguồn POU đó.
	sourceByPOU map[string]string
}

func sha256Hex(payload []byte) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

// newDiagnosticProvenance băm nguồn của Program root và của MỌI POU đã liên kết.
func newDiagnosticProvenance(revisionID string, inputs []programmingcompiler.Input) diagnosticProvenance {
	sources := make(map[string]string, len(inputs))
	for _, input := range inputs {
		sources[input.SourceID] = sha256Hex(input.Source)
		for _, linked := range input.LinkedPOUs {
			// POU liên kết được nhận diện bằng TÊN: đó là định danh compiler đặt
			// vào `sourceId` của diagnostic khi lỗi nằm trong thân POU đó. Ghi đè
			// một tên đã có là vô hại — trong một Revision đã seal, cùng tên là
			// cùng nguồn.
			sources[linked.Name] = sha256Hex(linked.Source)
		}
	}
	return diagnosticProvenance{revisionID: revisionID, sourceByPOU: sources}
}

// stamp gắn provenance vào một diagnostic đã dựng.
//
// `pouId` lấy từ `programId` đã điền trước đó — đó là POU mà diagnostic thuộc
// về. Không tra được hash cho `pouId` thì BỎ TRỐNG `sourceSha256` chứ không
// điền hash của gói: một hash sai làm phép so khớp trả lời sai, tệ hơn hẳn một
// hash vắng mặt mà FE biết là "không kiểm được".
func (p diagnosticProvenance) stamp(view *DiagnosticView) {
	if view.Location == nil {
		view.Location = map[string]any{}
	}
	pouID, _ := view.Location["programId"].(string)
	view.Location["revisionId"] = p.revisionID
	view.Location["pouId"] = pouID
	if hash, found := p.sourceByPOU[pouID]; found {
		view.Location["sourceSha256"] = hash
	}
	view.Location["stLanguageProfileVersion"] = domain.STLanguageProfileVersion
}

func compilerDiagnostic(item programmingcompiler.Diagnostic) DiagnosticView {
	code := domain.MapComponentError("compiler", item.Code)
	public := domain.NewPublicError(code)
	location := map[string]any{"programId": item.SourceID, "line": item.Line, "column": item.Column, "length": item.Length}
	args := map[string]any(nil)
	if code == domain.ErrCheck {
		args = map[string]any{"line": item.Line, "column": item.Column, "length": item.Length}
	}
	return DiagnosticView{
		Code:       string(code),
		DetailCode: item.Code,
		Severity:   normalizeSeverity(item.Severity),
		Message:    sanitizeCompilerMessage(item.Message),
		MessageKey: public.MessageKey,
		Location:   location,
		Args:       domain.SanitizeErrorArgs(code, args),
	}
}

// scopeDiagnostic báo vi phạm capacity. `limit` phải là trần thật bị vượt, lấy
// từ profile machine-readable — literal `1` cũ nói sai capacity sản phẩm (32).
// `limit <= 0` nghĩa là từ chối không do trần (payload sai dạng): khi đó bỏ hẳn
// arg `limit` thay vì bịa một con số cho người đọc lỗi.
// programLimitDiagnostic báo vượt trần capacity cấp PACKAGE. `ST-LIM-009` là
// detail code riêng cho trần này, tách khỏi `ST-CLI-LIMIT` vốn là trần cấp một
// Program, để người đọc log phân biệt được hai loại "quá lớn" khác nhau.
func programLimitDiagnostic(actual, limit int) DiagnosticView {
	public := domain.NewPublicError(domain.ErrProgramLimit)
	return DiagnosticView{Code: string(domain.ErrProgramLimit), DetailCode: "ST-LIM-009", Severity: "ERROR",
		MessageKey: public.MessageKey, Location: map[string]any{},
		Args: map[string]any{"profile": checkTargetProfile, "limit": limit, "actual": actual}}
}

func scopeDiagnostic(programID string, limit int) DiagnosticView {
	public := domain.NewPublicError(domain.ErrScope)
	args := map[string]any{"profile": checkTargetProfile}
	if limit > 0 {
		args["limit"] = limit
	}
	return DiagnosticView{Code: string(domain.ErrScope), DetailCode: "ST-CLI-LIMIT", Severity: "ERROR", MessageKey: public.MessageKey,
		Location: map[string]any{"programId": programID}, Args: args}
}

// modbusSlotDiagnostic nói ĐỦ ba thứ người vận hành cần: binding nào, slot nào
// đã lưu, và slot đó bây giờ là của ai. `PRG-ERR-MAP-003` đã có sẵn ngữ nghĩa
// "danh tính ánh xạ sai" và bộ args `pointId/variable/expected/actual`.
func modbusSlotDiagnostic(programID, variable, pointID string, stored, resolved int, reason string) DiagnosticView {
	public := domain.NewPublicError(domain.ErrMapIdentity)
	detail := "PIO-SLOT-001"
	switch {
	case resolved == 0 && stored != 0:
		detail = "PIO-SLOT-002"
	case resolved == 0:
		detail = "PIO-SLOT-003"
	}
	return DiagnosticView{Code: string(domain.ErrMapIdentity), DetailCode: detail, Severity: "ERROR",
		MessageKey: public.MessageKey,
		Location:   map[string]any{"programId": programID},
		Args: map[string]any{"pointId": pointID, "variable": variable,
			"expected": stored, "actual": resolved}}
}

func workerDiagnostic(detail string) DiagnosticView {
	code := domain.MapComponentError("compiler", detail)
	public := domain.NewPublicError(code)
	return DiagnosticView{Code: string(code), DetailCode: detail, Severity: "ERROR", MessageKey: public.MessageKey, Location: map[string]any{}}
}

func checkView(check programmingstore.Check) (CheckView, error) {
	view := CheckView{CheckID: check.CheckID, RevisionID: check.RevisionID, State: check.State, Diagnostics: []DiagnosticView{},
		Symbols:   []SymbolView{},
		CreatedAt: formatTime(check.CreatedAtUTCMS), AttemptCount: check.AttemptCount}
	if check.StartedAtUTCMS != nil {
		value := formatTime(*check.StartedAtUTCMS)
		view.StartedAt = &value
	}
	if check.CompletedAtUTCMS != nil {
		value := formatTime(*check.CompletedAtUTCMS)
		view.CompletedAt = &value
	}
	if len(check.ResultJSON) > 0 {
		var result checkResultDocument
		if err := decodeStrict(check.ResultJSON, &result); err != nil || result.SchemaVersion != "1.0" {
			return CheckView{}, fmt.Errorf("decode Check result: %w", err)
		}
		view.Diagnostics = result.Diagnostics
		if result.Symbols != nil {
			view.Symbols = result.Symbols
		}
	}
	if check.Artifact != nil {
		a := check.Artifact
		view.Artifact = &ArtifactView{ArtifactID: a.ArtifactID, SHA256: hex.EncodeToString(a.SHA256[:]), ByteSize: a.ByteSize, Profile: a.Profile,
			TargetABI: a.TargetABI, CompilerVersion: a.CompilerVersion, LibraryVersion: a.LibraryVersion,
			StLanguageProfileVersion: domain.STLanguageProfileVersion}
	}
	return view, nil
}

// packageProgramArtifact là một dòng trong manifest Check cấp package: mỗi
// Program một artifact content-addressed. Đây là dữ liệu mà `T59-305` lắp thành
// container v2 — ghi ra ngay từ Check để bước đó không phải biên dịch lại.
type packageProgramArtifact struct {
	ProgramID       string `json:"programId"`
	SHA256          string `json:"sha256"`
	ByteSize        int64  `json:"byteSize"`
	RelativePath    string `json:"relativePath"`
	SchemaVersion   int    `json:"artifactSchemaVersion"`
	TargetABI       int64  `json:"targetAbi"`
	CompilerVersion string `json:"compilerVersion"`
	LibraryVersion  string `json:"libraryVersion"`
	IntegrityMode   string `json:"integrityMode"`
}

// packageArtifact quyết định thứ Commission sẽ stage. Artifact v1 chỉ được
// passthrough cho Revision schema v1 lịch sử. Revision schema v2 luôn phải bọc
// container v2, kể cả chỉ có một Program và không có Published Signal, vì chỉ
// container mới mang chu kỳ đã seal trong `programConfig` tới Core.
func (s *CheckService) packageArtifact(ctx context.Context, check programmingstore.Check,
	documentSchemaVersion int,
	inputs []programmingcompiler.Input, results []programmingcompiler.Result,
	artifacts []packageProgramArtifact, topology []packageProgramTopology,
	signals []programmingcompiler.PackageSignal) (*programmingstore.Artifact, *programmingcompiler.PackageResult, error) {
	for _, item := range topology {
		if item.PeriodMs <= 0 {
			// Lưới an toàn ngay tại biên package. ProcessNext đã chặn bằng
			// diagnostic công khai ST-POU-005; guard này bảo đảm caller nội bộ
			// không thể bỏ qua Check rồi tạo artifact với chu kỳ ngầm định.
			return nil, nil, fmt.Errorf("ST-POU-005: Program %s chưa có chu kỳ chạy", item.ProgramID)
		}
	}
	// Chỉ giữ artifact v1 cho đúng Revision schema v1 lịch sử nơi
	// objectId==programId. Schema v2 phải đi qua writer v2 dù identity trùng,
	// nếu không periodMs chỉ còn trong manifest và biến mất khỏi artifact stage.
	legacySingleIdentity := len(topology) == 1 && topology[0].ObjectID == topology[0].ProgramID
	if documentSchemaVersion == 1 && len(results) == 1 && len(signals) == 0 && legacySingleIdentity &&
		len(results[0].LinkedPOUs) == 0 && inputs[0].LibraryLock.SystemVersion == "" {
		result := results[0]
		return &programmingstore.Artifact{ArtifactID: s.newID(), RevisionID: check.RevisionID, CheckID: check.CheckID,
			SchemaVersion: result.ArtifactSchemaVersion, Profile: checkStoreProfile, TargetABI: result.TargetABI,
			CompilerVersion: result.CompilerVersion, LibraryVersion: result.LibraryVersion,
			ByteSize: int64(len(result.Artifact)), SHA256: result.ArtifactSHA256,
			RelativePath: artifacts[0].RelativePath, IntegrityMode: result.IntegrityMode}, nil, nil
	}
	if s.packager == nil {
		// Không có packager mà vẫn báo PASSED sẽ là một Check nói "sẵn sàng"
		// trong khi không có gì nạp được. Fail-closed và nêu đúng thứ còn thiếu.
		return nil, nil, fmt.Errorf("package %d Program cần packager container v2", len(results))
	}
	// Chu kỳ VÀ ngân sách lấy từ CHÍNH topology mà manifest công bố, không tính
	// lại từ payload lần hai: hai phép đọc cùng một dữ liệu là hai chỗ để lệch
	// nhau, và lệch ở đây nghĩa là manifest nói một đằng còn thiết bị chạy một
	// nẻo.
	//
	// Khoá tra là `ObjectID`, KHÔNG phải `ProgramID`: `inputs[].SourceID` là
	// `objectId` của Revision object, nên tra bằng `programId` sẽ trượt ở mọi
	// Revision có hai giá trị đó khác nhau — và trượt ở đây im lặng cho ra chu
	// kỳ 0 và ngân sách 0 trong container (F-P59-MANIFEST-001).
	type programPlan struct {
		programID          string
		periodMs, budgetUs int64
	}
	plans := make(map[string]programPlan, len(topology))
	for _, item := range topology {
		plans[item.ObjectID] = programPlan{programID: item.ProgramID,
			periodMs: item.PeriodMs, budgetUs: item.BudgetUs}
	}
	programs := make([]programmingcompiler.PackageProgram, 0, len(results))
	for index, result := range results {
		plan, found := plans[inputs[index].SourceID]
		if !found {
			// Một Program được biên dịch mà topology không mô tả nghĩa là hai lớp
			// đang nhìn hai tập Program khác nhau. Đóng gói tiếp sẽ ghi chu kỳ 0
			// vào container và lỗi chỉ lộ ra ở runtime.
			return nil, nil, fmt.Errorf("topology thiếu Program %s đã biên dịch", inputs[index].SourceID)
		}
		programs = append(programs, programmingcompiler.PackageProgram{
			// Runtime instance dùng `programId` ổn định, không dùng `objectId`
			// của POU/source-map. Hai identity có thể khác nhau theo DDD §4.2/§4.3.
			Name:     programPackageName(plan.programID),
			Artifact: result.Artifact,
			PeriodMs: plan.periodMs,
			BudgetUs: plan.budgetUs})
	}
	linkedPOUs, err := mergeLinkedPOUs(results)
	if err != nil {
		return nil, nil, err
	}
	libraryLock := programmingcompiler.LibraryLock{}
	if len(inputs) > 0 {
		libraryLock = inputs[0].LibraryLock
		for _, input := range inputs[1:] {
			left, _ := json.Marshal(libraryLock)
			right, _ := json.Marshal(input.LibraryLock)
			if !bytes.Equal(left, right) {
				return nil, nil, fmt.Errorf("compiler inputs dùng library lock khác nhau")
			}
		}
	}
	packaged, err := s.packager.Package(ctx, programs, signals, linkedPOUs, libraryLock)
	if err != nil {
		return nil, nil, err
	}
	relative, err := s.artifacts.Put(packaged.SHA256, packaged.Package)
	if err != nil {
		return nil, nil, err
	}
	if err := s.artifacts.Verify(relative, packaged.SHA256, packaged.ByteSize); err != nil {
		return nil, nil, err
	}
	return &programmingstore.Artifact{ArtifactID: s.newID(), RevisionID: check.RevisionID, CheckID: check.CheckID,
		SchemaVersion: packaged.SchemaVersion, Profile: checkStoreProfile, TargetABI: packaged.TargetABI,
		CompilerVersion: results[0].CompilerVersion, LibraryVersion: results[0].LibraryVersion,
		ByteSize: packaged.ByteSize, SHA256: packaged.SHA256, RelativePath: relative,
		IntegrityMode: results[0].IntegrityMode}, &packaged, nil
}

func mergeLinkedPOUs(results []programmingcompiler.Result) ([]programmingcompiler.LinkedPOU, error) {
	byName := make(map[string]programmingcompiler.LinkedPOU)
	encoded := make(map[string][]byte)
	for _, result := range results {
		for _, item := range result.LinkedPOUs {
			key := strings.ToUpper(item.Name)
			raw, err := json.Marshal(item)
			if err != nil {
				return nil, err
			}
			if previous, found := encoded[key]; found && !bytes.Equal(previous, raw) {
				return nil, fmt.Errorf("POU %s có metadata compiler không nhất quán giữa các Program", item.Name)
			}
			byName[key], encoded[key] = item, raw
		}
	}
	keys := make([]string, 0, len(byName))
	for key := range byName {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	merged := make([]programmingcompiler.LinkedPOU, 0, len(keys))
	for _, key := range keys {
		merged = append(merged, byName[key])
	}
	return merged, nil
}

// programPackageName giữ NGUYÊN Program ID. Tên trong PROGRAM_TABLE là
// runtime instance identity, không phải tên POU trong mã ST. Đổi UUID thành
// `P_...` làm API intent gửi ID đã seal nhưng Core chỉ biết một ID
// khác, nên Enable/Disable bị từ chối cho mọi package v2.
func programPackageName(sourceID string) string {
	return sourceID
}

// programManifestsOf gom manifest build của TỪNG Program theo đúng thứ tự biên
// dịch (`compilerInputs` đã sắp theo `objectId`), để manifest package tất định.
func programManifestsOf(results []programmingcompiler.Result) []json.RawMessage {
	manifests := make([]json.RawMessage, 0, len(results))
	for _, result := range results {
		if len(result.Manifest) > 0 {
			manifests = append(manifests, result.Manifest)
		}
	}
	return manifests
}

// revisionObjectViews tách lớp kiểm bất biến khỏi kiểu store: hàm kiểm chỉ cần
// (id, kind, payload) nên nó test được mà không phải dựng cả một Revision.
func revisionObjectViews(revision programmingstore.RevisionSnapshot) []revisionObjectView {
	views := make([]revisionObjectView, 0, len(revision.Objects))
	for _, object := range revision.Objects {
		views = append(views, revisionObjectView{ObjectID: object.ObjectID, Kind: object.Kind, Payload: object.PayloadJSON})
	}
	return views
}
