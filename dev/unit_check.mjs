import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../changjiang-courseware-grabber.user.js", import.meta.url), "utf8");

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`not found: ${name}`);
  while (start > 0 && /[a-z ]/.test(src[start - 1]) && src.slice(start - 7, start) === "async ") break;
  const sliceStart = src.slice(start - 6, start) === "async " ? start - 6 : start;
  let i = src.indexOf("{", start), depth = 0, state = null, prev = "", klass = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (state === "str") { if (ch === "\\") { i++; continue; } if (ch === state[1]) state = null; continue; }
    if (state === "tpl") { if (ch === "\\") { i++; continue; } if (ch === "`") state = null; continue; }
    if (state === "re") {
      if (ch === "\\") { i++; continue; }
      if (ch === "[" && !klass) klass = true;
      else if (ch === "]" && klass) klass = false;
      else if (ch === "/" && !klass) state = null;
      continue;
    }
    if (ch === '"' || ch === "'") { state = "str" + ch; continue; }
    if (ch === "`") { state = "tpl"; continue; }
    if (ch === "/" && (prev === "" || "=(,!:&|?{};[".includes(prev))) { state = "re"; klass = false; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return src.slice(sliceStart, i + 1); }
    if (!/\s/.test(ch)) prev = ch;
  }
  throw new Error(`unbalanced: ${name}`);
}

const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
const APP = "cjyk-test";
const body = ["jpegSize", "buildPdfFromJpegs", "sanitizeFileName", "runPool"].map(extract).join("\n");
const factory = new Function("APP", "WINDOWS_RESERVED", `return (async () => {\n${body}\nreturn { jpegSize, buildPdfFromJpegs, sanitizeFileName, runPool };\n})();`);
const api = await factory(APP, WINDOWS_RESERVED);

const read = (p) => readFileSync(p);
const gray = read("/tmp/gray.jpg"), rgb = read("/tmp/rgb.jpg"), cmyk = read("/tmp/cmyk.jpg");
const results = [];
const ok = (name, cond, extra = "") => results.push([cond ? "PASS" : "FAIL", name, extra]);

const gs = api.jpegSize(gray), rs = api.jpegSize(rgb), cs = api.jpegSize(cmyk);
ok("jpegSize components: gray=1", gs && gs.components === 1, JSON.stringify(gs));
ok("jpegSize components: rgb=3", rs && rs.components === 3, JSON.stringify(rs));
ok("jpegSize components: cmyk=4", cs && cs.components === 4, JSON.stringify(cs));

const asText = async (b) => Buffer.from(new Uint8Array(await b.arrayBuffer())).toString("latin1");
const pdfGray = await asText(await api.buildPdfFromJpegs([{ jpeg: gray, components: gs.components }], 40, 30));
const pdfRgb = await asText(await api.buildPdfFromJpegs([{ jpeg: rgb, components: rs.components }], 40, 30));
const pdfCmyk = await asText(await api.buildPdfFromJpegs([{ jpeg: cmyk, components: cs.components }], 40, 30));
ok("PDF: gray 用 /DeviceGray", pdfGray.includes("/DeviceGray"), "");
ok("PDF: gray 不含 /DeviceRGB", !pdfGray.includes("/DeviceRGB"), "");
ok("PDF: rgb 用 /DeviceRGB", pdfRgb.includes("/DeviceRGB"), "");
ok("PDF: cmyk 用 /DeviceCMYK", pdfCmyk.includes("/DeviceCMYK"), "");

ok("sanitize: CON -> _CON", api.sanitizeFileName("CON") === "_CON");
ok("sanitize: aux.txt -> _aux.txt", api.sanitizeFileName("aux.txt") === "_aux.txt");
ok("sanitize: 结尾点去掉", api.sanitizeFileName("课件...") === "课件");
ok("sanitize: 结尾空格去掉", api.sanitizeFileName("课件   ") === "课件");
ok("sanitize: 非法字符替换", api.sanitizeFileName('a/b:c*d?e"f<g>h|i') === "a_b_c_d_e_f_g_h_i");
ok("sanitize: 空值用 fallback", api.sanitizeFileName("   ") === "未命名");
ok("sanitize: 长度<=120", api.sanitizeFileName("x".repeat(200)).length <= 120);

const seen = [];
await api.runPool(["a", "a", "b", "a"], 2, async (item, index) => {
  await new Promise((r) => setTimeout(r, 5));
  seen.push([item, index]);
});
ok("runPool: 每项各跑一次", seen.length === 4);
ok("runPool: 重复项索引正确", JSON.stringify(seen.map((x) => x[1]).sort()) === "[0,1,2,3]", JSON.stringify(seen));

for (const [state, name, extra] of results) console.log(`${state}  ${name}${extra ? "  " + extra : ""}`);
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(failed ? `\n${failed} 项失败` : `\n全部 ${results.length} 项通过`);
process.exit(failed ? 1 : 0);
