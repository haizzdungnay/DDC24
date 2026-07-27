package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"runtime"
	"strings"
	"time"
)

const (
	rbacSmokeCredentialLimit      = 64 << 10
	rbacSmokeResponseLimit        = 1 << 20
	rbacSmokeMutationConfirmation = "CREATE-CHANGE-DELETE-TEMP-USER"
)

type rbacSmokeCredential struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type rbacSmokeCredentials struct {
	Viewer   rbacSmokeCredential `json:"viewer"`
	Operator rbacSmokeCredential `json:"operator"`
	Engineer rbacSmokeCredential `json:"engineer"`
	Admin    rbacSmokeCredential `json:"admin"`
}

type rbacSmokeCheck struct {
	Name   string `json:"name"`
	Status int    `json:"status"`
}

type rbacSmokeResult struct {
	Action     string           `json:"action"`
	Mode       string           `json:"mode"`
	Passed     bool             `json:"passed"`
	CheckCount int              `json:"check_count"`
	Roles      []Role           `json:"roles"`
	Checks     []rbacSmokeCheck `json:"checks"`
}

type rbacSmokeLoginResponse struct {
	Token string `json:"token"`
	Role  Role   `json:"role"`
}

type rbacSmokeRunner struct {
	client  *http.Client
	baseURL string
	checks  []rbacSmokeCheck
}

func runRBACTargetSmokeCommand(args []string, input io.Reader, output io.Writer) error {
	flags := flag.NewFlagSet("rbac-target-smoke", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	baseURLFlag := flags.String("base-url", "", "target API origin")
	credentialsPath := flags.String("credentials", "", "0600 JSON credential file, or - for stdin")
	allowHTTP := flags.Bool("allow-http", false, "allow cleartext HTTP for an explicitly trusted path")
	full := flags.Bool("full", false, "run temporary-user create/change/delete lifecycle")
	confirmation := flags.String("confirm", "", "required confirmation for --full")
	timeout := flags.Duration("timeout", 10*time.Second, "per-request timeout")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 || *baseURLFlag == "" || *credentialsPath == "" {
		return errors.New("--base-url and --credentials are required")
	}
	if *timeout <= 0 || *timeout > time.Minute {
		return errors.New("--timeout must be greater than zero and no more than one minute")
	}
	if *full && *confirmation != rbacSmokeMutationConfirmation {
		return fmt.Errorf("--full requires --confirm %s", rbacSmokeMutationConfirmation)
	}
	if !*full && *confirmation != "" {
		return errors.New("--confirm is only valid with --full")
	}

	baseURL, err := validateRBACTargetSmokeURL(*baseURLFlag, *allowHTTP)
	if err != nil {
		return err
	}
	credentials, err := loadRBACTargetSmokeCredentials(*credentialsPath, input)
	if err != nil {
		return err
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	client := &http.Client{
		Timeout:   *timeout,
		Transport: transport,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return errors.New("redirects are disabled")
		},
	}
	result, err := runRBACTargetSmoke(context.Background(), client, baseURL, credentials, *full)
	if err != nil {
		return err
	}
	return json.NewEncoder(output).Encode(result)
}

func validateRBACTargetSmokeURL(raw string, allowHTTP bool) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return "", errors.New("--base-url must be an absolute http or https origin")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return "", errors.New("--base-url must not contain credentials, path, query, or fragment")
	}
	if parsed.Scheme == "http" && !allowHTTP {
		return "", errors.New("cleartext HTTP requires explicit --allow-http")
	}
	if parsed.Scheme == "http" {
		host := parsed.Hostname()
		ip := net.ParseIP(host)
		if !strings.EqualFold(host, "localhost") && (ip == nil || !ip.IsLoopback()) {
			return "", errors.New("cleartext HTTP is restricted to a loopback origin")
		}
	}
	parsed.Path = ""
	return strings.TrimRight(parsed.String(), "/"), nil
}

func loadRBACTargetSmokeCredentials(path string, input io.Reader) (rbacSmokeCredentials, error) {
	var reader io.Reader
	if path == "-" {
		if input == nil {
			return rbacSmokeCredentials{}, errors.New("credential stdin is unavailable")
		}
		reader = input
	} else {
		info, err := os.Lstat(path)
		if err != nil {
			return rbacSmokeCredentials{}, fmt.Errorf("inspect credential file: %w", err)
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return rbacSmokeCredentials{}, errors.New("credential path must be a regular non-symlink file")
		}
		file, err := os.Open(path)
		if err != nil {
			return rbacSmokeCredentials{}, fmt.Errorf("open credential file: %w", err)
		}
		defer file.Close()
		openedInfo, err := file.Stat()
		if err != nil || !openedInfo.Mode().IsRegular() || !os.SameFile(info, openedInfo) {
			return rbacSmokeCredentials{}, errors.New("credential file changed during validation")
		}
		if runtime.GOOS != "windows" && openedInfo.Mode().Perm()&0o077 != 0 {
			return rbacSmokeCredentials{}, errors.New("credential file must not be accessible by group or others")
		}
		reader = file
	}

	data, err := io.ReadAll(io.LimitReader(reader, rbacSmokeCredentialLimit+1))
	if err != nil {
		return rbacSmokeCredentials{}, fmt.Errorf("read credentials: %w", err)
	}
	if len(data) > rbacSmokeCredentialLimit {
		return rbacSmokeCredentials{}, errors.New("credential input exceeds 64 KiB")
	}
	var credentials rbacSmokeCredentials
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&credentials); err != nil {
		return rbacSmokeCredentials{}, errors.New("credential input is not valid JSON")
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return rbacSmokeCredentials{}, errors.New("credential input must contain one JSON object")
	}
	if err := validateRBACTargetSmokeCredentials(credentials); err != nil {
		return rbacSmokeCredentials{}, err
	}
	return credentials, nil
}

func validateRBACTargetSmokeCredentials(credentials rbacSmokeCredentials) error {
	seen := make(map[string]struct{}, 4)
	for _, role := range []Role{RoleViewer, RoleOperator, RoleEngineer, RoleAdmin} {
		credential := credentials.forRole(role)
		if !validUsername(credential.Username) || credential.Password == "" {
			return fmt.Errorf("credentials for role %s are incomplete or invalid", role)
		}
		if _, duplicate := seen[credential.Username]; duplicate {
			return errors.New("credential usernames must be unique")
		}
		seen[credential.Username] = struct{}{}
	}
	return nil
}

func (credentials rbacSmokeCredentials) forRole(role Role) rbacSmokeCredential {
	switch role {
	case RoleViewer:
		return credentials.Viewer
	case RoleOperator:
		return credentials.Operator
	case RoleEngineer:
		return credentials.Engineer
	case RoleAdmin:
		return credentials.Admin
	default:
		return rbacSmokeCredential{}
	}
}

func runRBACTargetSmoke(ctx context.Context, client *http.Client, baseURL string, credentials rbacSmokeCredentials, full bool) (rbacSmokeResult, error) {
	runner := &rbacSmokeRunner{client: client, baseURL: baseURL}
	if err := runner.expectStatus(ctx, "unauthenticated.me", "", http.MethodGet, "/api/v1/me", nil, http.StatusUnauthorized); err != nil {
		return rbacSmokeResult{}, err
	}

	tokens := make(map[Role]string, 4)
	for _, role := range []Role{RoleViewer, RoleOperator, RoleEngineer, RoleAdmin} {
		token, err := runner.login(ctx, string(role), role, credentials.forRole(role))
		if err != nil {
			return rbacSmokeResult{}, err
		}
		tokens[role] = token
	}

	if err := runner.expectStatus(ctx, "viewer.status.read", tokens[RoleViewer], http.MethodGet, "/api/v1/system/status", nil, http.StatusOK); err != nil {
		return rbacSmokeResult{}, err
	}
	for _, check := range []struct {
		name   string
		role   Role
		method string
		path   string
		body   any
		status int
	}{
		{"viewer.users.denied", RoleViewer, http.MethodGet, "/api/v1/users", nil, http.StatusForbidden},
		{"viewer.operate.denied", RoleViewer, http.MethodPut, "/api/v1/points/__rbac_smoke_missing__", map[string]any{}, http.StatusForbidden},
		{"viewer.bacnet.authority_pending", RoleViewer, http.MethodGet, "/api/v1/bacnet/objects", nil, http.StatusNotImplemented},
		{"operator.settings.denied", RoleOperator, http.MethodPut, "/api/v1/schedules", []any{}, http.StatusForbidden},
		{"operator.database.denied", RoleOperator, http.MethodPut, "/api/v1/trends/config", map[string]any{}, http.StatusForbidden},
		{"operator.program_edit.authority_pending", RoleOperator, http.MethodPost, "/api/v1/graph/validate", map[string]any{}, http.StatusNotImplemented},
		{"operator.program_activate.denied", RoleOperator, http.MethodPost, "/api/v1/graph/deploy", map[string]any{}, http.StatusForbidden},
		{"operator.ota_upload.denied", RoleOperator, http.MethodPost, "/api/v1/ota/upload", map[string]any{}, http.StatusForbidden},
		{"operator.ota_apply.denied", RoleOperator, http.MethodPost, "/api/v1/ota/apply", map[string]any{}, http.StatusForbidden},
		{"operator.release.denied", RoleOperator, http.MethodGet, "/api/v1/ota/status", nil, http.StatusForbidden},
		{"engineer.users.denied", RoleEngineer, http.MethodGet, "/api/v1/users", nil, http.StatusForbidden},
		{"engineer.database.denied", RoleEngineer, http.MethodPut, "/api/v1/trends/config", map[string]any{}, http.StatusForbidden},
		{"engineer.settings.allowed", RoleEngineer, http.MethodGet, "/api/v1/system/config", nil, http.StatusOK},
		{"engineer.ota_status.authority_pending", RoleEngineer, http.MethodGet, "/api/v1/ota/status", nil, http.StatusNotImplemented},
		{"engineer.logs.authority_pending", RoleEngineer, http.MethodGet, "/api/v1/logs/download", nil, http.StatusNotImplemented},
		{"admin.users.allowed", RoleAdmin, http.MethodGet, "/api/v1/users", nil, http.StatusOK},
		{"admin.settings.allowed", RoleAdmin, http.MethodGet, "/api/v1/system/config", nil, http.StatusOK},
	} {
		if err := runner.expectStatus(ctx, check.name, tokens[check.role], check.method, check.path, check.body, check.status); err != nil {
			return rbacSmokeResult{}, err
		}
	}

	mode := "read-only"
	if full {
		mode = "full"
		if err := runner.runTemporaryUserLifecycle(ctx, tokens[RoleAdmin]); err != nil {
			return rbacSmokeResult{}, err
		}
	}
	return rbacSmokeResult{
		Action:     "rbac_target_smoke",
		Mode:       mode,
		Passed:     true,
		CheckCount: len(runner.checks),
		Roles:      []Role{RoleViewer, RoleOperator, RoleEngineer, RoleAdmin},
		Checks:     runner.checks,
	}, nil
}

func (runner *rbacSmokeRunner) login(ctx context.Context, label string, role Role, credential rbacSmokeCredential) (string, error) {
	status, body, err := runner.request(ctx, "", http.MethodPost, "/api/v1/auth/login", credential)
	if err != nil {
		return "", fmt.Errorf("%s login request failed: %w", role, err)
	}
	runner.checks = append(runner.checks, rbacSmokeCheck{Name: label + ".login", Status: status})
	if status != http.StatusOK {
		return "", fmt.Errorf("%s login returned status %d, want 200", role, status)
	}
	var response rbacSmokeLoginResponse
	if err := json.Unmarshal(body, &response); err != nil || response.Token == "" || response.Role != role {
		return "", fmt.Errorf("%s login response is invalid", role)
	}
	status, body, err = runner.request(ctx, response.Token, http.MethodGet, "/api/v1/me", nil)
	if err != nil {
		return "", fmt.Errorf("%s identity request failed: %w", role, err)
	}
	runner.checks = append(runner.checks, rbacSmokeCheck{Name: label + ".me", Status: status})
	var me UserDTO
	if status != http.StatusOK || json.Unmarshal(body, &me) != nil || me.Username != credential.Username || me.Role != role {
		return "", fmt.Errorf("%s identity verification failed with status %d", role, status)
	}
	return response.Token, nil
}

func (runner *rbacSmokeRunner) expectStatus(ctx context.Context, name, token, method, path string, body any, want int) error {
	status, _, err := runner.request(ctx, token, method, path, body)
	if err != nil {
		return fmt.Errorf("check %s failed: %w", name, err)
	}
	runner.checks = append(runner.checks, rbacSmokeCheck{Name: name, Status: status})
	if status != want {
		return fmt.Errorf("check %s returned status %d, want %d", name, status, want)
	}
	return nil
}

func (runner *rbacSmokeRunner) request(ctx context.Context, token, method, path string, body any) (int, []byte, error) {
	var requestBody io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return 0, nil, errors.New("encode request body")
		}
		requestBody = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, runner.baseURL+path, requestBody)
	if err != nil {
		return 0, nil, errors.New("create request")
	}
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := runner.client.Do(request)
	if err != nil {
		return 0, nil, fmt.Errorf("request transport: %w", err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, rbacSmokeResponseLimit+1))
	if err != nil {
		return 0, nil, errors.New("read response")
	}
	if len(data) > rbacSmokeResponseLimit {
		return 0, nil, errors.New("response exceeds 1 MiB")
	}
	return response.StatusCode, data, nil
}

func (runner *rbacSmokeRunner) runTemporaryUserLifecycle(ctx context.Context, adminToken string) (returnErr error) {
	var username, password string
	for attempt := 0; attempt < 3; attempt++ {
		var err error
		username, password, err = newRBACTemporarySmokeAccount()
		if err != nil {
			return err
		}
		exists, err := runner.userExists(ctx, adminToken, username)
		if err != nil {
			return err
		}
		if !exists {
			break
		}
		username = ""
	}
	if username == "" {
		return errors.New("could not allocate a unique temporary smoke username")
	}
	created := false
	defer func() {
		if !created {
			return
		}
		status, _, cleanupErr := runner.request(ctx, adminToken, http.MethodDelete, "/api/v1/users/"+url.PathEscape(username), nil)
		if cleanupErr == nil && (status == http.StatusNoContent || status == http.StatusNotFound) {
			return
		}
		if cleanupErr == nil {
			cleanupErr = fmt.Errorf("cleanup returned status %d", status)
		}
		returnErr = errors.Join(returnErr, fmt.Errorf("temporary smoke user cleanup failed for %s: %w", username, cleanupErr))
	}()

	status, _, requestErr := runner.request(ctx, adminToken, http.MethodPost, "/api/v1/users", CreateUserRequest{Username: username, Role: RoleViewer, Password: password})
	if requestErr != nil || status != http.StatusCreated {
		exists, inspectErr := runner.userExists(ctx, adminToken, username)
		if inspectErr == nil {
			created = exists
		} else {
			return fmt.Errorf("temporary user creation outcome is unknown; inspect and remove %s: %w", username, inspectErr)
		}
		if requestErr != nil {
			return fmt.Errorf("check full.temp.create failed: %w", requestErr)
		}
		return fmt.Errorf("check full.temp.create returned status %d, want %d", status, http.StatusCreated)
	}
	runner.checks = append(runner.checks, rbacSmokeCheck{Name: "full.temp.create", Status: status})
	created = true
	temporaryToken, err := runner.login(ctx, "full.temp.viewer", RoleViewer, rbacSmokeCredential{Username: username, Password: password})
	if err != nil {
		return err
	}
	path := "/api/v1/users/" + url.PathEscape(username)
	if err := runner.expectStatus(ctx, "full.temp.change_role", adminToken, http.MethodPut, path, map[string]Role{"role": RoleOperator}, http.StatusOK); err != nil {
		return err
	}
	if err := runner.expectStatus(ctx, "full.temp.stale_after_role_change", temporaryToken, http.MethodGet, "/api/v1/me", nil, http.StatusUnauthorized); err != nil {
		return err
	}
	temporaryToken, err = runner.login(ctx, "full.temp.operator", RoleOperator, rbacSmokeCredential{Username: username, Password: password})
	if err != nil {
		return err
	}
	if err := runner.expectStatus(ctx, "full.temp.delete", adminToken, http.MethodDelete, path, nil, http.StatusNoContent); err != nil {
		return err
	}
	created = false
	if err := runner.expectStatus(ctx, "full.temp.stale_after_delete", temporaryToken, http.MethodGet, "/api/v1/me", nil, http.StatusUnauthorized); err != nil {
		return err
	}
	return nil
}

func (runner *rbacSmokeRunner) userExists(ctx context.Context, adminToken, username string) (bool, error) {
	status, body, err := runner.request(ctx, adminToken, http.MethodGet, "/api/v1/users", nil)
	if err != nil {
		return false, fmt.Errorf("inspect temporary smoke username: %w", err)
	}
	if status != http.StatusOK {
		return false, fmt.Errorf("inspect temporary smoke username returned status %d", status)
	}
	var users []UserDTO
	if err := json.Unmarshal(body, &users); err != nil {
		return false, errors.New("inspect temporary smoke username returned invalid JSON")
	}
	for _, user := range users {
		if user.Username == username {
			return true, nil
		}
	}
	return false, nil
}

func newRBACTemporarySmokeAccount() (string, string, error) {
	var nameBytes [16]byte
	if _, err := rand.Read(nameBytes[:]); err != nil {
		return "", "", errors.New("generate temporary username")
	}
	passwordBytes := make([]byte, 24)
	if _, err := rand.Read(passwordBytes); err != nil {
		return "", "", errors.New("generate temporary password")
	}
	return "rbac-smoke-" + hex.EncodeToString(nameBytes[:]), base64.RawURLEncoding.EncodeToString(passwordBytes), nil
}
