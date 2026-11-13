package romm

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const EmulatorVersion = "emulatorjs-4.2.3"

type Platform struct {
	ID           int64   `json:"id"`
	Name         string  `json:"name"`
	Slug         string  `json:"slug"`
	Count        int     `json:"rom_count"`
	DisplayName  string  `json:"display_name,omitempty"`
	Abbreviation string  `json:"abbreviation,omitempty"`
	Family       string  `json:"family_name,omitempty"`
	Core         string  `json:"core,omitempty"`
	Emulation    *System `json:"emulation,omitempty"`
}
type Collection struct {
	Key   string `json:"key"`
	Kind  string `json:"kind"`
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Count int    `json:"rom_count"`
}
type Game struct {
	ID             int64        `json:"id"`
	Name           string       `json:"name"`
	Summary        string       `json:"summary"`
	PlatformID     int64        `json:"platform_id"`
	PlatformSlug   string       `json:"platform_slug"`
	Platform       string       `json:"platform_display_name"`
	Filename       string       `json:"fs_name"`
	FilenameNoExt  string       `json:"fs_name_no_ext"`
	LegacyFilename string       `json:"file_name,omitempty"`
	Cover          string       `json:"path_cover_small"`
	LargeCover     string       `json:"path_cover_large"`
	Size           int64        `json:"fs_size_bytes"`
	OnDisk         *bool        `json:"has_file_on_disk,omitempty"`
	Core           string       `json:"core"`
	Emulation      *System      `json:"emulation,omitempty"`
	DisplayTitle   string       `json:"display_title"`
	Metadata       GameMetadata `json:"metadatum"`
	Siblings       []SiblingROM `json:"sibling_roms"`
	VersionCount   int          `json:"version_count"`
	User           GameUser     `json:"rom_user"`
}
type SiblingROM struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Filename  string `json:"fs_name_no_ext"`
	Preferred bool   `json:"is_main_sibling"`
}
type GameUser struct {
	Preferred  bool   `json:"is_main_sibling"`
	LastPlayed string `json:"last_played,omitempty"`
}
type GameMetadata struct {
	Genres      []string `json:"genres"`
	Publishers  []string `json:"publishers"`
	Developers  []string `json:"developers"`
	Players     string   `json:"player_count"`
	ReleaseDate int64    `json:"first_release_date"`
	ReleaseYear int      `json:"release_year"`
}

func normalizeGame(g *Game) {
	g.Core = Core(g.PlatformSlug)
	g.Emulation = LookupSystem(g.PlatformSlug)
	if g.Filename == "" {
		g.Filename = g.LegacyFilename
	}
	if g.FilenameNoExt == "" {
		g.FilenameNoExt = strings.TrimSuffix(g.Filename, path.Ext(g.Filename))
	}
	g.DisplayTitle = displayTitle(*g)
	// RomM metadata providers have returned both Unix seconds and milliseconds.
	// Prefer seconds when plausible, then milliseconds; omit invalid dates.
	g.Metadata.ReleaseYear = 0
	stamp := g.Metadata.ReleaseDate
	if stamp != 0 {
		for _, date := range []time.Time{time.Unix(stamp, 0), time.UnixMilli(stamp)} {
			year := date.UTC().Year()
			if year >= 1850 && year <= 2100 {
				g.Metadata.ReleaseYear = year
				break
			}
		}
	}
	seen := map[int64]bool{g.ID: true}
	siblings := make([]SiblingROM, 0, len(g.Siblings))
	for _, s := range g.Siblings {
		if s.ID > 0 && !seen[s.ID] {
			seen[s.ID] = true
			siblings = append(siblings, s)
		}
	}
	g.Siblings = siblings
	g.VersionCount = len(siblings) + 1
}

type BrowseQuery struct {
	Search, Platform, Collection, Offset, Sort string
	Playable                                   bool
	Recent                                     bool
	Favorite                                   bool
}

var fileExtension = regexp.MustCompile(`(?i)\.(zip|rar|7z|nes|sfc|smc|gb|gbc|gba|n64|z64|nds|3ds|iso|bin|cue|chd|cso|pkg|nsp|xci|gcm|md|sms|gg|pce|pbp|wad|wbfs|rvz|wud|wux)$`)
var releaseID = regexp.MustCompile(`(?i)^\((?:CUSA|PPSA|SLUS|SLES|SCUS|SCES)[0-9-]+\)\s*[-_]?\s*`)
var packageSuffix = regexp.MustCompile(`(?i)\s+(?:PS[1-5]\s+)?(?:[0-9]+\.[0-9]+\s+)?PKG$`)
var regionTag = regexp.MustCompile(`(?i)\s*[\(\[](?:USA|Europe|Japan|World|En|En,Fr,De|U|E|J)[\)\]]`)
var titleSpace = regexp.MustCompile(`\s+`)

func displayTitle(g Game) string {
	title := g.Name
	if title == "" {
		title = g.Filename
	}
	if title == "" {
		return "Untitled game"
	}
	if title == g.Filename || fileExtension.MatchString(title) {
		for fileExtension.MatchString(title) {
			title = fileExtension.ReplaceAllString(title, "")
		}
		title = releaseID.ReplaceAllString(title, "")
		title = packageSuffix.ReplaceAllString(title, "")
		title = regionTag.ReplaceAllString(title, "")
		title = strings.ReplaceAll(title, "_", " ")
		title = strings.TrimSpace(titleSpace.ReplaceAllString(title, " "))
	}
	if title == "" {
		return g.Name
	}
	return title
}

type Page struct {
	Items  []Game `json:"items"`
	Total  int    `json:"total"`
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
}

func (e *Engine) Platforms(ctx context.Context, owner string) ([]Platform, error) {
	var out []Platform
	err := e.JSON(ctx, owner, "/api/platforms", &out)
	for i := range out {
		if out[i].DisplayName != "" {
			out[i].Name = out[i].DisplayName
		}
		out[i].Core = Core(out[i].Slug)
		out[i].Emulation = LookupSystem(out[i].Slug)
	}
	sort.SliceStable(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out, err
}
func (e *Engine) Collections(ctx context.Context, owner string) ([]Collection, error) {
	out := []Collection{}
	for _, kind := range []string{"standard", "smart"} {
		path := "/api/collections"
		if kind == "smart" {
			path += "/smart"
		}
		var rows []Collection
		if err := e.JSON(ctx, owner, path, &rows); err != nil {
			return nil, err
		}
		for _, row := range rows {
			row.Kind = kind
			row.Key = strconv.FormatInt(row.ID, 10)
			if kind == "smart" {
				row.Key = "smart:" + row.Key
			}
			out = append(out, row)
		}
	}
	return out, nil
}
func (e *Engine) Games(ctx context.Context, owner string, browse BrowseQuery) (Page, error) {
	search, platform, collection, offset := browse.Search, browse.Platform, browse.Collection, browse.Offset
	q := url.Values{"limit": {"48"}, "with_rom_id_index": {"false"}, "with_filter_values": {"false"}, "group_by_meta_id": {"true"}}
	if browse.Favorite {
		q.Set("favorite", "true")
	}
	if browse.Recent {
		q.Set("last_played", "true")
		q.Set("group_by_meta_id", "false") // History must retain the actual played ROM version.
		if browse.Sort == "" {
			browse.Sort = "last-played"
		}
	}
	switch browse.Sort {
	case "", "name":
		q.Set("order_by", "name")
		q.Set("order_dir", "asc")
	case "name-desc":
		q.Set("order_by", "name")
		q.Set("order_dir", "desc")
	case "newest":
		q.Set("order_by", "created_at")
		q.Set("order_dir", "desc")
	case "last-played":
		if !browse.Recent {
			return Page{}, errors.New("Choose Continue playing to browse recent games")
		}
		q.Set("order_by", "last_played")
		q.Set("order_dir", "desc")
	default:
		return Page{}, errors.New("Choose a valid game sort order")
	}
	if len(search) > 200 {
		search = search[:200]
	}
	collectionKey := "collection_id"
	if strings.HasPrefix(collection, "smart:") {
		collectionKey = "smart_collection_id"
		collection = strings.TrimPrefix(collection, "smart:")
	}
	for key, value := range map[string]string{"platform_ids": platform, collectionKey: collection} {
		if value != "" {
			if _, err := ID(value); err != nil {
				return Page{}, err
			}
			q.Set(key, value)
		}
	}
	if browse.Playable {
		platforms, err := e.Platforms(ctx, owner)
		if err != nil {
			return Page{}, err
		}
		q.Del("platform_ids")
		for _, p := range platforms {
			id := strconv.FormatInt(p.ID, 10)
			if p.Core != "" && (platform == "" || platform == id) {
				q.Add("platform_ids", id)
			}
		}
		if len(q["platform_ids"]) == 0 {
			return Page{Items: []Game{}, Limit: 48}, nil
		}
		// Core support is independent of RomM's potentially stale missing-file
		// scan flag. Check content access when playback starts.
		q.Set("physical", "false")
	}
	if search != "" {
		q.Set("search_term", search)
	}
	n, _ := strconv.Atoi(offset)
	if n < 0 || n > 100000 {
		n = 0
	}
	q.Set("offset", strconv.Itoa(n))
	var out Page
	err := e.JSON(ctx, owner, "/api/roms?"+q.Encode(), &out)
	for i := range out.Items {
		normalizeGame(&out.Items[i])
	}
	return out, err
}
func (e *Engine) Game(ctx context.Context, owner string, id int64) (Game, error) {
	var g Game
	err := e.JSON(ctx, owner, fmt.Sprintf("/api/roms/%d", id), &g)
	if err != nil {
		return g, err
	}
	if g.ID != id {
		return Game{}, ErrUpstream
	}
	normalizeGame(&g)
	return g, nil
}

type Asset struct {
	ID       int64  `json:"id"`
	ROM      int64  `json:"rom_id"`
	User     int64  `json:"user_id"`
	Emulator string `json:"emulator"`
	Slot     string `json:"slot"`
	Updated  string `json:"updated_at"`
	Filename string `json:"file_name"`
}
type Session struct {
	ID         string     `json:"id"`
	Owner      string     `json:"-"`
	Generation string     `json:"generation"`
	Server     string     `json:"-"`
	Game       Game       `json:"game"`
	Emulator   string     `json:"emulator"`
	Namespace  string     `json:"namespace"`
	SaveID     int64      `json:"saveId,omitempty"`
	StateID    int64      `json:"stateId,omitempty"`
	BIOSID     int64      `json:"biosId,omitempty"`
	BIOSName   string     `json:"biosName,omitempty"`
	Firmware   []Firmware `json:"-"`
	Expires    time.Time  `json:"-"`
}

func (e *Engine) assets(ctx context.Context, owner, kind string, rom int64) ([]Asset, error) {
	var out []Asset
	err := e.JSON(ctx, owner, fmt.Sprintf("/api/%s?rom_id=%d", kind, rom), &out)
	return out, err
}
func (e *Engine) Play(ctx context.Context, owner string, id int64) (Session, error) {
	link, _, err := e.credentials(owner)
	if err != nil {
		return Session{}, err
	}
	g, err := e.Game(ctx, owner, id)
	if err != nil {
		return Session{}, err
	}
	if g.OnDisk != nil && !*g.OnDisk {
		return Session{}, errors.New("RomM cannot find this ROM file. Check its library storage or choose another version.")
	}
	if g.Core == "" {
		return Session{}, errors.New("This platform is not supported by the bundled EmulatorJS version")
	}
	if g.Size > 2<<30 {
		return Session{}, errors.New("This ROM exceeds the browser’s 2 GiB download limit")
	}
	if g.Filename == "" || strings.ContainsAny(g.Filename, "/\\") {
		return Session{}, errors.New("RomM did not provide a valid game filename")
	}
	s := Session{ID: randomID(), Owner: owner, Generation: link.Generation, Server: link.Server, Game: g, Emulator: g.Core + "-" + EmulatorVersion, Namespace: link.Generation + "-" + strconv.FormatInt(id, 10), Expires: time.Now().Add(6 * time.Hour)}
	// A failed save lookup must stop launch: starting a fresh game could overwrite
	// a remote save during a temporary outage or with a read-only token.
	progress, err := e.compatibleProgress(ctx, owner, g, link.Identity.ID)
	if err != nil {
		return Session{}, err
	}
	s.SaveID, s.StateID = progress.saveID, progress.stateID
	var firmware []Firmware
	if err = e.JSON(ctx, owner, "/api/firmware?platform_id="+strconv.FormatInt(g.PlatformID, 10), &firmware); err != nil {
		return Session{}, err
	}
	for _, f := range firmware {
		if f.Platform == g.PlatformID && f.ID > 0 && safeFirmwareName(f.Name) {
			s.Firmware = append(s.Firmware, f)
		}
	}
	if len(s.Firmware) > 64 {
		return Session{}, errors.New("Too many firmware files for this platform; use a BIOS bundle in RomM")
	}
	if len(s.Firmware) == 0 && g.Emulation.RequiresBIOS {
		return Session{}, fmt.Errorf("Add this platform’s BIOS in RomM before playing. %s", g.Emulation.BIOSHint)
	}
	if len(s.Firmware) > 0 {
		s.BIOSID = s.Firmware[0].ID
		s.BIOSName = s.Firmware[0].Name
		if len(s.Firmware) > 1 {
			s.BIOSName = "firmware.zip"
		}
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	current, ok := e.links[owner]
	if !ok || current.Generation != link.Generation || e.base != link.Server {
		return Session{}, ErrChanged
	}
	active := 0
	for key, old := range e.sessions {
		if time.Now().After(old.Expires) {
			delete(e.sessions, key)
		} else if old.Owner == owner {
			active++
		}
	}
	if len(e.sessions) >= 128 || active >= 4 {
		return Session{}, errors.New("Close an existing game before starting another")
	}
	e.sessions[s.ID] = s
	return s, nil
}
func (e *Engine) Session(owner, id string) (Session, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	s, ok := e.sessions[id]
	l, linked := e.links[owner]
	if !ok || s.Owner != owner || !linked || s.Generation != l.Generation || e.base != s.Server || time.Now().After(s.Expires) {
		return Session{}, ErrChanged
	}
	return s, nil
}
func (e *Engine) Stop(owner, id string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if s, ok := e.sessions[id]; ok && s.Owner == owner {
		delete(e.sessions, id)
	}
}
func (e *Engine) stream(ctx context.Context, owner, target string) (*http.Response, error) {
	l, t, err := e.credentials(owner)
	if err != nil {
		return nil, err
	}
	r, err := http.NewRequestWithContext(ctx, "GET", l.Server+target, nil)
	if err != nil {
		return nil, ErrUpstream
	}
	r.Header.Set("Authorization", "Bearer "+t)
	client := *e.client
	// Streaming bodies may be large discs; request cancellation still bounds the
	// stream, while the host relay enforces its response-header deadline.
	client.Timeout = 0
	response, err := client.Do(r)
	if err != nil {
		return nil, ErrUpstream
	}
	if response.StatusCode != 200 {
		response.Body.Close()
		return nil, ErrUpstream
	}
	return response, nil
}
func (e *Engine) Content(ctx context.Context, owner, id, kind string) (*http.Response, error) {
	s, err := e.Session(owner, id)
	if err != nil {
		return nil, err
	}
	target := ""
	switch kind {
	case "rom":
		target = fmt.Sprintf("/api/roms/%d/content/%s?purpose=play", s.Game.ID, url.PathEscape(s.Game.Filename))
	case "bios":
		if len(s.Firmware) == 0 {
			return nil, ErrUpstream
		}
		if len(s.Firmware) > 1 {
			return e.firmwareBundle(ctx, owner, s.Firmware)
		}
		target = fmt.Sprintf("/api/firmware/%d/content/%s", s.Firmware[0].ID, url.PathEscape(s.Firmware[0].Name))
	case "saves", "states":
		a := s.SaveID
		if kind == "states" {
			a = s.StateID
		}
		if a <= 0 {
			return nil, errors.New("No compatible saved progress")
		}
		target = fmt.Sprintf("/api/%s/%d/content", kind, a)
	default:
		return nil, ErrUpstream
	}
	return e.stream(ctx, owner, target)
}
func (e *Engine) Artwork(ctx context.Context, owner string, id int64) (*http.Response, error) {
	g, err := e.Game(ctx, owner, id)
	if err != nil {
		return nil, err
	}
	p := g.LargeCover
	if p == "" {
		p = g.Cover
	}
	p = "/" + strings.TrimLeft(p, "/")
	u, err := url.Parse(p)
	if err != nil || u.Fragment != "" || u.RawPath != "" || strings.Contains(u.Path, "%") || strings.Contains(u.Path, "..") || !strings.HasPrefix(path.Clean(u.Path), "/assets/romm/") {
		return nil, ErrUpstream
	}
	// RomM appends a cache-busting timestamp, sometimes containing literal
	// spaces. Preserve that value in encoded form without opening other query
	// parameters or relaxing the same-server asset-path boundary.
	q, err := url.ParseQuery(u.RawQuery)
	if err != nil || (len(q) != 0 && (len(q) != 1 || len(q["ts"]) != 1)) {
		return nil, ErrUpstream
	}
	p = u.Path
	if len(q) != 0 {
		p += "?" + q.Encode()
	}
	return e.stream(ctx, owner, p)
}
func CopyContent(w http.ResponseWriter, r *http.Response, kind string) {
	defer r.Body.Close()
	typ := "application/octet-stream"
	if kind == "art" {
		typ = r.Header.Get("Content-Type")
		if !strings.HasPrefix(typ, "image/") || strings.Contains(typ, "svg") {
			w.WriteHeader(502)
			return
		}
	}
	w.Header().Set("Content-Type", typ)
	w.Header().Set("Cache-Control", "no-store")
	_, _ = io.Copy(w, r.Body)
}

// Firmware is selected by the server from the linked account's platform, never
// from browser-supplied file paths. Filenames survive delivery to EmulatorJS.
type Firmware struct {
	ID       int64  `json:"id"`
	Platform int64  `json:"platform_id"`
	Name     string `json:"file_name"`
}

func safeFirmwareName(name string) bool {
	return name != "" && name != "." && name != ".." && len(name) <= 255 && !strings.ContainsAny(name, "/\\\x00\r\n")
}
func (e *Engine) firmwareBundle(ctx context.Context, owner string, firmware []Firmware) (*http.Response, error) {
	reader, writer := io.Pipe()
	go func() {
		archive := zip.NewWriter(writer)
		seen := map[string]bool{}
		var err error
		for _, f := range firmware {
			if seen[f.Name] {
				continue
			}
			seen[f.Name] = true
			var up *http.Response
			up, err = e.stream(ctx, owner, fmt.Sprintf("/api/firmware/%d/content/%s", f.ID, url.PathEscape(f.Name)))
			if err != nil {
				break
			}
			var entry io.Writer
			entry, err = archive.Create(f.Name)
			if err == nil {
				var n int64
				n, err = io.Copy(entry, io.LimitReader(up.Body, 128<<20+1))
				if n > 128<<20 {
					err = errors.New("Firmware file is too large")
				}
			}
			up.Body.Close()
			if err != nil {
				break
			}
		}
		closeErr := archive.Close()
		if err == nil {
			err = closeErr
		}
		writer.CloseWithError(err)
	}()
	return &http.Response{StatusCode: 200, Header: http.Header{}, Body: reader}, nil
}
