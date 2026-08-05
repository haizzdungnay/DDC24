package app

import (
	"errors"
	"os"
	"path/filepath"
)

const webVersion = "0.1.0-be-b6c"

var buildVersion = webVersion
var buildGitCommit = "unknown"
var buildTime = "unknown"
var buildToolchain = "unknown"

const defaultAlarmSettingsConf = "/data/config/alarm_settings.conf"
const defaultAlarmHistoryFile = "/data/config/alarm_history.jsonl"

type Config struct {
	Addr                    string
	Port                    string
	JWTSecret               string
	UsersConf               string
	ConfigDir               string
	CorePidPath             string
	IobusPidPath            string
	CoreSock                string
	HMISock                 string
	NetcfgSock              string
	HMIAllowedUID           string
	HMIAuditPath            string
	TrendDBPath             string
	HistorianV2DBPath       string
	HistorianV2ArchiveDir   string
	HistorianV2MigrationDir string
	ScheduleConfPath        string
	AlarmConfPath           string
	AlarmHistoryPath        string
	StaticDir               string
	CORSOrigin              string
	WebVersion              string
}

func LoadConfig() (Config, error) {
	// 8081 là cổng của mkddc-web ở MỌI nơi khác trong dự án: `Environment=PORT=8081`
	// của `platform/systemd/mkddc-web-pi.service`, health check trong
	// `tools/deploy/deploy_board.sh`, `BASE` mặc định của `tools/qa/network_board_e2e.sh`,
	// tunnel trong `apps/web-ui/playwright.board.config.ts`, và `VITE_PROXY_TARGET`
	// mặc định trong `apps/web-ui/vite.config.ts`.
	//
	// Mặc định cũ 8080 chỉ tồn tại ở đây, nên `go run ./cmd/mkddc-web` không set
	// PORT sẽ nghe 8080 trong khi vite dev proxy gõ 8081 — mọi endpoint 502 và
	// người chạy tưởng frontend hỏng. Xem
	// `docs/07_records/reviews/FE_PAGES_ERROR_REVIEW_2026-08-05.md` §6.
	// Board không bị ảnh hưởng: systemd vẫn set PORT tường minh.
	port := getenv("PORT", "8081")
	cfg := Config{
		Addr:             ":" + port,
		Port:             port,
		JWTSecret:        os.Getenv("JWT_SECRET"),
		UsersConf:        getenv("USERS_CONF", defaultUsersConf()),
		ConfigDir:        resolveConfigDir(),
		CorePidPath:      getenv("CORE_PID", "/run/mkddc/core.pid"),
		IobusPidPath:     getenv("IOBUS_PID", "/run/mkddc/iobus.pid"),
		CoreSock:         getenv("CORE_SOCK", "/run/mkddc/core.sock"),
		HMISock:          getenv("HMI_SOCK", "/run/mkddc/hmi-api.sock"),
		NetcfgSock:       getenv("NETCFG_SOCK", "/run/mkddc-netcfg/netcfg.sock"),
		HMIAllowedUID:    os.Getenv("HMI_ALLOWED_UID"),
		HMIAuditPath:     getenv("HMI_AUDIT_FILE", "/data/config/hmi_audit.jsonl"),
		TrendDBPath:      getenv("TREND_DB", defaultTrendDBPath),
		ScheduleConfPath: getenv("SCHEDULE_CONF", filepath.Join(resolveConfigDir(), "schedule.conf")),
		AlarmConfPath:    getenv("ALARM_SETTINGS_CONF", defaultAlarmSettingsConf),
		AlarmHistoryPath: getenv("ALARM_HISTORY_FILE", defaultAlarmHistoryFile),
		StaticDir:        getenv("STATIC_DIR", "dist"),
		CORSOrigin:       os.Getenv("CORS_ORIGIN"),
		WebVersion:       getenv("WEB_VERSION", buildVersion),
	}
	if cfg.JWTSecret == "" {
		return Config{}, errors.New("JWT_SECRET is required")
	}
	cfg.deriveHistorianV2Paths()
	return cfg, nil
}

func (c *Config) deriveHistorianV2Paths() {
	if c.ConfigDir == "" {
		return
	}
	if c.HistorianV2DBPath == "" {
		c.HistorianV2DBPath = filepath.Join(c.ConfigDir, "historian-v2.sqlite")
	}
	if c.HistorianV2ArchiveDir == "" {
		c.HistorianV2ArchiveDir = filepath.Join(c.ConfigDir, "historian-v2-archive")
	}
	if c.HistorianV2MigrationDir == "" {
		c.HistorianV2MigrationDir = filepath.Join(c.ConfigDir, "historian-v2-migration")
	}
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func defaultUsersConf() string {
	candidates := []string{
		filepath.FromSlash("config/users.conf"),
		filepath.FromSlash("apps/web-api/config/users.conf"),
		"/data/config/users.conf",
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return filepath.FromSlash("config/users.conf")
}
