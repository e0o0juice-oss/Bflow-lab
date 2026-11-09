"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { execFileSync } = require("node:child_process"),
  { chromium } = require("playwright"),
  { createApp } = require("./server.cjs");
test(
  "student downloads a designed PDF with own image, feedback and saved reflection",
  { timeout: 90000 },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "color-report-browser-")),
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
        pc = await browser.newContext();
      const host = await hc.newPage(),
        student = await sc.newPage(),
        peer = await pc.newPage(),
        errors = [];
      student.on("pageerror", (e) => errors.push(e.message));
      const base =
        "http://127.0.0.1:" + app.server.address().port + "/color-studio/";
      await host.goto(base);
      await host.click("#create-room");
      await host.waitForSelector("#teacher-main");
      const code = await host.locator(".room-code").innerText();
      for (const [p, name] of [
        [student, "하늘"],
        [peer, "피드백작성자이름비공개"],
      ]) {
        await p.goto(base + "?room=" + code);
        await p.fill("#join-name", name);
        await p.selectOption("#join-group", "2");
        await p.click("#join-form button");
        await p.waitForSelector("#workbook.active");
      }
      await student.click('[data-tab="favorite"]');
      for (const i of [0, 3, 5])
        await student.locator("#favorite-colors button").nth(i).click();
      await student.click("#finish-favorite");
      await student.click('[data-tab="concepts"]');
      await student.locator('[data-concept="hue"] button').nth(2).click();
      await student.locator('[data-concept="chroma"] button').first().click();
      await student.locator('[data-concept="tone"] button').first().click();
      await student.fill(
        "#concept-reason",
        "밝은 색과 선명한 색이 다르다는 것을 알았어요.",
      );
      await host.locator('[data-answer-question="chroma"]').click();
      await student.click('[data-tab="demo"]');
      await student.fill(
        "#conditions",
        "실내 간접광, 같은 자리에서 화장을 유지하고 비교했어요.",
      );
      await student.click('[data-tab="observe"]');
      await student.locator("#self-options button").first().click();
      await student.locator("#peer-options button").nth(1).click();
      await student.fill(
        "#self-note",
        "코랄을 댔을 때 입가 그림자가 덜 보이고 얼굴이 균일해 보였어요.",
      );
      await student.fill(
        "#peer-note",
        "조원은 다른 색에서 윤곽이 또렷해 보인다고 했어요. 같은 조명에서 다시 비교하고 싶어요.",
      );
      await student.click("#next-family");
      await student.locator("#self-options button").first().click();
      await student.fill(
        "#self-note",
        "연한 핑크에서 얼굴이 편안하게 느껴졌어요.",
      );
      await host.click("#board-toggle");
      await student.click('[data-tab="style"]');
      await student.locator('#image-words button:text-is("차분한")').click();
      await student.locator('#image-words button:text-is("세련된")').click();
      await student
        .locator('#image-combinations button:text-is("시원하고 부드러운")')
        .click();
      await student.fill(
        "#image-note",
        "차분한 블루 셔츠에 아이보리 팬츠를 입고 작은 코랄 소품을 더해보고 싶어요.",
      );
      await student.waitForSelector("#board-form");
      const png = Buffer.from(
        await student.evaluate(() => {
          const canvas = document.createElement("canvas");
          canvas.width = 1000;
          canvas.height = 750;
          const c = canvas.getContext("2d");
          c.fillStyle = "#f5f5f7";
          c.fillRect(0, 0, 1000, 750);
          c.fillStyle = "#86868b";
          c.font = "20px sans-serif";
          c.fillText("MY STYLE / LOOK 01", 58, 64);
          c.fillStyle = "#829eb9";
          c.beginPath();
          c.moveTo(220, 170);
          c.lineTo(140, 190);
          c.lineTo(85, 335);
          c.lineTo(165, 362);
          c.lineTo(205, 280);
          c.lineTo(205, 535);
          c.quadraticCurveTo(340, 560, 475, 535);
          c.lineTo(475, 280);
          c.lineTo(515, 362);
          c.lineTo(595, 335);
          c.lineTo(540, 190);
          c.lineTo(460, 170);
          c.closePath();
          c.fill();
          c.strokeStyle = "#6082a0";
          c.lineWidth = 3;
          c.beginPath();
          c.moveTo(340, 205);
          c.lineTo(340, 535);
          c.stroke();
          c.fillStyle = "#fff";
          c.beginPath();
          c.moveTo(295, 155);
          c.lineTo(340, 205);
          c.lineTo(385, 155);
          c.lineTo(460, 170);
          c.lineTo(380, 250);
          c.lineTo(340, 205);
          c.lineTo(300, 250);
          c.lineTo(220, 170);
          c.closePath();
          c.fill();
          c.fillStyle = "#e7dfca";
          c.beginPath();
          c.moveTo(650, 200);
          c.lineTo(870, 200);
          c.lineTo(900, 620);
          c.lineTo(800, 620);
          c.lineTo(760, 375);
          c.lineTo(720, 620);
          c.lineTo(620, 620);
          c.closePath();
          c.fill();
          c.strokeStyle = "#cbbfa5";
          c.beginPath();
          c.moveTo(760, 200);
          c.lineTo(760, 375);
          c.stroke();
          c.fillStyle = "#1d1d1f";
          c.font = "25px sans-serif";
          c.fillText("BLUE + IVORY", 60, 690);
          return canvas.toDataURL("image/png").split(",")[1];
        }),
        "base64",
      );
      await student.setInputFiles("#style-file", {
        name: "my-style.png",
        mimeType: "image/png",
        buffer: png,
      });
      await student.waitForSelector("#upload-preview:visible");
      await student.fill(
        "#style-reason",
        "블루와 아이보리의 부드러운 대비가 좋아서 골랐어요.",
      );
      await student.click("#upload-style");
      await student.waitForSelector(".post-card");
      await peer.click('[data-tab="style"]');
      await peer.waitForSelector(".post-card");
      await peer
        .locator(".comment-form textarea")
        .fill(
          "아이보리와 블루의 차분한 느낌이 좋아요. 코랄 가방을 더해보면 어떨까요?",
        );
      await peer.locator(".comment-form button").click();
      await peer.waitForSelector(".comments p");
      await peer.fill("#style-reason", "다른학생게시물제외문구");
      await peer.click("#upload-style");
      await peer.waitForFunction(
        () => document.querySelectorAll(".post-card").length === 2,
      );
      await student.click('[data-tab="summary"]');
      await student.fill(
        "#reflection-favoriteReason",
        "바다를 좋아해서 블루를 고르고, 따뜻한 코랄도 함께 골랐어요.",
      );
      await student.fill(
        "#reflection-discovery",
        "좋아하는 색과 얼굴 가까이에서 편안하게 보이는 색은 다를 수 있었어요. 조원의 다른 관찰도 도움이 됐어요.",
      );
      await student.fill(
        "#reflection-nextTry",
        "다음에는 블루 셔츠와 아이보리 팬츠를 입고, 오늘 고른 코랄색 소품을 더해볼 거예요.",
      );
      await student.waitForFunction(() =>
        document
          .querySelector("#save-status")
          .textContent.includes("서버에 저장됨"),
      );
      await student.reload();
      await student.waitForSelector("#workbook.active");
      await student.click('[data-tab="summary"]');
      assert.match(
        await student.inputValue("#reflection-nextTry"),
        /블루 셔츠/,
      );
      const downloaded = student.waitForEvent("download", { timeout: 60000 });
      await student.click("#download-pdf");
      const file = await downloaded;
      assert.equal(file.suggestedFilename(), "나의-컬러-노트.pdf");
      const output =
        process.env.COLOR_REPORT_ARTIFACTS ||
        path.join(os.tmpdir(), "color-report-output");
      fs.mkdirSync(output, { recursive: true });
      const pdfFile = path.join(output, "나의-컬러-노트-예시.pdf");
      await file.saveAs(pdfFile);
      await student.waitForFunction(() =>
        document
          .querySelector("#pdf-status")
          .textContent.includes("PDF를 만들었어요"),
      );
      const text = execFileSync("pdftotext", [pdfFile, "-"], {
        encoding: "utf8",
      }).replace(/\s/g, "");
      for (const word of [
        "입가그림자가덜보이고",
        "블루와아이보리의부드러운대비",
        "코랄가방을더해보면어떨까요?",
        "다음에는블루셔츠와아이보리팬츠",
      ])
        assert(text.includes(word), word);
      assert(!text.includes("다른학생게시물제외문구"));
      assert(!text.includes("피드백작성자이름비공개"));
      assert.equal(fs.readFileSync(pdfFile).subarray(0, 4).toString(), "%PDF");
      let extraDownloads = 0;
      student.on("download", () => extraDownloads++);
      await student.route("**/color-studio/api/r/*/board/*/image", (route) =>
        route.abort(),
      );
      await student.click("#download-pdf");
      await student.waitForFunction(() =>
        document
          .querySelector("#pdf-status")
          .textContent.includes("PDF 저장을 중단"),
      );
      assert.equal(
        extraDownloads,
        0,
        "missing images must not silently produce an incomplete PDF",
      );
      assert.deepEqual(errors, []);
      assert(
        await student.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await student.screenshot({
        path: path.join(output, "save-screen.png"),
        fullPage: true,
      });
      console.log("Report example: " + pdfFile);
    } finally {
      await browser?.close();
      app.closeStreams();
      app.server.closeAllConnections();
      await new Promise((r) => app.server.close(r));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
