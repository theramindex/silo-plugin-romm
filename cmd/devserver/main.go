// A localhost-only development harness for exercising the plugin exactly through
// its HTTP-routes contract. --fixture uses a generated, original NES test ROM;
// this command is never included in the released plugin executable.
package main

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	pluginv1 "github.com/Silo-Server/silo-plugin-sdk/pkg/pluginproto/silo/plugin/v1"
	plugin "github.com/theramindex/silo-plugin-romm/internal/plugin"
	"github.com/theramindex/silo-plugin-romm/internal/romm"
	"google.golang.org/protobuf/types/known/structpb"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
)

func main() {
	port := flag.Int("port", 18783, "Local HTTP port")
	fixture := flag.Bool("fixture", false, "Use a local test library with an original NES diagnostic ROM")
	flag.Parse()
	if !*fixture {
		panic("Pass --fixture; this harness never connects a real account")
	}
	var mu sync.Mutex
	assets := map[string][]byte{}
	emulator := ""
	var approvalCounter atomic.Int64
	approvedFlows := map[string]bool{}
	deniedFlows := map[string]bool{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/api/auth/device/init":
			code := fmt.Sprintf("%08d", approvalCounter.Add(1))
			mu.Lock()
			approvedFlows[code] = false
			mu.Unlock()
			w.WriteHeader(201)
			fmt.Fprintf(w, `{"device_code":%q,"user_code":%q,"verification_path":"/pair/device","verification_path_complete":%q,"expires_in":300,"interval":1}`, code, code, "/pair/device?user_code="+code)
		case r.URL.Path == "/pair/device":
			w.Header().Set("Content-Type", "text/html")
			fmt.Fprintf(w, `<!doctype html><title>RomM fixture approval</title><h1>Connect Silo Games</h1><p>Fixture account: Development player</p><form method="POST" action="/api/auth/device/approve"><input type="hidden" name="code" value="%s"><button>Approve Silo Games</button><button formaction="/api/auth/device/deny">Decline access</button></form>`, r.URL.Query().Get("user_code"))
		case r.URL.Path == "/api/auth/device/approve":
			r.ParseForm()
			mu.Lock()
			approvedFlows[r.Form.Get("code")] = true
			mu.Unlock()
			w.Header().Set("Content-Type", "text/html")
			fmt.Fprint(w, `<!doctype html><title>Approved</title><h1>Approved</h1><p>You can return to Games.</p>`)
		case r.URL.Path == "/api/auth/device/deny":
			r.ParseForm()
			mu.Lock()
			deniedFlows[r.Form.Get("code")] = true
			mu.Unlock()
			w.Header().Set("Content-Type", "text/html")
			fmt.Fprint(w, `<!doctype html><title>Declined</title><h1>Declined</h1>`)
		case r.URL.Path == "/api/auth/device/token":
			var payload struct {
				Code string `json:"device_code"`
			}
			json.NewDecoder(r.Body).Decode(&payload)
			mu.Lock()
			approved := approvedFlows[payload.Code]
			denied := deniedFlows[payload.Code]
			mu.Unlock()
			if denied {
				w.WriteHeader(400)
				fmt.Fprint(w, `{"detail":"access_denied"}`)
				return
			}
			if !approved {
				w.WriteHeader(400)
				fmt.Fprint(w, `{"detail":"authorization_pending"}`)
				return
			}
			fmt.Fprint(w, `{"access_token":"rmm_development-fixture-token","device_id":"fixture-device","scopes":["me.read","roms.read","platforms.read","collections.read","firmware.read","assets.read","assets.write"],"expires_at":null}`)
		case r.URL.Path == "/api/users/me":
			fmt.Fprint(w, `{"id":7,"username":"Development player"}`)
		case r.URL.Path == "/api/platforms":
			fmt.Fprint(w, `[{"id":1,"name":"Nintendo Entertainment System","slug":"nes","rom_count":1}]`)
		case r.URL.Path == "/api/collections/smart":
			fmt.Fprint(w, `[]`)
		case r.URL.Path == "/api/collections":
			fmt.Fprint(w, `[{"id":1,"name":"Homebrew","rom_count":1}]`)
		case r.URL.Path == "/api/roms":
			fmt.Fprint(w, `{"items":[{"id":42,"name":"Silo Controller Test","platform_id":1,"platform_slug":"nes","platform_display_name":"NES","core":"fceumm","path_cover_small":"/assets/romm/test.png?ts=2026-11-12 03:00:22","sibling_roms":[{"id":43,"name":"Silo Controller Test","fs_name_no_ext":"silo-test (Europe)"}]}],"total":1}`)
		case r.URL.Path == "/api/roms/42":
			fmt.Fprint(w, `{"id":42,"name":"Silo Controller Test","summary":"An original NES diagnostic cartridge. A blue screen confirms the bundled core booted successfully. Used only by the local development harness.","platform_id":1,"platform_slug":"nes","platform_display_name":"NES","fs_name":"silo-test.nes","path_cover_small":"/assets/romm/test.png?ts=2026-11-12 03:00:22","metadatum":{"first_release_date":649036800000},"sibling_roms":[{"id":43,"name":"Silo Controller Test","fs_name_no_ext":"silo-test (Europe)","is_main_sibling":true}]}`)
		case r.URL.Path == "/api/roms/43":
			fmt.Fprint(w, `{"id":43,"name":"Silo Controller Test","summary":"Alternate ROM fixture. No game is launched by the version-selection test.","platform_id":1,"platform_slug":"nes","platform_display_name":"NES","fs_name":"silo-test (Europe).nes","rom_user":{"is_main_sibling":true},"metadatum":{"first_release_date":649036800},"sibling_roms":[{"id":42,"name":"Silo Controller Test","fs_name_no_ext":"silo-test"}]}`)
		case strings.HasPrefix(r.URL.Path, "/api/roms/42/content/"):
			w.Header().Set("Content-Type", "application/octet-stream")
			_, _ = w.Write(testROM())
		case r.URL.Path == "/api/firmware":
			fmt.Fprint(w, `[]`)
		case r.URL.Path == "/assets/romm/test.png":
			b, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(b)
		case r.URL.Path == "/api/saves" || r.URL.Path == "/api/states":
			kind := strings.TrimPrefix(r.URL.Path, "/api/")
			mu.Lock()
			defer mu.Unlock()
			if r.Method == "POST" {
				field := "saveFile"
				if kind == "states" {
					field = "stateFile"
				}
				file, _, err := r.FormFile(field)
				if err != nil {
					w.WriteHeader(400)
					return
				}
				defer file.Close()
				assets[kind], _ = io.ReadAll(io.LimitReader(file, 17<<20))
				emulator = r.URL.Query().Get("emulator")
				fmt.Fprintf(w, `{"id":19,"rom_id":42,"user_id":7,"emulator":%q}`, emulator)
			} else if len(assets[kind]) > 0 {
				fmt.Fprintf(w, `[{"id":19,"rom_id":42,"user_id":7,"emulator":%q,"updated_at":"2026-11-06T00:00:00Z"}]`, emulator)
			} else {
				fmt.Fprint(w, `[]`)
			}
		case strings.HasSuffix(r.URL.Path, "/19/content"):
			kind := strings.Split(r.URL.Path, "/")[2]
			mu.Lock()
			defer mu.Unlock()
			w.Header().Set("Content-Type", "application/octet-stream")
			_, _ = w.Write(assets[kind])
		default:
			w.WriteHeader(404)
		}
	}))
	defer upstream.Close()
	dir, err := os.MkdirTemp("", "silo-romm-dev-")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(dir)
	engine, err := romm.New(dir)
	if err != nil {
		panic(err)
	}
	if err = engine.Configure(upstream.URL); err != nil {
		panic(err)
	}
	server := &plugin.Server{Engine: engine}
	defer server.Close()
	manifestBytes, err := os.ReadFile("manifest.json")
	if err != nil {
		panic(err)
	}
	var manifest struct {
		Routes []struct{ Method, Path string } `json:"http_routes"`
	}
	if err = json.Unmarshal(manifestBytes, &manifest); err != nil {
		panic(err)
	}
	routes := map[string]bool{}
	for _, route := range manifest.Routes {
		routes[route.Method+" "+route.Path] = true
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.Redirect(w, r, "/romm", 302)
			return
		}
		if !routes[r.Method+" "+r.URL.Path] {
			http.NotFound(w, r)
			return
		}
		query := map[string]any{}
		for k, v := range r.URL.Query() {
			query[k] = v[0]
		}
		q, _ := structpb.NewStruct(query)
		body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		headers := map[string]string{"X-Silo-User-Id": "dev-user", "X-Silo-Profile-Id": "dev-profile", "X-Silo-Theme": r.URL.Query().Get("theme")}
		answer, err := server.Handle(context.Background(), &pluginv1.HandleHTTPRequest{Path: r.URL.Path, Method: r.Method, Query: q, Headers: headers, Body: body})
		if err != nil {
			http.Error(w, "plugin failed", 500)
			return
		}
		if target := answer.GetHeaders()["X-Silo-Relay-URL"]; target != "" {
			request, _ := http.NewRequestWithContext(r.Context(), "GET", target, nil)
			res, err := http.DefaultClient.Do(request)
			if err != nil {
				http.Error(w, "relay failed", 502)
				return
			}
			defer res.Body.Close()
			for k, v := range res.Header {
				w.Header()[k] = v
			}
			w.WriteHeader(res.StatusCode)
			_, _ = io.Copy(w, res.Body)
			return
		}
		for k, v := range answer.GetHeaders() {
			w.Header().Set(k, v)
		}
		w.WriteHeader(int(answer.GetStatusCode()))
		_, _ = w.Write(answer.GetBody())
	})
	fmt.Println("Fixture harness: http://127.0.0.1:" + strconv.Itoa(*port) + "/romm")
	if err = http.ListenAndServe("127.0.0.1:"+strconv.Itoa(*port), handler); err != nil {
		panic(err)
	}
}
func testROM() []byte {
	b := make([]byte, 16+16384+8192)
	copy(b, []byte{'N', 'E', 'S', 0x1a, 1, 1})
	program := []byte{0x78, 0xd8, 0xa2, 0xff, 0x9a, 0xa9, 0, 0x8d, 0, 0x20, 0x8d, 1, 0x20, 0x2c, 2, 0x20, 0x10, 0xfb, 0xa9, 0x3f, 0x8d, 6, 0x20, 0xa9, 0, 0x8d, 6, 0x20, 0xa9, 0x21, 0x8d, 7, 0x20, 0xa9, 8, 0x8d, 1, 0x20, 0x4c, 0x26, 0xc0}
	copy(b[16:], program)
	for i := 0; i < 3; i++ {
		binary.LittleEndian.PutUint16(b[16+0x3ffa+i*2:], 0xc000)
	}
	return b
}
