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
    await page.goto(root + "/romm#games");
    if (await page.locator("#romm-sign-in").count()) {
      await page.screenshot({
        path: shots + "/connect-desktop.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: shots + "/connect-mobile.png",
        fullPage: true,
      });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      async function startApproval() {
        const opened = page.waitForEvent("popup");
        await page
          .getByRole("button", { name: "Sign in to RomM", exact: true })
          .click();
        const popup = await opened;
        await popup
          .getByRole("button", { name: "Approve Silo Games" })
          .waitFor();
        return popup;
      }
      const cancelled = await startApproval();
      await page.screenshot({
        path: shots + "/approval-desktop.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: shots + "/approval-mobile.png",
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Cancel sign-in", exact: true })
        .click();
      await page.getByText("Sign-in cancelled. You can try again.").waitFor();
      await cancelled.close();
      const declined = await startApproval();
      await declined.getByRole("button", { name: "Decline access" }).click();
      await page
        .getByText("RomM access was declined. You can try again.")
        .waitFor();
      await declined.close();
      const approval = await startApproval();
      await approval
        .getByRole("button", { name: "Approve Silo Games" })
        .click();
      await page.locator(".game-card").waitFor();
      await approval.close();
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.locator(".game-card").waitFor();
    // Silo/proxies can return plain text or HTML instead of plugin JSON.
    // Retry must recover without a parser error or a stale error notice.
    for (const failure of [
      {
        status: 502,
        contentType: "text/plain",
        body: "plugin route failed\n",
        message: "Games is temporarily unavailable.",
      },
      {
        status: 504,
        contentType: "application/json",
        body: JSON.stringify({
          error: "The RomM server timed out. Please try again.",
        }),
        message: "The RomM server timed out.",
      },
    ]) {
      const { message, ...response } = failure;
      await page.route("**/api/games?*", (route) => route.fulfill(response));
      await page.reload();
      await page
        .getByRole("button", { name: "Try again", exact: true })
        .waitFor();
      assert((await page.locator("#notice").textContent()).includes(message));
      await page.unroute("**/api/games?*");
      await page
        .getByRole("button", { name: "Try again", exact: true })
        .click();
      await page.locator(".game-card").waitFor();
      assert(await page.locator("#notice").isHidden());
    }
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
    await page.locator("#game-heading").waitFor();
    await page.evaluate(() => {
      window.testPad.buttons[0].pressed = false;
    });
    await page.waitForTimeout(60);
    await page.evaluate(() => {
      window.testPad.buttons[1].pressed = true;
    });
    await page.locator(".game-card").waitFor();
    await page.evaluate(() => {
      window.testPad.buttons[1].pressed = false;
    });
    // A remains an independent edge while a direction is held. Native filters
    // expose a controller-operable choice dialog instead of relying on click().
    await page.locator("#sort").focus();
    await page.evaluate(() => {
      window.testPad.buttons[12].pressed = true;
    });
    await page.waitForTimeout(60);
    await page.locator("#sort").focus();
    await page.evaluate(() => {
      window.testPad.buttons[0].pressed = true;
    });
    await page.getByRole("dialog", { name: "Select sort" }).waitFor();
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
    assert.equal(await page.locator("#sort").inputValue(), "name-desc");
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
    await page.goto(root + "/romm?theme=light#games");
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
      "PASS: browser sign-in approval/cancel/decline, browse, mobile/light layout, emulator boot, isolated storage, save, resume, failed-sync outbox and retry",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
