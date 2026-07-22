package main

import (
	"errors"
	"os"
	"path/filepath"
)

const webVersion = "0.1.0-be-b6c"
const defaultAlarmSettingsConf = "/data/config/alarm_settings.conf"
const defaultAlarmHistoryFile = "/data/config/alarm_history.jsonl"

type Config struct {
	Addr             string
	Port             string
	JWTSecret        string
	UsersConf        string
	ConfigDir        string
	CorePidPath      string
	IobusPidPath     string
	CoreSock         string
	HMISock          string
	HMIAllowedUID    string
	HMIAuditPath     string
	TrendDBPath      string
	ScheduleConfPath string
	AlarmConfPath    string
	AlarmHistoryPath string
	StaticDir        string
	CORSOrigin       string
	WebVersion       string
}

func LoadConfig() (Config, error) {
	port := getenv("PORT", "8080")
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
		HMIAllowedUID:    os.Getenv("HMI_ALLOWED_UID"),
		HMIAuditPath:     getenv("HMI_AUDIT_FILE", "/data/config/hmi_audit.jsonl"),
		TrendDBPath:      getenv("TREND_DB", defaultTrendDBPath),
		ScheduleConfPath: getenv("SCHEDULE_CONF", filepath.Join(resolveConfigDir(), "schedule.conf")),
		AlarmConfPath:    getenv("ALARM_SETTINGS_CONF", defaultAlarmSettingsConf),
		AlarmHistoryPath: getenv("ALARM_HISTORY_FILE", defaultAlarmHistoryFile),
		StaticDir:        getenv("STATIC_DIR", "dist"),
		CORSOrigin:       os.Getenv("CORS_ORIGIN"),
		WebVersion:       getenv("WEB_VERSION", webVersion),
	}
	if cfg.JWTSecret == "" {
		return Config{}, errors.New("JWT_SECRET is required")
	}
	return cfg, nil
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
		filepath.FromSlash("services/web/config/users.conf"),
		"/data/config/users.conf",
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return filepath.FromSlash("config/users.conf")
}
