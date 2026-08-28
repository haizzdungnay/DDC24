package app

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Truy vết truy cập tài khoản (`T57-3.16`) và tuỳ chọn người dùng (`T57-3.2`,
// `ADR-043`) của Plan 57 Wave 3.
//
// VÌ SAO "LẦN ĐĂNG NHẬP GẦN NHẤT" ĐỌC TỪ ACTIVITY CHỨ KHÔNG GHI VÀO `users.conf`
//
// Ghi mốc đăng nhập vào tệp tài khoản nghĩa là mỗi lần đăng nhập ghi lại cả tệp
// chứa bcrypt hash của mọi người dùng — thêm hao mòn flash trên bo nhúng cho
// một dữ liệu **đã được ghi sẵn ở chỗ khác**: `AuditLogger.Login` đã đẩy một sự
// kiện `login` vào kho Activity, và kho đó có file JSONL bền vững.
//
// Đánh đổi phải nói ra: Activity là vòng nhớ 2000 sự kiện. Trên một thiết bị
// bận, vết đăng nhập cũ sẽ bị đẩy ra — khi đó câu trả lời là **"không rõ"**,
// không phải "chưa từng đăng nhập". Hai điều đó khác nhau, và trên màn hình
// soát tài khoản thì nhầm chúng là nhầm nguy hiểm.

const (
	// Trần kích thước tuỳ chọn theo `ADR-043`. Đủ cho hàng trăm khung nhìn đặt
	// tên; đủ nhỏ để một tài khoản không biến tệp tuỳ chọn thành kho dữ liệu.
	userPreferencesMaxBytes = 16 * 1024
	// Số sự kiện Activity quét ngược để tìm vết đăng nhập. Quét cả vòng nhớ cho
	// mỗi lần mở trang Người dùng là phí; 2000 chính là sức chứa nên đây là
	// "quét tối đa một lượt", không hơn.
	loginScanLimit = 2000
)

// UserAccessDTO — một dòng trên trang Người dùng.
type UserAccessDTO struct {
	Username string `json:"username"`
	Role     Role   `json:"role"`
	// MustChangePassword — ADR-047. Hiện ra để admin biết tài khoản nào còn
	// đang giữ mật khẩu tạm.
	MustChangePassword bool `json:"mustChangePassword"`
	// LastLoginAt là `nil` khi KHÔNG TÌM THẤY vết trong kho Activity — có thể vì
	// chưa từng đăng nhập, cũng có thể vì vết đã bị đẩy khỏi vòng nhớ. Giao diện
	// phải nói "không rõ", không được nói "chưa đăng nhập bao giờ".
	LastLoginAt     *string `json:"lastLoginAt"`
	LastLoginRemote *string `json:"lastLoginRemote"`
	// LastFailedLoginAt giúp phát hiện dò mật khẩu — thứ mà Rev A chưa khoá tài
	// khoản (`ADR-037`), nên ít nhất phải nhìn thấy được.
	LastFailedLoginAt *string `json:"lastFailedLoginAt"`
	ActiveSessions    int     `json:"activeSessions"`
}

// UserAccessResponse gói thêm phần giới hạn tự khai báo: danh sách phiên nằm
// trong bộ nhớ tiến trình nên mất khi `mkddc-web` khởi động lại.
type UserAccessResponse struct {
	SchemaVersion  int             `json:"schemaVersion"`
	GeneratedAt    string          `json:"generatedAt"`
	Users          []UserAccessDTO `json:"users"`
	Sessions       []SessionDTO    `json:"sessions"`
	SessionsSince  string          `json:"sessionsSince"`
	ActivityWindow int             `json:"activityWindow"`
}

type SessionDTO struct {
	Username   string `json:"username"`
	Role       Role   `json:"role"`
	IssuedAt   string `json:"issuedAt"`
	LastSeenAt string `json:"lastSeenAt"`
	Remote     string `json:"remote,omitempty"`
}

func (a *App) handleGetUserAccess(w http.ResponseWriter, r *http.Request) {
	sessions := a.auth.Sessions()
	counts := map[string]int{}
	list := make([]SessionDTO, 0, len(sessions))
	for _, session := range sessions {
		counts[session.Username]++
		list = append(list, SessionDTO{
			Username: session.Username, Role: session.Role,
			IssuedAt:   session.IssuedAt.UTC().Format(time.RFC3339),
			LastSeenAt: session.LastSeenAt.UTC().Format(time.RFC3339),
			Remote:     session.Remote,
		})
	}

	logins := a.lastLoginByUser()
	users := a.auth.ListUsers()
	rows := make([]UserAccessDTO, 0, len(users))
	for _, user := range users {
		row := UserAccessDTO{
			Username: user.Username, Role: user.Role,
			MustChangePassword: user.MustChangePassword,
			ActiveSessions:     counts[user.Username],
		}
		if trace, ok := logins[strings.ToLower(user.Username)]; ok {
			if trace.acceptedAt != "" {
				value := trace.acceptedAt
				row.LastLoginAt = &value
			}
			if trace.remote != "" {
				value := trace.remote
				row.LastLoginRemote = &value
			}
			if trace.failedAt != "" {
				value := trace.failedAt
				row.LastFailedLoginAt = &value
			}
		}
		rows = append(rows, row)
	}

	writeJSON(w, http.StatusOK, UserAccessResponse{
		SchemaVersion: 1,
		GeneratedAt:   time.Now().UTC().Format(time.RFC3339),
		Users:         rows,
		Sessions:      list,
		// Nói thẳng phạm vi của hai nguồn để giao diện không phải đoán.
		SessionsSince:  a.startedAt.UTC().Format(time.RFC3339),
		ActivityWindow: activityCapacity,
	})
}

type loginTrace struct {
	acceptedAt string
	remote     string
	failedAt   string
}

// lastLoginByUser quét NGƯỢC kho Activity một lượt và dừng ngay khi đủ dữ kiện
// cho mọi tài khoản — sự kiện mới nhất đứng cuối, nên vết đầu tiên gặp khi đi
// ngược chính là vết gần nhất.
func (a *App) lastLoginByUser() map[string]loginTrace {
	result := map[string]loginTrace{}
	if a.activity == nil {
		return result
	}
	page := a.activity.Query(activityQuery{limit: loginScanLimit, action: "login"})
	for _, event := range page.Items {
		if event.Action != "login" {
			continue
		}
		key := strings.ToLower(event.Actor)
		trace := result[key]
		switch event.Outcome {
		case "accepted", "ok":
			if trace.acceptedAt == "" {
				trace.acceptedAt = event.Time
				trace.remote = event.Detail
			}
		default:
			if trace.failedAt == "" {
				trace.failedAt = event.Time
			}
		}
		result[key] = trace
	}
	return result
}

// ── Tuỳ chọn người dùng (`ADR-043`) ────────────────────────────────────────

// UserPreferenceStore giữ một túi JSON cho mỗi tài khoản.
//
// Backend cố ý KHÔNG hiểu nội dung: mỗi tuỳ chọn giao diện mới mà phải đổi hợp
// đồng backend là một vòng lặp không đáng có. Thứ backend cưỡng chế là hạn mức
// và quyền sở hữu — hai thứ mà giao diện không tự bảo đảm được.
type UserPreferenceStore struct {
	path string
	mu   sync.Mutex
}

func NewUserPreferenceStore(path string) *UserPreferenceStore {
	return &UserPreferenceStore{path: path}
}

var errPreferencesTooLarge = errors.New("preferences too large")

func (s *UserPreferenceStore) Get(username string) json.RawMessage {
	if s == nil {
		return json.RawMessage("{}")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	all := s.loadLocked()
	if raw, ok := all[strings.ToLower(username)]; ok && len(raw) > 0 {
		return raw
	}
	return json.RawMessage("{}")
}

func (s *UserPreferenceStore) Put(username string, value json.RawMessage) error {
	if s == nil {
		return errors.New("preference store unavailable")
	}
	if len(value) > userPreferencesMaxBytes {
		return errPreferencesTooLarge
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	all := s.loadLocked()
	all[strings.ToLower(username)] = value
	names := make([]string, 0, len(all))
	for name := range all {
		names = append(names, name)
	}
	sort.Strings(names)
	ordered := make(map[string]json.RawMessage, len(names))
	for _, name := range names {
		ordered[name] = all[name]
	}
	data, err := json.MarshalIndent(ordered, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o750); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *UserPreferenceStore) loadLocked() map[string]json.RawMessage {
	all := map[string]json.RawMessage{}
	data, err := os.ReadFile(s.path)
	if err != nil {
		return all
	}
	if err := json.Unmarshal(data, &all); err != nil {
		/* Tệp hỏng: trả rỗng thay vì làm chết endpoint. Tuỳ chọn là tiện ích,
		   không phải dữ liệu vận hành — nhưng ghi đè nó bằng bản rỗng thì chỉ
		   xảy ra khi người dùng thật sự lưu tuỳ chọn mới. */
		return map[string]json.RawMessage{}
	}
	return all
}

func (a *App) handleGetPreferences(w http.ResponseWriter, r *http.Request) {
	principal := principalFromContext(r.Context())
	if principal == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(a.preferences.Get(principal.Username))
}

func (a *App) handlePutPreferences(w http.ResponseWriter, r *http.Request) {
	principal := principalFromContext(r.Context())
	if principal == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	// Đọc dư một byte so với hạn mức để phân biệt "vừa đủ" với "vượt" — cắt ở
	// đúng hạn mức rồi báo hợp lệ là làm mất dữ liệu người dùng trong im lặng.
	body, err := io.ReadAll(io.LimitReader(r.Body, userPreferencesMaxBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if len(body) > userPreferencesMaxBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "preferences_too_large")
		return
	}
	var probe map[string]any
	if err := json.Unmarshal(body, &probe); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if err := a.preferences.Put(principal.Username, json.RawMessage(body)); err != nil {
		if errors.Is(err, errPreferencesTooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "preferences_too_large")
			return
		}
		writeError(w, http.StatusInternalServerError, "cannot store preferences")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"result": "ok"})
}

func (a *App) userPreferencesPath() string {
	if a == nil {
		return ""
	}
	dir := strings.TrimSpace(a.cfg.ConfigDir)
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, "user_preferences.json")
}
