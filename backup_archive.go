package main

import (
	"archive/zip"
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

const archiveMagic = "jiggered-backup-enc-v1\n"
const archiveChunk = 1 << 20
const maxArchiveDatabase = 16 << 30
const archiveReadme = "Jiggered backup\n\nThis ZIP contains a consistent SQLite snapshot in jiggered.db.\nRestore with: jiggered restore BACKUP --yes\nFor .zip.enc files, add --password-file PATH (a file containing your encryption password).\nStop the server before restoring. Old raw SQLite backups remain supported.\nKeep .jiggered-service-key separately; it is deliberately excluded from this backup.\n"

func validateBackupPassword(password string) error {
	if password != "" && (utf8.RuneCountInString(password) < 8 || len(password) > 1024 || strings.TrimSpace(password) == "") {
		return errors.New("Use an encryption password of at least 8 characters and at most 1024 bytes.")
	}
	return nil
}
func backupExtension(password string) string {
	if password != "" {
		return ".zip.enc"
	}
	return ".zip"
}
func backupContentType(name string) string {
	if strings.HasSuffix(name, ".zip") {
		return "application/zip"
	}
	if strings.HasSuffix(name, ".db") {
		return "application/vnd.sqlite3"
	}
	return "application/octet-stream"
}
func privateBackupTemp(dir, pattern string) (*os.File, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	return os.CreateTemp(dir, pattern)
}

// Package a snapshot before publishing it. Plaintext and partial files are private and always removed.
func archiveBackup(snapshot, password string) (result string, err error) {
	if err = validateBackupPassword(password); err != nil {
		return "", err
	}
	dir := filepath.Dir(snapshot)
	plain, err := privateBackupTemp(dir, ".tmp-archive-*.zip")
	if err != nil {
		return "", err
	}
	defer func() {
		plain.Close()
		if result != plain.Name() {
			os.Remove(plain.Name())
		}
	}()
	zw := zip.NewWriter(plain)
	db, err := os.Open(snapshot)
	if err != nil {
		return "", err
	}
	defer db.Close()
	stat, err := db.Stat()
	if err != nil {
		return "", err
	}
	if stat.Size() > maxArchiveDatabase {
		return "", errors.New("The database exceeds the 16 GiB backup archive limit.")
	}
	header := &zip.FileHeader{Name: "jiggered.db", Method: zip.Deflate}
	header.SetMode(0600)
	header.SetModTime(stat.ModTime())
	member, err := zw.CreateHeader(header)
	if err != nil {
		return "", err
	}
	if _, err = io.Copy(member, db); err != nil {
		return "", err
	}
	notes, err := zw.Create("README.txt")
	if err != nil {
		return "", err
	}
	if _, err = io.WriteString(notes, archiveReadme); err != nil {
		return "", err
	}
	if err = zw.Close(); err != nil {
		return "", err
	}
	if password == "" {
		if err = plain.Close(); err != nil {
			return "", err
		}
		return plain.Name(), nil
	}
	if _, err = plain.Seek(0, 0); err != nil {
		return "", err
	}
	encrypted, err := privateBackupTemp(dir, ".tmp-archive-*.zip.enc")
	if err != nil {
		return "", err
	}
	defer func() {
		encrypted.Close()
		if result != encrypted.Name() {
			os.Remove(encrypted.Name())
		}
	}()
	if err = encryptBackup(encrypted, plain, password); err != nil {
		return "", err
	}
	if err = encrypted.Close(); err != nil {
		return "", err
	}
	return encrypted.Name(), nil
}

// Argon2id + chunked AES-256-GCM, following Zoomies' archive/encryption separation.
// The authenticated header, counter and final marker bind every frame to its position.
func archiveAEAD(password string, header []byte) (cipher.AEAD, error) {
	salt := header[len(archiveMagic) : len(archiveMagic)+16]
	key := argon2.IDKey([]byte(password), salt, 3, 64*1024, 4, 32)
	block, err := aes.NewCipher(key)
	clear(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
func archiveNonce(header []byte, counter uint64, final bool) ([]byte, []byte) {
	nonce := make([]byte, 12)
	copy(nonce, header[len(header)-4:])
	binary.BigEndian.PutUint64(nonce[4:], counter)
	aad := append([]byte(nil), header...)
	var suffix [9]byte
	binary.BigEndian.PutUint64(suffix[:8], counter)
	if final {
		suffix[8] = 1
	}
	aad = append(aad, suffix[:]...)
	return nonce, aad
}
func encryptBackup(out io.Writer, in io.Reader, password string) error {
	header := append([]byte(archiveMagic), make([]byte, 20)...)
	if _, err := rand.Read(header[len(archiveMagic):]); err != nil {
		return err
	}
	aead, err := archiveAEAD(password, header)
	if err != nil {
		return err
	}
	if _, err = out.Write(header); err != nil {
		return err
	}
	buffer := make([]byte, archiveChunk)
	for counter := uint64(0); ; counter++ {
		n, readErr := io.ReadFull(in, buffer)
		final := readErr == io.EOF || readErr == io.ErrUnexpectedEOF
		if readErr != nil && !final {
			return readErr
		}
		nonce, aad := archiveNonce(header, counter, final)
		sealed := aead.Seal(nil, nonce, buffer[:n], aad)
		size := uint32(len(sealed))
		if final {
			size |= 1 << 31
		}
		var length [4]byte
		binary.BigEndian.PutUint32(length[:], size)
		if _, err = out.Write(length[:]); err != nil {
			return err
		}
		if _, err = out.Write(sealed); err != nil {
			return err
		}
		if final {
			return nil
		}
	}
}
func decryptBackup(out io.Writer, in io.Reader, password string) error {
	header := make([]byte, len(archiveMagic)+20)
	if _, err := io.ReadFull(in, header); err != nil || string(header[:len(archiveMagic)]) != archiveMagic {
		return errors.New("Invalid encrypted backup header.")
	}
	aead, err := archiveAEAD(password, header)
	if err != nil {
		return err
	}
	for counter := uint64(0); ; counter++ {
		var length [4]byte
		if _, err = io.ReadFull(in, length[:]); err != nil {
			return errors.New("Encrypted backup is truncated.")
		}
		size := binary.BigEndian.Uint32(length[:])
		final := size&(1<<31) != 0
		size &= (1 << 31) - 1
		if size < uint32(aead.Overhead()) || size > archiveChunk+uint32(aead.Overhead()) {
			return errors.New("Invalid encrypted backup frame.")
		}
		sealed := make([]byte, size)
		if _, err = io.ReadFull(in, sealed); err != nil {
			return errors.New("Encrypted backup is truncated.")
		}
		nonce, aad := archiveNonce(header, counter, final)
		plain, err := aead.Open(nil, nonce, sealed, aad)
		if err != nil {
			return errors.New("The encryption password is incorrect, or this backup has been altered.")
		}
		if _, err = out.Write(plain); err != nil {
			return err
		}
		if final {
			var extra [1]byte
			n, err := in.Read(extra[:])
			if n != 0 || err != io.EOF {
				return errors.New("Encrypted backup has unexpected trailing data.")
			}
			return nil
		}
	}
}

// Return a validated, private extracted database, or the original legacy database.
// Never use archive entry names as filesystem paths. Only our two regular files are accepted.
func unpackBackup(source, password string, tempRoots ...string) (result string, cleanup func(), err error) {
	cleanup = func() {}
	f, err := os.Open(source)
	if err != nil {
		return "", cleanup, fmt.Errorf("can't read %s: %w", source, err)
	}
	defer f.Close()
	head := make([]byte, len(archiveMagic))
	n, _ := io.ReadFull(f, head)
	head = head[:n]
	f.Seek(0, 0)
	if bytes.HasPrefix(head, []byte("SQLite format 3\x00")) {
		return source, cleanup, nil
	}
	root := filepath.Dir(source)
	if len(tempRoots) > 0 {
		root = tempRoots[0]
		if err = os.MkdirAll(root, 0700); err != nil {
			return "", cleanup, err
		}
	}
	dir, err := os.MkdirTemp(root, ".restore-archive-*")
	if err != nil {
		return "", cleanup, err
	}
	cleanup = func() { os.RemoveAll(dir) }
	defer func() {
		if err != nil {
			cleanup()
		}
	}()
	archive := source
	if string(head) == archiveMagic {
		if password == "" {
			return "", cleanup, errors.New("This backup is encrypted. Supply --password-file PATH to restore it.")
		}
		decoded, e := os.OpenFile(filepath.Join(dir, "archive.zip"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			return "", cleanup, e
		}
		err = decryptBackup(decoded, io.LimitReader(f, 32<<30), password)
		closeErr := decoded.Close()
		if err != nil {
			return "", cleanup, err
		}
		if closeErr != nil {
			return "", cleanup, closeErr
		}
		archive = decoded.Name()
	}
	zr, err := zip.OpenReader(archive)
	if err != nil {
		return "", cleanup, errors.New("This isn't a Jiggered database or ZIP backup.")
	}
	defer zr.Close()
	seen := map[string]bool{}
	for _, entry := range zr.File {
		if (entry.Name != "jiggered.db" && entry.Name != "README.txt") || seen[entry.Name] || !entry.Mode().IsRegular() {
			return "", cleanup, errors.New("The backup archive contains unexpected or duplicate files.")
		}
		seen[entry.Name] = true
		limit := uint64(maxArchiveDatabase)
		if entry.Name == "README.txt" {
			limit = 16 << 10
		}
		if entry.UncompressedSize64 > limit {
			return "", cleanup, errors.New("A backup archive member exceeds its size limit.")
		}
		reader, e := entry.Open()
		if e != nil {
			return "", cleanup, e
		}
		destination := io.Writer(io.Discard)
		var db *os.File
		if entry.Name == "jiggered.db" {
			db, e = os.OpenFile(filepath.Join(dir, "jiggered.db"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if e != nil {
				reader.Close()
				return "", cleanup, e
			}
			destination = db
		}
		count, e := io.Copy(destination, io.LimitReader(reader, int64(entry.UncompressedSize64)+1))
		reader.Close()
		if db != nil {
			if closeErr := db.Close(); e == nil {
				e = closeErr
			}
		}
		if e != nil || uint64(count) != entry.UncompressedSize64 {
			return "", cleanup, fmt.Errorf("The backup archive is damaged or truncated: %v", e)
		}
	}
	if !seen["jiggered.db"] {
		return "", cleanup, errors.New("The archive has no Jiggered database.")
	}
	return filepath.Join(dir, "jiggered.db"), cleanup, nil
}
