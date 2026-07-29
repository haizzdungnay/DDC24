package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"

	"golang.org/x/crypto/bcrypt"
)

type rbacUsersMigrationResult struct {
	Action        string `json:"action"`
	UsersPath     string `json:"users_path"`
	BackupPath    string `json:"backup_path"`
	SchemaVersion string `json:"schema_version"`
	UserCount     int    `json:"user_count"`
}

func runRBACUsersMigrateCommand(args []string, output io.Writer) error {
	flags := flag.NewFlagSet("rbac-users-migrate", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	usersPath := flags.String("users", "", "path to users.conf")
	backupPath := flags.String("backup", "", "new backup path")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 || *usersPath == "" || *backupPath == "" {
		return errors.New("--users and --backup are required")
	}
	result, err := migrateRBACUsersFile(*usersPath, *backupPath)
	if err != nil {
		return err
	}
	return json.NewEncoder(output).Encode(result)
}

func runRBACUsersRollbackCommand(args []string, output io.Writer) error {
	flags := flag.NewFlagSet("rbac-users-rollback", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	usersPath := flags.String("users", "", "path to users.conf")
	backupPath := flags.String("backup", "", "backup created by rbac-users-migrate")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 || *usersPath == "" || *backupPath == "" {
		return errors.New("--users and --backup are required")
	}
	result, err := rollbackRBACUsersFile(*usersPath, *backupPath)
	if err != nil {
		return err
	}
	return json.NewEncoder(output).Encode(result)
}

func migrateRBACUsersFile(usersPath, backupPath string) (rbacUsersMigrationResult, error) {
	return migrateRBACUsersFileWithWriter(usersPath, backupPath, writeConfigFileAtomicStrict)
}

func migrateRBACUsersFileWithWriter(usersPath, backupPath string, publish func(string, []byte, os.FileMode) error) (rbacUsersMigrationResult, error) {
	usersAbs, backupAbs, err := validatedRBACUsersPaths(usersPath, backupPath, false)
	if err != nil {
		return rbacUsersMigrationResult{}, err
	}
	original, err := os.ReadFile(usersAbs)
	if err != nil {
		return rbacUsersMigrationResult{}, fmt.Errorf("read users file: %w", err)
	}
	users, _, err := validateRBACUsersFile(usersAbs)
	if err != nil {
		return rbacUsersMigrationResult{}, err
	}
	migrated, err := marshalCanonicalUsers(users)
	if err != nil {
		return rbacUsersMigrationResult{}, err
	}
	if err := writeExclusiveDurableFile(backupAbs, original, 0o600); err != nil {
		return rbacUsersMigrationResult{}, fmt.Errorf("create users backup: %w", err)
	}

	restoreOnError := func(migrationErr error) (rbacUsersMigrationResult, error) {
		if restoreErr := writeConfigFileAtomicStrict(usersAbs, original, 0o600); restoreErr != nil {
			return rbacUsersMigrationResult{}, errors.Join(migrationErr, fmt.Errorf("restore original users file: %w", restoreErr))
		}
		return rbacUsersMigrationResult{}, migrationErr
	}
	if err := publish(usersAbs, migrated, 0o600); err != nil {
		return restoreOnError(fmt.Errorf("publish migrated users file: %w", err))
	}
	reloaded, schema, err := validateRBACUsersFile(usersAbs)
	if err != nil {
		return restoreOnError(fmt.Errorf("verify migrated users file: %w", err))
	}
	if schema != usersSchemaVersion || !equalRBACUsers(users, reloaded) {
		return restoreOnError(errors.New("verify migrated users file: account data changed"))
	}
	return rbacUsersMigrationResult{
		Action:        "migrated",
		UsersPath:     usersAbs,
		BackupPath:    backupAbs,
		SchemaVersion: schema,
		UserCount:     len(reloaded),
	}, nil
}

func rollbackRBACUsersFile(usersPath, backupPath string) (rbacUsersMigrationResult, error) {
	usersAbs, backupAbs, err := validatedRBACUsersPaths(usersPath, backupPath, true)
	if err != nil {
		return rbacUsersMigrationResult{}, err
	}
	backup, err := os.ReadFile(backupAbs)
	if err != nil {
		return rbacUsersMigrationResult{}, fmt.Errorf("read users backup: %w", err)
	}
	backupUsers, backupSchema, err := validateRBACUsersFile(backupAbs)
	if err != nil {
		return rbacUsersMigrationResult{}, fmt.Errorf("validate users backup: %w", err)
	}
	if err := writeConfigFileAtomicStrict(usersAbs, backup, 0o600); err != nil {
		return rbacUsersMigrationResult{}, fmt.Errorf("restore users backup: %w", err)
	}
	restored, restoredSchema, err := validateRBACUsersFile(usersAbs)
	if err != nil || restoredSchema != backupSchema || !equalRBACUsers(backupUsers, restored) {
		return rbacUsersMigrationResult{}, errors.New("verify restored users file failed")
	}
	return rbacUsersMigrationResult{
		Action:        "rolled_back",
		UsersPath:     usersAbs,
		BackupPath:    backupAbs,
		SchemaVersion: restoredSchema,
		UserCount:     len(restored),
	}, nil
}

func validatedRBACUsersPaths(usersPath, backupPath string, backupMustExist bool) (string, string, error) {
	usersAbs, err := filepath.Abs(usersPath)
	if err != nil {
		return "", "", fmt.Errorf("resolve users path: %w", err)
	}
	backupAbs, err := filepath.Abs(backupPath)
	if err != nil {
		return "", "", fmt.Errorf("resolve backup path: %w", err)
	}
	if usersAbs == backupAbs {
		return "", "", errors.New("users and backup paths must differ")
	}
	if err := requireRegularNonSymlink(usersAbs); err != nil {
		return "", "", fmt.Errorf("users path: %w", err)
	}
	backupInfo, err := os.Lstat(backupAbs)
	if backupMustExist {
		if err != nil {
			return "", "", fmt.Errorf("backup path: %w", err)
		}
		if backupInfo.Mode()&os.ModeSymlink != 0 || !backupInfo.Mode().IsRegular() {
			return "", "", errors.New("backup path must be a regular non-symlink file")
		}
	} else if err == nil {
		return "", "", errors.New("backup path already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", "", fmt.Errorf("inspect backup path: %w", err)
	}
	return usersAbs, backupAbs, nil
}

func requireRegularNonSymlink(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return errors.New("must be a regular non-symlink file")
	}
	return nil
}

func validateRBACUsersFile(path string) (map[string]User, string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, "", err
	}
	return validateRBACUsersData(data)
}

func validateRBACUsersData(data []byte) (map[string]User, string, error) {
	var file usersFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, "", fmt.Errorf("parse users file: %w", err)
	}
	if file.SchemaVersion != "1.0" && file.SchemaVersion != usersSchemaVersion {
		return nil, "", fmt.Errorf("unsupported users schema %q", file.SchemaVersion)
	}
	users := make(map[string]User, len(file.Users))
	for _, user := range file.Users {
		if user.Username == "" || user.Password == "" || !validRole(user.Role) {
			return nil, "", fmt.Errorf("invalid user entry %q", user.Username)
		}
		if user.SessionVersion == 0 {
			user.SessionVersion = 1
		}
		if _, duplicate := users[user.Username]; duplicate {
			return nil, "", fmt.Errorf("duplicate user entry %q", user.Username)
		}
		users[user.Username] = user
	}
	if countAdmins(users) == 0 {
		return nil, "", errors.New("users file must retain at least one admin")
	}
	for username, user := range users {
		if _, err := bcrypt.Cost([]byte(user.Password)); err != nil {
			return nil, "", fmt.Errorf("user %q has invalid bcrypt hash", username)
		}
	}
	return users, file.SchemaVersion, nil
}

func marshalCanonicalUsers(users map[string]User) ([]byte, error) {
	names := make([]string, 0, len(users))
	for name := range users {
		names = append(names, name)
	}
	sort.Strings(names)
	file := usersFile{SchemaVersion: usersSchemaVersion, Users: make([]User, 0, len(names))}
	for _, name := range names {
		file.Users = append(file.Users, users[name])
	}
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal migrated users: %w", err)
	}
	return append(data, '\n'), nil
}

func equalRBACUsers(expected, actual map[string]User) bool {
	if len(expected) != len(actual) {
		return false
	}
	for username, user := range expected {
		if actual[username] != user {
			return false
		}
	}
	return true
}

func writeExclusiveDurableFile(path string, data []byte, perm os.FileMode) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, perm)
	if err != nil {
		return err
	}
	remove := true
	defer func() {
		if remove {
			_ = os.Remove(path)
		}
	}()
	if _, err := file.Write(data); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := syncDirectory(filepath.Dir(path)); err != nil {
		return err
	}
	remove = false
	return nil
}
