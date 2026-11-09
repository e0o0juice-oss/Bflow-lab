import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";
const here = path.dirname(fileURLToPath(import.meta.url)),
  vendor = path.join(here, "../vendor");
await build({
  entryPoints: [path.join(here, "report.mjs")],
  outfile: path.join(vendor, "report.min.js"),
  bundle: true,
  format: "iife",
  globalName: "ColorReport",
  target: ["es2022"],
  minify: true,
  legalComments: "eof",
});
await fs.copyFile(
  path.join(here, "node_modules/pdf-lib/LICENSE.md"),
  path.join(vendor, "PDF-LIB-LICENSE.txt"),
);
const fontkitNotice = path.join(vendor, "FONTKIT-LICENSE.txt");
await fs.access(fontkitNotice);
const lock = JSON.parse(
  await fs.readFile(path.join(here, "package-lock.json"), "utf8"),
);
let notices = "Color Studio PDF dependencies\n\n";
for (const [dir, pkg] of Object.entries(lock.packages)) {
  if (!dir || pkg.dev) continue;
  const name = dir.replace(/^.*node_modules\//, "");
  notices += `\n--- ${name} ${pkg.version} (${pkg.license || "see package"}) ---\n`;
  const folder = path.join(here, dir),
    files = await fs.readdir(folder);
  const license = files.find((n) =>
    /^licen[sc]e(?:\.|$)|^copying(?:\.|$)/i.test(n),
  );
  if (license) notices += await fs.readFile(path.join(folder, license), "utf8");
  else if (name === "@pdf-lib/fontkit")
    notices += await fs.readFile(fontkitNotice, "utf8");
  else throw Error("Missing dependency notice for " + name);
  notices += "\n";
}
await fs.writeFile(
  path.join(vendor, "PDF-THIRD-PARTY-NOTICES.txt"),
  notices.split(String.fromCharCode(13)).join(""),
);
for (const weight of ["Regular", "Semibold"]) {
  const file = path.join(here, "../fonts/Report" + weight + ".ttf");
  const font = await fs.readFile(file);
  await fs.writeFile(
    file + ".br",
    brotliCompressSync(font, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 9 },
    }),
  );
}
console.log(
  "PDF browser bundle, font compression and license notices prepared.",
);
