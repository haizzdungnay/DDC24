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
	"strings"

	"golang.org/x/sys/unix"
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

// Read trả về NỘI DUNG artifact sau khi đã xác minh hash và kích thước.
//
// Không có đường đọc nào bỏ qua Verify: một artifact đọc ra mà chưa đối chiếu
// hash là một chuỗi byte không rõ nguồn gốc, và người gọi tiếp theo sẽ đưa nó
// thẳng cho một tiến trình thực thi.
func (s *Store) Read(relative string, expected [32]byte, byteSize int64) ([]byte, error) {
	if err := s.Verify(relative, expected, byteSize); err != nil {
		return nil, err
	}
	return readRegular(filepath.Join(s.root, filepath.FromSlash(relative)), byteSize)
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

// MaterializeStaging tạo locator immutable dưới staging root cho đúng một
// Operation. Dùng hard-link từ content-addressed store nên bytes Core mở là
// chính bytes đã Verify; không copy qua buffer và không thể ghi đè file cũ.
func (s *Store) MaterializeStaging(stagingRoot, operationID, relative string,
	expected [32]byte, byteSize int64) (string, error) {
	if s == nil || stagingRoot == "" || operationID == "" ||
		strings.ContainsAny(operationID, `/\\`) {
		return "", fmt.Errorf("staging locator không hợp lệ")
	}
	if err := s.Verify(relative, expected, byteSize); err != nil {
		return "", err
	}
	root, err := filepath.Abs(stagingRoot)
	if err != nil {
		return "", err
	}
	if err := ensureDirectory(root, 0o750); err != nil {
		return "", err
	}
	operationRoot := filepath.Join(root, operationID)
	if err := ensureDirectory(operationRoot, 0o750); err != nil {
		return "", err
	}
	source := filepath.Join(s.root, relative)
	destination := filepath.Join(operationRoot, "candidate.mkddcir")
	if err := os.Link(source, destination); err != nil {
		if !errors.Is(err, os.ErrExist) {
			return "", fmt.Errorf("materialize staging: %w", err)
		}
		existing, readErr := readRegular(destination, byteSize)
		if readErr != nil || int64(len(existing)) != byteSize || sha256.Sum256(existing) != expected {
			return "", fmt.Errorf("staging collision/mismatch")
		}
	}
	dir, err := os.Open(operationRoot)
	if err != nil {
		return "", err
	}
	err = dir.Sync()
	_ = dir.Close()
	if err != nil {
		return "", err
	}
	return destination, nil
}

// RemoveStaging thu hồi đúng locator chưa được gắn với Operation durable. Hàm
// không đệ quy và chỉ chấp nhận layout do MaterializeStaging tạo để không thể
// xoá nhầm dữ liệu ngoài staging root.
func (s *Store) RemoveStaging(stagingRoot, operationID string) error {
	if s == nil || stagingRoot == "" || operationID == "" ||
		strings.ContainsAny(operationID, `/\\`) {
		return fmt.Errorf("staging locator không hợp lệ")
	}
	root, err := filepath.Abs(stagingRoot)
	if err != nil {
		return err
	}
	rootFD, err := unix.Open(root, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return err
	}
	defer unix.Close(rootFD)
	operationFD, err := unix.Openat(rootFD, operationID,
		unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if errors.Is(err, unix.ENOENT) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := unix.Unlinkat(operationFD, "candidate.mkddcir", 0); err != nil &&
		!errors.Is(err, unix.ENOENT) {
		unix.Close(operationFD)
		return err
	}
	if err := unix.Close(operationFD); err != nil {
		return err
	}
	if err := unix.Unlinkat(rootFD, operationID, unix.AT_REMOVEDIR); err != nil &&
		!errors.Is(err, unix.ENOENT) {
		return err
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
