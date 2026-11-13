package romm

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDiscSystemUsesFullEmulatorCatalog(t *testing.T) {
	if Core("3do") != "opera" || Core("genesis") != "genesis_plus_gx" || Core("ps4") != "" {
		t.Fatal("catalog did not distinguish supported and unsupported systems")
	}
	for _, missing := range []bool{true, false} {
		t.Run(fmt.Sprint("missing BIOS=", missing), func(t *testing.T) {
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/users/me":
					fmt.Fprint(w, `{"id":7,"username":"Player"}`)
				case "/api/roms/42":
					fmt.Fprint(w, `{"id":42,"platform_id":8,"platform_slug":"3do","fs_name":"homebrew.iso","fs_size_bytes":734003200}`)
				case "/api/firmware":
					if missing {
						fmt.Fprint(w, `[]`)
					} else {
						fmt.Fprint(w, `[{"id":9,"platform_id":8,"file_name":"panafz1.bin"},{"id":10,"platform_id":8,"file_name":"panafz10.bin"},{"id":11,"platform_id":99,"file_name":"other.bin"}]`)
					}
				case "/api/firmware/9/content/panafz1.bin", "/api/firmware/10/content/panafz10.bin":
					if r.Header.Get("Authorization") != "Bearer disc-test-token" {
						w.WriteHeader(401)
						return
					}
					fmt.Fprint(w, "test firmware payload")
				case "/api/saves", "/api/states":
					fmt.Fprint(w, `[]`)
				default:
					w.WriteHeader(404)
				}
			}))
			defer up.Close()
			e, err := New(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if err = e.Configure(up.URL); err != nil {
				t.Fatal(err)
			}
			if _, err = e.Link(context.Background(), "owner", "disc-test-token", ""); err != nil {
				t.Fatal(err)
			}
			session, err := e.Play(context.Background(), "owner", 42)
			if missing {
				if err == nil || !strings.Contains(err.Error(), "BIOS") {
					t.Fatalf("disc launch must explain missing BIOS, got %v", err)
				}
				return
			}
			if err != nil || session.Game.Core != "opera" || session.BIOSID != 9 {
				t.Fatalf("disc did not launch with available BIOS: %+v %v", session, err)
			}
			content, err := e.Content(context.Background(), "owner", session.ID, "bios")
			if err != nil {
				t.Fatal(err)
			}
			data, err := io.ReadAll(content.Body)
			content.Body.Close()
			if err != nil {
				t.Fatal(err)
			}
			archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
			if err != nil {
				t.Fatal(err)
			}
			if session.BIOSName != "firmware.zip" || len(archive.File) != 2 || archive.File[0].Name != "panafz1.bin" || archive.File[1].Name != "panafz10.bin" {
				t.Fatal("firmware names or platform scope were lost")
			}
			for _, file := range archive.File {
				stream, err := file.Open()
				if err != nil {
					t.Fatal(err)
				}
				payload, err := io.ReadAll(stream)
				stream.Close()
				if err != nil || string(payload) != "test firmware payload" {
					t.Fatal("firmware stream was truncated")
				}
			}

		})
	}
}
