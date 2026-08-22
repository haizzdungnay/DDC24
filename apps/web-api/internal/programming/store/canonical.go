package store

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"

	"mkddc-web/internal/programming/canonicaljson"
)

func canonicalJSON(raw []byte, maxBytes int) ([]byte, error) {
	return canonicaljson.Value(raw, maxBytes)
}

func canonicalJSONObject(raw []byte, maxBytes int) ([]byte, error) {
	return canonicaljson.Object(raw, maxBytes)
}

var forbiddenAuditKeys = map[string]struct{}{
	"password": {}, "passphrase": {}, "token": {}, "accesstoken": {}, "refreshtoken": {},
	"apikey": {}, "apitoken": {}, "authorization": {}, "cookie": {}, "credential": {}, "credentials": {},
	"secret": {}, "clientsecret": {}, "secretvalue": {}, "privatekey": {},
	"source": {}, "sourcecode": {}, "document": {}, "payload": {}, "bundlebase64": {},
	"stack": {}, "artifact": {}, "artifactbytes": {}, "binary": {}, "hostpath": {},
}

func validateAuditDetails(canonical []byte) error {
	if len(canonical) < 2 || canonical[0] != '{' {
		return fmt.Errorf("audit details phải là object")
	}
	var value any
	decoder := json.NewDecoder(bytes.NewReader(canonical))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return err
	}
	return walkAuditDetails(value)
}

func walkAuditDetails(value any) error {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			normalizedKey := strings.Map(func(character rune) rune {
				if character == '_' || character == '-' || character == '.' || character == ' ' {
					return -1
				}
				return character
			}, strings.ToLower(key))
			if _, forbidden := forbiddenAuditKeys[normalizedKey]; forbidden {
				return fmt.Errorf("audit details chứa field bị cấm: %s", key)
			}
			if err := walkAuditDetails(child); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range typed {
			if err := walkAuditDetails(child); err != nil {
				return err
			}
		}
	}
	return nil
}
