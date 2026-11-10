"use strict";
const C = window.ColorContent,
  $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const emptyBook = () => ({
  gender: "male",
  favorites: [],
  completed: false,
  records: {},
  concepts: {},
  words: [],
  imageNote: "",
  role: "",
  conditions: "",
  reflection: { favoriteReason: "", discovery: "", nextTry: "" },
});
const params = new URLSearchParams(location.search);
let code = params.get("room") || "",
  presentation = params.get("view") === "presentation",
  session = null,
  room = null,
  eventSource = null,
  connected = false,
  trial = false,
  currentTab = "favorite",
  familyId = "f0",
  localSlide = 0,
  localStage = 2,
  boardPosts = [],
  saveTimeout,
  boardTimer,
  editing = false,
  conflict = false,
  writing = false,
  editCount = 0,
  pending = null,
  dirty = false,
  version = 0,
  book = emptyBook(),
  localKey = "color-studio-personal-v2",
  lastConfig = "",
  timerOffset = 0;
const config = () =>
  room?.config || {
    steps: C.steps,
    seasons: C.seasons,
    families: C.families,
    groupCount: 6,
    kitConfirmed: false,
  };
const apiBase = () => "/color-studio/api/r/" + code;
function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function button(text, fn, cls = "outline-button") {
  const e = el("button", text, cls);
  e.type = "button";
  e.onclick = () => Promise.resolve().then(fn).catch(report);
  return e;
}
function report(error) {
  notify(
    error instanceof TypeError
      ? "연결을 확인해주세요. 작성한 기록은 이 기기에 보관하고 다시 저장을 시도합니다."
      : error.message || "연결을 확인하고 다시 시도해주세요.",
    true,
  );
}
function notify(text, error = false) {
  const e = $("#notice");
  e.textContent = text;
  e.classList.toggle("error", error);
  e.hidden = false;
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => (e.hidden = true), error ? 12000 : 4500);
}
async function api(path = "", method = "GET", data) {
  const response = await fetch(apiBase() + (path ? "/" + path : ""), {
    method,
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    credentials: "same-origin",
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw Error("서버 응답을 확인할 수 없습니다.");
  }
  if (!response.ok)
    throw Object.assign(Error(result.error || "요청을 처리하지 못했습니다."), {
      status: response.status,
    });
  return result;
}
function envelope() {
  return {
    book,
    dirty,
    version,
    pending,
    memberId: session?.member?.id || null,
  };
}
function localSave() {
  try {
    localStorage.setItem(localKey, JSON.stringify(envelope()));
    return true;
  } catch {
    $("#save-status").textContent = "기기 저장 불가 · 지금 내려받아 주세요";
    notify(
      "이 브라우저에 저장할 수 없습니다. 기록을 내려받아 보관해주세요.",
      true,
    );
    return false;
  }
}
function saveBook() {
  editCount++;
  dirty = true;
  localSave();
  $("#save-status").textContent =
    session?.role === "member"
      ? "이 기기 저장 · 서버 저장 대기"
      : "이 기기에 저장됨 ✓";
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(flush, 450);
}
async function flush() {
  if (
    writing ||
    !dirty ||
    !session ||
    session.role !== "member" ||
    conflict ||
    room?.ended
  )
    return;
  writing = true;
  try {
    while (dirty) {
      if (!pending)
        pending = {
          book: JSON.parse(JSON.stringify(book)),
          version,
          writeId: crypto.randomUUID(),
        };
      localSave();
      const sent = pending;
      const r = await api("book", "PUT", sent);
      version = r.version;
      pending = null;
      dirty = JSON.stringify(book) !== JSON.stringify(sent.book);
      localSave();
      $("#save-status").textContent = dirty
        ? "다음 기록 저장 중"
        : "기기와 서버에 저장됨 ✓";
    }
  } catch (e) {
    if (e.status === 409) {
      conflict = true;
      $("#save-status").textContent = "다른 탭 기록과 충돌 · 먼저 내려받기";
      notify(e.message + " 현재 입력은 기기에 보관돼 있어요.", true);
      renderRecovery();
    } else {
      $("#save-status").textContent = "이 기기 보관 · 연결되면 재시도";
      setTimeout(flush, 5000);
    }
  } finally {
    writing = false;
  }
}
function loadLocal(initial) {
  let local;
  try {
    local = JSON.parse(localStorage.getItem(localKey) || "null");
  } catch {}
  version = initial?.version || 0;
  book = initial?.book || emptyBook();
  dirty = false;
  pending = null;
  if (local && (!initial || local.memberId === initial.member.id)) {
    if (local.dirty) {
      book = { ...emptyBook(), ...local.book };
      dirty = true;
      pending = local.pending || null;
      version = local.version || 0;
      if (pending && initial?.lastWriteId === pending.writeId) {
        version = initial.version;
        dirty = JSON.stringify(book) !== JSON.stringify(pending.book);
        pending = null;
      } else if (initial && initial.version !== version) {
        conflict = true;
        notify(
          "다른 탭 또는 기기의 서버 기록과 차이가 있습니다. 현재 기기 기록을 먼저 내려받아 주세요.",
          true,
        );
      }
    } else if (!initial) book = { ...emptyBook(), ...local.book };
  }
  localSave();
}
function view(name) {
  if (name === "teacher" && session?.role !== "host") {
    notify("강사 권한이 필요합니다.", true);
    return;
  }
  if (name === "workbook" && !session && !trial) {
    $("#entry-panel").scrollIntoView({ behavior: "smooth" });
    $("#room-code").focus();
    return;
  }
  $$(".view").forEach((e) => e.classList.toggle("active", e.id === name));
  $$(".header [data-view]").forEach((e) =>
    e.classList.toggle("active", e.dataset.view === name),
  );
  location.hash = name;
  if (name === "workbook") renderBook();
  if (name === "lesson") renderLesson();
  if (name === "teacher") renderTeacher();
  if (name === "board") loadGallery();
  window.scrollTo(0, 0);
}
$$("[data-view]").forEach((b) => (b.onclick = () => view(b.dataset.view)));
$(".brand").onclick = (e) => {
  e.preventDefault();
  view("home");
};
function schedule() {
  const box = $("#schedule-list");
  box.replaceChildren();
  config().steps.forEach((s, i) => {
    const li = el("li");
    li.append(
      el("span", String(i + 1).padStart(2, "0")),
      el("b", s.title),
      el("small", s.minutes + "분"),
    );
    box.append(li);
  });
  $(".intro-strip>span:last-child").textContent =
    "총 " +
    config().steps.reduce((n, s) => n + s.minutes, 0) +
    "분 · 휴식 포함";
}
function cacheMembership() {
  if (session?.role !== "member") return;
  try {
    localStorage.setItem(
      "color-membership-" + code,
      JSON.stringify({
        ...room,
        role: "member",
        member: session.member,
        book: undefined,
        version: undefined,
        lastWriteId: undefined,
      }),
    );
  } catch {}
}
async function enter(s) {
  session = s;
  room = s;
  code = s.code;
  params.set("room", code);
  params.delete("view");
  history.replaceState(null, "", "?" + params);
  $("#room-code").value = code;
  $("#session-label").textContent =
    "수업 " +
    code +
    " · " +
    (s.role === "host" ? "강사" : s.member.group + "조");
  if (s.role === "host") {
    let b = $("#teacher-nav");
    if (!b) {
      b = button("강사 컨트롤", () => view("teacher"));
      b.id = "teacher-nav";
      b.dataset.view = "teacher";
      $(".header nav").append(b);
    }
    view("teacher");
  } else {
    localKey = "color-studio-" + code + "-" + s.member.id;
    loadLocal(s);
    familyId = Object.keys(book.records)[0] || config().families[0].id;
    currentTab = config().steps[room.stage].tab;
    view("workbook");
    flush();
  }
  connect();
  schedule();
  renderStatus();
  cacheMembership();
}
$("#create-room").onclick = async () => {
  const b = $("#create-room");
  b.disabled = true;
  try {
    const r = await fetch("/color-studio/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const s = await r.json();
    if (!r.ok) throw Error(s.error);
    await enter(s);
    notify("수업이 만들어졌어요. 이 브라우저의 권한을 유지해주세요.");
  } catch (e) {
    report(e);
  } finally {
    b.disabled = false;
  }
};
$("#join-form").onsubmit = async (e) => {
  e.preventDefault();
  const b = e.submitter;
  b.disabled = true;
  code = $("#room-code").value.trim();
  try {
    await enter(
      await api("join", "POST", {
        name: $("#join-name").value.trim(),
        group: Number($("#join-group").value),
      }),
    );
  } catch (e) {
    report(e);
  } finally {
    b.disabled = false;
  }
};
$("#room-code").onchange = async () => {
  const c = $("#room-code").value.trim();
  if (!/^\d{6}$/.test(c)) return;
  const previous = code;
  code = c;
  try {
    const info = await api("info");
    $("#join-group").replaceChildren(
      ...Array.from({ length: info.groupCount }, (_, i) => {
        const o = el("option", i + 1 + "조");
        o.value = i + 1;
        return o;
      }),
    );
  } catch (e) {
    report(e);
  } finally {
    code = previous;
  }
};
$("#try-workbook").onclick = () => {
  if (session) {
    view("workbook");
    return;
  }
  trial = true;
  localKey = "color-studio-personal-v2";
  loadLocal();
  currentTab = "favorite";
  $("#session-label").textContent = "개인 연습 · 수업 미연결";
  view("workbook");
};
$("#teacher-workbook").onclick = () =>
  notify(
    "참여자는 위 QR 또는 링크로 접속합니다. 강사는 별도 브라우저에서 학생 흐름을 확인할 수 있어요.",
  );
$("#open-presentation").onclick = () =>
  window.open(
    "/color-studio/?room=" + code + "&view=presentation",
    "color-presentation",
    "noopener",
  );
function connect() {
  eventSource?.close();
  eventSource = new EventSource(
    apiBase() + (presentation ? "/presentation/events" : "/events"),
  );
  eventSource.addEventListener("state", (e) => {
    const fresh = JSON.parse(e.data),
      oldStage = room?.stage,
      oldAnswers = JSON.stringify(room?.conceptAnswers || {});
    room = fresh;
    connected = true;
    cacheMembership();
    timerOffset = fresh.timer.serverNow - Date.now();
    if (presentation) {
      renderLesson();
      renderProjection();
    } else if (session.role === "host") {
      renderTeacherLive();
      if ($("#lesson").classList.contains("active")) renderLesson();
    } else {
      if (fresh.sync && oldStage !== fresh.stage) {
        if (document.activeElement?.matches("textarea,input,select")) {
          editing = true;
          showStageNotice();
        } else {
          currentTab = fresh.config.steps[fresh.stage].tab;
          renderBook();
        }
      }
      renderStatus();
      if (oldAnswers !== JSON.stringify(fresh.conceptAnswers || {}))
        renderConceptAnswers();
      if (JSON.stringify(fresh.config) !== lastConfig) {
        lastConfig = JSON.stringify(fresh.config);
        schedule();
        if (!document.activeElement?.matches("textarea,input,select"))
          renderBook();
      }
      if (currentTab === "style" || currentTab === "summary") {
        clearTimeout(boardTimer);
        boardTimer = setTimeout(loadBoard, 150);
      }
    }
    renderConnection();
  });
  eventSource.onerror = () => {
    connected = false;
    renderConnection();
  };
  eventSource.onopen = () => {
    connected = true;
    renderConnection();
    flush();
  };
}
function renderConnection() {
  const bar = $("#connection-bar");
  bar.hidden = connected || (!session && !presentation);
  bar.textContent =
    "연결을 다시 시도하고 있어요. 열린 워크북에서 작성한 내용은 이 기기에 보관됩니다. 창을 닫지 말고 연결 후 저장 상태를 확인하세요.";
}
window.addEventListener("offline", () => {
  connected = false;
  renderConnection();
});
window.addEventListener("online", () => {
  flush();
  if (session || presentation) connect();
});
window.addEventListener("pagehide", () => localSave());
function showStageNotice() {
  const b = $("#activity-banner");
  b.replaceChildren(
    el(
      "p",
      "강의가 " +
        config().steps[room.stage].title +
        " 단계로 이동했어요. 작성 중인 내용은 그대로 유지돼요.",
    ),
    button("저장하고 현재 단계로", () => {
      localSave();
      editing = false;
      currentTab = config().steps[room.stage].tab;
      renderBook();
    }),
  );
  b.classList.add("stage-pending");
}
function renderStatus() {
  if (!session) return;
  const b = $("#activity-banner");
  if (editing) {
    showStageNotice();
    return;
  }
  b.classList.remove("stage-pending");
  b.replaceChildren();
  const p = el("p");
  p.append(
    el(
      "b",
      room.ended ? "수업 종료" : room.active ? "활동 진행 중" : "함께 준비해요",
    ),
    document.createTextNode(" · " + config().steps[room.stage].title),
  );
  b.append(p);
  const row = el("div", undefined, "activity-status");
  row.append(
    el(
      "span",
      room.sync
        ? "강사 단계 연결 켜짐 · 이전 기록도 확인 가능"
        : "자유롭게 워크북을 살펴보세요",
    ),
    el("b", "", "live-time"),
  );
  b.append(row);
  if (room.ended)
    b.append(
      el(
        "small",
        "기록과 피드백을 내려받아 보관해주세요. 이 수업에서는 새 기록을 받지 않습니다.",
      ),
    );
  $("#group").disabled = true;
  if (session.member) {
    $("#group").value = session.member.group + "조";
    $("#group-status").textContent = session.member.name + " · 참여 후 조 고정";
    $("#storage-note").textContent =
      "기기에 먼저 저장하고 서버에도 자동 저장해요. 브라우저 데이터를 지우기 전에는 결과지를 내려받아 주세요.";
  }
  if (conflict) renderRecovery();
}
function renderRecovery() {
  const b = $("#activity-banner");
  if ($("#conflict-recovery")) return;
  const p = el("div", undefined, "recovery");
  p.id = "conflict-recovery";
  p.append(
    el(
      "p",
      "다른 탭에서 저장한 기록과 차이가 있어요. 먼저 현재 기록을 내려받고 서버 기록을 불러오세요.",
    ),
    button("현재 기기 기록 내려받기", () => downloadNotes()),
    button("서버 기록 불러오기", async () => {
      if (
        !confirm(
          "현재 입력을 먼저 내려받았나요? 서버에 저장된 기록으로 이 화면을 바꿉니다.",
        )
      )
        return;
      const s = await api();
      book = s.book;
      version = s.version;
      dirty = false;
      pending = null;
      conflict = false;
      localSave();
      renderBook();
    }),
  );
  b.append(p);
}
function tab(name) {
  localSave();
  currentTab = name;
  renderBook();
  if (innerWidth < 700)
    $(".workbook-paper").scrollIntoView({ behavior: "smooth", block: "start" });
}
$$("[data-tab]").forEach((b) => (b.onclick = () => tab(b.dataset.tab)));
$("#group").onchange = () => {
  if (!session) notify("개인 연습에서는 조별 연결이 되지 않아요.");
};
function renderBook() {
  if (session?.role === "host") return;
  const nav = $(".workbook-aside .steps");
  nav.replaceChildren();
  config().steps.forEach((s, i) => {
    const b = button("", () => tab(s.tab), "");
    b.dataset.tab = s.tab;
    b.append(
      document.createTextNode(String(i + 1).padStart(2, "0") + " "),
      el("span", s.title),
    );
    b.classList.toggle("active", s.tab === currentTab);
    nav.append(b);
  });
  $$(".tab").forEach((e) =>
    e.classList.toggle("active", e.id === "tab-" + currentTab),
  );
  $$("[data-tab]").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === currentTab),
  );
  const step = C.steps.find((s) => s.tab === currentTab);
  $("#step-label").textContent = String((step?.id || 0) + 1).padStart(2, "0");
  renderStatus();
  renderFavorites();
  renderObservation();
  renderConcepts();
  renderSupporting();
  renderWords();
  $("#image-note").value = book.imageNote || "";
  if (currentTab === "style") loadBoard();
  if (currentTab === "summary") renderSummary();
}
function renderFavorites() {
  const box = $("#favorite-colors");
  box.replaceChildren();
  C.palette.forEach((c, i) => {
    const b = button(
      "",
      () => {
        if (book.favorites.includes(i))
          book.favorites = book.favorites.filter((n) => n !== i);
        else if (book.favorites.length < 3) book.favorites.push(i);
        book.completed = false;
        saveBook();
        renderFavorites();
      },
      "",
    );
    b.style.setProperty("--c", c.hex);
    b.setAttribute("aria-label", c.name);
    const n = book.favorites.indexOf(i);
    b.classList.toggle("selected", n >= 0);
    b.setAttribute("aria-pressed", String(n >= 0));
    b.append(el("span", n >= 0 ? String(n + 1) : ""));
    box.append(b);
  });
  $("#selected-colors").replaceChildren();
  $("#selected-colors").hidden = true;
  $("#finish-favorite").disabled = book.favorites.length !== 3;
  $("#finish-favorite").textContent =
    book.favorites.length === 3
      ? "완료"
      : `좋아하는 색 ${3 - book.favorites.length}개를 더 골라주세요`;
  $("#character-result").hidden = !book.completed;
  if (book.completed && book.favorites.length === 3) {
    ["hat", "top", "pants"].forEach((id, i) =>
      $("#" + id).setAttribute("fill", C.palette[book.favorites[i]].hex),
    );
    $("#hair").setAttribute(
      "d",
      book.gender === "female"
        ? "M93 54Q73 69 80 128L100 134L102 92L142 92L143 133L163 126Q169 66 144 53Z"
        : "M93 54Q75 80 88 115L102 105L102 65L145 65L149 108Q167 66 144 53Z",
    );
  }
  $$("[data-gender]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.gender === book.gender);
    b.setAttribute("aria-pressed", String(b.dataset.gender === book.gender));
  });
}
$$("[data-gender]").forEach(
  (b) =>
    (b.onclick = () => {
      book.gender = b.dataset.gender;
      book.completed = false;
      saveBook();
      renderFavorites();
    }),
);
$("#finish-favorite").onclick = () => {
  if (book.favorites.length !== 3) return;
  book.completed = true;
  saveBook();
  renderFavorites();
  $("#character-result").scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
};
function family() {
  return (
    config().families.find((f) => f.id === familyId) || config().families[0]
  );
}
function record() {
  const f = family();
  familyId = f.id;
  const r =
    book.records[f.id] ||
    (book.records[f.id] = {
      self: "",
      peer: [],
      selfNote: "",
      peerNote: "",
      familyName: f.name,
      colorLabels: {},
    });
  r.familyName = f.name;
  for (const c of f.colors)
    if (!r.colorLabels[c.id])
      r.colorLabels[c.id] = c.name + " · " + config().seasons[c.season];
  return r;
}
const optionNames = {
  similar: "비슷해요",
  unsure: "잘 모르겠어요",
  again: "다시 비교할게요",
};
function observationChoice(who, id, label, r, box) {
  const selected = who === "self" ? r.self === id : r.peer.includes(id);
  const b = button(
    label,
    () => {
      if (who === "self") r.self = r.self === id ? "" : id;
      else
        r.peer = r.peer.includes(id)
          ? r.peer.filter((v) => v !== id)
          : [...r.peer, id];
      saveBook();
      renderObservation();
    },
    "",
  );
  b.classList.toggle("selected", selected);
  b.setAttribute("aria-pressed", String(selected));
  box.append(b);
}
function renderObservation() {
  const f = family(),
    r = record();
  $(".family-tabs").replaceChildren();
  config().families.forEach((item, i) => {
    const b = button(
      String(i + 1).padStart(2, "0") + " " + item.name,
      () => {
        familyId = item.id;
        renderObservation();
      },
      "",
    );
    b.dataset.family = item.id;
    b.classList.toggle("active", item.id === f.id);
    b.setAttribute("aria-pressed", String(item.id === f.id));
    $(".family-tabs").append(b);
  });
  $(".example-label").textContent = config().kitConfirmed
    ? "실물 키트 기준 · 화면 색은 안내용"
    : "수업용 예시 색 · 강사가 실물 키트 구성을 확인하기 전입니다.";
  $("#observe-swatches").replaceChildren();
  f.colors.forEach((c, i) => {
    const e = el("div");
    e.style.background = c.hex;
    e.style.color = ink(c.hex);
    e.append(el("strong", c.name), el("small", config().seasons[c.season]));
    $("#observe-swatches").append(e);
  });
  for (const who of ["self", "peer"]) {
    const box = $("#" + who + "-options");
    box.replaceChildren();
    f.colors.forEach((c) => observationChoice(who, c.id, c.name, r, box));
    Object.entries(optionNames).forEach(([id, label]) =>
      observationChoice(who, id, label, r, box),
    );
    $("#" + who + "-note").value = r[who + "Note"] || "";
  }
  $("#next-family").textContent =
    config().families.indexOf(f) === config().families.length - 1
      ? "기록하고 나의 발견 모아보기 →"
      : "기록하고 다음 색상으로 →";
}
for (const who of ["self", "peer"])
  $("#" + who + "-note").oninput = (e) => {
    record()[who + "Note"] = e.target.value;
    saveBook();
  };
$("#next-family").onclick = () => {
  saveBook();
  const i = config().families.indexOf(family());
  if (i === config().families.length - 1) tab("summary");
  else {
    familyId = config().families[i + 1].id;
    renderObservation();
  }
};
function ink(hex) {
  const [r, g, b] = hex.match(/[a-f0-9]{2}/gi).map((v) => parseInt(v, 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 145 ? "#292a27" : "#ffffff";
}
function heading(box, eyebrow, title, desc) {
  box.replaceChildren(
    el("p", eyebrow, "eyebrow"),
    el("h2", title),
    el("p", desc, "muted"),
  );
}
function conceptPick(box, id, question, options) {
  const section = el("section", undefined, "concept-block");
  section.dataset.concept = id;
  section.append(el("h3", question));
  const row = el("div", undefined, "choice-row");
  for (const [value, label, color] of options) {
    const b = button(
      label,
      () => {
        book.concepts[id] = value;
        saveBook();
        renderConcepts();
      },
      "",
    );
    if (color) {
      const chip = el("i", undefined, "small-chip");
      chip.style.background = color;
      b.prepend(chip);
    }
    b.classList.toggle("selected", book.concepts[id] === value);
    b.setAttribute("aria-pressed", String(book.concepts[id] === value));
    row.append(b);
  }
  section.append(row);
  box.append(section);
}
function renderConcepts() {
  const box = $("#tab-concepts");
  heading(
    box,
    "COLOR LAB",
    "색을 나누어 살펴봐요.",
    "먼저 답을 고르고 이유를 이야기해보세요. 강사가 정답을 공개하면 답과 해설을 함께 확인할 수 있어요.",
  );
  conceptPick(box, "hue", "01 · 이 색은 어떤 계열인가요?", [
    ["red", "빨강 계열", "#c85353"],
    ["green", "초록 계열", "#5d936d"],
    ["blue", "파랑 계열", "#557cae"],
  ]);
  const target = el("div", undefined, "concept-target");
  target.style.background = "#5376a5";
  target.textContent = "이 색을 보고 위에서 선택해요.";
  target.style.color = "#fff";
  box.querySelector(".concept-block").append(target);
  const section = el("section", undefined, "concept-block");
  section.dataset.concept = "brightness";
  section.append(
    el("h3", "02 · 밝은 순서로 배열해보세요."),
    el("p", "위가 밝은 쪽, 아래가 어두운 쪽이에요.", "muted"),
  );
  const items = [
    { id: "dark", color: "#30415f" },
    { id: "light", color: "#e3e8f0" },
    { id: "midDark", color: "#607795" },
    { id: "midLight", color: "#9dadc4" },
  ];
  const order = Array.isArray(book.concepts.brightness)
    ? book.concepts.brightness
    : ["midDark", "light", "dark", "midLight"];
  order.forEach((id, i) => {
    const c = items.find((c) => c.id === id);
    if (!c) return;
    const row = el("div", undefined, "sort-row");
    const chip = el("span", String(i + 1));
    chip.style.background = c.color;
    chip.style.color = ink(c.color);
    row.append(chip);
    for (const [d, label] of [
      [-1, "위로"],
      [1, "아래로"],
    ]) {
      const b = button(label, () => {
        const next = [...order];
        [next[i], next[i + d]] = [next[i + d], next[i]];
        book.concepts.brightness = next;
        saveBook();
        renderConcepts();
      });
      b.disabled = i + d < 0 || i + d >= order.length;
      row.append(b);
    }
    section.append(row);
  });
  box.append(section);
  conceptPick(box, "chroma", "03 · 어느 쪽이 더 선명하게 느껴지나요?", [
    ["vivid", "A", "#b56979"],
    ["muted", "B", "#95777c"],
    ["unsure", "잘 모르겠다"],
  ]);
  conceptPick(box, "tone", "04 · 밝고 부드러운 느낌과 가까운 색은?", [
    ["soft", "A", "#ecd1d7"],
    ["deep", "B", "#725963"],
    ["unsure", "잘 모르겠다"],
  ]);
  conceptPick(box, "temperature", "05 · 더 따뜻하게 느껴지는 쪽은?", [
    ["warm", "A", "#bf6955"],
    ["cool", "B", "#b74f72"],
    ["similar", "비슷해요"],
  ]);
  const label = el(
    "label",
    "왜 그렇게 느꼈나요? 실물에서 어떤 색과 비슷했나요?",
    "field-label",
  );
  label.htmlFor = "concept-reason";
  const t = el("textarea");
  t.id = "concept-reason";
  t.rows = 3;
  t.value = book.concepts.reason || "";
  t.placeholder = "밝은 색과 선명한 색이 달랐던 점도 남겨보세요.";
  t.oninput = () => {
    book.concepts.reason = t.value;
    saveBook();
  };
  box.append(
    label,
    t,
    el(
      "p",
      "화면 색은 개념 학습용입니다. 채도 비교 예시는 색상과 지각 밝기를 비슷하게 맞췄지만 기기에 따라 달라요.",
      "privacy-note",
    ),
  );
  renderFeltComparison(box);
  renderConceptAnswers();
}

function renderFeltComparison(box) {
  const section = el("section", undefined, "concept-section");
  section.id = "felt-comparison";
  section.append(
    el("p", "실물 탐구 · 약 15분", "eyebrow"),
    el("h3", "비슷한 두 색, 얼굴에서는 어떻게 다를까요?"),
    el(
      "p",
      "헷갈리는 펠트지 두 장을 골라 A·B라고 불러요. 색의 차이를 설명하는 연습을 하고, 얼굴 가까이에 두었을 때의 변화까지 확인해요.",
    ),
  );
  const steps = el("ol", undefined, "observation-list");
  [
    "3분 · 비슷해 보이는 두 장을 골라 나란히 놓아요. 색상·밝기·선명함 중 어떤 차이가 있나요?",
    "4분 · 같은 자리와 조명에서 얼굴 아래에 A와 B를 번갈아 대봐요. 거울로 먼저 관찰하고 조원의 의견을 들어요.",
    "5분 · 두 펠트지만 나란히 크게 촬영하고, 아래에 차이와 관찰을 기록해요. 얼굴 사진은 필요 없어요.",
    "3분 · 조원과 발견을 나눠요. 다음에 옷이나 화장품을 고를 때 무엇을 비교해보고 싶나요?",
  ].forEach((text) => steps.append(el("li", text)));
  section.append(steps);
  const fields = [
    [
      "feltA",
      "A · 내가 알아볼 수 있는 색 이름",
      "예: 노란 기가 있는 연한 분홍",
    ],
    [
      "feltB",
      "B · 내가 알아볼 수 있는 색 이름",
      "예: 푸른 기가 있는 연한 분홍",
    ],
    [
      "feltDifference",
      "두 색은 어떻게 달랐나요?",
      "A가 더 밝다 / B가 더 선명하다 / 비슷하다 / 잘 모르겠다와 그 이유",
    ],
    [
      "feltSelf",
      "내가 본 얼굴의 변화",
      "피부의 균일함, 눈 밑·입가 그림자 등을 적어요. 차이가 없거나 모르겠어도 괜찮아요.",
    ],
    [
      "feltPeer",
      "조원이 본 변화 · 다른 의견도 함께",
      "예: 나는 비슷했지만 조원은 B에서 입가 그림자가 덜 보인다고 했어요.",
    ],
    [
      "feltNext",
      "다음에 색을 고를 때 확인할 점",
      "예: 비슷한 분홍 립도 밝기뿐 아니라 노란 기와 푸른 기를 비교해보기",
    ],
  ];
  for (const [id, title, hint] of fields) {
    const label = el("label", title, "field-label");
    label.htmlFor = id;
    const input = el("textarea");
    input.id = id;
    input.rows = 2;
    input.maxLength = 2000;
    input.placeholder = hint;
    input.value = book.concepts[id] || "";
    input.oninput = () => {
      book.concepts[id] = input.value;
      saveBook();
    };
    section.append(label, input);
  }
  section.append(
    el(
      "p",
      "기록은 내 워크북에 자동 저장되고 PDF에도 남아요. 사진은 아래 공유 버튼을 눌렀을 때만 같은 조와 강사에게 공개됩니다. 촬영 색으로 정확한 색이나 계절을 판정하지 않아요.",
      "privacy-note",
    ),
  );
  const file = el("input");
  file.type = "file";
  file.accept = "image/jpeg,image/png,image/webp";
  file.id = "felt-photo";
  file.setAttribute("aria-label", "펠트지 A 사진 또는 A·B를 함께 찍은 사진");
  const secondFile = el("input");
  secondFile.type = "file";
  secondFile.accept = file.accept;
  secondFile.id = "felt-photo-b";
  secondFile.setAttribute("aria-label", "펠트지 B 사진");
  const photoStatus = el(
    "p",
    "A·B를 함께 찍은 사진 1장 또는 각각 찍은 사진 2장을 올릴 수 있어요.",
    "privacy-note",
  );
  photoStatus.id = "felt-photo-status";
  photoStatus.setAttribute("role", "status");
  const preview = el("img");
  preview.hidden = true;
  preview.alt = "두 펠트지 비교 사진 미리보기";
  preview.style.maxWidth = "100%";
  let photo = null,
    request = null;
  let photoRevision = 0,
    processing = false;
  file.onchange = secondFile.onchange = async () => {
    const revision = ++photoRevision;
    request = null;
    photo = null;
    processing = true;
    preview.hidden = true;
    photoStatus.textContent = "사진을 준비하고 있어요…";
    try {
      const files = [file.files[0], secondFile.files[0]].filter(Boolean);
      const prepared = await Promise.all(files.map(prepareImage));
      let combined = prepared[0] || null;
      if (prepared.length === 2) {
        const images = await Promise.all(
          prepared.map(
            (src) =>
              new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = () =>
                  reject(
                    new Error("사진을 읽을 수 없어요. 다시 선택해주세요."),
                  );
                image.src = src;
              }),
          ),
        );
        const canvas = document.createElement("canvas");
        canvas.width = 1600;
        canvas.height = 1000;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#f5f5f7";
        ctx.fillRect(0, 0, 1600, 1000);
        images.forEach((image, i) => {
          const scale = Math.min(760 / image.width, 900 / image.height);
          const width = image.width * scale,
            height = image.height * scale;
          ctx.drawImage(
            image,
            i * 800 + 20 + (760 - width) / 2,
            80 + (900 - height) / 2,
            width,
            height,
          );
          ctx.fillStyle = "#1d1d1f";
          ctx.font = "32px sans-serif";
          ctx.fillText(i === 0 ? "A" : "B", i * 800 + 24, 50);
        });
        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.85),
        );
        combined = await prepareImage(
          new File([blob], "felt-comparison.jpg", { type: "image/jpeg" }),
        );
      }
      if (revision !== photoRevision) return;
      photo = combined;
      preview.src = photo || "";
      preview.hidden = !photo;
      photoStatus.textContent =
        files.length === 2
          ? "사진 2장 준비 완료 · 왼쪽 A, 오른쪽 B로 묶어 공유하고 PDF에도 저장해요."
          : files.length
            ? "사진 1장 준비 완료 · 다른 사진은 아래 B에 추가할 수 있어요."
            : "사진을 선택해주세요.";
    } catch (e) {
      if (revision !== photoRevision) return;
      photo = null;
      photoStatus.textContent = "사진을 준비하지 못했어요. 다시 선택해주세요.";
      report(e);
    } finally {
      if (revision === photoRevision) processing = false;
    }
  };
  const share = button("사진과 비교 기록을 우리 조에 공유", async () => {
    if (processing) return notify("사진 준비가 끝나면 공유해주세요.");
    if (!photo) return notify("먼저 펠트지 사진을 선택해주세요.");
    if (!session?.member || !room?.boardOpen || room.ended)
      return notify(
        "수업에 참여하고 강사가 공유 활동을 열면 올릴 수 있어요. 글 기록은 자동 저장돼요.",
      );
    share.disabled = true;
    try {
      const reason =
        "[두 펠트지 비교]\n" +
        fields
          .map(
            ([id, title]) => title + ": " + (book.concepts[id] || "기록 없음"),
          )
          .join("\n");
      if (reason.length > 1500)
        throw new Error(
          "사진에 함께 올릴 기록은 총 1,500자 이내로 줄여주세요. 원래 기록은 워크북에 보관됩니다.",
        );
      request ||= {
        reason,
        image: photo,
        words: [],
        consent: false,
        writeId: crypto.randomUUID(),
      };
      await api("board", "POST", request);
      request = null;
      photo = null;
      file.value = "";
      secondFile.value = "";
      photoStatus.textContent =
        "사진을 공유했어요. 새 비교 사진도 올릴 수 있어요.";
      preview.hidden = true;
      notify("같은 조에 공유했어요. 사진과 기록은 마지막 PDF에도 포함돼요.");
      await loadBoard();
    } catch (e) {
      report(e);
    } finally {
      share.disabled = false;
    }
  });
  const firstLabel = el(
    "label",
    "사진 A · 두 펠트지를 함께 찍었다면 여기에 1장만",
    "field-label",
  );
  firstLabel.htmlFor = file.id;
  const secondLabel = el(
    "label",
    "사진 B · 따로 찍었을 때 추가 (선택)",
    "field-label",
  );
  secondLabel.htmlFor = secondFile.id;
  section.append(
    firstLabel,
    file,
    secondLabel,
    secondFile,
    photoStatus,
    preview,
    share,
    el(
      "p",
      "발표 공개는 기본으로 꺼져 있어요. 공유 화면에서 본인이 동의할 수 있어요. 업로드 전 새로고침하면 사진을 다시 선택해주세요.",
      "privacy-note",
    ),
  );
  box.append(section);
}

function renderConceptAnswers() {
  $$("#tab-concepts [data-concept]").forEach((section) => {
    let answerBox = section.querySelector(".concept-answer");
    if (!answerBox) {
      answerBox = el("div", undefined, "concept-answer");
      answerBox.setAttribute("role", "status");
      section.append(answerBox);
    }
    const answer = room?.conceptAnswers?.[section.dataset.concept];
    answerBox.hidden = !answer;
    answerBox.replaceChildren();
    if (!answer) return;
    answerBox.append(
      el("b", "정답 · " + answer.label),
      el("p", answer.explanation),
    );
    if (answer.swatches) {
      const row = el("div", undefined, "answer-swatches");
      answer.swatches.forEach((c) => {
        const chip = el("span", c.name);
        chip.style.background = c.hex;
        chip.style.color = ink(c.hex);
        row.append(chip);
      });
      answerBox.append(row);
    }
  });
}
function renderTeacherAnswers() {
  if (!$("#concept-controls")) return;
  const box = $("#concept-controls");
  box.replaceChildren();
  Object.entries(room.conceptAnswerKey || {}).forEach(([id, answer]) => {
    const row = el("div", undefined, "answer-control");
    const copy = el("div");
    copy.append(
      el("b", answer.number + "번 · " + answer.title),
      el("p", "정답: " + answer.label),
    );
    const revealed = !!room.conceptAnswers?.[id];
    const toggle = button(revealed ? "정답 숨기기" : "정답 공개", () =>
      control("concept-answer", { question: id, value: !revealed }),
    );
    toggle.dataset.answerQuestion = id;
    toggle.setAttribute(
      "aria-label",
      answer.number + "번 " + (revealed ? "정답 숨기기" : "정답 공개"),
    );
    toggle.setAttribute("aria-pressed", String(revealed));
    toggle.disabled = room.ended;
    row.append(copy, toggle);
    box.append(row);
  });
}

function renderSupporting() {
  heading(
    $("#tab-basics"),
    "THE FOUR SEASONS",
    "색을 이해하는 네 가지 언어.",
    "피부가 밝거나 어둡다는 사실만으로 웜·쿨을 정하지 않아요. 계절은 관찰한 색의 특성을 설명하는 도구예요.",
  );
  const basics = el("div", undefined, "season-grid");
  [
    ["봄 느낌", "맑고 따뜻한", "#df8b79", "#e9d47c"],
    ["여름 느낌", "부드럽고 시원한", "#b4a6cb", "#829eb9"],
    ["가을 느낌", "깊고 차분한", "#ad6246", "#86895e"],
    ["겨울 느낌", "선명하고 또렷한", "#3558bb", "#7b3549"],
  ].forEach(([n, d, a, b]) => {
    const e = el("article");
    e.append(el("h3", n), el("p", d));
    const sw = el("div", undefined, "palette");
    for (const c of [a, b]) {
      const i = el("i");
      i.style.setProperty("--c", c);
      sw.append(i);
    }
    e.append(sw);
    basics.append(e);
  });
  $("#tab-basics").append(
    basics,
    el(
      "p",
      "위 팔레트는 개념 예시입니다. 실제 실습의 계절 이름과 비교색은 강사 설정을 따릅니다.",
      "muted",
    ),
  );
  heading(
    $("#tab-demo"),
    "LOOK CLOSELY",
    "얼굴의 작은 변화를 관찰해요.",
    "전문 진단을 대신하는 시간이 아니라 나와 조원이 함께 관찰하는 시간이에요.",
  );
  const checklist = el("ol", undefined, "observation-list");
  [
    "같은 자리와 방향을 유지해요. 직사광선이나 강한 색 반사를 피하세요.",
    "천을 얼굴 아래 같은 높이에 대고 번갈아 비교해요.",
    "피부가 균일해 보이나요? 붉은 기·노란 기가 더 도드라지나요?",
    "눈 밑과 입가의 그림자, 윤곽과 이목구비를 살펴봐요.",
    "얼굴보다 천 색이 먼저 눈에 들어오나요?",
    "모델이 먼저 말하고 조원이 이유를 덧붙여요. 모르겠다는 답도 남겨요.",
  ].forEach((t) => checklist.append(el("li", t)));
  $("#tab-demo").append(checklist);
  const l = el("label", "오늘의 비교 조건", "field-label");
  l.htmlFor = "conditions";
  const t = el("textarea");
  t.id = "conditions";
  t.rows = 3;
  t.value = book.conditions || "";
  t.placeholder =
    "예: 창가에서 간접광, 평소 화장 유지. 화장 제거는 필수가 아니에요.";
  t.oninput = () => {
    book.conditions = t.value;
    saveBook();
  };
  $("#tab-demo").append(l, t);
  heading(
    $("#tab-roles"),
    "WORK AS A TEAM",
    "서로의 관찰자가 되어줘요.",
    "5~6명씩 역할을 돌아가며 맡아요. 6명 기준 1인 약 10분, 마지막 10분은 재비교에 써요.",
  );
  const row = el("div", undefined, "choice-row");
  ["모델", "천 교체", "관찰", "기록 안내"].forEach((role) => {
    const b = button(
      role,
      () => {
        book.role = role;
        saveBook();
        renderSupporting();
      },
      "",
    );
    b.classList.toggle("selected", book.role === role);
    row.append(b);
  });
  $("#tab-roles").append(
    row,
    el(
      "p",
      "한 사람당 빨강·핑크·초록·파랑 약 2분씩, 전환과 기록 2분을 기준으로 조율해요. 다음 모델에게 키트를 전달하면서 역할도 바꿔요.",
      "observation-guide",
    ),
  );
  heading(
    $("#tab-break"),
    "TAKE A BREAK",
    "눈도 잠시 쉬어가요.",
    "기록은 그대로 보관돼요. 잠깐 화면을 내려놓고 쉬었다가 원하는 스타일을 찾아봐요.",
  );
}
function renderWords() {
  let combos = $("#image-combinations");
  if (!combos) {
    combos = el("div");
    combos.id = "image-combinations";
    $(".image-scale").after(combos);
  }
  combos.replaceChildren(
    el("h3", "어떤 색 조합이 원하는 이미지와 연결되나요?"),
  );
  const row = el("div", undefined, "combination-choices");
  [
    ["warm-soft", "따뜻하고 부드러운", ["#e9c393", "#eadaca"]],
    ["cool-soft", "시원하고 부드러운", ["#b4a6cb", "#a5bacb"]],
    ["warm-strong", "따뜻하고 또렷한", ["#ad6246", "#86895e"]],
    ["cool-strong", "시원하고 또렷한", ["#3558bb", "#7b3549"]],
  ].forEach(([id, label, colors]) => {
    const b = button(
      label,
      () => {
        book.concepts.imageCombination = label;
        saveBook();
        renderWords();
      },
      "",
    );
    const sw = el("div", undefined, "combination-swatches");
    colors.forEach((c) => {
      const i = el("i");
      i.style.background = c;
      sw.append(i);
    });
    b.prepend(sw);
    b.classList.toggle("selected", book.concepts.imageCombination === label);
    row.append(b);
  });
  combos.append(row);
  const box = $("#image-words");
  box.replaceChildren();
  ["차분한", "활기찬", "세련된", "부드러운", "편안한", "또렷한"].forEach(
    (word) => {
      const b = button(
        word,
        () => {
          book.words = book.words.includes(word)
            ? book.words.filter((w) => w !== word)
            : [...book.words, word];
          saveBook();
          renderWords();
        },
        "",
      );
      b.classList.toggle("selected", book.words.includes(word));
      b.setAttribute("aria-pressed", String(book.words.includes(word)));
      box.append(b);
    },
  );
}
$("#image-note").oninput = (e) => {
  book.imageNote = e.target.value;
  saveBook();
};
function labelChoice(id, r) {
  return (
    optionNames[id] || r.colorLabels?.[id] || "과거 설정의 색 (" + id + ")"
  );
}
function summaryText() {
  const lines = [
    "나의 컬러 노트",
    new Date().toLocaleString("ko-KR"),
    session?.member
      ? session.member.name + " · " + session.member.group + "조"
      : "개인 연습",
    "처음 좋아한 색: " +
      book.favorites.map((i) => C.palette[i].name).join(", "),
    "원하는 이미지: " + book.words.join(", "),
    "이미지와 연결한 조합: " +
      (book.concepts.imageCombination || "아직 선택하지 않음"),
    "연결하고 싶은 스타일: " + book.imageNote,
    "비교 조건: " + book.conditions,
    "",
  ];
  lines.push(
    "[두 펠트지 비교]",
    ...Object.entries(book.concepts)
      .filter(([id]) => id.startsWith("felt"))
      .map(([id, value]) => id + ": " + value),
    "",
  );
  const counts = new Map(),
    disagree = [],
    revisit = [];
  for (const [id, r] of Object.entries(book.records)) {
    if (!r.self && !r.peer?.length && !r.selfNote && !r.peerNote) continue;
    const name = r.familyName || id;
    lines.push(
      "[" + name + "]",
      "나의 관찰: " + labelChoice(r.self, r),
      "내 메모: " + (r.selfNote || "기록 없음"),
      "조원의 관찰: " +
        (r.peer?.map((v) => labelChoice(v, r)).join(", ") || "기록 없음"),
      "조원 메모: " + (r.peerNote || "기록 없음"),
      "",
    );
    if (r.self && r.peer?.length && !r.peer.includes(r.self))
      disagree.push(name);
    if (r.self === "again" || r.peer?.includes("again") || r.self === "unsure")
      revisit.push(name);
    const c = config()
      .families.find((f) => f.id === id)
      ?.colors.find((c) => c.id === r.self);
    if (c) {
      const label = config().seasons[c.season];
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  lines.push(
    "반복해서 관찰한 색 이름: " +
      ([...counts]
        .filter(([, n]) => n > 1)
        .map(([n, count]) => n + " 계열 느낌 " + count + "회")
        .join(", ") || "아직 반복 경향을 정리할 기록이 부족해요."),
    "의견이 달랐던 색상: " + (disagree.join(", ") || "기록상 없음"),
    "다시 비교할 색상: " + (revisit.join(", ") || "기록상 없음"),
    "",
  );
  lines.push(
    "오늘 자연스럽다고 기록한 색: " +
      Object.values(book.records)
        .filter((r) => r.self && !optionNames[r.self])
        .map((r) => (r.familyName || "색상") + " · " + labelChoice(r.self, r))
        .join(", "),
    "실생활에 적용해보기",
    "상의: 반복해서 자연스럽다고 느낀 색을 얼굴 가까이에 대보고 골라요.",
    "하의·소품: 처음 좋아했던 색을 작은 면적으로 섞어보세요.",
    "액세서리·안경: 프레임이 얼굴보다 먼저 보이는지 실제 착용해 비교해요.",
    "메이크업: 오늘 관찰한 색의 온도·밝기·선명함을 참고해 립·블러셔를 직접 발색해요. 같은 이름의 제품도 색이 다를 수 있어요.",
    "브랜드나 제품 효능을 보장하는 추천이 아닌 색 선택 가이드입니다.",
    "",
  );
  const own = boardPosts.filter((p) => p.owner);
  lines.push("내 스타일 게시물과 받은 피드백");
  for (const p of own) {
    lines.push(
      "선택 이유: " + p.reason,
      "원하는 이미지: " + p.words.join(", "),
    );
    for (const c of p.comments) lines.push(c.name + ": " + c.text);
  }
  if (!own.length)
    lines.push(
      session
        ? "게시판을 불러온 뒤 받은 피드백을 확인해주세요."
        : "수업에 참여하면 같은 조 피드백을 함께 모을 수 있어요.",
    );
  lines.push(
    "",
    "좋아하는 색에 담긴 나의 이야기: " +
      (book.reflection?.favoriteReason || "기록 없음"),
    "오늘 새롭게 발견한 점: " + (book.reflection?.discovery || "기록 없음"),
    "다음에 시도해보고 싶은 조합: " + (book.reflection?.nextTry || "기록 없음"),
    "이 기록은 실물 색 비교의 관찰 노트이며 전문 진단이나 계절 유형 확정 결과가 아닙니다. 조명과 주변 조건에 따라 달라질 수 있어요.",
  );
  return lines.join("\n");
}
function renderReflection() {
  const box = $("#final-reflection");
  if (!box) return;
  if (!box.children.length) {
    box.append(el("h3", "오늘의 발견을 남겨보세요."));
    for (const [id, label, placeholder] of [
      [
        "favoriteReason",
        "좋아하는 색에 담긴 나의 이야기",
        "왜 이 색을 좋아하나요? 어떻게 사용하고 싶나요?",
      ],
      [
        "discovery",
        "오늘 새롭게 발견한 점",
        "실물 비교에서 새롭게 알게 된 점을 남겨보세요.",
      ],
      [
        "nextTry",
        "다음에 시도해보고 싶은 색과 조합",
        "다음에 입어보고 싶은 옷이나 시도할 조합을 적어보세요.",
      ],
    ]) {
      const caption = el("label", label, "field-label");
      caption.htmlFor = "reflection-" + id;
      const input = el("textarea");
      input.id = "reflection-" + id;
      input.rows = 3;
      input.maxLength = 2000;
      input.placeholder = placeholder;
      input.oninput = () => {
        book.reflection ||= {};
        book.reflection[id] = input.value;
        saveBook();
      };
      box.append(caption, input);
    }
  }
  for (const id of ["favoriteReason", "discovery", "nextTry"]) {
    const input = $("#reflection-" + id);
    if (input !== document.activeElement)
      input.value = book.reflection?.[id] || "";
  }
}
function renderSummary() {
  renderReflection();
  const box = $("#summary-content");
  box.replaceChildren();
  const pre = el("div", summaryText(), "summary-text");
  box.append(pre);
  if (session?.role === "member") loadBoard();
}
async function downloadNotes() {
  if (session?.role === "member") {
    try {
      boardPosts = (await api("board")).posts;
    } catch {
      notify("연결이 없어 마지막으로 불러온 피드백까지 저장해요.", true);
    }
  }
  const url = URL.createObjectURL(
      new Blob([summaryText()], { type: "text/plain;charset=utf-8" }),
    ),
    a = el("a");
  a.href = url;
  a.download = "나의-컬러-노트.txt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let reportLibraryPromise = null,
  reportFontsPromise = null;
function reportLibrary() {
  if (window.ColorReport) return Promise.resolve(window.ColorReport);
  if (!reportLibraryPromise)
    reportLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/color-studio/report.js";
      script.onload = () => resolve(window.ColorReport);
      script.onerror = () => {
        reportLibraryPromise = null;
        reject(
          Error(
            "PDF 도구를 불러오지 못했어요. 연결을 확인하고 다시 눌러주세요.",
          ),
        );
      };
      document.head.append(script);
    });
  return reportLibraryPromise;
}
async function reportFonts() {
  if (!reportFontsPromise)
    reportFontsPromise = Promise.all(
      ["Regular", "Semibold"].map(async (weight) => {
        const response = await fetch(
          "/color-studio/fonts/Report" + weight + ".ttf",
        );
        if (!response.ok)
          throw Error(
            "PDF 글꼴을 불러오지 못했어요. 연결을 확인하고 다시 눌러주세요.",
          );
        return new Uint8Array(await response.arrayBuffer());
      }),
    ).catch((error) => {
      reportFontsPromise = null;
      throw error;
    });
  const [regular, semibold] = await reportFontsPromise;
  return { regular, semibold };
}
async function imageBytes(source, type = "image/jpeg", max = 1200) {
  let url = source,
    owned = false;
  if (!source.startsWith("blob:") && !source.startsWith("data:")) {
    const response = await fetch(source, { credentials: "same-origin" });
    if (!response.ok)
      throw Error(
        "공유 이미지를 불러오지 못했어요. 연결을 확인하고 PDF 저장을 다시 눌러주세요.",
      );
    url = URL.createObjectURL(await response.blob());
    owned = true;
  }
  try {
    const image = new Image();
    image.src = url;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () =>
        reject(Error("이미지 형식을 확인할 수 없어 PDF 저장을 중단했어요."));
    });
    const scale = Math.min(
      1,
      max / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (type === "image/jpeg") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, type, 0.9),
    );
    if (!blob) throw Error("PDF에 넣을 이미지를 준비하지 못했어요.");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    if (owned) URL.revokeObjectURL(url);
  }
}
async function reportAvatar(snapshot) {
  if (!snapshot.completed || snapshot.favorites.length !== 3) return null;
  const svg = $("#character-result svg").cloneNode(true);
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", "480");
  svg.setAttribute("height", "640");
  ["hat", "top", "pants"].forEach((id, i) =>
    svg
      .querySelector("#" + id)
      .setAttribute("fill", C.palette[snapshot.favorites[i]].hex),
  );
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml",
    }),
  );
  try {
    return await imageBytes(url, "image/png", 640);
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function downloadPdf() {
  const button = $("#download-pdf"),
    status = $("#pdf-status"),
    snapshot = structuredClone(book);
  button.disabled = true;
  button.textContent = "PDF 만드는 중…";
  status.textContent = "기록과 이미지를 모으고 있어요. 잠시만 기다려주세요.";
  try {
    let posts = [];
    if (session?.role === "member") {
      try {
        boardPosts = (await api("board")).posts;
        posts = boardPosts.filter((p) => p.owner === true);
      } catch {
        throw Error(
          "공유 기록과 받은 피드백을 확인할 수 없어 PDF 저장을 중단했어요. 연결 후 다시 눌러주세요. 기기 기록은 아래 텍스트 백업으로 보관할 수 있어요.",
        );
      }
    }
    const images = [];
    for (const post of posts) {
      if (!post.image) continue;
      status.textContent = "공유 이미지를 PDF에 담고 있어요.";
      const source = window.StudioTransport
        ? await window.StudioTransport.imageUrl(code, post.id)
        : apiBase() + "/board/" + post.id + "/image";
      images.push({ id: post.id, bytes: await imageBytes(source) });
    }
    const [module, fonts, avatar] = await Promise.all([
      reportLibrary(),
      reportFonts(),
      reportAvatar(snapshot),
    ]);
    status.textContent = "나만의 컬러 노트를 완성하고 있어요.";
    const result = await module.createReport(
      {
        book: snapshot,
        palette: C.palette,
        config: structuredClone(config()),
        member: session?.member
          ? { name: session.member.name, group: session.member.group }
          : null,
        posts,
        revealed: room?.conceptAnswers || {},
        generatedAt: new Date().toISOString(),
      },
      { ...fonts, images, avatar },
    );
    const url = URL.createObjectURL(
        new Blob([result.bytes], { type: "application/pdf" }),
      ),
      link = el("a");
    link.href = url;
    link.download = "나의-컬러-노트.pdf";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    status.textContent =
      result.pageCount +
      "쪽 PDF를 만들었어요. 기기의 다운로드 또는 파일 앱에서 확인해주세요." +
      (result.unsupportedCount
        ? " 일부 기호는 □로 표시돼요. 텍스트 백업도 함께 보관해주세요."
        : "");
  } catch (error) {
    const message =
      error instanceof TypeError
        ? "이미지나 글꼴을 불러오지 못해 PDF 저장을 중단했어요. 연결을 확인하고 다시 눌러주세요."
        : error.message || "PDF를 저장하지 못했어요. 다시 시도해주세요.";
    status.textContent = message;
    report(Error(message));
  } finally {
    button.disabled = false;
    button.textContent = "나의 컬러 노트 PDF 저장 ↓";
  }
}
$("#download-pdf").onclick = downloadPdf;
$("#download-notes").onclick = () => downloadNotes().catch(report);
$("#print-notes").onclick = async () => {
  if (session?.role === "member")
    try {
      boardPosts = (await api("board")).posts;
    } catch {}
  renderSummary();
  window.print();
};
let uploadData = null,
  uploadRequest = null,
  uploadBusy = false;
async function prepareImage(file) {
  if (!file) return null;
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw Error("JPG·PNG·WebP 원본 10MB 이하를 골라주세요.");
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    let data = canvas.toDataURL("image/jpeg", 0.85);
    if (data.length > 2700000) data = canvas.toDataURL("image/jpeg", 0.6);
    if (data.length > 2700000)
      throw Error("이미지가 큽니다. 필요한 부분만 잘라 다시 올려주세요.");
    return data;
  } finally {
    image.close();
  }
}
let galleryRequest = 0;
async function loadGallery() {
  const list = $("#gallery-posts"),
    revision = ++galleryRequest;
  list.replaceChildren(el("p", "게시물을 불러오고 있어요.", "muted"));
  if (!session) {
    list.replaceChildren(
      el(
        "p",
        "수업에 참여하면 같은 조 학생들이 올린 자료를 볼 수 있어요.",
        "muted",
      ),
      button("수업 참여하기", () => {
        view("home");
        $("#entry-panel").scrollIntoView({ behavior: "smooth" });
      }),
    );
    return;
  }
  try {
    const { posts } = await api("board");
    if (revision !== galleryRequest) return;
    list.replaceChildren();
    if (!posts.length)
      list.append(el("p", "아직 올라온 자료가 없어요.", "muted"));
    posts.forEach((p) => list.append(postCard(p, false, true)));
  } catch (e) {
    if (revision !== galleryRequest) return;
    list.replaceChildren(
      el(
        "p",
        "게시물을 불러오지 못했어요. 연결 후 새로고침을 눌러주세요.",
        "muted",
      ),
    );
  }
}
$("#gallery-refresh").onclick = () => loadGallery();

async function loadBoard() {
  if (!session || session.role !== "member") {
    if (currentTab === "style") renderBoard();
    return;
  }
  try {
    boardPosts = (await api("board")).posts;
    if (currentTab === "style") renderBoard();
    if (currentTab === "summary")
      $("#summary-content").replaceChildren(
        el("div", summaryText(), "summary-text"),
      );
  } catch (e) {
    if (currentTab === "style" && !$("#board-form")) {
      renderBoard();
      notify("게시판을 불러오지 못했어요. 연결 후 다시 눌러주세요.", true);
    }
  }
}
function renderBoard() {
  const box = $("#style-board");
  if (!session || session.role !== "member") {
    box.replaceChildren(
      el("h3", "같은 조와 나누는 스타일 보드"),
      el(
        "p",
        "수업 코드로 참여하면 캡처 이미지를 올리고 같은 조와 의견을 주고받을 수 있어요. 개인 연습은 공유되지 않습니다.",
        "muted",
      ),
    );
    return;
  }
  if (!$("#board-form")) {
    box.replaceChildren(
      el("h3", "우리 조 스타일 보드"),
      el(
        "p",
        "이미지와 별명은 같은 조와 강사에게만 보여요. 얼굴 사진은 필요 없어요. 발표 동의 전에는 발표 화면에 나타나지 않아요.",
        "muted",
      ),
    );
    const form = el("form");
    form.id = "board-form";
    const label = el("label", "옷 · 액세서리 · 메이크업 캡처", "field-label");
    label.htmlFor = "style-file";
    const file = el("input");
    file.type = "file";
    file.id = "style-file";
    file.accept = "image/jpeg,image/png,image/webp";
    file.onchange = async () => {
      uploadRequest = null;
      try {
        uploadData = await prepareImage(file.files[0]);
        $("#upload-preview").src = uploadData || "";
        $("#upload-preview").hidden = !uploadData;
      } catch (e) {
        uploadData = null;
        file.value = "";
        report(e);
      }
    };
    const preview = el("img");
    preview.id = "upload-preview";
    preview.alt = "업로드할 스타일 이미지 미리보기";
    preview.hidden = true;
    const reasonLabel = el("label", "이 스타일을 고른 이유", "field-label");
    reasonLabel.htmlFor = "style-reason";
    const reason = el("textarea");
    reason.id = "style-reason";
    reason.rows = 3;
    reason.maxLength = 1500;
    reason.placeholder = "좋았던 색 조합과 원하는 이미지를 적어주세요.";
    reason.value = localStorage.getItem(localKey + "-post-draft") || "";
    reason.oninput = () => {
      uploadRequest = null;
      try {
        localStorage.setItem(localKey + "-post-draft", reason.value);
      } catch {}
    };
    const consent = el("label", undefined, "consent-label");
    const check = el("input");
    check.type = "checkbox";
    check.id = "style-consent";
    check.onchange = () => (uploadRequest = null);
    consent.append(
      check,
      document.createTextNode(
        "이 이미지와 선택 이유를 발표 화면에 공개해도 좋아요. (선택 · 언제든 철회 가능)",
      ),
    );
    const upload = el("button", "우리 조에 올리기 ↑", "primary wide");
    upload.type = "submit";
    upload.id = "upload-style";
    form.append(
      label,
      file,
      el(
        "small",
        "원본 10MB 이하 · 긴 변 1600px 이하 JPG로 변환 · 게시용 2MB 이하",
        "muted",
      ),
      preview,
      reasonLabel,
      reason,
      consent,
      upload,
      el(
        "p",
        "캡처에 이름·연락처·주문 내역이 있으면 잘라주세요. 이미지는 연결이 끊기면 현재 창에서 재시도할 수 있지만, 업로드 전 새로고침하면 다시 선택해야 해요.",
        "privacy-note",
      ),
    );
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (uploadBusy) return;
      uploadBusy = true;
      upload.disabled = true;
      try {
        if (!uploadRequest)
          uploadRequest = {
            reason: reason.value,
            image: uploadData,
            words: [...book.words],
            consent: check.checked,
            writeId: crypto.randomUUID(),
          };
        await api("board", "POST", uploadRequest);
        uploadRequest = null;
        uploadData = null;
        reason.value = "";
        file.value = "";
        check.checked = false;
        preview.hidden = true;
        try {
          localStorage.removeItem(localKey + "-post-draft");
        } catch {}
        notify("같은 조에 공유했어요.");
        await loadBoard();
      } catch (e) {
        report(e);
      } finally {
        uploadBusy = false;
        upload.disabled = !room.boardOpen || room.ended;
      }
    };
    box.append(
      form,
      button("게시물 새로고침", () => loadBoard()),
      el("div", undefined, "post-list"),
    );
    box.querySelector(".post-list").id = "post-list";
  }
  $("#upload-style").disabled = !room.boardOpen || room.ended || uploadBusy;
  let status = $("#board-open-status");
  if (!status) {
    status = el("p", undefined, "board-open-status");
    status.id = "board-open-status";
    box.prepend(status);
  }
  status.textContent =
    room.boardOpen && !room.ended
      ? "공유 활동이 열려 있어요."
      : "강사가 공유 활동을 열면 업로드와 의견 쓰기가 가능해요.";
  const list = $("#post-list");
  if (document.activeElement?.closest("#post-list")) return;
  list.replaceChildren();
  if (!boardPosts.length)
    list.append(
      el("p", "아직 게시물이 없어요. 첫 번째 스타일을 공유해보세요.", "muted"),
    );
  boardPosts.forEach((p) => list.append(postCard(p, false)));
}
function postCard(p, host, readOnly = false) {
  const card = el("article", undefined, "post-card");
  card.dataset.postId = p.id;
  card.append(
    el(
      "p",
      p.group + "조 · " + p.name + (p.owner ? " · 나의 게시물" : ""),
      "eyebrow",
    ),
  );
  if (p.image) {
    const img = el("img");
    img.loading = "lazy";
    img.alt = "공유한 스타일 이미지";
    img.src = apiBase() + "/board/" + p.id + "/image";
    card.append(img);
  }
  card.append(
    el("p", p.reason, "post-reason"),
    el("p", p.words.join(" · "), "muted"),
  );
  if (host && !readOnly) {
    card.append(
      el(
        "p",
        p.consent
          ? "작성자가 발표 공개에 동의했어요."
          : "발표 공개에 동의하지 않은 게시물입니다.",
        "muted",
      ),
    );
    const show = button("발표 화면에 띄우기", () =>
      control("present", { id: p.id }),
    );
    show.disabled = !p.consent || room.ended;
    card.append(show);
  } else if (p.owner && !readOnly) {
    const label = el("label", undefined, "consent-label");
    const consent = el("input");
    consent.type = "checkbox";
    consent.checked = p.consent;
    consent.onchange = async () => {
      const wanted = consent.checked;
      consent.disabled = true;
      try {
        await api("board/" + p.id + "/consent", "POST", { consent: wanted });
        p.consent = wanted;
        notify(wanted ? "발표 공개에 동의했어요." : "발표 동의를 철회했어요.");
      } catch (e) {
        consent.checked = !wanted;
        report(e);
      } finally {
        consent.disabled = false;
      }
    };
    label.append(consent, document.createTextNode("발표 화면 공개 동의"));
    card.append(label);
  }
  const comments = el("div", undefined, "comments");
  p.comments.forEach((c) => {
    const line = el("p");
    line.append(el("b", c.name + " "), document.createTextNode(c.text));
    comments.append(line);
  });
  card.append(comments);
  if (readOnly) return card;
  if (!host) {
    const form = el("form", undefined, "comment-form"),
      input = el("textarea");
    input.rows = 2;
    input.maxLength = 500;
    input.setAttribute("aria-label", p.name + " 게시물에 의견 남기기");
    input.placeholder =
      "“이 조합의 ___한 느낌이 좋아요.” “___색을 더해보면 어떨까요?”";
    const submit = el("button", "의견 남기기", "outline-button");
    submit.type = "submit";
    submit.disabled = !room.boardOpen || room.ended;
    form.append(input, submit);
    form.onsubmit = async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        await api("board/" + p.id + "/comments", "POST", { text: input.value });
        input.value = "";
        document.activeElement.blur();
        await loadBoard();
      } catch (e) {
        report(e);
      } finally {
        submit.disabled = !room.boardOpen || room.ended;
      }
    };
    card.append(form);
  }
  if (p.owner || host)
    card.append(
      button(
        "게시물 삭제",
        async () => {
          if (!confirm("이 게시물과 댓글을 삭제할까요?")) return;
          await api("board/" + p.id, "DELETE");
          host ? loadHostBoard() : loadBoard();
        },
        "text-button destructive",
      ),
    );
  return card;
}
let settingsDraft = null;
async function control(action, data = {}) {
  room = await api("control", "POST", { action, ...data });
  renderTeacherLive();
  if ($("#lesson").classList.contains("active")) renderLesson();
  return room;
}
function renderTeacher() {
  if (session?.role !== "host") return;
  const box = $("#teacher-content");
  if (!$("#teacher-main")) {
    box.replaceChildren();
    const layout = el("div", undefined, "teacher-layout");
    layout.id = "teacher-main";
    const left = el("div"),
      right = el("div");
    const join = el("section", undefined, "teacher-panel join-details");
    join.append(
      el("p", "INVITE YOUR GROUP", "eyebrow"),
      el("h2", "함께 시작하기"),
    );
    const q = el("div");
    q.id = "join-qr";
    const link = el("input");
    link.id = "join-link";
    link.readOnly = true;
    link.setAttribute("aria-label", "참여 링크");
    join.append(
      q,
      el("strong", code, "room-code"),
      link,
      button("참여 링크 복사", async () => {
        try {
          await navigator.clipboard.writeText(link.value);
          notify("참여 링크를 복사했어요.");
        } catch {
          link.select();
          notify("링크를 선택했어요. 복사해서 전달해주세요.");
        }
      }),
      el(
        "p",
        "이 브라우저를 닫아도 권한 쿠키는 유지됩니다. 쿠키 삭제·시크릿 창 종료 시 강사 권한을 잃습니다. 수업은 생성 후 7일간 보관됩니다.",
        "privacy-note",
      ),
    );
    left.append(join);
    const stages = el("section", undefined, "teacher-panel");
    stages.append(
      el("p", "THE WORKSHOP PLAN", "eyebrow"),
      el("h2", "수업의 흐름"),
    );
    const stageList = el("div");
    stageList.id = "teacher-stage-list";
    stages.append(stageList);
    left.append(stages);
    const live = el("section", undefined, "teacher-panel live-panel");
    live.append(
      el("p", "LIVE CLASSROOM", "eyebrow"),
      el("h2", "", "live-stage"),
      el("div", "", "teacher-live-info"),
    );
    const slideButtons = el("div", undefined, "toolbar");
    slideButtons.append(
      button("← 이전 화면", () => moveSlide(-1)),
      button("다음 화면 →", () => moveSlide(1)),
    );
    const toggles = el("div", undefined, "toolbar");
    for (const [id, label, action] of [
      ["sync-toggle", "단계 연결", "sync"],
      ["active-toggle", "활동 시작", "active"],
      ["board-toggle", "스타일 공유 열기", "board"],
    ]) {
      const b = button(label, () =>
        control(action, {
          value: !room[action === "board" ? "boardOpen" : action],
        }),
      );
      b.id = id;
      toggles.append(b);
    }
    live.append(slideButtons, toggles);
    const timer = el("div", undefined, "teacher-timer");
    timer.append(el("p", "남은 시간", "eyebrow"), el("div", "", "live-time"));
    const timeRow = el("div", undefined, "toolbar");
    const minutes = el("input");
    minutes.id = "timer-minutes";
    minutes.type = "number";
    minutes.min = 1;
    minutes.max = 180;
    minutes.value = 10;
    minutes.setAttribute("aria-label", "타이머 분");
    timeRow.append(
      minutes,
      button("분으로 설정", () =>
        control("timer", { command: "set", minutes: Number(minutes.value) }),
      ),
    );
    const timerActions = el("div", undefined, "toolbar");
    timerActions.append(
      button("시작", () => control("timer", { command: "start" })),
      button("일시정지", () => control("timer", { command: "pause" })),
      button("초기화", () => control("timer", { command: "reset" })),
    );
    timer.append(timeRow, timerActions);
    live.append(timer);
    right.append(live);
    const memo = el("section", undefined, "teacher-panel instructor-notes");
    memo.append(
      el("p", "ONLY FOR YOU", "eyebrow"),
      el("h2", "강사용 진행 노트"),
      el("h3", "함께 나눌 멘트"),
      el("p", "", "instructor-say"),
      el("h3", "진행 체크"),
      el("p", "", "instructor-run"),
    );
    right.append(memo);
    const answers = el("section", undefined, "teacher-panel");
    answers.append(
      el("p", "COLOR LAB", "eyebrow"),
      el("h2", "색 개념 문제 · 정답 공개"),
      el(
        "p",
        "학생들이 선택한 뒤 문제별로 공개해주세요. 답과 해설은 참여자·발표 화면에 함께 나타납니다.",
        "muted",
      ),
    );
    const answerControls = el("div");
    answerControls.id = "concept-controls";
    answers.append(answerControls);
    right.append(answers);
    const groups = el("section", undefined, "teacher-panel");
    groups.append(
      el("p", "GROUP PROGRESS", "eyebrow"),
      el("h2", "우리 조의 발견"),
    );
    const groupBox = el("div");
    groupBox.id = "group-progress";
    groups.append(groupBox);
    right.append(groups);
    layout.append(left, right);
    box.append(layout);
    const settings = el("details", undefined, "teacher-panel");
    settings.id = "settings-panel";
    settings.append(
      el("summary", "수업 설정 · 시간 · 실제 키트 색과 계절 이름"),
    );
    const settingsBox = el("div");
    settingsBox.id = "settings-content";
    settings.append(settingsBox);
    box.append(settings);
    const board = el("details", undefined, "teacher-panel");
    board.append(el("summary", "스타일 게시판 · 발표 공개 관리"));
    const toolbar = el("div", undefined, "toolbar");
    toolbar.append(
      button("게시물 새로고침", () => loadHostBoard()),
      button("발표 게시물 내리기", () => control("present", { id: null })),
    );
    const posts = el("div");
    posts.id = "host-posts";
    board.append(toolbar, posts);
    board.addEventListener("toggle", () => {
      if (board.open) loadHostBoard();
    });
    box.append(board);
    const end = el("section", undefined, "teacher-panel end-panel");
    end.append(
      el("h3", "수업을 마무리할 때"),
      el(
        "p",
        "참여자에게 기록과 피드백을 먼저 저장하도록 안내하세요. 종료 후 새 기록은 받지 않으며, 생성 후 7일이 지나면 서버 기록과 이미지가 삭제됩니다.",
        "muted",
      ),
      button(
        "수업 종료",
        async () => {
          if (
            confirm(
              "모두 기록을 내려받았나요? 수업을 종료하면 새 기록과 공유를 받지 않습니다.",
            )
          )
            await control("end");
        },
        "outline-button destructive",
      ),
      button(
        "수업과 이미지 영구 삭제",
        async () => {
          if (
            prompt("영구 삭제하려면 수업 코드 " + code + "를 입력하세요.") !==
            code
          )
            return;
          await control("delete");
          eventSource?.close();
          session = null;
          room = null;
          location.href = "/color-studio/";
        },
        "text-button destructive",
      ),
    );
    box.append(end);
    const url = new URL("/color-studio/", location.origin);
    url.searchParams.set("room", code);
    link.value = url.href;
    if (["localhost", "127.0.0.1", "::1"].includes(location.hostname))
      join.append(
        el(
          "p",
          "현재 주소는 이 기기에서만 접속됩니다. 현장 참여 전 외부 HTTPS 또는 같은 네트워크의 접속 가능한 주소로 열어주세요.",
          "local-address-warning",
        ),
      );
    const qr = qrcode(0, "M");
    qr.addData(url.href);
    qr.make();
    q.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
    q.querySelector("svg").setAttribute("aria-label", "수업 참여 링크 QR코드");
    settingsDraft = JSON.parse(JSON.stringify(config()));
    renderSettings();
  }
  renderTeacherLive();
}
function moveSlide(delta) {
  let next = room.slide + delta;
  if (next < 0 && room.stage > 0)
    return control("stage", { stage: room.stage - 1 });
  if (next >= C.slides[room.stage].length && room.stage < 8)
    return control("stage", { stage: room.stage + 1 });
  if (next >= 0 && next < C.slides[room.stage].length)
    return control("slide", { slide: next });
}
function renderTeacherLive() {
  if (!$("#teacher-main") || !room) return;
  $(".live-stage").textContent = config().steps[room.stage].title;
  $(".teacher-live-info").textContent =
    "화면 " +
    (room.slide + 1) +
    " / " +
    C.slides[room.stage].length +
    " · " +
    (room.ended ? "종료된 수업" : room.active ? "활동 진행 중" : "활동 준비");
  const stageList = $("#teacher-stage-list");
  stageList.replaceChildren();
  config().steps.forEach((s, i) => {
    const b = button("", () => control("stage", { stage: i }), "stage-button");
    b.append(
      el("span", String(i + 1).padStart(2, "0")),
      el("b", s.title),
      el("small", s.minutes + "분"),
    );
    b.classList.toggle("selected", room.stage === i);
    b.disabled = room.ended;
    stageList.append(b);
  });
  $("#sync-toggle").textContent = room.sync
    ? "단계 연결 켜짐 ✓"
    : "단계 연결 꺼짐";
  $("#active-toggle").textContent = room.active ? "활동 종료" : "활동 시작";
  $("#board-toggle").textContent = room.boardOpen
    ? "스타일 공유 닫기"
    : "스타일 공유 열기";
  $(".instructor-say").textContent = room.notes?.say || "";
  $(".instructor-run").textContent = room.notes?.run || "";
  const box = $("#group-progress");
  box.replaceChildren();
  for (const group of room.groups || []) {
    const e = el("article", undefined, "group-progress-item");
    e.append(el("h3", group.group + "조 · " + group.count + "명"));
    const progress = el("div", undefined, "progress-track");
    const bar = el("span");
    bar.style.width =
      Math.min(
        100,
        (group.members.reduce((n, m) => n + m.completed, 0) /
          Math.max(1, group.count * config().families.length)) *
          100,
      ) + "%";
    progress.append(bar);
    e.append(progress);
    for (const m of group.members)
      e.append(
        el(
          "p",
          m.name +
            " · " +
            m.completed +
            "/" +
            config().families.length +
            "색상" +
            (m.revisit ? " · 재비교 요청" : "") +
            (m.online ? " · 접속 중" : " · 접속 대기"),
        ),
      );
    box.append(e);
  }
  renderTeacherAnswers();
  schedule();
  tick();
}
function renderSettings() {
  const cfg = settingsDraft,
    box = $("#settings-content");
  box.replaceChildren(
    el(
      "p",
      "색과 계절 이름은 실물 키트를 확인해 입력하세요. 이미 기록된 색은 이름과 메모를 보존합니다. 활동 도중에는 설정 변경을 최소화해주세요.",
      "muted",
    ),
  );
  const groupLabel = el("label", "조 개수", "field-label"),
    group = el("select");
  group.setAttribute("aria-label", "조 개수");
  [5, 6].forEach((n) => {
    const o = el("option", n + "개 조");
    o.value = n;
    group.append(o);
  });
  group.value = cfg.groupCount;
  group.onchange = () => (cfg.groupCount = Number(group.value));
  box.append(groupLabel, group, el("h3", "단계별 시간"));
  let total = el(
    "p",
    "총 " + cfg.steps.reduce((n, s) => n + s.minutes, 0) + "분",
    "settings-total",
  );
  cfg.steps.forEach((s, i) => {
    const row = el("div", undefined, "settings-step");
    const title = el("input");
    title.value = s.title;
    title.maxLength = 80;
    title.setAttribute("aria-label", i + 1 + "단계 제목");
    title.oninput = () => (s.title = title.value);
    const minutes = el("input");
    minutes.type = "number";
    minutes.min = 1;
    minutes.max = 180;
    minutes.value = s.minutes;
    minutes.setAttribute("aria-label", i + 1 + "단계 시간");
    minutes.oninput = () => {
      s.minutes = Number(minutes.value);
      total.textContent =
        "총 " + cfg.steps.reduce((n, s) => n + s.minutes, 0) + "분";
    };
    row.append(el("span", String(i + 1)), title, minutes, el("small", "분"));
    box.append(row);
  });
  box.append(total, el("h3", "계절 또는 색의 느낌 이름"));
  cfg.seasons.forEach((name, i) => {
    const row = el("div", undefined, "settings-season"),
      input = el("input");
    input.value = name;
    input.maxLength = 40;
    input.setAttribute("aria-label", i + 1 + "번째 계절 이름");
    input.oninput = () => {
      cfg.seasons[i] = input.value;
    };
    row.append(input);
    if (cfg.seasons.length > 1)
      row.append(
        button("삭제", () => {
          cfg.seasons.splice(i, 1);
          for (const f of cfg.families)
            for (const c of f.colors)
              c.season = Math.max(
                0,
                c.season > i ? c.season - 1 : c.season === i ? 0 : c.season,
              );
          renderSettings();
        }),
      );
    box.append(row);
  });
  box.append(
    button("계절·느낌 이름 추가", () => {
      if (cfg.seasons.length >= 12)
        throw Error("이름은 12개까지 설정할 수 있어요.");
      cfg.seasons.push("새 느낌");
      renderSettings();
    }),
    el("h3", "색상별 비교 키트"),
  );
  cfg.families.forEach((f, index) => {
    const section = el("section", undefined, "kit-family"),
      head = el("div", undefined, "toolbar"),
      name = el("input");
    name.value = f.name;
    name.maxLength = 30;
    name.setAttribute("aria-label", "비교 색상 이름");
    name.oninput = () => (f.name = name.value);
    head.append(
      name,
      button("색상 묶음 삭제", () => {
        if (cfg.families.length === 1) throw Error("한 개 이상은 남겨주세요.");
        if (
          !confirm("이 색상 묶음을 삭제할까요? 기존 기록은 요약에 보존됩니다.")
        )
          return;
        cfg.families.splice(index, 1);
        renderSettings();
      }),
    );
    section.append(head);
    f.colors.forEach((c, i) => {
      const row = el("div", undefined, "kit-chip"),
        color = el("input");
      color.type = "color";
      color.value = c.hex;
      color.setAttribute("aria-label", c.name + " 화면 안내 색");
      color.oninput = () => (c.hex = color.value);
      const name = el("input");
      name.value = c.name;
      name.maxLength = 40;
      name.setAttribute("aria-label", "실물 키트 색 이름 또는 번호");
      name.oninput = () => (c.name = name.value);
      const season = el("select");
      season.setAttribute("aria-label", "계절 또는 느낌");
      cfg.seasons.forEach((n, j) => {
        const o = el("option", n);
        o.value = j;
        season.append(o);
      });
      season.value = c.season;
      season.onchange = () => (c.season = Number(season.value));
      const remove = button("−", () => {
        if (f.colors.length <= 2) throw Error("비교색을 2개 이상 남겨주세요.");
        f.colors.splice(i, 1);
        renderSettings();
      });
      remove.setAttribute("aria-label", c.name + " 삭제");
      row.append(color, name, season, remove);
      section.append(row);
    });
    section.append(
      button("비교색 추가", () => {
        if (f.colors.length >= 12)
          throw Error("한 묶음의 비교색은 12개까지 가능해요.");
        f.colors.push({
          id: "c" + crypto.randomUUID().slice(0, 8),
          name: "새 실물 색",
          hex: "#a6b8cb",
          season: 0,
        });
        renderSettings();
      }),
    );
    box.append(section);
  });
  box.append(
    button("색상 묶음 추가", () => {
      if (cfg.families.length >= 12)
        throw Error("색상 묶음은 12개까지 가능해요.");
      const id = "f" + crypto.randomUUID().slice(0, 8);
      cfg.families.push({
        id,
        name: "새 색상",
        colors: [
          { id: id + "a", name: "색 A", hex: "#a6b8cb", season: 0 },
          { id: id + "b", name: "색 B", hex: "#c96f59", season: 0 },
        ],
      });
      renderSettings();
    }),
  );
  const checkLabel = el("label", undefined, "consent-label"),
    check = el("input");
  check.type = "checkbox";
  check.checked = cfg.kitConfirmed;
  check.onchange = () => (cfg.kitConfirmed = check.checked);
  checkLabel.append(
    check,
    document.createTextNode("실물 키트의 색 이름과 구성을 확인했습니다."),
  );
  box.append(
    checkLabel,
    button(
      "수업 설정 저장",
      async () => {
        room = await api("config", "PUT", cfg);
        settingsDraft = JSON.parse(JSON.stringify(room.config));
        renderTeacherLive();
        renderSettings();
        notify(
          "수업 설정을 저장했어요. 현재 타이머는 별도로 조절할 수 있어요.",
        );
      },
      "primary",
    ),
  );
}
async function loadHostBoard() {
  const box = $("#host-posts");
  if (!box) return;
  const { posts } = await api("board");
  box.replaceChildren();
  if (!posts.length)
    box.append(el("p", "아직 공유된 게시물이 없어요.", "muted"));
  posts.forEach((p) => box.append(postCard(p, true)));
}
function renderLesson() {
  const stage = room?.stage ?? localStage,
    index = room?.slide ?? localSlide,
    s = C.slides[stage][index];
  $(".lesson-top .eyebrow").textContent =
    "COLOR STUDIO / " + String(stage + 1).padStart(2, "0");
  $(".lesson-top>span:last-child").textContent =
    config().steps[stage].title +
    " · " +
    config().steps[stage].minutes +
    " MIN";
  $(".lesson-title .eyebrow").textContent = room?.active
    ? "지금 함께 해볼 활동"
    : "색을 배우고 · 관찰하고 · 연결하기";
  $(".lesson-title h1").textContent = s.title;
  $(".lesson-title p:last-child").textContent = s.description;
  const questionId =
    stage === 2
      ? ["hue", "brightness", "chroma", "tone", "temperature"][index]
      : null;
  const revealedAnswer = questionId && room?.conceptAnswers?.[questionId];
  const comp = $(".comparison");
  comp.replaceChildren();
  const colors = revealedAnswer?.swatches?.map((c) => c.hex) || s.colors;
  const labels = revealedAnswer?.swatches?.map((c) => c.name) || s.labels;
  colors.forEach((hex, i) => {
    const e = el("div");
    e.style.background = hex;
    e.style.color = ink(hex);
    e.append(el("span", String.fromCharCode(65 + i)), el("strong", labels[i]));
    comp.append(e);
  });
  $(".lesson-task p").replaceChildren(
    el(
      "b",
      revealedAnswer ? "정답 · " + revealedAnswer.label : "지금 함께 해볼 일",
    ),
    el("br"),
    document.createTextNode(
      revealedAnswer ? revealedAnswer.explanation : s.task,
    ),
  );
  $("#slide-count").textContent =
    String(stage + 1).padStart(2, "0") +
    " · " +
    (index + 1) +
    " / " +
    C.slides[stage].length;
  $("#lesson-prev").disabled =
    (stage === 0 && index === 0) ||
    (!!room && (presentation || session?.role !== "host"));
  $("#lesson-next").disabled =
    (stage === 8 && index === C.slides[8].length - 1) ||
    (!!room && (presentation || session?.role !== "host"));
  const bar = $("#presentation-room");
  bar.replaceChildren();
  if (room) {
    const row = el("div", undefined, "projector-status");
    row.append(
      el("span", "참여 코드 " + room.code),
      el("b", "", "live-time"),
      el(
        "span",
        room.ended
          ? "수업 종료"
          : room.active
            ? "활동 진행 중"
            : "함께 준비해요",
      ),
    );
    bar.append(row);
  }
  tick();
}
for (const [id, delta] of [
  ["lesson-prev", -1],
  ["lesson-next", 1],
])
  $("#" + id).onclick = () => {
    if (room) {
      if (session?.role === "host") moveSlide(delta).catch(report);
      return;
    }
    let n = localSlide + delta;
    if (n < 0 && localStage > 0) {
      localStage--;
      n = C.slides[localStage].length - 1;
    } else if (n >= C.slides[localStage].length && localStage < 8) {
      localStage++;
      n = 0;
    }
    if (n >= 0 && n < C.slides[localStage].length) localSlide = n;
    renderLesson();
  };
function renderProjection() {
  document.body.classList.toggle("showing-post", !!room.post);
  const box = $("#presentation-post");
  box.hidden = !room.post;
  box.replaceChildren();
  if (!room.post) return;
  box.append(el("p", "작성자가 공개에 동의한 스타일", "eyebrow"));
  if (room.post.image) {
    const img = el("img");
    img.src = apiBase() + "/presentation/images/" + room.post.id;
    img.alt = "작성자가 발표에 동의한 스타일 이미지";
    box.append(img);
  }
  box.append(el("h2", room.post.reason), el("p", room.post.words.join(" · ")));
}
function tick() {
  if (!room?.timer) return;
  const t = room.timer,
    ms = t.endsAt
      ? Math.max(0, t.endsAt - (Date.now() + timerOffset))
      : t.remainingMs,
    seconds = Math.ceil(ms / 1000);
  $$(".live-time").forEach(
    (e) =>
      (e.textContent =
        String(Math.floor(seconds / 60)).padStart(2, "0") +
        ":" +
        String(seconds % 60).padStart(2, "0")),
  );
}
setInterval(tick, 500);
setInterval(() => {
  if (dirty) flush();
}, 10000);
async function boot() {
  schedule();
  if (code && /^\d{6}$/.test(code)) {
    try {
      if (presentation) {
        room = await api("presentation");
        document.body.classList.add("presentation-mode");
        $$(".view").forEach((e) =>
          e.classList.toggle("active", e.id === "lesson"),
        );
        renderLesson();
        renderProjection();
        connect();
        const b = button("전체 화면", () =>
          document.documentElement.requestFullscreen(),
        );
        b.classList.add("fullscreen-button");
        document.body.append(b);
        return;
      }
      const state = await api();
      await enter(state);
      return;
    } catch (e) {
      if (presentation) {
        document.body.classList.add("access-denied");
        $("main").replaceChildren(
          el("h1", "발표 화면 접근 권한이 필요해요."),
          el("p", "수업을 만든 강사의 브라우저에서 발표 화면을 열어주세요."),
        );
        return;
      }
      $("#room-code").value = code;
      view("home");
      $("#entry-panel").scrollIntoView();
      if (!e.status) {
        try {
          const cached = JSON.parse(
            localStorage.getItem("color-membership-" + code) || "null",
          );
          if (cached?.member && cached.expiresAt > Date.now()) {
            const oldKey = "color-studio-" + code + "-" + cached.member.id;
            const draft = JSON.parse(localStorage.getItem(oldKey) || "null");
            if (draft) {
              await enter({
                ...cached,
                book: draft.book,
                version: draft.version,
                lastWriteId: "",
              });
              connected = false;
              renderConnection();
              notify(
                "이 기기의 워크북을 임시 복원했어요. 연결 후 수업 권한과 서버 저장을 다시 확인합니다.",
              );
              return;
            }
          }
        } catch {}
      }
      $("#room-code").dispatchEvent(new Event("change"));
      if (e.status !== 403) report(e);
    }
  }
  if (location.hash === "#lesson") view("lesson");
  else view("home");
}
boot().catch(report);

if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/color-studio/sw.js").catch(() => {});
setInterval(async () => {
  if (session?.role === "host" && connected)
    try {
      room = await api("host");
      renderTeacherLive();
    } catch {}
}, 15000);
