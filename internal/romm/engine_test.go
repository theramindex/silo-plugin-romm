package romm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestArtworkCacheTimestampsAndPathBoundary(t *testing.T) {
	const cover = "/assets/romm/resources/roms/117/57967/cover/big.png"
	for _, tc := range []struct {
		name, path string
		allowed    bool
	}{
		{"plain", cover, true},
		{"RomM timestamp", cover + "?ts=2026-11-12 03:00:22", true},
		{"encoded timestamp", cover + "?ts=2026-11-12%2003%3A00%3A22", true},
		{"other query", cover + "?redirect=https://other.invalid", false},
		{"extra query", cover + "?ts=1&redirect=elsewhere", false},
		{"traversal", "/assets/romm/%2e%2e/private.png?ts=1", false},
		{"external", "https://other.invalid/assets/romm/cover.png?ts=1", false},
		{"fragment", cover + "?ts=1#fragment", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			coverCalls := 0
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/users/me":
					fmt.Fprint(w, `{"id":7,"username":"Player"}`)
				case "/api/roms/57967":
					json.NewEncoder(w).Encode(map[string]any{"id": 57967, "name": "Dr. Mario", "path_cover_large": tc.path})
				case cover:
					coverCalls++
					wantTS := ""
					if tc.name != "plain" {
						wantTS = "2026-11-12 03:00:22"
					}
					if r.URL.Query().Get("ts") != wantTS || len(r.URL.Query()) > 1 || r.Header.Get("Authorization") != "Bearer artwork-test-token" {
						t.Errorf("cover request changed boundary: query=%q", r.URL.RawQuery)
					}
					w.Header().Set("Content-Type", "image/png")
					fmt.Fprint(w, "cover bytes")
				default:
					w.WriteHeader(404)
				}
			}))
			defer up.Close()
			e, err := New(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			e.Configure(up.URL)
			if _, err = e.Link(context.Background(), "owner", "artwork-test-token", ""); err != nil {
				t.Fatal(err)
			}
			res, err := e.Artwork(context.Background(), "owner", 57967)
			if !tc.allowed {
				if err == nil || coverCalls != 0 {
					t.Fatalf("unsafe artwork accepted: err=%v calls=%d", err, coverCalls)
				}
				return
			}
			if err != nil {
				t.Fatalf("valid RomM cover rejected: %v", err)
			}
			defer res.Body.Close()
			body, err := io.ReadAll(res.Body)
			if err != nil || string(body) != "cover bytes" || coverCalls != 1 {
				t.Fatalf("cover delivery failed: %q %v calls=%d", body, err, coverCalls)
			}
		})
	}
}

func TestLibraryBrowsingFiltersBeforePagination(t *testing.T) {
	var calls int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/users/me":
			fmt.Fprint(w, `{"id":7,"username":"Player"}`)
		case "/api/platforms":
			fmt.Fprint(w, `[{"id":1,"slug":"nes"},{"id":2,"slug":"snes"},{"id":3,"slug":"ps4"}]`)
		case "/api/roms":
			calls++
			q := r.URL.Query()
			if strings.Join(q["platform_ids"], ",") != "1,2" || q.Get("order_by") != "created_at" || q.Get("order_dir") != "desc" || q.Get("offset") != "48" || q.Get("collection_id") != "9" || q.Get("group_by_meta_id") != "true" {
				t.Errorf("incorrect browse query: %v", q)
			}
			fmt.Fprint(w, `{"items":[{"id":42,"name":"(CUSA01627) - Test_Game (USA).nes.zip","fs_name":"(CUSA01627) - Test_Game (USA).nes.zip","platform_slug":"nes","metadatum":{"first_release_date":649036800000},"sibling_roms":[{"id":43,"fs_name_no_ext":"Test Game (Europe)","is_main_sibling":true},{"id":44,"fs_name_no_ext":"Test Game (World) (Beta)"}]}],"total":97}`)
		default:
			w.WriteHeader(404)
		}
	}))
	defer upstream.Close()
	e, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	e.Configure(upstream.URL)
	if _, err = e.Link(context.Background(), "owner", "library-test-token", ""); err != nil {
		t.Fatal(err)
	}
	page, err := e.Games(context.Background(), "owner", BrowseQuery{Playable: true, Sort: "newest", Offset: "48", Collection: "9"})
	if err != nil || page.Total != 97 || len(page.Items) != 1 || page.Items[0].DisplayTitle != "Test Game" {
		t.Fatalf("browse: %+v %v", page, err)
	}
	if page.Items[0].VersionCount != 3 || len(page.Items[0].Siblings) != 2 || page.Items[0].Siblings[0].Filename != "Test Game (Europe)" || !page.Items[0].Siblings[0].Preferred || page.Items[0].Metadata.ReleaseYear != 1990 {
		t.Fatalf("version/date metadata lost: %+v", page.Items[0])
	}
	page, err = e.Games(context.Background(), "owner", BrowseQuery{Playable: true, Platform: "3"})
	if err != nil || page.Total != 0 || len(page.Items) != 0 || calls != 1 {
		t.Fatalf("unsupported platform leaked games: %+v %v; calls=%d", page, err, calls)
	}
	if _, err = e.Games(context.Background(), "owner", BrowseQuery{Sort: "arbitrary-field"}); err == nil {
		t.Fatal("invalid sort accepted")
	}
}

func TestFileDerivedDisplayTitlesPreserveMetadata(t *testing.T) {
	for _, tc := range []struct{ name, file, want string }{
		{"(CUSA01627) - Dead or Alive 5 Last Round PS4 4.05 PKG.rar", "(CUSA01627) - Dead or Alive 5 Last Round PS4 4.05 PKG.rar", "Dead or Alive 5 Last Round"},
		{"", "Adventure_Game (Europe).gba.zip", "Adventure Game"},
		{"Pokémon Emerald Version", "Pokemon_Emerald (USA).gba", "Pokémon Emerald Version"},
		{".hack//G.U. Last Recode", "hack.iso", ".hack//G.U. Last Recode"},
		{"Game (Rev 2).nes", "Game (Rev 2).nes", "Game (Rev 2)"},
	} {
		g := Game{Name: tc.name, Filename: tc.file}
		if got := displayTitle(g); got != tc.want {
			t.Errorf("title %q: got %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestReleaseDatesInSecondsAndMilliseconds(t *testing.T) {
	for _, tc := range []struct {
		stamp int64
		year  int
	}{
		{649036800, 1990}, {649036800000, 1990}, {31536000000, 1971}, {0, 0}, {9223372036854775807, 0},
	} {
		g := Game{ID: 42, Metadata: GameMetadata{ReleaseDate: tc.stamp}}
		normalizeGame(&g)
		if g.Metadata.ReleaseYear != tc.year {
			t.Errorf("stamp %d: year=%d want=%d", tc.stamp, g.Metadata.ReleaseYear, tc.year)
		}
	}
}

func TestPlayUsesRomMFileAvailability(t *testing.T) {
	for _, tc := range []struct {
		name    string
		onDisk  any
		blocked bool
	}{
		{"missing file", false, true},
		{"RomM reports file present", true, false},
		{"older server without disk check", nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/users/me":
					fmt.Fprint(w, `{"id":7,"username":"Player"}`)
				case "/api/roms/42":
					// RomM derives has_file_on_disk from its stored missing flag.
					json.NewEncoder(w).Encode(map[string]any{"id": 42, "name": "Diagnostic ROM", "platform_slug": "nes", "fs_name": "test.nes", "missing_from_fs": tc.onDisk != true, "has_file_on_disk": tc.onDisk})
				case "/api/saves", "/api/states", "/api/firmware":
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
			if _, err = e.Link(context.Background(), "owner", "availability-test-token", ""); err != nil {
				t.Fatal(err)
			}
			s, err := e.Play(context.Background(), "owner", 42)
			if tc.blocked {
				if err == nil || !strings.Contains(err.Error(), "cannot find this ROM file") || s.ID != "" {
					t.Fatalf("missing file was offered for play: session=%t err=%v", s.ID != "", err)
				}
			} else if err != nil || s.ID == "" {
				t.Fatalf("file availability rejected a usable or unknown ROM: %v", err)
			}
		})
	}
}

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
