package main

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"io"
	"net/http"
	"strings"
	"testing"

	pluginv1 "github.com/Silo-Server/silo-plugin-sdk/pkg/pluginproto/silo/plugin/v1"
	plugin "github.com/theramindex/silo-plugin-romm/internal/plugin"
)

// Silo routes only requests named by the packaged manifest. Exercise delivery
// through that gate; the localhost harness previously bypassed it entirely.
func TestPackagedPlatformArtworkDelivery(t *testing.T) {
	var manifest struct {
		Routes []struct{ Method, Path, Access string } `json:"http_routes"`
	}
	if err := json.Unmarshal(manifestJSON, &manifest); err != nil {
		t.Fatal(err)
	}
	s := &plugin.Server{}
	paths := []string{"/romm/assets/platforms/index.json"}
	for i := 0; i < len(paths); i++ {
		path := paths[i]
		allowed := false
		for _, route := range manifest.Routes {
			if route.Path == path && route.Method == "GET" && route.Access == "authenticated" {
				allowed = true
				break
			}
		}
		if !allowed {
			t.Fatalf("Silo cannot route packaged artwork: %s", path)
		}
		out, err := s.Handle(context.Background(), &pluginv1.HandleHTTPRequest{Method: "GET", Path: path})
		if err != nil || out.GetStatusCode() != 200 {
			t.Fatalf("artwork delivery failed: %s %v", path, err)
		}
		if strings.HasSuffix(path, ".svg") {
			var svg struct{ XMLName xml.Name }
			if xml.Unmarshal(out.GetBody(), &svg) != nil || svg.XMLName.Local != "svg" || out.GetHeaders()["Content-Type"] != "image/svg+xml" {
				t.Fatal("platform art was not served as SVG")
			}
		} else {
			var names []string
			if json.Unmarshal(out.GetBody(), &names) != nil || len(names) == 0 {
				t.Fatal("platform illustration index unavailable")
			}
			for _, name := range names {
				paths = append(paths, "/romm/assets/platforms/"+name+".svg")
			}
		}
	}
}

// A real core exceeds gRPC's default message limit. Delivery must cross Silo's
// authenticated route gate and the loopback relay, without truncating its pack.
func TestPackagedLargeCoreDelivery(t *testing.T) {
	const route = "/romm/assets/emulator/data/cores/fbneo-wasm.data"
	var manifest struct {
		Routes []struct{ Method, Path, Access string } `json:"http_routes"`
	}
	if err := json.Unmarshal(manifestJSON, &manifest); err != nil {
		t.Fatal(err)
	}
	allowed := false
	for _, r := range manifest.Routes {
		if r.Path == route && r.Method == "GET" && r.Access == "authenticated" {
			allowed = true
		}
	}
	if !allowed {
		t.Fatal("core is absent from authenticated manifest routes")
	}
	server := &plugin.Server{}
	defer server.Close()
	request := &pluginv1.HandleHTTPRequest{Method: "GET", Path: route, Headers: map[string]string{"X-Silo-User-Id": "7", "X-Silo-Profile-Id": "player"}}
	response, err := server.Handle(context.Background(), request)
	if err != nil || response.GetStatusCode() != 200 {
		t.Fatalf("core route failed: %v %v", response, err)
	}
	target := response.GetHeaders()["X-Silo-Relay-URL"]
	if target == "" {
		t.Fatal("large core was sent through gRPC instead of relay")
	}
	up, err := http.Get(target)
	if err != nil {
		t.Fatal(err)
	}
	defer up.Body.Close()
	data, err := io.ReadAll(up.Body)
	if err != nil || up.StatusCode != 200 || len(data) <= 4<<20 || !bytes.HasPrefix(data, []byte{'7', 'z', 0xbc, 0xaf, 0x27, 0x1c}) {
		t.Fatalf("core pack truncated or invalid: status=%d bytes=%d err=%v", up.StatusCode, len(data), err)
	}
	request.Headers = nil
	denied, _ := server.Handle(context.Background(), request)
	if denied.GetStatusCode() != 401 {
		t.Fatal("large core relay granted without profile identity")
	}
}
