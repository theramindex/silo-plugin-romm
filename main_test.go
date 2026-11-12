package main

import (
	"context"
	"encoding/json"
	"encoding/xml"
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
