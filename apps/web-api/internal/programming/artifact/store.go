package artifact

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

type Store struct{ root string }

func NewStore(root string) (*Store, error) {
	if root == "" {
		return nil, fmt.Errorf("artifact root là bắt buộc")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := ensureDirectory(abs, 0o750); err != nil {
		return nil, err
	}
	return &Store{root: abs}, nil
}

func (s *Store) Put(expected [32]byte, value []byte) (string, error) {
	if s == nil || expected == ([32]byte{}) || len(value) < 1 || len(value) > 1<<20 || sha256.Sum256(value) != expected {
		return "", fmt.Errorf("artifact bytes/hash không hợp lệ")
	}
	hexDigest := hex.EncodeToString(expected[:])
	relative := filepath.Join("sha256", hexDigest[:2], hexDigest+".mkddcir")
	directory := filepath.Join(s.root, "sha256", hexDigest[:2])
	if err := ensureDirectory(filepath.Join(s.root, "sha256"), 0o750); err != nil {
		return "", err
	}
	if err := ensureDirectory(directory, 0o750); err != nil {
		return "", err
	}
	destination := filepath.Join(s.root, relative)
	if existing, err := readRegular(destination, int64(len(value))); err == nil {
		if !bytes.Equal(existing, value) {
			return "", fmt.Errorf("artifact content-address collision")
		}
		return filepath.ToSlash(relative), nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	temporary, err := os.CreateTemp(directory, ".artifact-*")
	if err != nil {
		return "", err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o640); err == nil {
		_, err = temporary.Write(value)
		if err == nil {
			err = temporary.Sync()
		}
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return "", err
	}
	if err := os.Link(temporaryPath, destination); err != nil {
		if !errors.Is(err, os.ErrExist) {
			return "", fmt.Errorf("publish artifact: %w", err)
		}
		existing, readErr := readRegular(destination, int64(len(value)))
		if readErr != nil || !bytes.Equal(existing, value) {
			return "", fmt.Errorf("artifact publish race/collision")
		}
	}
	dir, err := os.Open(directory)
	if err != nil {
		return "", err
	}
	err = dir.Sync()
	_ = dir.Close()
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(relative), nil
}

func (s *Store) Verify(relative string, expected [32]byte, byteSize int64) error {
	if s == nil || relative == "" || filepath.IsAbs(relative) || filepath.Clean(relative) != relative || expected == ([32]byte{}) {
		return fmt.Errorf("artifact locator không hợp lệ")
	}
	abs := filepath.Join(s.root, relative)
	if !pathWithin(s.root, abs) {
		return fmt.Errorf("artifact locator vượt root")
	}
	raw, err := readRegular(abs, byteSize)
	if err != nil {
		return err
	}
	if int64(len(raw)) != byteSize || sha256.Sum256(raw) != expected {
		return fmt.Errorf("artifact read-back mismatch")
	}
	return nil
}

func ensureDirectory(path string, mode os.FileMode) error {
	if err := os.MkdirAll(path, mode); err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("artifact directory không hợp lệ/symlink")
	}
	return os.Chmod(path, mode)
}

func readRegular(path string, max int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() < 1 || info.Size() > max {
		return nil, fmt.Errorf("artifact file không hợp lệ")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return io.ReadAll(io.LimitReader(file, max+1))
}

func pathWithin(root, candidate string) bool {
	relative, err := filepath.Rel(root, candidate)
	return err == nil && relative != ".." && !filepath.IsAbs(relative) && len(relative) > 0 && relative[:1] != "."
}
