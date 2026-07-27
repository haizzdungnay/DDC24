package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestRBACUsersMigrationPreservesAccountsAndRollback(t *testing.T) {
	dir := t.TempDir()
	usersPath := filepath.Join(dir, "users.conf")
	backupPath := filepath.Join(dir, "users.pre-rbac.conf")
	original := legacyRBACUsersFixture(t)
	if err := os.WriteFile(usersPath, original, 0o600); err != nil {
		t.Fatal(err)
	}

	var migrationOutput bytes.Buffer
	if err := runRBACUsersMigrateCommand([]string{"--users", usersPath, "--backup", backupPath}, &migrationOutput); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	backup, err := os.ReadFile(backupPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(backup, original) {
		t.Fatal("backup does not exactly preserve the pre-migration file")
	}
	migrated, schema, err := validateRBACUsersFile(usersPath)
	if err != nil {
		t.Fatal(err)
	}
	if schema != usersSchemaVersion || len(migrated) != 4 {
		t.Fatalf("migrated schema/users = %s/%d", schema, len(migrated))
	}
	for username, user := range migrated {
		if user.SessionVersion != 1 {
			t.Fatalf("session version for %s = %d", username, user.SessionVersion)
		}
	}

	var rollbackOutput bytes.Buffer
	if err := runRBACUsersRollbackCommand([]string{"--users", usersPath, "--backup", backupPath}, &rollbackOutput); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	restored, err := os.ReadFile(usersPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(restored, original) {
		t.Fatal("rollback did not restore the exact pre-migration file")
	}

	for name, output := range map[string][]byte{"migration": migrationOutput.Bytes(), "rollback": rollbackOutput.Bytes()} {
		var evidence rbacUsersMigrationResult
		if err := json.Unmarshal(output, &evidence); err != nil {
			t.Fatalf("decode %s evidence: %v", name, err)
		}
		if evidence.UserCount != 4 || evidence.BackupPath == "" || evidence.UsersPath == "" {
			t.Fatalf("invalid %s evidence: %+v", name, evidence)
		}
	}
}

func TestRBACUsersMigrationFailsClosedBeforeOverwrite(t *testing.T) {
	dir := t.TempDir()
	usersPath := filepath.Join(dir, "users.conf")
	backupPath := filepath.Join(dir, "existing.backup")
	original := legacyRBACUsersFixture(t)
	if err := os.WriteFile(usersPath, original, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(backupPath, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := migrateRBACUsersFile(usersPath, backupPath); err == nil {
		t.Fatal("migration overwrote an existing backup")
	}
	current, err := os.ReadFile(usersPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(current, original) {
		t.Fatal("failed migration changed users.conf")
	}
}

func TestRBACUsersMigrationRestoresOriginalAfterVerificationFailure(t *testing.T) {
	dir := t.TempDir()
	usersPath := filepath.Join(dir, "users.conf")
	backupPath := filepath.Join(dir, "users.pre-rbac.conf")
	original := legacyRBACUsersFixture(t)
	if err := os.WriteFile(usersPath, original, 0o600); err != nil {
		t.Fatal(err)
	}

	corruptPublish := func(path string, _ []byte, perm os.FileMode) error {
		return writeConfigFileAtomicStrict(path, []byte(`{"truncated":`), perm)
	}
	if _, err := migrateRBACUsersFileWithWriter(usersPath, backupPath, corruptPublish); err == nil {
		t.Fatal("migration accepted a corrupt post-write file")
	}
	restored, err := os.ReadFile(usersPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(restored, original) {
		t.Fatal("verification failure did not restore the original users file")
	}
	backup, err := os.ReadFile(backupPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(backup, original) {
		t.Fatal("verification failure changed the rollback backup")
	}
}

func legacyRBACUsersFixture(t *testing.T) []byte {
	t.Helper()
	users := make([]map[string]string, 0, 4)
	for _, role := range []Role{RoleAdmin, RoleEngineer, RoleOperator, RoleViewer} {
		hash, err := bcrypt.GenerateFromPassword([]byte(string(role)+"-password"), bcrypt.MinCost)
		if err != nil {
			t.Fatal(err)
		}
		users = append(users, map[string]string{
			"username":  string(role),
			"role":      string(role),
			"pw_bcrypt": string(hash),
		})
	}
	data, err := json.MarshalIndent(map[string]any{"_schema_version": "1.0", "users": users}, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	return append(data, '\n')
}
