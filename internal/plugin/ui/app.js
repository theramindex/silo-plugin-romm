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
        data?.error ||
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
  showEmpty: false,
  iconNames: new Set(),
  ready: false,
};
const gameURL = (game) => apiURL("art", { id: game.id });
function shell() {
  $("app").innerHTML =
    '<header class="app-header"><button id="navigation-toggle" class="navigation-toggle" aria-label="Open library navigation" aria-controls="library-navigation" aria-expanded="false" hidden>Menu</button><a class="home-link" href="/">Silo</a><span class="header-divider"></span><strong>Games</strong><span class="header-spacer"></span><button id="account">Account</button></header><main id="main" tabindex="-1"></main>';
  $("account").addEventListener("click", accountDialog);
  $("navigation-toggle").onclick = () => {
    const open = $("library-navigation")?.classList.toggle("is-open");
    $("navigation-toggle").setAttribute("aria-expanded", String(!!open));
  };
}
function connectionForm() {
  stopRomMSignIn(true);
  $("navigation-toggle").hidden = true;
  $("main").innerHTML =
    '<section class="connect"><h1>Connect your games</h1><p>Connect this Silo profile to your RomM account to browse your collection and keep saved progress with you.</p>' +
    (!library.connection.configured
      ? '<div class="empty"><h2>RomM needs a server address</h2><p>Ask your Silo administrator to set the RomM server address in this plugin’s settings.</p></div>'
      : '<div class="browser-sign-in"><button type="button" class="primary" id="romm-sign-in">Sign in to RomM</button><p class="help">Sign in with your RomM account or SSO, then approve Silo Games. This connection is saved for your current Silo profile.</p><div id="romm-sign-in-progress" role="status" aria-live="polite"></div></div><details class="manual-connection"><summary>Use a token or pairing code</summary><form id="connect-form"><label for="token">RomM client token</label><input id="token" name="token" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your client token"><div class="or">or use a pairing code</div><label for="pair-code">Pairing code</label><input id="pair-code" name="code" autocomplete="off" spellcheck="false" maxlength="100"><p class="help">Create a client token in RomM with access to your profile, games, platforms, collections, firmware, and read/write game assets. Only your account’s permissions apply.</p><button class="primary" type="submit">Connect account</button><p id="connect-error" role="alert"></p></form></details>') +
    '<p class="help">Browser play: NES · SNES · Game Boy · Game Boy Color · Game Boy Advance<br>No games or BIOS files are included.</p></section>';
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
    root.innerHTML =
      '<p>Approve <strong>Silo Games</strong> in RomM. Check that the code matches:</p><code class="approval-code">' +
      esc(flow.userCode) +
      '</code><p><a class="approval-link" href="' +
      esc(flow.verificationUrl) +
      '" target="_blank" rel="noopener noreferrer">Continue to RomM <span class="sr-only">(opens a new tab)</span></a></p><p class="help">Keep this page open. You will connect automatically after approval.</p><p id="romm-approval-message"></p><button type="button" id="romm-sign-in-cancel">Cancel sign-in</button>';
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
      signInMessage("Sign-in cancelled. You can try again.");
      button.disabled = false;
      button.focus();
    };
    if (popup && !popup.closed) popup.location.replace(flow.verificationUrl);
    pollRomMSignIn(generation);
  } catch (error) {
    if (popup && !popup.closed) popup.close();
    if (generation !== rommSignIn.generation) return;
    signInMessage(error.message);
    button.disabled = false;
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
      signInMessage(result.message || "Sign-in ended. Start again.");
      if ($("romm-sign-in")) $("romm-sign-in").disabled = false;
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
      signInMessage("This sign-in is no longer active. Start again.");
      if ($("romm-sign-in")) $("romm-sign-in").disabled = false;
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
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  play: '<path d="m9 5 11 7-11 7z"/>',
  games:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h5m-2.5-2.5v5M16 9h.01M18 12h.01M7 16h10"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  back: '<path d="m14 5-7 7 7 7M7 12h14"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  folder: '<path d="M3 7V5h6l2 2h10v13H3z"/>',
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
  const title = titleOf(g),
    p = library.platforms.find((p) => p.id === g.platform_id) || {
      name: g.platform_display_name || g.platform_slug,
      slug: g.platform_slug,
    };
  const hasArt = !!(g.path_cover_small || g.path_cover_large);
  return (
    '<span class="cover' +
    (detail ? " detail-cover" : "") +
    '">' +
    '<span class="cover-fallback">' +
    platformArt(p) +
    '<span class="fallback-title">' +
    esc(title) +
    '</span><span class="fallback-platform">' +
    esc(p.name || "Game") +
    "</span></span>" +
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
  if (state.sort !== "name") q.set("sort", state.sort);
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
  library.view =
    view === "game" ? "game" : view === "games" ? "games" : "platforms";
  library.platform = q.get("platform") || "";
  library.collection = q.get("collection") || "";
  library.search = q.get("search") || "";
  library.playable = q.get("playable") === "true";
  library.sort = ["name", "name-desc", "newest"].includes(q.get("sort"))
    ? q.get("sort")
    : "name";
  library.offset = Math.min(100000, Math.max(0, Number(q.get("offset")) || 0));
  return q;
}
async function loadLibrary() {
  library.ready = false;
  $("navigation-toggle").hidden = true;
  notice("");
  $("main").className = "library-shell";
  $("main").innerHTML =
    '<p class="library-loading" role="status">Opening your library…</p>';
  try {
    [library.platforms, library.collections, library.iconNames] =
      await Promise.all([
        api("platforms"),
        api("collections"),
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
      library.showEmpty =
        localStorage.getItem(
          "silo-romm-empty-platforms:" + library.connection.namespace,
        ) === "true";
    } catch {}
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
      '</p><button id="retry-library">Try again</button></div>';
    $("retry-library").onclick = loadLibrary;
  }
}
function visiblePlatforms() {
  return library.platforms.filter(
    (p) =>
      library.showEmpty || p.rom_count > 0 || String(p.id) === library.platform,
  );
}
function renderLibraryNavigation() {
  const nav = $("library-navigation");
  const active = (selected) => (selected ? ' aria-current="page"' : "");
  nav.innerHTML =
    '<p class="rail-heading">Your library</p><nav class="library-nav" aria-label="Browse games">' +
    '<button data-route="platforms"' +
    active(library.view === "platforms") +
    ">" +
    icon("grid") +
    "Platforms</button>" +
    '<button data-route="games"' +
    active(
      library.view === "games" &&
        !library.platform &&
        !library.collection &&
        !library.playable,
    ) +
    ">" +
    icon("games") +
    "All games</button>" +
    '<button data-route="games?playable=true"' +
    active(library.view === "games" && library.playable && !library.platform) +
    ">" +
    icon("play") +
    "Play in Silo</button></nav>" +
    (library.collections.length
      ? '<h2 class="rail-heading">Collections</h2><nav class="collection-nav" aria-label="Collections">' +
        library.collections
          .map(
            (c) =>
              '<button data-route="games?collection=' +
              c.id +
              '"' +
              active(library.collection === String(c.id)) +
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
  };
  renderPlatformLinks();
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
  library.renderedHash = location.hash;
  const focusID = document.activeElement?.id;
  const selection = document.activeElement?.selectionStart;
  if (library.abort) library.abort.abort();
  ++library.generation;
  clearTimeout(library.searchTimer);
  const q = readBrowseRoute();
  notice("");
  renderLibraryNavigation();
  if (library.view === "game") {
    await renderGameDetail(q.get("id"), q.get("from"));
    return;
  }
  if (library.view === "platforms") {
    renderPlatformOverview();
    return;
  }
  renderGallery();
  if (
    ["search", "sort", "collection", "playable", "platform"].includes(focusID)
  ) {
    $(focusID)?.focus({ preventScroll: true });
    if (focusID === "search" && selection != null)
      $(focusID)?.setSelectionRange(selection, selection);
  }
  await loadGames();
}
function renderPlatformOverview() {
  $("library-content").innerHTML =
    '<header class="library-heading"><div><h1>Your platforms</h1><p>Choose a system. Find your next game.</p></div><span class="library-total">' +
    countText(visiblePlatforms().length) +
    " platforms · " +
    countText(library.platforms.reduce((n, p) => n + p.rom_count, 0)) +
    " ROMs</span></header>" +
    '<div class="overview-controls"><label class="overview-search">' +
    icon("search") +
    '<input id="overview-search" aria-label="Search platforms" type="search" placeholder="Search your platforms" value="' +
    esc(library.overviewSearch || "") +
    '"></label><label class="empty-platforms-toggle"><input id="show-empty-platforms" type="checkbox"' +
    (library.showEmpty ? " checked" : "") +
    '>Show empty platforms</label></div><div id="platform-groups"></div>';
  $("overview-search").oninput = (e) => {
    library.overviewSearch = e.target.value;
    renderPlatformGroups(e.target.value);
  };
  $("show-empty-platforms").onchange = (e) => {
    library.showEmpty = e.target.checked;
    try {
      localStorage.setItem(
        "silo-romm-empty-platforms:" + library.connection.namespace,
        String(library.showEmpty),
      );
    } catch {}
    renderLibraryNavigation();
    renderPlatformOverview();
    $("show-empty-platforms").focus({ preventScroll: true });
  };
  renderPlatformGroups(library.overviewSearch || "");
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
        platforms
          .map(
            (p) =>
              '<button class="platform-tile" data-platform="' +
              p.id +
              '"><span class="platform-art">' +
              platformArt(p) +
              '</span><span class="platform-tile-name">' +
              esc(p.name) +
              '</span><span class="platform-tile-count">' +
              countText(p.rom_count) +
              (p.rom_count === 1
                ? " ROM</span></button>"
                : " ROMs</span></button>"),
          )
          .join("") +
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
function renderGallery() {
  const platform = library.platforms.find(
    (p) => String(p.id) === library.platform,
  );
  const collection = library.collections.find(
    (c) => String(c.id) === library.collection,
  );
  const title =
    platform?.name ||
    collection?.name ||
    (library.playable ? "Play in Silo" : "All games");
  $("library-content").innerHTML =
    '<header class="library-heading gallery-heading"><div><button class="breadcrumb text-button" data-home>' +
    icon("back") +
    "Platforms</button><h1>" +
    esc(title) +
    "</h1></div>" +
    (platform
      ? '<span class="heading-platform-art">' +
        platformArt(platform) +
        "</span>"
      : "") +
    "</header>" +
    '<form id="filters" class="gallery-toolbar"><label class="game-search">Search games<input id="search" type="search" placeholder="Search games in this library" maxlength="200" value="' +
    esc(library.search) +
    '"></label>' +
    '<label class="mobile-platform">Platform<select id="platform"><option value="">All platforms</option>' +
    visiblePlatforms()
      .map((p) => '<option value="' + p.id + '">' + esc(p.name) + "</option>")
      .join("") +
    "</select></label>" +
    '<label>Sort<select id="sort"><option value="name">Name A–Z</option><option value="name-desc">Name Z–A</option><option value="newest">Recently added</option></select></label>' +
    (library.collections.length
      ? '<label>Collection<select id="collection"><option value="">All collections</option>' +
        library.collections
          .map(
            (c) => '<option value="' + c.id + '">' + esc(c.name) + "</option>",
          )
          .join("") +
        "</select></label>"
      : "") +
    '<button class="search-submit" type="submit">Search</button></form>' +
    '<div class="gallery-options"><label class="playable-toggle"><input id="playable" type="checkbox"' +
    (library.playable ? " checked" : "") +
    '>Playable in Silo</label><label class="density-control">Covers<select id="density" aria-label="Cover size"><option value="comfortable">Large</option><option value="compact">Small</option></select></label></div>' +
    '<div class="results-head"><p id="result-count" role="status"></p><span class="controller-hint">D-pad to browse · A to open · B to go back</span></div><div id="grid" class="game-grid" data-density="' +
    (library.density === "compact" ? "compact" : "comfortable") +
    '" aria-label="Games"></div><nav id="pagination" aria-label="Game pages"></nav>';
  $("library-content").querySelector("[data-home]").onclick = () =>
    navigateLibrary("platforms");
  $("platform").value = library.platform;
  $("sort").value = library.sort;
  if ($("collection")) $("collection").value = library.collection;
  $("density").value =
    library.density === "compact" ? "compact" : "comfortable";
  const update = () => {
    clearTimeout(library.searchTimer);
    navigateLibrary(
      browseHash({
        search: $("search").value,
        platform: $("platform").value,
        collection: $("collection")?.value || "",
        sort: $("sort").value,
        playable: $("playable").checked,
        offset: 0,
      }),
    );
  };
  $("filters").onsubmit = (e) => {
    e.preventDefault();
    update();
  };
  $("search").oninput = () => {
    clearTimeout(library.searchTimer);
    library.searchTimer = setTimeout(update, 350);
  };
  for (const id of ["platform", "sort", "collection", "playable"])
    if ($(id)) $(id).onchange = update;
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
      },
      signal: library.abort.signal,
    });
    if (gen !== library.generation || !grid.isConnected) return;
    notice("");
    library.page = page;
    const games = page.items || [];
    $("result-count").textContent =
      countText(page.total ?? games.length) +
      ((page.total ?? games.length) === 1 ? " game" : " games");
    grid.innerHTML = games.length
      ? games
          .map(
            (g) =>
              '<button type="button" class="game-card" data-game="' +
              g.id +
              '" aria-label="' +
              esc(
                titleOf(g) +
                  ", " +
                  (g.platform_display_name || g.platform_slug) +
                  (g.core ? ", playable in Silo" : ""),
              ) +
              '">' +
              coverMarkup(g) +
              '<span class="game-card-title">' +
              esc(titleOf(g)) +
              '</span><span class="game-card-meta"><span>' +
              esc(g.platform_display_name || g.platform_slug) +
              "</span>" +
              (g.version_count > 1
                ? '<span class="version-count">' +
                  g.version_count +
                  " versions</span>"
                : "") +
              (g.core
                ? '<span class="play-indicator" title="Playable in Silo">' +
                  icon("play") +
                  '<span class="sr-only">Playable in Silo</span></span>'
                : "") +
              "</span></button>",
          )
          .join("")
      : '<div class="empty"><h2>' +
        (library.playable ? "No playable games here" : "No games found") +
        "</h2><p>" +
        (library.playable
          ? "Silo supports NES, SNES, Game Boy, Game Boy Color, and Game Boy Advance. Try another platform or turn off the playable filter."
          : "Try another search, platform, or collection.") +
        '</p><button id="clear-filters">Clear filters</button></div>';
    hydrateArtwork(grid);
    grid
      .querySelectorAll("[data-game]")
      .forEach((b) => (b.onclick = () => openGame(Number(b.dataset.game), b)));
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
      grid
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
        '</p><button id="retry">Try again</button></div>';
      $("retry").onclick = loadGames;
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
  navigateLibrary(
    "game?id=" +
      id +
      "&from=" +
      encodeURIComponent(location.hash.slice(1) || "games"),
  );
}
function backToLibrary(from) {
  navigateLibrary(
    from && /^(games(?:\?|$)|platforms$)/.test(from) ? from : "games",
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
      '</aside><div class="detail-main"><h1 tabindex="-1" id="game-heading">' +
      esc(titleOf(g)) +
      '</h1><p class="game-platform">' +
      esc(g.platform_display_name || g.platform_slug) +
      "</p>" +
      (m.genres?.length
        ? '<p class="game-genres">' + m.genres.map(esc).join(" · ") + "</p>"
        : "") +
      versionPicker +
      '<div class="detail-actions">' +
      (g.core
        ? '<button id="launch" class="primary">' +
          icon("play") +
          "Play / Resume</button><p>Play here with your connected RomM account. Your compatible saved progress resumes automatically.</p>"
        : '<p class="unsupported-message">This platform is available to browse. Browser play in Silo supports NES, SNES, Game Boy, Game Boy Color, and Game Boy Advance.</p>') +
      '<p id="launch-status" role="status"></p></div><section class="game-about"><h2>About this game</h2><p class="game-summary">' +
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
          countText(Math.round((g.fs_size_bytes / 1048576) * 10) / 10) +
          " MB</dd>"
        : "") +
      "</dl></details></div></article>";
    $("back-library").onclick = () => backToLibrary(from);
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
          location.assign(
            new URL(
              "play?session=" + encodeURIComponent(session.id),
              document.baseURI,
            ),
          );
        } catch (error) {
          $("launch-status").textContent = error.message;
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
      '</p><button id="back-library">Back to library</button></div>';
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
  if (bytes.byteLength > 16 * 1024 * 1024)
    throw new Error("Progress exceeds the 16 MiB save limit.");
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
    throw new Error(
      "Could not download " +
        kind +
        ". Check RomM access and the Silo stream relay.",
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
  window.EJS_gameUrl = blob(rom);
  window.EJS_gameName = s.namespace;
  window.EJS_gameID = 1;
  window.EJS_pathtodata = new URL(
    "assets/emulator/data/",
    document.baseURI,
  ).href;
  window.EJS_startOnLoaded = true;
  window.EJS_threads = false;
  window.EJS_disableAutoLang = true;
  window.EJS_language = "en-US";
  window.EJS_disableDatabases = true;
  window.EJS_defaultOptions = {
    ejs_threads: "disabled",
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
  if (s.biosId) window.EJS_biosUrl = blob(await fetchBinary("bios"));
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
    location.assign(new URL("./#games", document.baseURI));
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
      location.assign(new URL("./#games", document.baseURI));
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
    $("app").innerHTML =
      '<main class="connect"><h1>Could not open Games</h1><p>' +
      esc(error.message) +
      '</p><a href="' +
      esc(new URL("./", document.baseURI)) +
      '">Back to Games</a></main>';
    notice(error.message, true);
  }
}
boot();
