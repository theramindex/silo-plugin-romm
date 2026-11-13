package romm

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDetailReportsOnlyCompatibleProgressWithoutReservingSessions(t *testing.T) {
	for _, tc := range []struct {
		name, assets               string
		unavailable, known, resume bool
	}{
		{"empty", `[]`, false, true, false},
		{"compatible", `[{"id":19,"rom_id":42,"user_id":7,"emulator":"fceumm-emulatorjs-4.2.3"}]`, false, true, true},
		{"another profile or version", `[{"id":19,"rom_id":42,"user_id":8,"emulator":"fceumm-emulatorjs-4.2.3"},{"id":20,"rom_id":43,"user_id":7,"emulator":"fceumm-emulatorjs-4.2.3"},{"id":21,"rom_id":42,"user_id":7,"emulator":"another-client"}]`, false, true, false},
		{"lookup outage", `[]`, true, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/users/me":
					fmt.Fprint(w, `{"id":7,"username":"Player"}`)
				case "/api/roms/42":
					fmt.Fprint(w, `{"id":42,"platform_slug":"nes","fs_name":"test.nes"}`)
				case "/api/saves":
					if tc.unavailable {
						w.WriteHeader(503)
					} else {
						fmt.Fprint(w, tc.assets)
					}
				case "/api/states", "/api/firmware":
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
			if _, err = e.Link(context.Background(), "owner", "progress-test-token", ""); err != nil {
				t.Fatal(err)
			}
			for range 5 {
				d, err := e.Detail(context.Background(), "owner", 42)
				if err != nil || d.ID != 42 || d.ProgressKnown != tc.known || d.ResumeAvailable != tc.resume {
					t.Fatalf("detail=%+v err=%v", d, err)
				}
			}
			if !tc.unavailable {
				for range 4 {
					if _, err = e.Play(context.Background(), "owner", 42); err != nil {
						t.Fatalf("read-only detail consumed playback capacity: %v", err)
					}
				}
			} else if _, err = e.Play(context.Background(), "owner", 42); err == nil {
				t.Fatal("progress outage started a fresh game")
			}
		})
	}
}

func TestRecentGamesKeepPlayedROMIdentity(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/users/me":
			fmt.Fprint(w, `{"id":7,"username":"Player"}`)
		case "/api/roms":
			q := r.URL.Query()
			if q.Get("last_played") != "true" || q.Get("order_by") != "last_played" || q.Get("order_dir") != "desc" || q.Get("group_by_meta_id") != "false" {
				t.Errorf("incorrect recent query: %v", q)
			}
			fmt.Fprint(w, `{"items":[{"id":42,"name":"Test Game","platform_slug":"nes","rom_user":{"last_played":"2026-11-12T20:00:00Z"},"sibling_roms":[{"id":43,"is_main_sibling":true}]}],"total":1}`)
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
	if _, err = e.Link(context.Background(), "owner", "recent-test-token", ""); err != nil {
		t.Fatal(err)
	}
	p, err := e.Games(context.Background(), "owner", BrowseQuery{Recent: true})
	if err != nil || len(p.Items) != 1 || p.Items[0].ID != 42 || p.Items[0].User.LastPlayed != "2026-11-12T20:00:00Z" {
		t.Fatalf("played version lost: %+v %v", p, err)
	}
}
