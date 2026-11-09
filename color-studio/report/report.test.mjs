import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PDFDocument, PDFName } from "pdf-lib";
import UPNGModule from "@pdf-lib/upng";
import { buildReportData, createReport } from "./report.mjs";
const UPNG = UPNGModule.default || UPNGModule;
const assets = {
  regular: fs.readFileSync(
    new URL("../fonts/ReportRegular.ttf", import.meta.url),
  ),
  semibold: fs.readFileSync(
    new URL("../fonts/ReportSemibold.ttf", import.meta.url),
  ),
  images: [],
};
const base = () => ({
  generatedAt: "2026-11-10T03:00:00Z",
  member: { name: "하늘", group: 2 },
  palette: [
    { name: "코랄", hex: "#df8b79" },
    { name: "블루", hex: "#829eb9" },
    { name: "올리브", hex: "#86895e" },
  ],
  config: { families: [] },
  book: {
    favorites: [0, 1, 2],
    records: {
      f0: {
        familyName: "빨강",
        self: "a",
        peer: ["b"],
        selfNote: "내가 작성한 관찰",
        peerNote: "조원이 관찰한 내용",
        colorLabels: { a: "코랄", b: "로즈" },
      },
    },
    concepts: { hue: "blue", reason: "내가 생각한 이유" },
    words: ["차분한"],
    imageNote: "블루 셔츠를 입고 싶어요.",
    reflection: {
      favoriteReason: "바다를 좋아해서 파랑을 좋아해요.",
      discovery: "입가 그림자의 차이를 발견했어요.",
      nextTry: "다음에는 블루와 아이보리를 입어볼 거예요.",
    },
  },
  posts: [
    {
      id: "mine",
      owner: true,
      reason: "내가 직접 공유한 스타일",
      words: ["차분한"],
      image: false,
      comments: [
        {
          name: "피드백작성자이름비공개",
          text: "아이보리를 더해보면 어떨까요?",
        },
      ],
    },
    {
      id: "other",
      owner: false,
      reason: "다른학생게시물제외문구",
      words: [],
      image: true,
      comments: [],
    },
  ],
});
function extract(bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "report-text-"));
  try {
    const file = path.join(dir, "report.pdf");
    fs.writeFileSync(file, bytes);
    return execFileSync("pdftotext", [file, "-"], { encoding: "utf8" }).replace(
      /\s/g,
      "",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
test("report data contains only own shared posts and removes feedback author identity", () => {
  const model = buildReportData(base());
  assert.equal(model.posts.length, 1);
  assert.deepEqual(model.posts[0].feedback, ["아이보리를 더해보면 어떨까요?"]);
  const json = JSON.stringify(model);
  assert(!json.includes("다른학생게시물제외문구"));
  assert(!json.includes("피드백작성자이름비공개"));
  assert.equal(model.records[0].disagrees, true);
});
test("actual A4 PDF preserves Korean observations, feedback and reflection as searchable text", async () => {
  const r = await createReport(base(), assets),
    pdf = await PDFDocument.load(r.bytes);
  assert(r.pageCount >= 5);
  assert.equal(pdf.getPages()[0].getWidth(), 595.28);
  assert.equal(pdf.getPages()[0].getHeight(), 841.89);
  const txt = extract(r.bytes);
  for (const text of [
    "내가작성한관찰",
    "조원이관찰한내용",
    "아이보리를더해보면어떨까요?",
    "다음에는블루와아이보리를입어볼거예요.",
  ])
    assert(txt.includes(text), text);
  assert(!txt.includes("다른학생게시물제외문구"));
  assert(!txt.includes("피드백작성자이름비공개"));
});
test("long Korean and unbroken text flows across pages without dropping the ending", async () => {
  const raw = base();
  raw.book.records.f0.selfNote =
    "긴관찰메모입니다. ".repeat(300) + "긴메모마지막표시";
  raw.book.records.f0.peerNote =
    "https://example.com/" + "path".repeat(300) + "URLENDMARKER";
  const r = await createReport(raw, assets),
    txt = extract(r.bytes);
  assert(r.pageCount > 5);
  assert(txt.includes("긴메모마지막표시"));
  assert(txt.includes("URLENDMARKER"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "report-bounds-"));
  try {
    const file = path.join(dir, "report.pdf");
    fs.writeFileSync(file, r.bytes);
    const xml = execFileSync("pdftotext", ["-bbox", file, "-"], {
      encoding: "utf8",
    });
    const words = [
      ...xml.matchAll(
        /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"/g,
      ),
    ];
    assert(words.length > 100);
    for (const m of words) {
      assert(
        Number(m[1]) >= 50 && Number(m[3]) <= 545,
        "text crosses horizontal page margin",
      );
      assert(
        Number(m[2]) >= 20 && Number(m[4]) <= 823,
        "text crosses page edge",
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("owned images are embedded and missing images stop the export", async () => {
  const raw = base();
  raw.posts[0].image = true;
  await assert.rejects(() => createReport(raw, assets), /공유 이미지/);
  const bytes = new Uint8Array(
    UPNG.encode([new Uint8Array([100, 150, 200, 255]).buffer], 1, 1, 0),
  );
  const r = await createReport(raw, {
      ...assets,
      images: [{ id: "mine", bytes }],
    }),
    pdf = await PDFDocument.load(r.bytes);
  assert(
    pdf.getPages().some((p) => p.node.Resources()?.get(PDFName.of("XObject"))),
  );
  assert(extract(r.bytes).includes("내가직접공유한스타일"));
});
