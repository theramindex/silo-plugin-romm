package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	pluginv1 "github.com/Silo-Server/silo-plugin-sdk/pkg/pluginproto/silo/plugin/v1"
	"github.com/theramindex/silo-plugin-romm/internal/romm"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// HTTP boundary: RomM owns approval; the plugin must bind it to the verified
// Silo profile, hide polling credentials and persist only an approved identity.
func TestBrowserApprovalOwnsProfileAndPersistsConnection(t *testing.T) {
	var polls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/auth/device/init":
			var body struct {
				Client string   `json:"client"`
				Scopes []string `json:"requested_scopes"`
			}
			json.NewDecoder(r.Body).Decode(&body)
			if body.Client != "silo" || len(body.Scopes) != 7 {
				t.Errorf("wrong requested application/scopes: %+v", body)
			}
			w.WriteHeader(201)
			fmt.Fprint(w, `{"device_code":"private-device-code","user_code":"ABCD1234","verification_path":"/pair/device","verification_path_complete":"/pair/device?user_code=ABCD1234","expires_in":300,"interval":1}`)
		case "/api/auth/device/token":
			polls.Add(1)
			var in map[string]string
			json.NewDecoder(r.Body).Decode(&in)
			if in["device_code"] != "private-device-code" {
				t.Error("wrong polling secret")
			}
			fmt.Fprint(w, `{"access_token":"rmm_private-approved-token","device_id":"device-1","scopes":["me.read","roms.read","platforms.read","collections.read","firmware.read","assets.read","assets.write"],"expires_at":null}`)
		case "/api/users/me":
			if r.Header.Get("Authorization") != "Bearer rmm_private-approved-token" {
				t.Error("identity was not verified with issued token")
			}
			fmt.Fprint(w, `{"id":55,"username":"approved-player"}`)
		default:
			w.WriteHeader(404)
		}
	}))
	defer upstream.Close()
	dir := t.TempDir()
	e, err := romm.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	e.Configure(upstream.URL)
	s := &Server{Engine: e}
	defer s.Close()
	call := func(profile, path string, body any) *pluginv1.HandleHTTPResponse {
		t.Helper()
		data, _ := json.Marshal(body)
		out, err := s.Handle(context.Background(), &pluginv1.HandleHTTPRequest{Path: "/romm/api/sign-in/" + path, Method: "POST", Headers: map[string]string{"X-Silo-User-Id": "7", "X-Silo-Profile-Id": profile}, Body: data})
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	start := call("profile-a", "start", map[string]string{})
	if start.GetStatusCode() != 200 {
		t.Fatalf("start: %d %s", start.GetStatusCode(), start.GetBody())
	}
	var flow struct {
		ID   string `json:"id"`
		URL  string `json:"verificationUrl"`
		Code string `json:"userCode"`
	}
	if err := json.Unmarshal(start.GetBody(), &flow); err != nil {
		t.Fatal(err)
	}
	if flow.ID == "" || flow.Code != "ABCD1234" || flow.URL != upstream.URL+"/pair/device?user_code=ABCD1234" {
		t.Fatalf("invalid public flow: %s", start.GetBody())
	}
	if strings.Contains(string(start.GetBody()), "private-device-code") {
		t.Fatal("polling secret exposed to browser")
	}
	foreign := call("profile-b", "poll", map[string]string{"id": flow.ID})
	if foreign.GetStatusCode() != 409 || polls.Load() != 0 {
		t.Fatal("another profile polled the upstream flow")
	}
	if err := os.Mkdir(filepath.Join(dir, "links.json"), 0700); err != nil {
		t.Fatal(err)
	}
	pending := call("profile-a", "poll", map[string]string{"id": flow.ID})
	if !strings.Contains(string(pending.GetBody()), `"status":"pending"`) {
		t.Fatalf("persistence failure was acknowledged: %s", pending.GetBody())
	}
	if err := os.Remove(filepath.Join(dir, "links.json")); err != nil {
		t.Fatal(err)
	}
	time.Sleep(1100 * time.Millisecond)
	approved := call("profile-a", "poll", map[string]string{"id": flow.ID})
	if approved.GetStatusCode() != 200 || !strings.Contains(string(approved.GetBody()), `"status":"complete"`) {
		t.Fatalf("approval failed: %s", approved.GetBody())
	}
	if strings.Contains(string(approved.GetBody()), "rmm_private") || strings.Contains(string(approved.GetBody()), "private-device-code") {
		t.Fatal("authorization credential exposed")
	}
	if !strings.Contains(string(approved.GetBody()), "approved-player") {
		t.Fatal("verified identity missing")
	}
	retry := call("profile-a", "poll", map[string]string{"id": flow.ID})
	if retry.GetStatusCode() != 200 || polls.Load() != 1 {
		t.Fatal("retry consumed the one-time upstream token again")
	}
	restored, err := romm.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	restored.Configure(upstream.URL)
	own, _ := json.Marshal([]string{"7", "profile-a"})
	if !restored.Status(string(own)).Linked {
		t.Fatal("approved connection did not survive restart")
	}
}

func TestBrowserApprovalPendingDenialCancelExpiryAndRedirect(t *testing.T) {
	for _, scenario := range []string{"pending", "denied", "cancel", "expiry", "unsafe-url"} {
		t.Run(scenario, func(t *testing.T) {
			var polls atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if strings.HasSuffix(r.URL.Path, "/init") {
					expiry := 300
					if scenario == "expiry" {
						expiry = 1
					}
					verification := "/pair/device?user_code=12345678"
					if scenario == "unsafe-url" {
						verification = "https://foreign.invalid/approve"
					}
					w.WriteHeader(201)
					fmt.Fprintf(w, `{"device_code":"secret-code","user_code":"12345678","verification_path_complete":%q,"expires_in":%d,"interval":5}`, verification, expiry)
					return
				}
				polls.Add(1)
				w.WriteHeader(400)
				detail := "authorization_pending"
				if scenario == "denied" {
					detail = "access_denied"
				}
				fmt.Fprintf(w, `{"detail":%q}`, detail)
			}))
			defer upstream.Close()
			e, err := romm.New(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			e.Configure(upstream.URL)
			s := &Server{Engine: e}
			defer s.Close()
			call := func(action, id string) *pluginv1.HandleHTTPResponse {
				b, _ := json.Marshal(map[string]string{"id": id})
				out, _ := s.Handle(context.Background(), &pluginv1.HandleHTTPRequest{Path: "/romm/api/sign-in/" + action, Method: "POST", Headers: map[string]string{"X-Silo-User-Id": "1", "X-Silo-Profile-Id": "2"}, Body: b})
				return out
			}
			start := call("start", "")
			if scenario == "unsafe-url" {
				if start.GetStatusCode() == 200 {
					t.Fatal("off-server approval URL accepted")
				}
				return
			}
			if start.GetStatusCode() != 200 {
				t.Fatalf("start failed: %s", start.GetBody())
			}
			var flow struct {
				ID string `json:"id"`
			}
			json.Unmarshal(start.GetBody(), &flow)
			switch scenario {
			case "cancel":
				call("cancel", flow.ID)
				out := call("poll", flow.ID)
				if out.GetStatusCode() != 409 || polls.Load() != 0 {
					t.Fatal("cancelled flow was polled")
				}
			case "expiry":
				time.Sleep(1100 * time.Millisecond)
				out := call("poll", flow.ID)
				if !strings.Contains(string(out.GetBody()), `"status":"expired"`) || polls.Load() != 0 {
					t.Fatalf("expired flow reached upstream: %s", out.GetBody())
				}
			default:
				out := call("poll", flow.ID)
				expected := "pending"
				if scenario == "denied" {
					expected = "denied"
				}
				if !strings.Contains(string(out.GetBody()), `"status":"`+expected+`"`) {
					t.Fatalf("wrong outcome: %s", out.GetBody())
				}
				if scenario == "pending" {
					call("poll", flow.ID)
					if polls.Load() != 1 {
						t.Fatal("rapid browser polling ignored RomM interval")
					}
				}
			}
			own, _ := json.Marshal([]string{"1", "2"})
			if e.Status(string(own)).Linked {
				t.Fatal("unapproved connection persisted")
			}
		})
	}
}
