package app

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

var timeOperationIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`)

type TimeService interface {
	Status(context.Context, ConfigTime) (TimeStatus, error)
	Apply(context.Context, ConfigTime) ([]string, error)
}

type timeOperationJournal struct {
	OperationID string          `json:"operationId"`
	RequestHash string          `json:"requestHash"`
	State       string          `json:"state"`
	HTTPStatus  int             `json:"httpStatus"`
	Result      ConfigPutResult `json:"result"`
}

func defaultTimeConfig() ConfigTime {
	return ConfigTime{Timezone: "UTC", NTPEnabled: true, NTPServers: []string{"pool.ntp.org"}, Revision: 1}
}

func (a *App) readTimeConfig() (ConfigTime, error) {
	cfg, err := readConfig(a, configGroupTime, defaultTimeConfig())
	if err != nil {
		return ConfigTime{}, err
	}
	if cfg.Revision == 0 {
		cfg.Revision = 1
	}
	if cfg.NTPServers == nil {
		cfg.NTPServers = []string{}
	}
	return cfg, nil
}

func (a *App) handleGetTimeStatus(w http.ResponseWriter, r *http.Request) {
	cfg, err := a.readTimeConfig()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read time configuration failed")
		return
	}
	status, err := a.time.Status(r.Context(), cfg)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "read system time status failed")
		return
	}
	if status.Warnings == nil {
		status.Warnings = []string{}
	}
	writeJSON(w, http.StatusOK, status)
}

var timeMutationMu sync.Mutex

func (a *App) handlePutTimeConfig(w http.ResponseWriter, r *http.Request) {
	var update ConfigTimeUpdate
	if err := decodeStrictConfigBody(w, r, &update); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	candidate := ConfigTime{
		Timezone: strings.TrimSpace(update.Timezone), NTPEnabled: update.NTPEnabled,
		NTPServers: normalizeNTPServers(update.NTPServers), SystemTime: strings.TrimSpace(update.SystemTime),
	}
	if errs := validateTimeUpdate(candidate, update.OperationID); len(errs) > 0 {
		writeValidationErrors(w, errs)
		return
	}
	timeMutationMu.Lock()
	defer timeMutationMu.Unlock()
	requestHash, err := hashTimeUpdate(update)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash time configuration failed")
		return
	}
	journal, journalExists, err := a.readTimeOperationJournal()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read time operation journal failed")
		return
	}
	if journalExists && journal.OperationID == update.OperationID {
		if journal.RequestHash != requestHash {
			writeJSON(w, http.StatusConflict, map[string]any{"error": "operation ID already used with different request", "code": http.StatusConflict})
			return
		}
		if journal.State == "completed" {
			writeJSON(w, journal.HTTPStatus, journal.Result)
			return
		}
	}
	if journalExists && journal.State != "completed" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "time operation recovery required", "code": http.StatusServiceUnavailable, "operationId": journal.OperationID, "state": journal.State})
		return
	}
	current, err := a.readTimeConfig()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read time configuration failed")
		return
	}
	if update.BaseRevision != current.Revision {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "time configuration revision conflict", "code": http.StatusConflict, "revision": current.Revision})
		return
	}
	journal = timeOperationJournal{OperationID: update.OperationID, RequestHash: requestHash, State: "staged", HTTPStatus: http.StatusInternalServerError, Result: ConfigPutResult{Result: "failed", Applied: false, Reload: reloadSystem, Warnings: []string{}}}
	if err := a.writeTimeOperationJournal(journal); err != nil {
		writeError(w, http.StatusInternalServerError, "persist time operation intent failed")
		return
	}
	warnings, err := a.time.Apply(r.Context(), candidate)
	if err != nil {
		journal.State = "completed"
		_ = a.writeTimeOperationJournal(journal)
		a.auditTimeChange(r, update.OperationID, "failed")
		writeError(w, http.StatusInternalServerError, "apply system time configuration failed")
		return
	}
	journal.State = "os_applied"
	journal.Result.Applied = true
	journal.Result.Warnings = warnings
	if err := a.writeTimeOperationJournal(journal); err != nil {
		a.auditTimeChange(r, update.OperationID, "recovery_required")
		writeError(w, http.StatusInternalServerError, "system time applied but operation journal update failed")
		return
	}
	candidate.SystemTime = ""
	candidate.Revision = current.Revision + 1
	if _, err := a.writeConfigGroup(r, configAPIGroup{key: configGroupTime.key, file: configGroupTime.file, reload: reloadNone}, candidate); err != nil {
		a.auditTimeChange(r, update.OperationID, "partially_applied")
		writeError(w, http.StatusInternalServerError, "system time applied but configuration persistence failed")
		return
	}
	journal.State = "completed"
	journal.HTTPStatus = http.StatusOK
	journal.Result = ConfigPutResult{Result: "success", Applied: true, Reload: reloadSystem, Warnings: warnings}
	if err := a.writeTimeOperationJournal(journal); err != nil {
		a.auditTimeChange(r, update.OperationID, "recovery_required")
		writeError(w, http.StatusInternalServerError, "configuration committed but operation journal completion failed")
		return
	}
	a.auditTimeChange(r, update.OperationID, "success")
	writeJSON(w, http.StatusOK, journal.Result)
}

func hashTimeUpdate(update ConfigTimeUpdate) (string, error) {
	data, err := json.Marshal(update)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(data)
	return fmt.Sprintf("%x", digest[:]), nil
}

func (a *App) timeOperationJournalPath() string {
	return filepath.Join(a.cfg.ConfigDir, "time_operation.json")
}

func (a *App) readTimeOperationJournal() (timeOperationJournal, bool, error) {
	var journal timeOperationJournal
	err := readConfigJSON(a.timeOperationJournalPath(), &journal)
	if errors.Is(err, ErrConfigMissing) {
		return timeOperationJournal{}, false, nil
	}
	if err != nil {
		return timeOperationJournal{}, false, err
	}
	if journal.OperationID == "" || journal.RequestHash == "" || (journal.State != "staged" && journal.State != "os_applied" && journal.State != "completed") {
		return timeOperationJournal{}, false, fmt.Errorf("invalid time operation journal")
	}
	return journal, true, nil
}

func (a *App) writeTimeOperationJournal(journal timeOperationJournal) error {
	data, err := json.MarshalIndent(journal, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(a.cfg.ConfigDir, 0o755); err != nil {
		return err
	}
	return writeConfigFileAtomic(a.timeOperationJournalPath(), append(data, '\n'), 0o600)
}

func (a *App) auditTimeChange(r *http.Request, operationID, result string) {
	user := "-"
	if principal := principalFromContext(r.Context()); principal != nil {
		user = principal.Username
	}
	a.audit.Change(user, "config.time", operationID, result, r.RemoteAddr)
}

func validateTimeUpdate(cfg ConfigTime, operationID string) []configValidationError {
	errList := validateConfigTime(cfg)
	if _, err := time.LoadLocation(cfg.Timezone); cfg.Timezone == "" || err != nil {
		addConfigErr(&errList, "timezone", "must be a valid IANA timezone")
	}
	if !timeOperationIDPattern.MatchString(operationID) {
		addConfigErr(&errList, "operation_id", "must be 1..64 safe characters")
	}
	if cfg.NTPEnabled {
		if len(cfg.NTPServers) < 1 || len(cfg.NTPServers) > 4 {
			addConfigErr(&errList, "ntp_servers", "must contain 1..4 servers when NTP is enabled")
		}
		if cfg.SystemTime != "" {
			addConfigErr(&errList, "system_time", "must be empty when NTP is enabled")
		}
	}
	for i, server := range cfg.NTPServers {
		if !validNTPServer(server) {
			addConfigErr(&errList, fmt.Sprintf("ntp_servers[%d]", i), "must be a valid hostname or IP address")
		}
	}
	return errList
}

func normalizeNTPServers(servers []string) []string {
	result := make([]string, 0, len(servers))
	seen := map[string]struct{}{}
	for _, raw := range servers {
		server := strings.TrimSpace(raw)
		key := strings.ToLower(server)
		if _, ok := seen[key]; server == "" || ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, server)
	}
	return result
}

func validNTPServer(value string) bool {
	if len(value) == 0 || len(value) > 253 {
		return false
	}
	if net.ParseIP(value) != nil {
		return true
	}
	for _, label := range strings.Split(value, ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, ch := range label {
			if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-') {
				return false
			}
		}
	}
	return true
}

func decodeStrictConfigBody[T any](w http.ResponseWriter, r *http.Request, dst *T) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return errors.New("invalid json")
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return errors.New("invalid json")
	}
	return nil
}
