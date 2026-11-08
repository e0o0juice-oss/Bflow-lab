"use strict";
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const content = require("./content.js"),
  notes = require("./notes.cjs");
const fail = (status, message) => {
  throw Object.assign(Error(message), { status });
};
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex"),
  token = () => crypto.randomBytes(32).toString("hex");
const clone = (o) => JSON.parse(JSON.stringify(o));
function createApp({
  dataDir = process.env.COLOR_DATA_DIR || path.join(__dirname, ".data"),
  publicOrigin = process.env.PUBLIC_ORIGIN ||
    process.env.RENDER_EXTERNAL_URL ||
    "",
  now = () => Date.now(),
} = {}) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const imageDir = path.join(dataDir, "images");
  fs.mkdirSync(imageDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, "rooms.json");
  let rooms = {};
  if (fs.existsSync(file)) {
    rooms = JSON.parse(fs.readFileSync(file, "utf8"));
  }
  const streams = new Map(),
    rates = new Map();
  function persist() {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(rooms), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  function cookieName(code, role) {
    return "cs_" + code + "_" + role;
  }
  function cookies(req) {
    return Object.fromEntries(
      (req.headers.cookie || "").split(";").map((s) => s.trim().split("=")),
    );
  }
  function auth(req, room, hostOnly = false) {
    const c = cookies(req);
    if (
      c[cookieName(room.code, "host")] &&
      hash(c[cookieName(room.code, "host")]) === room.hostHash
    )
      return { role: "host" };
    if (hostOnly)
      fail(403, "강사 권한이 필요합니다. 수업을 만든 브라우저를 사용하세요.");
    const h = c[cookieName(room.code, "member")];
    const member = h && room.members.find((m) => m.hash === hash(h));
    if (member) return { role: "member", member };
    fail(403, "수업에 먼저 참여해주세요.");
  }
  function setCookie(res, req, code, role, value) {
    const secure = publicOrigin.startsWith("https:") || req.socket.encrypted;
    res.setHeader(
      "Set-Cookie",
      `${cookieName(code, role)}=${value}; HttpOnly; SameSite=Strict; Path=/color-studio/; Max-Age=604800${secure ? "; Secure" : ""}`,
    );
  }
  function timerState(room) {
    const t = room.timer;
    return {
      durationMs: t.durationMs,
      remainingMs: t.endsAt ? Math.max(0, t.endsAt - now()) : t.remainingMs,
      endsAt: t.endsAt,
      serverNow: now(),
    };
  }
  function base(room) {
    return {
      code: room.code,
      stage: room.stage,
      slide: room.slide,
      sync: room.sync,
      active: room.active,
      boardOpen: room.boardOpen,
      ended: room.ended,
      expiresAt: room.expiresAt,
      config: room.config,
      timer: timerState(room),
    };
  }
  function hostState(room) {
    return {
      ...base(room),
      role: "host",
      notes: notes[room.stage],
      groups: Array.from({ length: room.config.groupCount }, (_, i) => {
        const members = room.members.filter((m) => m.group === i + 1);
        return {
          group: i + 1,
          count: members.length,
          members: members.map((m) => ({
            id: m.id,
            name: m.name,
            online: now() - m.lastSeen < 45000,
            completed: Object.values(m.book.records || {}).filter(
              (r) => r.self || r.peer?.length || r.selfNote || r.peerNote,
            ).length,
            revisit: Object.values(m.book.records || {}).some(
              (r) => r.self === "again" || r.peer?.includes("again"),
            ),
          })),
        };
      }),
      presentationPost: room.presentationPostId || null,
    };
  }
  function memberState(room, m) {
    return {
      ...base(room),
      role: "member",
      member: { id: m.id, name: m.name, group: m.group },
      book: m.book,
      version: m.version,
      lastWriteId: m.lastWriteId,
    };
  }
  function safePost(p, identity) {
    return {
      id: p.id,
      group: p.group,
      name: p.name,
      reason: p.reason,
      words: p.words,
      image: !!p.image,
      mime: p.mime,
      consent: p.consent,
      createdAt: p.createdAt,
      owner: identity.member?.id === p.memberId,
      comments: p.comments.map((c) => ({
        id: c.id,
        name: c.name,
        text: c.text,
        owner: c.memberId === identity.member?.id,
        createdAt: c.createdAt,
      })),
    };
  }
  function projection(room) {
    const p = room.posts.find(
      (p) => p.id === room.presentationPostId && p.consent,
    );
    return {
      ...base(room),
      role: "presentation",
      post: p
        ? { id: p.id, reason: p.reason, words: p.words, image: !!p.image }
        : null,
    };
  }
  function snapshot(room, identity) {
    return identity.role === "host"
      ? hostState(room)
      : memberState(room, identity.member);
  }
  function notify(code) {
    const room = rooms[code];
    for (const s of streams.get(code) || []) {
      try {
        s.res.write(
          "event: state\ndata: " +
            JSON.stringify(
              s.presentation ? projection(room) : snapshot(room, s.identity),
            ) +
            "\n\n",
        );
      } catch {}
    }
  }
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
  function json(res, status, data) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    });
    res.end(JSON.stringify(data));
  }
  async function body(req, max = 3 * 1024 * 1024) {
    if (!req.headers["content-type"]?.startsWith("application/json"))
      fail(415, "JSON 형식이 필요합니다.");
    let chunks = [],
      size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > max) fail(413, "파일 또는 입력이 너무 큽니다.");
      chunks.push(c);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      fail(400, "입력 형식을 확인해주세요.");
    }
  }
  const str = (x, max = 200) => {
    if (typeof x !== "string" || x.length > max)
      fail(400, "입력 길이와 형식을 확인해주세요.");
    return x.trim();
  };
  function configCheck(c, old) {
    if (
      !c ||
      !Array.isArray(c.steps) ||
      c.steps.length !== 9 ||
      !Array.isArray(c.families) ||
      c.families.length < 1 ||
      c.families.length > 12 ||
      !Array.isArray(c.seasons) ||
      c.seasons.length < 1 ||
      c.seasons.length > 12 ||
      ![5, 6].includes(c.groupCount)
    )
      fail(400, "9개 단계, 5~6개 조, 색상/계절 1~12개를 설정해주세요.");
    if (
      c.groupCount < old.groupCount &&
      Object.values(rooms).some(
        (r) =>
          r.config === old && r.members.some((m) => m.group > c.groupCount),
      )
    )
      fail(409, "참여 중인 조를 제거할 수 없습니다.");
    const ids = new Set();
    return {
      groupCount: c.groupCount,
      kitConfirmed: !!c.kitConfirmed,
      seasons: c.seasons.map((n) => str(n, 40)),
      steps: c.steps.map((s, i) => {
        if (!Number.isInteger(s.minutes) || s.minutes < 1 || s.minutes > 180)
          fail(400, "단계 시간은 1~180분입니다.");
        return {
          ...content.steps[i],
          title: str(s.title, 80),
          minutes: s.minutes,
        };
      }),
      families: c.families.map((f) => {
        if (
          !/^f[a-z0-9_-]{0,30}$/.test(f.id) ||
          ids.has(f.id) ||
          !Array.isArray(f.colors) ||
          f.colors.length < 2 ||
          f.colors.length > 12
        )
          fail(400, "색상 ID는 중복 없이, 비교색은 2~12개로 설정해주세요.");
        ids.add(f.id);
        const chipIds = new Set();
        return {
          id: f.id,
          name: str(f.name, 30),
          colors: f.colors.map((c) => {
            if (
              !/^[a-z0-9_-]{1,40}$/.test(c.id) ||
              chipIds.has(c.id) ||
              !/^#[0-9a-f]{6}$/i.test(c.hex) ||
              !Number.isInteger(c.season) ||
              c.season < 0
            )
              fail(400, "비교색 ID·HEX·계절을 확인해주세요.");
            chipIds.add(c.id);
            return {
              id: c.id,
              name: str(c.name, 40),
              hex: c.hex,
              season: c.season,
            };
          }),
        };
      }),
    };
  }
  function validateBook(book) {
    if (
      !book ||
      typeof book !== "object" ||
      Array.isArray(book) ||
      Buffer.byteLength(JSON.stringify(book)) > 60000
    )
      fail(400, "워크북 기록은 60KB 이내여야 합니다.");
    const out = {
      gender: book.gender === "female" ? "female" : "male",
      favorites: [],
      completed: !!book.completed,
      records: {},
      concepts: {},
      words: [],
      imageNote: str(book.imageNote || "", 2000),
      role: str(book.role || "", 40),
      conditions: str(book.conditions || "", 2000),
    };
    if (
      !Array.isArray(book.favorites) ||
      book.favorites.length > 3 ||
      book.favorites.some(
        (n) => !Number.isInteger(n) || n < 0 || n >= content.palette.length,
      ) ||
      new Set(book.favorites).size !== book.favorites.length
    )
      fail(400, "좋아하는 색은 서로 다른 3개까지 선택해주세요.");
    out.favorites = book.favorites;
    if (out.completed && out.favorites.length !== 3)
      fail(400, "색 3개를 먼저 선택해주세요.");
    for (const [id, r] of Object.entries(book.records || {})) {
      if (!/^f[a-z0-9_-]{0,30}$/.test(id) || !r || typeof r !== "object")
        fail(400, "기록 형식을 확인해주세요.");
      out.records[id] = {
        familyName: str(r.familyName || "", 40),
        self: str(r.self || "", 60),
        peer: Array.isArray(r.peer)
          ? r.peer.slice(0, 20).map((v) => str(v, 60))
          : [],
        selfNote: str(r.selfNote || "", 2000),
        peerNote: str(r.peerNote || "", 2000),
        colorLabels:
          r.colorLabels && typeof r.colorLabels === "object"
            ? Object.fromEntries(
                Object.entries(r.colorLabels)
                  .slice(0, 12)
                  .map(([k, v]) => [str(k, 40), str(v, 100)]),
              )
            : {},
      };
    }
    for (const [id, v] of Object.entries(book.concepts || {})) {
      if (
        !/^[a-zA-Z0-9_-]{1,40}$/.test(id) ||
        ["__proto__", "constructor", "prototype"].includes(id)
      )
        fail(400, "활동 ID 오류");
      out.concepts[id] = Array.isArray(v)
        ? v.slice(0, 20).map((n) => str(String(n), 100))
        : str(String(v), 2000);
    }
    out.words = Array.isArray(book.words)
      ? book.words.slice(0, 12).map((w) => str(w, 30))
      : [];
    return out;
  }
  function imageData(data) {
    if (!data) return null;
    if (typeof data !== "string") fail(400, "이미지 형식 오류");
    const m = data.match(
      /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/,
    );
    if (!m) fail(400, "JPG·PNG·WebP 이미지만 가능합니다.");
    const b = Buffer.from(m[2], "base64");
    if (b.length > 2 * 1024 * 1024 || b.length < 24)
      fail(413, "이미지는 2MB 이하로 준비해주세요.");
    const ok =
      m[1] === "png"
        ? b
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
          b.toString("ascii", 12, 16) === "IHDR"
        : m[1] === "jpeg"
          ? b[0] === 255 && b[1] === 216 && b[2] === 255
          : b.toString("ascii", 0, 4) === "RIFF" &&
            b.toString("ascii", 8, 12) === "WEBP";
    if (!ok) fail(400, "이미지 내용과 확장자가 일치하지 않습니다.");
    return { buffer: b, mime: "image/" + m[1] };
  }
  function removeImages(room) {
    for (const p of room.posts)
      if (p.image) fs.rmSync(path.join(imageDir, p.image), { force: true });
  }
  function expire() {
    let changed = false;
    for (const [code, r] of Object.entries(rooms)) {
      if (r.expiresAt < now()) {
        removeImages(r);
        for (const s of streams.get(code) || []) s.res.end();
        streams.delete(code);
        delete rooms[code];
        changed = true;
      }
    }
    if (changed) persist();
  }
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://local");
      if (
        req.method === "POST" ||
        req.method === "PUT" ||
        req.method === "DELETE"
      ) {
        const origin = req.headers.origin;
        const expected =
          publicOrigin ||
          (req.socket.encrypted ? "https" : "http") + "://" + req.headers.host;
        if (origin && origin !== expected)
          fail(403, "허용되지 않은 사이트의 요청입니다.");
        if (req.headers["sec-fetch-site"] === "cross-site")
          fail(403, "같은 사이트에서 다시 시도해주세요.");
      }
      if (u.pathname.startsWith("/color-studio/api/")) {
        expire();
        const ip = req.socket.remoteAddress,
          rate = rates.get(ip) || { count: 0, until: now() + 60000 };
        if (rate.until < now()) {
          rate.count = 0;
          rate.until = now() + 60000;
        }
        rate.count++;
        rates.set(ip, rate);
        if (rate.count > 10000)
          fail(429, "요청이 많습니다. 잠시 후 다시 시도해주세요.");
        if (u.pathname === "/color-studio/api/health")
          return json(res, 200, { ok: true });
        if (u.pathname === "/color-studio/api/rooms" && req.method === "POST") {
          await body(req, 2000);
          if (Object.keys(rooms).length >= 50)
            fail(
              503,
              "수업 생성 한도입니다. 사용하지 않는 수업을 삭제해주세요.",
            );
          let code;
          do {
            code = String(crypto.randomInt(100000, 1000000));
          } while (rooms[code]);
          const t = token();
          const r = {
            code,
            hostHash: hash(t),
            createdAt: now(),
            expiresAt: now() + 7 * 86400000,
            stage: 0,
            slide: 0,
            sync: true,
            active: false,
            boardOpen: false,
            ended: false,
            config: {
              steps: clone(content.steps),
              families: clone(content.families),
              seasons: clone(content.seasons),
              groupCount: 6,
              kitConfirmed: false,
            },
            timer: { durationMs: 600000, remainingMs: 600000, endsAt: null },
            members: [],
            posts: [],
            presentationPostId: null,
          };
          rooms[code] = r;
          persist();
          setCookie(res, req, code, "host", t);
          return json(res, 201, hostState(r));
        }
        const match = u.pathname.match(
          /^\/color-studio\/api\/r\/(\d{6})(?:\/(.*))?$/,
        );
        if (!match) fail(404, "주소를 확인해주세요.");
        const r = rooms[match[1]],
          route = match[2] || "";
        if (!r) fail(404, "수업이 없거나 보관 기간이 끝났습니다.");
        if (route === "info" && req.method === "GET")
          return json(res, 200, {
            code: r.code,
            groupCount: r.config.groupCount,
            ended: r.ended,
            expiresAt: r.expiresAt,
          });
        if (route === "join" && req.method === "POST") {
          const data = await body(req, 2000);
          if (r.ended) fail(409, "종료된 수업입니다.");
          let existing;
          try {
            existing = auth(req, r);
          } catch {}
          if (existing?.role === "member")
            return json(res, 200, memberState(r, existing.member));
          if (
            !Number.isInteger(data.group) ||
            data.group < 1 ||
            data.group > r.config.groupCount
          )
            fail(400, "조를 선택해주세요.");
          if (r.members.length >= 60) fail(409, "참여 인원 한도입니다.");
          const name = str(data.name || "참여자", 24) || "참여자",
            t = token();
          const m = {
            id: crypto.randomUUID(),
            hash: hash(t),
            name,
            group: data.group,
            book: {
              gender: "male",
              favorites: [],
              completed: false,
              records: {},
              concepts: {},
              words: [],
              imageNote: "",
              role: "",
              conditions: "",
            },
            version: 0,
            lastWriteId: "",
            lastSeen: now(),
          };
          r.members.push(m);
          persist();
          setCookie(res, req, r.code, "member", t);
          notify(r.code);
          return json(res, 201, memberState(r, m));
        }
        if (
          route === "presentation" ||
          route === "presentation/events" ||
          route.startsWith("presentation/images/")
        ) {
          const a = auth(req, r, true);
          if (route === "presentation") return json(res, 200, projection(r));
          if (route === "presentation/events")
            return openStream(req, res, r, a, true);
          const p = r.posts.find(
            (p) =>
              p.id === route.split("/")[2] &&
              p.consent &&
              p.id === r.presentationPostId,
          );
          if (!p?.image) fail(404, "공개 중인 이미지가 없습니다.");
          return sendImage(res, p);
        }
        const a = auth(req, r);
        if (a.member) a.member.lastSeen = now();
        if (route === "" && req.method === "GET")
          return json(res, 200, snapshot(r, a));
        if (route === "events" && req.method === "GET")
          return openStream(req, res, r, a, false);
        if (route === "host" && req.method === "GET") {
          auth(req, r, true);
          return json(res, 200, hostState(r));
        }
        if (route === "control" && req.method === "POST") {
          auth(req, r, true);
          const d = await body(req, 5000);
          if (r.ended && d.action !== "delete")
            fail(409, "수업이 종료되었습니다.");
          switch (d.action) {
            case "stage":
              if (!Number.isInteger(d.stage) || d.stage < 0 || d.stage > 8)
                fail(400, "단계를 확인해주세요.");
              r.stage = d.stage;
              r.slide = 0;
              r.active = false;
              r.timer = {
                durationMs: r.config.steps[r.stage].minutes * 60000,
                remainingMs: r.config.steps[r.stage].minutes * 60000,
                endsAt: null,
              };
              break;
            case "slide":
              if (
                !Number.isInteger(d.slide) ||
                d.slide < 0 ||
                d.slide >= content.slides[r.stage].length
              )
                fail(400, "슬라이드를 확인해주세요.");
              r.slide = d.slide;
              break;
            case "sync":
              r.sync = !!d.value;
              break;
            case "active":
              r.active = !!d.value;
              break;
            case "board":
              r.boardOpen = !!d.value;
              break;
            case "timer": {
              const t = r.timer;
              if (d.command === "start") {
                if (!t.endsAt)
                  t.endsAt = now() + (t.remainingMs || t.durationMs);
              } else if (d.command === "pause") {
                t.remainingMs = t.endsAt
                  ? Math.max(0, t.endsAt - now())
                  : t.remainingMs;
                t.endsAt = null;
              } else if (d.command === "set") {
                if (
                  !Number.isInteger(d.minutes) ||
                  d.minutes < 1 ||
                  d.minutes > 180
                )
                  fail(400, "시간은 1~180분입니다.");
                t.durationMs = t.remainingMs = d.minutes * 60000;
                t.endsAt = null;
              } else if (d.command === "reset") {
                t.remainingMs = t.durationMs;
                t.endsAt = null;
              } else fail(400, "타이머 명령 오류");
              break;
            }
            case "present":
              if (
                d.id !== null &&
                !r.posts.some((p) => p.id === d.id && p.consent)
              )
                fail(
                  403,
                  "작성자가 발표에 동의한 게시물만 공개할 수 있습니다.",
                );
              r.presentationPostId = d.id;
              break;
            case "end":
              r.ended = true;
              r.active = false;
              r.boardOpen = false;
              r.timer.remainingMs = timerState(r).remainingMs;
              r.timer.endsAt = null;
              r.presentationPostId = null;
              break;
            case "delete":
              removeImages(r);
              for (const s of streams.get(r.code) || []) s.res.end();
              streams.delete(r.code);
              delete rooms[r.code];
              persist();
              return json(res, 200, { deleted: true });
            default:
              fail(400, "지원하지 않는 명령입니다.");
          }
          persist();
          notify(r.code);
          return json(res, 200, hostState(r));
        }
        if (route === "config" && req.method === "PUT") {
          auth(req, r, true);
          if (r.ended) fail(409, "종료된 수업입니다.");
          const d = await body(req, 30000);
          const cfg = configCheck(d, r.config);
          for (const f of cfg.families)
            for (const c of f.colors)
              if (c.season >= cfg.seasons.length)
                fail(400, "계절 번호를 확인해주세요.");
          r.config = cfg;
          persist();
          notify(r.code);
          return json(res, 200, hostState(r));
        }
        if (route === "book" && req.method === "PUT") {
          if (!a.member) fail(403, "참여자 전용 기록입니다.");
          if (r.ended)
            fail(
              409,
              "종료된 수업은 기록을 변경할 수 없습니다. 내려받기는 가능합니다.",
            );
          const d = await body(req, 70000),
            m = a.member;
          if (typeof d.writeId !== "string" || d.writeId.length > 80)
            fail(400, "저장 요청 ID 오류");
          if (d.writeId === m.lastWriteId)
            return json(res, 200, { version: m.version });
          if (d.version !== m.version)
            fail(
              409,
              "다른 탭의 기록이 먼저 저장되었습니다. 이 기기 기록을 내려받고 새로고침해주세요.",
            );
          m.book = validateBook(d.book);
          m.version++;
          m.lastWriteId = d.writeId;
          m.lastSeen = now();
          persist();
          notify(r.code);
          return json(res, 200, { version: m.version });
        }
        if (route === "board" && req.method === "GET") {
          return json(res, 200, {
            posts: r.posts
              .filter((p) => a.role === "host" || p.group === a.member.group)
              .map((p) => safePost(p, a)),
          });
        }
        if (route === "board" && req.method === "POST") {
          if (!a.member) fail(403, "참여자가 올리는 공간입니다.");
          if (!r.boardOpen || r.ended)
            fail(409, "강사가 공유 활동을 열면 올릴 수 있어요.");
          const d = await body(req),
            reason = str(d.reason || "", 1500),
            img = imageData(d.image),
            words = Array.isArray(d.words)
              ? d.words.slice(0, 12).map((w) => str(w, 30))
              : [];
          if (!reason && !img)
            fail(400, "이미지 또는 선택 이유를 입력해주세요.");
          if (
            r.posts.length >= 200 ||
            r.posts.filter((p) => p.group === a.member.group).length >= 40 ||
            r.posts.reduce((n, p) => n + (p.bytes || 0), 0) +
              (img?.buffer.length || 0) >
              100 * 1024 * 1024
          )
            fail(409, "수업 게시판 용량 한도입니다.");
          if (
            r.posts.some(
              (p) => p.memberId === a.member.id && p.writeId === d.writeId,
            )
          )
            return json(res, 200, { ok: true });
          const id = crypto.randomUUID(),
            image = img ? id + ".img" : null;
          if (img)
            fs.writeFileSync(path.join(imageDir, image), img.buffer, {
              mode: 0o600,
            });
          r.posts.push({
            id,
            memberId: a.member.id,
            group: a.member.group,
            name: a.member.name,
            reason,
            words,
            image,
            mime: img?.mime || null,
            bytes: img?.buffer.length || 0,
            consent: d.consent === true,
            createdAt: now(),
            comments: [],
            writeId: str(d.writeId || id, 80),
          });
          persist();
          notify(r.code);
          return json(res, 201, { id });
        }
        const pm = route.match(
          /^board\/([a-f0-9-]{36})(?:\/(image|comments|consent))?$/,
        );
        if (pm) {
          const p = r.posts.find((p) => p.id === pm[1]);
          if (!p || (a.role !== "host" && p.group !== a.member.group))
            fail(404, "이 조에서 볼 수 없는 게시물입니다.");
          if (pm[2] === "image" && req.method === "GET") {
            if (!p.image) fail(404, "이미지가 없습니다.");
            return sendImage(res, p);
          }
          if (pm[2] === "comments" && req.method === "POST") {
            if (!a.member) fail(403, "조 참여자만 의견을 남길 수 있습니다.");
            if (!r.boardOpen || r.ended) fail(409, "공유 활동이 닫혔습니다.");
            const d = await body(req, 3000),
              text = str(d.text, 500);
            if (!text) fail(400, "의견을 입력해주세요.");
            if (p.comments.length >= 40) fail(409, "댓글 한도입니다.");
            p.comments.push({
              id: crypto.randomUUID(),
              memberId: a.member.id,
              name: a.member.name,
              text,
              createdAt: now(),
            });
            persist();
            notify(r.code);
            return json(res, 201, { ok: true });
          }
          if (pm[2] === "consent" && req.method === "POST") {
            if (p.memberId !== a.member?.id)
              fail(403, "작성자만 발표 동의를 변경할 수 있습니다.");
            const d = await body(req, 1000);
            p.consent = d.consent === true;
            if (!p.consent && r.presentationPostId === p.id)
              r.presentationPostId = null;
            persist();
            notify(r.code);
            return json(res, 200, { consent: p.consent });
          }
          if (!pm[2] && req.method === "DELETE") {
            if (a.role !== "host" && p.memberId !== a.member.id)
              fail(403, "작성자만 삭제할 수 있습니다.");
            if (p.image)
              fs.rmSync(path.join(imageDir, p.image), { force: true });
            r.posts = r.posts.filter((v) => v !== p);
            if (r.presentationPostId === p.id) r.presentationPostId = null;
            persist();
            notify(r.code);
            return json(res, 200, { deleted: true });
          }
        }
        fail(404, "주소 또는 요청 방식을 확인해주세요.");
      }
      const assets = {
        "/color-studio/fonts/PretendardVariable.woff2": [
          "fonts/PretendardVariable.woff2",
          "font/woff2",
        ],
        "/color-studio/fonts/OFL.txt": ["fonts/OFL.txt", "text/plain"],
        "/color-studio/": ["index.html", "text/html"],
        "/color-studio/index.html": ["index.html", "text/html"],
        "/color-studio/studio.css": ["studio.css", "text/css"],
        "/color-studio/studio.js": ["studio.js", "text/javascript"],
        "/color-studio/content.js": ["content.js", "text/javascript"],
        "/color-studio/qr.js": ["vendor/qrcode.js", "text/javascript"],
        "/color-studio/QR-LICENSE.txt": ["vendor/LICENSE.txt", "text/plain"],
        "/color-studio/sw.js": ["sw.js", "text/javascript"],
      };
      if (u.pathname === "/") {
        res.writeHead(302, { Location: "/color-studio/" });
        return res.end();
      }
      if (req.method === "GET" && assets[u.pathname]) {
        const [f, type] = assets[u.pathname];
        res.writeHead(200, {
          "Content-Type": type + "; charset=utf-8",
          ...headers,
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        });
        return fs.createReadStream(path.join(__dirname, f)).pipe(res);
      }
      fail(404, "찾을 수 없는 주소입니다.");
    } catch (e) {
      if (!res.headersSent)
        json(res, e.status || 500, {
          error: e.status
            ? e.message
            : "저장 또는 서버 처리에 실패했습니다. 기록을 내려받고 다시 시도해주세요.",
        });
      else res.end();
      if (!e.status)
        console.error("Color Studio server error:", e.code || e.name);
    }
  });
  function sendImage(res, p) {
    const f = path.join(imageDir, p.image);
    if (!fs.existsSync(f)) fail(404, "이미지 파일이 없습니다.");
    res.writeHead(200, {
      "Content-Type": p.mime,
      ...headers,
      "Content-Length": fs.statSync(f).size,
    });
    fs.createReadStream(f).pipe(res);
  }
  function openStream(req, res, r, identity, presentation) {
    if ((streams.get(r.code)?.size || 0) >= 100) fail(503, "연결 한도입니다.");
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...headers,
    });
    res.write(
      "retry: 2000\nevent: state\ndata: " +
        JSON.stringify(presentation ? projection(r) : snapshot(r, identity)) +
        "\n\n",
    );
    const entry = { res, identity, presentation };
    if (!streams.has(r.code)) streams.set(r.code, new Set());
    streams.get(r.code).add(entry);
    const tick = setInterval(() => {
      if (identity.member) identity.member.lastSeen = now();
      res.write(": heartbeat\n\n");
    }, 15000);
    req.on("close", () => {
      clearInterval(tick);
      streams.get(r.code)?.delete(entry);
    });
  }
  const maintenance = setInterval(() => {
    expire();
    for (const [k, v] of rates) if (v.until < now()) rates.delete(k);
  }, 60000);
  maintenance.unref();
  server.on("close", () => clearInterval(maintenance));
  function closeStreams() {
    for (const set of streams.values()) for (const s of set) s.res.end();
    streams.clear();
  }
  return { server, closeStreams };
}
if (require.main === module) {
  const app = createApp();
  const port = Number(process.env.PORT || 8040);
  app.server.listen(port, "0.0.0.0", () =>
    console.log("Color Studio listening on port " + port),
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      app.closeStreams();
      app.server.close(() => process.exit(0));
    });
}
module.exports = { createApp };
