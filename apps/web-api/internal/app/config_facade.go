package app

import (
	"os"

	webConfig "mkddc-web/internal/config"
)

var ErrConfigMissing = webConfig.ErrMissing

func resolveConfigDir() string {
	return webConfig.ResolveDir()
}

func writeConfigFileAtomic(path string, data []byte, perm os.FileMode) error {
	return webConfig.WriteFileAtomic(path, data, perm)
}

func writeConfigFileAtomicStrict(path string, data []byte, perm os.FileMode) error {
	return webConfig.WriteFileAtomicStrict(path, data, perm)
}

func readConfigJSON(path string, value any) error {
	return webConfig.ReadJSON(path, value)
}

func syncDirectory(path string) error {
	return webConfig.SyncDirectory(path)
}
