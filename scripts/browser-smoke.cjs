// Start `go run ./cmd/devserver --fixture` first. No real account or game data.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const root = process.env.SMOKE_URL || "http://127.0.0.1:18783";
const shots = process.env.SMOKE_SHOTS || "/tmp/romm-smoke";
fs.mkdirSync(shots, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (e) => {
      // Headless Chromium may refuse the core's optional screen wake lock.
      if (e.message !== "Wake Lock permission request denied")
        errors.push(e.stack || e.message);
    });
    await page.goto(root + "/romm");
    if (await page.locator("#token").count()) {
      await page.locator("#token").fill("development-fixture-token");
      await page.getByRole("button", { name: "Connect account" }).click();
    }
    await page.locator(".game-card").waitFor();
    await page.locator(".game-card").focus();
    await page.evaluate(() => {
      window.testPad = {
        index: 0,
        id: "Silo Test Controller",
        mapping: "standard",
        connected: true,
        timestamp: performance.now(),
        buttons: Array.from({ length: 17 }, () => ({ pressed: false })),
        axes: [0, 0],
      };
      navigator.getGamepads = () => [window.testPad];
      window.testPad.buttons[0].pressed = true;
    });
    await page.locator("dialog[open]").waitFor();
    await page.evaluate(() => {
      window.testPad.buttons[0].pressed = false;
    });
    await page.waitForTimeout(60);
    await page.evaluate(() => {
      window.testPad.buttons[1].pressed = true;
    });
    await page.waitForFunction(() => !document.querySelector("dialog[open]"));
    await page.evaluate(() => {
      window.testPad.buttons[1].pressed = false;
    });
    // A remains an independent edge while a direction is held. Native filters
    // expose a controller-operable choice dialog instead of relying on click().
    await page.locator("#platform").focus();
    await page.evaluate(() => {
      window.testPad.buttons[12].pressed = true;
    });
    await page.waitForTimeout(60);
    await page.locator("#platform").focus();
    await page.evaluate(() => {
      window.testPad.buttons[0].pressed = true;
    });
    await page.getByRole("dialog", { name: "Select platform" }).waitFor();
    await page.evaluate(() => {
      window.testPad.buttons[0].pressed = false;
      window.testPad.buttons[12].pressed = false;
    });
    await page.waitForTimeout(60);
    await page.evaluate(() => {
      window.testPad.buttons[13].pressed = true;
    });
    await page.waitForTimeout(60);
    await page.evaluate(() => {
      window.testPad.buttons[13].pressed = false;
      window.testPad.buttons[0].pressed = true;
    });
    await page.waitForFunction(() => !document.querySelector("dialog[open]"));
    assert.equal(await page.locator("#platform").inputValue(), "1");
    await page.evaluate(() => {
      window.testPad.buttons[0].pressed = false;
    });
    await page.screenshot({ path: shots + "/desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: shots + "/mobile.png", fullPage: true });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.goto(root + "/romm?theme=light");
    await page.locator(".game-card").waitFor();
    await page.screenshot({
      path: shots + "/mobile-light.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator(".game-card").click();
    await page.getByRole("button", { name: "Play / Resume" }).click();
    await page.waitForFunction(
      () => window.EJS_emulator?.started,
      {},
      { timeout: 30000 },
    );
    await page
      .getByRole("button", { name: "Save progress", exact: true })
      .click();
    await page
      .getByText("Saved to RomM", { exact: true })
      .waitFor({ timeout: 20000 });
    await page.screenshot({ path: shots + "/player-desktop.png" });
    // Verify the IDBFS database belongs to this connection and game.
    const isolated = await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      return dbs.some((db) =>
        db.name.startsWith("silo-romm-" + player.session.namespace + "-"),
      );
    });
    assert(isolated);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      window.testPad = {
        index: 0,
        id: "Silo Test Controller",
        mapping: "standard",
        connected: true,
        timestamp: performance.now(),
        buttons: Array.from({ length: 17 }, () => ({ pressed: false })),
        axes: [0, 0],
      };
      navigator.getGamepads = () => [window.testPad];
      window.testPad.buttons[12].pressed = true;
    });
    await page.waitForTimeout(60);
    await page.evaluate(() => {
      window.testPad.buttons[9].pressed = true;
    });
    await page.getByRole("dialog", { name: "Game paused" }).waitFor();
    await page.evaluate(() => {
      window.testPad.buttons[9].pressed = false;
      window.testPad.buttons[12].pressed = false;
    });
    await page.screenshot({ path: shots + "/player-mobile.png" });
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await page
      .getByRole("button", { name: "Save & exit", exact: true })
      .click();
    await page.locator(".game-card").waitFor();
    await page.locator(".game-card").click();
    await page.getByRole("button", { name: "Play / Resume" }).click();
    await page.waitForFunction(
      () => window.EJS_emulator?.started,
      {},
      { timeout: 30000 },
    );
    assert(await page.evaluate(() => !!window.EJS_loadStateURL));
    // Network loss preserves an outbox copy and retry clears it after an ack.
    await page.route("**/api/upload?*", (route) => route.abort());
    await page
      .getByRole("button", { name: "Save progress", exact: true })
      .click();
    await page
      .getByText("Progress saved on this device · Sync pending", {
        exact: true,
      })
      .waitFor();
    assert(
      await page.evaluate(
        async () => !!(await outbox("get", progressKey("states"))),
      ),
    );
    await page.unroute("**/api/upload?*");
    await page
      .getByRole("button", { name: "Save progress", exact: true })
      .click();
    await page.getByText("Saved to RomM", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        async () => !!(await outbox("get", progressKey("states"))),
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: browse, mobile/light layout, emulator boot, isolated storage, save, resume, failed-sync outbox and retry",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
