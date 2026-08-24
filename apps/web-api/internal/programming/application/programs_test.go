package application

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	programmingstore "mkddc-web/internal/programming/store"
)

const (
	programsProjectID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
	programsDraftID   = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"
)

// programsFixedNow là đồng hồ tất định dùng CHUNG cho store và service. Mock
// `service.now` mà quên `Options.Now` sẽ để TTL idempotency chạy theo đồng hồ
// thật và hỏng muộn ở một phiên khác — bẫy đã dính một lần rồi.
var programsFixedNow = time.Date(2026, 8, 23, 10, 0, 0, 0, time.UTC)

// programsSnapshotObservedAt là mốc Core chụp snapshot; `capturedMonotonicNs`
// đi kèm phải cùng họ đồng hồ với `lastRunMonoNs` của từng Program.
const (
	programsSnapshotObservedAt = "2026-08-23T10:00:02.500Z"
	programsCapturedMonoNs     = uint64(9_000_000_000)
)

type programsIntentSeed struct {
	programID      string
	desiredEnabled bool
	lastKnownState string
}

func openProgramsTestStore(t *testing.T) *programmingstore.Store {
	t.Helper()
	store, err := programmingstore.OpenProgrammingStore(context.Background(), programmingstore.Options{
		Path: filepath.Join(t.TempDir(), "programming.sqlite"),
		Now:  func() time.Time { return programsFixedNow },
	})
	if err != nil {
		t.Fatalf("OpenProgrammingStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func seedProgramsProject(t *testing.T, store *programmingstore.Store, seeds ...programsIntentSeed) {
	t.Helper()
	ctx := context.Background()
	key := sha256.Sum256([]byte("programs-project-key"))
	request := sha256.Sum256([]byte("programs-project-request"))
	if _, _, err := store.CreateProject(ctx, programmingstore.CreateProjectParams{
		ProjectID: programsProjectID, DraftID: programsDraftID, Name: "AHU-01",
		ContentJSON: []byte(`{"schemaVersion":1}`), ActorID: "admin", Role: "admin",
		AuditID: "cccccccc-3333-4333-8333-cccccccccccc", CorrelationID: "programs-test-00001",
		At: programsFixedNow, IdempotencyKeySHA256: key, RequestSHA256: request,
	}); err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	for index, seed := range seeds {
		intentKey := sha256.Sum256([]byte("programs-intent-key-" + seed.programID))
		intentRequest := sha256.Sum256([]byte("programs-intent-request-" + seed.programID))
		if _, err := store.SetProgramEnableIntent(ctx, programmingstore.ProgramIntentIdentity{
			ProjectID: programsProjectID, ActorID: "admin", Role: "admin",
			AuditID:       fmt.Sprintf("dddddddd-4444-4444-8444-%012d", index+1),
			CorrelationID: "programs-test-00002", At: programsFixedNow,
			IdempotencyKeySHA256: intentKey, RequestSHA256: intentRequest,
		}, seed.programID, seed.desiredEnabled); err != nil {
			t.Fatalf("SetProgramEnableIntent(%s): %v", seed.programID, err)
		}
		if seed.lastKnownState != "" {
			if err := store.RecordProgramRuntimeState(ctx, programsProjectID, seed.programID,
				seed.lastKnownState, programsFixedNow); err != nil {
				t.Fatalf("RecordProgramRuntimeState(%s): %v", seed.programID, err)
			}
		}
	}
}

func newProgramsService(t *testing.T, store *programmingstore.Store, monitor MonitorSnapshotProvider) *RuntimeService {
	t.Helper()
	service, err := NewRuntimeService(RuntimeServiceOptions{
		Runtime: &fakeRuntimeStatusReader{producerMode: "PROGRAM_ONLY"}, Store: store,
		Monitor: monitor, ControllerID: "controller-local",
		Now: func() time.Time { return programsFixedNow },
	})
	if err != nil {
		t.Fatalf("NewRuntimeService: %v", err)
	}
	return service
}

// liveProgramsSnapshot dựng một bảng Program SỐNG. `Programs` là slice non-nil
// kể cả khi rỗng — đúng như Core phát ra.
func liveProgramsSnapshot(programs ...ProgramMetricsView) MonitorTruthSnapshot {
	if programs == nil {
		programs = []ProgramMetricsView{}
	}
	return MonitorTruthSnapshot{
		ObservedAt: programsSnapshotObservedAt, CapturedMonotonicNs: programsCapturedMonoNs,
		Programs: programs, Points: []MonitorPointTruth{},
	}
}

func itemByID(t *testing.T, page ProgramsPageView, programID string) ProgramListItemView {
	t.Helper()
	for _, item := range page.Items {
		if item.ProgramID == programID {
			return item
		}
	}
	t.Fatalf("không tìm thấy Program %q trong %d dòng", programID, len(page.Items))
	return ProgramListItemView{}
}

func healthOf(item ProgramListItemView) string {
	if item.Health == nil {
		return "<null>"
	}
	return *item.Health
}

// TestListProgramsHealthBoundaries — T60-014. Năm biên bắt buộc nằm trong CÙNG
// một lần gọi để chứng minh chúng không đè lên nhau: 0 lỡ nhịp; có lỡ nhịp;
// overrun liên tiếp (đỉnh thời lượng vượt 80% chu kỳ); Program `DISABLED` (phải
// là `null`, KHÔNG phải `FAULT`); và `ROLLED_BACK` (`WAITING` + `DEGRADED`).
// Biên "Core im" ở test riêng bên dưới vì nó là một lần gọi khác.
func TestListProgramsHealthBoundaries(t *testing.T) {
	store := openProgramsTestStore(t)
	seedProgramsProject(t, store,
		programsIntentSeed{programID: "prog-healthy", desiredEnabled: true},
		programsIntentSeed{programID: "prog-missed", desiredEnabled: true},
		programsIntentSeed{programID: "prog-overrun", desiredEnabled: true},
		programsIntentSeed{programID: "prog-disabled", desiredEnabled: false},
		programsIntentSeed{programID: "prog-rollback", desiredEnabled: true},
		programsIntentSeed{programID: "prog-faulted", desiredEnabled: true},
		programsIntentSeed{programID: "prog-rejected", desiredEnabled: true},
	)
	service := newProgramsService(t, store, fakeMonitorProvider{snapshot: liveProgramsSnapshot(
		ProgramMetricsView{InstanceID: "prog-healthy", State: "RUNNING", Enabled: true, PeriodMS: 1000,
			LastExecNS: 12_000_000, MaxExecNS: 40_000_000, MissedReleaseCount: 3,
			ConsecutiveMissedRelease: 0, LastRunMonoNS: 8_500_000_000, Lane: 0},
		ProgramMetricsView{InstanceID: "prog-missed", State: "RUNNING", Enabled: true, PeriodMS: 1000,
			LastExecNS: 15_000_000, MaxExecNS: 40_000_000, MissedReleaseCount: 9,
			ConsecutiveMissedRelease: 2, LastRunMonoNS: 8_000_000_000, Lane: 1},
		// Đúng ngưỡng 0,8 × 1000 ms = 800 ms thì CHƯA degraded (điều kiện là
		// "lớn hơn"); +1 ns mới vượt. Hai dòng này canh đúng cạnh đó.
		ProgramMetricsView{InstanceID: "prog-overrun", State: "RUNNING", Enabled: true, PeriodMS: 1000,
			LastExecNS: 790_000_000, MaxExecNS: 800_000_001, LastRunMonoNS: 8_900_000_000, Lane: 1},
		ProgramMetricsView{InstanceID: "prog-disabled", State: "DISABLED", Enabled: false, PeriodMS: 5000,
			LastExecNS: 0, MaxExecNS: 0, LastRunMonoNS: 0, Lane: 0},
		ProgramMetricsView{InstanceID: "prog-rollback", State: "ROLLED_BACK", Enabled: true, PeriodMS: 1000,
			LastExecNS: 5_000_000, MaxExecNS: 6_000_000, LastRunMonoNS: 7_000_000_000, Lane: 0},
		ProgramMetricsView{InstanceID: "prog-faulted", State: "FAULTED", Enabled: true, PeriodMS: 1000,
			LastExecNS: 3_000_000, MaxExecNS: 900_000_000, LastRunMonoNS: 6_000_000_000, Lane: 0},
		ProgramMetricsView{InstanceID: "prog-rejected", State: "REJECTED", Enabled: false, PeriodMS: 1000,
			LastRunMonoNS: 0, Lane: 0},
	)})

	page, err := service.ListPrograms(context.Background(), programsProjectID)
	if err != nil {
		t.Fatalf("ListPrograms: %v", err)
	}
	if page.RuntimeStateSource != ProgramSourceCoreLive || page.ObservedAt == nil ||
		*page.ObservedAt != programsSnapshotObservedAt {
		t.Fatalf("trang phải là CORE_LIVE kèm mốc quan sát: %+v", page)
	}
	if page.ProgramsTruncated == nil || *page.ProgramsTruncated {
		t.Fatalf("programsTruncated phải là false tường minh khi có bảng: %+v", page.ProgramsTruncated)
	}

	expected := []struct {
		programID    string
		runtimeState string
		health       string
	}{
		{"prog-healthy", "RUNNING", "HEALTHY"},
		{"prog-missed", "RUNNING", "DEGRADED"},
		{"prog-overrun", "RUNNING", "DEGRADED"},
		{"prog-disabled", "DISABLED", "<null>"},
		{"prog-rollback", "WAITING", "DEGRADED"},
		{"prog-faulted", "FAULTED", "FAULT"},
		{"prog-rejected", "FAULTED", "FAULT"},
	}
	for _, want := range expected {
		item := itemByID(t, page, want.programID)
		if item.RuntimeState != want.runtimeState || healthOf(item) != want.health {
			t.Errorf("%s: runtimeState=%s health=%s; want %s/%s",
				want.programID, item.RuntimeState, healthOf(item), want.runtimeState, want.health)
		}
		if item.RuntimeStateSource != ProgramSourceCoreLive {
			t.Errorf("%s: source=%s; want CORE_LIVE", want.programID, item.RuntimeStateSource)
		}
	}

	// `missedReleaseCount` tích luỹ = 3 nhưng `consecutiveMissedRelease` = 0 ⇒
	// vẫn HEALTHY. Đây là chống hồi quy trực tiếp cho §4.2: dùng nhầm bộ đếm
	// tích luỹ sẽ ghim Program này ở DEGRADED vĩnh viễn.
	healthy := itemByID(t, page, "prog-healthy")
	if healthy.MissedReleaseCount == nil || *healthy.MissedReleaseCount != 3 {
		t.Fatalf("missedReleaseCount tích luỹ phải lộ ra nguyên vẹn: %+v", healthy.MissedReleaseCount)
	}

	// Mốc `Last Exec` phải dựng từ `lastRunMonoNs`, KHÔNG phải `lastExecNs`
	// (thời lượng). 9,0 s − 8,5 s = 500 ms tuổi.
	if healthy.LastRunAgeMS == nil || *healthy.LastRunAgeMS != 500 {
		t.Fatalf("lastRunAgeMs sai: %+v", healthy.LastRunAgeMS)
	}
	if healthy.LastRunAtUTC == nil || *healthy.LastRunAtUTC != "2026-08-23T10:00:02Z" {
		t.Fatalf("lastRunAtUtc sai: %+v", healthy.LastRunAtUTC)
	}
	if healthy.LastExecNS == nil || *healthy.LastExecNS != 12_000_000 {
		t.Fatalf("lastExecNs (thời lượng) sai: %+v", healthy.LastExecNS)
	}

	// Chưa chạy lần nào ⇒ mốc là `null`, KHÔNG phải mốc 0 hay chính lúc chụp.
	disabled := itemByID(t, page, "prog-disabled")
	if disabled.LastRunAtUTC != nil || disabled.LastRunAgeMS != nil {
		t.Fatalf("lastRunMonoNs=0 phải ra null, không được bịa mốc: %+v", disabled)
	}
	if disabled.PeriodMS == nil || *disabled.PeriodMS != 5000 {
		t.Fatalf("periodMs của Program DISABLED vẫn phải đúng: %+v", disabled.PeriodMS)
	}
}

// TestListProgramsOverrunThresholdIsStrictlyGreater canh đúng cạnh 0,8 × chu kỳ
// và trường hợp `periodMs = 0` (không phân giải được chu kỳ ⇒ không có ngưỡng để
// so, không được dán DEGRADED).
func TestListProgramsOverrunThresholdIsStrictlyGreater(t *testing.T) {
	store := openProgramsTestStore(t)
	seedProgramsProject(t, store,
		programsIntentSeed{programID: "prog-at-threshold", desiredEnabled: true},
		programsIntentSeed{programID: "prog-no-period", desiredEnabled: true},
	)
	service := newProgramsService(t, store, fakeMonitorProvider{snapshot: liveProgramsSnapshot(
		ProgramMetricsView{InstanceID: "prog-at-threshold", State: "RUNNING", Enabled: true,
			PeriodMS: 1000, MaxExecNS: 800_000_000, LastRunMonoNS: 8_999_000_000},
		ProgramMetricsView{InstanceID: "prog-no-period", State: "RUNNING", Enabled: true,
			PeriodMS: 0, MaxExecNS: 999_000_000, LastRunMonoNS: 8_999_000_000},
	)})
	page, err := service.ListPrograms(context.Background(), programsProjectID)
	if err != nil {
		t.Fatalf("ListPrograms: %v", err)
	}
	if got := healthOf(itemByID(t, page, "prog-at-threshold")); got != "HEALTHY" {
		t.Errorf("đúng 80%% chu kỳ chưa phải overrun: health=%s", got)
	}
	noPeriod := itemByID(t, page, "prog-no-period")
	if got := healthOf(noPeriod); got != "HEALTHY" {
		t.Errorf("periodMs=0 không có ngưỡng để so: health=%s", got)
	}
	if noPeriod.PeriodMS != nil {
		t.Errorf("periodMs=0 phải ra null chứ không phải 0: %+v", noPeriod.PeriodMS)
	}
}

// TestListProgramsCoreSilentIsUnknownAndUnavailable — Core im. Mọi dòng phải là
// `UNKNOWN` + `UNAVAILABLE` với số đo `null`, KỂ CẢ khi store còn nhớ một trạng
// thái `RUNNING` từ lần trước. Ý định bền vững vẫn phải trả về nguyên vẹn.
func TestListProgramsCoreSilentIsUnknownAndUnavailable(t *testing.T) {
	store := openProgramsTestStore(t)
	seedProgramsProject(t, store,
		programsIntentSeed{programID: "prog-a", desiredEnabled: true, lastKnownState: "RUNNING"},
		programsIntentSeed{programID: "prog-b", desiredEnabled: false, lastKnownState: "DISABLED"},
	)
	service := newProgramsService(t, store,
		fakeMonitorProvider{err: errors.New("core unavailable trong test")})

	page, err := service.ListPrograms(context.Background(), programsProjectID)
	if err != nil {
		t.Fatalf("ListPrograms không được lỗi khi Core im: %v", err)
	}
	if page.RuntimeStateSource != ProgramSourceUnavailable || page.ObservedAt != nil {
		t.Fatalf("trang phải UNAVAILABLE và không có mốc quan sát: %+v", page)
	}
	if page.ProgramsTruncated != nil {
		t.Fatalf("programsTruncated phải null khi không có bảng nào: %+v", page.ProgramsTruncated)
	}
	if len(page.Items) != 2 {
		t.Fatalf("phải giữ đủ 2 dòng ý định: %+v", page.Items)
	}
	for _, item := range page.Items {
		if item.RuntimeState != "UNKNOWN" || item.RuntimeStateSource != ProgramSourceUnavailable {
			t.Errorf("%s: %s/%s; want UNKNOWN/UNAVAILABLE",
				item.ProgramID, item.RuntimeState, item.RuntimeStateSource)
		}
		if healthOf(item) != "UNKNOWN" {
			t.Errorf("%s: health=%s; want UNKNOWN", item.ProgramID, healthOf(item))
		}
		if item.CoreState != nil || item.Enabled != nil || item.ObservedAt != nil ||
			item.PeriodMS != nil || item.LastExecNS != nil || item.MaxExecNS != nil ||
			item.MissedReleaseCount != nil || item.ConsecutiveMissedRelease != nil ||
			item.LastRunAtUTC != nil || item.LastRunAgeMS != nil || item.Lane != nil {
			t.Errorf("%s: Core im mà vẫn có số đo — giá trị cũ đang được trả như thể đang sống: %+v",
				item.ProgramID, item)
		}
		if item.DesiredEnabled == nil || item.Generation == nil || item.UpdatedBy == nil {
			t.Errorf("%s: ý định bền vững phải sống sót qua việc Core im: %+v", item.ProgramID, item)
		}
	}
	if item := itemByID(t, page, "prog-a"); !*item.DesiredEnabled {
		t.Errorf("prog-a: desiredEnabled phải giữ true")
	}
}

// TestListProgramsLegacyCoreWithoutProgramsKeyIsUnavailable — Core trả lời BÌNH
// THƯỜNG nhưng KHÔNG có khoá `programs` (Core đời cũ). Đây KHÔNG phải "hệ không
// có Program nào": phải ra `UNAVAILABLE`.
func TestListProgramsLegacyCoreWithoutProgramsKeyIsUnavailable(t *testing.T) {
	store := openProgramsTestStore(t)
	seedProgramsProject(t, store, programsIntentSeed{programID: "prog-a", desiredEnabled: true})
	service := newProgramsService(t, store, fakeMonitorProvider{snapshot: MonitorTruthSnapshot{
		ObservedAt: programsSnapshotObservedAt, CapturedMonotonicNs: programsCapturedMonoNs,
		Programs: nil, Points: []MonitorPointTruth{},
	}})
	page, err := service.ListPrograms(context.Background(), programsProjectID)
	if err != nil {
		t.Fatalf("ListPrograms: %v", err)
	}
	if page.RuntimeStateSource != ProgramSourceUnavailable {
		t.Fatalf("khoá `programs` vắng phải ra UNAVAILABLE, không phải CORE_LIVE rỗng: %+v", page)
	}
	if item := itemByID(t, page, "prog-a"); item.RuntimeState != "UNKNOWN" || healthOf(item) != "UNKNOWN" {
		t.Fatalf("dòng phải UNKNOWN/UNKNOWN: %+v", item)
	}
}

// TestListProgramsEmptyProgramsArrayIsCoreLive — mảng RỖNG là câu trả lời hợp lệ
// của một Core đang sống. Trang là `CORE_LIVE`; dòng intent nào Core không kể
// tên thì hạ về `LAST_KNOWN` (nếu từng có read-back bền vững) hoặc `UNAVAILABLE`.
func TestListProgramsEmptyProgramsArrayIsCoreLive(t *testing.T) {
	store := openProgramsTestStore(t)
	seedProgramsProject(t, store,
		programsIntentSeed{programID: "prog-seen", desiredEnabled: true, lastKnownState: "RUNNING"},
		programsIntentSeed{programID: "prog-never-seen", desiredEnabled: true},
	)
	service := newProgramsService(t, store, fakeMonitorProvider{snapshot: liveProgramsSnapshot()})
	page, err := service.ListPrograms(context.Background(), programsProjectID)
	if err != nil {
		t.Fatalf("ListPrograms: %v", err)
	}
	if page.RuntimeStateSource != ProgramSourceCoreLive || page.ObservedAt == nil {
		t.Fatalf("mảng rỗng vẫn là Core sống: %+v", page)
	}
	seen := itemByID(t, page, "prog-seen")
	if seen.RuntimeStateSource != ProgramSourceLastKnown || seen.RuntimeState != "RUNNING" {
		t.Fatalf("prog-seen phải là LAST_KNOWN/RUNNING: %+v", seen)
	}
	if seen.ObservedAt == nil || *seen.ObservedAt == programsSnapshotObservedAt {
		t.Fatalf("LAST_KNOWN phải mang mốc của CHÍNH nó, không mượn mốc snapshot: %+v", seen.ObservedAt)
	}
	if healthOf(seen) != "UNKNOWN" {
		t.Fatalf("LAST_KNOWN không phải số đo sống ⇒ health UNKNOWN: %s", healthOf(seen))
	}
	never := itemByID(t, page, "prog-never-seen")
	if never.RuntimeStateSource != ProgramSourceUnavailable || never.RuntimeState != "UNKNOWN" {
		t.Fatalf("chưa từng quan sát ⇒ UNAVAILABLE/UNKNOWN: %+v", never)
	}
}

// TestListProgramsLastKnownRejectsPhantomTransitions — CHECK constraint của
// store còn cho phép `STARTING`/`STOPPING`, nhưng D-07 nói rõ hai giá trị đó
// không bao giờ được bày ra. Một dòng cũ mang chúng phải xuống
// `UNKNOWN`/`UNAVAILABLE`, không được lọt qua đường `LAST_KNOWN` và làm UI kẹt
// vĩnh viễn ở một chuyển tiếp không tồn tại.
func TestListProgramsLastKnownRejectsPhantomTransitions(t *testing.T) {
	store := openProgramsTestStore(t)
	seedProgramsProject(t, store,
		programsIntentSeed{programID: "prog-starting", desiredEnabled: true, lastKnownState: "STARTING"},
		programsIntentSeed{programID: "prog-stopping", desiredEnabled: false, lastKnownState: "STOPPING"},
		programsIntentSeed{programID: "prog-waiting", desiredEnabled: true, lastKnownState: "WAITING"},
	)
	service := newProgramsService(t, store, fakeMonitorProvider{snapshot: liveProgramsSnapshot()})
	page, err := service.ListPrograms(context.Background(), programsProjectID)
	if err != nil {
		t.Fatalf("ListPrograms: %v", err)
	}
	for _, programID := range []string{"prog-starting", "prog-stopping"} {
		item := itemByID(t, page, programID)
		if item.RuntimeState != "UNKNOWN" || item.RuntimeStateSource != ProgramSourceUnavailable {
			t.Errorf("%s: %s/%s; want UNKNOWN/UNAVAILABLE",
				programID, item.RuntimeState, item.RuntimeStateSource)
		}
	}
	if item := itemByID(t, page, "prog-waiting"); item.RuntimeState != "WAITING" ||
		item.RuntimeStateSource != ProgramSourceLastKnown {
		t.Errorf("trạng thái hợp lệ vẫn phải qua được LAST_KNOWN: %+v", item)
	}
}

// TestListProgramsIncludesCoreOnlyInstancesWithoutFabricatingIntent — Program mà
// Core đang chạy nhưng Project chưa từng ghi intent vẫn phải hiện ra, với
// `desiredEnabled = null`. Điền `false` sẽ đọc thành "có người đã tắt nó".
func TestListProgramsIncludesCoreOnlyInstancesWithoutFabricatingIntent(t *testing.T) {
	store := openProgramsTestStore(t)
	seedProgramsProject(t, store, programsIntentSeed{programID: "prog-known", desiredEnabled: true})
	service := newProgramsService(t, store, fakeMonitorProvider{snapshot: liveProgramsSnapshot(
		ProgramMetricsView{InstanceID: "prog-known", State: "RUNNING", Enabled: true, PeriodMS: 1000,
			LastRunMonoNS: 8_900_000_000},
		ProgramMetricsView{InstanceID: "prog-orphan", State: "RUNNING", Enabled: true, PeriodMS: 5000,
			LastRunMonoNS: 8_700_000_000},
	)})
	page, err := service.ListPrograms(context.Background(), programsProjectID)
	if err != nil {
		t.Fatalf("ListPrograms: %v", err)
	}
	orphan := itemByID(t, page, "prog-orphan")
	if orphan.DesiredEnabled != nil || orphan.Generation != nil || orphan.UpdatedBy != nil ||
		orphan.UpdatedAtUTCMS != nil {
		t.Fatalf("Program chưa có intent phải để trống nhóm ý định: %+v", orphan)
	}
	if orphan.RuntimeStateSource != ProgramSourceCoreLive || orphan.RuntimeState != "RUNNING" {
		t.Fatalf("read-back sống vẫn phải đầy đủ: %+v", orphan)
	}
	if len(page.Items) != 2 || page.Items[0].ProgramID != "prog-known" ||
		page.Items[1].ProgramID != "prog-orphan" {
		t.Fatalf("thứ tự phải ổn định theo programId: %+v", page.Items)
	}
}

// TestListProgramsNeverWritesIntentTable — đường ĐỌC không được đụng vào bảng ý
// định. Core báo `FAULTED`/`DISABLED` mà bảng intent bị ghi theo thì một Program
// đang hỏng sẽ trông như một Program "người vận hành đã tắt".
func TestListProgramsNeverWritesIntentTable(t *testing.T) {
	store := openProgramsTestStore(t)
	seedProgramsProject(t, store,
		programsIntentSeed{programID: "prog-a", desiredEnabled: true, lastKnownState: "RUNNING"})
	before, err := store.ListProgramRuntimeIntents(context.Background(), programsProjectID)
	if err != nil {
		t.Fatalf("ListProgramRuntimeIntents: %v", err)
	}
	service := newProgramsService(t, store, fakeMonitorProvider{snapshot: liveProgramsSnapshot(
		ProgramMetricsView{InstanceID: "prog-a", State: "FAULTED", Enabled: false, PeriodMS: 1000},
	)})
	if _, err := service.ListPrograms(context.Background(), programsProjectID); err != nil {
		t.Fatalf("ListPrograms: %v", err)
	}
	after, err := store.ListProgramRuntimeIntents(context.Background(), programsProjectID)
	if err != nil {
		t.Fatalf("ListProgramRuntimeIntents: %v", err)
	}
	if fmt.Sprintf("%+v", before) != fmt.Sprintf("%+v", after) {
		t.Fatalf("ListPrograms đã ghi đè bảng intent:\ntrước=%+v\nsau=%+v", before, after)
	}
}

// TestListProgramsRejectsInvalidProjectID — id không phải UUID v4 là request
// sai, không phải "Project rỗng".
func TestListProgramsRejectsInvalidProjectID(t *testing.T) {
	store := openProgramsTestStore(t)
	seedProgramsProject(t, store)
	service := newProgramsService(t, store, fakeMonitorProvider{snapshot: liveProgramsSnapshot()})
	if _, err := service.ListPrograms(context.Background(), "not-a-uuid"); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("err = %v; want ErrInvalidRequest", err)
	}
}

// TestListProgramsReportsCoreTruncation — Core cắt ở trần 32 ⇒ danh sách KHÔNG
// đầy đủ và phải nói ra, không im lặng bỏ bớt.
func TestListProgramsReportsCoreTruncation(t *testing.T) {
	store := openProgramsTestStore(t)
	seedProgramsProject(t, store)
	snapshot := liveProgramsSnapshot(ProgramMetricsView{InstanceID: "prog-a", State: "RUNNING",
		Enabled: true, PeriodMS: 1000})
	snapshot.ProgramsTruncated = true
	service := newProgramsService(t, store, fakeMonitorProvider{snapshot: snapshot})
	page, err := service.ListPrograms(context.Background(), programsProjectID)
	if err != nil {
		t.Fatalf("ListPrograms: %v", err)
	}
	if page.ProgramsTruncated == nil || !*page.ProgramsTruncated {
		t.Fatalf("phải báo danh sách bị cắt: %+v", page.ProgramsTruncated)
	}
}

// TestProgramRuntimeStateMappingFollowsD07 khoá NGUYÊN bảng D-07 (§4.1), gồm cả
// việc `STARTING`/`STOPPING` KHÔNG BAO GIỜ được bày ra như trạng thái hợp lệ.
func TestProgramRuntimeStateMappingFollowsD07(t *testing.T) {
	cases := map[string]string{
		"RUNNING": "RUNNING", "STOPPED": "WAITING", "ACTIVE": "WAITING",
		"ROLLED_BACK": "WAITING", "DISABLED": "DISABLED", "FAULTED": "FAULTED",
		"REJECTED": "FAULTED", "EMPTY": "UNKNOWN", "STAGED": "UNKNOWN",
		"VALIDATED": "UNKNOWN", "READY": "UNKNOWN", "": "UNKNOWN",
		"NOT_A_STATE": "UNKNOWN",
		// `start()`/`stop()`/`disable()` đổi trạng thái đồng bộ tức thì nên hai
		// giá trị này không tồn tại; nếu vẫn nhận được thì đó là giả định đã
		// sai, và UI phải thấy UNKNOWN chứ không kẹt ở một chuyển tiếp ma.
		"STARTING": "UNKNOWN", "STOPPING": "UNKNOWN",
	}
	for coreState, want := range cases {
		if got := programRuntimeStateFromCore(coreState); got != want {
			t.Errorf("%q → %q; want %q", coreState, got, want)
		}
	}
}

// TestListProgramsEvidenceJSON in ra NGUYÊN VĂN hai response của mốc bàn giao M2
// — Core sống và Core im — để bằng chứng nghiệm thu là output thật của test chứ
// không phải JSON viết tay.
func TestListProgramsEvidenceJSON(t *testing.T) {
	for _, scenario := range []struct {
		name    string
		monitor fakeMonitorProvider
	}{
		{"(a) Core sống", fakeMonitorProvider{snapshot: liveProgramsSnapshot(
			ProgramMetricsView{InstanceID: "prog-ahu-supply", State: "RUNNING", Enabled: true,
				PeriodMS: 1000, LastExecNS: 12_000_000, MaxExecNS: 41_500_000,
				MissedReleaseCount: 3, ConsecutiveMissedRelease: 0,
				LastRunMonoNS: 8_500_000_000, Lane: 0},
			ProgramMetricsView{InstanceID: "prog-ahu-return", State: "DISABLED", Enabled: false,
				PeriodMS: 5000, LastRunMonoNS: 0, Lane: 1},
		)}},
		{"(b) Core im", fakeMonitorProvider{err: errors.New("core unavailable trong test")}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			store := openProgramsTestStore(t)
			seedProgramsProject(t, store,
				programsIntentSeed{programID: "prog-ahu-supply", desiredEnabled: true, lastKnownState: "RUNNING"},
				programsIntentSeed{programID: "prog-ahu-return", desiredEnabled: false, lastKnownState: "DISABLED"},
			)
			service := newProgramsService(t, store, scenario.monitor)
			page, err := service.ListPrograms(context.Background(), programsProjectID)
			if err != nil {
				t.Fatalf("ListPrograms: %v", err)
			}
			raw, err := json.MarshalIndent(page, "", "  ")
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			t.Logf("EVIDENCE %s\n%s", scenario.name, raw)
		})
	}
}
