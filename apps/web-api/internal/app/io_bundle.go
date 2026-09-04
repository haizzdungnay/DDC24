package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
)

const reloadIOBundle = "sighup-iobus+sighup-core"

func (a *App) handleGetIOBundle(w http.ResponseWriter, _ *http.Request) {
	ioCfg, err := readConfig(a, configGroupIO, ConfigIO{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	safeCfg, err := readConfig(a, configGroupSafeState, ConfigSafeState{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	revision := ioCfg.Revision
	if safeCfg.Revision > revision {
		revision = safeCfg.Revision
	}
	checksum := ioCfg.Checksum
	if checksum == "" {
		checksum = safeCfg.Checksum
	}
	writeJSON(w, http.StatusOK, ConfigIOBundle{Revision: revision, Checksum: checksum, IO: ioCfg, SafeState: safeCfg})
}

func (a *App) handlePutIOBundle(w http.ResponseWriter, r *http.Request) {
	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()
	var bundle ConfigIOBundle
	if err := decodeConfigBody(w, r, &bundle); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	result, errs, err := a.applyIOBundle(r, bundle.IO, bundle.SafeState, bundle.BaseRevision)
	if len(errs) > 0 {
		writePointTagErrors(w, errs)
		return
	}
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *App) applyIOBundle(r *http.Request, ioCfg ConfigIO, safeCfg ConfigSafeState, baseRevision uint64) (ConfigPutResult, []configValidationError, error) {
	// Slice nil bị encoding/json ghi thành `null`, trong khi contract và Core
	// yêu cầu collection là array. Chuẩn hoá trước validate/checksum/persist để
	// body bỏ trống mang nghĩa "không có kênh", không tạo file làm Core fail boot.
	if ioCfg.UI == nil {
		ioCfg.UI = []map[string]any{}
	}
	if ioCfg.AO == nil {
		ioCfg.AO = []map[string]any{}
	}
	if ioCfg.DO == nil {
		ioCfg.DO = []map[string]any{}
	}
	if safeCfg.AO == nil {
		safeCfg.AO = []map[string]any{}
	}
	if safeCfg.DO == nil {
		safeCfg.DO = []map[string]any{}
	}
	boardCap := a.boardCapability(r.Context())
	errs := validateConfigIOWithBoard(ioCfg, boardCap)
	errs = append(errs, validateIOAgainstBoard(ioCfg, boardCap)...)
	if len(ioCfg.UI) > 0 || len(ioCfg.AO) > 0 || len(ioCfg.DO) > 0 {
		errs = append(errs, validateConfigPointMetadata(ioCfg)...)
		errs = append(errs, validateFixedPhysicalPointTags(ioCfg)...)
	}
	errs = append(errs, validateConfigSafeStateWithBoard(safeCfg, boardCap)...)
	beforeIO, readErr := readConfig(a, configGroupIO, ConfigIO{})
	if readErr != nil {
		return ConfigPutResult{}, nil, readErr
	}
	beforeSafe, readErr := readConfig(a, configGroupSafeState, ConfigSafeState{})
	if readErr != nil {
		return ConfigPutResult{}, nil, readErr
	}
	beforeVP, readErr := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if readErr != nil {
		return ConfigPutResult{}, nil, readErr
	}
	ioCfg, _ = normalizePointTags(ioCfg, ConfigVirtualPoints{})
	errs = append(errs, validatePointNamespaceTransition(beforeIO, beforeVP, ioCfg, beforeVP)...)
	fieldbus, _ := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	errs = append(errs, validateUnifiedPointTags(ioCfg, beforeVP, fieldbus)...)
	if len(errs) > 0 {
		return ConfigPutResult{}, errs, nil
	}
	currentRevision := beforeIO.Revision
	if beforeSafe.Revision > currentRevision {
		currentRevision = beforeSafe.Revision
	}
	if baseRevision != 0 && baseRevision != currentRevision {
		return ConfigPutResult{}, nil, fmt.Errorf("revision conflict: hiện tại=%d, yêu cầu=%d", currentRevision, baseRevision)
	}
	revision := currentRevision + 1
	ioCfg.Revision, safeCfg.Revision = revision, revision
	ioCfg.Checksum, safeCfg.Checksum = "", ""
	canonical, _ := json.Marshal(struct {
		IO   ConfigIO        `json:"io"`
		Safe ConfigSafeState `json:"safe_state"`
	}{ioCfg, safeCfg})
	sum := sha256.Sum256(canonical)
	checksum := hex.EncodeToString(sum[:])
	ioCfg.Checksum, safeCfg.Checksum = checksum, checksum
	ioData, _ := json.MarshalIndent(ioCfg, "", "  ")
	ioData = append(ioData, '\n')
	safeData, _ := json.MarshalIndent(safeCfg, "", "  ")
	safeData = append(safeData, '\n')
	ioPath, safePath := a.configPath(configGroupIO.file), a.configPath(configGroupSafeState.file)
	oldIO, ioReadErr := os.ReadFile(ioPath)
	ioExisted := ioReadErr == nil
	oldSafe, safeReadErr := os.ReadFile(safePath)
	safeExisted := safeReadErr == nil
	restore := func() {
		if ioExisted {
			_ = writeConfigFileAtomic(ioPath, oldIO, 0o644)
		} else {
			_ = os.Remove(ioPath)
		}
		if safeExisted {
			_ = writeConfigFileAtomic(safePath, oldSafe, 0o644)
		} else {
			_ = os.Remove(safePath)
		}
		_, _ = a.dispatchReload(reloadSIGHUPIobus)
		_, _ = a.dispatchReload(reloadSIGHUPCore)
	}
	if err := writeConfigFileAtomic(ioPath, ioData, 0o644); err != nil {
		return ConfigPutResult{}, nil, err
	}
	if err := writeConfigFileAtomic(safePath, safeData, 0o644); err != nil {
		restore()
		return ConfigPutResult{}, nil, err
	}
	iobusOK, iobusWarnings := a.dispatchReload(reloadSIGHUPIobus)
	coreOK, coreWarnings := a.dispatchReload(reloadSIGHUPCore)
	warnings := append(iobusWarnings, coreWarnings...)
	if !iobusOK || !coreOK {
		restore()
		return ConfigPutResult{}, nil, fmt.Errorf("apply atomic thất bại; đã phục hồi revision %d: %s", currentRevision, strings.Join(warnings, "; "))
	}
	user := "-"
	if principal := principalFromContext(r.Context()); principal != nil {
		user = principal.Username
	}

	// `ISS-PIO-33` bước 4 — Read-back Verify. Ba bước trước chỉ chứng minh "đã
	// ghi xong tệp và đã gửi SIGHUP"; chúng KHÔNG chứng minh phần cứng đã đổi
	// mode. Đọc `ao_mode[]` mà `iobus` ghi sau ACK `SET_AO_CFG` là chỗ duy nhất
	// trả lời được câu đó.
	activation := a.verifyActivation(r.Context(), ioCfg)
	if activation.Status == ActivationMismatch {
		// Có BẰNG CHỨNG là phần cứng không nhận: phục hồi cấu hình hợp lệ trước
		// đó thay vì để bo chạy một mode khác với mode đang hiển thị.
		restore()
		/* Vết rollback cũng mang diff: nó ghi lại thứ ĐÃ ĐƯỢC YÊU CẦU nhưng
		 * phần cứng từ chối. Bỏ trống ở đây sẽ để lại một vết "đã phục hồi" mà
		 * không ai biết đã suýt áp cái gì. */
		a.audit.ChangeWithDetail(user, "config.io-bundle", "io_config.conf+io_safe_state.conf", "rollback_readback", r.RemoteAddr,
			summarizeIOBundleDiff(beforeIO, beforeSafe, ioCfg, safeCfg))
		return ConfigPutResult{}, nil, fmt.Errorf("read-back thất bại; đã phục hồi revision %d: %s", currentRevision, activation.Reason)
	}
	if activation.Status != ActivationVerified {
		// Không kiểm chứng được KHÔNG phải lỗi để rollback — nhưng cũng tuyệt
		// đối không được im lặng. Nó đi ra ngoài như một cảnh báo có tên.
		warnings = append(warnings, activation.Reason)
	}
	/* `ISS-PIO-37` — vết audit mang GIÁ TRỊ CŨ → GIÁ TRỊ MỚI.
	 *
	 * Gộp `io` và `safe_state` vào MỘT tóm tắt vì chúng được ghi như một giao
	 * dịch: tách đôi sẽ để lại hai vết mà không vết nào nói được trạng thái an
	 * toàn đã đổi cùng lúc với mode kênh hay không — đúng cặp cần đối chiếu khi
	 * một ngõ ra hành xử lạ sau một lần lưu. */
	a.audit.ChangeWithDetail(user, "config.io-bundle", "io_config.conf+io_safe_state.conf", "success", r.RemoteAddr,
		summarizeIOBundleDiff(beforeIO, beforeSafe, ioCfg, safeCfg))
	return ConfigPutResult{Result: "success", Applied: true, Reload: reloadIOBundle, Warnings: warnings, Revision: revision, Checksum: checksum, Activation: &activation}, nil, nil
}

// summarizeIOBundleDiff gộp hai tệp của một giao dịch io-bundle vào một tóm tắt,
// với đường dẫn có tiền tố `io.` / `safe_state.` để người đọc biết trường nằm ở
// tệp nào (`ISS-PIO-37`).
func summarizeIOBundleDiff(beforeIO ConfigIO, beforeSafe ConfigSafeState, afterIO ConfigIO, afterSafe ConfigSafeState) string {
	type bundle struct {
		IO   ConfigIO        `json:"io"`
		Safe ConfigSafeState `json:"safe_state"`
	}
	return summarizeConfigDiff(bundle{beforeIO, beforeSafe}, bundle{afterIO, afterSafe})
}
