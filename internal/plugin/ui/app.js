"use strict";
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const apiURL = (name, query = {}) =>
  new URL("api/" + name + "?" + new URLSearchParams(query), document.baseURI)
    .href;
async function api(name, { query, body, signal } = {}) {
  const response = await fetch(apiURL(name, query), {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch((error) => {
    if (error.name === "AbortError") throw error;
    return null;
  });
  if (!response.ok)
    throw Object.assign(
      new Error(
        ([401, 403].includes(response.status)
          ? "Your Silo Games session has expired or no longer has access. Reopen Games from Silo to continue."
          : data?.error) ||
          ([502, 503, 504].includes(response.status)
            ? "Games is temporarily unavailable. Try again or ask your Silo administrator to check the RomM server connection."
            : "The request could not be completed. Please try again."),
      ),
      { status: response.status },
    );
  if (data === null)
    throw new Error("Games received an invalid response. Please try again.");
  return data;
}
function notice(message, bad = false) {
  $("notice").hidden = !message;
  $("notice").textContent = message;
  $("notice").classList.toggle("error", bad);
}
const library = {
  page: null,
  platforms: [],
  collections: [],
  generation: 0,
  abort: null,
  connection: null,
  search: "",
  platform: "",
  collection: "",
  offset: 0,
  sort: "name",
  playable: false,
  density: "comfortable",
  iconNames: new Set(),
  ready: false,
  recent: false,
  favorite: false,
  collectionsError: null,
  collectionSearch: "",
  pinned: [],
  recentPlatforms: [],
  filtersOpen: false,
  activity: null,
};
const gameURL = (game) => apiURL("art", { id: game.id });
const needsSiloLaunch = (error) => [401, 403].includes(error?.status);
function recoveryActions(error, retryID = "") {
  return needsSiloLaunch(error)
    ? '<a class="button-link primary" href="/" data-reopen-games>Reopen Games from Silo</a>'
    : retryID
      ? '<button id="' + esc(retryID) + '">Try again</button>'
      : "";
}
function prefKey(name, namespace = library.connection?.namespace) {
  return namespace ? "silo-romm-" + name + ":" + namespace : "";
}
function savePreference(name, value, namespace) {
  const key = prefKey(name, namespace);
  if (key)
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
}
function platformPreference(name) {
  try {
    const value = JSON.parse(localStorage.getItem(prefKey(name)) || "[]");
    return Array.isArray(value)
      ? [...new Set(value.map(String))].filter((id) =>
          library.platforms.some((p) => String(p.id) === id),
        )
      : [];
  } catch {
    return [];
  }
}
function rememberPlatform(id, namespace = library.connection?.namespace) {
  if (!namespace || !(Number(id) > 0)) return;
  const key = prefKey("recent-platforms", namespace);
  let previous = [];
  try {
    previous = JSON.parse(localStorage.getItem(key) || "[]");
  } catch {}
  const recent = [
    String(id),
    ...(Array.isArray(previous) ? previous.map(String) : []).filter(
      (x) => x !== String(id),
    ),
  ].slice(0, 5);
  savePreference("recent-platforms", recent, namespace);
  if (namespace === library.connection?.namespace)
    library.recentPlatforms = recent;
}
// RomM's player-download audit does not update its last-played property. Keep
// successful Silo starts locally rather than asking for ROM metadata write scope.
function recentDeviceGames(namespace = library.connection?.namespace) {
  let records;
  try {
    records = JSON.parse(
      localStorage.getItem(prefKey("recent-games", namespace)) || "[]",
    );
  } catch {
    return [];
  }
  if (!Array.isArray(records)) return [];
  return records
    .filter(
      (g) =>
        Number.isSafeInteger(g?.id) &&
        g.id > 0 &&
        typeof g.name === "string" &&
        typeof g.platform_slug === "string" &&
        /^[a-z0-9_-]{1,64}$/.test(g.platform_slug) &&
        typeof g.core === "string" &&
        /^[a-z0-9_]{1,64}$/.test(g.core) &&
        Number.isFinite(Date.parse(g.rom_user?.last_played)),
    )
    .slice(0, 12);
}
function rememberGame(game, namespace) {
  if (!namespace) return;
  const record = {
    id: game.id,
    name: titleOf(game),
    display_title: titleOf(game),
    platform_id: game.platform_id,
    platform_slug: game.platform_slug,
    platform_display_name: game.platform_display_name,
    core: game.core,
    path_cover_small: game.path_cover_small,
    path_cover_large: game.path_cover_large,
    version_count: game.version_count,
    rom_user: { last_played: new Date().toISOString() },
  };
  savePreference(
    "recent-games",
    [
      record,
      ...recentDeviceGames(namespace).filter((g) => g.id !== game.id),
    ].slice(0, 12),
    namespace,
  );
}
function mergeRecentGames(games) {
  const byID = new Map();
  for (const g of [...recentDeviceGames(), ...games]) {
    if (!g.core || !g.rom_user?.last_played) continue;
    const previous = byID.get(g.id);
    if (
      !previous ||
      Date.parse(g.rom_user.last_played) >
        Date.parse(previous.rom_user.last_played)
    )
      byID.set(g.id, g);
  }
  return [...byID.values()].sort(
    (a, b) =>
      Date.parse(b.rom_user.last_played) - Date.parse(a.rom_user.last_played),
  );
}
function headerBrowseState() {
  let route = location.hash.slice(1);
  if (route.startsWith("game?"))
    route = new URLSearchParams(route.slice(5)).get("from") || "games";
  const q = new URLSearchParams(route.split("?")[1] || "");
  const recent = q.get("recent") === "true";
  return {
    platform: q.get("platform") || "",
    collection: q.get("collection") || "",
    search: q.get("search") || "",
    playable: q.get("playable") === "true",
    recent,
    favorite: q.get("favorite") === "true",
    sort: q.get("sort") || (recent ? "last-played" : "name"),
    offset: 0,
  };
}
function updateHeaderSearch() {
  const form = $("header-search");
  if (!form) return;
  form.hidden = !library.ready;
  if (!library.ready) return;
  const scope = headerBrowseState();
  const platform = library.platforms.find(
    (p) => String(p.id) === scope.platform,
  );
  const collection = library.collections.find(
    (c) => collectionKey(c) === scope.collection,
  );
  const collectionView = library.view === "collections";
  const label = collectionView
    ? "Collections"
    : platform?.name ||
      collection?.name ||
      (scope.favorite ? "Favorites" : "All games");
  $("search-scope").textContent = label;
  $("search-scope").title = label;
  $("search").setAttribute("aria-label", "Search " + label);
  $("search").placeholder = collectionView
    ? "Search collections…"
    : "Search games…";
  const search = collectionView ? library.collectionSearch : scope.search;
  if ($("search").value !== search) $("search").value = search;
  const update = () => {
    clearTimeout(library.searchTimer);
    if (collectionView) {
      library.collectionSearch = $("search").value;
      renderCollections();
      return;
    }
    navigateLibrary(
      browseHash({ ...scope, search: $("search").value, offset: 0 }),
    );
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    update();
  };
  $("search").oninput = () => {
    clearTimeout(library.searchTimer);
    library.searchTimer = setTimeout(update, 350);
  };
}
function shell() {
  $("app").innerHTML =
    '<header class="app-header library-header"><div class="header-brand"><button id="navigation-toggle" class="navigation-toggle" aria-label="Open library navigation" aria-controls="library-navigation" aria-expanded="false" hidden>Menu</button><a class="home-link" href="/">Silo</a><span class="header-divider"></span><strong>Games</strong></div><form id="header-search" class="header-search" role="search" hidden><label class="search-scope" id="search-scope" for="search">All games</label><input id="search" type="search" maxlength="200" placeholder="Search games…" aria-label="Search all games"><button type="submit" aria-label="Search games">' +
    icon("search") +
    '</button></form><button id="account">RomM account</button></header><main id="main" tabindex="-1"></main>';
  $("account").onclick = () =>
    accountDialog().catch((error) => {
      notice(error.message, true);
      showDialog(
        "<h2>Could not open your account</h2><p>" +
          esc(error.message) +
          "</p>" +
          recoveryActions(error),
      );
    });
  const header = document.querySelector(".library-header");
  const measure = () =>
    document.documentElement.style.setProperty(
      "--header-height",
      header.getBoundingClientRect().height + "px",
    );
  library.headerObserver?.disconnect();
  library.headerObserver = new ResizeObserver(measure);
  library.headerObserver.observe(header);
  measure();
  $("navigation-toggle").onclick = () => {
    const open = $("library-navigation")?.classList.toggle("is-open");
    $("navigation-toggle").setAttribute("aria-expanded", String(!!open));
  };
}
function connectionForm() {
  stopRomMSignIn(true);
  $("navigation-toggle").hidden = true;
  library.ready = false;
  $("header-search").hidden = true;
  $("main").innerHTML =
    '<section class="connect"><h1>Connect RomM</h1><p>Your games and saves, here in Silo.</p>' +
    (!library.connection.configured
      ? '<div class="empty"><h2>RomM needs a server address</h2><p>Ask your Silo administrator to set the RomM server address in this plugin’s settings.</p></div>'
      : '<div class="browser-sign-in"><button type="button" class="primary" id="romm-sign-in">Connect RomM</button><div id="romm-sign-in-progress" role="status" aria-live="polite"></div></div><details class="manual-connection"><summary>More sign-in options</summary><form id="connect-form"><label for="token">RomM client token</label><input id="token" name="token" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your client token"><div class="or">or use a pairing code</div><label for="pair-code">Pairing code</label><input id="pair-code" name="code" autocomplete="off" spellcheck="false" maxlength="100"><p class="help">Create a client token in RomM with access to your profile, games, platforms, collections, firmware, and read/write game assets. Only your account’s permissions apply.</p><button class="primary" type="submit">Connect account</button><p id="connect-error" role="alert"></p></form></details>') +
    "</section>";
  if ($("romm-sign-in"))
    $("romm-sign-in").addEventListener("click", beginRomMSignIn);
  if ($("connect-form"))
    $("connect-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      stopRomMSignIn(true);
      const form = event.currentTarget,
        button = form.querySelector("button");
      button.disabled = true;
      $("connect-error").textContent = "";
      const token = $("token").value,
        code = $("pair-code").value;
      $("token").value = "";
      $("pair-code").value = "";
      try {
        library.connection = await api("link", { body: { token, code } });
        await loadLibrary();
      } catch (error) {
        $("connect-error").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
}
const rommSignIn = { generation: 0, flow: null, timer: null };
function stopRomMSignIn(cancelRemote = false) {
  rommSignIn.generation++;
  if (rommSignIn.timer) clearTimeout(rommSignIn.timer);
  rommSignIn.timer = null;
  const old = rommSignIn.flow;
  rommSignIn.flow = null;
  if (cancelRemote && old)
    api("sign-in/cancel", { body: { id: old.id } }).catch(() => {});
}
function signInMessage(text) {
  const root = $("romm-sign-in-progress");
  if (root) root.textContent = text;
}
function retryRomMSignIn(message) {
  signInMessage(message);
  const button = $("romm-sign-in");
  if (button) {
    button.hidden = false;
    button.disabled = false;
    button.textContent = "Sign in again";
  }
}
async function finishRomMSignIn(connection) {
  stopRomMSignIn();
  library.connection = connection;
  await loadLibrary();
  notice(
    "Connected to RomM as " +
      (connection.identity.username || "your account") +
      ".",
  );
}
async function beginRomMSignIn() {
  stopRomMSignIn(true);
  const generation = rommSignIn.generation;
  const button = $("romm-sign-in");
  button.disabled = true;
  // Opening synchronously preserves browser user activation. A visible link
  // remains available when popup blocking or a controller prevents opening it.
  const popup = window.open("about:blank", "_blank");
  if (popup) popup.opener = null;
  signInMessage("Preparing RomM sign-in…");
  try {
    const flow = await api("sign-in/start", { body: {} });
    if (generation !== rommSignIn.generation) {
      if (popup) popup.close();
      api("sign-in/cancel", { body: { id: flow.id } }).catch(() => {});
      return;
    }
    rommSignIn.flow = flow;
    const root = $("romm-sign-in-progress");
    if (!root) return;
    button.hidden = true;
    root.innerHTML =
      '<p>Approve <strong>Silo Games</strong> in RomM.</p><p id="romm-approval-message">Waiting for approval…</p><a class="approval-link" href="' +
      esc(flow.verificationUrl) +
      '" target="_blank" rel="noopener noreferrer">Continue to RomM <span class="sr-only">(opens a new tab)</span></a><details class="approval-options"><summary>Having trouble signing in?</summary><p>Check this code in RomM:</p><code class="approval-code">' +
      esc(flow.userCode) +
      '</code><p><a href="' +
      esc(flow.loginUrl || flow.verificationUrl) +
      '" target="_blank" rel="noopener noreferrer">Use another RomM login</a></p><button type="button" id="romm-sign-in-restart">Start a new sign-in</button></details><button type="button" id="romm-sign-in-cancel">Cancel sign-in</button>';
    $("romm-sign-in-restart").onclick = beginRomMSignIn;
    $("romm-sign-in-cancel").onclick = async () => {
      const id = flow.id;
      stopRomMSignIn();
      const cancelledGeneration = rommSignIn.generation;
      try {
        const result = await api("sign-in/cancel", { body: { id } });
        if (cancelledGeneration !== rommSignIn.generation) return;
        if (result.status === "complete") {
          await finishRomMSignIn(result.connection);
          return;
        }
      } catch {}
      if (cancelledGeneration !== rommSignIn.generation) return;
      retryRomMSignIn("Sign-in cancelled.");
      button.focus();
    };
    if (popup && !popup.closed) popup.location.replace(flow.verificationUrl);
    pollRomMSignIn(generation);
  } catch (error) {
    if (popup && !popup.closed) popup.close();
    if (generation !== rommSignIn.generation) return;
    retryRomMSignIn(error.message);
  }
}
async function pollRomMSignIn(generation) {
  if (generation !== rommSignIn.generation || !rommSignIn.flow) return;
  const flow = rommSignIn.flow;
  try {
    const result = await api("sign-in/poll", { body: { id: flow.id } });
    if (generation !== rommSignIn.generation) return;
    if (result.status === "complete") {
      await finishRomMSignIn(result.connection);
      return;
    }
    if (result.status !== "pending") {
      stopRomMSignIn();
      retryRomMSignIn(result.message || "Sign-in ended.");
      return;
    }
    flow.interval = result.interval;
    const message = result.message || "Waiting for your approval…";
    const status = $("romm-approval-message");
    if (status && status.textContent !== message) status.textContent = message;
  } catch (error) {
    if (generation !== rommSignIn.generation) return;
    if (error.status === 409 || error.status === 401) {
      stopRomMSignIn();
      retryRomMSignIn("This sign-in has expired.");
      return;
    }
    if ($("romm-approval-message"))
      $("romm-approval-message").textContent =
        "Connection interrupted. Retrying…";
  }
  if (generation === rommSignIn.generation)
    rommSignIn.timer = setTimeout(
      () => pollRomMSignIn(generation),
      Math.max(1, flow.interval || 5) * 1000,
    );
}
async function accountDialog() {
  const conn = await api("connection");
  if (!conn.linked) {
    library.connection = conn;
    connectionForm();
    return;
  }
  showDialog(
    "<h2>Your RomM account</h2><p>Connected as <strong>" +
      esc(conn.identity.username || "RomM user " + conn.identity.id) +
      '</strong>.</p><p>This connection belongs to your current Silo profile. Other profiles connect separately. Sync any pending progress before disconnecting.</p><button id="disconnect" class="danger">Disconnect account</button>',
  );
  $("disconnect").addEventListener("click", async () => {
    try {
      await api("unlink", { body: {} });
      $("detail").close();
      library.connection = await api("connection");
      connectionForm();
    } catch (error) {
      notice(error.message, true);
    }
  });
}
function showDialog(markup) {
  const opener = document.activeElement;
  let old = $("detail");
  if (old) old.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "detail";
  dialog.innerHTML =
    '<button class="dialog-close" type="button" aria-label="Close details">Close</button>' +
    markup;
  const heading = dialog.querySelector("h2");
  if (heading) {
    heading.id = "dialog-heading";
    dialog.setAttribute("aria-labelledby", heading.id);
  }
  document.body.appendChild(dialog);
  dialog.querySelector(".dialog-close").onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    if (opener?.isConnected && !opener.disabled) opener.focus();
    else if (library.lastFocus?.isConnected) library.lastFocus.focus();
  });
  dialog.showModal();
}
const icons = {
  home: '<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  play: '<path d="m9 5 11 7-11 7z"/>',
  games:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h5m-2.5-2.5v5M16 9h.01M18 12h.01M7 16h10"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  back: '<path d="m14 5-7 7 7 7M7 12h14"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  folder: '<path d="M3 7V5h6l2 2h10v13H3z"/>',
  heart:
    '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  pin: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.8 7M3 4v7h7M12 7v5l3 2"/>',
};
function icon(name, cls = "") {
  return (
    '<svg class="icon ' +
    cls +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (icons[name] || icons.games) +
    "</svg>"
  );
}
const collectionKey = (c) => c.key || String(c.id);
const countText = (n) => new Intl.NumberFormat().format(n || 0);
const titleOf = (g) =>
  g.display_title || g.name || g.fs_name || "Untitled game";
function platformArt(p) {
  const aliases = {
    ps: "psx",
    famicom: "nes",
    "super-famicom": "snes",
    "game-boy": "gb",
    "game-boy-color": "gbc",
    "game-boy-advance": "gba",
    gamecube: "ngc",
  };
  const slug = library.iconNames.has(p.slug) ? p.slug : aliases[p.slug];
  return library.iconNames.has(slug)
    ? '<img class="platform-icon" src="assets/platforms/' +
        esc(slug) +
        '.svg" alt="" loading="lazy">'
    : icon("games", "platform-icon");
}
function coverMarkup(g, detail = false) {
  const p = library.platforms.find((p) => p.id === g.platform_id) || {
    name: g.platform_display_name || g.platform_slug,
    slug: g.platform_slug,
  };
  const hasArt = !!(g.path_cover_small || g.path_cover_large);
  return (
    '<span class="cover' +
    (detail ? " detail-cover" : "") +
    '">' +
    '<span class="cover-fallback" aria-hidden="true">' +
    platformArt(p) +
    "</span>" +
    (hasArt
      ? '<img class="game-art" data-art src="' +
        esc(gameURL(g)) +
        '" alt="" loading="lazy">'
      : "") +
    "</span>"
  );
}
function hydrateArtwork(scope) {
  scope.querySelectorAll("img[data-art]").forEach((img) => {
    const loaded = () => {
      img.hidden = !img.naturalWidth;
      img.previousElementSibling.hidden = !!img.naturalWidth;
    };
    img.addEventListener("load", loaded, { once: true });
    img.addEventListener("error", loaded, { once: true });
    if (img.complete) loaded();
  });
}
function browseHash(next = {}) {
  const state = { ...library, ...next };
  const q = new URLSearchParams();
  for (const k of ["platform", "collection", "search"])
    if (state[k]) q.set(k, state[k]);
  if (state.playable) q.set("playable", "true");
  if (state.recent) q.set("recent", "true");
  if (state.favorite) q.set("favorite", "true");
  if (state.sort !== (state.recent ? "last-played" : "name"))
    q.set("sort", state.sort);
  if (state.offset) q.set("offset", state.offset);
  return "games" + (q.size ? "?" + q : "");
}
function navigateLibrary(hash) {
  $("library-navigation")?.classList.remove("is-open");
  $("navigation-toggle")?.setAttribute("aria-expanded", "false");
  if (location.hash.slice(1) === hash) renderLibraryRoute();
  else location.hash = hash;
}
function readBrowseRoute() {
  const [view, query = ""] = location.hash.slice(1).split("?");
  const q = new URLSearchParams(query);
  library.view = ["game", "games", "collections", "platforms", "home"].includes(
    view,
  )
    ? view
    : "home";
  library.platform = q.get("platform") || "";
  library.collection = q.get("collection") || "";
  library.search = q.get("search") || "";
  library.playable = q.get("playable") === "true";
  library.recent = q.get("recent") === "true";
  library.favorite = q.get("favorite") === "true";
  library.sort = [
    "name",
    "name-desc",
    "newest",
    ...(library.recent ? ["last-played"] : []),
  ].includes(q.get("sort"))
    ? q.get("sort")
    : library.recent
      ? "last-played"
      : "name";
  library.offset = Math.min(100000, Math.max(0, Number(q.get("offset")) || 0));
  return q;
}
async function loadLibrary() {
  library.ready = false;
  library.pinned = [];
  library.recentPlatforms = [];
  library.activity = null;
  library.filtersOpen = false;
  library.density = "comfortable";
  library.collectionsError = null;
  library.collectionSearch = "";
  $("navigation-toggle").hidden = true;
  $("header-search").hidden = true;
  notice("");
  $("main").className = "library-shell";
  $("main").innerHTML =
    '<p class="library-loading" role="status">Opening your library…</p>';
  try {
    [library.platforms, library.collections, library.iconNames] =
      await Promise.all([
        api("platforms"),
        api("collections").catch((error) => {
          library.collectionsError = error;
          return [];
        }),
        fetch(new URL("assets/platforms/index.json", document.baseURI))
          .then((r) => r.json())
          .then((names) => new Set(names))
          .catch(() => new Set()),
      ]);
    library.platforms ||= [];
    library.collections ||= [];
    try {
      library.density =
        localStorage.getItem(
          "silo-romm-density:" + library.connection.namespace,
        ) || "comfortable";
    } catch {}
    if (!["comfortable", "compact"].includes(library.density))
      library.density = "comfortable";
    library.pinned = platformPreference("pinned-platforms");
    library.recentPlatforms = platformPreference("recent-platforms");
    $("main").innerHTML =
      '<div class="library-layout"><aside id="library-navigation" class="library-rail" aria-label="Game library"></aside><section id="library-content" class="library-content" aria-label="Library content"></section></div>';
    library.ready = true;
    $("navigation-toggle").hidden = false;
    await renderLibraryRoute();
  } catch (error) {
    notice(error.message, true);
    $("main").innerHTML =
      '<div class="empty library-failure"><h1>Could not open your library</h1><p>' +
      esc(error.message) +
      "</p>" +
      recoveryActions(error, "retry-library") +
      "</div>";
    if ($("retry-library")) $("retry-library").onclick = loadLibrary;
  }
}
function visiblePlatforms() {
  return library.platforms.filter(
    (p) => p.rom_count > 0 || String(p.id) === library.platform,
  );
}
function personalPlatformNavigation() {
  const group = (title, ids, pinned) => {
    const rows = ids
      .map((id) => library.platforms.find((p) => String(p.id) === id))
      .filter(Boolean);
    return rows.length
      ? '<h2 class="rail-heading">' +
          title +
          '</h2><nav class="personal-platforms" aria-label="' +
          title +
          '">' +
          rows
            .map(
              (p) =>
                '<div class="personal-platform-row"><button data-platform="' +
                p.id +
                '">' +
                platformArt(p) +
                "<span>" +
                esc(p.name) +
                "</span></button>" +
                (pinned
                  ? '<button class="unpin-platform" id="unpin-' +
                    p.id +
                    '" data-pin="' +
                    p.id +
                    '" aria-label="Unpin ' +
                    esc(p.name) +
                    '">' +
                    icon("close") +
                    "</button>"
                  : "") +
                "</div>",
            )
            .join("") +
          "</nav>"
      : "";
  };
  return (
    group("Pinned platforms", library.pinned, true) +
    group(
      "Recent platforms",
      library.recentPlatforms.filter((id) => !library.pinned.includes(id)),
      false,
    )
  );
}
function pinButton(p) {
  const pinned = library.pinned.includes(String(p.id));
  return (
    '<button id="pin-platform" class="pin-platform" data-pin="' +
    p.id +
    '" aria-pressed="' +
    pinned +
    '" aria-label="' +
    (pinned ? "Unpin " : "Pin ") +
    esc(p.name) +
    '">' +
    icon("pin") +
    (pinned ? "Pinned" : "Pin platform") +
    "</button>"
  );
}
function bindPinButtons(scope = document) {
  scope.querySelectorAll("[data-pin]").forEach(
    (button) =>
      (button.onclick = () => {
        const id = button.dataset.pin;
        const p = library.platforms.find((p) => String(p.id) === id);
        if (!p) return;
        const wasPinned = library.pinned.includes(id);
        library.pinned = wasPinned
          ? library.pinned.filter((x) => x !== id)
          : [...library.pinned, id];
        savePreference("pinned-platforms", library.pinned);
        renderLibraryNavigation();
        if ($("pin-platform")?.dataset.pin === id) {
          $("pin-platform").outerHTML = pinButton(p);
          bindPinButtons($("library-content"));
        }
        if (!button.isConnected)
          ($("pin-platform") || $("platform-search"))?.focus({
            preventScroll: true,
          });
        notice((wasPinned ? "Unpinned " : "Pinned ") + p.name + ".");
      }),
  );
}
function renderLibraryNavigation() {
  const nav = $("library-navigation");
  const active = (selected) => (selected ? ' aria-current="page"' : "");
  nav.innerHTML =
    '<p class="rail-heading">Your library</p><nav class="library-nav" aria-label="Browse games">' +
    '<button data-route="home"' +
    active(library.view === "home") +
    ">" +
    icon("home") +
    "Home</button>" +
    '<button data-route="platforms"' +
    active(library.view === "platforms") +
    ">" +
    icon("grid") +
    "Platforms</button>" +
    '<button data-route="collections"' +
    active(library.view === "collections") +
    ">" +
    icon("folder") +
    "Collections</button>" +
    '<button data-route="games?favorite=true"' +
    active(library.view === "games" && library.favorite) +
    ">" +
    icon("heart") +
    "Favorites</button>" +
    '<button data-route="games"' +
    active(
      library.view === "games" &&
        !library.platform &&
        !library.collection &&
        !library.playable &&
        !library.recent &&
        !library.favorite,
    ) +
    ">" +
    icon("games") +
    "All games</button>" +
    '<button data-route="games?playable=true"' +
    active(
      library.view === "games" &&
        library.playable &&
        !library.platform &&
        !library.recent &&
        !library.favorite,
    ) +
    ">" +
    icon("play") +
    "Play in Silo</button>" +
    '<button data-route="games?recent=true&playable=true"' +
    active(library.view === "games" && library.recent) +
    ">" +
    icon("history") +
    "Continue playing</button></nav>" +
    personalPlatformNavigation() +
    (library.collections.length
      ? '<h2 class="rail-heading">Collections</h2><nav class="collection-nav" aria-label="Collections">' +
        library.collections
          .map(
            (c) =>
              '<button data-route="games?collection=' +
              encodeURIComponent(collectionKey(c)) +
              '"' +
              active(library.collection === collectionKey(c)) +
              ">" +
              icon("folder") +
              "<span>" +
              esc(c.name) +
              "</span><small>" +
              countText(c.rom_count) +
              "</small></button>",
          )
          .join("") +
        "</nav>"
      : "") +
    '<div class="rail-section"><h2 class="rail-heading">Platforms <span>' +
    visiblePlatforms().length +
    '</span></h2><label class="rail-search">' +
    icon("search") +
    '<input id="platform-search" aria-label="Find a platform" type="search" placeholder="Find a platform" value="' +
    esc(library.platformSearch || "") +
    '"></label><nav id="platform-links" class="platform-links" aria-label="Platforms"></nav></div>';
  nav
    .querySelectorAll("[data-route]")
    .forEach((b) => (b.onclick = () => navigateLibrary(b.dataset.route)));
  $("platform-search").oninput = (e) => {
    library.platformSearch = e.target.value;
    renderPlatformLinks();
    if (library.view === "platforms")
      renderPlatformGroups(library.platformSearch);
  };
  renderPlatformLinks();
  nav
    .querySelectorAll(".personal-platforms [data-platform]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          navigateLibrary("games?platform=" + button.dataset.platform)),
    );
  bindPinButtons(nav);
}
function renderPlatformLinks() {
  const rows = visiblePlatforms().filter((p) =>
    p.name.toLowerCase().includes((library.platformSearch || "").toLowerCase()),
  );
  $("platform-links").innerHTML = rows.length
    ? rows
        .map(
          (p) =>
            '<button data-platform="' +
            p.id +
            '"' +
            (library.platform === String(p.id) ? ' aria-current="page"' : "") +
            ">" +
            platformArt(p) +
            "<span>" +
            esc(p.name) +
            "</span><small>" +
            countText(p.rom_count) +
            "</small></button>",
        )
        .join("")
    : '<p class="rail-empty">No platforms found</p>';
  $("platform-links")
    .querySelectorAll("[data-platform]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          navigateLibrary("games?platform=" + b.dataset.platform)),
    );
}
async function renderLibraryRoute() {
  if (!library.ready) return;
  library.shelfObserver?.disconnect();
  library.renderedHash = location.hash;
  const focusID = document.activeElement?.id;
  const selection = document.activeElement?.selectionStart;
  if (library.abort) library.abort.abort();
  ++library.generation;
  clearTimeout(library.searchTimer);
  const q = readBrowseRoute();
  if (
    library.view === "games" &&
    library.platform &&
    library.platform !== library.lastVisitedPlatform
  )
    rememberPlatform(library.platform);
  library.lastVisitedPlatform =
    library.view === "games" ? library.platform : "";
  notice("");
  renderLibraryNavigation();
  updateHeaderSearch();
  if (library.view === "game") {
    await renderGameDetail(q.get("id"), q.get("from"));
    return;
  }
  if (library.view === "home") {
    renderHome();
    return;
  }
  if (library.view === "collections") {
    renderCollections();
    return;
  }
  if (library.view === "platforms") {
    renderPlatformOverview();
    return;
  }
  renderGallery();
  if (
    [
      "search",
      "sort",
      "collection",
      "playable",
      "platform",
      "density",
      "filters-toggle",
    ].includes(focusID)
  ) {
    $(focusID)?.focus({ preventScroll: true });
    if (focusID === "search" && selection != null)
      $(focusID)?.setSelectionRange(selection, selection);
  }
  if (library.restoreControl) {
    $(library.restoreControl)?.focus({ preventScroll: true });
    library.restoreControl = null;
  }
  await loadGames();
}
function renderCollections() {
  const content = $("library-content");
  if (library.collectionsError) {
    content.innerHTML =
      '<header class="library-heading"><h1>Collections</h1></header><div class="empty"><h2>Could not load collections</h2><p>' +
      esc(library.collectionsError.message) +
      "</p>" +
      recoveryActions(library.collectionsError, "retry-collections") +
      "</div>";
    if ($("retry-collections"))
      $("retry-collections").onclick = async () => {
        $("retry-collections").disabled = true;
        try {
          library.collections = await api("collections");
          library.collectionsError = null;
          renderLibraryNavigation();
          renderCollections();
        } catch (error) {
          library.collectionsError = error;
          renderCollections();
        }
      };
    return;
  }
  const rows = library.collections.filter((c) =>
    c.name.toLowerCase().includes(library.collectionSearch.toLowerCase()),
  );
  const group = (name, items) =>
    items.length
      ? '<section class="collection-section"><h2>' +
        name +
        '</h2><div class="collection-list">' +
        items
          .map(
            (c) =>
              '<button class="collection-row" data-collection="' +
              esc(collectionKey(c)) +
              '">' +
              icon("folder") +
              "<span>" +
              esc(c.name) +
              "</span><small>" +
              countText(c.rom_count) +
              (c.rom_count === 1 ? " game" : " games") +
              "</small></button>",
          )
          .join("") +
        "</div></section>"
      : "";
  content.innerHTML =
    '<header class="library-heading"><h1>Collections</h1></header>' +
    (rows.length
      ? group(
          "Your collections",
          rows.filter((c) => c.kind !== "smart"),
        ) +
        group(
          "Smart collections",
          rows.filter((c) => c.kind === "smart"),
        )
      : '<p class="activity-empty">' +
        (library.collectionSearch
          ? "No matching collections."
          : "No collections yet.") +
        "</p>");
  content
    .querySelectorAll("[data-collection]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          navigateLibrary(
            "games?collection=" + encodeURIComponent(button.dataset.collection),
          )),
    );
}
function platformCardMarkup(p) {
  return (
    '<button class="platform-tile" data-platform="' +
    p.id +
    '" aria-label="' +
    esc(
      p.name +
        ", " +
        countText(p.rom_count) +
        " ROMs" +
        (p.core ? ", playable in Silo" : ""),
    ) +
    '">' +
    (p.core
      ? '<span class="platform-play-badge" title="Playable in Silo" aria-hidden="true">' +
        icon("play") +
        "</span>"
      : "") +
    '<span class="platform-art">' +
    platformArt(p) +
    '</span><span class="platform-tile-name">' +
    esc(p.name) +
    '</span><span class="platform-tile-count">' +
    countText(p.rom_count) +
    (p.rom_count === 1 ? " ROM" : " ROMs") +
    "</span></button>"
  );
}
function bindPlatformCards(scope) {
  scope
    .querySelectorAll("[data-platform]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          navigateLibrary("games?platform=" + button.dataset.platform)),
    );
}
function shelfMarkup(id, title, route) {
  return (
    '<section class="home-shelf continue-section" aria-labelledby="' +
    id +
    '-heading"><div class="section-heading"><h2 id="' +
    id +
    '-heading">' +
    title +
    '</h2><div class="shelf-actions"><button class="text-button" data-route="' +
    esc(route) +
    '" aria-label="View all ' +
    esc(title.toLowerCase()) +
    '">View all</button><button class="shelf-arrow" data-shelf="' +
    id +
    '" data-direction="-1" aria-label="Previous ' +
    title.toLowerCase() +
    '">' +
    icon("back") +
    '</button><button class="shelf-arrow" data-shelf="' +
    id +
    '" data-direction="1" aria-label="Next ' +
    title.toLowerCase() +
    '">' +
    icon("next") +
    '</button></div></div><div id="' +
    id +
    '" class="home-row" role="group" aria-label="' +
    title +
    '"></div></section>'
  );
}
function updateShelfArrows(id) {
  const row = $(id);
  if (!row) return;
  document.querySelectorAll('[data-shelf="' + id + '"]').forEach((button) => {
    const back = button.dataset.direction === "-1";
    button.disabled = back
      ? row.scrollLeft < 2
      : row.scrollLeft + row.clientWidth >= row.scrollWidth - 2;
  });
}
function bindShelfArrows(scope) {
  library.shelfObserver?.disconnect();
  library.shelfObserver = new ResizeObserver((entries) =>
    entries.forEach((entry) => updateShelfArrows(entry.target.id)),
  );
  scope.querySelectorAll("[data-shelf]").forEach(
    (button) =>
      (button.onclick = () => {
        const row = $(button.dataset.shelf);
        row.scrollBy({
          left: row.clientWidth * 0.8 * Number(button.dataset.direction),
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        });
      }),
  );
  scope.querySelectorAll(".home-row").forEach((row) => {
    row.addEventListener("scroll", () => updateShelfArrows(row.id), {
      passive: true,
    });
    library.shelfObserver.observe(row);
    updateShelfArrows(row.id);
  });
}
function renderHome() {
  const content = $("library-content");
  content.innerHTML =
    '<h1 class="sr-only">Games</h1>' +
    shelfMarkup(
      "continue-games",
      "Continue playing",
      "games?recent=true&playable=true",
    ) +
    shelfMarkup("favorite-games", "Favorites", "games?favorite=true") +
    shelfMarkup("new-games", "Recently added", "games?sort=newest") +
    shelfMarkup("home-platforms", "Platforms", "platforms");
  $("home-platforms").innerHTML = visiblePlatforms()
    .map(platformCardMarkup)
    .join("");
  bindPlatformCards(content);
  content
    .querySelectorAll("[data-route]")
    .forEach(
      (button) =>
        (button.onclick = () => navigateLibrary(button.dataset.route)),
    );
  bindShelfArrows(content);
  loadContinuePlaying();
  loadHomeGames("favorite-games", { favorite: true }, "No favorites yet.");
  loadHomeGames("new-games", { sort: "newest" }, "No games yet.");
}
function restoreHomeFocus(target) {
  if (
    !library.restoreGame ||
    (library.restoreShelf && library.restoreShelf !== target.id)
  )
    return;
  const card = target.querySelector(
    '[data-game="' + library.restoreGame + '"]',
  );
  if (!card) return;
  if (library.restoreShelf === target.id)
    target.scrollLeft = library.restoreShelfScroll || 0;
  card.focus({ preventScroll: true });
  window.scrollTo({ top: library.galleryScroll || 0 });
  library.restoreGame = null;
}
async function loadHomeGames(id, query, emptyText) {
  const target = $(id),
    gen = library.generation;
  target.innerHTML = '<p class="activity-empty" role="status">Loading…</p>';
  try {
    const page = await api("games", { query });
    if (gen !== library.generation || !target.isConnected) return;
    target.innerHTML = page.items?.length
      ? page.items.slice(0, 12).map(gameCardMarkup).join("")
      : '<p class="activity-empty">' + emptyText + "</p>";
    hydrateArtwork(target);
    bindGameCards(target);
    updateShelfArrows(id);
    restoreHomeFocus(target);
  } catch (error) {
    if (gen !== library.generation || !target.isConnected) return;
    target.innerHTML =
      '<p class="activity-empty">' +
      esc(error.message) +
      "</p>" +
      recoveryActions(error, "retry-" + id);
    if ($("retry-" + id))
      $("retry-" + id).onclick = () => loadHomeGames(id, query, emptyText);
  }
}
function renderPlatformOverview() {
  $("library-content").innerHTML =
    '<header class="library-heading"><h1>Platforms</h1><span class="library-total">' +
    countText(visiblePlatforms().length) +
    " platforms · " +
    countText(library.platforms.reduce((n, p) => n + p.rom_count, 0)) +
    " ROMs</span></header>" +
    '<div class="section-heading platforms-heading"><h2>Platforms</h2></div><div id="platform-groups"></div>';
  renderPlatformGroups(library.platformSearch || "");
}
async function loadContinuePlaying() {
  const target = $("continue-games");
  if (!target) return;
  const gen = library.generation;
  target.innerHTML =
    '<p class="activity-empty" role="status">Loading recent games…</p>';
  try {
    const games =
      library.activity ||
      (
        await api("games", {
          query: { recent: true, playable: true, sort: "last-played" },
        })
      ).items ||
      [];
    if (gen !== library.generation || !target.isConnected) return;
    library.activity = mergeRecentGames(games);
    target.innerHTML = library.activity.length
      ? target.classList.contains("home-row")
        ? library.activity.slice(0, 12).map(gameCardMarkup).join("")
        : '<div class="activity-grid">' +
          library.activity.slice(0, 6).map(gameCardMarkup).join("") +
          "</div>"
      : '<p class="activity-empty">No recent games.</p>';
    hydrateArtwork(target);
    bindGameCards(target);
    updateShelfArrows(target.id);
    restoreHomeFocus(target);
  } catch (error) {
    if (gen !== library.generation || !target.isConnected) return;
    const local = needsSiloLaunch(error) ? [] : recentDeviceGames();
    target.innerHTML =
      (local.length
        ? '<div class="activity-grid">' +
          local.slice(0, 6).map(gameCardMarkup).join("") +
          "</div>"
        : "") +
      '<p class="activity-empty">' +
      esc(error.message) +
      "</p>" +
      recoveryActions(error, "retry-activity");
    hydrateArtwork(target);
    bindGameCards(target);
    if ($("retry-activity")) $("retry-activity").onclick = loadContinuePlaying;
  }
}
function gameCardMarkup(g) {
  const playable = g.core && g.has_file_on_disk !== false;
  return (
    '<button type="button" class="game-card" data-game="' +
    g.id +
    '" aria-label="' +
    esc(
      titleOf(g) +
        ", " +
        (g.platform_display_name || g.platform_slug) +
        (playable ? ", supported in Silo" : ""),
    ) +
    '">' +
    coverMarkup(g) +
    (playable
      ? '<span class="platform-play-badge" title="Playable in Silo" aria-hidden="true">' +
        icon("play") +
        "</span>"
      : "") +
    '<span class="game-card-title">' +
    esc(titleOf(g)) +
    '</span><span class="game-card-meta"><span>' +
    esc(g.platform_display_name || g.platform_slug) +
    "</span>" +
    (g.version_count > 1
      ? '<span class="version-count">' + g.version_count + " versions</span>"
      : "") +
    "</span></button>"
  );
}
function bindGameCards(scope) {
  scope
    .querySelectorAll("[data-game]")
    .forEach(
      (button) =>
        (button.onclick = () => openGame(Number(button.dataset.game), button)),
    );
}
function renderPlatformGroups(search) {
  const rows = visiblePlatforms().filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );
  const supported = rows.filter((p) => p.core),
    other = rows.filter((p) => !p.core);
  const group = (title, platforms, supportedGroup) =>
    platforms.length
      ? '<section class="platform-section"><div class="section-heading"><h2>' +
        title +
        "</h2>" +
        (supportedGroup
          ? '<button class="text-button" data-route="games?playable=true">View games ' +
            icon("play") +
            "</button>"
          : "<span>" + countText(platforms.length) + " systems</span>") +
        '</div><div class="platform-grid">' +
        platforms.map(platformCardMarkup).join("") +
        "</div></section>"
      : "";
  $("platform-groups").innerHTML = rows.length
    ? group("Play in Silo", supported, true) +
      group(
        supported.length ? "Explore your library" : "Platforms",
        other,
        false,
      )
    : '<div class="empty"><h2>No platforms found</h2><p>Try another platform name.</p></div>';
  $("platform-groups")
    .querySelectorAll("[data-platform]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          navigateLibrary("games?platform=" + b.dataset.platform)),
    );
  $("platform-groups")
    .querySelectorAll("[data-route]")
    .forEach((b) => (b.onclick = () => navigateLibrary(b.dataset.route)));
}
function deviceHistoryMarkup() {
  if (
    !library.recent ||
    library.offset ||
    library.collection ||
    library.sort === "newest"
  )
    return "";
  const games = recentDeviceGames().filter(
    (g) =>
      (!library.platform || String(g.platform_id) === library.platform) &&
      (!library.search ||
        titleOf(g).toLowerCase().includes(library.search.toLowerCase())),
  );
  if (library.sort === "name" || library.sort === "name-desc")
    games.sort(
      (a, b) =>
        titleOf(a).localeCompare(titleOf(b)) *
        (library.sort === "name-desc" ? -1 : 1),
    );
  return games.length
    ? '<section class="continue-section" aria-labelledby="device-history-heading"><div class="section-heading"><h2 id="device-history-heading">Played in Silo on this device</h2></div><div class="activity-grid">' +
        games.map(gameCardMarkup).join("") +
        '</div></section><div class="section-heading"><h2>RomM history</h2></div>'
    : "";
}
function renderGallery() {
  const platform = library.platforms.find(
    (p) => String(p.id) === library.platform,
  );
  const collection = library.collections.find(
    (c) => collectionKey(c) === library.collection,
  );
  const title =
    platform?.name ||
    collection?.name ||
    (library.favorite
      ? "Favorites"
      : library.recent
        ? "Continue playing"
        : library.playable
          ? "Play in Silo"
          : "All games");
  const chips = [
    ["platform", platform?.name],
    ["collection", collection?.name],
    ["search", library.search && "Search: " + library.search],
    ["playable", library.playable && "Playable in Silo"],
    ["favorite", library.favorite && "Favorites"],
    ["recent", library.recent && "Recently played"],
  ].filter(([, label]) => label);
  $("library-content").innerHTML =
    '<header class="library-heading gallery-heading"><div><button class="breadcrumb text-button" data-home>' +
    icon("back") +
    "Platforms</button><h1>" +
    esc(title) +
    "</h1></div>" +
    (platform
      ? '<div class="platform-heading-actions"><span class="heading-platform-art">' +
        platformArt(platform) +
        "</span>" +
        pinButton(platform) +
        "</div>"
      : "") +
    "</header>" +
    '<div class="gallery-toolbar"><p id="result-count" role="status"></p><button id="filters-toggle" aria-controls="filter-fields" aria-expanded="' +
    library.filtersOpen +
    '">' +
    icon("filter") +
    "Filters</button>" +
    '<div id="filter-fields" class="filter-fields' +
    (library.filtersOpen ? " is-open" : "") +
    '"><label class="mobile-platform">Platform<select id="platform"><option value="">All platforms</option>' +
    visiblePlatforms()
      .map((p) => '<option value="' + p.id + '">' + esc(p.name) + "</option>")
      .join("") +
    "</select></label>" +
    (library.collections.length
      ? '<label>Collection<select id="collection"><option value="">All collections</option>' +
        library.collections
          .map(
            (c) =>
              '<option value="' +
              esc(collectionKey(c)) +
              '">' +
              esc(c.name) +
              "</option>",
          )
          .join("") +
        "</select></label>"
      : "") +
    '<label class="playable-toggle"><input id="playable" type="checkbox"' +
    (library.playable ? " checked" : "") +
    '>Playable in Silo</label><label class="density-control">Covers<select id="density" aria-label="Cover size"><option value="comfortable">Large</option><option value="compact">Small</option></select></label></div>' +
    '<label class="sort-control"><span class="sr-only">Sort</span><select id="sort" aria-label="Sort">' +
    (library.recent ? '<option value="last-played">Last played</option>' : "") +
    '<option value="name">Name A–Z</option><option value="name-desc">Name Z–A</option><option value="newest">Recently added</option></select></label></div>' +
    '<div class="active-filters" aria-label="Active filters">' +
    chips
      .map(
        ([key, label]) =>
          '<button class="filter-chip" data-clear="' +
          key +
          '" aria-label="Remove ' +
          esc(label) +
          '">' +
          esc(label) +
          icon("close") +
          "</button>",
      )
      .join("") +
    "</div>" +
    deviceHistoryMarkup() +
    '<div id="grid" class="game-grid" data-density="' +
    library.density +
    '" aria-label="Games"></div><nav id="pagination" aria-label="Game pages"></nav>';
  $("library-content").querySelector("[data-home]").onclick = () =>
    navigateLibrary("platforms");
  bindPinButtons($("library-content"));
  bindGameCards($("library-content"));
  hydrateArtwork($("library-content"));
  $("platform").value = library.platform;
  $("sort").value = library.sort;
  if ($("collection")) $("collection").value = library.collection;
  $("density").value = library.density;
  $("filters-toggle").onclick = () => {
    library.filtersOpen = !library.filtersOpen;
    $("filter-fields").classList.toggle("is-open", library.filtersOpen);
    $("filters-toggle").setAttribute(
      "aria-expanded",
      String(library.filtersOpen),
    );
  };
  const update = () =>
    navigateLibrary(
      browseHash({
        platform: $("platform").value,
        collection: $("collection")?.value || "",
        sort: $("sort").value,
        playable: $("playable").checked,
        offset: 0,
      }),
    );
  for (const id of ["platform", "sort", "collection", "playable"])
    if ($(id)) $(id).onchange = update;
  document.querySelectorAll("[data-clear]").forEach(
    (button) =>
      (button.onclick = () => {
        const key = button.dataset.clear;
        library.restoreControl = "search";
        navigateLibrary(
          browseHash({
            [key]: ["recent", "playable", "favorite"].includes(key)
              ? false
              : "",
            ...(key === "recent" && library.sort === "last-played"
              ? { sort: "name" }
              : {}),
            offset: 0,
          }),
        );
      }),
  );
  $("density").onchange = () => {
    library.density = $("density").value;
    $("grid").dataset.density = library.density;
    try {
      localStorage.setItem(
        "silo-romm-density:" + library.connection.namespace,
        library.density,
      );
    } catch {}
  };
}
async function loadGames() {
  if (library.abort) library.abort.abort();
  library.abort = new AbortController();
  const gen = ++library.generation;
  const grid = $("grid");
  if (!grid) return;
  grid.setAttribute("aria-busy", "true");
  grid.innerHTML = Array.from(
    { length: 12 },
    () =>
      '<div class="game-skeleton" aria-hidden="true"><span class="cover"></span><span></span></div>',
  ).join("");
  $("result-count").textContent = "Loading games…";
  $("pagination").innerHTML = "";
  try {
    const page = await api("games", {
      query: {
        search: library.search,
        platform: library.platform,
        collection: library.collection,
        offset: library.offset,
        sort: library.sort,
        playable: library.playable,
        recent: library.recent,
        favorite: library.favorite,
      },
      signal: library.abort.signal,
    });
    if (gen !== library.generation || !grid.isConnected) return;
    notice("");
    library.page = page;
    const games = page.items || [];
    $("result-count").textContent =
      countText(page.total ?? games.length) +
      ((page.total ?? games.length) === 1 ? " game" : " games") +
      (library.recent ? " in RomM history" : "");
    grid.innerHTML = games.length
      ? games.map(gameCardMarkup).join("")
      : '<div class="empty"><h2>' +
        (library.favorite
          ? "No favorites yet"
          : library.recent
            ? "No games in RomM history"
            : library.playable
              ? "No playable games here"
              : "No games found") +
        "</h2><p>" +
        (library.favorite
          ? "Favorite games in RomM to see them here."
          : library.recent
            ? "Games played in RomM appear here. Games started in Silo are kept in this device’s history above."
            : library.playable
              ? "No supported games match these filters. Try another platform or turn off the playable filter."
              : "Try another search, platform, or collection.") +
        '</p><button id="clear-filters">Clear filters</button></div>';
    hydrateArtwork(grid);
    bindGameCards(grid);
    if ($("clear-filters"))
      $("clear-filters").onclick = () => navigateLibrary("games");
    const total = page.total ?? games.length;
    $("pagination").innerHTML =
      (library.offset ? '<button data-page="prev">Previous</button>' : "") +
      (total > 0
        ? "<span>" +
          countText(library.offset + 1) +
          "–" +
          countText(library.offset + games.length) +
          " of " +
          countText(total) +
          "</span>"
        : "") +
      (library.offset + games.length < total
        ? '<button data-page="next">Next</button>'
        : "");
    $("pagination")
      .querySelectorAll("button")
      .forEach(
        (b) =>
          (b.onclick = () => {
            navigateLibrary(
              browseHash({
                offset: Math.max(
                  0,
                  library.offset + (b.dataset.page === "next" ? 48 : -48),
                ),
              }),
            );
            window.scrollTo({ top: 0 });
          }),
      );
    if (library.restoreGame) {
      (library.restoreActivity
        ? $("library-content").querySelector(".activity-grid") || grid
        : grid
      )
        .querySelector('[data-game="' + library.restoreGame + '"]')
        ?.focus({ preventScroll: true });
      window.scrollTo({ top: library.galleryScroll || 0 });
      library.restoreGame = null;
    }
  } catch (error) {
    if (
      error.name !== "AbortError" &&
      gen === library.generation &&
      grid.isConnected
    ) {
      $("result-count").textContent = "Games unavailable";
      notice(error.message, true);
      grid.innerHTML =
        '<div class="empty"><h2>Could not load your collection</h2><p>' +
        esc(error.message) +
        "</p>" +
        recoveryActions(error, "retry") +
        "</div>";
      if ($("retry")) $("retry").onclick = loadGames;
    }
  } finally {
    if (gen === library.generation && grid.isConnected)
      grid.removeAttribute("aria-busy");
  }
}
async function openGame(id, button) {
  library.lastFocus = button;
  library.galleryScroll = window.scrollY;
  library.restoreGame = id;
  library.restoreActivity = !!button.closest(".activity-grid,.home-row");
  library.restoreShelf = button.closest(".home-row")?.id || "";
  library.restoreShelfScroll = button.closest(".home-row")?.scrollLeft || 0;
  navigateLibrary(
    "game?id=" +
      id +
      "&from=" +
      encodeURIComponent(location.hash.slice(1) || "home"),
  );
}
function backToLibrary(from) {
  navigateLibrary(
    from && /^(games(?:\?|$)|platforms$|collections$|home$)/.test(from)
      ? from
      : "games",
  );
}
async function renderGameDetail(id, from) {
  const gen = library.generation;
  const content = $("library-content");
  content.innerHTML =
    '<p class="library-loading" role="status">Opening game…</p>';
  try {
    const g = await api("game", { query: { id } });
    if (gen !== library.generation) return;
    const m = g.metadatum || {},
      release = m.release_year || null;
    const versions = [
      {
        id: g.id,
        fs_name_no_ext: g.fs_name_no_ext || g.fs_name || titleOf(g),
        is_main_sibling: g.rom_user?.is_main_sibling,
      },
      ...(g.sibling_roms || []),
    ];
    const versionPicker =
      versions.length > 1
        ? '<label class="rom-version">ROM version <span>' +
          versions.length +
          ' available</span><select id="rom-version" aria-label="ROM version">' +
          versions
            .map(
              (v) =>
                '<option value="' +
                v.id +
                '"' +
                (v.id === g.id ? " selected" : "") +
                ">" +
                esc(v.fs_name_no_ext || v.name || "ROM " + v.id) +
                (v.is_main_sibling ? " · Preferred in RomM" : "") +
                "</option>",
            )
            .join("") +
          "</select></label>"
        : "";
    const facts = [
      ["Platform", g.platform_display_name || g.platform_slug],
      ["Released", release],
      ["Players", m.player_count],
      ["Developer", m.developers?.join(", ")],
      ["Publisher", m.publishers?.join(", ")],
    ].filter(([, v]) => v);
    content.innerHTML =
      '<button class="back-library text-button" id="back-library">' +
      icon("back") +
      'Back to library</button><article class="game-detail-page"><aside class="detail-artwork">' +
      coverMarkup(g, true) +
      '</aside><header class="detail-identity"><h1 tabindex="-1" id="game-heading">' +
      esc(titleOf(g)) +
      '</h1><p class="game-platform">' +
      '<button class="text-button detail-platform-link" id="detail-platform" aria-label="Browse ' +
      esc(g.platform_display_name || g.platform_slug) +
      '">' +
      platformArt({ slug: g.platform_slug }) +
      esc(g.platform_display_name || g.platform_slug) +
      "</button></p>" +
      (m.genres?.length
        ? '<p class="game-genres">' + m.genres.map(esc).join(" · ") + "</p>"
        : "") +
      '</header><section class="detail-play" aria-label="Play this game">' +
      versionPicker +
      '<div class="detail-actions">' +
      (g.has_file_on_disk === false
        ? '<p class="unsupported-message"><strong>ROM file unavailable</strong><br>RomM marks this file as unavailable. Check its library storage, run a quick scan in RomM, then choose Check again.' +
          (versions.length > 1
            ? " You can also try another ROM version."
            : "") +
          '</p><button id="retry-game">Check again</button>'
        : g.core
          ? '<button id="launch" class="primary">' +
            icon("play") +
            (g.progress_known && g.resume_available ? "Resume" : "Play") +
            "</button><p>" +
            (g.progress_known
              ? g.resume_available
                ? "Resume compatible saved progress from your connected RomM account."
                : "Play here with your connected RomM account."
              : "Saved progress will be checked again before launch.") +
            "</p>"
          : '<p class="unsupported-message">This platform is available to browse. It is not supported by the bundled EmulatorJS version.</p>') +
      '<p id="launch-status" role="status"></p></div></section><div class="detail-description"><section class="game-about"><h2>About this game</h2><p class="game-summary">' +
      esc(g.summary || "RomM has no description for this game yet.") +
      "</p></section>" +
      '<dl class="game-facts">' +
      facts
        .map(
          ([k, v]) =>
            "<div><dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd></div>",
        )
        .join("") +
      '</dl><details class="file-information"><summary>File information</summary><dl><dt>Original filename</dt><dd>' +
      esc(g.fs_name || "Not provided") +
      "</dd>" +
      (g.fs_size_bytes
        ? "<dt>Size</dt><dd>" +
          countText(
            Math.round(
              (g.fs_size_bytes / (g.fs_size_bytes < 1048576 ? 1024 : 1048576)) *
                10,
            ) / 10,
          ) +
          (g.fs_size_bytes < 1048576 ? " KB</dd>" : " MB</dd>")
        : "") +
      "</dl></details></div></article>";
    $("back-library").onclick = () => backToLibrary(from);
    if ($("detail-platform"))
      $("detail-platform").onclick = () =>
        navigateLibrary("games?platform=" + g.platform_id);
    if ($("retry-game")) $("retry-game").onclick = renderLibraryRoute;
    hydrateArtwork(content);
    if (library.focusVersion && $("rom-version")) {
      $("rom-version").focus({ preventScroll: true });
      window.scrollTo({ top: library.detailScroll || 0 });
      library.focusVersion = false;
    } else {
      $("game-heading").focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    }
    if ($("rom-version"))
      $("rom-version").onchange = (e) => {
        library.focusVersion = true;
        library.detailScroll = window.scrollY;
        const route =
          "game?id=" +
          e.target.value +
          "&from=" +
          encodeURIComponent(from || "games");
        const url = new URL(location.href);
        url.hash = route;
        history.replaceState(null, "", url.href);
        renderLibraryRoute();
      };
    if ($("launch"))
      $("launch").onclick = async () => {
        const launch = $("launch");
        launch.disabled = true;
        $("launch-status").textContent = "Checking saved progress…";
        try {
          const session = await api("play", { body: { id: g.id } });
          const url = new URL("play", document.baseURI);
          url.searchParams.set("session", session.id);
          url.searchParams.set("game", g.id);
          url.searchParams.set("from", from || "games");
          const theme = new URLSearchParams(location.search).get("theme");
          if (theme) url.searchParams.set("theme", theme);
          location.assign(url);
        } catch (error) {
          $("launch-status").innerHTML =
            esc(error.message) +
            (needsSiloLaunch(error) ? "<br>" + recoveryActions(error) : "");
          launch.disabled = false;
        }
      };
  } catch (error) {
    if (gen !== library.generation) return;
    library.focusVersion = false;
    notice(error.message, true);
    content.innerHTML =
      '<div class="empty"><h1>Could not open this game</h1><p>' +
      esc(error.message) +
      "</p>" +
      recoveryActions(error, "retry-game") +
      '<button id="back-library">Back to library</button></div>';
    if ($("retry-game")) $("retry-game").onclick = renderLibraryRoute;
    $("back-library").onclick = () => backToLibrary(from);
  }
}
function onLibraryHistoryChange() {
  if (library.ready && library.renderedHash !== location.hash)
    renderLibraryRoute();
}
window.addEventListener("hashchange", onLibraryHistoryChange);
window.addEventListener("popstate", onLibraryHistoryChange);

// Geometric navigation works for both responsive grids and dialogs. Native
// select/input keyboard behavior is preserved, and Tab remains available.
function moveFocus(direction) {
  const scope = $("detail")?.open ? $("detail") : document;
  const nodes = [
    ...scope.querySelectorAll("button:not([disabled]),a[href],input,select"),
  ].filter((n) => n.offsetWidth && n.offsetHeight);
  const current = document.activeElement;
  if (!nodes.includes(current)) {
    nodes[0]?.focus();
    return;
  }
  const a = current.getBoundingClientRect(),
    x = a.left + a.width / 2,
    y = a.top + a.height / 2;
  const candidates = nodes
    .filter((n) => n !== current)
    .map((n) => {
      const b = n.getBoundingClientRect(),
        dx = b.left + b.width / 2 - x,
        dy = b.top + b.height / 2 - y;
      const primary =
        direction === "left"
          ? -dx
          : direction === "right"
            ? dx
            : direction === "up"
              ? -dy
              : dy;
      const cross =
        direction === "left" || direction === "right"
          ? Math.abs(dy)
          : Math.abs(dx);
      return { n, primary, cross };
    })
    .filter((n) => n.primary > 4)
    .sort((a, b) => a.primary + a.cross * 3 - (b.primary + b.cross * 3));
  candidates[0]?.n.focus();
}
document.addEventListener("keydown", (event) => {
  if (player.session) return;
  if (
    event.key === "Escape" &&
    $("library-navigation")?.classList.contains("is-open")
  ) {
    $("library-navigation").classList.remove("is-open");
    $("navigation-toggle").setAttribute("aria-expanded", "false");
    $("navigation-toggle").focus();
    return;
  }
  if (
    event.key === "Escape" &&
    library.filtersOpen &&
    $("filters-toggle")?.offsetWidth
  ) {
    library.filtersOpen = false;
    $("filter-fields").classList.remove("is-open");
    $("filters-toggle").setAttribute("aria-expanded", "false");
    $("filters-toggle").focus();
    return;
  }
  if (event.key === "Escape" && library.view === "game" && !$("detail")?.open) {
    $("back-library")?.click();
    return;
  }
  if (event.target.matches("input,select,textarea")) return;
  const direction = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
  }[event.key];
  if (direction) {
    event.preventDefault();
    moveFocus(direction);
  }
});
let previousPadButtons = [],
  previousPadDirection = "",
  nextPadMove = 0;
function controllerSelect(select) {
  const label =
    select.closest("label")?.firstChild?.textContent?.trim() || "Option";
  showDialog(
    "<h2>Select " +
      esc(label.toLowerCase()) +
      '</h2><div class="controller-options">' +
      [...select.options]
        .map(
          (option, index) =>
            '<button type="button" data-select-index="' +
            index +
            '" aria-pressed="' +
            (index === select.selectedIndex) +
            '">' +
            esc(option.textContent) +
            "</button>",
        )
        .join("") +
      "</div>",
  );
  const dialog = $("detail");
  dialog.querySelectorAll("[data-select-index]").forEach(
    (button) =>
      (button.onclick = () => {
        select.selectedIndex = Number(button.dataset.selectIndex);
        select.dispatchEvent(new Event("change", { bubbles: true }));
        dialog.close();
        select.focus();
      }),
  );
  dialog
    .querySelector('[data-select-index="' + select.selectedIndex + '"]')
    ?.focus();
}
function gamepadFrame(now) {
  const pad = [...(navigator.getGamepads?.() || [])].find(Boolean);
  if (pad) {
    const buttons = pad.buttons.map((button) => button.pressed);
    const pressed = (index) => buttons[index] && !previousPadButtons[index];
    const playing = player.session && !$("detail")?.open;
    let activated = false;
    if (playing) {
      if (pressed(9)) {
        openPause();
        activated = true;
      }
    } else if (pressed(0)) {
      const active = document.activeElement;
      if (active?.tagName === "SELECT") controllerSelect(active);
      else active?.click();
      activated = true;
    } else if (pressed(1)) {
      if ($("detail")?.open) $("detail").close();
      else if (library.view === "game") $("back-library")?.click();
      activated = true;
    }
    const direction =
      buttons[12] || pad.axes[1] < -0.6
        ? "up"
        : buttons[13] || pad.axes[1] > 0.6
          ? "down"
          : buttons[14] || pad.axes[0] < -0.6
            ? "left"
            : buttons[15] || pad.axes[0] > 0.6
              ? "right"
              : "";
    if (
      !playing &&
      !activated &&
      direction &&
      (direction !== previousPadDirection || now >= nextPadMove)
    ) {
      moveFocus(direction);
      nextPadMove = now + 220;
    }
    previousPadDirection = direction;
    previousPadButtons = buttons;
  } else {
    previousPadButtons = [];
    previousPadDirection = "";
  }
  requestAnimationFrame(gamepadFrame);
}
const player = {
  session: null,
  started: false,
  saving: false,
  chain: Promise.resolve(),
  timer: null,
  urls: [],
  dirty: false,
};
function outboxDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("silo-romm-outbox", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("progress", { keyPath: "key" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () =>
      reject(
        new Error(
          "Browser storage is unavailable; progress cannot be protected locally.",
        ),
      );
  });
}
async function outbox(op, value) {
  const db = await outboxDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        "progress",
        op === "get" ? "readonly" : "readwrite",
      );
      const store = tx.objectStore("progress");
      let result;
      const request =
        op === "get"
          ? store.get(value)
          : op === "put"
            ? store.put(value)
            : store.delete(value);
      request.onsuccess = () => {
        result = request.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
function progressKey(kind) {
  return player.session.namespace + ":" + kind;
}
async function keepProgress(kind, data) {
  if (!data || !data.byteLength) return;
  const bytes = new Uint8Array(data);
  if (bytes.byteLength > 128 * 1024 * 1024)
    throw new Error("Progress exceeds the 128 MiB save limit.");
  await outbox("put", {
    key: progressKey(kind),
    data: bytes,
    revision: crypto.randomUUID(),
    at: Date.now(),
  });
  player.dirty = true;
}
function base64(bytes) {
  let result = "";
  for (let i = 0; i < bytes.length; i += 8192)
    result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
async function syncProgress() {
  for (const kind of ["saves", "states"]) {
    const pending = await outbox("get", progressKey(kind));
    if (!pending) continue;
    const start = await api("upload", {
      body: { session: player.session.id, kind },
    });
    const bytes = new Uint8Array(pending.data);
    for (let offset = 0; offset < bytes.length; offset += 384 * 1024) {
      const end = Math.min(offset + 384 * 1024, bytes.length);
      const result = await api("upload", {
        body: {
          id: start.id,
          offset,
          data: base64(bytes.subarray(offset, end)),
          final: end === bytes.length,
        },
      });
      if (result.offset !== end)
        throw new Error("The server did not acknowledge this save chunk.");
    }
    const current = await outbox("get", progressKey(kind));
    if (current?.revision === pending.revision)
      await outbox("delete", progressKey(kind));
  }
  player.dirty = false;
}
async function captureProgress() {
  const emulator = window.EJS_emulator;
  if (!player.started || !emulator?.gameManager) return;
  const manager = emulator.gameManager;
  const save = manager.getSaveFile();
  if (save?.byteLength) await keepProgress("saves", save);
  if (manager.supportsStates())
    await keepProgress("states", manager.getState());
}
function queueSave(capture = true) {
  const task = player.chain
    .catch(() => {})
    .then(async () => {
      if (capture) await captureProgress();
      $("sync-status").textContent = "Syncing progress…";
      await syncProgress();
      $("sync-status").textContent = "Saved to RomM";
      notice("");
    });
  player.chain = task;
  task.catch((error) => {
    $("sync-status").textContent =
      "Progress saved on this device · Sync pending";
    notice(
      error.message + " Your local copy will retry when you reopen this game.",
      true,
    );
  });
  return task;
}
async function fetchBinary(kind) {
  const r = await fetch(
    apiURL("content", { session: player.session.id, kind }),
    { credentials: "same-origin" },
  );
  if (!r.ok)
    throw Object.assign(
      new Error(
        [401, 403].includes(r.status)
          ? "Your Silo Games session has expired. Reopen Games from Silo to continue."
          : r.status === 404 && kind === "rom"
            ? "The selected ROM file is unavailable. Check RomM’s library storage and run a quick scan before trying again."
            : "Could not load " +
              (kind === "rom"
                ? "the selected ROM"
                : "compatible saved progress") +
              ". Check the RomM connection and try again.",
      ),
      { status: r.status },
    );
  return new Uint8Array(await r.arrayBuffer());
}
async function startPlayer() {
  const sessionID = new URLSearchParams(location.search).get("session");
  if (!sessionID) throw new Error("Open a game from Games first.");
  player.session = await api("session", { query: { id: sessionID } });
  const s = player.session;
  $("app").classList.add("is-player");
  $("app").innerHTML =
    '<header class="app-header player-header"><button id="pause">Pause / Menu</button><strong>' +
    esc(s.game.name || s.game.fs_name) +
    '</strong><span class="header-spacer"></span><span id="sync-status" role="status">Preparing game…</span><button id="save">Save progress</button><button id="exit">Save &amp; exit</button></header><main id="game-stage"><div id="game"></div><p id="player-loading" role="status">Loading game and compatible saved progress…</p></main>';
  $("pause").onclick = openPause;
  $("save").onclick = () => queueSave();
  $("exit").onclick = saveExit;
  const threads = !!s.game.emulation?.requires_threads;
  if (
    threads &&
    (!crossOriginIsolated || typeof SharedArrayBuffer !== "function")
  )
    throw new Error(
      "This emulator needs an isolated player window. Reopen Games after updating Silo, then try again.",
    );
  if (
    s.game.emulation?.requires_webgl2 &&
    !document.createElement("canvas").getContext("webgl2")
  )
    throw new Error(
      "This emulator needs WebGL 2. Try a browser or device with WebGL 2 enabled.",
    );
  await outboxDB().then((db) => db.close());
  const [rom, remoteSave, pendingSave, pendingState] = await Promise.all([
    fetchBinary("rom"),
    s.saveId ? fetchBinary("saves") : null,
    outbox("get", progressKey("saves")),
    outbox("get", progressKey("states")),
  ]);
  const blob = (data) => {
    const u = URL.createObjectURL(new Blob([data]));
    player.urls.push(u);
    return u;
  };
  const saveData = pendingSave?.data || remoteSave;
  window.EJS_player = "#game";
  window.EJS_core = s.game.core;
  window.EJS_gameUrl = new File([rom], s.game.fs_name);
  window.EJS_gameName = s.namespace;
  window.EJS_gameID = 1;
  window.EJS_pathtodata = new URL(
    "assets/emulator/data/",
    document.baseURI,
  ).href;
  window.EJS_startOnLoaded = true;
  window.EJS_threads = threads;
  window.EJS_disableAutoLang = true;
  window.EJS_language = "en-US";
  window.EJS_disableDatabases = true;
  window.EJS_defaultOptions = {
    ejs_threads: threads ? "enabled" : "disabled",
    "save-state-location": "download",
  };
  window.EJS_Buttons = {
    exit: { visible: false },
    saveSavFiles: { visible: false },
    loadSavFiles: { visible: false },
    saveState: { visible: false },
    loadState: { visible: false },
    netplay: { visible: false },
  };
  if (s.biosId)
    window.EJS_biosUrl = new File([await fetchBinary("bios")], s.biosName);
  if (pendingState?.data) window.EJS_loadStateURL = blob(pendingState.data);
  else if (s.stateId)
    window.EJS_loadStateURL = blob(await fetchBinary("states"));
  window.EJS_ready = () => {
    // Emscripten's default IDBFS mount uses a shared database name. Namespace
    // that database before it opens, so even concurrent profiles are isolated.
    const mount = window.EJS_GameManager.prototype.mountFileSystems;
    window.EJS_GameManager.prototype.mountFileSystems = function () {
      const filesystem = this.FS.filesystems.IDBFS;
      const getDB = filesystem.getDB;
      filesystem.getDB = function (name, callback) {
        return getDB.call(
          this,
          "silo-romm-" + s.namespace + "-" + name,
          callback,
        );
      };
      return mount.call(this);
    };
  };
  window.EJS_onGameStart = () => {
    player.started = true;
    rememberPlatform(s.game.platform_id, s.generation);
    rememberGame(s.game, s.generation);
    $("player-loading").hidden = true;
    if (saveData && !window.EJS_loadStateURL) {
      const manager = window.EJS_emulator.gameManager;
      manager.FS.writeFile(manager.getSaveFilePath(), new Uint8Array(saveData));
      manager.loadSaveFiles();
    }
    $("sync-status").textContent = "Progress sync ready";
    if (pendingSave || pendingState) queueSave(false);
    player.timer = setInterval(() => {
      if (!document.hidden) queueSave();
    }, 30000);
  };
  window.EJS_onSaveState = (data) => {
    keepProgress("states", data.state)
      .then(() => queueSave(false))
      .catch((error) => notice(error.message, true));
  };
  window.EJS_onSaveSave = (data) => {
    keepProgress("saves", data.save)
      .then(() => queueSave(false))
      .catch((error) => notice(error.message, true));
  };
  const script = document.createElement("script");
  script.src = new URL("assets/emulator/data/loader.js", document.baseURI);
  script.onerror = () => notice("The bundled emulator could not load.", true);
  document.head.appendChild(script);
}
function openPause() {
  if (!player.started) return;
  window.EJS_emulator.pause();
  showDialog(
    '<h2>Game paused</h2><p>Progress syncs to your connected RomM account. Start on your controller opens this menu.</p><div class="pause-actions"><button id="resume" class="primary">Resume</button><button id="pause-save">Save progress</button><button id="pause-exit">Save &amp; exit</button></div>',
  );
  $("resume").onclick = () => $("detail").close();
  $("pause-save").onclick = () => queueSave();
  $("pause-exit").onclick = saveExit;
  $("detail").addEventListener(
    "close",
    () => {
      if (!player.saving) window.EJS_emulator.play();
    },
    { once: true },
  );
}
async function saveExit() {
  if (player.saving) return;
  player.saving = true;
  window.EJS_emulator?.pause();
  clearInterval(player.timer);
  try {
    await queueSave();
    await api("stop", { body: { session: player.session.id } });
    player.started = false;
    location.assign(playerLibraryURL());
  } catch (error) {
    player.saving = false;
    player.timer = setInterval(() => {
      if (!document.hidden) queueSave();
    }, 30000);
    showDialog(
      "<h2>Progress is waiting to sync</h2><p>" +
        esc(error.message) +
        '</p><p>Keep the local copy and retry next time, or try saving again now.</p><button id="retry-exit" class="primary">Retry save &amp; exit</button><button id="local-exit">Leave with local progress</button>',
    );
    $("retry-exit").onclick = saveExit;
    $("local-exit").onclick = () => {
      player.started = false;
      location.assign(playerLibraryURL());
    };
  }
}
document.addEventListener("keydown", (event) => {
  if (player.session && event.key === "Escape" && !$("detail")?.open) {
    event.preventDefault();
    openPause();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && player.started) {
    window.EJS_emulator.pause();
    queueSave();
  }
});
window.addEventListener("beforeunload", (event) => {
  if (player.started) {
    queueSave();
    event.preventDefault();
    event.returnValue = "";
  }
});
function playerLibraryURL() {
  const q = new URLSearchParams(location.search);
  const id = player.session?.game?.id || Number(q.get("game"));
  const from = q.get("from") || "games";
  const url = new URL("./", document.baseURI);
  const theme = q.get("theme");
  if (theme) url.searchParams.set("theme", theme);
  url.hash =
    id > 0 ? "game?id=" + id + "&from=" + encodeURIComponent(from) : "games";
  return url;
}
async function boot() {
  try {
    if (location.pathname.endsWith("/play")) await startPlayer();
    else {
      shell();
      library.connection = await api("connection");
      if (library.connection.linked) await loadLibrary();
      else connectionForm();
    }
    requestAnimationFrame(gamepadFrame);
  } catch (error) {
    if (player.session && !player.started) {
      try {
        await api("stop", { body: { session: player.session.id } });
      } catch {}
    }
    $("app").classList.remove("is-player");
    shell();
    $("main").innerHTML =
      '<section class="connect"><h1>Could not open Games</h1><p>' +
      esc(error.message) +
      "</p>" +
      (needsSiloLaunch(error)
        ? recoveryActions(error)
        : '<a class="button-link" href="' +
          esc(playerLibraryURL()) +
          '">Back to selected game</a>') +
      "</section>";
    notice(error.message, true);
  }
}
boot();
