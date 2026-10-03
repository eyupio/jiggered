const assert = require("node:assert/strict");
const { runBrowser } = require("./support/browser.cjs");
runBrowser(
  {
    name: "accounts",
    username: "admin",
    password: "preview-password1",
    portEnv: "JIGGERED_ACCOUNTS_PORT",
  },
  async (harness) => {
    const { base, screenshot } = harness;
    const net = require("node:net");
    const mailMessages = [];
    const relay = harness.trackServer(
      net.createServer((conn) => {
        conn.setEncoding("utf8");
        conn.write("220 local SMTP\r\n");
        let buffer = "",
          data = false,
          body = "";
        conn.on("data", (chunk) => {
          buffer += chunk;
          let idx;
          while ((idx = buffer.indexOf("\r\n")) >= 0) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            if (data) {
              if (line === ".") {
                mailMessages.push(body);
                data = false;
                body = "";
                conn.write("250 queued\r\n");
              } else body += line + "\n";
              continue;
            }
            if (/^(EHLO|HELO|MAIL|RCPT)/.test(line)) conn.write("250 ok\r\n");
            else if (line === "DATA") {
              data = true;
              conn.write("354 data\r\n");
            } else if (line === "QUIT") {
              conn.end("221 bye\r\n");
            } else conn.write("500 no\r\n");
          }
        });
      }),
    );
    async function waitMail(kind) {
      for (let i = 0; i < 100; i++) {
        const index = mailMessages.findIndex((m) => m.includes("#" + kind + "="));
        if (index >= 0)
          return mailMessages.splice(index, 1)[0].match(new RegExp("#" + kind + "=([a-f0-9]+)"))[1];
        await new Promise((r) => setTimeout(r, 50));
      }
      throw Error("No " + kind + " email arrived");
    }

    await new Promise((resolve) => relay.listen(0, "127.0.0.1", resolve));
    const browser = await harness.launchBrowser();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/");
    await page.locator("#hero-title").waitFor();
    assert.equal(await page.locator("[data-register-link]").first().getAttribute("href"), "/login");
    assert.equal(await page.locator("#registration-status").textContent(), "REGISTRATION CLOSED");
    assert.match(
      await page.locator("[data-registration-copy]").first().textContent(),
      /currently closed/,
    );
    assert.equal(await page.locator("link[rel=canonical]").getAttribute("href"), base + "/welcome");
    await page.route("**/api/auth/options", (route) =>
      route.fulfill({ status: 503, body: "Unavailable" }),
    );
    await page.goto(base + "/welcome");
    await page
      .locator("#registration-status")
      .filter({ hasText: "SIGNUP AVAILABILITY UNKNOWN" })
      .waitFor();
    assert.match(
      await page.locator("[data-registration-copy]").first().textContent(),
      /couldn’t check/,
    );
    await page.unroute("**/api/auth/options");
    await page.goto(base + "/register");
    await page
      .locator("#auth-options-status")
      .filter({ hasText: "Registration is closed" })
      .waitFor();
    assert.equal(await page.locator("#register-form").isVisible(), false);
    await page.goto(base + "/login");
    await page.locator("#username").fill("admin");
    await page.locator("#password").fill("preview-password1");
    await page.locator("#signin-form [type=submit]").click();
    await page.locator("#t-admin").click();
    await page.locator("#admin-tab-email").click();
    await page.locator("#svc-status").filter({ hasText: "Paused" }).waitFor({ state: "attached" });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await screenshot(page, "admin-desktop.png");
    // Configure the local test relay and opt in to registration and recovery.

    await page.locator("#svc-mail-enabled").check();
    await page.locator("#svc-host").fill("127.0.0.1");
    await page.locator("#svc-port").fill(String(relay.address().port));
    await page.locator("#svc-tls").selectOption("none");
    await page.locator("#svc-from").fill("server@example.com");
    await page.locator("#svc-to").fill("admin@example.com");
    await page.locator("#svc-registration").check();
    await page.locator("#svc-recovery").check();
    await page.locator("#svc-public_url").fill(base);
    await page.locator("#svc-password").fill("preview-password1");
    await page.locator("#services-form [type=submit]").click();
    await page.locator("#svc-msg").filter({ hasText: "Configuration saved" }).waitFor();
    assert.equal(await page.locator("#svc-password").inputValue(), "");
    await page.locator("#svc-auth-status").filter({ hasText: "remembered until" }).waitFor();
    assert.equal(await page.locator("#svc-password").getAttribute("required"), null);
    const testEmail = page.locator('[data-service-action="test_email"]');
    await testEmail.click();
    await page.locator("#svc-msg").filter({ hasText: "Test email accepted" }).waitFor();
    assert(
      mailMessages.some((m) => m.includes("Jiggered test notification")),
      "SMTP relay received test email",
    );
    // Password input alone must never mark settings dirty; a rejected password clears the remembered value.
    await page.locator("#svc-password").fill("wrong-password");
    assert.equal(await testEmail.textContent(), "Send test email");
    await testEmail.click();
    await page.locator("#svc-msg").filter({ hasText: "isn't your current password" }).waitFor();
    await page.locator("#svc-password").fill("preview-password1");
    await testEmail.click();
    await page.locator("#svc-msg").filter({ hasText: "Test email accepted" }).waitFor();
    await page.locator("#svc-auth-status").filter({ hasText: "remembered until" }).waitFor();
    const expiryMessage = await page.locator("#svc-auth-status").textContent();
    // A changed setting is saved before sending; no second password entry is needed.
    await page.locator("#svc-from").fill("updated@example.com");
    assert.equal(await testEmail.textContent(), "Save & send test email");
    await testEmail.click();
    await page.locator("#svc-msg").filter({ hasText: "Test email accepted" }).waitFor();
    assert.equal(await testEmail.textContent(), "Send test email");
    assert(
      mailMessages.some(
        (m) =>
          m.includes('From: \"Jiggered\" <updated@example.com>') ||
          m.includes("From: Jiggered <updated@example.com>"),
      ),
      "test used the newly saved sender",
    );
    assert.equal(
      await page.locator("#svc-auth-status").textContent(),
      expiryMessage,
      "reuse does not extend the 30-minute window",
    );
    // Expiry is checked at use time, even if a background tab delayed the timer.
    await page.evaluate(() => {
      window.realNow = Date.now;
      Date.now = () => window.realNow() + 30 * 60 * 1000 + 1000;
    });
    await testEmail.click();
    await page.locator("#svc-msg").filter({ hasText: "Enter your admin password" }).waitFor();
    assert.notEqual(await page.locator("#svc-password").getAttribute("required"), null);
    await page.evaluate(() => {
      Date.now = window.realNow;
      delete window.realNow;
    });
    await page.locator("#svc-password").fill("preview-password1");
    await testEmail.click();
    await page.locator("#svc-msg").filter({ hasText: "Test email accepted" }).waitFor();
    // A failed save must not send a test against stale settings.
    const sentBefore = mailMessages.length;
    await page.locator("#svc-port").fill("0");
    await testEmail.click();
    await page.locator("#svc-msg.err").waitFor();
    assert.equal(mailMessages.length, sentBefore);
    await page.locator("#svc-port").fill(String(relay.address().port));
    await page.locator("#services-form [type=submit]").click();
    await page.locator("#svc-msg").filter({ hasText: "Configuration saved" }).waitFor();
    await page.reload();
    await page.locator("#t-admin").click();
    await page.locator("#admin-tab-email").click();
    await page
      .locator("#svc-auth-status")
      .filter({ hasText: "Enter your admin password" })
      .waitFor();
    await testEmail.click();
    await page.locator("#svc-msg").filter({ hasText: "Enter your admin password" }).waitFor();

    await page.locator("#t-account").click();
    await page.locator("#security-status").filter({ hasText: "Password only" }).waitFor();
    await page.locator("#security-password").fill("preview-password1");
    await page.locator("#security-start").click();
    await page.locator("#security-setup").waitFor();
    const secret = await page.locator("#security-secret").textContent();
    // Produce TOTP in the harness using the RFC counter and HMAC, independently of the Go implementation.
    function totp(secret) {
      const crypto = require("node:crypto"),
        alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
      let bits = "";
      for (const c of secret) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
      const key = Buffer.from(bits.match(/.{8}/g).map((x) => parseInt(x, 2)));
      const counter = Buffer.alloc(8);
      counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
      const h = crypto.createHmac("sha1", key).update(counter).digest(),
        o = h[19] & 15;
      return ((h.readUInt32BE(o) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
    }
    await page.locator("#security-password").fill("preview-password1");
    await page.locator("#security-code").fill(totp(secret));
    await page.locator("#security-enable").click();
    await page.locator("#security-recovery").waitFor();
    const codes = await page.locator("#security-codes code").allTextContents();
    assert.equal(codes.length, 10);
    await screenshot(page, "account-security-desktop.png");
    await context.clearCookies();
    await page.goto(base + "/login");
    await page.locator("#username").fill("admin");
    await page.locator("#password").fill("preview-password1");
    await page.locator("#signin-form [type=submit]").click();
    await page.locator("#two-step-form").waitFor();
    await page.locator("#two-step-code").fill(codes[0]);
    await page.locator("#two-step-form [type=submit]").click();
    await page.locator("#t-admin").waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#t-admin").click();
    await page.locator("#admin-tab-backups").click();
    await page.locator("#svc-status").waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      "mobile admin overflow",
    );
    await screenshot(page, "admin-mobile.png");
    await page.locator("#t-account").click();
    await page.locator("#security-panel").scrollIntoViewIfNeeded();
    await screenshot(page, "account-security-mobile.png");
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      "mobile account overflow",
    );
    // Exercise signup, verification, recovery and new-password sign-in through real forms and a local relay.
    const adminCookies = await context.cookies();
    await page.close();
    await context.clearCookies();
    const visitor = context,
      join = await visitor.newPage();
    await join.setViewportSize({ width: 320, height: 780 });
    join.on("pageerror", (e) => errors.push(e.message));
    await join.goto(base + "/");
    await join
      .locator("#registration-status")
      .filter({ hasText: "OPEN FOR REGISTRATION" })
      .waitFor();
    assert.match(
      await join.locator("[data-registration-copy]").first().textContent(),
      /Free accounts are available/,
    );
    assert.equal(
      await join.locator("[data-register-link]").last().getAttribute("href"),
      "/register",
    );
    assert.equal(
      await join.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      "mobile landing overflow",
    );
    await screenshot(join, "open-registration-landing-mobile.png");
    await join.locator("[data-register-link]").first().click();
    await join.locator("#register-form").waitFor();
    await join.locator("#register-name").fill("newmember");
    await join.locator("#register-email").fill("member@example.com");
    await join.locator("#register-password").fill("member-password1");
    await join.locator("#register-confirm").fill("different-password1");
    await join.locator("#register-form [type=submit]").click();
    await join.locator("#register-msg").filter({ hasText: "passwords do not match" }).waitFor();
    await join.locator("[aria-controls=register-password]").click();
    assert.equal(await join.locator("#register-password").getAttribute("type"), "text");
    await join.locator("[aria-controls=register-password]").click();
    await join.locator("#register-confirm").fill("member-password1");
    await screenshot(join, "registration-mobile.png");
    assert.equal(
      await join.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await join.locator("#register-form [type=submit]").click();
    await join.locator("#register-msg").filter({ hasText: "an email will arrive" }).waitFor();
    const verify = await waitMail("verify");
    await join.goto(base + "/login#verify=" + verify);
    await join.locator("#verify-form").waitFor();
    assert.equal(
      await join.evaluate(() => location.hash),
      "",
      "verification token removed from address bar",
    );
    await join.locator("#verify-form [type=submit]").click();
    await join.locator("#verify-msg").filter({ hasText: "Email verified" }).waitFor();
    await join.locator("#verify-form [data-signin]").click();
    await join.locator("#username").fill("newmember");
    await join.locator("#password").fill("member-password1");
    await join.locator("#signin-form [type=submit]").click();
    await join.locator("#t-account").waitFor();
    assert.equal(await join.locator("#t-admin").count(), 0);
    await visitor.clearCookies();
    await join.goto(base + "/login");
    await join.locator("#open-forgot").click();
    await join.locator("#forgot-email").fill("member@example.com");
    await join.locator("#forgot-form [type=submit]").click();
    const reset = await waitMail("reset");
    await join.goto(base + "/login#reset=" + reset);
    await join.locator("#reset-password").fill("replacement-password1");
    await join.locator("#reset-confirm").fill("replacement-password1");
    await join.locator("#reset-form [type=submit]").click();
    await join.locator("#reset-msg").filter({ hasText: "Password changed" }).waitFor();
    await join.locator("#reset-form [data-signin]").click();
    await join.locator("#username").fill("newmember");
    await join.locator("#password").fill("replacement-password1");
    await join.locator("#signin-form [type=submit]").click();
    await join.locator("#t-account").waitFor();
    // Readiness-aware support actions are enabled only for protected accounts.
    await join.locator("#security-panel").waitFor({ state: "attached" });
    await join.locator("#t-account").click();
    await join.locator("#security-status").filter({ hasText: "Password only" }).waitFor();
    await join.locator("#security-password").fill("replacement-password1");
    await join.locator("#security-start").click();
    await join.locator("#security-setup").waitFor();
    const memberSecret = await join.locator("#security-secret").textContent();
    await join.locator("#security-password").fill("replacement-password1");
    await join.locator("#security-code").fill(totp(memberSecret));
    await join.locator("#security-enable").click();
    await join.locator("#security-recovery").waitFor();
    const memberCookies = await context.cookies();
    await join.close();
    await context.clearCookies();
    await context.addCookies(adminCookies);
    const manage = await context.newPage();
    await manage.goto(base + "/");
    await manage.locator("#t-admin").click();
    await manage.locator('[data-name="newmember"] .admin-user-actions summary').click();
    await manage.locator('[data-name="newmember"] [data-act="two-factor-reset"]').click();
    await manage.locator("#factor-reset-dialog").waitFor();
    await manage.locator("#factor-reset-password").fill("preview-password1");
    await manage.locator("#factor-reset-code").fill(codes[1]);
    await manage.locator("#factor-reset-form [type=submit]").click();
    await manage.locator("#factor-reset-dialog").waitFor({ state: "hidden" });
    assert.equal(
      (
        await fetch(base + "/api/me", {
          headers: { Cookie: memberCookies.map((c) => c.name + "=" + c.value).join("; ") },
        })
      ).status,
      401,
      "admin reset revoked user sessions",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: configuration, enrollment, 2FA sign-in, signup, email verification, password recovery, admin reset and mobile layout.",
    );
  },
).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
