// Local fixture UI contracts. Large-library data below is synthetic; no real
// account, ROM, or remote cover is used. Engine tests own upstream filtering.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const root = process.env.SMOKE_URL || "http://127.0.0.1:18783";
const shots = process.env.SMOKE_SHOTS || "/tmp/romm-library";
const platforms = [
  {
    id: 1,
    name: "Nintendo Entertainment System",
    slug: "nes",
    core: "fceumm",
    rom_count: 845,
  },
  {
    id: 2,
    name: "Super Nintendo Entertainment System",
    slug: "snes",
    core: "snes9x",
    rom_count: 1220,
  },
  { id: 3, name: "Game Boy", slug: "gb", core: "gambatte", rom_count: 803 },
  {
    id: 4,
    name: "Game Boy Color",
    slug: "gbc",
    core: "gambatte",
    rom_count: 562,
  },
  {
    id: 5,
    name: "Game Boy Advance",
    slug: "gba",
    core: "mgba",
    rom_count: 1116,
  },
  { id: 6, name: "Nintendo 64", slug: "n64", rom_count: 338 },
  { id: 7, name: "Nintendo GameCube", slug: "ngc", rom_count: 650 },
  { id: 8, name: "PlayStation", slug: "ps", rom_count: 1567 },
  { id: 9, name: "PlayStation 2", slug: "ps2", rom_count: 2090 },
  { id: 10, name: "PlayStation 4", slug: "ps4", rom_count: 457 },
  { id: 11, name: "Sega Mega Drive", slug: "genesis", rom_count: 884 },
  ...Array.from({ length: 106 }, (_, i) => ({
    id: 100 + i,
    name: "Test archive platform " + (i + 1),
    slug: "fixture-" + i,
    rom_count: 40 + i,
  })),
  { id: 999, name: "Empty archive", slug: "fixture-empty", rom_count: 0 },
].sort((a, b) => a.name.localeCompare(b.name));
const games = Array.from({ length: 48 }, (_, i) => ({
  id: 42 + i,
  name: i ? "Synthetic library game " + i : "Silo Controller Test",
  display_title: i ? "Synthetic library game " + i : "Silo Controller Test",
  platform_id: 1,
  platform_slug: "nes",
  platform_display_name: "Nintendo Entertainment System",
  core: "fceumm",
  path_cover_small: i === 1 ? "/assets/romm/missing.png" : "",
}));
games[0].name = games[0].display_title =
  "An exceptionally long synthetic adventure title for a narrow cover";
games[0].version_count = 2;
fs.mkdirSync(shots, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(/\/api\/platforms(?:\?|$)/, (route) =>
      route.fulfill({ json: platforms }),
    );
    await page.route(/\/api\/games(?:\?|$)/, (route) =>
      route.fulfill({
        json:
          new URL(route.request().url()).searchParams.get("recent") === "true"
            ? {
                items: [
                  {
                    ...games[1],
                    rom_user: { last_played: "2026-11-12T12:00:00Z" },
                  },
                ],
                total: 1,
              }
            : { items: games, total: 97 },
      }),
    );
    await page.route(/\/api\/art\?/, (route) =>
      route.fulfill({ status: 503, body: "Artwork unavailable" }),
    );
    const linked = await page.request.post(root + "/romm/api/link", {
      data: { token: "rmm_development-fixture-token" },
    });
    assert.equal(linked.status(), 200);
    await page.goto(root + "/romm?theme=midnight-cinema");
    await page.locator(".platform-tile").first().waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector(".platform-tile img.platform-icon")
          ?.naturalWidth > 0,
    );
    assert.equal(await page.locator(".platform-tile").count(), 117);
    await page.getByRole("checkbox", { name: "Show empty platforms" }).check();
    assert.equal(await page.locator(".platform-tile").count(), 118);
    await page.reload();
    await page.locator(".platform-tile").first().waitFor();
    assert(
      await page
        .getByRole("checkbox", { name: "Show empty platforms" })
        .isChecked(),
    );
    assert.equal(await page.locator(".platform-tile").count(), 118);
    await page
      .getByRole("checkbox", { name: "Show empty platforms" })
      .uncheck();
    assert.equal(await page.locator(".platform-tile").count(), 117);
    await page.locator('.activity-grid [data-game="43"]').waitFor();
    await page.locator('.activity-grid [data-game="43"]').click();
    await page.waitForFunction(
      () => document.querySelector("#rom-version")?.value === "43",
    );
    assert.equal(
      new URLSearchParams(page.url().split("#game?")[1]).get("id"),
      "43",
      "history must open the actual played ROM version",
    );
    await page.locator("#back-library").click();
    await page.locator(".platform-tile").first().waitFor();
    await page.screenshot({ path: shots + "/platforms-desktop.png" });
    await page
      .getByRole("searchbox", { name: "Find a platform", exact: true })
      .fill("Nintendo Entertainment");
    assert.equal(await page.locator("#platform-links button").count(), 2);
    await page.locator('#platform-links [data-platform="1"]').click();
    await page.locator(".game-card").first().waitFor();
    assert.equal(await page.locator(".game-card").count(), 48);
    assert.equal(
      await page
        .locator(".game-card")
        .first()
        .locator(".version-count")
        .textContent(),
      "2 versions",
    );
    assert.equal(
      await page.getByText("Browse only", { exact: true }).count(),
      0,
    );
    assert.equal(await page.locator(".game-card [data-art]").count(), 1);
    assert(
      await page
        .locator(".game-card")
        .nth(1)
        .locator(".cover-fallback")
        .isVisible(),
    );
    await page.locator("#pin-platform").click();
    await page.locator("#unpin-1").waitFor();
    await page.reload();
    await page.locator("#unpin-1").waitFor();
    assert.equal(
      await page.locator("#pin-platform").getAttribute("aria-pressed"),
      "true",
    );
    assert.match(
      await page.locator("#search").getAttribute("aria-label"),
      /Nintendo Entertainment/,
    );
    await page.locator("#search").fill("synthetic");
    await page.waitForFunction(() =>
      location.hash.includes("search=synthetic"),
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "search",
    );
    await page
      .getByRole("button", { name: "Remove Search: synthetic", exact: true })
      .click();
    await page.waitForFunction(() => !location.hash.includes("search="));
    await page.evaluate(() => scrollTo(0, 700));
    await page.waitForTimeout(40);
    assert(
      await page.evaluate(
        () =>
          Math.abs(
            document.querySelector(".library-header").getBoundingClientRect()
              .top,
          ) < 1,
      ),
    );
    assert(
      await page.evaluate(
        () =>
          Math.abs(
            document.querySelector(".library-rail").getBoundingClientRect()
              .top -
              document.querySelector(".library-header").getBoundingClientRect()
                .bottom,
          ) < 2,
      ),
    );
    await page.evaluate(() => scrollTo(0, 0));
    let query = page.waitForRequest(
      (r) =>
        r.url().includes("/api/games?") &&
        new URL(r.url()).searchParams.get("sort") === "newest",
    );
    await page.locator("#sort").selectOption("newest");
    await query;
    await page.locator(".game-card").first().waitFor();
    query = page.waitForRequest(
      (r) =>
        r.url().includes("/api/games?") &&
        new URL(r.url()).searchParams.get("playable") === "true",
    );
    await page
      .getByRole("checkbox", { name: "Playable in Silo", exact: true })
      .check();
    await query;
    await page.locator(".game-card").first().waitFor();
    await page.locator("#density").selectOption("compact");
    assert.equal(
      await page.locator("#grid").getAttribute("data-density"),
      "compact",
    );
    await page.locator("#density").selectOption("comfortable");
    await page.screenshot({ path: shots + "/gallery-desktop.png" });
    await page.locator(".game-card").first().click();
    await page
      .getByRole("heading", { name: "Silo Controller Test", exact: true })
      .waitFor();
    assert.equal(await page.locator("dialog[open]").count(), 0);
    await page.getByText("File information", { exact: true }).click();
    await page.getByText("silo-test.nes", { exact: true }).waitFor();
    await page.getByText("1990", { exact: true }).waitFor();
    assert.equal(await page.locator("#rom-version option").count(), 2);
    assert.equal(
      await page
        .locator(".detail-artwork img[data-art]")
        .evaluate((el) => getComputedStyle(el).objectFit),
      "contain",
    );
    await page.screenshot({ path: shots + "/detail-desktop.png" });
    await page.locator("#rom-version").selectOption("43");
    await page.waitForFunction(
      () => document.querySelector("#rom-version")?.value === "43",
    );
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "rom-version",
    );
    assert.match(
      await page.locator("#rom-version option:checked").textContent(),
      /Europe.*Preferred in RomM/,
    );
    assert.equal(new URL(page.url()).search, "?theme=midnight-cinema");
    let launchID;
    await page.route(/\/api\/play(?:\?|$)/, (route) => {
      launchID = route.request().postDataJSON().id;
      return route.fulfill({
        status: 400,
        json: { error: "Launch selection verified" },
      });
    });
    await page.getByRole("button", { name: /^(Play|Resume)$/ }).click();
    await page
      .getByText("Launch selection verified", { exact: true })
      .waitFor();
    assert.equal(
      launchID,
      43,
      "launch used the original ROM instead of the chosen version",
    );
    await page.unroute(/\/api\/play(?:\?|$)/);
    await page.getByText("File information", { exact: true }).click();
    await page.getByText("silo-test (Europe).nes", { exact: true }).waitFor();
    await page.screenshot({ path: shots + "/version-selected.png" });
    let missing = true;
    await page.route(/\/api\/game(?:\?|$)/, async (route) => {
      const response = await route.fetch();
      const game = await response.json();
      await route.fulfill({
        response,
        json: { ...game, has_file_on_disk: !missing },
      });
    });
    await page.locator("#rom-version").selectOption("42");
    await page.getByText("ROM file unavailable", { exact: true }).waitFor();
    assert.equal(await page.locator("#launch").count(), 0);
    await page.screenshot({ path: shots + "/missing-rom.png" });
    missing = false;
    await page
      .getByRole("button", { name: "Check again", exact: true })
      .click();
    await page.getByRole("button", { name: /^(Play|Resume)$/ }).waitFor();
    assert.equal(
      await page.getByText("ROM file unavailable", { exact: true }).count(),
      0,
    );
    await page.unroute(/\/api\/game(?:\?|$)/);
    await page.goBack();
    await page.locator(".game-card").first().waitFor();
    assert.equal(await page.locator("#sort").inputValue(), "newest");
    assert(await page.locator("#playable").isChecked());
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.game),
      "42",
    );
    const galleryURL = page.url();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert(
        await page
          .locator(".app-header button")
          .evaluateAll((els) =>
            els
              .filter((el) => el.getClientRects().length)
              .every((el) => el.getBoundingClientRect().height >= 44),
          ),
        "small phone header targets",
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "gallery overflow at " + width,
      );
      await page.screenshot({
        path: shots + "/gallery-mobile-" + width + ".png",
      });
      assert.equal(
        await page.locator("#filters-toggle").getAttribute("aria-expanded"),
        "false",
      );
      await page.locator("#filters-toggle").click();
      assert(await page.locator("#platform").isVisible());
      for (const density of ["comfortable", "compact"]) {
        await page.locator("#density").selectOption(density);
        assert.equal(
          await page.locator(".cover-fallback .fallback-title").count(),
          0,
          "title must appear only below the illustration",
        );
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          "compact gallery overflow",
        );
        assert(
          await page
            .locator(".game-card-meta")
            .first()
            .evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 13),
        );
        if (density === "compact")
          await page.screenshot({
            path: shots + "/gallery-mobile-" + width + "-compact.png",
          });
      }
      await page.locator("#density").selectOption("comfortable");
      await page.keyboard.press("Escape");
      assert.equal(
        await page.locator("#filters-toggle").getAttribute("aria-expanded"),
        "false",
      );
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "filters-toggle",
      );
    }
    await page.goto(root + "/romm?theme=light#platforms");
    await page.locator(".platform-tile").first().waitFor();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({ path: shots + "/platforms-mobile-light.png" });
    await page.getByRole("button", { name: "Open library navigation" }).click();
    assert(
      await page
        .getByRole("searchbox", { name: "Find a platform", exact: true })
        .isVisible(),
    );
    await page.keyboard.press("Escape");
    assert(!(await page.locator("#library-navigation").isVisible()));
    await page.goto(galleryURL);
    await page.locator(".game-card").first().waitFor();
    await page.locator(".game-card").first().click();
    await page.locator("#game-heading").waitFor();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert(
      await page
        .locator("#launch")
        .evaluate((el) => el.getBoundingClientRect().bottom < innerHeight),
      "mobile play action should be near the title and version",
    );
    assert.equal(await page.locator("#launch").textContent(), "Play");
    await page.screenshot({ path: shots + "/detail-mobile.png" });
    await page.route(/\/api\/game(?:\?|$)/, (route) =>
      route.fulfill({
        status: 401,
        contentType: "text/plain",
        body: "session expired",
      }),
    );
    await page.reload();
    await page
      .getByRole("link", { name: "Reopen Games from Silo", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("link", { name: "Reopen Games from Silo", exact: true })
        .getAttribute("href"),
      "/",
    );
    assert(
      page.url().includes("#game?id=42"),
      "session failure must preserve selection",
    );
    await page.unroute(/\/api\/game(?:\?|$)/);
    await page.reload();
    await page.locator("#launch").waitFor();
    await page.route(/\/api\/game(?:\?|$)/, async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: {
          ...(await response.json()),
          progress_known: true,
          resume_available: true,
        },
      });
    });
    await page.reload();
    await page.getByRole("button", { name: "Resume", exact: true }).waitFor();
    await page.unroute(/\/api\/game(?:\?|$)/);
    await page.locator("#detail-platform").click();
    await page.locator("#pin-platform").waitFor();
    assert.match(page.url(), /#games\?platform=1$/);
    await page.request.post(root + "/romm/api/link", {
      data: { token: "rmm_development-fixture-token" },
    });
    await page.reload();
    await page.locator("#pin-platform").waitFor();
    assert.equal(
      await page.locator("#pin-platform").getAttribute("aria-pressed"),
      "false",
      "relink must isolate local preferences",
    );
    assert.equal(await page.locator("#unpin-1").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: platform visibility, grouped ROM versions and selected launch, release dates, artwork, gallery filters, detail/back state, touch targets, dark/light and 320px overflow",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
