package romm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Contract boundary: a real HTTP upstream and durable link store. Two Silo
// profiles must never borrow credentials, sessions, or save ownership.
func TestProfileLinkSaveOwnershipAndRestart(t *testing.T) {
	ctx := context.Background()
	writes := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		user := int64(7)
		if r.Header.Get("Authorization") == "Bearer player-two-token" {
			user = 8
		}
		switch {
		case r.URL.Path == "/api/users/me":
			fmt.Fprintf(w, `{"id":%d,"username":"same-display-name"}`, user)
		case r.URL.Path == "/api/roms/42":
			fmt.Fprint(w, `{"id":42,"name":"Homebrew","platform_id":1,"platform_slug":"nes","fs_name":"homebrew.nes"}`)
		case r.URL.Path == "/api/saves" && r.Method == "POST":
			writes++
			if r.URL.Query().Get("rom_id") != "42" {
				t.Error("unbound ROM")
			}
			if err := r.ParseMultipartForm(20 << 20); err != nil {
				t.Error(err)
			}
			f, _, err := r.FormFile("saveFile")
			if err != nil {
				t.Error(err)
			} else {
				f.Close()
			}
			fmt.Fprintf(w, `{"id":19,"rom_id":42,"user_id":%d,"emulator":%q}`, user, r.URL.Query().Get("emulator"))
		case r.URL.Path == "/api/saves" || r.URL.Path == "/api/states" || r.URL.Path == "/api/firmware":
			fmt.Fprint(w, `[]`)
		default:
			w.WriteHeader(404)
		}
	}))
	defer upstream.Close()
	dir := t.TempDir()
	e, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err = e.Configure(upstream.URL); err != nil {
		t.Fatal(err)
	}
	if _, err = e.Link(ctx, "user/profile-one", "player-one-token", ""); err != nil {
		t.Fatal(err)
	}
	if e.Status("user/profile-two").Linked {
		t.Fatal("profile borrowed a link")
	}
	if _, err = e.Link(ctx, "user/profile-two", "player-two-token", ""); err != nil {
		t.Fatal(err)
	}
	session, err := e.Play(ctx, "user/profile-one", 42)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = e.Session("user/profile-two", session.ID); err == nil {
		t.Fatal("session crossed profiles")
	}
	begin, err := e.Upload(ctx, "user/profile-one", UploadRequest{Session: session.ID, Kind: "saves"})
	if err != nil {
		t.Fatal(err)
	}
	chunk := UploadRequest{ID: begin.ID, Data: base64.StdEncoding.EncodeToString([]byte("actual-progress")), Final: true}
	if _, err = e.Upload(ctx, "user/profile-two", chunk); err == nil {
		t.Fatal("upload crossed profiles")
	}
	result, err := e.Upload(ctx, "user/profile-one", chunk)
	if err != nil || !result.Complete {
		t.Fatalf("save: %+v %v", result, err)
	}
	if _, err = e.Upload(ctx, "user/profile-one", chunk); err != nil || writes != 1 {
		t.Fatalf("retry duplicated upload: writes=%d %v", writes, err)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "links.json"))
	if strings.Contains(string(raw), "player-one-token") {
		t.Fatal("plaintext token on disk")
	}
	restored, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	restored.Configure(upstream.URL)
	if !restored.Status("user/profile-one").Linked {
		t.Fatal("link did not survive restart")
	}
	var identity Identity
	if err = restored.JSON(ctx, "user/profile-two", "/api/users/me", &identity); err != nil || identity.ID != 8 {
		t.Fatalf("restored wrong user: %+v %v", identity, err)
	}
	if _, err = e.Link(ctx, "user/profile-one", "player-two-token", ""); err != nil {
		t.Fatal(err)
	}
	if _, err = e.Session("user/profile-one", session.ID); err == nil {
		t.Fatal("relink kept old session")
	}
	secondSession, err := e.Play(ctx, "user/profile-two", 42)
	if err != nil {
		t.Fatal(err)
	}
	e.Configure("https://different.invalid")
	if e.Status("user/profile-one").Linked {
		t.Fatal("token followed changed server")
	}
	e.Configure(upstream.URL)
	if _, err = e.Session("user/profile-two", secondSession.ID); err == nil {
		t.Fatal("changing the server back revived an invalidated play session")
	}
	var stored map[string]Link
	if json.Unmarshal(raw, &stored) != nil || len(stored) != 2 {
		t.Fatal("links missing")
	}
}

func TestLinkRejectsUnverifiedIdentityAndCredentialRedirects(t *testing.T) {
	reached := false
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached = true; fmt.Fprint(w, `{"id":99}`) }))
	defer other.Close()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.Header.Get("Authorization"), "redirect") {
			http.Redirect(w, r, other.URL, 302)
			return
		}
		fmt.Fprint(w, `{"username":"no-id"}`)
	}))
	defer upstream.Close()
	e, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	e.Configure(upstream.URL)
	for _, token := range []string{"invalid-identity-token", "redirect-identity-token"} {
		if _, err := e.Link(context.Background(), "owner", token, ""); err == nil || e.Status("owner").Linked {
			t.Fatal("unverified account linked")
		}
	}
	if reached {
		t.Fatal("credentials followed off-server redirect")
	}
}

func TestBrowserApprovalCannotCommitAfterCancelRelinkOrServerChange(t *testing.T) {
	for _, action := range []string{"cancel", "relink", "server"} {
		t.Run(action, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/api/auth/device/init":
					w.WriteHeader(201)
					fmt.Fprint(w, `{"device_code":"private-race-code","user_code":"12345678","verification_path_complete":"/pair/device?user_code=12345678","expires_in":300,"interval":1}`)
				case "/api/auth/device/token":
					fmt.Fprint(w, `{"access_token":"rmm_old-approved-token","scopes":["me.read","roms.read","platforms.read","collections.read","firmware.read","assets.read","assets.write"]}`)
				case "/api/users/me":
					if r.Header.Get("Authorization") == "Bearer manual-new-token" {
						fmt.Fprint(w, `{"id":22,"username":"new-account"}`)
						return
					}
					close(entered)
					<-release
					fmt.Fprint(w, `{"id":11,"username":"old-account"}`)
				}
			}))
			defer upstream.Close()
			e, err := New(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			e.Configure(upstream.URL)
			flow, err := e.StartSignIn(context.Background(), "owner")
			if err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() { _, err := e.PollSignIn(context.Background(), "owner", flow.ID); done <- err }()
			select {
			case <-entered:
			case <-time.After(2 * time.Second):
				close(release)
				t.Fatal("verification never started")
			}
			switch action {
			case "cancel":
				_, err = e.CancelSignIn("owner", flow.ID)
			case "relink":
				_, err = e.Link(context.Background(), "owner", "manual-new-token", "")
			case "server":
				err = e.Configure("https://different.invalid")
			}
			close(release)
			if err != nil {
				t.Fatal(err)
			}
			if err = <-done; err == nil {
				t.Fatal("stale approval committed")
			}
			connection := e.Status("owner")
			if action == "relink" {
				if !connection.Linked || connection.Identity.ID != 22 {
					t.Fatal("late approval replaced the manually linked account")
				}
			} else if connection.Linked {
				t.Fatal("cancelled/reconfigured approval persisted")
			}
		})
	}
}
