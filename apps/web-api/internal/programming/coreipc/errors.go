package coreipc

import (
	"errors"
	"fmt"
)

var (
	ErrFrameTooLarge     = errors.New("programming IPC frame quá giới hạn")
	ErrFrameTruncated    = errors.New("programming IPC frame bị cắt")
	ErrInvalidEnvelope   = errors.New("programming IPC envelope không hợp lệ")
	ErrUnsupportedMajor  = errors.New("programming IPC protocol major không hỗ trợ")
	ErrUnsupportedMinor  = errors.New("programming IPC protocol minor không hỗ trợ")
	ErrDeadlineExceeded  = errors.New("programming IPC deadline đã hết")
	ErrPayloadHash       = errors.New("programming IPC payload hash không khớp")
	ErrPeerCredential    = errors.New("programming IPC peer credential không hợp lệ")
	ErrCoreUnavailable   = errors.New("programming Core IPC không sẵn sàng")
	ErrOperationRequired = errors.New("programming operationId bắt buộc")
)

type ProtocolError struct {
	Kind  error
	Field string
	Cause error
}

func (e *ProtocolError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%v: field=%s: %v", e.Kind, e.Field, e.Cause)
	}
	return fmt.Sprintf("%v: field=%s", e.Kind, e.Field)
}

func (e *ProtocolError) Unwrap() error { return e.Kind }

func protocolError(kind error, field string, cause error) error {
	return &ProtocolError{Kind: kind, Field: field, Cause: cause}
}
