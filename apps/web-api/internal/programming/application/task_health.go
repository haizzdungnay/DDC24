package application

import (
	"sync"
	"time"
)

// Sức khoẻ Task theo tiêu chí C2–C4 của ADR-061 (mục 4.9: "vi phạm bất kỳ ⇒
// task health DEGRADED").
//
// Core công bố các bộ đếm TÍCH LUỸ (overrun, missed release, jitter violation,
// missed base step). Dùng thẳng `> 0` sẽ ghim Task ở DEGRADED vĩnh viễn vì một
// lần lệch nhịp cách đây nhiều giờ — đúng lỗi mà `programHealth` đã tránh bằng
// `consecutiveMissedRelease`. Vì vậy server nhớ lần đọc trước và chỉ kết luận
// DEGRADED khi bộ đếm TĂNG trong cửa sổ 60 s gần nhất — cùng cửa sổ Core dùng
// cho `jitterMaxUs`.
const (
	taskHealthWindow = 60 * time.Second
	// taskJitterLimitUs là trần C4: lệch nhịp đánh thức ≤ 100 µs ở MỌI step.
	taskJitterLimitUs = 100
)

const (
	taskHealthReasonOverrun         = "OVERRUN"
	taskHealthReasonMissedRelease   = "MISSED_RELEASE"
	taskHealthReasonJitterViolation = "JITTER_VIOLATION"
	taskHealthReasonMissedBaseStep  = "MISSED_BASE_STEP"
	taskHealthReasonJitterMax       = "JITTER_MAX_EXCEEDED"
)

// taskHealthReasonOrder cố định thứ tự lý do trong phản hồi để hai lần đọc cùng
// trạng thái cho cùng một mảng.
var taskHealthReasonOrder = []string{
	taskHealthReasonOverrun, taskHealthReasonMissedRelease, taskHealthReasonJitterViolation,
	taskHealthReasonMissedBaseStep, taskHealthReasonJitterMax,
}

type taskCounterKey int

const (
	taskCounterOverrun taskCounterKey = iota
	taskCounterMissedRelease
	taskCounterJitterViolation
	taskCounterMissedBaseStep
)

var taskCounterReason = map[taskCounterKey]string{
	taskCounterOverrun:         taskHealthReasonOverrun,
	taskCounterMissedRelease:   taskHealthReasonMissedRelease,
	taskCounterJitterViolation: taskHealthReasonJitterViolation,
	taskCounterMissedBaseStep:  taskHealthReasonMissedBaseStep,
}

type taskCounterState struct {
	known          bool
	value          uint64
	lastIncreaseAt time.Time
	increased      bool
}

// taskHealthTracker giữ lần đọc trước của từng bộ đếm. An toàn đồng thời:
// `GetRuntime` và `GetMonitor` cùng gọi nó từ các request song song.
type taskHealthTracker struct {
	mu       sync.Mutex
	taskID   string
	counters map[taskCounterKey]*taskCounterState
}

func newTaskHealthTracker() *taskHealthTracker {
	return &taskHealthTracker{counters: make(map[taskCounterKey]*taskCounterState)}
}

// observe cập nhật một bộ đếm và trả true khi nó TĂNG trong cửa sổ.
//
//   - Lần đầu thấy bộ đếm > 0: KHÔNG biết vi phạm xảy ra lúc nào, nên đánh dấu
//     là vừa tăng. Báo DEGRADED một cửa sổ khi không chắc an toàn hơn báo khoẻ.
//   - Bộ đếm GIẢM: Core vừa khởi động lại, mốc cũ vô nghĩa — nhận mốc mới, không
//     coi là vi phạm.
func (t *taskHealthTracker) observe(key taskCounterKey, value *uint64, now time.Time) bool {
	state := t.counters[key]
	if state == nil {
		state = &taskCounterState{}
		t.counters[key] = state
	}
	if value == nil {
		// Core không cấp bộ đếm này: không kết luận gì, và quên mốc cũ để một
		// lần xuất hiện lại không bị so với số của một Core khác.
		*state = taskCounterState{}
		return false
	}
	switch {
	case !state.known:
		if *value > 0 {
			state.lastIncreaseAt, state.increased = now, true
		}
	case *value > state.value:
		state.lastIncreaseAt, state.increased = now, true
	}
	state.known, state.value = true, *value
	return state.increased && now.Sub(state.lastIncreaseAt) < taskHealthWindow
}

// evaluate gắn `Health`/`HealthReasons` vào một BẢN SAO của task metrics.
func (t *taskHealthTracker) evaluate(task *TaskMetricsView, now time.Time) {
	if t == nil || task == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if task.TaskID != t.taskID {
		// Task khác (hoặc Core đổi cấu hình): mốc cũ không thuộc về Task này.
		t.taskID = task.TaskID
		t.counters = make(map[taskCounterKey]*taskCounterState)
	}
	overrun := uint64(task.OverrunCount)
	missedRelease := uint64(task.MissedReleaseCount)
	active := map[string]bool{}
	for key, value := range map[taskCounterKey]*uint64{
		taskCounterOverrun:         &overrun,
		taskCounterMissedRelease:   &missedRelease,
		taskCounterJitterViolation: task.JitterViolationCount,
		taskCounterMissedBaseStep:  task.MissedBaseStepCount,
	} {
		if t.observe(key, value, now) {
			active[taskCounterReason[key]] = true
		}
	}
	// Overrun LIÊN TIẾP đang diễn ra là vi phạm C2 ngay lúc này, không cần đợi
	// bộ đếm tích luỹ tăng giữa hai lần đọc.
	if task.ConsecutiveOverruns > 0 {
		active[taskHealthReasonOverrun] = true
	}
	// `jitterMaxUs` đã là cực đại trong cửa sổ 60 s của Core: vượt 100 µs
	// nghĩa là có một step vi phạm C4 trong cửa sổ đó.
	if task.JitterMaxUS != nil && *task.JitterMaxUS > taskJitterLimitUs {
		active[taskHealthReasonJitterMax] = true
	}
	reasons := make([]string, 0, len(active))
	for _, reason := range taskHealthReasonOrder {
		if active[reason] {
			reasons = append(reasons, reason)
		}
	}
	task.HealthReasons = reasons
	switch {
	case task.State == "FAULT":
		task.Health = "FAULT"
	case len(reasons) > 0:
		task.Health = "DEGRADED"
	case task.State == "RUNNING":
		task.Health = "HEALTHY"
	default:
		// STOPPED: không chạy thì không có gì để kết luận là khoẻ.
		task.Health = "UNKNOWN"
	}
}

// taskWithHealth sao chép task metrics rồi tính health. Sao chép vì snapshot
// Monitor có thể được gộp (coalesce) và chia sẻ giữa các request đồng thời —
// ghi thẳng vào con trỏ chung là một cuộc đua dữ liệu.
func (s *RuntimeService) taskWithHealth(task *TaskMetricsView) *TaskMetricsView {
	if task == nil {
		return nil
	}
	copied := *task
	if task.HealthReasons != nil {
		copied.HealthReasons = append([]string(nil), task.HealthReasons...)
	}
	s.taskHealth.evaluate(&copied, s.now())
	return &copied
}
