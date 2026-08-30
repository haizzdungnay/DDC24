package application

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

// T60-013/T60-014 — `GET /api/v1/programming/projects/{projectId}/programs`.
//
// # HAI NGUỒN, KHÔNG BAO GIỜ TRỘN
//
// Trang này ghép hai thứ có bản chất khác nhau và cố ý giữ chúng ở hai nhóm
// trường riêng:
//
//   - Ý ĐỊNH BỀN VỮNG (`program_runtime_intents`): người vận hành MUỐN gì. Sống
//     qua mất điện, qua việc Core chưa sẵn sàng.
//   - READ-BACK SỐNG (`point_snapshot` của Core): thiết bị ĐANG làm gì. Chỉ có
//     giá trị khi đọc được ngay lúc này.
//
// Hàm này KHÔNG ghi gì vào bảng intent. Một read-back không phải một ý định, và
// để đường đọc ghi đè bảng intent sẽ biến một Program đang `FAULTED` thành một
// Program "người vận hành đã tắt" — đúng thứ `RecordProgramRuntimeState` đã
// dựng rào ở lớp store.
//
// # VÌ SAO CÓ `runtimeStateSource`
//
// Không có trường này thì `runtimeState = "RUNNING"` đọc từ DB (ghi lúc đẩy
// intent, có thể từ một giờ trước) trông y hệt `RUNNING` vừa đọc từ Core. Người
// vận hành mất khả năng phân biệt "đang chạy" với "lần cuối tôi nhìn thì đang
// chạy" — và đó chính là lúc họ cần phân biệt nhất.

const (
	// ProgramSourceCoreLive: số liệu đọc được từ CHÍNH snapshot này của Core.
	ProgramSourceCoreLive = "CORE_LIVE"
	// ProgramSourceLastKnown: Core sống nhưng KHÔNG kể tên Program này trong
	// bảng của nó; giá trị hiển thị là read-back bền vững lần cuối, kèm mốc thời
	// gian của chính nó. Không phải số đo sống, và nhãn này nói đúng như vậy.
	ProgramSourceLastKnown = "LAST_KNOWN"
	// ProgramSourceUnavailable: không đọc được gì. `runtimeState` bắt buộc là
	// `UNKNOWN` và mọi số đo là `null`.
	ProgramSourceUnavailable = "UNAVAILABLE"
)

// ProgramsPageView khớp cấu trúc trả về của `GET /projects/{id}/programs`.
type ProgramsPageView struct {
	SchemaVersion string `json:"schemaVersion"`
	ProjectID     string `json:"projectId"`
	// RuntimeStateSource ở mức TRANG: `CORE_LIVE` khi đọc được bảng Program của
	// Core trong lần gọi này, `UNAVAILABLE` khi không. Mức dòng vẫn có thể hạ
	// xuống `LAST_KNOWN`/`UNAVAILABLE` riêng.
	RuntimeStateSource string `json:"runtimeStateSource"`
	// ObservedAt là mốc Core chụp snapshot. `null` khi không đọc được — KHÔNG
	// điền đồng hồ của web-api vào đây, đó là mốc của một quan sát chưa xảy ra.
	ObservedAt *string `json:"observedAt"`
	// ProgramsTruncated: `null` khi không có bảng nào để nói tới; `true` khi Core
	// đã cắt ở trần `kMaxProgramsTotal` (32) ⇒ danh sách KHÔNG đầy đủ.
	ProgramsTruncated *bool                 `json:"programsTruncated"`
	Items             []ProgramListItemView `json:"items"`
}

// ProgramListItemView là một dòng của bảng Programs (PGM-01, sáu cột theo D-02).
//
// Gần như mọi trường số đo là con trỏ, có chủ ý: thiếu số liệu phải ra `null`
// tường minh, KHÔNG BAO GIỜ ra `0`. `0` ở cột `Cycle` hay `Last Exec` là một số
// bịa, và nó bịa đúng vào chỗ người vận hành tin nhất.
type ProgramListItemView struct {
	ProgramID string `json:"programId"`

	// --- Ý định bền vững (store). `null` = Project này chưa từng ghi intent cho
	// Program đó; KHÁC HẲN `false` (= có người đã tắt nó). ---
	DesiredEnabled *bool   `json:"desiredEnabled"`
	Generation     *int64  `json:"generation"`
	UpdatedBy      *string `json:"updatedBy"`
	UpdatedAtUTCMS *int64  `json:"updatedAtUtcMs"`

	// --- Read-back ---
	// RuntimeState theo hợp đồng D-07: RUNNING/WAITING/DISABLED/FAULTED/UNKNOWN.
	RuntimeState       string `json:"runtimeState"`
	RuntimeStateSource string `json:"runtimeStateSource"`
	// CoreState là NGUYÊN VĂN `StProgramState`. Giữ lại vì `runtimeState` là một
	// phép chiếu có mất mát: `ACTIVE`, `STOPPED` và `ROLLED_BACK` cùng ra
	// `WAITING`, nhưng chỉ `ROLLED_BACK` mới kéo `health` xuống `DEGRADED`.
	CoreState *string `json:"coreState"`
	// Enabled là cờ enable THẬT trong Core, không phải ý định. Hai thứ lệch nhau
	// là một sự kiện vận hành, không phải một lỗi hiển thị.
	Enabled    *bool   `json:"enabled"`
	ObservedAt *string `json:"observedAt"`

	PeriodMS                 *int    `json:"periodMs"`
	LastExecNS               *uint64 `json:"lastExecNs"`
	MaxExecNS                *uint64 `json:"maxExecNs"`
	MissedReleaseCount       *uint32 `json:"missedReleaseCount"`
	ConsecutiveMissedRelease *uint32 `json:"consecutiveMissedRelease"`
	// LastRunAtUTC là MỐC lần chạy gần nhất — đúng thứ cột `Last Exec` cần.
	// KHÔNG suy ra từ `lastExecNs` (đó là THỜI LƯỢNG một lần chạy): mốc dựng từ
	// `lastRunMonoNs` trừ trong cùng snapshot rồi quy về đồng hồ tường.
	LastRunAtUTC *string `json:"lastRunAtUtc"`
	// LastRunAgeMS là tuổi của lần chạy gần nhất, tính bằng đúng một phép trừ
	// `capturedMonotonicNs - lastRunMonoNs` TRONG CÙNG snapshot.
	LastRunAgeMS *int64 `json:"lastRunAgeMs"`
	Lane         *int   `json:"lane"`
	// LastFaultCode/Line — LÝ DO Program hỏng, do Core cung cấp.
	//
	// `null` = Core không cấp được (đời cũ hoặc chưa đọc được snapshot), KHÁC
	// HẲN chuỗi rỗng nghĩa là "chưa từng fault". Báo `FAULTED` mà không kèm lý
	// do là buộc người vận hành đoán: đo được trên bo, một Program nằm FAULTED
	// suốt hai ngày và không nơi nào nói vì sao.
	LastFaultCode *string `json:"lastFaultCode"`
	LastFaultLine *uint32 `json:"lastFaultLine"`
	FaultCount    *uint32 `json:"faultCount"`

	// Health do SERVER tính (D-04), nullable. `null` là câu trả lời hợp lệ và có
	// nghĩa: Program không đang chạy thì "sức khoẻ" không có nội dung gì, FE
	// hiện `—`. Bịa thêm một giá trị enum cho nó là nói dối cho gọn.
	Health *string `json:"health"`
}

// programReadBack là bảng Program sống đã đọc được của MỘT lần gọi.
type programReadBack struct {
	byInstance          map[string]ProgramMetricsView
	order               []string
	observedAt          string
	capturedMonotonicNs uint64
	truncated           bool
}

// ListPrograms ghép intent bền vững với read-back sống.
func (s *RuntimeService) ListPrograms(ctx context.Context, projectID string) (ProgramsPageView, error) {
	if !isUUID(projectID) {
		return ProgramsPageView{}, ErrInvalidRequest
	}
	if s.store == nil {
		return ProgramsPageView{}, fmt.Errorf("Programming store chưa cấu hình")
	}
	intents, err := s.store.ListProgramRuntimeIntents(ctx, projectID)
	if err != nil {
		return ProgramsPageView{}, err
	}

	live, hasLive := s.readProgramSnapshot(ctx)

	page := ProgramsPageView{
		SchemaVersion: "1.0", ProjectID: projectID,
		RuntimeStateSource: ProgramSourceUnavailable,
		Items:              make([]ProgramListItemView, 0, len(intents)),
	}
	if hasLive {
		page.RuntimeStateSource = ProgramSourceCoreLive
		if live.observedAt != "" {
			observedAt := live.observedAt
			page.ObservedAt = &observedAt
		}
		truncated := live.truncated
		page.ProgramsTruncated = &truncated
	}

	// Hợp nhất hai danh sách. Thứ tự: intent trước (thứ tự `program_id` của
	// store), rồi những Program chỉ Core biết. Sắp lại toàn bộ theo id ở cuối để
	// hai lần đọc liên tiếp cho cùng một thứ tự — bảng nhảy dòng giữa hai lần
	// poll là một lỗi dùng được, không phải chuyện thẩm mỹ.
	intentByID := make(map[string]int, len(intents))
	for index, intent := range intents {
		intentByID[intent.ProgramID] = index
	}
	ids := make([]string, 0, len(intents)+len(live.order))
	for _, intent := range intents {
		ids = append(ids, intent.ProgramID)
	}
	for _, instanceID := range live.order {
		if _, known := intentByID[instanceID]; !known {
			ids = append(ids, instanceID)
		}
	}
	sort.Strings(ids)

	for _, id := range ids {
		item := ProgramListItemView{
			ProgramID: id, RuntimeState: "UNKNOWN",
			RuntimeStateSource: ProgramSourceUnavailable,
		}
		if index, known := intentByID[id]; known {
			intent := intents[index]
			desired := intent.DesiredEnabled
			generation := intent.Generation
			updatedBy := intent.UpdatedBy
			updatedAt := intent.UpdatedAtUTCMS
			item.DesiredEnabled = &desired
			item.Generation = &generation
			item.UpdatedBy = &updatedBy
			item.UpdatedAtUTCMS = &updatedAt
		}

		metrics, inLive := live.byInstance[id]
		switch {
		case hasLive && inLive:
			applyProgramReadBack(&item, metrics, live)
		case hasLive:
			// Core sống nhưng không kể tên Program này. Hạ về read-back bền vững
			// lần cuối NẾU từng có một cái, và nói rõ nó là `LAST_KNOWN` kèm mốc
			// của chính nó. Dán nhãn `CORE_LIVE` cho số liệu này mới là điều
			// cấm — không phải việc hiển thị nó.
			if index, known := intentByID[id]; known {
				if stored := programContractStateFromStore(intents[index].RuntimeState); stored != "" {
					item.RuntimeState = stored
					item.RuntimeStateSource = ProgramSourceLastKnown
					observedAt := formatTime(intents[index].UpdatedAtUTCMS)
					item.ObservedAt = &observedAt
				}
			}
		default:
			// Core im (hoặc Core đời cũ, khoá `programs` vắng): `UNKNOWN` +
			// `UNAVAILABLE` cho MỌI dòng, không có ngoại lệ. Trả lại trạng thái
			// bền vững ở đây sẽ là trả giá trị cũ ngay lúc ta không biết gì —
			// đúng lúc không được phép đoán.
		}
		item.Health = programHealth(item, metrics, inLive)
		page.Items = append(page.Items, item)
	}
	return page, nil
}

// applyProgramReadBack đổ số đo sống của một Program vào dòng hiển thị.
func applyProgramReadBack(item *ProgramListItemView, metrics ProgramMetricsView, live programReadBack) {
	item.RuntimeState = programRuntimeStateFromCore(metrics.State)
	item.RuntimeStateSource = ProgramSourceCoreLive
	coreState := metrics.State
	enabled := metrics.Enabled
	item.CoreState = &coreState
	item.Enabled = &enabled
	if live.observedAt != "" {
		observedAt := live.observedAt
		item.ObservedAt = &observedAt
	}
	// `periodMs == 0` nghĩa là Core không phân giải được chu kỳ hiệu lực, KHÔNG
	// phải "chu kỳ bằng 0". Để `null` cho cột Cycle hiện `—`.
	if metrics.PeriodMS > 0 {
		period := metrics.PeriodMS
		item.PeriodMS = &period
	}
	lastExec := metrics.LastExecNS
	maxExec := metrics.MaxExecNS
	missed := metrics.MissedReleaseCount
	consecutive := metrics.ConsecutiveMissedRelease
	lane := metrics.Lane
	item.LastExecNS = &lastExec
	item.MaxExecNS = &maxExec
	item.MissedReleaseCount = &missed
	item.ConsecutiveMissedRelease = &consecutive
	item.Lane = &lane
	// Chuyển tiếp NGUYÊN VẸN con trỏ: `nil` phải đi tới tận FE để nó hiện
	// "không đọc được", chứ không được hoá thành chuỗi rỗng nghĩa là "chưa
	// từng fault".
	item.LastFaultCode = metrics.LastFaultCode
	item.LastFaultLine = metrics.LastFaultLine
	item.FaultCount = metrics.FaultCount

	// Mốc lần chạy gần nhất. `lastRunMonoNs == 0` = chưa chạy lần nào kể từ lần
	// activate gần nhất ⇒ `null`, không phải "chạy lúc mốc 0". Mốc lớn hơn mốc
	// chụp snapshot là bất khả (cùng một đồng hồ, đọc sau) ⇒ cũng `null`, thà
	// bỏ trống còn hơn hiện một tuổi âm.
	if metrics.LastRunMonoNS == 0 || metrics.LastRunMonoNS > live.capturedMonotonicNs {
		return
	}
	ageNs := live.capturedMonotonicNs - metrics.LastRunMonoNS
	ageMs := int64(ageNs / 1_000_000)
	item.LastRunAgeMS = &ageMs
	observed, err := time.Parse(time.RFC3339Nano, live.observedAt)
	if err != nil {
		return
	}
	lastRun := observed.Add(-time.Duration(ageNs)).UTC().Format(time.RFC3339Nano)
	item.LastRunAtUTC = &lastRun
}

// readProgramSnapshot đọc bảng Program sống. Trả `false` khi KHÔNG có read-back
// dùng được, và ba nguyên nhân dưới đây cố ý về chung một câu trả lời vì hệ quả
// hiển thị của chúng giống hệt nhau — không đọc được thì không được đoán:
//
//   - provider chưa cấu hình;
//   - Core không trả lời (`point_snapshot` lỗi/timeout);
//   - Core trả lời nhưng KHOÁ `programs` VẮNG (`Programs == nil`) — Core đời cũ
//     chưa biết trường này. Đây là chỗ dễ sai nhất: mảng RỖNG (`[]`) là một câu
//     trả lời hợp lệ ("hệ không có Program nào") và phải đi tiếp thành
//     `CORE_LIVE` với danh sách rỗng, chứ không lẫn vào nhánh này.
func (s *RuntimeService) readProgramSnapshot(ctx context.Context) (programReadBack, bool) {
	if s.monitor == nil {
		return programReadBack{}, false
	}
	truth, err := s.monitor.ReadProgrammingMonitorSnapshot(ctx)
	if err != nil {
		return programReadBack{}, false
	}
	if truth.Programs == nil {
		return programReadBack{}, false
	}
	live := programReadBack{
		byInstance:          make(map[string]ProgramMetricsView, len(truth.Programs)),
		order:               make([]string, 0, len(truth.Programs)),
		observedAt:          truth.ObservedAt,
		capturedMonotonicNs: truth.CapturedMonotonicNs,
		truncated:           truth.ProgramsTruncated,
	}
	for _, program := range truth.Programs {
		if program.InstanceID == "" {
			continue
		}
		if _, duplicate := live.byInstance[program.InstanceID]; duplicate {
			continue
		}
		live.byInstance[program.InstanceID] = program
		live.order = append(live.order, program.InstanceID)
	}
	return live, true
}

// programRuntimeStateFromCore là bảng ánh xạ D-07 (Plan 60 §4.1).
//
// `STARTING`/`STOPPING` KHÔNG có trong bảng, và đó là chủ ý: `start()`/`stop()`/
// `disable()` của scheduler đổi trạng thái ĐỒNG BỘ, TỨC THÌ — không có pha trung
// gian nào để hiển thị. Nhận về một trong hai giá trị đó nghĩa là giả định trên
// đã sai, nên chúng rơi vào `UNKNOWN` thay vì được bày ra như một chuyển tiếp
// hợp lệ; giữ chúng sẽ làm UI kẹt vĩnh viễn ở một trạng thái không tồn tại.
//
// `ROLLED_BACK` ra `WAITING`, KHÔNG ra `FAULTED`: `start()` chấp nhận nó, nên nó
// là trạng thái nghỉ chứ không phải trạng thái lỗi. Việc "đã có rollback" được
// nói bằng `health = DEGRADED`, đúng chỗ của nó.
func programRuntimeStateFromCore(state string) string {
	switch strings.ToUpper(strings.TrimSpace(state)) {
	case "RUNNING":
		return "RUNNING"
	case "WAITING", "STOPPED", "ACTIVE", "ROLLED_BACK":
		return "WAITING"
	case "DISABLED":
		return "DISABLED"
	case "FAULTED", "REJECTED":
		return "FAULTED"
	default:
		// EMPTY/STAGED/VALIDATED/READY là pha vòng đời TRƯỚC vận hành; mọi giá
		// trị ngoài bảng cũng về đây. Không đoán, không mặc định thành RUNNING.
		return "UNKNOWN"
	}
}

// programContractStateFromStore lọc trạng thái read-back BỀN VỮNG về đúng bốn
// giá trị vận hành của hợp đồng, trả `""` khi không dùng được.
//
// Lọc chứ không chuyển tiếp thẳng vì CHECK constraint của
// `program_runtime_intents.last_known_runtime_state` còn cho phép `STARTING` và
// `STOPPING` — hai giá trị mà D-07 nói rõ không bao giờ được bày ra. Một dòng cũ
// trong DB mang một trong hai giá trị đó sẽ đẩy UI kẹt vĩnh viễn ở một chuyển
// tiếp không tồn tại, và nó sẽ kẹt IM LẶNG vì không có gì bất thường để thấy.
// `UNKNOWN` cũng trả `""`: "chưa từng quan sát được" không phải một read-back,
// nên dòng đó phải xuống `UNAVAILABLE` chứ không được mang nhãn `LAST_KNOWN`.
func programContractStateFromStore(stored string) string {
	switch strings.ToUpper(strings.TrimSpace(stored)) {
	case "RUNNING", "WAITING", "DISABLED", "FAULTED":
		return strings.ToUpper(strings.TrimSpace(stored))
	default:
		return ""
	}
}

// programHealth là công thức D-04 (Plan 60 §4.2), xét theo thứ tự và dừng ở điều
// kiện khớp đầu tiên.
//
// # MỘT ĐÍNH CHÍNH THỨ TỰ, ĐÃ CỐ Ý
//
// Bảng §4.2 xếp "điều 3: runtimeState ∈ {DISABLED, WAITING, UNKNOWN} ⇒ null"
// TRƯỚC "điều 6: Core state là ROLLED_BACK ⇒ DEGRADED". Nhưng `ROLLED_BACK` ánh
// xạ thành `WAITING` (§4.1), nên đọc đúng thứ tự chữ thì điều 6 KHÔNG BAO GIỜ
// chạy tới được — trong khi bảng §4.1 và phần lời của D-07 đều nói rõ
// `ROLLED_BACK` phải ra `DEGRADED` ("việc đã có rollback được nói bằng
// health = DEGRADED, đúng chỗ của nó"). Hai chỗ trong cùng một quyết định mâu
// thuẫn nhau; ở đây theo §4.1 vì đó là phương án duy nhất khiến điều 6 có nghĩa.
// Cụ thể: xét ROLLED_BACK NGAY TRƯỚC điều 3. Không điều nào khác đổi thứ tự.
//
// Điều 5 (`maxExecNs > 0.8 × periodMs`) bị BỎ QUA khi `periodMs == 0`: không có
// chu kỳ thì không có ngưỡng, và so với ngưỡng 0 sẽ dán `DEGRADED` cho mọi
// Program từng chạy dù chỉ một nano-giây.
func programHealth(item ProgramListItemView, metrics ProgramMetricsView, inLive bool) *string {
	degraded, fault, healthy := "DEGRADED", "FAULT", "HEALTHY"
	unknown := "UNKNOWN"

	// 1. Không phải số đo sống ⇒ không kết luận gì về sức khoẻ.
	if item.RuntimeStateSource != ProgramSourceCoreLive || !inLive {
		return &unknown
	}
	// 2. Lỗi khi chạy (gồm cả `REJECTED`).
	if item.RuntimeState == "FAULTED" {
		return &fault
	}
	// 6 (đưa lên trước 3, xem chú thích trên). Gói rollback đang được giữ.
	if strings.ToUpper(strings.TrimSpace(metrics.State)) == "ROLLED_BACK" {
		return &degraded
	}
	// 3. Không chạy ⇒ `null`, FE hiện `—`.
	switch item.RuntimeState {
	case "DISABLED", "WAITING", "UNKNOWN":
		return nil
	}
	// 4. Lỡ nhịp LIÊN TIẾP. Dùng `consecutive_missed_release` chứ KHÔNG dùng
	// `missed_release_count`: bộ đếm tích luỹ sẽ ghim Program ở DEGRADED vĩnh
	// viễn vì một lần lỡ nhịp cách đây một giờ.
	if metrics.ConsecutiveMissedRelease > 0 {
		return &degraded
	}
	// 5. Overrun: đỉnh thời lượng chạy vượt 80% chu kỳ. So bằng số nguyên
	// (0,8 × periodMs ms = periodMs × 800_000 ns) để không phụ thuộc làm tròn
	// dấu phẩy động ở đúng ngưỡng.
	if metrics.PeriodMS > 0 && metrics.MaxExecNS > uint64(metrics.PeriodMS)*800_000 {
		return &degraded
	}
	// 7. `RUNNING`, không dấu hiệu nào.
	return &healthy
}
