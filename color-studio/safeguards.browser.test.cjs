const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { once } = require("node:events"),
  { chromium } = require("playwright"),
  { createApp } = require("./server.cjs");
test(
  "instructor group correction, one-click timer, live gallery and recovery in a second browser",
  { timeout: 60000 },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "color-safeguards-ui-")),
      app = createApp({ dataDir: dir });
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
    let browser;
    try {
      browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
        headless: true,
        args: ["--no-sandbox"],
      });
      const hc = await browser.newContext(),
        mc = await browser.newContext({
          viewport: { width: 390, height: 844 },
        }),
        pc = await browser.newContext(),
        rc = await browser.newContext();
      const h = await hc.newPage(),
        m = await mc.newPage(),
        peer = await pc.newPage(),
        recovered = await rc.newPage(),
        base =
          "http://127.0.0.1:" + app.server.address().port + "/color-studio/";
      await h.goto(base);
      await h.click("#create-room");
      await h.waitForSelector("#teacher-main");
      const code = await h.locator(".room-code").innerText();
      await m.goto(base + "?room=" + code);
      await m.fill("#join-name", "조 정정");
      await m.selectOption("#join-group", "1");
      await m.click("#join-form button");
      await m.waitForSelector("#workbook.active");
      await h.getByLabel("조 정정 조 수정", { exact: true }).selectOption("2");
      await m.waitForFunction(
        () => document.querySelector("#group").value === "2조",
      );
      const request = async (page, route, data) =>
        page.evaluate(
          async ({ route, data, code }) => {
            const r = await fetch("/color-studio/api/r/" + code + "/" + route, {
              method: data ? "POST" : "GET",
              headers: { "Content-Type": "application/json" },
              body: data ? JSON.stringify(data) : undefined,
            });
            return { status: r.status, data: await r.json() };
          },
          { route, data, code },
        );
      assert.equal(
        (await request(h, "control", { action: "stage", stage: 2 })).data
          .boardOpen,
        true,
      );
      await h.click("#active-toggle");
      let state = await request(h, "host");
      assert(state.data.active);
      assert(state.data.timer.endsAt);
      await h.click("#active-toggle");
      state = await request(h, "host");
      assert.equal(state.data.timer.endsAt, null);
      await m.click('.header [data-view="board"]');
      await m.waitForSelector("#board.active");
      await peer.goto(base + "?room=" + code);
      await peer.fill("#join-name", "자료 작성자");
      await peer.selectOption("#join-group", "2");
      await peer.click("#join-form button");
      await peer.waitForSelector("#workbook.active");
      assert.equal(
        (
          await request(peer, "board", {
            reason: "자동 갱신 자료",
            words: [],
            consent: false,
            writeId: "gallery-live",
          })
        ).status,
        201,
      );
      await m.waitForFunction(() =>
        document
          .querySelector("#gallery-posts")
          .textContent.includes("자동 갱신 자료"),
      );
      assert.equal(
        await m.locator("#board input, #board textarea, #board form").count(),
        0,
      );
      await m.click("#gallery-write");
      await m.waitForSelector("#style-board #board-form");
      await h
        .getByText("수업 전 확인 · 강사 권한 복구", { exact: true })
        .click();
      const dl = h.waitForEvent("download");
      await h
        .getByRole("button", {
          name: "강사 복구 코드 발급 · 파일 저장",
          exact: true,
        })
        .click();
      const file = await dl,
        filePath = await file.path();
      const secret = fs
        .readFileSync(filePath, "utf8")
        .match(/강사 복구 코드: ([a-f0-9]{32})/)[1];
      await recovered.goto(base);
      await recovered
        .getByText("강사 권한 복구 · 다른 브라우저에서 이어 진행하기", {
          exact: true,
        })
        .click();
      await recovered.fill("#recover-room", code);
      await recovered.fill("#recover-secret", secret);
      await recovered.click("#recover-host-form button");
      await recovered.waitForSelector("#teacher-main");
      assert.equal((await request(recovered, "host")).status, 200);
      assert.equal((await request(h, "host")).status, 403);
      let confirmations = 0;
      recovered.on("dialog", async (dialog) => {
        confirmations++;
        await dialog.accept();
      });
      const ended = recovered.waitForResponse(
        (response) =>
          response.url().endsWith("/control") &&
          response.request().method() === "POST",
      );
      await recovered
        .getByRole("button", { name: "수업 종료", exact: true })
        .click();
      assert.equal((await (await ended).json()).ended, true);
      assert.equal(confirmations, 1);
    } finally {
      await browser?.close();
      app.closeStreams();
      app.server.closeAllConnections();
      await new Promise((r) => app.server.close(r));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
