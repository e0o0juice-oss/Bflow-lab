const { test } = require("node:test"),
  { once } = require("node:events"),
  os = require("node:os"),
  path = require("node:path");
const { createApp } = require("./server.cjs");
const { chromium } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs");
test(
  "live workshop: independent browsers, offline recovery, board privacy and presentation consent",
  { timeout: 90000 },
  async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "color-browser-"));
    const app = createApp({ dataDir });
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
    const port = app.server.address().port;
    let browser;
    try {
      browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
        headless: true,
        args: ["--no-sandbox"],
      });
      const hc = await browser.newContext({
          viewport: { width: 1440, height: 1050 },
        }),
        ac = await browser.newContext({
          viewport: { width: 390, height: 844 },
        }),
        bc = await browser.newContext({
          viewport: { width: 390, height: 844 },
        }),
        oc = await browser.newContext({
          viewport: { width: 390, height: 844 },
        });
      const host = await hc.newPage(),
        a = await ac.newPage(),
        b = await bc.newPage(),
        other = await oc.newPage(),
        errors = [];
      for (const p of [host, a, b, other])
        p.on("pageerror", (e) => errors.push(e.message));
      const artifactDir =
        process.env.COLOR_TEST_ARTIFACTS ||
        path.join(os.tmpdir(), "color-studio-review");
      fs.mkdirSync(artifactDir, { recursive: true });
      const base = "http://127.0.0.1:" + port + "/color-studio/";
      await host.goto(base);
      await host.click("#create-room");
      await host.waitForSelector("#teacher-main");
      const code = await host.locator(".room-code").innerText();
      await host
        .locator("#join-qr")
        .screenshot({ path: path.join(artifactDir, "join-qr.png") });
      fs.writeFileSync(
        path.join(artifactDir, "qr-target.txt"),
        await host.inputValue("#join-link"),
      );
      for (const [page, name, group] of [
        [a, "하늘", 1],
        [b, "나무", 1],
        [other, "다른 조", 2],
      ]) {
        await page.goto(base + "?room=" + code);
        await page.fill("#join-name", name);
        await page.selectOption("#join-group", String(group));
        await page.click("#join-form button");
        await page.waitForSelector("#workbook.active");
      }
      await a.click('[data-tab="favorite"]');
      assert.equal(await a.locator("#favorite-colors button").count(), 50);
      for (const i of [0, 18, 49])
        await a.locator("#favorite-colors button").nth(i).click();
      assert.doesNotMatch(
        await a.locator("#tab-favorite").innerText(),
        /캐릭터|모자|상의|하의|코디/,
      );
      assert.equal(await a.locator("#finish-favorite").innerText(), "완료");
      assert.equal(await a.locator("#character-result").isVisible(), false);
      await a.click("#finish-favorite");
      await a.waitForSelector("#character-result:visible");
      await a.click('[data-tab="observe"]');
      await a.fill("#self-note", "입가의 그림자가 덜 보여요.");
      await a.click('#self-options button:text-is("예시 A")');
      await a.click('#peer-options button:text-is("예시 B")');
      await a.click('#peer-options button:text-is("잘 모르겠어요")');
      await a.waitForFunction(() =>
        document
          .querySelector("#save-status")
          .textContent.includes("서버에 저장됨"),
      );
      await a.focus("#self-note");
      await a.fill("#self-note", "입력 중인 내용 유지");
      await host.locator("#teacher-stage-list button").nth(2).click();
      await a.waitForSelector("#activity-banner.stage-pending");
      assert.equal(await a.inputValue("#self-note"), "입력 중인 내용 유지");
      await a.click("#activity-banner button");
      await a.waitForSelector("#tab-concepts.active");
      await a.locator('.sort-row button:text-is("위로")').nth(1).click();
      await a.fill("#concept-reason", "밝기와 선명함은 달랐어요.");
      await a.waitForFunction(() =>
        document
          .querySelector("#save-status")
          .textContent.includes("서버에 저장됨"),
      );
      await host.click("#sync-toggle");
      await a.click('[data-tab="observe"]');
      await host.locator("#teacher-stage-list button").nth(7).click();
      await a.waitForTimeout(300);
      assert.equal(
        await a.locator("#tab-observe").getAttribute("class"),
        "tab active",
      );
      await a.reload();
      await a.waitForSelector("#workbook.active");
      await a.click('[data-tab="observe"]');
      assert.equal(await a.inputValue("#self-note"), "입력 중인 내용 유지");
      await ac.setOffline(true);
      await a.fill("#self-note", "오프라인에서도 기록 유지");
      await a.waitForTimeout(700);
      await ac.setOffline(false);
      await a.waitForFunction(
        () =>
          document
            .querySelector("#save-status")
            .textContent.includes("서버에 저장됨"),
        { timeout: 15000 },
      );
      await a.reload();
      await a.waitForSelector("#workbook.active");
      await a.click('[data-tab="observe"]');
      assert.equal(
        await a.inputValue("#self-note"),
        "오프라인에서도 기록 유지",
      );
      await a.evaluate(() => navigator.serviceWorker.ready);
      await ac.setOffline(true);
      await a.reload();
      await a.waitForSelector("#workbook.active");
      await a.click('[data-tab="observe"]');
      assert.equal(
        await a.inputValue("#self-note"),
        "오프라인에서도 기록 유지",
      );
      await a.fill("#self-note", "오프라인 새로고침 후에도 유지");
      await ac.setOffline(false);
      await a.waitForFunction(() =>
        document
          .querySelector("#save-status")
          .textContent.includes("서버에 저장됨"),
      );
      await host.fill("#timer-minutes", "1");
      await host.click('button:text-is("분으로 설정")');
      await host.click('.teacher-timer button:text-is("시작")');
      await host.waitForFunction(
        () => {
          const text = document.querySelector(
            ".teacher-timer>.live-time",
          ).textContent;
          return text.startsWith("00:") && Number(text.slice(3)) < 60;
        },
        { timeout: 6000 },
      );
      await host.click('.teacher-timer button:text-is("일시정지")');
      const paused = await host
        .locator(".teacher-timer>.live-time")
        .innerText();
      await host.waitForTimeout(1200);
      assert.equal(
        await host.locator(".teacher-timer>.live-time").innerText(),
        paused,
      );
      await host.click("#board-toggle");
      await a.click('[data-tab="style"]');
      await a.waitForSelector("#board-form");
      await a.locator("#image-words button").first().click();
      const png = Buffer.from(
        await a.evaluate(() => {
          const c = document.createElement("canvas");
          c.width = 100;
          c.height = 100;
          const x = c.getContext("2d");
          x.fillStyle = "#829eb9";
          x.fillRect(0, 0, 100, 100);
          return c.toDataURL("image/png").split(",")[1];
        }),
        "base64",
      );
      await a.setInputFiles("#style-file", {
        name: "style.png",
        mimeType: "image/png",
        buffer: png,
      });
      await a.waitForSelector("#upload-preview:visible");
      await a.fill("#style-reason", "이 블루에 아이보리를 더하고 싶어요.");
      await a.click("#upload-style");
      await a.waitForSelector(".post-card");
      await b.click('[data-tab="style"]');
      await b.waitForSelector(".post-card");
      await b.locator(".comment-form textarea").fill("차분한 느낌이 좋아요.");
      await b.locator(".comment-form button").click();
      await b.waitForSelector(".comments p");
      await other.click('[data-tab="style"]');
      await other.waitForSelector("#board-form");
      assert.equal(await other.locator(".post-card").count(), 0);
      const proj = await hc.newPage();
      proj.on("pageerror", (e) => errors.push(e.message));
      await proj.goto(base + "?room=" + code + "&view=presentation");
      await proj.waitForSelector(".presentation-mode");
      await proj.setViewportSize({ width: 1280, height: 720 });
      assert(
        await proj.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight + 1,
        ),
        "projector must fit 720p",
      );
      assert.equal(await proj.locator("#presentation-post").isVisible(), false);
      await a.locator(".post-card .consent-label input").check();
      await host
        .locator('details summary:text-is("스타일 게시판 · 발표 공개 관리")')
        .click();
      await host.waitForSelector("#host-posts .post-card");
      await host
        .locator('#host-posts .post-card button:text-is("발표 화면에 띄우기")')
        .click();
      await proj.waitForSelector("#presentation-post:visible");
      await a.locator(".post-card .consent-label input").uncheck();
      await proj.waitForSelector("#presentation-post", { state: "hidden" });
      await a.click('[data-tab="summary"]');
      await a.waitForFunction(() =>
        document
          .querySelector("#summary-content")
          .textContent.includes("차분한 느낌이 좋아요."),
      );
      const download = a.waitForEvent("download");
      await a.click("#download-notes");
      assert.match((await download).suggestedFilename(), /컬러/);
      await a.waitForTimeout(4600);
      await host.screenshot({
        path: artifactDir + "/live-teacher.png",
        fullPage: true,
      });
      await proj.screenshot({
        path: artifactDir + "/live-presentation.png",
        fullPage: true,
      });
      await a.click('[data-tab="observe"]');
      await a.screenshot({
        path: artifactDir + "/live-mobile.png",
        fullPage: true,
      });
      await host.goto(base);
      await host.click('.header [data-view="home"]');
      await a.waitForTimeout(4600);
      await host.screenshot({
        path: artifactDir + "/live-home.png",
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      console.log(
        "PASS: three independent participant browsers + teacher + projection; favorite reveal; in-progress sync preservation; free navigation; server/reload persistence; offline recovery; image conversion/upload; same-group comments; other-group exclusion; consent/revocation; feedback export.",
      );
    } finally {
      await browser?.close();
      app.closeStreams();
      app.server.closeAllConnections();
      await new Promise((r) => app.server.close(r));
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);

test(
  "editable kit, mobile layouts, and all 23 slides fit a 720p projector",
  { timeout: 60000 },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "color-layout-")),
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
      const context = await browser.newContext(),
        host = await context.newPage();
      const base =
        "http://127.0.0.1:" + app.server.address().port + "/color-studio/";
      await host.goto(base);
      await host.click("#create-room");
      await host.waitForSelector("#teacher-main");
      const code = await host.locator(".room-code").innerText();
      await host.click("#settings-panel summary");
      await host
        .locator(".settings-step input")
        .nth(0)
        .fill("첫 만남과 좋아하는 색");
      await host.locator(".settings-step input").nth(1).fill("12");
      await host.locator(".settings-season input").nth(0).fill("내가 정한 봄");
      await host
        .locator(".kit-family")
        .first()
        .locator('button:text-is("비교색 추가")')
        .click();
      assert.equal(
        await host.locator(".kit-family").first().locator(".kit-chip").count(),
        5,
      );
      await host
        .locator(".kit-family")
        .first()
        .locator(".kit-chip")
        .last()
        .locator("input:not([type=color])")
        .fill("실물 07");
      await host.locator("#settings-content .consent-label input").check();
      await host.click('#settings-content button:text-is("수업 설정 저장")');
      await host.waitForFunction(
        () =>
          room.config.kitConfirmed &&
          room.config.families[0].colors.length === 5,
      );
      assert.equal(
        await host.locator(".settings-total").textContent(),
        "총 182분",
      );
      await host.reload();
      await host.waitForSelector("#teacher-main");
      await host.click("#settings-panel summary");
      assert.equal(
        await host.locator(".settings-season input").first().inputValue(),
        "내가 정한 봄",
      );
      await host.setViewportSize({ width: 360, height: 844 });
      assert(
        await host.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "teacher settings mobile overflow",
      );
      const studentContext = await browser.newContext({
          viewport: { width: 360, height: 844 },
        }),
        student = await studentContext.newPage();
      await student.goto(base + "?room=" + code);
      await student.fill("#join-name", "모바일");
      await student.click("#join-form button");
      await student.waitForSelector("#workbook.active");
      for (const name of [
        "favorite",
        "basics",
        "concepts",
        "demo",
        "roles",
        "observe",
        "break",
        "style",
        "summary",
      ]) {
        await student.click('[data-tab="' + name + '"]');
        assert(
          await student.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          name + " mobile overflow",
        );
      }
      await student.click('[data-tab="observe"]');
      assert.equal(await student.locator("#observe-swatches>div").count(), 5);
      assert.match(
        await student.locator(".example-label").innerText(),
        /실물 키트 기준/,
      );
      const proj = await context.newPage({
        viewport: { width: 1280, height: 720 },
      });
      await proj.setViewportSize({ width: 1280, height: 720 });
      await proj.goto(base + "?room=" + code + "&view=presentation");
      await proj.waitForSelector(".presentation-mode");
      const { slides } = require("./content.js");
      for (let stage = 0; stage < slides.length; stage++) {
        await host.evaluate((stage) => control("stage", { stage }), stage);
        for (let slide = 0; slide < slides[stage].length; slide++) {
          await host.evaluate((slide) => control("slide", { slide }), slide);
          await proj.waitForFunction(
            ([stage, slide]) => room.stage === stage && room.slide === slide,
            [stage, slide],
          );
          assert(
            await proj.evaluate(
              () =>
                document.documentElement.scrollWidth <= innerWidth &&
                document.documentElement.scrollHeight <= innerHeight + 1,
            ),
            "projector overflow " + stage + "/" + slide,
          );
        }
      }
    } finally {
      await browser?.close();
      app.closeStreams();
      app.server.closeAllConnections();
      await new Promise((r) => app.server.close(r));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "instructor answer reveal reaches students and projection without disturbing written answers",
  { timeout: 60000 },
  async () => {
    const dataDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "color-reveal-browser-"),
      ),
      app = createApp({ dataDir });
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
        host = await hc.newPage(),
        student = await sc.newPage(),
        errors = [];
      for (const p of [host, student])
        p.on("pageerror", (e) => errors.push(e.message));
      const base =
        "http://127.0.0.1:" + app.server.address().port + "/color-studio/";
      await host.goto(base);
      await host.click("#create-room");
      await host.waitForSelector("#teacher-main");
      const code = await host.locator(".room-code").innerText();
      await host.locator("#teacher-stage-list button").nth(2).click();
      await student.goto(base + "?room=" + code);
      await student.fill("#join-name", "학생");
      await student.click("#join-form button");
      await student.waitForSelector("#tab-concepts.active");
      assert.deepEqual(
        await student
          .locator('[data-concept="chroma"] .choice-row button')
          .allTextContents(),
        ["A", "B", "잘 모르겠다"],
      );
      assert.deepEqual(
        await student
          .locator('[data-concept="tone"] .choice-row button')
          .allTextContents(),
        ["A", "B", "잘 모르겠다"],
      );
      assert.equal(
        await student.locator('button:text-is("차이 살펴보기")').count(),
        0,
      );
      assert.equal(await student.locator(".concept-answer:visible").count(), 0);
      assert.equal(await student.locator("[data-answer-question]").count(), 0);
      await student
        .locator('[data-concept="chroma"] .choice-row button')
        .nth(1)
        .click();
      await student.fill("#concept-reason", "B가 차분하게 느껴져요.");
      await host.locator('[data-answer-question="chroma"]').click();
      await student.waitForSelector(
        '[data-concept="chroma"] .concept-answer:visible',
      );
      assert.match(
        await student
          .locator('[data-concept="chroma"] .concept-answer')
          .innerText(),
        /정답 · A/,
      );
      assert.equal(await student.locator(".concept-answer:visible").count(), 1);
      assert.equal(
        await student.inputValue("#concept-reason"),
        "B가 차분하게 느껴져요.",
      );
      assert.equal(
        await student
          .locator("#concept-reason")
          .evaluate((e) => e === document.activeElement),
        true,
      );
      assert.equal(
        await student
          .locator('[data-concept="chroma"] .choice-row button')
          .nth(1)
          .getAttribute("aria-pressed"),
        "true",
      );
      await host.evaluate(() => control("slide", { slide: 2 }));
      const proj = await hc.newPage();
      await proj.setViewportSize({ width: 1280, height: 720 });
      await proj.goto(base + "?room=" + code + "&view=presentation");
      await proj.waitForSelector(".presentation-mode");
      assert.match(await proj.locator(".lesson-task").innerText(), /정답 · A/);
      assert(
        await proj.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight + 1,
        ),
      );
      await student.reload();
      await student.waitForSelector("#tab-concepts.active");
      assert.equal(
        await student
          .locator('[data-concept="chroma"] .concept-answer')
          .isVisible(),
        true,
      );
      assert.equal(
        await student.inputValue("#concept-reason"),
        "B가 차분하게 느껴져요.",
      );
      await host.locator('[data-answer-question="chroma"]').click();
      await student.waitForSelector('[data-concept="chroma"] .concept-answer', {
        state: "hidden",
      });
      await proj.waitForFunction(
        () =>
          !document
            .querySelector(".lesson-task")
            .textContent.includes("정답 ·"),
      );
      await host.locator('[data-answer-question="brightness"]').click();
      await student.waitForSelector(
        '[data-concept="brightness"] .answer-swatches',
      );
      assert.equal(
        await student
          .locator('[data-concept="brightness"] .answer-swatches span')
          .count(),
        4,
      );
      await host.evaluate(() => control("slide", { slide: 1 }));
      await proj.waitForFunction(() =>
        document
          .querySelector(".lesson-task")
          .textContent.includes("정답 · 밝은 색"),
      );
      assert(
        await proj.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight + 1,
        ),
      );
      assert(
        await student.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      app.closeStreams();
      app.server.closeAllConnections();
      await new Promise((r) => app.server.close(r));
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  },
);
