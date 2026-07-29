package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"

	"golang.org/x/crypto/bcrypt"
)

const (
	rbacSmokeProvisionConfirmation = "PROVISION-RBAC-SMOKE-USERS"
	rbacSmokeCleanupConfirmation   = "REMOVE-RBAC-SMOKE-USERS"
	rbacSmokeStateSchemaVersion    = "1.0"
	rbacSmokeUsersFileLimit        = 1 << 20
	rbacSmokePasswordCost          = 12
)

type rbacSmokeProvisionAccount struct {
	Username       string `json:"username"`
	Role           Role   `json:"role"`
	PasswordHash   string `json:"password_hash"`
	SessionVersion uint64 `json:"session_version"`
}

type rbacSmokeProvisionState struct {
	SchemaVersion     string                      `json:"_schema_version"`
	UsersPath         string                      `json:"users_path"`
	OriginalSHA256    string                      `json:"original_sha256"`
	OriginalUserCount int                         `json:"original_user_count"`
	Accounts          []rbacSmokeProvisionAccount `json:"accounts"`
}

type rbacSmokeUsersResult struct {
	Action          string `json:"action"`
	UsersPath       string `json:"users_path"`
	CredentialsPath string `json:"credentials_path"`
	StatePath       string `json:"state_path"`
	UserCount       int    `json:"user_count"`
}

type rbacSmokeUsersPaths struct {
	users       string
	credentials string
	state       string
	presence    string
}

func runRBACSmokeUsersProvisionCommand(args []string, output io.Writer) error {
	flags := flag.NewFlagSet("rbac-smoke-users-provision", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	usersPath := flags.String("users", "", "schema 2.0 users.conf path")
	credentialsPath := flags.String("credentials", "", "new private smoke credential file")
	statePath := flags.String("state", "", "new private provisioning state file")
	confirmation := flags.String("confirm", "", "exact provisioning confirmation")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 || *usersPath == "" || *credentialsPath == "" || *statePath == "" {
		return errors.New("--users, --credentials, and --state are required")
	}
	if *confirmation != rbacSmokeProvisionConfirmation {
		return fmt.Errorf("--confirm %s is required", rbacSmokeProvisionConfirmation)
	}
	result, err := provisionRBACSmokeUsers(*usersPath, *credentialsPath, *statePath)
	if err != nil {
		return err
	}
	return json.NewEncoder(output).Encode(result)
}

func runRBACSmokeUsersCleanupCommand(args []string, output io.Writer) error {
	flags := flag.NewFlagSet("rbac-smoke-users-cleanup", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	usersPath := flags.String("users", "", "schema 2.0 users.conf path")
	credentialsPath := flags.String("credentials", "", "private smoke credential file")
	statePath := flags.String("state", "", "private provisioning state file")
	confirmation := flags.String("confirm", "", "exact cleanup confirmation")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 || *usersPath == "" || *credentialsPath == "" || *statePath == "" {
		return errors.New("--users, --credentials, and --state are required")
	}
	if *confirmation != rbacSmokeCleanupConfirmation {
		return fmt.Errorf("--confirm %s is required", rbacSmokeCleanupConfirmation)
	}
	result, err := cleanupRBACSmokeUsers(*usersPath, *credentialsPath, *statePath)
	if err != nil {
		return err
	}
	return json.NewEncoder(output).Encode(result)
}

func provisionRBACSmokeUsers(usersPath, credentialsPath, statePath string) (rbacSmokeUsersResult, error) {
	return provisionRBACSmokeUsersWithWriter(usersPath, credentialsPath, statePath, rbacSmokePasswordCost, writeConfigFileAtomicStrict)
}

func provisionRBACSmokeUsersWithWriter(usersPath, credentialsPath, statePath string, passwordCost int, publish func(string, []byte, os.FileMode) error) (rbacSmokeUsersResult, error) {
	paths, err := validateRBACSmokeUsersPaths(usersPath, credentialsPath, statePath, true)
	if err != nil {
		return rbacSmokeUsersResult{}, err
	}
	if err := requireRBACServiceStopped(paths.presence); err != nil {
		return rbacSmokeUsersResult{}, err
	}
	original, existing, err := readCanonicalRBACUsers(paths.users)
	if err != nil {
		return rbacSmokeUsersResult{}, err
	}

	credentials, accounts, candidate, err := buildRBACSmokeAccounts(existing, passwordCost)
	if err != nil {
		return rbacSmokeUsersResult{}, err
	}
	candidateData, err := marshalCanonicalUsers(candidate)
	if err != nil {
		return rbacSmokeUsersResult{}, err
	}
	credentialData, err := marshalPrivateJSON(credentials)
	if err != nil {
		return rbacSmokeUsersResult{}, errors.New("marshal smoke credentials")
	}
	digest := sha256.Sum256(original)
	state := rbacSmokeProvisionState{
		SchemaVersion:     rbacSmokeStateSchemaVersion,
		UsersPath:         paths.users,
		OriginalSHA256:    hex.EncodeToString(digest[:]),
		OriginalUserCount: len(existing),
		Accounts:          accounts,
	}
	stateData, err := marshalPrivateJSON(state)
	if err != nil {
		return rbacSmokeUsersResult{}, errors.New("marshal smoke provisioning state")
	}

	credentialsCreated := false
	stateCreated := false
	removeArtifacts := func() error {
		var cleanupErr error
		if credentialsCreated {
			cleanupErr = errors.Join(cleanupErr, removeDurableFile(paths.credentials))
		}
		if stateCreated {
			cleanupErr = errors.Join(cleanupErr, removeDurableFile(paths.state))
		}
		return cleanupErr
	}
	if err := writeExclusiveDurableFile(paths.credentials, credentialData, 0o600); err != nil {
		return rbacSmokeUsersResult{}, fmt.Errorf("create smoke credential file: %w", err)
	}
	credentialsCreated = true
	if err := writeExclusiveDurableFile(paths.state, stateData, 0o600); err != nil {
		return rbacSmokeUsersResult{}, errors.Join(fmt.Errorf("create smoke state file: %w", err), removeArtifacts())
	}
	stateCreated = true

	restoreOnError := func(provisionErr error) (rbacSmokeUsersResult, error) {
		restoreErr := writeConfigFileAtomicStrict(paths.users, original, 0o600)
		return rbacSmokeUsersResult{}, errors.Join(provisionErr, restoreErr, removeArtifacts())
	}
	if err := requireRBACServiceStopped(paths.presence); err != nil {
		return restoreOnError(err)
	}
	if err := publish(paths.users, candidateData, 0o600); err != nil {
		return restoreOnError(fmt.Errorf("publish smoke users: %w", err))
	}
	if err := requireRBACServiceStopped(paths.presence); err != nil {
		return restoreOnError(err)
	}
	_, reloaded, err := readCanonicalRBACUsers(paths.users)
	if err != nil || !equalRBACUsers(candidate, reloaded) {
		return restoreOnError(errors.New("verify provisioned smoke users failed"))
	}
	return rbacSmokeUsersResult{
		Action:          "provisioned",
		UsersPath:       paths.users,
		CredentialsPath: paths.credentials,
		StatePath:       paths.state,
		UserCount:       len(reloaded),
	}, nil
}

func cleanupRBACSmokeUsers(usersPath, credentialsPath, statePath string) (rbacSmokeUsersResult, error) {
	return cleanupRBACSmokeUsersWithWriter(usersPath, credentialsPath, statePath, writeConfigFileAtomicStrict)
}

func cleanupRBACSmokeUsersWithWriter(usersPath, credentialsPath, statePath string, publish func(string, []byte, os.FileMode) error) (rbacSmokeUsersResult, error) {
	paths, err := validateRBACSmokeUsersPaths(usersPath, credentialsPath, statePath, false)
	if err != nil {
		return rbacSmokeUsersResult{}, err
	}
	if err := requireRBACServiceStopped(paths.presence); err != nil {
		return rbacSmokeUsersResult{}, err
	}
	credentials, err := loadRBACTargetSmokeCredentials(paths.credentials, nil)
	if err != nil {
		return rbacSmokeUsersResult{}, err
	}
	state, err := loadRBACSmokeProvisionState(paths.state)
	if err != nil {
		return rbacSmokeUsersResult{}, err
	}
	if state.UsersPath != paths.users {
		return rbacSmokeUsersResult{}, errors.New("smoke state belongs to a different users file")
	}
	currentData, current, err := readCanonicalRBACUsers(paths.users)
	if err != nil {
		return rbacSmokeUsersResult{}, err
	}
	candidate, err := verifyOwnedRBACSmokeAccounts(current, credentials, state)
	if err != nil {
		return rbacSmokeUsersResult{}, err
	}
	candidateData, err := marshalCanonicalUsers(candidate)
	if err != nil {
		return rbacSmokeUsersResult{}, err
	}
	digest := sha256.Sum256(candidateData)
	if len(candidate) != state.OriginalUserCount || hex.EncodeToString(digest[:]) != state.OriginalSHA256 {
		return rbacSmokeUsersResult{}, errors.New("existing users changed after smoke provisioning; cleanup refused")
	}

	restoreOnError := func(cleanupErr error) (rbacSmokeUsersResult, error) {
		restoreErr := writeConfigFileAtomicStrict(paths.users, currentData, 0o600)
		return rbacSmokeUsersResult{}, errors.Join(cleanupErr, restoreErr)
	}
	if err := requireRBACServiceStopped(paths.presence); err != nil {
		return rbacSmokeUsersResult{}, err
	}
	if err := publish(paths.users, candidateData, 0o600); err != nil {
		return restoreOnError(fmt.Errorf("publish cleaned users: %w", err))
	}
	if err := requireRBACServiceStopped(paths.presence); err != nil {
		return restoreOnError(err)
	}
	verifiedData, verified, err := readCanonicalRBACUsers(paths.users)
	if err != nil || !bytes.Equal(verifiedData, candidateData) || !equalRBACUsers(candidate, verified) {
		return restoreOnError(errors.New("verify cleaned users failed"))
	}
	if err := removeDurableFile(paths.credentials); err != nil {
		return rbacSmokeUsersResult{}, fmt.Errorf("remove smoke credential file after user cleanup: %w", err)
	}
	if err := removeDurableFile(paths.state); err != nil {
		return rbacSmokeUsersResult{}, fmt.Errorf("remove smoke state file after user cleanup: %w", err)
	}
	return rbacSmokeUsersResult{
		Action:          "cleaned",
		UsersPath:       paths.users,
		CredentialsPath: paths.credentials,
		StatePath:       paths.state,
		UserCount:       len(verified),
	}, nil
}

func buildRBACSmokeAccounts(existing map[string]User, passwordCost int) (rbacSmokeCredentials, []rbacSmokeProvisionAccount, map[string]User, error) {
	candidate := cloneUsers(existing)
	var credentials rbacSmokeCredentials
	accounts := make([]rbacSmokeProvisionAccount, 0, 4)
	for _, role := range []Role{RoleViewer, RoleOperator, RoleEngineer, RoleAdmin} {
		credential, err := newRBACSmokeCredential(role, candidate)
		if err != nil {
			return rbacSmokeCredentials{}, nil, nil, err
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(credential.Password), passwordCost)
		if err != nil {
			return rbacSmokeCredentials{}, nil, nil, errors.New("hash smoke password")
		}
		user := User{Username: credential.Username, Role: role, Password: string(hash), SessionVersion: 1}
		candidate[user.Username] = user
		accounts = append(accounts, rbacSmokeProvisionAccount{Username: user.Username, Role: role, PasswordHash: user.Password, SessionVersion: user.SessionVersion})
		switch role {
		case RoleViewer:
			credentials.Viewer = credential
		case RoleOperator:
			credentials.Operator = credential
		case RoleEngineer:
			credentials.Engineer = credential
		case RoleAdmin:
			credentials.Admin = credential
		}
	}
	return credentials, accounts, candidate, nil
}

func newRBACSmokeCredential(role Role, users map[string]User) (rbacSmokeCredential, error) {
	for attempt := 0; attempt < 4; attempt++ {
		suffix := make([]byte, 12)
		password := make([]byte, 24)
		if _, err := rand.Read(suffix); err != nil {
			return rbacSmokeCredential{}, errors.New("generate smoke username")
		}
		if _, err := rand.Read(password); err != nil {
			return rbacSmokeCredential{}, errors.New("generate smoke password")
		}
		username := "rbac_smoke_" + string(role) + "_" + hex.EncodeToString(suffix)
		if _, exists := users[username]; exists {
			continue
		}
		return rbacSmokeCredential{Username: username, Password: base64.RawURLEncoding.EncodeToString(password)}, nil
	}
	return rbacSmokeCredential{}, errors.New("could not allocate a unique smoke username")
}

func verifyOwnedRBACSmokeAccounts(current map[string]User, credentials rbacSmokeCredentials, state rbacSmokeProvisionState) (map[string]User, error) {
	if state.SchemaVersion != rbacSmokeStateSchemaVersion || len(state.Accounts) != 4 || state.OriginalUserCount < 1 {
		return nil, errors.New("invalid smoke provisioning state")
	}
	wantedRoles := map[Role]bool{RoleViewer: true, RoleOperator: true, RoleEngineer: true, RoleAdmin: true}
	seenUsers := make(map[string]struct{}, 4)
	candidate := cloneUsers(current)
	for _, account := range state.Accounts {
		if !wantedRoles[account.Role] {
			return nil, errors.New("invalid role in smoke provisioning state")
		}
		delete(wantedRoles, account.Role)
		credential := credentials.forRole(account.Role)
		if credential.Username != account.Username {
			return nil, errors.New("smoke credential and state ownership mismatch")
		}
		if _, duplicate := seenUsers[account.Username]; duplicate {
			return nil, errors.New("duplicate account in smoke provisioning state")
		}
		seenUsers[account.Username] = struct{}{}
		user, exists := current[account.Username]
		if !exists || user.Role != account.Role || user.Password != account.PasswordHash || user.SessionVersion != account.SessionVersion {
			return nil, errors.New("provisioned smoke account changed; cleanup refused")
		}
		if bcrypt.CompareHashAndPassword([]byte(account.PasswordHash), []byte(credential.Password)) != nil {
			return nil, errors.New("smoke account bcrypt ownership verification failed")
		}
		delete(candidate, account.Username)
	}
	if len(wantedRoles) != 0 {
		return nil, errors.New("smoke provisioning state does not cover all roles")
	}
	return candidate, nil
}

func validateRBACSmokeUsersPaths(usersPath, credentialsPath, statePath string, createArtifacts bool) (rbacSmokeUsersPaths, error) {
	paths := rbacSmokeUsersPaths{}
	var err error
	if paths.users, err = filepath.Abs(usersPath); err != nil {
		return paths, fmt.Errorf("resolve users path: %w", err)
	}
	if paths.credentials, err = filepath.Abs(credentialsPath); err != nil {
		return paths, fmt.Errorf("resolve credentials path: %w", err)
	}
	if paths.state, err = filepath.Abs(statePath); err != nil {
		return paths, fmt.Errorf("resolve state path: %w", err)
	}
	paths.presence = filepath.Join(filepath.Dir(paths.users), "mkddc-web.running")
	if paths.users == paths.credentials || paths.users == paths.state || paths.credentials == paths.state {
		return paths, errors.New("users, credentials, and state paths must differ")
	}
	if err := requireRegularNonSymlink(paths.users); err != nil {
		return paths, fmt.Errorf("users path: %w", err)
	}
	for label, path := range map[string]string{"credentials": paths.credentials, "state": paths.state} {
		info, inspectErr := os.Lstat(path)
		if createArtifacts {
			if inspectErr == nil {
				return paths, fmt.Errorf("%s path already exists", label)
			}
			if !errors.Is(inspectErr, os.ErrNotExist) {
				return paths, fmt.Errorf("inspect %s path: %w", label, inspectErr)
			}
			continue
		}
		if inspectErr != nil {
			return paths, fmt.Errorf("inspect %s path: %w", label, inspectErr)
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return paths, fmt.Errorf("%s path must be a regular non-symlink file", label)
		}
		if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
			return paths, fmt.Errorf("%s file must not be accessible by group or others", label)
		}
	}
	return paths, nil
}

func requireRBACServiceStopped(presencePath string) error {
	_, err := os.Lstat(presencePath)
	if err == nil {
		return errors.New("web service presence file exists; stop mkddc-web before smoke-user maintenance")
	}
	if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect web service presence: %w", err)
	}
	return nil
}

func readCanonicalRBACUsers(path string) ([]byte, map[string]User, error) {
	data, err := readStablePrivateRegularFile(path, rbacSmokeUsersFileLimit)
	if err != nil {
		return nil, nil, fmt.Errorf("read users file: %w", err)
	}
	users, schema, err := validateRBACUsersData(data)
	if err != nil {
		return nil, nil, err
	}
	if schema != usersSchemaVersion {
		return nil, nil, fmt.Errorf("users schema must be %s; run rbac-users-migrate first", usersSchemaVersion)
	}
	canonical, err := marshalCanonicalUsers(users)
	if err != nil {
		return nil, nil, err
	}
	if !bytes.Equal(data, canonical) {
		return nil, nil, errors.New("users file must use canonical schema 2.0 encoding from rbac-users-migrate")
	}
	return data, users, nil
}

func loadRBACSmokeProvisionState(path string) (rbacSmokeProvisionState, error) {
	data, err := readStablePrivateRegularFile(path, rbacSmokeCredentialLimit)
	if err != nil {
		return rbacSmokeProvisionState{}, fmt.Errorf("read smoke state: %w", err)
	}
	var state rbacSmokeProvisionState
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil {
		return rbacSmokeProvisionState{}, errors.New("smoke state is not valid JSON")
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return rbacSmokeProvisionState{}, errors.New("smoke state must contain one JSON object")
	}
	return state, nil
}

func readStablePrivateRegularFile(path string, limit int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return nil, errors.New("path must be a regular non-symlink file")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	openedInfo, err := file.Stat()
	if err != nil || !openedInfo.Mode().IsRegular() || !os.SameFile(info, openedInfo) {
		return nil, errors.New("file changed during validation")
	}
	if runtime.GOOS != "windows" && openedInfo.Mode().Perm()&0o077 != 0 {
		return nil, errors.New("file must not be accessible by group or others")
	}
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("file exceeds size limit")
	}
	return data, nil
}

func marshalPrivateJSON(value any) ([]byte, error) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}

func removeDurableFile(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}
