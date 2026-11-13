package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	publicmanifest "github.com/Silo-Server/silo-plugin-sdk/pkg/pluginsdk/manifest"
	"google.golang.org/protobuf/proto"
)

// The host compares the runtime's manifest with the uploaded package verbatim.
// Selecting one build target must not discard platforms or other declarations.
func TestUploadManifestMatchesRuntimeDeclarations(t *testing.T) {
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	template, err := os.ReadFile(filepath.Join(root, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	expected, err := publicmanifest.Load(template)
	if err != nil {
		t.Fatal(err)
	}
	binary := []byte("package contract fixture")
	path := filepath.Join(t.TempDir(), "plugin-test")
	if err := os.WriteFile(path, binary, 0o755); err != nil {
		t.Fatal(err)
	}
	command := exec.Command("go", "run", "./cmd/package-upload", "--binary", path, "--version", "0.7.2", "--goos", "linux", "--goarch", "amd64")
	command.Dir = root
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("packager failed: %v %s", err, output)
	}
	pack, err := zip.OpenReader(path + ".silo-plugin.zip")
	if err != nil {
		t.Fatal(err)
	}
	defer pack.Close()
	entry, err := pack.Open("manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	defer entry.Close()
	data, err := io.ReadAll(entry)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := publicmanifest.Load(data)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(binary)
	expected.Version = "0.7.2"
	expected.Checksum = hex.EncodeToString(sum[:])
	if !proto.Equal(expected, actual) {
		t.Fatal("upload package changed the runtime manifest declarations")
	}
}
