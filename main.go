package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	pluginv1 "github.com/Silo-Server/silo-plugin-sdk/pkg/pluginproto/silo/plugin/v1"
	publicmanifest "github.com/Silo-Server/silo-plugin-sdk/pkg/pluginsdk/manifest"
	sdkruntime "github.com/Silo-Server/silo-plugin-sdk/pkg/pluginsdk/runtime"
	"github.com/Silo-Server/silo-plugin-sdk/pkg/pluginsdk/runtimedefault"
	pluginimpl "github.com/theramindex/silo-plugin-romm/internal/plugin"
	"github.com/theramindex/silo-plugin-romm/internal/romm"
	"os"
)

//go:embed manifest.json
var manifestJSON []byte
var buildVersion string

func main() {
	manifest, err := publicmanifest.LoadWithChecksum(manifestJSON, buildVersion)
	if err != nil {
		panic(err)
	}
	if err = publicmanifest.ValidateCatalogPresentation(manifest, "https://github.com/theramindex/silo-plugin-romm"); err != nil {
		panic(err)
	}
	if len(os.Args) > 1 && os.Args[1] == "manifest" {
		sdkruntime.ServeManifestWithOptions(manifestJSON, buildVersion, sdkruntime.CapabilityServers{Runtime: &runtimedefault.Server{}})
		return
	}
	dir := os.Getenv("ROMM_DATA_DIR")
	if dir == "" {
		dir = "/var/lib/continuum/plugins/silo.ramindex.romm"
	}
	engine, err := romm.New(dir)
	if err != nil {
		panic(err)
	}
	server := &pluginimpl.Server{Engine: engine}
	defer server.Close()
	sdkruntime.ServeManifestWithOptions(manifestJSON, buildVersion, sdkruntime.CapabilityServers{HttpRoutes: server}, sdkruntime.WithConfigure(func(_ context.Context, entries []*pluginv1.ConfigEntry) error {
		base := ""
		for _, entry := range entries {
			if entry.GetKey() == "connection" {
				var cfg struct {
					URL string `json:"url"`
				}
				b, err := json.Marshal(entry.GetValue().AsMap())
				if err != nil || json.Unmarshal(b, &cfg) != nil {
					return errors.New("Invalid RomM connection settings")
				}
				base = cfg.URL
			}
		}
		return engine.Configure(base)
	}))
}
