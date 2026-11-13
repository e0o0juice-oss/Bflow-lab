const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { once } = require("node:events"),
  { chromium } = require("playwright"),
  { PDFDocument } = require("pdf-lib"),
  { createApp } = require("./server.cjs");
test(
  "board accepts photo and multipage storyboard PDF immediately after entry, with private downloads",
  { timeout: 60000 },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "color-direct-board-")),
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
        sc = await browser.newContext({
          viewport: { width: 390, height: 844 },
        }),
        pc = await browser.newContext(),
        oc = await browser.newContext();
      const h = await hc.newPage(),
        s = await sc.newPage(),
        peer = await pc.newPage(),
        other = await oc.newPage(),
        base =
          "http://127.0.0.1:" + app.server.address().port + "/color-studio/";
      await h.goto(base);
      await h.click("#create-room");
      await h.waitForSelector("#teacher-main");
      const code = await h.locator(".room-code").innerText();
      for (const [page, name, group] of [
        [s, "사진 작성자", "1"],
        [peer, "같은 조", "1"],
        [other, "다른 조", "2"],
      ]) {
        await page.goto(base + "?room=" + code);
        await page.fill("#join-name", name);
        await page.selectOption("#join-group", group);
        await page.click("#join-form button");
        await page.waitForSelector("#workbook.active");
        await page.click('.header [data-view="board"]');
        await page.waitForSelector("#gallery-upload-form");
      }
      const pdf = await PDFDocument.create();
      pdf.addPage().drawText("Storyboard page one");
      pdf.addPage().drawText("Storyboard page two");
      const pdfBytes = await pdf.save();
      const png = Buffer.from(
        await s.evaluate(() => {
          const canvas = document.createElement("canvas");
          canvas.width = 200;
          canvas.height = 100;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#df8b79";
          ctx.fillRect(0, 0, 200, 100);
          return canvas.toDataURL("image/png").split(",")[1];
        }),
        "base64",
      );
      await s.setInputFiles("#gallery-files", [
        { name: "color.png", mimeType: "image/png", buffer: png },
        {
          name: "스토리보드.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(pdfBytes),
        },
      ]);
      await s.click("#gallery-submit");
      await s.waitForFunction(() =>
        document
          .querySelector("#gallery-upload-status")
          .textContent.includes("2개 자료"),
      );
      await s.waitForSelector("#gallery-posts .post-card");
      assert.equal(await s.locator("#gallery-posts .post-card").count(), 2);
      await peer.waitForFunction(
        () =>
          document.querySelectorAll("#gallery-posts .post-card").length === 2,
      );
      await other.click("#gallery-refresh");
      await other.waitForFunction(() =>
        document
          .querySelector("#gallery-posts")
          .textContent.includes("아직 올라온 자료"),
      );
      assert.equal(await other.locator("#gallery-posts a").count(), 0);
      const downloaded = s.waitForEvent("download");
      await s
        .getByRole("link", {
          name: "PDF 내려받기 · 스토리보드.pdf",
          exact: true,
        })
        .click();
      const file = await downloaded;
      assert.equal(file.suggestedFilename(), "스토리보드.pdf");
      const saved = await PDFDocument.load(fs.readFileSync(await file.path()));
      assert.equal(saved.getPageCount(), 2);
      assert.equal(await s.locator("#style-file:visible").count(), 0);
      assert.equal(await s.locator("#gallery-submit:visible").count(), 1);
      assert(
        await s.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await s
        .locator("#gallery-posts .comment-form textarea")
        .first()
        .fill("스토리보드를 확인했어요.");
      await s.locator("#gallery-posts .comment-form button").first().click();
      await peer.waitForFunction(() =>
        document
          .querySelector("#gallery-posts")
          .textContent.includes("스토리보드를 확인했어요."),
      );
    } finally {
      await browser?.close();
      app.closeStreams();
      app.server.closeAllConnections();
      await new Promise((r) => app.server.close(r));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
