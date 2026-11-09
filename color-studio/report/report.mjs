import { PDFDocument, rgb, PDFName, PDFString } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const W = 595.28,
  H = 841.89,
  M = 52,
  CW = W - M * 2,
  BOTTOM = 68;
const INK = rgb(0.114, 0.114, 0.122),
  MUTED = rgb(0.43, 0.43, 0.45),
  BLUE = rgb(0, 0.443, 0.89),
  LINE = rgb(0.89, 0.89, 0.91),
  PALE = rgb(0.962, 0.962, 0.969);
const t = (v) =>
  typeof v === "string"
    ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    : v == null
      ? ""
      : String(v);
const labels = {
  similar: "비슷해요",
  unsure: "잘 모르겠어요",
  again: "다시 비교할게요",
};
const choice = (id, r) =>
  id
    ? labels[id] || r.colorLabels?.[id] || "이전 설정의 색 (" + id + ")"
    : "기록하지 않음";
const color = (hex) => {
  const v = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#d2d2d7";
  return rgb(
    parseInt(v.slice(1, 3), 16) / 255,
    parseInt(v.slice(3, 5), 16) / 255,
    parseInt(v.slice(5, 7), 16) / 255,
  );
};
const dateLabel = (iso) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
export function buildReportData(raw) {
  const b = raw.book || {},
    cfg = raw.config || {},
    palette = raw.palette || [];
  const favorites = (b.favorites || [])
    .map((i) => palette[i])
    .filter(Boolean)
    .map((c) => ({ name: t(c.name), hex: c.hex }));
  const records = Object.entries(b.records || {})
    .filter(([, r]) => r.self || r.peer?.length || r.selfNote || r.peerNote)
    .map(([id, r]) => ({
      id,
      name: t(
        r.familyName || cfg.families?.find((f) => f.id === id)?.name || id,
      ),
      self: choice(r.self, r),
      peers:
        (r.peer || []).map((v) => choice(v, r)).join(", ") || "기록하지 않음",
      selfNote: t(r.selfNote),
      peerNote: t(r.peerNote),
      disagrees: !!(r.self && r.peer?.length && !r.peer.includes(r.self)),
      revisit:
        r.self === "again" ||
        r.self === "unsure" ||
        r.peer?.some((v) => v === "again" || v === "unsure"),
      colors: (cfg.families?.find((f) => f.id === id)?.colors || [])
        .filter((c) => c.id === r.self || (r.peer || []).includes(c.id))
        .map((c) => ({ name: t(r.colorLabels?.[c.id] || c.name), hex: c.hex })),
    }));
  const counts = new Map();
  for (const [id, row] of Object.entries(b.records || {})) {
    const selected = cfg.families
      ?.find((f) => f.id === id)
      ?.colors?.find((c) => c.id === row.self);
    const label = selected && cfg.seasons?.[selected.season];
    if (label) counts.set(label, (counts.get(label) || 0) + 1);
  }
  const tendencies = [...counts]
    .filter(([, count]) => count > 1)
    .map(([label, count]) => t(label) + " 느낌의 색을 " + count + "회 선택");
  const posts = (raw.posts || [])
    .filter((p) => p.owner === true)
    .map((p) => ({
      id: t(p.id),
      reason: t(p.reason),
      words: (p.words || []).map(t),
      hasImage: !!p.image,
      feedback: (p.comments || []).map((c) => t(c.text)),
    }));
  return {
    name: t(raw.member?.name || "나의 컬러 노트"),
    group: Number.isInteger(raw.member?.group) ? raw.member.group : null,
    date: dateLabel(raw.generatedAt || new Date().toISOString()),
    generatedAt: raw.generatedAt || new Date().toISOString(),
    favorites,
    records,
    tendencies,
    posts,
    words: (b.words || []).map(t),
    imageNote: t(b.imageNote),
    conditions: t(b.conditions),
    role: t(b.role),
    concepts: b.concepts || {},
    revealed: raw.revealed || {},
    reflection: {
      favoriteReason: t(b.reflection?.favoriteReason),
      discovery: t(b.reflection?.discovery),
      nextTry: t(b.reflection?.nextTry),
    },
  };
}
export async function createReport(raw, assets) {
  const model = buildReportData(raw),
    pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(assets.regular, { subset: false }),
    bold = await pdf.embedFont(assets.semibold, { subset: false });
  const fontSource = fontkit.create(assets.regular),
    unsupported = new Set();
  let page,
    y,
    sectionTitle = "",
    sectionCode = "";
  const widths = new Map();
  function safe(value) {
    return Array.from(t(value))
      .map((ch) => {
        const cp = ch.codePointAt(0);
        if (ch === "\n" || ch === "\t" || fontSource.hasGlyphForCodePoint(cp))
          return ch;
        unsupported.add(ch);
        return "□";
      })
      .join("");
  }
  function line(value, x, baseline, size = 11, font = regular, fill = INK) {
    const text = safe(value);
    page.drawText(text, { x, y: baseline, font, size, color: fill });
  }
  function rounded(x, bottom, width, height, fill, radius = 14) {
    page.drawRectangle({
      x: x + radius,
      y: bottom,
      width: width - 2 * radius,
      height,
      color: fill,
    });
    page.drawRectangle({
      x,
      y: bottom + radius,
      width,
      height: height - 2 * radius,
      color: fill,
    });
    for (const [cx, cy] of [
      [x + radius, bottom + radius],
      [x + width - radius, bottom + radius],
      [x + radius, bottom + height - radius],
      [x + width - radius, bottom + height - radius],
    ])
      page.drawCircle({ x: cx, y: cy, size: radius, color: fill });
  }
  function header() {
    page.drawCircle({ x: M + 4, y: H - 39, size: 4, color: BLUE });
    line("Color Studio", M + 16, H - 43, 9, bold);
    line("나의 컬러 워크북", W - M - 91, H - 43, 8.5, regular, MUTED);
  }
  function fresh(continued = false) {
    page = pdf.addPage([W, H]);
    header();
    y = H - 93;
    if (continued) {
      line(sectionCode + " / CONTINUED", M, y, 9, bold, BLUE);
      y -= 33;
      line(sectionTitle + " · 이어서", M, y, 23, bold);
      y -= 35;
    }
  }
  function section(code, title, intro) {
    sectionCode = code;
    sectionTitle = title;
    fresh();
    line(code, M, y, 10, bold, BLUE);
    y -= 42;
    line(title, M, y, 31, bold);
    y -= 31;
    if (intro) paragraph("", intro, { size: 11.5, color: MUTED });
    y -= 5;
  }
  function ensure(height = 20, context = "") {
    if (y - height < BOTTOM) {
      fresh(true);
      if (context) {
        line(context + " · 계속", M, y, 10, bold, MUTED);
        y -= 23;
      }
    }
  }
  function wrap(value, size, font, maxWidth) {
    const text = safe(value).replace(/\t/g, "    "),
      lines = [];
    for (const source of text.split(/\r?\n/)) {
      if (!source) {
        lines.push("");
        continue;
      }
      let current = "",
        width = 0;
      for (const ch of Array.from(source)) {
        const key = (font === bold ? "b" : "r") + ":" + size + ":" + ch;
        let charWidth = widths.get(key);
        if (charWidth === undefined) {
          charWidth = font.widthOfTextAtSize(ch, size);
          widths.set(key, charWidth);
        }
        if (current && width + charWidth > maxWidth) {
          const space = current.lastIndexOf(" ");
          if (space > 0) {
            lines.push(current.slice(0, space).trimEnd());
            current = current.slice(space + 1);
            width = font.widthOfTextAtSize(current, size);
            if (current && width + charWidth > maxWidth) {
              lines.push(current.trimEnd());
              current = "";
              width = 0;
            }
            if (ch !== " " || current) {
              current += ch;
              width += charWidth;
            }
          } else {
            lines.push(current.trimEnd());
            current = ch === " " ? "" : ch;
            width = current ? charWidth : 0;
          }
        } else {
          current += ch;
          width += charWidth;
        }
      }
      if (current) lines.push(current.trimEnd());
    }
    return lines;
  }
  function paragraph(label, value, { size = 11.5, color: fill = INK } = {}) {
    const content = t(value) || "아직 기록하지 않았어요.";
    if (label) {
      ensure(45, label);
      line(label, M, y, 9.5, bold, MUTED);
      y -= 21;
    }
    const height = size * 1.75;
    for (const part of wrap(content, size, regular, CW)) {
      ensure(height, label);
      if (part) line(part, M, y, size, regular, fill);
      y -= height;
    }
    y -= 13;
  }
  function heading(title) {
    const rows = wrap(title, 21, bold, CW);
    ensure(Math.min(78, rows.length * 29 + 36), title);
    y -= 8;
    for (const row of rows) {
      ensure(30, title);
      line(row, M, y, 21, bold);
      y -= 29;
    }
    y -= 4;
  }
  function rule() {
    if (y - 22 < BOTTOM) return;
    page.drawLine({
      start: { x: M, y },
      end: { x: W - M, y },
      thickness: 0.6,
      color: LINE,
    });
    y -= 24;
  }
  function swatches(items) {
    if (!items.length) return;
    const count = Math.min(items.length, 4),
      gap = 10,
      width = (CW - (count - 1) * gap) / count;
    for (let i = 0; i < items.length; i += count) {
      const batch = items.slice(i, i + count);
      const max = Math.max(
        ...batch.map((c) => wrap(c.name, 8.5, regular, width).length),
      );
      const height = 56 + max * 12;
      ensure(height);
      batch.forEach((c, j) => {
        rounded(M + j * (width + gap), y - 38, width, 38, color(c.hex), 9);
        wrap(c.name, 8.5, regular, width).forEach((v, k) =>
          line(v, M + j * (width + gap), y - 53 - k * 12, 8.5, regular, MUTED),
        );
      });
      y -= height;
    }
  }

  function conceptValue(id, v) {
    const maps = {
      hue: { red: "빨강 계열", green: "초록 계열", blue: "파랑 계열" },
      chroma: { vivid: "A", muted: "B", unsure: "잘 모르겠다" },
      tone: {
        soft: "A",
        deep: "B",
        vivid: "이전 문항에서 고른 선명한 색",
        unsure: "잘 모르겠다",
      },
      temperature: { warm: "A", cool: "B", similar: "비슷해요" },
    };
    return maps[id]?.[v] || t(v) || "아직 선택하지 않았어요.";
  }
  pdf.setTitle("나의 컬러 노트 · Color Studio");
  pdf.setAuthor("Color Studio");
  pdf.setSubject("개인 관찰과 직접 공유한 스타일, 받은 피드백을 모은 워크북");
  pdf.setCreator("Color Studio Personal Workbook");
  pdf.setCreationDate(new Date(model.generatedAt));
  pdf.setModificationDate(new Date(model.generatedAt));
  pdf.catalog.set(PDFName.of("Lang"), PDFString.of("ko-KR"));
  // Cover: typography, a quiet portrait, and three generous swatches.
  fresh();
  line("PERSONAL COLOR WORKBOOK", M, H - 124, 10, bold, BLUE);
  line("나의 색을", M, H - 207, 45, bold);
  line("발견한 기록.", M, H - 267, 45, bold);
  line("좋아하는 색에서, 나를 닮은 색으로.", M, H - 310, 13, regular, MUTED);
  line(
    "직접 비교하고 함께 관찰한 나만의 컬러 노트.",
    M,
    H - 333,
    11.5,
    regular,
    MUTED,
  );
  line(model.name, M, H - 386, 15, bold);
  line(
    (model.group ? model.group + "조 · " : "") + model.date,
    M,
    H - 410,
    10,
    regular,
    MUTED,
  );
  if (assets.avatar) {
    const avatar = await pdf.embedPng(assets.avatar);
    const dim = avatar.scaleToFit(124, 180);
    page.drawImage(avatar, {
      x: W - M - dim.width,
      y: H - 420,
      width: dim.width,
      height: dim.height,
    });
  }
  line("내가 좋아하는 세 가지 색", M, 360, 11, bold);
  const coverGap = 14,
    coverWidth = (CW - 28) / 3;
  for (let i = 0; i < 3; i++) {
    const c = model.favorites[i],
      x = M + i * (coverWidth + coverGap);
    rounded(x, 235, coverWidth, 100, c ? color(c.hex) : PALE, 20);
    if (c)
      wrap(c.name, 10, regular, coverWidth)
        .slice(0, 2)
        .forEach((v, j) => line(v, x, 216 - j * 15, 10, regular, MUTED));
    else line("아직 선택하지 않음", x, 216, 9, regular, MUTED);
  }
  rounded(M, 93, CW, 84, PALE, 18);
  line("이 노트는 나를 알아가는 관찰의 기록입니다.", M + 20, 145, 12, bold);
  line(
    "특정 계절 유형을 확정하는 전문 진단서는 아닙니다.",
    M + 20,
    123,
    10,
    regular,
    MUTED,
  );
  section(
    "01 / OBSERVE",
    "나에게 자연스러웠던 색",
    "내가 본 변화와 조원이 본 변화를 구분해 기록했어요. 서로 다른 의견도 함께 남겨두었습니다.",
  );
  paragraph("오늘의 비교 조건", model.conditions);
  if (model.role) paragraph("내가 맡았던 역할", model.role);
  if (!model.records.length)
    paragraph("관찰 기록", "아직 남긴 실물 색 비교 기록이 없어요.");
  for (const r of model.records) {
    heading(r.name);
    swatches(r.colors);
    paragraph("내가 관찰한 색", r.self);
    paragraph("내가 관찰한 변화", r.selfNote);
    paragraph("조원이 관찰한 색", r.peers);
    paragraph("조원의 관찰과 다른 의견", r.peerNote);
    if (r.disagrees)
      paragraph(
        "함께 다시 볼 부분",
        "나와 조원의 선택이 달랐어요. 같은 자리와 조명에서 다시 비교해보세요.",
        { color: BLUE },
      );
    rule();
  }
  heading("다시 살펴보고 싶은 부분");
  paragraph(
    "반복해서 관찰한 색의 설명",
    model.tendencies.join(", ") || "아직 반복 경향을 정리할 기록이 부족해요.",
  );
  paragraph(
    "의견이 달랐던 색상",
    model.records
      .filter((r) => r.disagrees)
      .map((r) => r.name)
      .join(", ") || "기록상 없음",
  );
  paragraph(
    "모르거나 다시 비교하고 싶은 색상",
    model.records
      .filter((r) => r.revisit)
      .map((r) => r.name)
      .join(", ") || "기록상 없음",
  );
  section(
    "02 / LEARN",
    "색을 이해하는 나의 언어",
    "내가 고른 답과 생각한 이유를 모았어요. 강사가 공개한 해설만 함께 담았습니다.",
  );
  const conceptNames = {
    hue: "01 · 색상",
    brightness: "02 · 명도",
    chroma: "03 · 채도",
    tone: "04 · 색조",
    temperature: "05 · 웜·쿨",
  };
  for (const [id, name] of Object.entries(conceptNames)) {
    heading(name);
    if (id === "brightness") {
      const cs = {
        dark: { name: "어두운 색", hex: "#30415f" },
        light: { name: "밝은 색", hex: "#e3e8f0" },
        midDark: { name: "중간 어두운 색", hex: "#607795" },
        midLight: { name: "중간 밝은 색", hex: "#9dadc4" },
      };
      const order = model.concepts.brightness;
      if (Array.isArray(order)) {
        paragraph(
          "내가 배열한 순서",
          "왼쪽이 밝은 쪽, 오른쪽이 어두운 쪽이에요.",
        );
        swatches(order.map((v) => cs[v]).filter(Boolean));
      } else paragraph("내가 배열한 순서", "아직 배열한 기록이 없어요.");
    } else paragraph("내가 고른 답", conceptValue(id, model.concepts[id]));
    if (model.revealed[id]) {
      paragraph("함께 확인한 답", model.revealed[id].label);
      paragraph("강사의 해설", model.revealed[id].explanation, {
        color: MUTED,
      });
    }
  }
  paragraph("내가 생각한 이유와 실물에서 찾은 예", model.concepts.reason);
  const feltLabels = {
    feltA: "A · 색",
    feltB: "B · 색",
    feltDifference: "두 색의 차이",
    feltSelf: "내가 본 얼굴의 변화",
    feltPeer: "조원이 본 변화와 다른 의견",
    feltNext: "다음에 색을 고를 때 확인할 점",
  };
  if (Object.keys(feltLabels).some((id) => model.concepts[id])) {
    paragraph(
      "두 펠트지 비교 · 발견한 차이",
      "색의 차이를 설명하고 실제 얼굴 아래에서 관찰한 기록이에요.",
    );
    for (const [id, label] of Object.entries(feltLabels))
      paragraph(label, model.concepts[id]);
  }
  for (const [id, value] of Object.entries(model.concepts)) {
    if (
      !Object.hasOwn(conceptNames, id) &&
      !["reason", "imageCombination", ...Object.keys(feltLabels)].includes(id)
    )
      paragraph(
        "추가 학습 기록 · " + id,
        Array.isArray(value) ? value.join(", ") : value,
      );
  }
  section(
    "03 / STYLE",
    "내 일상에 더하고 싶은 색",
    "내가 원하는 이미지와 직접 선택한 스타일, 함께 나눈 의견입니다.",
  );
  paragraph("원하는 이미지", model.words.join(" · "));
  paragraph("이미지와 연결한 색 조합", model.concepts.imageCombination);
  paragraph("내가 생각한 연결 방법", model.imageNote);
  if (!model.posts.length)
    paragraph("나의 스타일 보드", "아직 직접 올린 게시물이 없어요.");
  for (let i = 0; i < model.posts.length; i++) {
    const post = model.posts[i];
    heading("나의 스타일 " + String(i + 1).padStart(2, "0"));
    if (post.hasImage) {
      const asset = assets.images?.find((a) => a.id === post.id);
      if (!asset)
        throw Error(
          "공유 이미지를 모두 불러오지 못했어요. 연결을 확인하고 PDF 저장을 다시 눌러주세요.",
        );
      const bytes = new Uint8Array(asset.bytes);
      const image =
        bytes[0] === 137
          ? await pdf.embedPng(bytes)
          : await pdf.embedJpg(bytes);
      const size = image.scaleToFit(CW, 290);
      ensure(size.height + 28, "나의 스타일 " + (i + 1));
      const x = M + (CW - size.width) / 2;
      rounded(M, y - size.height - 10, CW, size.height + 10, PALE, 12);
      page.drawImage(image, {
        x,
        y: y - size.height,
        width: size.width,
        height: size.height,
      });
      y -= size.height + 30;
    }
    paragraph("이 스타일을 고른 이유", post.reason);
    paragraph("표현하고 싶은 이미지", post.words.join(" · "));
    if (post.feedback.length) {
      for (let j = 0; j < post.feedback.length; j++)
        paragraph(
          "받은 피드백 " + String(j + 1).padStart(2, "0"),
          post.feedback[j],
        );
    } else paragraph("받은 피드백", "아직 받은 피드백이 없어요.");
    rule();
  }
  section(
    "04 / REFLECT",
    "오늘의 발견, 다음의 시도.",
    "좋아하는 색을 포기하지 않고, 오늘의 관찰을 나의 방식으로 이어가요.",
  );
  paragraph("좋아하는 색에 담긴 나의 이야기", model.reflection.favoriteReason);
  paragraph("오늘 새롭게 발견한 점", model.reflection.discovery);
  paragraph("다음에 시도해보고 싶은 색과 조합", model.reflection.nextTry);
  heading("일상에서 이렇게 써보세요.");
  paragraph(
    "얼굴 가까운 색",
    "상의·안경·액세서리는 오늘 자연스럽게 느꼈던 색을 실제로 대보고 선택해보세요.",
  );
  paragraph(
    "좋아하는 색을 쓰는 방법",
    "하의·가방·신발·작은 소품에도 좋아하는 색을 자유롭게 더해보세요.",
  );
  paragraph(
    "메이크업 색을 고를 때",
    "오늘 관찰한 색의 온도·밝기·선명함을 참고해 직접 발색해보세요. 브랜드나 제품 효능을 보장하는 추천은 아닙니다.",
  );
  paragraph(
    "이 기록의 기준",
    "화면과 사진의 색은 기기·조명에 따라 다르게 보일 수 있어요. 실물 관찰을 기준으로 참고하고, 한 번의 선택이나 횟수만으로 계절 유형을 확정하지 않습니다.",
    { color: MUTED },
  );
  if (unsupported.size)
    paragraph(
      "표시되지 않는 기호 안내",
      "폰트에서 지원하지 않는 일부 기호는 □로 표시했습니다. 원문은 사이트의 텍스트 백업으로 함께 보관해주세요.",
      { color: MUTED },
    );
  const pages = pdf.getPages();
  for (let i = 0; i < pages.length; i++) {
    page = pages[i];
    page.drawLine({
      start: { x: M, y: 48 },
      end: { x: W - M, y: 48 },
      thickness: 0.5,
      color: LINE,
    });
    line("COLOR STUDIO · MY COLOR NOTES", M, 33, 7.5, regular, MUTED);
    line(
      String(i + 1).padStart(2, "0") +
        " / " +
        String(pages.length).padStart(2, "0"),
      W - M - 34,
      33,
      8,
      regular,
      MUTED,
    );
  }
  return {
    bytes: await pdf.save(),
    pageCount: pages.length,
    unsupportedCount: unsupported.size,
  };
}
