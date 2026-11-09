"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { once } = require("node:events");
const { createApp } = require("./server.cjs");
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=";
async function start(dir) {
  const app = createApp({ dataDir: dir });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = "http://127.0.0.1:" + app.server.address().port;
  const req = async (p, { method = "GET", data, cookie = "", origin } = {}) => {
    const r = await fetch(base + "/color-studio/api/" + p, {
      method,
      headers: {
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  };
  return {
    app,
    base,
    req,
    stop: async () => {
      app.closeStreams();
      app.server.closeAllConnections();
      await new Promise((r) => app.server.close(r));
    },
  };
}
test("room ownership, private notes, same-group board, consent, save conflicts and persistent restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "color-server-"));
  let s = await start(dir);
  try {
    let r = await s.req("rooms", { method: "POST", data: {} });
    assert.equal(r.status, 201);
    const code = r.data.code,
      host = r.cookie,
      p = "r/" + code;
    assert.equal(
      r.data.config.steps.reduce((n, s) => n + s.minutes, 0),
      180,
    );
    assert.match(r.data.notes.say, /좋아하는/);
    r = await s.req(p + "/join", {
      method: "POST",
      data: { name: "나", group: 1 },
    });
    const a = r.cookie;
    assert.equal(r.status, 201);
    r = await s.req(p + "/join", {
      method: "POST",
      data: { name: "같은 조", group: 1 },
    });
    const b = r.cookie;
    r = await s.req(p + "/join", {
      method: "POST",
      data: { name: "다른 조", group: 2 },
    });
    const other = r.cookie;
    for (const route of ["host", "presentation", "presentation/events"])
      assert.equal((await s.req(p + "/" + route, { cookie: a })).status, 403);
    assert.equal(
      (
        await s.req(p + "/control", {
          method: "POST",
          cookie: a,
          data: { action: "stage", stage: 8 },
        })
      ).status,
      403,
    );
    assert.equal(
      (await s.req(p + "/config", { method: "PUT", cookie: a, data: {} }))
        .status,
      403,
    );
    assert.equal(
      (
        await s.req(p + "/control", {
          method: "POST",
          cookie: host,
          origin: "https://evil.example",
          data: { action: "stage", stage: 1 },
        })
      ).status,
      403,
    );
    r = await s.req(p, { cookie: a });
    assert(!("notes" in r.data));
    assert(!("groups" in r.data));
    const book = r.data.book;
    book.conditions = "창가 관찰";
    book.records.f0 = {
      familyName: "빨강",
      self: "f0c0",
      peer: ["f0c1", "unsure"],
      selfNote: "내 기록 비공개",
      peerNote: "다른 의견",
      colorLabels: { f0c0: "예시 A" },
    };
    r = await s.req(p + "/book", {
      method: "PUT",
      cookie: a,
      data: { book, version: 0, writeId: "first" },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.version, 1);
    assert.equal(
      (
        await s.req(p + "/book", {
          method: "PUT",
          cookie: a,
          data: { book, version: 0, writeId: "first" },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await s.req(p + "/book", {
          method: "PUT",
          cookie: a,
          data: { book, version: 0, writeId: "stale" },
        })
      ).status,
      409,
    );
    assert.deepEqual((await s.req(p, { cookie: b })).data.book.records, {});
    assert(
      !JSON.stringify((await s.req(p, { cookie: host })).data).includes(
        "내 기록 비공개",
      ),
    );
    assert.equal(
      (
        await s.req(p + "/board", {
          method: "POST",
          cookie: a,
          data: { reason: "공유", image: PNG },
        })
      ).status,
      409,
    );
    await s.req(p + "/control", {
      method: "POST",
      cookie: host,
      data: { action: "board", value: true },
    });
    assert.equal(
      (
        await s.req(p + "/board", {
          method: "POST",
          cookie: a,
          data: { reason: "공유", image: "data:image/svg+xml;base64,PHN2Zz4=" },
        })
      ).status,
      400,
    );
    r = await s.req(p + "/board", {
      method: "POST",
      cookie: a,
      data: {
        reason: "차분한 스타일",
        words: ["차분한"],
        image: PNG,
        consent: false,
        writeId: "post1",
      },
    });
    assert.equal(r.status, 201);
    const id = r.data.id;
    assert.equal(
      (await s.req(p + "/board", { cookie: b })).data.posts.length,
      1,
    );
    assert.equal(
      (await s.req(p + "/board", { cookie: other })).data.posts.length,
      0,
    );
    assert.equal(
      (
        await s.req(p + "/board/" + id + "/comments", {
          method: "POST",
          cookie: other,
          data: { text: "침입" },
        })
      ).status,
      404,
    );
    const img = await fetch(
      s.base + "/color-studio/api/" + p + "/board/" + id + "/image",
      { headers: { Cookie: other } },
    );
    assert.equal(img.status, 404);
    assert.equal(
      (
        await s.req(p + "/board/" + id + "/consent", {
          method: "POST",
          cookie: b,
          data: { consent: true },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await s.req(p + "/control", {
          method: "POST",
          cookie: host,
          data: { action: "present", id },
        })
      ).status,
      403,
    );
    await s.req(p + "/board/" + id + "/comments", {
      method: "POST",
      cookie: b,
      data: { text: "네이비를 더해보면 어떨까요?" },
    });
    await s.req(p + "/board/" + id + "/consent", {
      method: "POST",
      cookie: a,
      data: { consent: true },
    });
    await s.req(p + "/control", {
      method: "POST",
      cookie: host,
      data: { action: "present", id },
    });
    r = await s.req(p + "/presentation", { cookie: host });
    assert.equal(r.data.post.id, id);
    for (const field of ["notes", "members", "book", "groups"])
      assert(!Object.hasOwn(r.data, field));
    assert(!Object.hasOwn(r.data.post, "name"));
    assert(!Object.hasOwn(r.data.post, "comments"));
    await s.req(p + "/board/" + id + "/consent", {
      method: "POST",
      cookie: a,
      data: { consent: false },
    });
    assert.equal(
      (await s.req(p + "/presentation", { cookie: host })).data.post,
      null,
    );
    const cfg = (await s.req(p, { cookie: host })).data.config;
    cfg.steps[0].minutes = 12;
    cfg.seasons = ["내 봄", "내 여름", "내 가을", "내 겨울"];
    cfg.families[0].colors.push({
      id: "extra",
      name: "실물 번호 7",
      hex: "#334455",
      season: 1,
    });
    cfg.kitConfirmed = true;
    assert.equal(
      (await s.req(p + "/config", { method: "PUT", cookie: host, data: cfg }))
        .status,
      200,
    );
    await s.req(p + "/control", {
      method: "POST",
      cookie: host,
      data: { action: "timer", command: "set", minutes: 1 },
    });
    await s.req(p + "/control", {
      method: "POST",
      cookie: host,
      data: { action: "timer", command: "start" },
    });
    assert((await s.req(p, { cookie: a })).data.timer.endsAt > Date.now());
    await s.req(p + "/control", {
      method: "POST",
      cookie: host,
      data: { action: "timer", command: "pause" },
    });
    assert.equal((await s.req(p, { cookie: a })).data.timer.endsAt, null);
    await s.req(p + "/control", {
      method: "POST",
      cookie: host,
      data: { action: "stage", stage: 5 },
    });
    await s.req(p + "/control", {
      method: "POST",
      cookie: host,
      data: { action: "sync", value: false },
    });
    await s.stop();
    s = await start(dir);
    r = await s.req(p, { cookie: a });
    assert.equal(r.data.book.conditions, "창가 관찰");
    assert.equal(r.data.stage, 5);
    assert.equal(r.data.sync, false);
    assert.equal(r.data.config.families[0].colors.length, 5);
    assert.equal(
      (await s.req(p + "/board", { cookie: a })).data.posts[0].comments.length,
      1,
    );
    assert.equal(
      (
        await s.req(p + "/join", {
          method: "POST",
          cookie: a,
          data: { name: "변경", group: 2 },
        })
      ).data.member.group,
      1,
    );
    await s.req(p + "/control", {
      method: "POST",
      cookie: host,
      data: { action: "end" },
    });
    assert.equal(
      (
        await s.req(p + "/book", {
          method: "PUT",
          cookie: a,
          data: { book, version: 1, writeId: "late" },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await s.req(p + "/board/" + id + "/consent", {
          method: "POST",
          cookie: a,
          data: { consent: false },
        })
      ).status,
      200,
    );
    await s.req(p + "/control", {
      method: "POST",
      cookie: host,
      data: { action: "delete" },
    });
    assert.equal((await s.req(p, { cookie: a })).status, 404);
    assert.equal(fs.readdirSync(path.join(dir, "images")).length, 0);
  } finally {
    await s.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("30 concurrent participants receive SSE stage sync and keep independent records", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "color-load-")),
    s = await start(dir);
  const readers = [];
  try {
    const created = await s.req("rooms", { method: "POST", data: {} }),
      host = created.cookie,
      p = "r/" + created.data.code;
    const people = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        s.req(p + "/join", {
          method: "POST",
          data: { name: "학생" + i, group: Math.floor(i / 5) + 1 },
        }),
      ),
    );
    assert(people.every((p) => p.status === 201));
    for (const person of people) {
      const response = await fetch(
        s.base + "/color-studio/api/" + p + "/events",
        { headers: { Cookie: person.cookie } },
      );
      assert.equal(response.status, 200);
      const reader = response.body.getReader();
      readers.push(reader);
      const initial = new TextDecoder().decode((await reader.read()).value);
      assert.match(initial, /event: state/);
      assert(!initial.includes("강사용"));
    }
    await s.req(p + "/control", {
      method: "POST",
      cookie: host,
      data: { action: "stage", stage: 5 },
    });
    await Promise.all(
      readers.map(async (reader) => {
        const data = new TextDecoder().decode((await reader.read()).value);
        assert.match(data, /"stage":5/);
      }),
    );
    const writes = await Promise.all(
      people.map((person, i) =>
        s.req(p + "/book", {
          method: "PUT",
          cookie: person.cookie,
          data: {
            book: {
              ...person.data.book,
              conditions: "학생" + i + "의 독립 기록",
            },
            version: 0,
            writeId: "write" + i,
          },
        }),
      ),
    );
    assert(writes.every((w) => w.status === 200));
    const reads = await Promise.all(
      people.map((person) => s.req(p, { cookie: person.cookie })),
    );
    reads.forEach((r, i) =>
      assert.equal(r.data.book.conditions, "학생" + i + "의 독립 기록"),
    );
    const status = (await s.req(p, { cookie: host })).data;
    assert.equal(
      status.groups.reduce((n, g) => n + g.count, 0),
      30,
    );
    assert(status.groups.every((g) => g.count === 5));
  } finally {
    for (const reader of readers) await reader.cancel();
    await s.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Render external URL supplies HTTPS origin validation and Secure cookies", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "color-render-"));
  const previous = process.env.RENDER_EXTERNAL_URL,
    previousPublic = process.env.PUBLIC_ORIGIN;
  process.env.RENDER_EXTERNAL_URL = "https://example-color-studio.onrender.com";
  delete process.env.PUBLIC_ORIGIN;
  let app;
  try {
    app = createApp({ dataDir: dir });
  } finally {
    if (previous === undefined) delete process.env.RENDER_EXTERNAL_URL;
    else process.env.RENDER_EXTERNAL_URL = previous;
    if (previousPublic === undefined) delete process.env.PUBLIC_ORIGIN;
    else process.env.PUBLIC_ORIGIN = previousPublic;
  }
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const url =
    "http://127.0.0.1:" + app.server.address().port + "/color-studio/api/rooms";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Origin: "https://example-color-studio.onrender.com",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(response.status, 201);
    assert.match(response.headers.get("set-cookie"), /; Secure/);
    const rejected = await fetch(url, {
      method: "POST",
      headers: {
        Origin: "https://different-site.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(rejected.status, 403);
  } finally {
    app.closeStreams();
    app.server.closeAllConnections();
    await new Promise((r) => app.server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("concept answers are released one at a time by the instructor, persisted, and can be hidden again", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "color-answers-"));
  let s = await start(dir);
  try {
    const created = await s.req("rooms", { method: "POST", data: {} }),
      p = "r/" + created.data.code,
      host = created.cookie;
    const joined = await s.req(p + "/join", {
        method: "POST",
        data: { name: "학생", group: 1 },
      }),
      student = joined.cookie;
    assert.deepEqual(joined.data.conceptAnswers, {});
    assert.equal(Object.hasOwn(joined.data, "conceptAnswerKey"), false);
    assert.equal(Object.keys(created.data.conceptAnswerKey).length, 5);
    assert.equal(
      (
        await s.req(p + "/control", {
          method: "POST",
          cookie: student,
          data: { action: "concept-answer", question: "chroma", value: true },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await s.req(p + "/control", {
          method: "POST",
          cookie: host,
          data: { action: "concept-answer", question: "unknown", value: true },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await s.req(p + "/control", {
          method: "POST",
          cookie: host,
          data: { action: "concept-answer", question: "chroma", value: "true" },
        })
      ).status,
      400,
    );
    await s.req(p + "/control", {
      method: "POST",
      cookie: host,
      data: { action: "concept-answer", question: "chroma", value: true },
    });
    let state = (await s.req(p, { cookie: student })).data;
    assert.deepEqual(Object.keys(state.conceptAnswers), ["chroma"]);
    assert.equal(state.conceptAnswers.chroma.label, "A");
    assert.equal(Object.hasOwn(state, "conceptAnswerKey"), false);
    assert.equal(
      (await s.req(p + "/presentation", { cookie: host })).data.conceptAnswers
        .chroma.label,
      "A",
    );
    await s.stop();
    s = await start(dir);
    assert.equal(
      (await s.req(p, { cookie: student })).data.conceptAnswers.chroma.label,
      "A",
    );
    await s.req(p + "/control", {
      method: "POST",
      cookie: host,
      data: { action: "concept-answer", question: "chroma", value: false },
    });
    state = (await s.req(p, { cookie: student })).data;
    assert.deepEqual(state.conceptAnswers, {});
  } finally {
    await s.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
