package romm

import (
	_ "embed"
	"encoding/json"
	"strings"
)

//go:embed emulation.json
var emulationCatalog []byte

type System struct {
	Name            string   `json:"name"`
	Core            string   `json:"core"`
	Slugs           []string `json:"slugs,omitempty"`
	Cores           []string `json:"cores"`
	RequiresBIOS    bool     `json:"requires_bios,omitempty"`
	BIOSHint        string   `json:"bios_hint,omitempty"`
	RequiresThreads bool     `json:"requires_threads,omitempty"`
	RequiresWebGL2  bool     `json:"requires_webgl2,omitempty"`
}
type coreDefinition struct {
	Name    string `json:"name"`
	Options struct {
		Threads bool `json:"requireThreads"`
		WebGL2  bool `json:"defaultWebGL2"`
	} `json:"options"`
}

var systems = func() map[string]System {
	var catalog struct {
		Systems []System         `json:"systems"`
		Cores   []coreDefinition `json:"cores"`
	}
	if err := json.Unmarshal(emulationCatalog, &catalog); err != nil {
		panic(err)
	}
	cores := map[string]coreDefinition{}
	for _, c := range catalog.Cores {
		cores[c.Name] = c
	}
	out := map[string]System{}
	for _, s := range catalog.Systems {
		c, ok := cores[s.Core]
		if !ok {
			panic("EmulatorJS system references an unknown core: " + s.Core)
		}
		s.RequiresThreads = c.Options.Threads
		// Only PPSSPP requires WebGL2; other cores merely prefer it.
		s.RequiresWebGL2 = s.Core == "ppsspp"
		for _, slug := range s.Slugs {
			out[strings.ToLower(slug)] = s
		}
	}
	// Custom RomM platforms can use an exact EmulatorJS core name as their slug.
	for name, c := range cores {
		if _, ok := out[name]; ok {
			continue
		}
		s := System{Name: name, Core: name, Cores: []string{name}, RequiresThreads: c.Options.Threads, RequiresWebGL2: name == "ppsspp"}
		for _, candidate := range catalog.Systems {
			for _, core := range candidate.Cores {
				if core == name {
					s.Name = candidate.Name
					s.RequiresBIOS = candidate.RequiresBIOS
					s.BIOSHint = candidate.BIOSHint
					break
				}
			}
		}
		out[name] = s
	}
	return out
}()

func LookupSystem(slug string) *System {
	s, ok := systems[strings.ToLower(slug)]
	if !ok {
		return nil
	}
	return &s
}
func Core(slug string) string {
	if s := LookupSystem(slug); s != nil {
		return s.Core
	}
	return ""
}
