package romm

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCollectionsPreserveStandardAndSmartIdentity(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/users/me":
			fmt.Fprint(w, `{"id":7,"username":"Player"}`)
		case "/api/collections":
			fmt.Fprint(w, `[{"id":9,"name":"Handpicked","rom_count":2}]`)
		case "/api/collections/smart":
			fmt.Fprint(w, `[{"id":9,"name":"Recently added","rom_count":4}]`)
		case "/api/roms":
			if r.URL.Query().Get("smart_collection_id") != "9" || r.URL.Query().Has("collection_id") || r.URL.Query().Get("offset") != "48" {
				t.Errorf("wrong smart collection query: %v", r.URL.Query())
			}
			fmt.Fprint(w, `{"items":[{"id":42,"name":"Test","platform_slug":"nes"}],"total":49}`)
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
	if _, err = e.Link(context.Background(), "owner", "collection-test-token", ""); err != nil {
		t.Fatal(err)
	}
	collections, err := e.Collections(context.Background(), "owner")
	if err != nil || len(collections) != 2 {
		t.Fatalf("collections=%+v err=%v", collections, err)
	}
	if collections[0].Key != "9" || collections[1].Key != "smart:9" || collections[1].Kind != "smart" {
		t.Fatalf("ambiguous identities: %+v", collections)
	}
	page, err := e.Games(context.Background(), "owner", BrowseQuery{Collection: collections[1].Key, Offset: "48"})
	if err != nil || page.Total != 49 || len(page.Items) != 1 {
		t.Fatalf("smart collection games=%+v err=%v", page, err)
	}
}
