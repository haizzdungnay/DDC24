package coreipc

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func deterministicBytes(count int, start byte) []byte {
	output := make([]byte, count)
	for index := range output {
		output[index] = start + byte(index)
	}
	return output
}

func deterministicRequest(action Action) Request {
	var operationID []byte
	var actorID string
	if isMutation(action) {
		operationID = deterministicBytes(16, 0x10)
		actorID = "admin-1"
	}
	return NewRequest(
		action,
		deterministicBytes(16, 0x00),
		operationID,
		"controller-1",
		actorID,
		"correlation-id-0001",
		2_000_000,
		EmptyPayload(),
	)
}

func TestCodecRoundTripIsCanonical(t *testing.T) {
	request := deterministicRequest(ActionStage)
	frame, err := EncodeRequestFrame(request)
	if err != nil {
		t.Fatalf("EncodeRequestFrame() lỗi: %v", err)
	}
	decoded, err := DecodeRequestFrame(frame)
	if err != nil {
		t.Fatalf("DecodeRequestFrame() lỗi: %v", err)
	}
	reencoded, err := EncodeRequestFrame(decoded)
	if err != nil {
		t.Fatalf("EncodeRequestFrame(decoded) lỗi: %v", err)
	}
	if hex.EncodeToString(reencoded) != hex.EncodeToString(frame) {
		t.Fatal("canonical CBOR không byte-identical sau round-trip")
	}

	response := ResponseFor(request, ResultUnavailable, "IPC-CONTRACT-ONLY", "core.programming.ipc", EmptyPayload())
	responseFrame, err := EncodeResponseFrame(response)
	if err != nil {
		t.Fatalf("EncodeResponseFrame() lỗi: %v", err)
	}
	decodedResponse, err := DecodeResponseFrame(responseFrame)
	if err != nil {
		t.Fatalf("DecodeResponseFrame() lỗi: %v", err)
	}
	if decodedResponse.Result != ResultUnavailable || !decodedResponse.KeepsRunning {
		t.Fatalf("response không giữ semantics fail-closed: %+v", decodedResponse)
	}
}

func TestCodecRejectsMalformedFramesAndEnvelope(t *testing.T) {
	request := deterministicRequest(ActionCapabilities)
	valid, err := EncodeRequestFrame(request)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name  string
		frame []byte
		want  error
	}{
		{name: "header bị cắt", frame: []byte{1, 0, 0}, want: ErrFrameTruncated},
		{name: "payload bị cắt", frame: valid[:len(valid)-1], want: ErrFrameTruncated},
		{name: "frame quá lớn", frame: []byte{1, 0, 1, 0}, want: ErrFrameTooLarge},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := DecodeRequestFrame(test.frame)
			if !errors.Is(err, test.want) {
				t.Fatalf("lỗi = %v, cần %v", err, test.want)
			}
		})
	}

	request.PayloadHash[0] ^= 0xff
	if _, err := EncodeRequestFrame(request); !errors.Is(err, ErrPayloadHash) {
		t.Fatalf("payload hash sai không bị chặn: %v", err)
	}
	mutation := deterministicRequest(ActionStage)
	mutation.OperationID = nil
	if _, err := EncodeRequestFrame(mutation); !errors.Is(err, ErrOperationRequired) {
		t.Fatalf("mutation thiếu operationId không bị chặn: %v", err)
	}
	newerMinor := deterministicRequest(ActionCapabilities)
	newerMinor.ProtocolMinor = ProtocolMinor + 1
	if _, err := EncodeRequestFrame(newerMinor); !errors.Is(err, ErrUnsupportedMinor) {
		t.Fatalf("protocol minor mới hơn không bị chặn: %v", err)
	}
	nonCanonicalPayload := NewRequest(
		ActionCapabilities,
		deterministicBytes(16, 0),
		nil,
		"controller-1",
		"",
		"correlation-id-0001",
		2_000_000,
		[]byte{0x9f, 0xff},
	)
	if _, err := EncodeRequestFrame(nonCanonicalPayload); !errors.Is(err, ErrInvalidEnvelope) {
		t.Fatalf("payload indefinite CBOR không bị chặn: %v", err)
	}

	// protocolMajor=1 được cố ý mã hoá bằng dạng uint8 hai byte (0x18 0x01)
	// thay vì dạng canonical một byte.
	nonCanonicalEnvelope := append([]byte(nil), valid...)
	nonCanonicalEnvelope = append(nonCanonicalEnvelope[:5], append([]byte{0x18}, nonCanonicalEnvelope[5:]...)...)
	nonCanonicalEnvelope[0]++
	if _, err := DecodeRequestFrame(nonCanonicalEnvelope); !errors.Is(err, ErrInvalidEnvelope) {
		t.Fatalf("envelope CBOR không canonical không bị chặn: %v", err)
	}
}

func goldenFrames(t *testing.T) map[string][]byte {
	t.Helper()
	request := deterministicRequest(ActionCapabilities)
	requestFrame, err := EncodeRequestFrame(request)
	if err != nil {
		t.Fatal(err)
	}
	response := ResponseFor(request, ResultUnavailable, "IPC-CONTRACT-ONLY", "core.programming.ipc", EmptyPayload())
	responseFrame, err := EncodeResponseFrame(response)
	if err != nil {
		t.Fatal(err)
	}
	unknown := request
	unknown.ProtocolMajor = 2
	mode, _, err := modes()
	if err != nil {
		t.Fatal(err)
	}
	payload, err := mode.Marshal(unknown)
	if err != nil {
		t.Fatal(err)
	}
	unknownFrame, err := EncodeFrame(payload)
	if err != nil {
		t.Fatal(err)
	}
	return map[string][]byte{
		"request_capabilities.hex":  requestFrame,
		"response_unavailable.hex":  responseFrame,
		"request_unknown_major.hex": unknownFrame,
	}
}

func contractGoldenDir(t *testing.T) string {
	t.Helper()
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("không xác định được đường dẫn codec_test.go")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(source), "../../../../../contracts/ipc/programming_v1/golden"))
}

func TestGoldenCorpusMatchesCanonicalCodec(t *testing.T) {
	for name, expected := range goldenFrames(t) {
		content, err := os.ReadFile(filepath.Join(contractGoldenDir(t), name))
		if err != nil {
			t.Errorf("thiếu golden %s; nội dung cần ghi: %s", name, hex.EncodeToString(expected))
			continue
		}
		actual, err := hex.DecodeString(strings.TrimSpace(string(content)))
		if err != nil {
			t.Fatalf("golden %s không phải hex hợp lệ: %v", name, err)
		}
		if hex.EncodeToString(actual) != hex.EncodeToString(expected) {
			t.Fatalf("golden %s drift; nội dung đúng: %s", name, hex.EncodeToString(expected))
		}
		if name == "request_unknown_major.hex" {
			if _, err := DecodeRequestFrame(actual); !errors.Is(err, ErrUnsupportedMajor) {
				t.Fatalf("negative golden không bị chặn: %v", err)
			}
		}
	}
}

func TestGoldenManifestPinsSchemaAndCorpus(t *testing.T) {
	type goldenEntry struct {
		SHA256 string `json:"sha256"`
	}
	var manifest struct {
		SchemaSHA256 string                 `json:"schemaSha256"`
		Files        map[string]goldenEntry `json:"files"`
	}
	directory := contractGoldenDir(t)
	content, err := os.ReadFile(filepath.Join(directory, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(content, &manifest); err != nil {
		t.Fatalf("manifest không hợp lệ: %v", err)
	}
	assertHash := func(path, expected string) {
		t.Helper()
		actual, readErr := os.ReadFile(path)
		if readErr != nil {
			t.Fatal(readErr)
		}
		digest := fmt.Sprintf("%x", sha256.Sum256(actual))
		if digest != expected {
			t.Fatalf("SHA-256 drift ở %s: got %s want %s", path, digest, expected)
		}
	}
	assertHash(filepath.Join(directory, "..", "schema.json"), manifest.SchemaSHA256)
	for name, entry := range manifest.Files {
		assertHash(filepath.Join(directory, name), entry.SHA256)
	}
}

// T59-405 — nâng `protocolMinor` 0 -> 1 phải TƯƠNG THÍCH NGƯỢC. Một client cũ
// vẫn gửi minor=0 và server mới phải nhận; đó chính là lý do action mới được
// thêm bằng cách tăng minor thay vì đổi `schemaVersion` trên dây — đổi
// `schemaVersion` sẽ làm mọi Core phiên bản cũ từ chối MỌI request.
func TestOlderProtocolMinorIsStillAccepted(t *testing.T) {
	request := NewRequest(ActionCapabilities, make([]byte, 16), nil, "controller-1", "",
		"correlation-id-0001", 2000000, EmptyPayload())
	request.ProtocolMinor = 0
	frame, err := EncodeRequestFrame(request)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeRequestFrame(frame)
	if err != nil {
		t.Fatalf("request minor=0 bị từ chối: %v", err)
	}
	if decoded.ProtocolMinor != 0 {
		t.Fatalf("minor=%d", decoded.ProtocolMinor)
	}

	// Minor CAO hơn bị chặn ngay ở lớp mã hoá: dựng một frame tự nhận hiểu một
	// hợp đồng chưa tồn tại là lỗi của phía gửi, không phải thứ để phía nhận
	// phát hiện muộn.
	request.ProtocolMinor = ProtocolMinor + 1
	if _, err := EncodeRequestFrame(request); !errors.Is(err, ErrUnsupportedMinor) {
		t.Fatalf("minor cao hơn không bị chặn: %v", err)
	}
}

// Action mới phải được cả bảng `knownAction` lẫn bảng `isMutation` nhận. Thiếu
// bảng thứ hai thì một mutation đi qua đường không cần `operationId`, và Core
// mất khả năng đối chiếu lệnh với operation nào.
func TestSetProgramEnabledIsAKnownMutation(t *testing.T) {
	if !knownAction(ActionSetProgramEnabled) {
		t.Fatal("SET_PROGRAM_ENABLED không nằm trong knownAction")
	}
	if !isMutation(ActionSetProgramEnabled) {
		t.Fatal("SET_PROGRAM_ENABLED không được coi là mutation")
	}
}

// T59-408 — "action ma = 0": mọi action khai trong contract phải có handler
// THẬT ở Core, và mọi action Go biết phải có mặt trong contract.
//
// Một action khai mà không ai xử lý là một lời hứa suông: client thấy nó trong
// hợp đồng, gọi nó, và nhận `UNAVAILABLE` — hoặc tệ hơn, nhận `OK` rỗng. Chiều
// ngược lại cũng vậy: một action Go gửi mà contract không khai là một đường đi
// không ai review.
func TestNoGhostActionsInContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(contractGoldenDir(t), "..", "schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	handlers := findHandlerTable(document)
	if len(handlers) == 0 {
		t.Fatal("không tìm thấy bảng handler trong schema")
	}
	declared := make(map[string]struct{}, len(handlers))
	for _, entry := range handlers {
		item, ok := entry.(map[string]any)
		if !ok {
			t.Fatalf("handler entry không phải object: %v", entry)
		}
		action, _ := item["action"].(string)
		status, _ := item["handlerStatus"].(string)
		if status != "IMPLEMENTED" {
			t.Fatalf("action ma: %q có handlerStatus=%q", action, status)
		}
		declared[action] = struct{}{}
		if !knownAction(Action(action)) {
			t.Fatalf("contract khai %q nhưng Go không biết action đó", action)
		}
	}
	for _, action := range []Action{ActionCapabilities, ActionStatus, ActionStage, ActionActivate,
		ActionOperationStatus, ActionRestore, ActionTraceStart, ActionRetainReset,
		ActionSetProgramEnabled, ActionTraceStop, ActionTraceRead} {
		if _, ok := declared[string(action)]; !ok {
			t.Fatalf("Go biết action %q nhưng contract không khai", action)
		}
	}
}

// findHandlerTable tìm mảng handler trong schema mà không phụ thuộc vị trí — vị
// trí là chi tiết trình bày, còn sự tồn tại của bảng mới là hợp đồng.
func findHandlerTable(node any) []any {
	switch value := node.(type) {
	case map[string]any:
		for _, child := range value {
			if found := findHandlerTable(child); found != nil {
				return found
			}
		}
	case []any:
		if len(value) > 0 {
			if first, ok := value[0].(map[string]any); ok {
				if _, has := first["handlerStatus"]; has {
					return value
				}
			}
		}
		for _, child := range value {
			if found := findHandlerTable(child); found != nil {
				return found
			}
		}
	}
	return nil
}
