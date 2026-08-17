package app

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

// Bug 2026-08-17: AutoBootstrapSingleNode chỉ chạy MỘT LẦN — khi state=="legacy"
// lúc boot. Trên board single-node đã tự kích hoạt v2, MỌI lần sửa historian
// policy sau đó (vd bật "ghi lịch sử" cho một điểm) làm revision tăng lên mà
// historian_activation trong SQLite vẫn kẹt ở revision cũ — Authority() phát
// hiện lệch (`payload.Revision != authority.PolicyRevision`) và tự degrade
// VĨNH VIỄN cả WriterV2 lẫn QueryV2, dù dữ liệu ghi hoàn toàn bình thường.
// Domain "historian" ở /api/v1/overview báo DEGRADED và Trends báo "historian
// v2 query unavailable" — xác nhận trực tiếp trên board Foxlinx: revision
// sống là 4, historian_activation.policy_revision còn kẹt ở 1.
func TestAutoBootstrapSingleNodeReconcilesAfterOrdinaryPolicyEdit(t *testing.T) {
	store := openHistorianStoreTest(t)
	coordinator := NewHistorianActivationCoordinator(filepath.Join(t.TempDir(), "historian.conf"), store)
	ctx := context.Background()

	rev1 := []byte(`{"_schema_version":1,"revision":1,"points":[]}`)
	if err := coordinator.AutoBootstrapSingleNode(ctx, rev1); err != nil {
		t.Fatalf("bootstrap rev1: %v", err)
	}
	authority, err := coordinator.Authority(ctx)
	if err != nil || !authority.WriterV2 || !authority.QueryV2 || authority.PolicyRevision != 1 {
		t.Fatalf("after bootstrap rev1: authority=%+v err=%v", authority, err)
	}

	// Mô phỏng thao tác đời thường: user bật "ghi lịch sử" cho một điểm qua
	// UI — HistorianPolicyService.Update() bump revision, KHÔNG đi qua lại
	// Prepare/Commit thủ công.
	rev2 := []byte(`{"_schema_version":1,"revision":2,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"15s","retentionDays":30,"hotCacheEnabled":true,"hotCacheHours":48,"startAtUtc":"2026-08-17T00:00:00Z"}]}`)
	if err := coordinator.AutoBootstrapSingleNode(ctx, rev2); err != nil {
		t.Fatalf("reconcile rev2: %v", err)
	}
	authority, err = coordinator.Authority(ctx)
	if err != nil {
		t.Fatalf("authority after rev2: %v", err)
	}
	if !authority.WriterV2 || !authority.QueryV2 {
		t.Fatalf("historian phải tự đồng bộ lại (WriterV2/QueryV2=true) sau khi policy đổi, không được degrade: %+v", authority)
	}
	if authority.PolicyRevision != 2 {
		t.Fatalf("authority.PolicyRevision = %d, want 2 (phải bám theo revision sống mới nhất)", authority.PolicyRevision)
	}

	// Gọi lại với ĐÚNG revision hiện hành phải là no-op (không lỗi, không đổi
	// gì thêm) — tránh ghi DB thừa mỗi lần Get() vô hại được gọi.
	if err := coordinator.AutoBootstrapSingleNode(ctx, rev2); err != nil {
		t.Fatalf("no-op re-call with same revision: %v", err)
	}
	authority, err = coordinator.Authority(ctx)
	if err != nil || !authority.WriterV2 || authority.PolicyRevision != 2 {
		t.Fatalf("authority after no-op re-call: %+v err=%v", authority, err)
	}
}

// Bug 2026-08-17 (biến thể phát hiện SAU KHI deploy lần đầu lên board
// Foxlinx thật): board đã tự bootstrap bằng code TRƯỚC bản vá này, vốn dùng
// migration_id CỐ ĐỊNH "bootstrap-single-node" cho mọi revision (không có
// hậu tố "-rev-N" như bản vá). Lineage guard ban đầu chỉ nhận diện tiền tố
// mới nên coi board này là "lineage lạ" và không bao giờ tự đồng bộ lại —
// domain historian vẫn DEGRADED sau khi deploy bản vá + restart, y hệt hiện
// tượng trước khi vá. Xác nhận trực tiếp: `sqlite3 historian-v2.sqlite
// "SELECT migration_id FROM historian_cutover_evidence WHERE singleton=1"`
// trên board trả về đúng "bootstrap-single-node" (không có hậu tố).
func TestAutoBootstrapSingleNodeRecognizesPreFixLegacyLineage(t *testing.T) {
	store := openHistorianStoreTest(t)
	coordinator := NewHistorianActivationCoordinator(filepath.Join(t.TempDir(), "historian.conf"), store)
	ctx := context.Background()

	rev1 := []byte(`{"_schema_version":1,"revision":1,"points":[]}`)
	if err := coordinator.AutoBootstrapSingleNode(ctx, rev1); err != nil {
		t.Fatalf("bootstrap rev1: %v", err)
	}
	oldID := "bootstrap-single-node-rev-1"
	if oldID != historianBootstrapSingleNodeMigrationIDPrefix+"1" {
		t.Fatalf("sanity: prefix constant đã đổi, cập nhật lại test — got %q", historianBootstrapSingleNodeMigrationIDPrefix)
	}
	// Mô phỏng lại đúng dấu vết mà code TRƯỚC bản vá để lại: một dòng
	// migration_runs/evidence/quiesce mang migration_id cố định (không hậu
	// tố revision) — clone dòng hiện có sang ID cũ rồi xoá dòng mới, giữ FK
	// hợp lệ ở mọi bước trung gian (không update PK tại chỗ để tránh vướng
	// ON DELETE RESTRICT).
	if _, err := store.db.ExecContext(ctx, `INSERT INTO migration_runs(migration_id,source_identity,source_sha256,namespace_revision,manifest_json,manifest_sha256,phase,cursor_json,backup_path,created_at_utc_ms,updated_at_utc_ms) SELECT ?,source_identity,source_sha256,namespace_revision,manifest_json,manifest_sha256,phase,cursor_json,backup_path,created_at_utc_ms,updated_at_utc_ms FROM migration_runs WHERE migration_id=?`, historianBootstrapSingleNodeMigrationIDLegacy, oldID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE historian_cutover_evidence SET migration_id=? WHERE singleton=1`, historianBootstrapSingleNodeMigrationIDLegacy); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE historian_legacy_quiesce SET migration_id=? WHERE singleton=1`, historianBootstrapSingleNodeMigrationIDLegacy); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `DELETE FROM migration_runs WHERE migration_id=?`, oldID); err != nil {
		t.Fatal(err)
	}
	var lineage string
	if err := store.db.QueryRowContext(ctx, `SELECT migration_id FROM historian_cutover_evidence WHERE singleton=1`).Scan(&lineage); err != nil || lineage != historianBootstrapSingleNodeMigrationIDLegacy {
		t.Fatalf("test setup sai: lineage=%q err=%v, want %q", lineage, err, historianBootstrapSingleNodeMigrationIDLegacy)
	}

	// Policy đổi (đúng kịch bản: user bật "ghi lịch sử" cho một điểm) — board
	// mang lineage CŨ này vẫn phải tự đồng bộ lại được, không được coi là
	// "lineage lạ" rồi bỏ qua.
	rev2 := []byte(`{"_schema_version":1,"revision":2,"points":[]}`)
	if err := coordinator.AutoBootstrapSingleNode(ctx, rev2); err != nil {
		t.Fatalf("reconcile rev2 với lineage cũ: %v", err)
	}
	authority, err := coordinator.Authority(ctx)
	if err != nil || !authority.WriterV2 || !authority.QueryV2 {
		t.Fatalf("board bootstrap bởi code CŨ (lineage %q) phải vẫn tự đồng bộ lại được, không kẹt DEGRADED: %+v err=%v", historianBootstrapSingleNodeMigrationIDLegacy, authority, err)
	}
	if authority.PolicyRevision != 2 {
		t.Fatalf("authority.PolicyRevision = %d, want 2", authority.PolicyRevision)
	}
}

// AutoBootstrapSingleNode không được tự ý đè lên bằng chứng của một cutover
// THẬT (không phải lineage "bootstrap-single-node" tự sinh) — bảo toàn hành
// vi fail-closed hiện hữu (TestHistorianActivationUsesVerifiedEvidenceInsteadOfBoolean)
// cho một migration đa-node nghiêm ngặt. Ceremony dựng backup/manifest/quiesce
// thật mượn nguyên từ test đó để evidence verify được (đọc file thật, so
// checksum), không rút gọn giả.
func TestAutoBootstrapSingleNodeDoesNotTouchForeignCutoverLineage(t *testing.T) {
	store := openHistorianStoreTest(t)
	dir := t.TempDir()
	legacyPath := filepath.Join(dir, "legacy.sqlite")
	legacy, err := sql.Open("sqlite", legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	legacy.SetMaxOpenConns(1)
	legacy.SetMaxIdleConns(1)
	t.Cleanup(func() { _ = legacy.Close() })
	if _, err := legacy.Exec(`CREATE TABLE samples(ts INTEGER, point_id TEXT, value REAL, quality INTEGER); INSERT INTO samples VALUES(1000,'UI-01',2.5,0)`); err != nil {
		t.Fatal(err)
	}
	backupPath := filepath.Join(dir, "legacy-backup.sqlite")
	backup, err := CreateNativeSQLiteBackup(context.Background(), legacy, backupPath, 1)
	if err != nil {
		t.Fatal(err)
	}
	config := []byte(`{"_schema_version":1,"revision":1,"points":[{"pointId":"UI-01","generation":1,"dbLoggingEnabled":true,"dbInterval":"15s","retentionDays":180,"hotCacheEnabled":true,"hotCacheHours":48,"startAtUtc":"2026-07-20T10:00:00Z"}]}`)
	if err := store.MirrorPolicy(context.Background(), config, 1, 1); err != nil {
		t.Fatal(err)
	}
	manifest := MigrationManifest{
		MigrationID: "real-cutover-m1", SourceIdentity: backup.SourceIdentity,
		SourceSHA256: backup.SHA256, NamespaceRevision: 1,
		PolicyRevision: 1, SchemaID: "hist-v1", SourceRowCount: 1,
		TimestampRuleVersion: 1, AliasRuleVersion: 1,
		Mappings: []MigrationMapping{{LegacyStorageID: "UI-01", CanonicalPointID: "UI-01", Generation: 1}},
	}
	if err := store.ApplyLegacyMigrationChunk(context.Background(), manifest, []LegacySampleRow{{TS: 1000, PointID: "UI-01", Value: 2.5, Quality: 0}}, 1, true); err != nil {
		t.Fatal(err)
	}
	var token [32]byte
	token[0] = 7
	proof, err := store.RecordLegacyHistorianQuiesce(context.Background(), token, legacyPath, 2)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RecordHistorianCutoverEvidenceWithQuiesce(context.Background(), manifest.MigrationID, backup, proof, 2); err != nil {
		t.Fatal(err)
	}
	policyPath := filepath.Join(dir, "historian.conf")
	coordinator := NewHistorianActivationCoordinator(policyPath, store)
	ctx := context.Background()
	if err := coordinator.Prepare(ctx, HistorianActivationPlan{PolicyRevision: 1, Config: config, StableUTCMS: 1, LegacyQuiesced: true, MigrationVerified: false}); err != nil {
		t.Fatalf("prepare real cutover: %v", err)
	}
	if err := coordinator.Commit(ctx); err != nil {
		t.Fatalf("commit real cutover: %v", err)
	}
	authority, err := coordinator.Authority(ctx)
	if err != nil || !authority.WriterV2 || !authority.QueryV2 {
		t.Fatalf("real cutover should be active: %+v err=%v", authority, err)
	}

	// Policy đổi (rev2) trong lúc lineage vẫn là cutover thật — AutoBootstrapSingleNode
	// phải là no-op, KHÔNG được tự đè "bootstrap-single-node" lên bằng chứng thật.
	rev2 := []byte(`{"_schema_version":1,"revision":2,"points":[]}`)
	if err := coordinator.AutoBootstrapSingleNode(ctx, rev2); err != nil {
		t.Fatalf("no-op on foreign lineage should not error: %v", err)
	}
	var lineage string
	if err := store.db.QueryRowContext(ctx, `SELECT migration_id FROM historian_cutover_evidence WHERE singleton=1`).Scan(&lineage); err != nil {
		t.Fatal(err)
	}
	if lineage != manifest.MigrationID {
		t.Fatalf("lineage bị AutoBootstrapSingleNode ghi đè: got %q, want giữ nguyên %q", lineage, manifest.MigrationID)
	}
	authority, err = coordinator.Authority(ctx)
	if err != nil || !authority.WriterV2 || !authority.QueryV2 || authority.PolicyRevision != 1 {
		t.Fatalf("real cutover authority phải giữ nguyên rev1, không bị AutoBootstrapSingleNode đụng vào: %+v err=%v", authority, err)
	}
}
