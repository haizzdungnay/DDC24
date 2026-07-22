package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"flag"
	"fmt"
	"io"
	"net/url"
	"path/filepath"
)

type HistorianRollbackCompatibility struct {
	SchemaVersion       int
	QuickCheck          string
	State               string
	PolicyRevision      uint64
	WriterV2            bool
	QueryV2             bool
	PruneEnabled        bool
	LegacyWriterAllowed bool
	EvidenceBound       bool
}

func runHistorianRollbackVerifyCommand(args []string, stdout io.Writer) error {
	flags := flag.NewFlagSet("historian-rollback-verify", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	var path string
	flags.StringVar(&path, "db", "", "schema-v5 historian fixture")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 || path == "" {
		return fmt.Errorf("exactly --db <fixture> is required")
	}
	result, err := VerifyHistorianRollbackCompatibility(context.Background(), path)
	if err != nil {
		return err
	}
	_, _ = fmt.Fprintf(stdout, "{\"schemaVersion\":%d,\"quickCheck\":%q,\"state\":%q,\"writerV2\":%t,\"queryV2\":%t,\"legacyWriterAllowed\":%t,\"evidenceBound\":%t}\n", result.SchemaVersion, result.QuickCheck, result.State, result.WriterV2, result.QueryV2, result.LegacyWriterAllowed, result.EvidenceBound)
	return nil
}

// VerifyHistorianRollbackCompatibility opens the fixture read-only. It never
// runs schema migrations or activation reconciliation.
func VerifyHistorianRollbackCompatibility(ctx context.Context, path string) (HistorianRollbackCompatibility, error) {
	var result HistorianRollbackCompatibility
	if path == "" {
		return result, fmt.Errorf("historian rollback fixture path is required")
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return result, err
	}
	// immutable prevents SQLite from creating -wal/-shm sidecars while the
	// packaged rollback gate proves that frozen fixtures remain byte-identical.
	dsn := (&url.URL{Scheme: "file", Opaque: filepath.ToSlash(absPath), RawQuery: url.Values{"mode": {"ro"}, "immutable": {"1"}, "_pragma": {"query_only(1)", "trusted_schema(0)"}}.Encode()}).String()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return result, err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err := db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&result.SchemaVersion); err != nil {
		return result, fmt.Errorf("read rollback schema version: %w", err)
	}
	if result.SchemaVersion != historianSchemaVersion {
		return result, fmt.Errorf("rollback binary supports historian schema %d, fixture is %d", historianSchemaVersion, result.SchemaVersion)
	}
	if err := db.QueryRowContext(ctx, `PRAGMA quick_check`).Scan(&result.QuickCheck); err != nil || result.QuickCheck != "ok" {
		return result, fmt.Errorf("rollback fixture quick_check=%q: %w", result.QuickCheck, err)
	}
	for _, table := range []string{"policy_revisions", "migration_runs", "historian_activation", "historian_cutover_evidence", "historian_legacy_quiesce"} {
		var exists int
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&exists); err != nil || exists != 1 {
			return result, fmt.Errorf("rollback fixture missing table %s", table)
		}
	}
	var digest []byte
	var writer string
	var legacyQuiesced, migrationVerified, pruneEnabled int
	err = db.QueryRowContext(ctx, `SELECT state,policy_revision,config_sha256,writer_authority,legacy_quiesced,migration_verified,prune_enabled FROM historian_activation WHERE singleton=1`).Scan(&result.State, &result.PolicyRevision, &digest, &writer, &legacyQuiesced, &migrationVerified, &pruneEnabled)
	if err == sql.ErrNoRows {
		result.State = "legacy"
		result.LegacyWriterAllowed = true
		return result, nil
	}
	if err != nil {
		return result, fmt.Errorf("read rollback activation marker: %w", err)
	}
	if result.State == "prepared" {
		result.LegacyWriterAllowed = true
		return result, nil
	}
	if result.State != "active" || writer != "v2" || legacyQuiesced != 1 || migrationVerified != 1 || len(digest) != sha256.Size {
		return result, fmt.Errorf("rollback activation marker is not safely active")
	}
	var evidence int
	err = db.QueryRowContext(ctx, `SELECT count(*) FROM historian_cutover_evidence e JOIN migration_runs m ON m.migration_id=e.migration_id JOIN policy_revisions p ON p.revision=e.policy_revision JOIN historian_legacy_quiesce q ON q.epoch=e.quiesce_epoch AND q.token_sha256=e.quiesce_token_sha256 WHERE e.singleton=1 AND e.policy_revision=? AND e.policy_sha256=? AND m.phase='verified' AND m.manifest_sha256=e.manifest_sha256 AND m.source_sha256=e.backup_sha256 AND p.config_sha256=e.policy_sha256 AND p.mirror_status='verified' AND q.state='consumed' AND q.migration_id=e.migration_id`, result.PolicyRevision, digest).Scan(&evidence)
	if err != nil || evidence != 1 {
		return result, fmt.Errorf("rollback fixture active marker has no exact durable evidence")
	}
	result.WriterV2 = true
	result.QueryV2 = true
	result.PruneEnabled = pruneEnabled == 1
	result.EvidenceBound = true
	return result, nil
}
