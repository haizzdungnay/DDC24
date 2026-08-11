package store

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

func canonicalJSON(raw []byte, maxBytes int) ([]byte, error) {
	if len(raw) == 0 || len(raw) > maxBytes || !utf8.Valid(raw) {
		return nil, fmt.Errorf("JSON rỗng, vượt giới hạn hoặc không phải UTF-8")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	value, err := decodeJSONValue(decoder)
	if err != nil {
		return nil, err
	}
	if _, err := decoder.Token(); !errorsIsEOF(err) {
		if err == nil {
			return nil, fmt.Errorf("JSON có dữ liệu thừa")
		}
		return nil, fmt.Errorf("đọc cuối JSON: %w", err)
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("canonicalize JSON: %w", err)
	}
	if len(canonical) > maxBytes {
		return nil, fmt.Errorf("JSON canonical vượt giới hạn %d byte", maxBytes)
	}
	return canonical, nil
}

func canonicalJSONObject(raw []byte, maxBytes int) ([]byte, error) {
	canonical, err := canonicalJSON(raw, maxBytes)
	if err != nil {
		return nil, err
	}
	if len(canonical) < 2 || canonical[0] != '{' {
		return nil, fmt.Errorf("JSON top-level phải là object")
	}
	return canonical, nil
}

func decodeJSONValue(decoder *json.Decoder) (any, error) {
	token, err := decoder.Token()
	if err != nil {
		return nil, fmt.Errorf("decode JSON: %w", err)
	}
	delimiter, isDelimiter := token.(json.Delim)
	if !isDelimiter {
		if text, ok := token.(string); ok {
			return norm.NFC.String(text), nil
		}
		return token, nil
	}
	switch delimiter {
	case '{':
		object := make(map[string]any)
		for decoder.More() {
			keyToken, err := decoder.Token()
			if err != nil {
				return nil, fmt.Errorf("decode JSON key: %w", err)
			}
			key, ok := keyToken.(string)
			if !ok {
				return nil, fmt.Errorf("JSON object key không phải string")
			}
			key = norm.NFC.String(key)
			if _, duplicate := object[key]; duplicate {
				return nil, fmt.Errorf("JSON duplicate key: %s", key)
			}
			value, err := decodeJSONValue(decoder)
			if err != nil {
				return nil, err
			}
			object[key] = value
		}
		if token, err := decoder.Token(); err != nil || token != json.Delim('}') {
			return nil, fmt.Errorf("JSON object không đóng hợp lệ: %w", err)
		}
		return object, nil
	case '[':
		array := make([]any, 0)
		for decoder.More() {
			value, err := decodeJSONValue(decoder)
			if err != nil {
				return nil, err
			}
			array = append(array, value)
		}
		if token, err := decoder.Token(); err != nil || token != json.Delim(']') {
			return nil, fmt.Errorf("JSON array không đóng hợp lệ: %w", err)
		}
		return array, nil
	default:
		return nil, fmt.Errorf("JSON delimiter không hợp lệ: %q", delimiter)
	}
}

func errorsIsEOF(err error) bool {
	return err == io.EOF
}

var forbiddenAuditKeys = map[string]struct{}{
	"password": {}, "token": {}, "secret": {}, "privatekey": {}, "source": {},
	"sourcecode": {}, "stack": {}, "artifactbytes": {}, "hostpath": {},
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
			if _, forbidden := forbiddenAuditKeys[strings.ToLower(key)]; forbidden {
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
