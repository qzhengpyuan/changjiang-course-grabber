#!/usr/bin/env node
// 发布前闸门：语法、元数据块、版本号一致性。
// 脚本猫 webhook 是「push 即发布」，这里能挡住 90% 的低级事故。
import { readFileSync } from "node:fs";

const FILE = "changjiang-courseware-grabber.user.js";
const src = readFileSync(FILE, "utf8");
const problems = [];

if (!src.startsWith("// ==UserScript==")) problems.push("文件开头不是 UserScript 元数据块");

const endMarker = "// ==/UserScript==";
if (!src.includes(endMarker)) problems.push("缺少 // ==/UserScript== 结束标记");
const metaBlock = src.slice(0, src.indexOf(endMarker) + endMarker.length);

const meta = {};
for (const line of metaBlock.split("\n")) {
  const m = line.match(/^\/\/\s+@(\w+)\s+(.*)$/);
  if (!m) continue;
  const [, key, value] = m;
  meta[key] = meta[key] ? [].concat(meta[key], value) : value;
}

const version = meta.version;
if (!version) problems.push("缺少 @version");
else if (!/^\d+\.\d+\.\d+$/.test(version)) problems.push(`@version 不是 x.y.z：${version}`);

const fallback = src.match(/const FALLBACK_VERSION = "([^"]+)"/);
if (fallback && fallback[1] !== version) {
  problems.push(`FALLBACK_VERSION(${fallback[1]}) 与 @version(${version}) 不一致`);
}

const grants = [].concat(meta.grant || []);
for (const need of ["GM_download", "GM_xmlhttpRequest", "GM_setValue", "GM_getValue", "GM_addStyle"]) {
  if (!grants.includes(need)) problems.push(`缺少 @grant ${need}`);
}

const matches = [].concat(meta.match || []);
if (!matches.length) problems.push("缺少 @match");
for (const m of matches) {
  if (!/^https:\/\/changjiang\.yuketang\.cn\//.test(m)) problems.push(`@match 不在雨课堂域下：${m}`);
}

const connects = [].concat(meta.connect || []);
for (const host of ["changjiang.yuketang.cn", "xuetangx.com", "yuketang.cn", "aliyuncs.com"]) {
  if (!connects.includes(host)) problems.push(`缺少 @connect ${host}`);
}

const requiredMeta = ["name", "namespace", "description", "author", "license"];
for (const key of requiredMeta) if (!meta[key]) problems.push(`缺少 @${key}`);

if (problems.length) {
  console.error("元数据/发布检查未通过：");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`OK  ${meta.name} v${version}`);
