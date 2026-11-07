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
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(data.error || "The request could not be completed."),
      { status: response.status },
    );
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
};
const gameURL = (game) => apiURL("art", { id: game.id });
function shell() {
  $("app").innerHTML =
    '<header class="app-header"><a class="home-link" href="/">Silo</a><span class="header-divider"></span><strong>Games</strong><span class="header-spacer"></span><button id="account">Account</button></header><main id="main" tabindex="-1"></main>';
  $("account").addEventListener("click", accountDialog);
}
function connectionForm() {
  stopRomMSignIn(true);
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
async function loadLibrary() {
  notice("");
  $("main").innerHTML =
    '<div class="library-intro"><div><h1>Games</h1></div><p>Pick up where you left off.</p></div><form class="filters" id="filters"><label class="search-label">Search games<input id="search" type="search" placeholder="Search your collection" maxlength="200"></label><label>Platform<select id="platform"><option value="">All platforms</option></select></label><label>Collection<select id="collection"><option value="">All collections</option></select></label></form><div class="results-head"><p id="result-count" role="status"></p><span>Arrow keys / D-pad to browse · Enter / A to open</span></div><div id="grid" class="game-grid" aria-label="Games"></div><nav id="pagination" aria-label="Game pages"></nav>';
  try {
    [library.platforms, library.collections] = await Promise.all([
      api("platforms"),
      api("collections"),
    ]);
  } catch (error) {
    notice(error.message, true);
  }
  for (const [id, rows] of [
    ["platform", library.platforms],
    ["collection", library.collections],
  ])
    $("" + id).innerHTML += [...(rows || [])]
      .map(
        (p) =>
          '<option value="' +
          p.id +
          '">' +
          esc(p.name) +
          " (" +
          (p.rom_count || 0) +
          ")</option>",
      )
      .join("");
  $("search").value = library.search;
  $("platform").value = library.platform;
  $("collection").value = library.collection;
  let debounce;
  $("filters").onsubmit = (e) => {
    e.preventDefault();
    clearTimeout(debounce);
    library.offset = 0;
    loadGames();
  };
  $("search").oninput = (e) => {
    library.search = e.target.value;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      library.offset = 0;
      loadGames();
    }, 250);
  };
  for (const id of ["platform", "collection"])
    $(id).onchange = (e) => {
      library[id] = e.target.value;
      library.offset = 0;
      loadGames();
    };
  await loadGames();
}
async function loadGames() {
  if (library.abort) library.abort.abort();
  library.abort = new AbortController();
  const gen = ++library.generation;
  $("grid").setAttribute("aria-busy", "true");
  $("result-count").textContent = "Loading games…";
  try {
    const page = await api("games", {
      query: {
        search: library.search,
        platform: library.platform,
        collection: library.collection,
        offset: library.offset,
      },
      signal: library.abort.signal,
    });
    if (gen !== library.generation) return;
    library.page = page;
    const games = page.items || [];
    $("result-count").textContent =
      (page.total ?? games.length) +
      ((page.total ?? games.length) === 1 ? " game" : " games");
    $("grid").innerHTML = games.length
      ? games
          .map(
            (g) =>
              '<button type="button" class="game-card" data-game="' +
              g.id +
              '"><span class="cover"><img src="' +
              esc(gameURL(g)) +
              '" loading="lazy" alt=""><span class="cover-placeholder" aria-hidden="true">' +
              esc((g.name || g.fs_name || "Game").slice(0, 1)) +
              "</span></span><strong>" +
              esc(g.name || g.fs_name || "Untitled game") +
              "</strong><span>" +
              esc(g.platform_display_name || g.platform_slug) +
              "</span>" +
              (g.core ? "" : "<small>Browse only</small>") +
              "</button>",
          )
          .join("")
      : '<div class="empty"><h2>No games found</h2><p>Try another search, platform or collection.</p></div>';
    $("grid")
      .querySelectorAll("img")
      .forEach((img) => {
        img.addEventListener("error", () => (img.hidden = true));
        img.addEventListener(
          "load",
          () => (img.nextElementSibling.hidden = true),
        );
      });
    $("grid")
      .querySelectorAll("[data-game]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            openGame(Number(button.dataset.game), button)),
      );
    $("pagination").innerHTML =
      (library.offset ? '<button data-page="prev">Previous</button>' : "") +
      (library.offset + games.length < page.total
        ? '<button data-page="next">Next</button>'
        : "");
    $("pagination")
      .querySelectorAll("button")
      .forEach(
        (button) =>
          (button.onclick = () => {
            library.offset = Math.max(
              0,
              library.offset + (button.dataset.page === "next" ? 48 : -48),
            );
            loadGames().then(() => $("grid").querySelector("button")?.focus());
          }),
      );
  } catch (error) {
    if (error.name !== "AbortError") {
      $("result-count").textContent = "Games unavailable";
      notice(error.message, true);
      $("grid").innerHTML =
        '<div class="empty"><h2>Could not load your collection</h2><button id="retry">Try again</button></div>';
      $("retry").onclick = loadGames;
    }
  } finally {
    if (gen === library.generation) $("grid").removeAttribute("aria-busy");
  }
}
async function openGame(id, button) {
  library.lastFocus = button;
  button.disabled = true;
  try {
    const g = await api("game", { query: { id } });
    showDialog(
      '<div class="game-detail"><img class="detail-cover" src="' +
        esc(gameURL(g)) +
        '" alt=""><div><h2>' +
        esc(g.name || g.fs_name) +
        '</h2><p class="game-platform">' +
        esc(g.platform_display_name || g.platform_slug) +
        '</p><p class="game-summary">' +
        esc(g.summary || "No description is available for this game.") +
        "</p>" +
        (g.core
          ? '<button id="launch" class="primary">Play / Resume</button><p class="help">Your compatible RomM save state resumes automatically. Progress syncs to your connected account.</p>'
          : '<p class="help">Browser play for this platform is not available yet.</p>') +
        '<p id="launch-status" role="status"></p></div></div>',
    );
    if ($("launch"))
      $("launch").onclick = async () => {
        const launch = $("launch");
        launch.disabled = true;
        $("launch-status").textContent = "Checking saved progress…";
        try {
          const session = await api("play", { body: { id } });
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
    notice(error.message, true);
  } finally {
    button.disabled = false;
  }
}
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
      $("detail")?.close();
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
    location.assign(new URL("./", document.baseURI));
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
      location.assign(new URL("./", document.baseURI));
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
