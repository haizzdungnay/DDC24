package app

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const historianMaintenanceConfirmation = "ACTIVATE-HISTORIAN-V2"

type historianMaintenanceCLIOptions struct {
	ManifestPath      string
	FinalManifestPath string
	BackupPath        string
	StableUTCMS       int64
	WindowID          string
	Confirm           string
	Timeout           time.Duration
}

func parseHistorianMaintenanceCLI(args []string) (historianMaintenanceCLIOptions, error) {
	var opts historianMaintenanceCLIOptions
	flags := flag.NewFlagSet("historian-maintenance", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&opts.ManifestPath, "manifest", "", "immutable migration manifest template")
	flags.StringVar(&opts.FinalManifestPath, "final-manifest", "", "new immutable final manifest output")
	flags.StringVar(&opts.BackupPath, "backup", "", "final native backup output")
	flags.StringVar(&opts.WindowID, "window-id", "", "unique maintenance window/migration id")
	flags.StringVar(&opts.Confirm, "confirm", "", "exact activation confirmation")
	flags.DurationVar(&opts.Timeout, "timeout", 30*time.Minute, "maximum maintenance duration")
	var stable string
	flags.StringVar(&stable, "stable-utc", "", "stable UTC RFC3339 or positive Unix milliseconds")
	if err := flags.Parse(args); err != nil {
		return opts, err
	}
	if flags.NArg() != 0 {
		return opts, fmt.Errorf("unexpected positional arguments")
	}
	if opts.ManifestPath == "" || opts.FinalManifestPath == "" || opts.BackupPath == "" || opts.WindowID == "" {
		return opts, fmt.Errorf("manifest, final-manifest, backup and window-id are required")
	}
	if opts.Confirm != historianMaintenanceConfirmation {
		return opts, fmt.Errorf("exact --confirm %q is required", historianMaintenanceConfirmation)
	}
	if !safeMaintenanceID(opts.WindowID) {
		return opts, fmt.Errorf("invalid maintenance window id")
	}
	if opts.Timeout < time.Second || opts.Timeout > 30*time.Minute {
		return opts, fmt.Errorf("timeout must be between 1s and 30m")
	}
	parsed, err := parseMaintenanceUTC(stable)
	if err != nil {
		return opts, err
	}
	opts.StableUTCMS = parsed
	return opts, nil
}

func runHistorianMaintenanceCommand(args []string, stdout, stderr io.Writer) error {
	opts, err := parseHistorianMaintenanceCLI(args)
	if err != nil {
		return err
	}
	cfg, err := LoadConfig()
	if err != nil {
		return err
	}
	manifest, err := ReadMigrationManifest(opts.ManifestPath)
	if err != nil {
		return fmt.Errorf("read migration manifest: %w", err)
	}
	if err := validateHistorianMaintenancePreflight(cfg, opts, manifest); err != nil {
		return err
	}
	policyPath := filepath.Join(cfg.ConfigDir, "historian.conf")
	policy, err := os.ReadFile(policyPath)
	if err != nil {
		return fmt.Errorf("read historian policy: %w", err)
	}
	app, err := NewApp(cfg, log.New(stderr, "historian-maintenance ", log.LstdFlags|log.LUTC), nil, nil)
	if err != nil {
		return err
	}
	defer app.Close()
	if app.historianAuthority.State != "legacy" || !app.historianAuthority.LegacyWriterAllowed || app.historianAuthority.WriterV2 {
		return fmt.Errorf("historian authority is not in a fresh legacy state; use forward recovery instead of a new cutover")
	}
	ctx, cancel := context.WithTimeout(context.Background(), opts.Timeout)
	defer cancel()
	result, err := app.RunHistorianMaintenanceCutover(ctx, HistorianMaintenanceRequest{Manifest: manifest, ManifestPath: opts.FinalManifestPath, PolicyConfig: policy, BackupPath: opts.BackupPath, StableUTCMS: opts.StableUTCMS})
	if err != nil {
		return err
	}
	_, _ = fmt.Fprintf(stdout, "{\"activated\":%t,\"migrationId\":%q,\"backup\":%q,\"gaps\":%d,\"quiesceEpoch\":%d}\n", result.Activated, result.Manifest.MigrationID, result.Backup.Path, result.MaintenanceGaps, result.Quiesce.Epoch)
	return nil
}

func validateHistorianMaintenancePreflight(cfg Config, opts historianMaintenanceCLIOptions, manifest MigrationManifest) error {
	if lockPath := filepath.Join(cfg.ConfigDir, "mkddc-web.running"); fileExists(lockPath) {
		return fmt.Errorf("web service presence lock exists; stop mkddc-web before offline maintenance")
	}
	migrationRoot := filepath.Join(cfg.ConfigDir, "historian-v2-migration")
	if !pathWithin(migrationRoot, opts.BackupPath) || !pathWithin(migrationRoot, opts.FinalManifestPath) {
		return fmt.Errorf("backup and final-manifest must stay under historian-v2-migration")
	}
	if manifest.MigrationID != opts.WindowID {
		return fmt.Errorf("window-id must match manifest migrationId")
	}
	return nil
}

func parseMaintenanceUTC(value string) (int64, error) {
	if milliseconds, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64); err == nil {
		if milliseconds > 0 {
			return milliseconds, nil
		}
	}
	parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(value))
	if err != nil {
		return 0, fmt.Errorf("stable-utc must be RFC3339 UTC or positive Unix milliseconds")
	}
	_, offset := parsed.Zone()
	if offset != 0 || parsed.UnixMilli() <= 0 {
		return 0, fmt.Errorf("stable-utc must be UTC and positive")
	}
	return parsed.UnixMilli(), nil
}

func safeMaintenanceID(value string) bool {
	if len(value) == 0 || len(value) > 64 {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			continue
		}
		return false
	}
	return true
}

func pathWithin(root, candidate string) bool {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	absCandidate, err := filepath.Abs(candidate)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(absRoot, absCandidate)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false
	}
	return true
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func createServicePresenceFile(path string) (func(), error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	if _, err := fmt.Fprintf(file, "%d\n", os.Getpid()); err != nil {
		file.Close()
		return nil, err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return nil, err
	}
	if err := file.Close(); err != nil {
		return nil, err
	}
	if err := syncDirectory(filepath.Dir(path)); err != nil {
		return nil, err
	}
	return func() {
		_ = os.Remove(path)
		_ = syncDirectory(filepath.Dir(path))
	}, nil
}
