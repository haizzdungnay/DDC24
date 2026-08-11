package domain

// ErrorCode là namespace lỗi công khai ổn định của Programming Rev A.
// Consumer chỉ được rẽ nhánh theo code, không parse messageKey hoặc detail nội bộ.
type ErrorCode string

const (
	ErrRequest           ErrorCode = "PRG-ERR-REQ-001"
	ErrConflict          ErrorCode = "PRG-ERR-CONFLICT-001"
	ErrOperation         ErrorCode = "PRG-ERR-OP-001"
	ErrAckMissing        ErrorCode = "PRG-ERR-ACK-MISSING-001"
	ErrAckUnexpected     ErrorCode = "PRG-ERR-ACK-UNEXPECTED-001"
	ErrImpactUnavailable ErrorCode = "PRG-ERR-IMPACT-UNAVAILABLE-001"
	ErrImpactStale       ErrorCode = "PRG-ERR-IMPACT-STALE-001"
	ErrUnavailable       ErrorCode = "PRG-ERR-UNAVAILABLE-001"
)

// PublicError không chứa source, path, UID, stack hoặc secret. DetailCode chỉ
// được giữ ở log nội bộ và sẽ được bổ sung bởi TASK-PROG-103.
type PublicError struct {
	Code                 ErrorCode      `json:"code"`
	MessageKey           string         `json:"messageKey"`
	Args                 map[string]any `json:"args,omitempty"`
	Field                string         `json:"field,omitempty"`
	Retryable            bool           `json:"retryable"`
	KeepsRunningRevision bool           `json:"keepsRunningRevision"`
	CorrelationID        string         `json:"correlationId"`
}

func NewPublicError(code ErrorCode, messageKey string) PublicError {
	return PublicError{
		Code:                 code,
		MessageKey:           messageKey,
		Retryable:            false,
		KeepsRunningRevision: true,
	}
}
