package coreipc

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/fxamacker/cbor/v2"
)

const (
	ProtocolMajor uint16 = 1
	// T59-504 nâng minor 2 -> 3: STATUS thêm snapshot Published Signal ở phần
	// tử thứ năm. Client cũ giải mã array cố định nên cần nhận biết phiên bản.
	ProtocolMinor    uint16 = 3
	SchemaVersion           = "1.0"
	MaxFramePayload         = 64 * 1024
	MaxQueueDepth           = 32
	MaxControllerID         = 64
	MaxActorID              = 128
	MaxCorrelationID        = 64
)

type Action string

const (
	ActionCapabilities    Action = "CAPABILITIES"
	ActionStatus          Action = "STATUS"
	ActionStage           Action = "STAGE"
	ActionActivate        Action = "ACTIVATE"
	ActionOperationStatus Action = "OPERATION_STATUS"
	ActionRestore         Action = "RESTORE"
	ActionTraceStart      Action = "TRACE_START"
	ActionRetainReset     Action = "RETAIN_RESET"
	// T59-405 — intent Enable/Disable cho MỘT Program. Action riêng chứ không
	// phải tham số của ACTIVATE: "chương trình nào đang chạy" và "gói nào đang
	// hoạt động" là hai quyết định khác nhau, và gộp chúng sẽ buộc mọi lần bật
	// một Program phải đi qua đường Commission.
	ActionSetProgramEnabled Action = "SET_PROGRAM_ENABLED"
	// T59-408 — trace giá trị lấy tại ranh giới quét của Core.
	ActionTraceStop Action = "TRACE_STOP"
	ActionTraceRead Action = "TRACE_READ"
)

type Result string

const (
	ResultOK          Result = "OK"
	ResultStaged      Result = "STAGED"
	ResultAccepted    Result = "ACCEPTED"
	ResultRejected    Result = "REJECTED"
	ResultUnavailable Result = "UNAVAILABLE"
	ResultBusy        Result = "BUSY"
)

// Request là CBOR array cố định 12 phần tử. Array loại bỏ khác biệt thứ tự map
// giữa Go/C++ và làm schema major kiểm được bằng golden corpus.
type Request struct {
	_              struct{} `cbor:",toarray"`
	ProtocolMajor  uint16
	ProtocolMinor  uint16
	SchemaVersion  string
	RequestID      []byte
	OperationID    []byte
	ControllerID   string
	ActorID        string
	DeadlineMonoNS uint64
	PayloadHash    []byte
	Action         Action
	CorrelationID  string
	Payload        []byte
}

// Response là CBOR array cố định 13 phần tử.
type Response struct {
	_                struct{} `cbor:",toarray"`
	ProtocolMajor    uint16
	ProtocolMinor    uint16
	SchemaVersion    string
	RequestID        []byte
	OperationID      []byte
	CorrelationID    string
	Result           Result
	ActiveRevisionID *string
	LKGRevisionID    *string
	KeepsRunning     bool
	DetailCode       *string
	Component        string
	Payload          []byte
}

var (
	modeOnce sync.Once
	encMode  cbor.EncMode
	decMode  cbor.DecMode
	modeErr  error
)

func modes() (cbor.EncMode, cbor.DecMode, error) {
	modeOnce.Do(func() {
		encOptions := cbor.CanonicalEncOptions()
		encOptions.IndefLength = cbor.IndefLengthForbidden
		encOptions.TagsMd = cbor.TagsForbidden
		encMode, modeErr = encOptions.EncMode()
		if modeErr != nil {
			return
		}
		decMode, modeErr = (cbor.DecOptions{
			DupMapKey:         cbor.DupMapKeyEnforcedAPF,
			MaxNestedLevels:   8,
			MaxArrayElements:  256,
			MaxMapPairs:       64,
			IndefLength:       cbor.IndefLengthForbidden,
			TagsMd:            cbor.TagsForbidden,
			ExtraReturnErrors: cbor.ExtraDecErrorUnknownField,
		}).DecMode()
	})
	return encMode, decMode, modeErr
}

func EmptyPayload() []byte { return []byte{0x80} }

// EncodePayload là điểm duy nhất application dùng để tạo canonical CBOR cho
// payload riêng của action. Nhờ vậy payloadHash và kiểm tra canonical ở hai
// đầu không thể lệch vì package khác dùng options mặc định khác nhau.
func EncodePayload(value any) ([]byte, error) {
	mode, _, err := modes()
	if err != nil {
		return nil, err
	}
	payload, err := mode.Marshal(value)
	if err != nil {
		return nil, protocolError(ErrInvalidEnvelope, "payload", err)
	}
	if len(payload) == 0 || len(payload) > MaxFramePayload/2 {
		return nil, protocolError(ErrFrameTooLarge, "payload", nil)
	}
	return payload, nil
}

func DecodePayload(payload []byte, target any) error {
	if !canonicalCBOR(payload) {
		return protocolError(ErrInvalidEnvelope, "payload.canonicalCbor", nil)
	}
	_, mode, err := modes()
	if err != nil {
		return err
	}
	if err := mode.Unmarshal(payload, target); err != nil {
		return protocolError(ErrInvalidEnvelope, "payload", err)
	}
	return nil
}

func NewRequest(action Action, requestID, operationID []byte, controllerID, actorID, correlationID string, deadlineMonoNS uint64, payload []byte) Request {
	if payload == nil {
		payload = EmptyPayload()
	}
	hash := sha256.Sum256(payload)
	return Request{
		ProtocolMajor:  ProtocolMajor,
		ProtocolMinor:  ProtocolMinor,
		SchemaVersion:  SchemaVersion,
		RequestID:      append([]byte(nil), requestID...),
		OperationID:    append([]byte(nil), operationID...),
		ControllerID:   controllerID,
		ActorID:        actorID,
		DeadlineMonoNS: deadlineMonoNS,
		PayloadHash:    append([]byte(nil), hash[:]...),
		Action:         action,
		CorrelationID:  correlationID,
		Payload:        append([]byte(nil), payload...),
	}
}

func EncodeRequestFrame(request Request) ([]byte, error) {
	if err := ValidateRequest(request); err != nil {
		return nil, err
	}
	mode, _, err := modes()
	if err != nil {
		return nil, err
	}
	payload, err := mode.Marshal(request)
	if err != nil {
		return nil, protocolError(ErrInvalidEnvelope, "request", err)
	}
	return EncodeFrame(payload)
}

func DecodeRequestFrame(frame []byte) (Request, error) {
	payload, err := DecodeFrame(frame)
	if err != nil {
		return Request{}, err
	}
	_, mode, err := modes()
	if err != nil {
		return Request{}, err
	}
	var request Request
	if err := mode.Unmarshal(payload, &request); err != nil {
		return Request{}, protocolError(ErrInvalidEnvelope, "request", err)
	}
	if err := ValidateRequest(request); err != nil {
		return Request{}, err
	}
	canonical, err := encMode.Marshal(request)
	if err != nil || !equalBytes(canonical, payload) {
		return Request{}, protocolError(ErrInvalidEnvelope, "request.canonicalCbor", err)
	}
	return request, nil
}

func EncodeResponseFrame(response Response) ([]byte, error) {
	if err := ValidateResponse(response); err != nil {
		return nil, err
	}
	mode, _, err := modes()
	if err != nil {
		return nil, err
	}
	payload, err := mode.Marshal(response)
	if err != nil {
		return nil, protocolError(ErrInvalidEnvelope, "response", err)
	}
	return EncodeFrame(payload)
}

func DecodeResponseFrame(frame []byte) (Response, error) {
	payload, err := DecodeFrame(frame)
	if err != nil {
		return Response{}, err
	}
	_, mode, err := modes()
	if err != nil {
		return Response{}, err
	}
	var response Response
	if err := mode.Unmarshal(payload, &response); err != nil {
		return Response{}, protocolError(ErrInvalidEnvelope, "response", err)
	}
	if err := ValidateResponse(response); err != nil {
		return Response{}, err
	}
	canonical, err := encMode.Marshal(response)
	if err != nil || !equalBytes(canonical, payload) {
		return Response{}, protocolError(ErrInvalidEnvelope, "response.canonicalCbor", err)
	}
	return response, nil
}

func EncodeFrame(payload []byte) ([]byte, error) {
	if len(payload) == 0 {
		return nil, protocolError(ErrInvalidEnvelope, "frame.payload", nil)
	}
	if len(payload) > MaxFramePayload {
		return nil, protocolError(ErrFrameTooLarge, "frame.length", nil)
	}
	frame := make([]byte, 4+len(payload))
	binary.LittleEndian.PutUint32(frame[:4], uint32(len(payload)))
	copy(frame[4:], payload)
	return frame, nil
}

func DecodeFrame(frame []byte) ([]byte, error) {
	if len(frame) < 4 {
		return nil, protocolError(ErrFrameTruncated, "frame.length", nil)
	}
	length := binary.LittleEndian.Uint32(frame[:4])
	if length == 0 {
		return nil, protocolError(ErrInvalidEnvelope, "frame.length", nil)
	}
	if length > MaxFramePayload {
		return nil, protocolError(ErrFrameTooLarge, "frame.length", nil)
	}
	if uint64(length)+4 != uint64(len(frame)) {
		return nil, protocolError(ErrFrameTruncated, "frame.payload", nil)
	}
	return append([]byte(nil), frame[4:]...), nil
}

func ValidateRequest(request Request) error {
	if request.ProtocolMajor != ProtocolMajor {
		return protocolError(ErrUnsupportedMajor, "protocolMajor", nil)
	}
	if request.ProtocolMinor > ProtocolMinor {
		return protocolError(ErrUnsupportedMinor, "protocolMinor", nil)
	}
	if request.SchemaVersion != SchemaVersion {
		return protocolError(ErrUnsupportedMajor, "schemaVersion", nil)
	}
	if len(request.RequestID) != 16 {
		return protocolError(ErrInvalidEnvelope, "requestId", nil)
	}
	if request.ControllerID == "" || len(request.ControllerID) > MaxControllerID {
		return protocolError(ErrInvalidEnvelope, "controllerId", nil)
	}
	if len(request.ActorID) > MaxActorID {
		return protocolError(ErrInvalidEnvelope, "actorId", nil)
	}
	if request.DeadlineMonoNS == 0 {
		return protocolError(ErrInvalidEnvelope, "deadlineMonoNs", nil)
	}
	if len(request.PayloadHash) != sha256.Size {
		return protocolError(ErrInvalidEnvelope, "payloadHash", nil)
	}
	if len(request.Payload) == 0 || len(request.Payload) > MaxFramePayload/2 {
		return protocolError(ErrInvalidEnvelope, "payload", nil)
	}
	if !canonicalCBOR(request.Payload) {
		return protocolError(ErrInvalidEnvelope, "payload.canonicalCbor", nil)
	}
	actual := sha256.Sum256(request.Payload)
	if !equalBytes(request.PayloadHash, actual[:]) {
		return protocolError(ErrPayloadHash, "payloadHash", nil)
	}
	if !knownAction(request.Action) {
		return protocolError(ErrInvalidEnvelope, "action", nil)
	}
	if len(request.CorrelationID) < 16 || len(request.CorrelationID) > MaxCorrelationID || strings.ContainsAny(request.CorrelationID, " \t\r\n") {
		return protocolError(ErrInvalidEnvelope, "correlationId", nil)
	}
	if isMutation(request.Action) {
		if len(request.OperationID) != 16 {
			return protocolError(ErrOperationRequired, "operationId", nil)
		}
		if request.ActorID == "" {
			return protocolError(ErrInvalidEnvelope, "actorId", nil)
		}
	} else if len(request.OperationID) != 0 && len(request.OperationID) != 16 {
		return protocolError(ErrInvalidEnvelope, "operationId", nil)
	}
	return nil
}

func ValidateResponse(response Response) error {
	if response.ProtocolMajor != ProtocolMajor {
		return protocolError(ErrUnsupportedMajor, "protocolMajor", nil)
	}
	if response.ProtocolMinor > ProtocolMinor || response.SchemaVersion != SchemaVersion {
		return protocolError(ErrUnsupportedMinor, "protocolMinor", nil)
	}
	if len(response.RequestID) != 16 {
		return protocolError(ErrInvalidEnvelope, "requestId", nil)
	}
	if len(response.OperationID) != 0 && len(response.OperationID) != 16 {
		return protocolError(ErrInvalidEnvelope, "operationId", nil)
	}
	if len(response.CorrelationID) < 16 || len(response.CorrelationID) > MaxCorrelationID || strings.ContainsAny(response.CorrelationID, " \t\r\n") {
		return protocolError(ErrInvalidEnvelope, "correlationId", nil)
	}
	if !knownResult(response.Result) {
		return protocolError(ErrInvalidEnvelope, "result", nil)
	}
	if len(response.Payload) == 0 || len(response.Payload) > MaxFramePayload/2 {
		return protocolError(ErrFrameTooLarge, "payload", nil)
	}
	if !canonicalCBOR(response.Payload) {
		return protocolError(ErrInvalidEnvelope, "payload.canonicalCbor", nil)
	}
	return nil
}

func canonicalCBOR(payload []byte) bool {
	mode, decoder, err := modes()
	if err != nil {
		return false
	}
	var value any
	if err := decoder.Unmarshal(payload, &value); err != nil {
		return false
	}
	canonical, err := mode.Marshal(value)
	return err == nil && equalBytes(canonical, payload)
}

func knownAction(action Action) bool {
	switch action {
	case ActionCapabilities, ActionStatus, ActionStage, ActionActivate,
		ActionOperationStatus, ActionRestore, ActionTraceStart, ActionRetainReset,
		ActionSetProgramEnabled, ActionTraceStop, ActionTraceRead:
		return true
	}
	return false
}

func knownResult(result Result) bool {
	switch result {
	case ResultOK, ResultStaged, ResultAccepted, ResultRejected, ResultUnavailable, ResultBusy:
		return true
	}
	return false
}

func isMutation(action Action) bool {
	switch action {
	case ActionStage, ActionActivate, ActionRestore, ActionTraceStart, ActionRetainReset,
		ActionSetProgramEnabled, ActionTraceStop:
		// `TRACE_READ` KHÔNG nằm ở đây: nó chỉ đọc. Xếp một lệnh đọc vào nhóm
		// mutation sẽ buộc nó mang `operationId` và đi qua kiểm idempotency mà
		// nó không cần.
		return true
	}
	return false
}

func equalBytes(left, right []byte) bool {
	if len(left) != len(right) {
		return false
	}
	var difference byte
	for index := range left {
		difference |= left[index] ^ right[index]
	}
	return difference == 0
}

func ResponseFor(request Request, result Result, detailCode, component string, payload []byte) Response {
	if payload == nil {
		payload = EmptyPayload()
	}
	var detail *string
	if detailCode != "" {
		detail = &detailCode
	}
	return Response{
		ProtocolMajor: ProtocolMajor,
		ProtocolMinor: ProtocolMinor,
		SchemaVersion: SchemaVersion,
		RequestID:     append([]byte(nil), request.RequestID...),
		OperationID:   append([]byte(nil), request.OperationID...),
		CorrelationID: request.CorrelationID,
		Result:        result,
		KeepsRunning:  true,
		DetailCode:    detail,
		Component:     component,
		Payload:       append([]byte(nil), payload...),
	}
}

func Explain(err error) string {
	var protocol *ProtocolError
	if errors.As(err, &protocol) {
		return fmt.Sprintf("%s: %v", protocol.Field, protocol.Kind)
	}
	return err.Error()
}
