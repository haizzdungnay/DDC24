package application

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"

	"mkddc-web/internal/programming/canonicaljson"
	programmingcompiler "mkddc-web/internal/programming/compiler"
	"mkddc-web/internal/programming/domain"
)

// Manifest package cấp Check — F-P59-MANIFEST-001 (`T59-305`).
//
// TRIỆU CHỨNG đã sửa ở đây: topology và resource budget được TÍNH ở
// `checks_topology.go` rồi truyền vào `packageCheckManifestWith`, nhưng hàm đó
// không bao giờ ghi chúng vào tài liệu trả về — hai tham số nằm trong chữ ký mà
// không xuất hiện trong struct được marshal (Go không cảnh báo tham số thừa).
// Hệ quả: manifest mà Check lưu lại KHÔNG mô tả thứ runtime sẽ chạy, nên không
// có cách nào chứng minh gói đang chạy chính là gói vừa được Check.
//
// Manifest v3 vì vậy mang ĐỦ mặt cắt mà DDD §5.3 liệt kê cho package v2:
// topology (Program/chu kỳ/thứ tự), resource budget, đồ thị POU, khai báo signal,
// binding manifest, và bộ version pin (profile/compiler/library lock).
const packageManifestSchemaVersion = 3

// maxCheckManifestBytes — trần cho chính tài liệu manifest. 32 Program × (POU +
// binding + signal) vẫn nằm xa dưới mức này; trần tồn tại để một Revision hỏng
// không biến manifest thành đường dẫn tới cấp phát không giới hạn.
const maxCheckManifestBytes = 4 << 20

type packageLibraryLock struct {
	SystemRegistryID         string `json:"systemRegistryId"`
	SystemVersion            string `json:"systemVersion"`
	SystemRegistrySHA256     string `json:"systemRegistrySha256"`
	ProjectLibraryRevisionID string `json:"projectLibraryRevisionId"`
	ProjectLibraryVersion    string `json:"projectLibraryVersion"`
	ProjectManifestSHA256    string `json:"projectManifestSha256"`
}

type packageManifestVersions struct {
	ProfileID       string             `json:"profileId"`
	ProfileCode     int                `json:"profileCode"`
	ProfileSHA256   string             `json:"profileSha256"`
	TargetABI       int64              `json:"targetAbi"`
	CompilerVersion string             `json:"compilerVersion"`
	IntegrityMode   string             `json:"integrityMode"`
	LibraryLock     packageLibraryLock `json:"libraryLock"`
}

// packagePouNode là một đỉnh của đồ thị POU. `contentSha256` băm chính payload
// đã seal của Revision object, nên hai Revision có cùng đồ thị POU cho cùng dãy
// hash — đó là điều kiện để so sánh hai package bằng manifest thay vì bằng byte.
type packagePouNode struct {
	ObjectID      string   `json:"objectId"`
	Kind          string   `json:"kind"`
	Name          string   `json:"name"`
	Language      string   `json:"language"`
	ContentSHA256 string   `json:"contentSha256"`
	Dependencies  []string `json:"dependencies"`
}

type packageManifestSignal struct {
	SignalID           string   `json:"signalId"`
	Name               string   `json:"name"`
	Type               string   `json:"type"`
	Unit               *string  `json:"unit"`
	PublisherProgramID string   `json:"publisherProgramId"`
	FreshnessMs        int64    `json:"freshnessMs"`
	StalePolicy        string   `json:"stalePolicy"`
	FallbackValue      *float64 `json:"fallbackValue"`
}

type packageManifestBinding struct {
	BindingID  string `json:"bindingId"`
	ProgramID  string `json:"programId"`
	VariableID string `json:"variableId"`
	Variable   string `json:"variable"`
	Direction  string `json:"direction"`
	Category   string `json:"category"`
	PointID    string `json:"pointId"`
	DeviceID   string `json:"deviceId"`
	ExtIndex   int    `json:"extIndex"`
	// `AC-PIO-ID-02` — bốn trường này khoá THỨ MÀ SLOT TRỎ TỚI, không chỉ số
	// slot. Không có chúng, Commission chỉ đối chiếu được `extIndex`, mà
	// `extIndex` giữ nguyên vẫn có thể trỏ vào một thanh ghi/kiểu/quyền khác.
	//
	// Chỉ có nghĩa với MB_RTU nên `omitempty`: gắn chúng vào điểm LOCAL/VP là
	// mở bốn trường vô nghĩa mà lớp sau phải đoán có nên tin hay không.
	RegisterType string `json:"registerType,omitempty"`
	// Address là CON TRỎ, không phải `int`, vì `omitempty` trên `int` không
	// phân biệt được "không có trường" với "địa chỉ 0" — mà `modbusrtu/
	// validate.go` cho `address ∈ 0..65535`, nên 0 là một thanh ghi dùng được
	// thật. Với `int`, một binding đã duyệt trên thanh ghi 0 sẽ đi vào manifest
	// KHÔNG mang địa chỉ, và Commission bỏ luôn phép so địa chỉ cho đúng binding
	// ấy. Ba trường kia là chuỗi nên `""` không đụng miền giá trị hợp lệ.
	Address    *int   `json:"address,omitempty"`
	ModbusType string `json:"modbusDataType,omitempty"`
	ReadWrite  string `json:"readWrite,omitempty"`
	Writable   bool   `json:"writable"`
}

// packageCheckManifest — thứ tự field ở đây LÀ thứ tự byte của manifest
// (`encoding/json` marshal struct theo thứ tự khai báo). Đổi thứ tự khai báo là
// đổi `contentSha256`, nên nó là một thay đổi hợp đồng chứ không phải dọn dẹp.
type packageCheckManifest struct {
	SchemaVersion    int                      `json:"schemaVersion"`
	ProgramCount     int                      `json:"programCount"`
	ContentSHA256    string                   `json:"contentSha256"`
	ContainerSHA256  string                   `json:"containerSha256"`
	ContainerBytes   int64                    `json:"containerBytes"`
	Versions         packageManifestVersions  `json:"versions"`
	Topology         []packageProgramTopology `json:"topology"`
	Budget           packageBudget            `json:"budget"`
	PouGraph         []packagePouNode         `json:"pouGraph"`
	Signals          []packageManifestSignal  `json:"signals"`
	Bindings         []packageManifestBinding `json:"bindings"`
	Artifacts        []packageProgramArtifact `json:"artifacts"`
	ProgramManifests []json.RawMessage        `json:"programManifests"`
}

// packagePouGraph dựng đồ thị POU tất định từ chính các object đã seal.
func packagePouGraph(objects []revisionObjectView) []packagePouNode {
	nodes := make([]packagePouNode, 0, len(objects))
	for _, object := range objects {
		switch object.Kind {
		case "PROGRAM", "FUNCTION", "FUNCTION_BLOCK":
		default:
			continue
		}
		var payload struct {
			ObjectID     string   `json:"objectId"`
			Name         string   `json:"name"`
			Language     string   `json:"language"`
			Dependencies []string `json:"dependencies"`
		}
		if json.Unmarshal(object.Payload, &payload) != nil {
			continue
		}
		digest := sha256.Sum256(object.Payload)
		dependencies := append([]string(nil), payload.Dependencies...)
		sort.Strings(dependencies)
		if dependencies == nil {
			dependencies = []string{}
		}
		nodes = append(nodes, packagePouNode{ObjectID: object.ObjectID, Kind: object.Kind,
			Name: payload.Name, Language: payload.Language,
			ContentSHA256: hex.EncodeToString(digest[:]), Dependencies: dependencies})
	}
	sort.Slice(nodes, func(left, right int) bool { return nodes[left].ObjectID < nodes[right].ObjectID })
	return nodes
}

// packageManifestSignals và packageManifestBindings đọc qua ĐÚNG
// `collectPackageObjects` mà `packageInvariantDiagnostics` dùng. Một bộ đọc thứ
// hai cho cùng dữ liệu là chỗ để manifest và phép kiểm bất biến trôi khỏi nhau.
func packageManifestSignals(objects []revisionObjectView) []packageManifestSignal {
	_, signals, _ := collectPackageObjects(objects)
	result := make([]packageManifestSignal, 0, len(signals))
	for _, signal := range signals {
		var unit *string
		if signal.unit != "" {
			value := signal.unit
			unit = &value
		}
		result = append(result, packageManifestSignal{SignalID: signal.signalID, Name: signal.name,
			Type: signal.dataType, Unit: unit, PublisherProgramID: signal.publisherID,
			FreshnessMs: int64(signal.freshnessMs), StalePolicy: signal.stalePolicy,
			FallbackValue: signal.fallbackValue})
	}
	sort.Slice(result, func(left, right int) bool { return result[left].SignalID < result[right].SignalID })
	return result
}

// packageManifestBindings ghi lại binding NHƯ ĐÃ BIÊN DỊCH, không như đã lưu.
//
// `ISS-PIO-31`: với MB_RTU, `extIndex` đi vào artifact là số PHÂN GIẢI LẠI từ
// cấu hình đang chạy (`ioMapFromRevision`), không phải số nằm trong payload
// binding. Manifest là hồ sơ as-built và là thứ Commission đối chiếu lại, nên
// ghi số cũ ở đây sẽ làm hồ sơ nói một đằng còn artifact chạy một nẻo — đúng
// loại lệch mà cả issue này sinh ra để chặn.
func packageManifestBindings(objects []revisionObjectView, slots *ModbusSlotSnapshot) []packageManifestBinding {
	bindings, _, _ := collectPackageObjects(objects)
	result := make([]packageManifestBinding, 0, len(bindings))
	for _, binding := range bindings {
		category := binding.category
		if category == "" {
			category = "LOCAL"
		}
		extIndex := binding.extIndex
		var target ModbusSlot
		targetResolved := false
		if category == "MB_RTU" {
			/* Check đã CHẶN mọi ca không phân giải được trước khi tới đây, nên
			 * nhánh lỗi ở đây là "không thể xảy ra". Giữ nguyên số cũ trong
			 * trường hợp đó là lựa chọn an toàn hơn im lặng ghi 0: Commission
			 * sẽ đối chiếu lại và chặn. */
			if resolved, reason := resolveModbusExtIndex(slots, binding.deviceID, binding.pointID,
				binding.extIndex); reason == "" {
				extIndex = resolved
				if slots != nil {
					target, targetResolved = slots.Lookup(binding.deviceID, binding.pointID)
				}
			}
		}
		/* Địa chỉ chỉ được ghi khi ĐÃ TRA ĐƯỢC điểm thật. Ghi `0` cho một
		 * binding chưa phân giải được là bịa ra một thanh ghi, và Commission
		 * sẽ đem con số bịa đó đi so. */
		var address *int
		if targetResolved {
			value := target.Address
			address = &value
		}
		result = append(result, packageManifestBinding{BindingID: binding.bindingID,
			ProgramID: binding.programID, VariableID: binding.variableID, Variable: binding.variable,
			Direction: binding.direction, Category: category, PointID: binding.pointID,
			DeviceID: binding.deviceID, ExtIndex: extIndex,
			RegisterType: target.RegisterType, Address: address,
			ModbusType: target.DataType, ReadWrite: target.ReadWrite,
			Writable: binding.writable})
	}
	sort.Slice(result, func(left, right int) bool { return result[left].BindingID < result[right].BindingID })
	return result
}

// packageLibraryLockFrom đọc khoá version library. SYSTEM registry lấy từ hằng
// sinh ra từ chính contract (`domain`), không từ payload: payload là dữ liệu của
// người dùng, còn registry SYSTEM là dữ liệu của bản build. PROJECT library thì
// ngược lại — nó thuộc Revision, nên đọc từ object `METADATA` đã seal.
func packageLibraryLockFrom(objects []revisionObjectView, revisionLibraryID string) packageLibraryLock {
	lock := packageLibraryLock{
		SystemRegistryID:         domain.SystemLibraryRegistryID,
		SystemVersion:            domain.SystemLibraryVersion,
		SystemRegistrySHA256:     domain.SystemLibraryRegistrySHA256,
		ProjectLibraryRevisionID: revisionLibraryID,
	}
	if lock.ProjectLibraryRevisionID != "" {
		return lock
	}
	for _, object := range objects {
		if object.Kind != "METADATA" {
			continue
		}
		var payload struct {
			Library struct {
				ProjectLibraryRevisionID *string `json:"projectLibraryRevisionId"`
			} `json:"library"`
		}
		if json.Unmarshal(object.Payload, &payload) != nil {
			continue
		}
		if payload.Library.ProjectLibraryRevisionID != nil {
			lock.ProjectLibraryRevisionID = *payload.Library.ProjectLibraryRevisionID
		}
	}
	return lock
}

// buildPackageCheckManifest lắp tài liệu và tự KIỂM nó trước khi trả về.
//
// Kiểm ngay tại nơi sinh ra là chủ ý: một manifest hỏng không được đi tiếp tới
// chỗ nó được ghi vào kết quả Check "PASSED". Fail-closed ở đây làm Check báo
// lỗi worker, còn để nó đi tiếp thì hệ thống nói "đạt" trên một hồ sơ sai.
func buildPackageCheckManifest(input packageManifestInput) (json.RawMessage, error) {
	document := packageCheckManifest{
		SchemaVersion: packageManifestSchemaVersion,
		ProgramCount:  len(input.Artifacts),
		Versions: packageManifestVersions{
			ProfileID: domain.ProfileID, ProfileCode: domain.ProfileCode,
			ProfileSHA256: domain.ProfileSHA256, TargetABI: domain.ProfileTargetABI,
			CompilerVersion: checkCompilerVersion, IntegrityMode: input.IntegrityMode,
			LibraryLock: input.LibraryLock,
		},
		Topology:         input.Topology,
		Budget:           input.Budget,
		PouGraph:         input.PouGraph,
		Signals:          input.Signals,
		Bindings:         input.Bindings,
		Artifacts:        input.Artifacts,
		ProgramManifests: input.ProgramManifests,
	}
	if document.Topology == nil {
		document.Topology = []packageProgramTopology{}
	}
	if document.PouGraph == nil {
		document.PouGraph = []packagePouNode{}
	}
	if document.Signals == nil {
		document.Signals = []packageManifestSignal{}
	}
	if document.Bindings == nil {
		document.Bindings = []packageManifestBinding{}
	}
	if document.Artifacts == nil {
		document.Artifacts = []packageProgramArtifact{}
	}
	if document.ProgramManifests == nil {
		document.ProgramManifests = []json.RawMessage{}
	}

	// `contentSha256` băm TOÀN BỘ phần nội dung của manifest, không chỉ dãy
	// (programId, artifactSha256) như bản cũ. Băm một phần nội dung rồi gọi nó
	// là hash nội dung nghĩa là mọi trường ngoài phần đó có thể đổi mà hash
	// không đổi — tức là hash không trả lời được câu hỏi nó được đặt ra để trả
	// lời. Ba trường tự tham chiếu (`contentSha256`, `containerSha256`,
	// `containerBytes`) bị loại khỏi phép băm: container được ghi SAU khi nội
	// dung đã chốt.
	contentHash, err := packageManifestContentHash(document)
	if err != nil {
		return nil, err
	}
	document.ContentSHA256 = contentHash
	document.ContainerSHA256 = input.ContainerSHA256
	document.ContainerBytes = input.ContainerBytes

	raw, err := json.Marshal(document)
	if err != nil {
		return nil, err
	}
	if err := validatePackageCheckManifest(raw); err != nil {
		return nil, fmt.Errorf("manifest package không hợp lệ: %w", err)
	}
	return raw, nil
}

type packageManifestInput struct {
	Artifacts        []packageProgramArtifact
	ProgramManifests []json.RawMessage
	Topology         []packageProgramTopology
	Budget           packageBudget
	PouGraph         []packagePouNode
	Signals          []packageManifestSignal
	Bindings         []packageManifestBinding
	LibraryLock      packageLibraryLock
	IntegrityMode    string
	ContainerSHA256  string
	ContainerBytes   int64
}

// packageManifestContentHash loại đúng ba field tự tham chiếu rồi băm toàn bộ
// phần còn lại. Cả writer và verifier gọi cùng phép biến đổi, nên đổi topology,
// budget, POU, signal, binding hoặc manifest con đều bắt buộc đổi hash.
func packageManifestContentHash(document packageCheckManifest) (string, error) {
	document.ContentSHA256 = ""
	document.ContainerSHA256 = ""
	document.ContainerBytes = 0
	body, err := json.Marshal(document)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:]), nil
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

// validatePackageCheckManifest từ chối manifest thiếu trường, sai kiểu, trùng
// khoá hoặc có giá trị ngoài dải.
//
// Nó làm việc trên MAP chứ không trên struct vì bốn lớp lỗi trên không phát hiện
// được bằng `json.Unmarshal` vào struct: khoá thiếu cho ra zero value im lặng,
// khoá trùng lấy giá trị cuối im lặng, và khoá thừa bị bỏ qua im lặng.
// `canonicaljson.Object` là lớp chặn trùng khoá (kể cả trùng sau chuẩn hoá NFC).
func validatePackageCheckManifest(raw []byte) error {
	canonical, err := canonicaljson.Object(raw, maxCheckManifestBytes)
	if err != nil {
		return err
	}
	root, err := decodeManifestObject(canonical)
	if err != nil {
		return err
	}
	fields, err := exactFields("", root, "schemaVersion", "programCount", "contentSha256",
		"containerSha256", "containerBytes", "versions", "topology", "budget", "pouGraph",
		"signals", "bindings", "artifacts", "programManifests")
	if err != nil {
		return err
	}

	if value, err := intField(fields, "schemaVersion"); err != nil {
		return err
	} else if value != packageManifestSchemaVersion {
		return fmt.Errorf("schemaVersion=%d; cần %d", value, packageManifestSchemaVersion)
	}
	if err := hexField(fields, "contentSha256", true); err != nil {
		return err
	}
	var typed packageCheckManifest
	if err := json.Unmarshal(raw, &typed); err != nil {
		return fmt.Errorf("đọc manifest typed: %w", err)
	}
	expectedContentHash, err := packageManifestContentHash(typed)
	if err != nil {
		return err
	}
	if typed.ContentSHA256 != expectedContentHash {
		return fmt.Errorf("contentSha256=%s không khớp nội dung %s",
			typed.ContentSHA256, expectedContentHash)
	}
	containerSHA, err := stringField(fields, "containerSha256")
	if err != nil {
		return err
	}
	containerBytes, err := intField(fields, "containerBytes")
	if err != nil {
		return err
	}
	if containerSHA != "" {
		if err := hexField(fields, "containerSha256", true); err != nil {
			return err
		}
		if containerBytes <= 0 {
			return fmt.Errorf("containerSha256 có nhưng containerBytes=%d", containerBytes)
		}
	} else if containerBytes != 0 {
		// Một kích thước container không kèm hash là một con số không ai kiểm
		// được. Hai trường này phải cùng có hoặc cùng không.
		return fmt.Errorf("containerBytes=%d nhưng không có containerSha256", containerBytes)
	}

	if err := validateManifestVersions(fields); err != nil {
		return err
	}
	objectIDs, programIDs, programOrder, periods, err := validateManifestTopology(fields)
	if err != nil {
		return err
	}
	programCount, err := intField(fields, "programCount")
	if err != nil {
		return err
	}
	if programCount != int64(len(periods)) {
		return fmt.Errorf("programCount=%d nhưng topology có %d dòng", programCount, len(periods))
	}
	if programCount < 1 || programCount > int64(domain.MaxProgramsTotal) {
		return fmt.Errorf("programCount=%d ngoài dải 1..%d", programCount, domain.MaxProgramsTotal)
	}
	if err := validateManifestBudget(fields, periods); err != nil {
		return err
	}
	if err := validateManifestPouGraph(fields, objectIDs); err != nil {
		return err
	}
	if err := validateManifestSignals(fields, programIDs); err != nil {
		return err
	}
	if err := validateManifestBindings(fields, programIDs); err != nil {
		return err
	}
	if err := validateManifestArtifacts(fields, programOrder, int(programCount)); err != nil {
		return err
	}
	return validateManifestProgramManifests(fields, int(programCount))
}

func validateManifestVersions(root map[string]any) error {
	object, err := objectField(root, "versions")
	if err != nil {
		return err
	}
	fields, err := exactFields("versions.", object, "profileId", "profileCode", "profileSha256",
		"targetAbi", "compilerVersion", "integrityMode", "libraryLock")
	if err != nil {
		return err
	}
	for key, want := range map[string]string{
		"profileId": domain.ProfileID, "profileSha256": domain.ProfileSHA256,
		"compilerVersion": checkCompilerVersion,
	} {
		value, err := stringField(fields, key)
		if err != nil {
			return err
		}
		if value != want {
			return fmt.Errorf("versions.%s=%q; cần %q", key, value, want)
		}
	}
	for key, want := range map[string]int64{
		"profileCode": int64(domain.ProfileCode), "targetAbi": domain.ProfileTargetABI,
	} {
		value, err := intField(fields, key)
		if err != nil {
			return err
		}
		if value != want {
			return fmt.Errorf("versions.%s=%d; cần %d", key, value, want)
		}
	}
	// `integrityMode` là TRẠNG THÁI của artifact (`HASH_ONLY`/`SIGNED`), không
	// phải tên CHÍNH SÁCH của profile (`HASH_ONLY`/`SIGNATURE_REQUIRED`). Ghi
	// nhầm tên chính sách vào ô trạng thái là lỗi đã xảy ra một lần ở `T59-607`.
	mode, err := stringField(fields, "integrityMode")
	if err != nil {
		return err
	}
	if mode != "HASH_ONLY" && mode != "SIGNED" {
		return fmt.Errorf("versions.integrityMode=%q ngoài {HASH_ONLY,SIGNED}", mode)
	}

	lockObject, err := objectField(fields, "libraryLock")
	if err != nil {
		return err
	}
	lock, err := exactFields("versions.libraryLock.", lockObject, "systemRegistryId", "systemVersion",
		"systemRegistrySha256", "projectLibraryRevisionId", "projectLibraryVersion",
		"projectManifestSha256")
	if err != nil {
		return err
	}
	for key, want := range map[string]string{
		"systemRegistryId": domain.SystemLibraryRegistryID, "systemVersion": domain.SystemLibraryVersion,
		"systemRegistrySha256": domain.SystemLibraryRegistrySHA256,
	} {
		value, err := stringField(lock, key)
		if err != nil {
			return err
		}
		if value != want {
			return fmt.Errorf("versions.libraryLock.%s=%q; cần %q", key, value, want)
		}
	}
	project, err := stringField(lock, "projectLibraryRevisionId")
	if err != nil {
		return err
	}
	if project != "" && !isUUID(project) {
		return fmt.Errorf("versions.libraryLock.projectLibraryRevisionId=%q không phải UUIDv4", project)
	}
	projectVersion, err := stringField(lock, "projectLibraryVersion")
	if err != nil {
		return err
	}
	projectManifest, err := stringField(lock, "projectManifestSha256")
	if err != nil {
		return err
	}
	if project == "" {
		if projectVersion != "" || projectManifest != "" {
			return fmt.Errorf("versions.libraryLock có metadata PROJECT nhưng thiếu revisionId")
		}
	} else if projectVersion == "" {
		return fmt.Errorf("versions.libraryLock metadata PROJECT thiếu/sai")
	} else if err := hexField(lock, "projectManifestSha256", true); err != nil {
		return fmt.Errorf("versions.libraryLock metadata PROJECT: %w", err)
	}
	return nil
}

// validateManifestTopology trả về tập `objectId` của Program và dãy chu kỳ theo
// đúng thứ tự công bố, để hai phép kiểm phía sau (budget, đồ thị POU) không phải
// duyệt lại topology bằng một bộ đọc khác.
func validateManifestTopology(root map[string]any) (map[string]struct{}, map[string]struct{}, []string, []int64, error) {
	items, err := arrayField(root, "topology")
	if err != nil {
		return nil, nil, nil, nil, err
	}
	objectIDs := make(map[string]struct{}, len(items))
	programIDs := make(map[string]struct{}, len(items))
	programOrder := make([]string, 0, len(items))
	periods := make([]int64, 0, len(items))
	previous := ""
	for index, item := range items {
		prefix := fmt.Sprintf("topology[%d].", index)
		object, ok := item.(map[string]any)
		if !ok {
			return nil, nil, nil, nil, fmt.Errorf("%s không phải object", prefix)
		}
		fields, err := exactFields(prefix, object, "objectId", "programId", "name", "order",
			"periodMs", "budgetUs", "desiredEnabled")
		if err != nil {
			return nil, nil, nil, nil, err
		}
		objectID, err := uuidField(fields, prefix, "objectId")
		if err != nil {
			return nil, nil, nil, nil, err
		}
		programID, err := uuidField(fields, prefix, "programId")
		if err != nil {
			return nil, nil, nil, nil, err
		}
		// Sắp NGẶT tăng dần theo `objectId`: nó vừa ép thứ tự tất định vừa loại
		// trùng Program bằng một phép so duy nhất.
		if index > 0 && objectID <= previous {
			return nil, nil, nil, nil, fmt.Errorf("%sobjectId=%q không tăng ngặt sau %q (trùng hoặc sai thứ tự)",
				prefix, objectID, previous)
		}
		previous = objectID
		objectIDs[objectID] = struct{}{}
		if _, duplicate := programIDs[programID]; duplicate {
			return nil, nil, nil, nil, fmt.Errorf("%sprogramId=%q bị trùng trong topology", prefix, programID)
		}
		programIDs[programID] = struct{}{}
		programOrder = append(programOrder, programID)

		name, err := stringField(fields, "name")
		if err != nil {
			return nil, nil, nil, nil, err
		}
		if !validText(name, 1, 64) {
			return nil, nil, nil, nil, fmt.Errorf("%sname=%q ngoài 1..64 ký tự", prefix, name)
		}
		order, err := intField(fields, "order")
		if err != nil {
			return nil, nil, nil, nil, err
		}
		if order != int64(index) {
			return nil, nil, nil, nil, fmt.Errorf("%sorder=%d; cần %d", prefix, order, index)
		}
		period, err := intField(fields, "periodMs")
		if err != nil {
			return nil, nil, nil, nil, err
		}
		if !allowedPeriodMs(float64(period)) {
			return nil, nil, nil, nil, fmt.Errorf("%speriodMs=%d ngoài %v", prefix, period, domain.AllowedPeriodMs)
		}
		budget, err := intField(fields, "budgetUs")
		if err != nil {
			return nil, nil, nil, nil, err
		}
		if budget <= 0 || budget > programBudgetUs(period) {
			return nil, nil, nil, nil, fmt.Errorf("%sbudgetUs=%d ngoài dải 1..%d (%d%% của %d ms, DDD §4.3)",
				prefix, budget, programBudgetUs(period), domain.MaxTaskBudgetPercent, period)
		}
		enabled, err := boolField(fields, "desiredEnabled")
		if err != nil {
			return nil, nil, nil, nil, err
		}
		if enabled {
			return nil, nil, nil, nil, fmt.Errorf("%sdesiredEnabled=true: package không được tự bật Program", prefix)
		}
		periods = append(periods, period)
	}
	return objectIDs, programIDs, programOrder, periods, nil
}

func validateManifestBudget(root map[string]any, periods []int64) error {
	object, err := objectField(root, "budget")
	if err != nil {
		return err
	}
	fields, err := exactFields("budget.", object, "maxProgramsTotal", "maxProgramsEnabled",
		"maxTaskBudgetPercent", "source", "periods")
	if err != nil {
		return err
	}
	for key, want := range map[string]int64{
		"maxProgramsTotal": int64(domain.MaxProgramsTotal), "maxProgramsEnabled": int64(domain.MaxProgramsEnabled),
		"maxTaskBudgetPercent": int64(domain.MaxTaskBudgetPercent),
	} {
		value, err := intField(fields, key)
		if err != nil {
			return err
		}
		if value != want {
			return fmt.Errorf("budget.%s=%d; cần %d", key, value, want)
		}
	}
	source, err := stringField(fields, "source")
	if err != nil {
		return err
	}
	if source != budgetSourceProfileCeiling {
		return fmt.Errorf("budget.source=%q; cần %q", source, budgetSourceProfileCeiling)
	}
	items, err := arrayField(fields, "periods")
	if err != nil {
		return err
	}
	if len(items) != len(domain.AllowedPeriodMs) {
		return fmt.Errorf("budget.periods có %d lớp; cần %d", len(items), len(domain.AllowedPeriodMs))
	}
	expected := make(map[int64]int, len(periods))
	for _, period := range periods {
		expected[period]++
	}
	for index, item := range items {
		prefix := fmt.Sprintf("budget.periods[%d].", index)
		object, ok := item.(map[string]any)
		if !ok {
			return fmt.Errorf("%s không phải object", prefix)
		}
		entry, err := exactFields(prefix, object, "periodMs", "programCount", "budgetUs")
		if err != nil {
			return err
		}
		period, err := intField(entry, "periodMs")
		if err != nil {
			return err
		}
		if period != domain.AllowedPeriodMs[index] {
			return fmt.Errorf("%speriodMs=%d; cần %d", prefix, period, domain.AllowedPeriodMs[index])
		}
		count, err := intField(entry, "programCount")
		if err != nil {
			return err
		}
		if count != int64(expected[period]) {
			return fmt.Errorf("%sprogramCount=%d nhưng topology có %d Program chu kỳ %d ms",
				prefix, count, expected[period], period)
		}
		budget, err := intField(entry, "budgetUs")
		if err != nil {
			return err
		}
		if budget != programBudgetUs(period) {
			return fmt.Errorf("%sbudgetUs=%d; cần %d", prefix, budget, programBudgetUs(period))
		}
	}
	return nil
}

func validateManifestPouGraph(root map[string]any, programIDs map[string]struct{}) error {
	items, err := arrayField(root, "pouGraph")
	if err != nil {
		return err
	}
	if len(items) > domain.MaxObjects {
		return fmt.Errorf("pouGraph có %d đỉnh; trần %d", len(items), domain.MaxObjects)
	}
	declared := make(map[string]string, len(items))
	previous := ""
	for index, item := range items {
		prefix := fmt.Sprintf("pouGraph[%d].", index)
		object, ok := item.(map[string]any)
		if !ok {
			return fmt.Errorf("%s không phải object", prefix)
		}
		fields, err := exactFields(prefix, object, "objectId", "kind", "name", "language",
			"contentSha256", "dependencies")
		if err != nil {
			return err
		}
		objectID, err := uuidField(fields, prefix, "objectId")
		if err != nil {
			return err
		}
		if index > 0 && objectID <= previous {
			return fmt.Errorf("%sobjectId=%q không tăng ngặt sau %q (trùng hoặc sai thứ tự)",
				prefix, objectID, previous)
		}
		previous = objectID
		kind, err := stringField(fields, "kind")
		if err != nil {
			return err
		}
		switch kind {
		case "PROGRAM", "FUNCTION", "FUNCTION_BLOCK":
		default:
			return fmt.Errorf("%skind=%q ngoài {PROGRAM,FUNCTION,FUNCTION_BLOCK}", prefix, kind)
		}
		declared[objectID] = kind
		name, err := stringField(fields, "name")
		if err != nil {
			return err
		}
		if !validText(name, 1, 64) {
			return fmt.Errorf("%sname=%q ngoài 1..64 ký tự", prefix, name)
		}
		language, err := stringField(fields, "language")
		if err != nil {
			return err
		}
		if language != "ST" && language != "FBD" {
			return fmt.Errorf("%slanguage=%q ngoài {ST,FBD}", prefix, language)
		}
		if err := hexField(fields, "contentSha256", true); err != nil {
			return fmt.Errorf("%s%w", prefix, err)
		}
		dependencies, err := arrayField(fields, "dependencies")
		if err != nil {
			return err
		}
		previousDependency := ""
		for position, value := range dependencies {
			id, ok := value.(string)
			if !ok || !isUUID(id) {
				return fmt.Errorf("%sdependencies[%d]=%v không phải UUIDv4", prefix, position, value)
			}
			if position > 0 && id <= previousDependency {
				return fmt.Errorf("%sdependencies[%d]=%q không tăng ngặt sau %q", prefix, position, id, previousDependency)
			}
			previousDependency = id
		}
	}
	// Mọi Program trong topology phải có đỉnh POU kind PROGRAM. Thiếu nghĩa là
	// manifest lập lịch một thứ mà chính nó không mô tả.
	for programID := range programIDs {
		kind, found := declared[programID]
		if !found {
			return fmt.Errorf("pouGraph thiếu Program %s có trong topology", programID)
		}
		if kind != "PROGRAM" {
			return fmt.Errorf("pouGraph khai %s là %s nhưng topology lập lịch nó như Program", programID, kind)
		}
	}
	return nil
}

func validateManifestSignals(root map[string]any, programIDs map[string]struct{}) error {
	items, err := arrayField(root, "signals")
	if err != nil {
		return err
	}
	if len(items) > domain.MaxSignals {
		return fmt.Errorf("signals có %d mục; trần %d", len(items), domain.MaxSignals)
	}
	names := make(map[string]struct{}, len(items))
	previous := ""
	for index, item := range items {
		prefix := fmt.Sprintf("signals[%d].", index)
		object, ok := item.(map[string]any)
		if !ok {
			return fmt.Errorf("%s không phải object", prefix)
		}
		fields, err := exactFields(prefix, object, "signalId", "name", "type", "unit",
			"publisherProgramId", "freshnessMs", "stalePolicy", "fallbackValue")
		if err != nil {
			return err
		}
		signalID, err := uuidField(fields, prefix, "signalId")
		if err != nil {
			return err
		}
		if index > 0 && signalID <= previous {
			return fmt.Errorf("%ssignalId=%q không tăng ngặt sau %q (trùng hoặc sai thứ tự)",
				prefix, signalID, previous)
		}
		previous = signalID
		name, err := stringField(fields, "name")
		if err != nil {
			return err
		}
		if !validText(name, 1, 64) {
			return fmt.Errorf("%sname=%q ngoài 1..64 ký tự", prefix, name)
		}
		folded := strings.ToUpper(name)
		if _, duplicate := names[folded]; duplicate {
			return fmt.Errorf("%sname=%q trùng (case-folded)", prefix, name)
		}
		names[folded] = struct{}{}
		dataType, err := stringField(fields, "type")
		if err != nil {
			return err
		}
		if !validSignalType(dataType) {
			return fmt.Errorf("%stype=%q ngoài hệ kiểu ST", prefix, dataType)
		}
		if fields["unit"] != nil {
			unit, ok := fields["unit"].(string)
			if !ok || !validText(unit, 1, 32) {
				return fmt.Errorf("%sunit phải là null hoặc chuỗi 1..32 ký tự", prefix)
			}
		}
		publisher, err := uuidField(fields, prefix, "publisherProgramId")
		if err != nil {
			return err
		}
		if _, found := programIDs[publisher]; !found {
			return fmt.Errorf("%spublisherProgramId=%s không có trong topology", prefix, publisher)
		}
		freshness, err := intField(fields, "freshnessMs")
		if err != nil {
			return err
		}
		if freshness < 1000 || freshness > 90000 {
			return fmt.Errorf("%sfreshnessMs=%d ngoài 1000..90000", prefix, freshness)
		}
		policy, err := stringField(fields, "stalePolicy")
		if err != nil {
			return err
		}
		if !validStalePolicy(policy) {
			return fmt.Errorf("%sstalePolicy=%q ngoài {HOLD_LAST,USE_FALLBACK,WAIT}", prefix, policy)
		}
		fallback, hasFallback, err := nullableNumberField(fields, "fallbackValue")
		if err != nil {
			return fmt.Errorf("%s%w", prefix, err)
		}
		if (policy == "USE_FALLBACK") != hasFallback {
			return fmt.Errorf("%sstalePolicy=%q và fallbackValue phải đi liền nhau", prefix, policy)
		}
		if hasFallback && !validSignalFallback(dataType, fallback) {
			return fmt.Errorf("%sfallbackValue=%v không biểu diễn được bằng %s", prefix, fallback, dataType)
		}
	}
	return nil
}

// validateManifestBindingTarget kiểm GIÁ TRỊ của bốn trường target khi chúng có
// mặt. Miền giá trị lấy đúng từ `modbusrtu/validate.go` — chép hẹp hơn ở đây sẽ
// từ chối cấu hình hợp lệ, chép rộng hơn thì phép kiểm không kiểm gì.
func validateManifestBindingTarget(prefix string, fields map[string]any) error {
	if value, present := fields["registerType"]; present {
		text, ok := value.(string)
		if !ok {
			return fmt.Errorf("%sregisterType: cần string, nhận %T", prefix, value)
		}
		switch text {
		case "coil", "discrete_input", "input_register", "holding_register":
		default:
			return fmt.Errorf("%sregisterType=%q không được hỗ trợ", prefix, text)
		}
	}
	if _, present := fields["address"]; present {
		address, err := intField(fields, "address")
		if err != nil {
			return fmt.Errorf("%s%w", prefix, err)
		}
		if address < 0 || address > 65535 {
			return fmt.Errorf("%saddress=%d ngoài dải 0..65535", prefix, address)
		}
	}
	if value, present := fields["modbusDataType"]; present {
		text, ok := value.(string)
		if !ok {
			return fmt.Errorf("%smodbusDataType: cần string, nhận %T", prefix, value)
		}
		switch text {
		case "bool", "int16", "uint16", "int32", "uint32", "float32":
		default:
			return fmt.Errorf("%smodbusDataType=%q không được hỗ trợ", prefix, text)
		}
	}
	if value, present := fields["readWrite"]; present {
		text, ok := value.(string)
		if !ok {
			return fmt.Errorf("%sreadWrite: cần string, nhận %T", prefix, value)
		}
		switch text {
		case "read", "write", "read_write":
		default:
			return fmt.Errorf("%sreadWrite=%q không được hỗ trợ", prefix, text)
		}
	}
	return nil
}

func validateManifestBindings(root map[string]any, programIDs map[string]struct{}) error {
	items, err := arrayField(root, "bindings")
	if err != nil {
		return err
	}
	if len(items) > domain.MaxPackageBindings {
		return fmt.Errorf("bindings có %d mục; trần %d", len(items), domain.MaxPackageBindings)
	}
	previous := ""
	for index, item := range items {
		prefix := fmt.Sprintf("bindings[%d].", index)
		object, ok := item.(map[string]any)
		if !ok {
			return fmt.Errorf("%s không phải object", prefix)
		}
		/* `AC-PIO-ID-02` — bốn trường khoá THỨ MÀ SLOT TRỎ TỚI là tuỳ chọn ở
		 * mức có mặt, nhưng KHÔNG tuỳ tiện ở mức giá trị: một `address` ngoài
		 * dải hay một `registerType` lạ lọt vào manifest sẽ được Commission
		 * đem đi so và luôn báo "lệch", làm người vận hành đi tìm nguyên nhân
		 * ở cấu hình fieldbus trong khi lỗi nằm ở chính hồ sơ. */
		fields, err := exactFieldsWithOptional(prefix, object,
			[]string{"registerType", "address", "modbusDataType", "readWrite"},
			"bindingId", "programId", "variableId", "variable",
			"direction", "category", "pointId", "deviceId", "extIndex", "writable")
		if err != nil {
			return err
		}
		if err := validateManifestBindingTarget(prefix, fields); err != nil {
			return err
		}
		bindingID, err := uuidField(fields, prefix, "bindingId")
		if err != nil {
			return err
		}
		if index > 0 && bindingID <= previous {
			return fmt.Errorf("%sbindingId=%q không tăng ngặt sau %q (trùng hoặc sai thứ tự)",
				prefix, bindingID, previous)
		}
		previous = bindingID
		programID, err := uuidField(fields, prefix, "programId")
		if err != nil {
			return err
		}
		if _, found := programIDs[programID]; !found {
			return fmt.Errorf("%sprogramId=%s không có trong topology", prefix, programID)
		}
		if _, err := uuidField(fields, prefix, "variableId"); err != nil {
			return err
		}
		variable, err := stringField(fields, "variable")
		if err != nil {
			return err
		}
		if !validText(variable, 1, 64) {
			return fmt.Errorf("%svariable=%q ngoài 1..64 ký tự", prefix, variable)
		}
		direction, err := stringField(fields, "direction")
		if err != nil {
			return err
		}
		switch direction {
		case "READ", "WRITE", "INPUT", "OUTPUT":
		default:
			return fmt.Errorf("%sdirection=%q ngoài {READ,WRITE,INPUT,OUTPUT}", prefix, direction)
		}
		category, err := stringField(fields, "category")
		if err != nil {
			return err
		}
		known := false
		for _, item := range domain.ProfilePointKinds {
			known = known || item == category
		}
		if !known {
			return fmt.Errorf("%scategory=%q ngoài %v", prefix, category, domain.ProfilePointKinds)
		}
		pointID, err := stringField(fields, "pointId")
		if err != nil {
			return err
		}
		if !validText(pointID, 1, 64) {
			return fmt.Errorf("%spointId=%q ngoài 1..64 ký tự", prefix, pointID)
		}
		deviceID, err := stringField(fields, "deviceId")
		if err != nil {
			return err
		}
		if len(deviceID) > 64 {
			return fmt.Errorf("%sdeviceId dài %d ký tự; trần 64", prefix, len(deviceID))
		}
		extIndex, err := intField(fields, "extIndex")
		if err != nil {
			return err
		}
		// `extIndex` chỉ có nghĩa với MB_RTU — cùng luật mà `ProcessRunner` ép
		// trước khi spawn compiler. Hai chỗ kiểm vì hai chỗ nhận dữ liệu.
		if category == "MB_RTU" {
			if extIndex < 1 || extIndex > 256 || deviceID == "" {
				return fmt.Errorf("%sMB_RTU cần deviceId và extIndex 1..256 (nhận %q/%d)", prefix, deviceID, extIndex)
			}
		} else if extIndex != 0 {
			return fmt.Errorf("%scategory=%q không được mang extIndex=%d", prefix, category, extIndex)
		}
		if _, err := boolField(fields, "writable"); err != nil {
			return err
		}
	}
	return nil
}

func validateManifestArtifacts(root map[string]any, programOrder []string, programCount int) error {
	items, err := arrayField(root, "artifacts")
	if err != nil {
		return err
	}
	if len(items) != programCount {
		return fmt.Errorf("artifacts có %d mục nhưng programCount=%d", len(items), programCount)
	}
	for index, item := range items {
		prefix := fmt.Sprintf("artifacts[%d].", index)
		object, ok := item.(map[string]any)
		if !ok {
			return fmt.Errorf("%s không phải object", prefix)
		}
		fields, err := exactFields(prefix, object, "programId", "sha256", "byteSize", "relativePath",
			"artifactSchemaVersion", "targetAbi", "compilerVersion", "libraryVersion", "integrityMode")
		if err != nil {
			return err
		}
		programID, err := uuidField(fields, prefix, "programId")
		if err != nil {
			return err
		}
		if programID != programOrder[index] {
			return fmt.Errorf("%sprogramId=%s; topology tại cùng order là %s",
				prefix, programID, programOrder[index])
		}
		if err := hexField(fields, "sha256", true); err != nil {
			return fmt.Errorf("%s%w", prefix, err)
		}
		size, err := intField(fields, "byteSize")
		if err != nil {
			return err
		}
		if size < 1 || size > int64(programmingcompiler.MaxArtifactBytes) {
			return fmt.Errorf("%sbyteSize=%d ngoài 1..%d", prefix, size, programmingcompiler.MaxArtifactBytes)
		}
		path, err := stringField(fields, "relativePath")
		if err != nil {
			return err
		}
		if path == "" || strings.HasPrefix(path, "/") || strings.Contains(path, "..") {
			return fmt.Errorf("%srelativePath=%q phải là đường dẫn tương đối không có `..`", prefix, path)
		}
		schema, err := intField(fields, "artifactSchemaVersion")
		if err != nil {
			return err
		}
		if schema != 1 {
			return fmt.Errorf("%sartifactSchemaVersion=%d; cần 1", prefix, schema)
		}
		abi, err := intField(fields, "targetAbi")
		if err != nil {
			return err
		}
		if abi != domain.ProfileTargetABI {
			return fmt.Errorf("%stargetAbi=%d; cần %d", prefix, abi, domain.ProfileTargetABI)
		}
		version, err := stringField(fields, "compilerVersion")
		if err != nil {
			return err
		}
		if version != checkCompilerVersion {
			return fmt.Errorf("%scompilerVersion=%q; cần %q", prefix, version, checkCompilerVersion)
		}
		library, err := stringField(fields, "libraryVersion")
		if err != nil {
			return err
		}
		if library != domain.ProfileLibraryVersion {
			return fmt.Errorf("%slibraryVersion=%q; cần %q", prefix, library, domain.ProfileLibraryVersion)
		}
		mode, err := stringField(fields, "integrityMode")
		if err != nil {
			return err
		}
		if mode != "HASH_ONLY" && mode != "SIGNED" {
			return fmt.Errorf("%sintegrityMode=%q ngoài {HASH_ONLY,SIGNED}", prefix, mode)
		}
	}
	return nil
}

func validateManifestProgramManifests(root map[string]any, programCount int) error {
	items, err := arrayField(root, "programManifests")
	if err != nil {
		return err
	}
	if len(items) != programCount {
		return fmt.Errorf("programManifests có %d mục nhưng programCount=%d", len(items), programCount)
	}
	for index, item := range items {
		object, ok := item.(map[string]any)
		if !ok || len(object) == 0 {
			return fmt.Errorf("programManifests[%d] phải là object không rỗng", index)
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Trợ giúp đọc field có kiểm
// ---------------------------------------------------------------------------

func decodeManifestObject(canonical []byte) (map[string]any, error) {
	decoder := json.NewDecoder(strings.NewReader(string(canonical)))
	decoder.UseNumber()
	var value map[string]any
	if err := decoder.Decode(&value); err != nil {
		return nil, fmt.Errorf("đọc manifest: %w", err)
	}
	return value, nil
}

// exactFields ép tập khoá ĐÚNG BẰNG danh sách mong đợi: thiếu là lỗi, thừa cũng
// là lỗi. Cho phép khoá thừa nghĩa là một trường viết sai chính tả sẽ đi lọt và
// trường thật thì nhận zero value — im lặng đúng lúc không nên im lặng.
func exactFields(prefix string, object map[string]any, keys ...string) (map[string]any, error) {
	return exactFieldsWithOptional(prefix, object, nil, keys...)
}

// exactFieldsWithOptional như `exactFields`, nhưng thêm một tập khoá ĐƯỢC PHÉP
// VẮNG.
//
// Vì sao cần: bốn trường target của binding MB_RTU (`registerType`, `address`,
// `modbusDataType`, `readWrite`) mang `omitempty` — có mặt với điểm Modbus phân
// giải được, vắng với LOCAL/VP và với manifest sinh trước `AC-PIO-ID-02`. Xếp
// chúng vào danh sách BẮT BUỘC sẽ từ chối mọi binding không phải Modbus; bỏ
// chúng ra khỏi mọi danh sách thì `exactFields` gọi chúng là "trường lạ". Cả
// hai đều làm writer và verifier của CÙNG một hồ sơ bất đồng.
func exactFieldsWithOptional(prefix string, object map[string]any, optional []string,
	keys ...string) (map[string]any, error) {
	expected := make(map[string]struct{}, len(keys)+len(optional))
	for _, key := range keys {
		expected[key] = struct{}{}
		if _, found := object[key]; !found {
			return nil, fmt.Errorf("%s%s: thiếu trường", prefix, key)
		}
	}
	for _, key := range optional {
		expected[key] = struct{}{}
	}
	unexpected := make([]string, 0)
	for key := range object {
		if _, ok := expected[key]; !ok {
			unexpected = append(unexpected, key)
		}
	}
	if len(unexpected) > 0 {
		sort.Strings(unexpected)
		return nil, fmt.Errorf("%s trường lạ: %s", prefix, strings.Join(unexpected, ","))
	}
	return object, nil
}

func stringField(object map[string]any, key string) (string, error) {
	value, ok := object[key].(string)
	if !ok {
		return "", fmt.Errorf("%s: cần string, nhận %T", key, object[key])
	}
	return value, nil
}

func uuidField(object map[string]any, prefix, key string) (string, error) {
	value, err := stringField(object, key)
	if err != nil {
		return "", fmt.Errorf("%s%w", prefix, err)
	}
	if !isUUID(value) {
		return "", fmt.Errorf("%s%s=%q không phải UUIDv4", prefix, key, value)
	}
	return value, nil
}

func intField(object map[string]any, key string) (int64, error) {
	number, ok := object[key].(json.Number)
	if !ok {
		return 0, fmt.Errorf("%s: cần số, nhận %T", key, object[key])
	}
	value, err := number.Int64()
	if err != nil {
		return 0, fmt.Errorf("%s=%s không phải số nguyên", key, number.String())
	}
	return value, nil
}

func boolField(object map[string]any, key string) (bool, error) {
	value, ok := object[key].(bool)
	if !ok {
		return false, fmt.Errorf("%s: cần bool, nhận %T", key, object[key])
	}
	return value, nil
}

func nullableNumberField(object map[string]any, key string) (float64, bool, error) {
	if object[key] == nil {
		return 0, false, nil
	}
	number, ok := object[key].(json.Number)
	if !ok {
		return 0, false, fmt.Errorf("%s: cần số hoặc null, nhận %T", key, object[key])
	}
	value, err := number.Float64()
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false, fmt.Errorf("%s=%s không phải số hữu hạn", key, number.String())
	}
	return value, true, nil
}

func validSignalFallback(dataType string, value float64) bool {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return false
	}
	switch dataType {
	case "BOOL":
		return value == 0 || value == 1
	case "INT":
		return math.Trunc(value) == value && value >= -32768 && value <= 32767
	case "DINT":
		return math.Trunc(value) == value && value >= -2147483648 && value <= 2147483647
	case "UINT":
		return math.Trunc(value) == value && value >= 0 && value <= 65535
	case "REAL":
		return value >= -math.MaxFloat32 && value <= math.MaxFloat32
	case "TIME":
		// Draft/REST biểu diễn TIME fallback bằng mili-giây nguyên không âm.
		return math.Trunc(value) == value && value >= 0 && value <= float64(math.MaxInt64/1_000_000)
	default:
		return false
	}
}

func arrayField(object map[string]any, key string) ([]any, error) {
	value, ok := object[key].([]any)
	if !ok {
		return nil, fmt.Errorf("%s: cần array, nhận %T", key, object[key])
	}
	return value, nil
}

func objectField(object map[string]any, key string) (map[string]any, error) {
	value, ok := object[key].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%s: cần object, nhận %T", key, object[key])
	}
	return value, nil
}

func hexField(object map[string]any, key string, required bool) error {
	value, err := stringField(object, key)
	if err != nil {
		return err
	}
	if value == "" && !required {
		return nil
	}
	if len(value) != 64 {
		return fmt.Errorf("%s=%q phải là SHA-256 hex 64 ký tự", key, value)
	}
	if _, err := hex.DecodeString(value); err != nil {
		return fmt.Errorf("%s=%q không phải hex", key, value)
	}
	return nil
}
