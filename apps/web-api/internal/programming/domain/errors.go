package domain

import (
	"math"
	"strings"
	"unicode/utf8"
)

// ErrorCode là namespace lỗi công khai ổn định của Programming Rev A.
// Consumer chỉ được rẽ nhánh theo code, không parse messageKey hoặc detail nội bộ.
type ErrorCode string

// PublicError không chứa source, path, UID, stack, secret hoặc detail nội bộ.
// MessageKey/retry/keepsRunning được lấy từ catalog sinh tự động, không nhận từ
// text tự do của producer.
type PublicError struct {
	Code                 ErrorCode      `json:"code"`
	MessageKey           string         `json:"messageKey"`
	Args                 map[string]any `json:"args,omitempty"`
	Field                string         `json:"field,omitempty"`
	Retryable            bool           `json:"retryable"`
	KeepsRunningRevision bool           `json:"keepsRunningRevision"`
	CorrelationID        string         `json:"correlationId"`
}

func NewPublicError(code ErrorCode) PublicError {
	metadata, ok := ErrorMetadataFor(code)
	if !ok {
		code = ErrUnavailable
		metadata, _ = ErrorMetadataFor(code)
	}
	return PublicError{
		Code:                 code,
		MessageKey:           metadata.MessageKey,
		Retryable:            metadata.Retryable,
		KeepsRunningRevision: metadata.KeepsRunningRevision,
	}
}

// NormalizePublicError là ranh giới cuối trước khi serialize ra public API.
// Code lạ rơi về UNAVAILABLE; metadata tự khai và args ngoài allowlist bị bỏ.
func NormalizePublicError(public PublicError) PublicError {
	metadata, ok := ErrorMetadataFor(public.Code)
	if !ok {
		public = NewPublicError(ErrUnavailable)
		metadata, _ = ErrorMetadataFor(public.Code)
	}
	public.MessageKey = metadata.MessageKey
	public.Retryable = metadata.Retryable
	// Không nâng false thành true bằng metadata. Producer chỉ được đặt true khi
	// có invariant/read-back chứng minh revision cũ vẫn chạy.
	public.Args = SanitizeErrorArgs(public.Code, public.Args)
	if len(public.Field) > 128 || !utf8.ValidString(public.Field) ||
		strings.ContainsAny(public.Field, "/\\") || hasControlCharacter(public.Field) {
		public.Field = ""
	}
	return public
}

func sanitizePublicArgValue(value any) (any, bool) {
	switch typed := value.(type) {
	case string:
		return typed, len(typed) <= 128 && utf8.ValidString(typed) && !hasControlCharacter(typed)
	case bool, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return typed, true
	case float32:
		return typed, !floatInvalid(float64(typed))
	case float64:
		return typed, !floatInvalid(typed)
	case []string:
		if len(typed) > 16 {
			return nil, false
		}
		copyValue := append([]string(nil), typed...)
		for _, item := range copyValue {
			if len(item) > 128 || !utf8.ValidString(item) || hasControlCharacter(item) {
				return nil, false
			}
		}
		return copyValue, true
	case []any:
		if len(typed) > 16 {
			return nil, false
		}
		copyValue := make([]string, 0, len(typed))
		for _, item := range typed {
			text, ok := item.(string)
			if !ok || len(text) > 128 || !utf8.ValidString(text) || hasControlCharacter(text) {
				return nil, false
			}
			copyValue = append(copyValue, text)
		}
		return copyValue, true
	default:
		return nil, false
	}
}

func floatInvalid(value float64) bool {
	return math.IsNaN(value) || math.IsInf(value, 0)
}

func hasControlCharacter(value string) bool {
	return strings.IndexFunc(value, func(candidate rune) bool { return candidate < 0x20 || candidate == 0x7f }) >= 0
}
