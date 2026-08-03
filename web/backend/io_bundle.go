package main

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
	errs := validateConfigIO(ioCfg)
	if len(ioCfg.UI) > 0 || len(ioCfg.AO) > 0 || len(ioCfg.DO) > 0 {
		errs = append(errs, validateConfigPointMetadata(ioCfg)...)
		errs = append(errs, validateFixedPhysicalPointTags(ioCfg)...)
	}
	errs = append(errs, validateConfigSafeState(safeCfg)...)
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
	a.audit.Change(user, "config.io-bundle", "io_config.conf+io_safe_state.conf", "success", r.RemoteAddr)
	return ConfigPutResult{Result: "success", Applied: true, Reload: reloadIOBundle, Warnings: warnings, Revision: revision, Checksum: checksum}, nil, nil
}
