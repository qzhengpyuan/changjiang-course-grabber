// ==UserScript==
// @name         长江雨课堂 课件抓取助手
// @namespace    https://github.com/qzhengpyuan/changjiang-course-grabber
// @version      2.8.0
// @icon         https://cdn.jsdelivr.net/gh/qzhengpyuan/changjiang-course-grabber@main/assets/icon-64.png
// @icon64       https://cdn.jsdelivr.net/gh/qzhengpyuan/changjiang-course-grabber@main/assets/icon-128.png
// @homepageURL  https://github.com/qzhengpyuan/changjiang-course-grabber
// @supportURL   https://github.com/qzhengpyuan/changjiang-course-grabber/issues
// @updateURL    https://scriptcat.org/scripts/code/9063/9063.user.js
// @downloadURL  https://scriptcat.org/scripts/code/9063/9063.user.js
// @license      MIT
// @description  抓取长江雨课堂的 PPT 课件（合并 PDF / 图片版 PPTX / 图片 ZIP）与视频直链，含「课堂」里上课时投出来的那套课件，支持整门课批量。基于「学习通 PDF 抓取助手」的工具栏、进度面板与 STORE ZIP 框架改写。
// @author       qzhengpyuan
// @tag          雨课堂
// @tag          课件下载
// @tag          学习辅助
// @tag          视频下载
// @match        https://changjiang.yuketang.cn/v2/web/studentLog/*
// @match        https://changjiang.yuketang.cn/ai-workspace/lms-graph/*/video/*
// @match        https://changjiang.yuketang.cn/pro/lms/*/studycontent*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      changjiang.yuketang.cn
// @connect      yangtse-oplat.xuetangx.com
// @connect      ali-cdn.xuetangx.com
// @connect      xuetangx.com
// @connect      yuketang.cn
// @connect      changjiang-private-qn.yuketang.cn
// @connect      aliyuncs.com
// @connect      yangtse-oplat.oss-cn-beijing.aliyuncs.com
// @connect      qn-sfe.yuketang.cn
// @run-at       document-idle
// ==/UserScript==

/*
 * 从参考项目（学习通 PDF 抓取助手 v0.1.20）复用的模块：
 *   - createStoredZipBlob / encodeUtf8 / toDosDateTime / crc32 / yieldToBrowser  → STORE ZIP 写入器
 *   - createProgressPanel / createProgressReporter / setButtonBusy / showToast   → 进度与提示
 *   - triggerBlobDownload / makeUniqueFileName / sanitizeFileName / formatBytes  → 下载与命名
 *   - createButton / bindButtonClick / ensureActionButton / styleText            → 工具栏与逐条按钮
 * 替换掉的模块：
 *   - 学习通章节树解析（coursetree / chapterId / objectId）→ 雨课堂日志接口 /v2/api/web/logs/learn
 *   - PDF 直链下载 → 雨课堂 cards/detlist 幻灯片图 + JPEG 直嵌 PDF 生成
 * 新增模块：
 *   - buildPdfFromJpegs（DCTDecode 直嵌，无第三方依赖）
 *   - 视频 link 解析（leaf_info → audiovideo/playurl）
 */

(function () {
  "use strict";

  const APP = "cjyk";
  const APP_NAME = "changjiang-courseware-grabber";
  const VERSION = "2.8.0";
  const STYLE_VERSION = "2.8.0";

  const LOG_PAGE_LIMIT = 30;
  const SLIDE_CONCURRENCY = 3;
  const FETCH_TIMEOUT = 60000;
  const METADATA_CACHE_TTL_MS = 60 * 60 * 1000;
  const ZIP_MAX_FILE_COUNT = 400;
  const ZIP_MAX_TOTAL_BYTES = 400 * 1024 * 1024;
  const VIDEO_QUALITY_ORDER = ["quality20", "quality10"];

  const OWN_SELECTOR = [
    ".cjyk-toolbar",
    ".cjyk-actions",
    ".cjyk-btn",
    ".cjyk-toast-wrap",
    ".cjyk-toast",
    ".cjyk-progress",
    ".cjyk-modal-backdrop",
  ].join(",");

  const UI_REFRESH_SELECTOR = [
    ".activity-box",
    ".activity__wrap",
    ".studentCard",
    ".el-tab-pane",
  ].join(",");

  const injectedDocs = new WeakSet();
  const observedDocs = new WeakSet();

  const styleText = `
    .cjyk-toolbar {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      margin: 10px 20px; min-height: 28px;
      font-family: "Microsoft YaHei", Arial, sans-serif;
    }
    .cjyk-toolbar-title { color: #131b26; font-size: 13px; font-weight: 600; white-space: nowrap; }
    .cjyk-actions { display: inline-flex; align-items: center; gap: 6px; }
    .cjyk-btn {
      display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;
      min-width: 60px; height: 26px; padding: 0 9px; border: 1px solid #2f7df6; border-radius: 4px;
      background: #2f7df6; color: #fff !important; cursor: pointer;
      font: 12px/1 "Microsoft YaHei", Arial, sans-serif; text-decoration: none !important;
      white-space: nowrap; user-select: none; transition: background .15s ease, opacity .15s ease;
    }
    .cjyk-btn:hover { background: #1f6ae0; }
    .cjyk-btn:disabled, .cjyk-btn.cjyk-busy { opacity: .55; cursor: progress; }
    .cjyk-btn-secondary { background: #fff !important; color: #1b2733 !important; border-color: #c4d2ec; }
    .cjyk-btn-secondary:hover { background: #eef4ff !important; }
    .cjyk-btn-small { min-width: 42px; height: 22px; padding: 0 7px; font-size: 11px; }
    .cjyk-actions-inline { margin-left: 8px; }

    .cjyk-progress {
      position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;
      width: 280px; padding: 10px 12px; border-radius: 8px; background: #fff; color: #1b2733;
      box-shadow: 0 6px 24px rgba(0,0,0,.22); font: 12px/1.5 "Microsoft YaHei", Arial, sans-serif;
    }
    .cjyk-progress-head { display: flex; align-items: center; gap: 8px; }
    .cjyk-progress-title { flex: 1; font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cjyk-progress-close { border: none; background: transparent; cursor: pointer; color: #8493a8; font-size: 14px; line-height: 1; }
    .cjyk-progress-status { display: flex; justify-content: space-between; color: #64748b; margin-top: 6px; }
    .cjyk-progress-track { height: 5px; margin-top: 6px; background: #e8edf6; border-radius: 3px; overflow: hidden; }
    .cjyk-progress-bar { height: 100%; width: 0; background: #2f7df6; transition: width .2s ease; }
    .cjyk-progress-detail { margin-top: 6px; color: #8493a8; font-size: 11px; word-break: break-all; }

    .cjyk-toast-wrap { position: fixed; left: 50%; top: 24px; transform: translateX(-50%); z-index: 2147483002; display: flex; flex-direction: column; gap: 8px; align-items: center; }
    .cjyk-toast {
      padding: 8px 16px; border-radius: 6px; background: rgba(20,28,40,.94); color: #fff;
      font: 13px/1.4 "Microsoft YaHei", Arial, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.25);
    }
    .cjyk-toast-success { background: rgba(22,120,66,.95); }
    .cjyk-toast-error { background: rgba(176,42,42,.95); }

    .cjyk-modal-backdrop {
      position: fixed; inset: 0; z-index: 2147483003; background: rgba(12,18,28,.55);
      display: flex; align-items: center; justify-content: center;
    }
    .cjyk-modal {
      width: min(460px, 92vw); background: #fff; border-radius: 10px; padding: 16px 18px;
      font: 13px/1.6 "Microsoft YaHei", Arial, sans-serif; color: #1b2733; position: relative;
    }
    .cjyk-modal-title { margin: 0 0 8px; font-size: 15px; }
    .cjyk-modal-close { position: absolute; right: 10px; top: 8px; border: none; background: transparent; font-size: 18px; color: #8493a8; cursor: pointer; }
    .cjyk-modal-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
    .cjyk-modal-size { margin-top: 8px; color: #b02a2a; font-weight: 600; }

    .cjyk-dl-modal { width: min(580px, 94vw); max-height: 88vh; display: flex; flex-direction: column; }
    .cjyk-dl-toolbar { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; margin: 10px 0 8px; font-size: 12px; color: #334155; }
    .cjyk-dl-toolbar label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
    .cjyk-dl-format select { margin-left: 4px; padding: 2px 4px; border: 1px solid #cfd8e6; border-radius: 4px; background: #fff; color: #1b2733; font-size: 12px; }
    .cjyk-dl-list { flex: 1; overflow: auto; border: 1px solid #e2e8f2; border-radius: 8px; padding: 4px 6px; min-height: 120px; }
    .cjyk-dl-section-head { font-size: 12px; font-weight: 600; color: #64748b; padding: 6px 4px 2px; }
    .cjyk-dl-row { display: flex; align-items: center; gap: 8px; padding: 5px 4px; border-radius: 6px; cursor: pointer; font-size: 12px; }
    .cjyk-dl-row:hover { background: #f6f9ff; }
    /* 站点全局样式会把 checkbox 压成 0×0 / appearance:none，这里强制还原 */
    .cjyk-dl-row input[type="checkbox"],
    .cjyk-dl-toolbar input[type="checkbox"] {
      appearance: auto; -webkit-appearance: checkbox; width: 14px; height: 14px;
      min-width: 14px; margin: 0; flex: none; accent-color: #2f7df6; cursor: pointer;
    }
    .cjyk-dl-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cjyk-dl-meta { color: #8493a8; font-size: 11px; white-space: nowrap; }
    .cjyk-dl-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; gap: 10px; }
    .cjyk-dl-actions { display: flex; gap: 8px; }
    .cjyk-dl-summary { color: #64748b; font-size: 12px; }
  `;

  /* ------------------------------------------------------------------ */
  /* 基础工具（复用参考项目）                                            */
  /* ------------------------------------------------------------------ */

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sanitizeFileName(value, fallback = "未命名") {
    let name = String(value || "")
      .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\.+/, "");
    if (!name) name = fallback;
    if (name.length > 120) name = name.slice(0, 120);
    return name;
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function yieldToBrowser() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function timestampName(date = new Date()) {
    const pad = (v) => String(v).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  }

  /* ------------------------------------------------------------------ */
  /* STORE ZIP（复用参考项目 createStoredZipBlob）                        */
  /* ------------------------------------------------------------------ */

  function encodeUtf8(value) {
    return new TextEncoder().encode(String(value || ""));
  }

  function toDosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = Math.floor(date.getSeconds() / 2);
    return {
      date: ((year - 1980) << 9) | (month << 5) | day,
      time: (hours << 11) | (minutes << 5) | seconds,
    };
  }

  const crc32Table = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      }
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(data) {
    let crc = 0xffffffff;
    for (let index = 0; index < data.length; index += 1) {
      crc = crc32Table[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  async function createStoredZipBlob(entries, onProgress) {
    if (!entries.length) {
      throw new Error("没有可写入 ZIP 的文件。");
    }

    const files = [];
    let offset = 0;
    const now = new Date();

    for (const [index, entry] of entries.entries()) {
      await yieldToBrowser();
      const pathBytes = encodeUtf8(entry.path);
      const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
      const crc = crc32(data);
      const dos = toDosDateTime(entry.date || now);

      if (pathBytes.length > 0xffff) {
        throw new Error(`ZIP 路径过长：${entry.path}`);
      }
      if (data.length > 0xffffffff || offset > 0xffffffff) {
        throw new Error("文件过大，当前浏览器端 ZIP 写入器不支持 ZIP64。");
      }

      const localHeader = new Uint8Array(30 + pathBytes.length);
      const localView = new DataView(localHeader.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, dos.time, true);
      localView.setUint16(12, dos.date, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, pathBytes.length, true);
      localView.setUint16(28, 0, true);
      localHeader.set(pathBytes, 30);

      files.push({ path: entry.path, pathBytes, data, crc, dos, localHeader, localOffset: offset });
      offset += localHeader.length + data.length;
      if (typeof onProgress === "function") onProgress(index + 1, entries.length, entry.path);
    }

    const centralParts = [];
    let centralSize = 0;
    for (const file of files) {
      const centralHeader = new Uint8Array(46 + file.pathBytes.length);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, file.dos.time, true);
      centralView.setUint16(14, file.dos.date, true);
      centralView.setUint32(16, file.crc, true);
      centralView.setUint32(20, file.data.length, true);
      centralView.setUint32(24, file.data.length, true);
      centralView.setUint16(28, file.pathBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, file.localOffset, true);
      centralHeader.set(file.pathBytes, 46);
      centralParts.push(centralHeader);
      centralSize += centralHeader.length;
    }

    const centralOffset = offset;
    const endHeader = new Uint8Array(22);
    const endView = new DataView(endHeader.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, centralOffset, true);
    endView.setUint16(20, 0, true);

    const parts = [];
    for (const file of files) parts.push(file.localHeader, file.data);
    parts.push(...centralParts, endHeader);

    if (typeof onProgress === "function") onProgress(entries.length, entries.length, "ZIP 写入完成");
    return new Blob(parts, { type: "application/zip" });
  }

  /* ------------------------------------------------------------------ */
  /* PDF 生成：JPEG 直嵌（DCTDecode）                                     */
  /* ------------------------------------------------------------------ */

  function buildPdfFromJpegs(pages, pageWidth, pageHeight) {
    const encoder = new TextEncoder();
    const chunks = [];
    const offsets = [];
    let offset = 0;

    const push = (data) => {
      const bytes = typeof data === "string" ? encoder.encode(data) : data;
      chunks.push(bytes);
      offset += bytes.length;
    };

    push("%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n");

    const total = pages.length;
    const pageNumbers = pages.map((_, index) => 3 + index * 3);
    const maxObject = 2 + total * 3;

    const addObject = (number, parts) => {
      offsets[number] = offset;
      push(`${number} 0 obj\n`);
      for (const part of parts) push(part);
      push("\nendobj\n");
    };

    addObject(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
    addObject(2, [`<< /Type /Pages /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(" ")}] /Count ${total} >>`]);

    pages.forEach((page, index) => {
      const pageNumber = pageNumbers[index];
      const contentNumber = pageNumber + 1;
      const imageNumber = pageNumber + 2;
      const width = Number(pageWidth || page.width || 960);
      const height = Number(pageHeight || page.height || 720);
      const content = `q\n${width.toFixed(2)} 0 0 ${height.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`;

      addObject(pageNumber, [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width.toFixed(2)} ${height.toFixed(2)}] ` +
        `/Resources << /XObject << /Im0 ${imageNumber} 0 R >> /ProcSet [/PDF /ImageC] >> ` +
        `/Contents ${contentNumber} 0 R >>`,
      ]);
      addObject(contentNumber, [`<< /Length ${content.length} >>\nstream\n`, content, "endstream"]);

      offsets[imageNumber] = offset;
      push(`${imageNumber} 0 obj\n`);
      push(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.byteLength} >>\nstream\n`);
      push(new Uint8Array(page.jpeg));
      push("\nendstream\nendobj\n");
    });

    const xrefStart = offset;
    let xref = `xref\n0 ${maxObject + 1}\n0000000000 65535 f \n`;
    for (let number = 1; number <= maxObject; number += 1) {
      xref += `${String(offsets[number] || 0).padStart(10, "0")} 00000 n \n`;
    }
    push(xref);
    push(`trailer\n<< /Size ${maxObject + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

    return new Blob(chunks, { type: "application/pdf" });
  }

  /* ------------------------------------------------------------------ */
  /* PPTX（图片版）：雨课堂只把幻灯片渲染成整页图，拿不到老师的原始 pptx。 */
  /* 这里把每页图塞进一张整页图片的形状里，得到一个能在 PowerPoint / WPS */
  /* 里正常打开、放映、批注的 .pptx —— 文字不是可编辑文本，是整页位图。   */
  /* ------------------------------------------------------------------ */

  const PPTX_NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const PPTX_NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const PPTX_NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const PPTX_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

  function xmlEscapeText(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]
    ));
  }

  function buildPptxFromJpegs(pages, pageWidth, pageHeight, title) {
    const EMU_PER_PT = 12700;
    const cx = Math.round((Number(pageWidth) || 960) * EMU_PER_PT);
    const cy = Math.round((Number(pageHeight) || 720) * EMU_PER_PT);
    const total = pages.length;
    const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const spTreeEmpty =
      '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
      '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';

    const contentTypes = head +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      pages.map((_, index) =>
        `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
      ).join("") +
      "</Types>";

    const packageRels = head +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' + PPTX_REL + '/officeDocument" Target="ppt/presentation.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="' + PPTX_REL + '/extended-properties" Target="docProps/app.xml"/>' +
      "</Relationships>";

    const coreXml = head +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${xmlEscapeText(title || "长江雨课堂课件")}</dc:title>` +
      "<dc:creator>changjiang-course-grabber</dc:creator>" +
      "</cp:coreProperties>";

    const appXml = head +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      "<Application>changjiang-course-grabber</Application>" +
      `<Slides>${total}</Slides>` +
      "</Properties>";

    const slideIds = pages.map((_, index) =>
      `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`
    ).join("");

    const presentationXml = head +
      `<p:presentation xmlns:a="${PPTX_NS_A}" xmlns:r="${PPTX_NS_R}" xmlns:p="${PPTX_NS_P}" saveSubsetFonts="1">` +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
      `<p:sldIdLst>${slideIds}</p:sldIdLst>` +
      `<p:sldSz cx="${cx}" cy="${cy}"/>` +
      '<p:notesSz cx="6858000" cy="9144000"/>' +
      "</p:presentation>";

    const presentationRels = head +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${PPTX_REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
      pages.map((_, index) =>
        `<Relationship Id="rId${index + 2}" Type="${PPTX_REL}/slide" Target="slides/slide${index + 1}.xml"/>`
      ).join("") +
      "</Relationships>";

    const masterXml = head +
      `<p:sldMaster xmlns:a="${PPTX_NS_A}" xmlns:r="${PPTX_NS_R}" xmlns:p="${PPTX_NS_P}">` +
      `<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${spTreeEmpty}</p:cSld>` +
      '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" ' +
      'accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" ' +
      'hlink="hlink" folHlink="folHlink"/>' +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
      "</p:sldMaster>";

    const masterRels = head +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${PPTX_REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
      `<Relationship Id="rId2" Type="${PPTX_REL}/theme" Target="../theme/theme1.xml"/>` +
      "</Relationships>";

    const layoutXml = head +
      `<p:sldLayout xmlns:a="${PPTX_NS_A}" xmlns:r="${PPTX_NS_R}" xmlns:p="${PPTX_NS_P}" type="blank" preserve="1">` +
      `<p:cSld name="Blank">${spTreeEmpty}</p:cSld>` +
      "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>" +
      "</p:sldLayout>";

    const layoutRels = head +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${PPTX_REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>` +
      "</Relationships>";

    const themeXml = head +
      `<a:theme xmlns:a="${PPTX_NS_A}" name="Office Theme"><a:themeElements>` +
      '<a:clrScheme name="Office">' +
      '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
      '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
      '<a:dk2><a:srgbClr val="44546A"/></a:dk2>' +
      '<a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
      '<a:accent1><a:srgbClr val="4472C4"/></a:accent1>' +
      '<a:accent2><a:srgbClr val="ED7D31"/></a:accent2>' +
      '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>' +
      '<a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
      '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>' +
      '<a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
      '<a:hlink><a:srgbClr val="0563C1"/></a:hlink>' +
      '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>' +
      "</a:clrScheme>" +
      '<a:fontScheme name="Office">' +
      '<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
      '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>' +
      "</a:fontScheme>" +
      '<a:fmtScheme name="Office">' +
      "<a:fillStyleLst>" +
      '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
      '<a:solidFill><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:solidFill>' +
      '<a:solidFill><a:schemeClr val="phClr"><a:shade val="80000"/></a:schemeClr></a:solidFill>' +
      "</a:fillStyleLst>" +
      "<a:lnStyleLst>" +
      '<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
      '<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
      '<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
      "</a:lnStyleLst>" +
      "<a:effectStyleLst>" +
      "<a:effectStyle><a:effectLst/></a:effectStyle>" +
      "<a:effectStyle><a:effectLst/></a:effectStyle>" +
      "<a:effectStyle><a:effectLst/></a:effectStyle>" +
      "</a:effectStyleLst>" +
      "<a:bgFillStyleLst>" +
      '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
      '<a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/></a:schemeClr></a:solidFill>' +
      '<a:solidFill><a:schemeClr val="phClr"><a:shade val="90000"/></a:schemeClr></a:solidFill>' +
      "</a:bgFillStyleLst>" +
      "</a:fmtScheme></a:themeElements></a:theme>";

    const entries = [
      { path: "[Content_Types].xml", data: new TextEncoder().encode(contentTypes) },
      { path: "_rels/.rels", data: new TextEncoder().encode(packageRels) },
      { path: "docProps/core.xml", data: new TextEncoder().encode(coreXml) },
      { path: "docProps/app.xml", data: new TextEncoder().encode(appXml) },
      { path: "ppt/presentation.xml", data: new TextEncoder().encode(presentationXml) },
      { path: "ppt/_rels/presentation.xml.rels", data: new TextEncoder().encode(presentationRels) },
      { path: "ppt/slideMasters/slideMaster1.xml", data: new TextEncoder().encode(masterXml) },
      { path: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: new TextEncoder().encode(masterRels) },
      { path: "ppt/slideLayouts/slideLayout1.xml", data: new TextEncoder().encode(layoutXml) },
      { path: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: new TextEncoder().encode(layoutRels) },
      { path: "ppt/theme/theme1.xml", data: new TextEncoder().encode(themeXml) },
    ];

    pages.forEach((page, index) => {
      const slideXml = head +
        `<p:sld xmlns:a="${PPTX_NS_A}" xmlns:r="${PPTX_NS_R}" xmlns:p="${PPTX_NS_P}">` +
        "<p:cSld><p:spTree>" +
        '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
        '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
        '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
        "<p:pic>" +
        `<p:nvPicPr><p:cNvPr id="2" name="Slide ${index + 1}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
        '<p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
        `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
        "</p:pic></p:spTree></p:cSld>" +
        "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>" +
        "</p:sld>";

      const slideRels = head +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${PPTX_REL}/image" Target="../media/image${index + 1}.jpeg"/>` +
        "</Relationships>";

      entries.push({ path: `ppt/slides/slide${index + 1}.xml`, data: new TextEncoder().encode(slideXml) });
      entries.push({ path: `ppt/slides/_rels/slide${index + 1}.xml.rels`, data: new TextEncoder().encode(slideRels) });
      entries.push({ path: `ppt/media/image${index + 1}.jpeg`, data: new Uint8Array(page.jpeg) });
    });

    return entries;
  }

  function jpegSize(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let index = 2;
    while (index < bytes.length - 9) {
      if (bytes[index] !== 0xff) { index += 1; continue; }
      const marker = bytes[index + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (bytes[index + 5] << 8) | bytes[index + 6], width: (bytes[index + 7] << 8) | bytes[index + 8] };
      }
      const length = (bytes[index + 2] << 8) | bytes[index + 3];
      if (length < 2) return null;
      index += 2 + length;
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* 下载（复用参考项目 triggerBlobDownload / makeUniqueFileName）         */
  /* ------------------------------------------------------------------ */

  // 浏览器对「一次点击连续触发多个下载」有限制：只有第一个会落盘，其余被静默丢弃
  // （Vivaldi/Chrome 的「自动下载多个文件」策略）。批量抓全课时这一条会吃掉后面所有文件，
  // 所以优先走扩展的 GM_download（chrome.downloads，不受该策略限制），失败才退回 <a download>。
  function anchorBlobDownload(doc, url, filename) {
    const anchor = doc.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    doc.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      anchor.remove();
    }, 30000);
  }

  function triggerBlobDownload(doc, blob, filename) {
    const url = URL.createObjectURL(blob);
    if (typeof GM_download === "function") {
      let fellBack = false;
      const fallback = () => {
        if (fellBack) return;
        fellBack = true;
        anchorBlobDownload(doc, url, filename);
      };
      try {
        const ret = GM_download({
          url,
          name: filename,
          saveAs: false,
          onerror: () => {
            console.warn(`[${APP}] GM_download 失败，退回 <a download>：${filename}`);
            fallback();
          },
        });
        if (ret && typeof ret.then === "function") {
          ret.then(null, () => fallback());
        }
        // GM_download 是异步读取 blob 的，URL 要留久一点再回收
        setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
        return;
      } catch (error) {
        console.warn(`[${APP}] GM_download 抛错，退回 <a download>：${error.message}`);
      }
    }
    anchorBlobDownload(doc, url, filename);
  }

  function makeUniqueFileName(filename, usedNames) {
    const safeName = sanitizeFileName(filename);
    const dotIndex = safeName.lastIndexOf(".");
    const base = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
    const ext = dotIndex > 0 ? safeName.slice(dotIndex) : "";
    let index = 0;
    let candidate = safeName;
    while (usedNames.has(candidate)) {
      index += 1;
      candidate = `${base} (${index + 1})${ext}`;
    }
    usedNames.add(candidate);
    return candidate;
  }

  const BLOB_FALLBACK_LIMIT = 200 * 1024 * 1024;

  // 视频落盘：优先 GM_download（ScriptCat 提供，流式写盘，不吃内存）；
  // 没有 GM_download 时，小文件用 fetch→Blob→a[download]，
  // 大文件不硬来（跨域 a[download] 会被浏览器忽略并直接跳转播放），改为复制直链。
  async function downloadVideoFile(url, filename, size, onProgress) {
    if (typeof GM_download === "function") {
      return gmDownload(url, filename, onProgress);
    }
    if (size && size > BLOB_FALLBACK_LIMIT) {
      try {
        await navigator.clipboard.writeText(url);
      } catch (error) {
        /* 剪贴板不可用时忽略 */
      }
      throw new Error(
        `文件 ${formatBytes(size)} 超过浏览器直存上限，直链已复制到剪贴板，请用 aria2c/curl 下载`
      );
    }

    const response = await fetch(url, { credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const total = Number(response.headers.get("content-length")) || size || 0;
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      if (typeof onProgress === "function") onProgress({ loaded, total });
    }
    const blob = new Blob(chunks, { type: "video/mp4" });
    triggerBlobDownload(getDoc(), blob, filename);
    return true;
  }

  function gmDownload(url, filename, onProgress) {
    return new Promise((resolve, reject) => {
      if (typeof GM_download !== "function") {
        reject(new Error("GM_download 不可用"));
        return;
      }
      try {
        GM_download({
          url,
          name: filename,
          timeout: 0,
          onload: () => resolve(true),
          onerror: (error) => reject(new Error((error && error.error) || "下载失败")),
          ontimeout: () => reject(new Error("下载超时")),
          onprogress: (progress) => {
            if (typeof onProgress === "function") onProgress(progress);
          },
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* 网络                                                                */
  /* ------------------------------------------------------------------ */

  async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || FETCH_TIMEOUT);
    try {
      const response = await fetch(url, {
        credentials: "include",
        headers: Object.assign({ xtbz: "ykt" }, options.headers || {}),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // CDN 返回 Access-Control-Allow-Origin: *，带 cookie 的 fetch 会被浏览器拒绝，
  // 因此必须 credentials:"omit"；再失败退回 GM_xmlhttpRequest。
  function gmFetchArrayBuffer(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("GM_xmlhttpRequest 不可用"));
        return;
      }
      GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType: "arraybuffer",
        timeout: 120000,
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) resolve(response.response);
          else reject(new Error(`HTTP ${response.status}`));
        },
        onerror: () => reject(new Error("网络错误")),
        ontimeout: () => reject(new Error("超时")),
      });
    });
  }

  async function fetchBinary(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const response = await fetch(url, { credentials: "omit", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.arrayBuffer();
    } catch (error) {
      clearTimeout(timer);
      return await gmFetchArrayBuffer(url);
    } finally {
      clearTimeout(timer);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 雨课堂 API                                                          */
  /* ------------------------------------------------------------------ */

  let classroomId = null;

  function detectClassroomId() {
    const match = location.pathname.match(/\/studentLog\/(\d+)/);
    if (match) return match[1];
    // 学习内容（/pro/lms/{sign}/{classroom_id}/studycontent）
    const proMatch = location.pathname.match(/\/pro\/lms\/[^/]+\/(\d+)\/studycontent/);
    return proMatch ? proMatch[1] : null;
  }

  async function fetchActivities(onProgress) {
    const all = [];
    for (let page = 0; page < LOG_PAGE_LIMIT; page += 1) {
      const data = await fetchJson(`/v2/api/web/logs/learn/${classroomId}?actype=-1&page=${page}&offset=20&sort=-1`);
      if (data.errcode !== 0) throw new Error(`日志接口失败：${data.errmsg || data.errcode}`);
      const activities = (data.data && data.data.activities) || [];
      all.push(...activities);
      if (typeof onProgress === "function") {
        onProgress({ stage: "读取课程日志", current: page + 1, total: 0, detail: `已获取 ${all.length} 条` });
      }
      if (!data.data || !data.data.has_more || activities.length === 0) break;
    }
    const seen = new Set();
    return all.filter((activity) => {
      const key = `${activity.type}:${activity.courseware_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function cacheKey(coursewareId) {
    return `${APP}:detlist:${classroomId}:${coursewareId}`;
  }

  async function readCache(key) {
    try {
      const raw = typeof GM_getValue === "function" ? await GM_getValue(key) : null;
      if (!raw) return null;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (parsed && parsed.ts && Date.now() - parsed.ts < METADATA_CACHE_TTL_MS) return parsed.data;
    } catch (error) {
      /* 忽略缓存错误 */
    }
    return null;
  }

  async function writeCache(key, data) {
    try {
      if (typeof GM_setValue === "function") {
        await GM_setValue(key, JSON.stringify({ ts: Date.now(), data }));
      }
    } catch (error) {
      /* 忽略缓存错误 */
    }
  }

  async function fetchDetlist(coursewareId) {
    const key = cacheKey(coursewareId);
    const cached = await readCache(key);
    if (cached) return cached;
    const data = await fetchJson(`/v2/api/web/cards/detlist/${coursewareId}?classroom_id=${classroomId}`);
    if (data.errcode !== 0) throw new Error(data.errmsg || "课件详情接口失败");
    const result = data.data || {};
    if (result.Slides && result.Slides.length) await writeCache(key, result);
    return result;
  }

  async function fetchVideoInfo(leafId) {
    const data = await fetchJson(`/mooc-api/v1/lms/learn/leaf_info/${classroomId}/${leafId}/?classroom_id=${classroomId}`);
    if (!data.success) throw new Error(data.msg || "leaf_info 失败（登录态可能失效）");
    const media = (data.data && data.data.content_info && data.data.content_info.media) || {};
    return { ccid: media.ccid, name: media.name, size: media.size };
  }

  async function fetchVideoUrls(ccid) {
    const data = await fetchJson(
      `/api/open/audiovideo/playurl?video_id=${encodeURIComponent(ccid)}&provider=cc&file_type=1&is_single=0&domain=changjiang.yuketang.cn`
    );
    if (!data.success) throw new Error(data.msg || "playurl 失败");
    const sources = (data.data && data.data.playurl && data.data.playurl.sources) || {};
    const ordered = [];
    for (const quality of VIDEO_QUALITY_ORDER) {
      const list = sources[quality];
      if (Array.isArray(list)) ordered.push(...list.filter(Boolean));
    }
    return { primary: ordered[0] || null, ordered, sources };
  }

  // 课程元信息（uv_id / course_sign），章节接口要用
  async function fetchClassroomMeta() {
    const data = await fetchJson(`/v2/api/web/classrooms/${classroomId}?role=5`);
    const info = data.data || {};
    return {
      uvId: info.uv_id ? String(info.uv_id) : "",
      courseSign: info.course_sign || "",
      courseName: info.course_name || info.name || "",
    };
  }

  // 「学习内容」章节树里的全部学习单元。leaf_type：0=视频 6=作业 7=课件 8=课堂
  async function fetchChapterLeaves(onProgress) {
    const meta = await fetchClassroomMeta();
    const uv = meta.uvId || "3721";
    const signPart = meta.courseSign ? `&sign=${encodeURIComponent(meta.courseSign)}` : "";
    const data = await fetchJson(
      `/mooc-api/v1/lms/learn/course/chapter?cid=${classroomId}${signPart}&term=latest&uv_id=${uv}&classroom_id=${classroomId}`
    );
    const chapters = (data.data && data.data.course_chapter) || [];
    const leaves = [];
    const walk = (nodes, chapterName) => {
      for (const node of nodes || []) {
        const currentChapter = chapterName || (node.name || "").trim();
        if (node.section_leaf_list) {
          walk(node.section_leaf_list, currentChapter);
        } else if (node.leaf_type !== undefined) {
          leaves.push(Object.assign({}, node, { name: (node.name || "").trim(), chapter: currentChapter }));
        }
      }
    };
    walk(chapters, "");
    if (typeof onProgress === "function") {
      onProgress({ stage: "读取学习内容", current: leaves.length, total: leaves.length, detail: `章节 ${chapters.length} 个，学习单元 ${leaves.length} 个` });
    }
    return { meta, leaves };
  }

  /* 课堂（日志里 type 14 的「课堂」条目）：每节课自带一套上课时投出来的课件。
     lesson_id 就是 activity.courseware_id；课件靠 presentationId 取，
     接口和课程里上传的课件（/v2/api/web/cards/detlist）完全不同。 */
  async function fetchClassLessonInfo(lessonId) {
    const data = await fetchJson(`/api/v3/classroom-report/student/lesson-info?lesson_id=${lessonId}`);
    if (data.code !== 0) throw new Error(data.msg || "课堂信息接口失败");
    return data.data || {};
  }

  async function fetchClassSlides(lessonId) {
    const info = await fetchClassLessonInfo(lessonId);
    const presentationIds = info.presentationIds || [];
    if (!presentationIds.length) return { info, presentationId: "", slides: [] };
    const data = await fetchJson(
      `/api/v3/classroom-report/student/ppt?lesson_id=${lessonId}&presentationId=${presentationIds[0]}`
    );
    if (data.code !== 0) throw new Error(data.msg || "课堂课件接口失败");
    const slides = ((data.data && data.data.slideList) || [])
      .map((slide) => ({ index: slide.index, cover: slide.cover }))
      .filter((slide) => !!slide.cover);
    return { info, presentationId: presentationIds[0], slides };
  }

  // 同一节课在回放接口里还带一条音频轨（mp3，OSS 签名 URL）；录屏要老师开回放才有
  async function fetchClassReplay(lessonId) {
    const data = await fetchJson(`/api/v3/classroom-report/replay?lesson_id=${lessonId}&canFakeLive=1`);
    if (data.code !== 0) throw new Error(data.msg || "课堂回放接口失败");
    const info = data.data || {};
    const live = (info.live || []).find((item) => item && item.url) || null;
    return {
      audioUrl: live ? live.url : "",
      durationMs: info.lessonDuration || (live && live.duration) || 0,
      showPlayback: info.showPlayback,
    };
  }

  // 课堂课件每页是签名 JPEG（changjiang-private-qn），同样要 credentials:"omit"
  async function collectClassSlides(lesson, reporter) {
    const { slides } = await fetchClassSlides(lesson.id);
    if (!slides.length) throw new Error("这节课没有可抓取的课件");
    const results = [];
    let done = 0;
    const queue = slides.slice();
    const workers = Array.from({ length: Math.min(SLIDE_CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const slide = queue.shift();
        try {
          const buffer = await fetchBinary(slide.cover);
          const size = jpegSize(buffer) || { width: 1280, height: 960 };
          results.push({ pageIndex: slide.index, buffer, width: size.width, height: size.height });
        } catch (error) {
          console.warn(`[${APP}] 课堂第 ${slide.index} 页失败`, error);
        }
        done += 1;
        if (typeof reporter === "function") {
          reporter({ stage: "下载课堂课件", current: done, total: slides.length, detail: `第 ${slide.index} 页` });
        }
      }
    });
    await Promise.all(workers);
    results.sort((a, b) => a.pageIndex - b.pageIndex);
    if (!results.length) throw new Error("课堂课件全部下载失败");
    const first = results[0];
    return { pages: results, meta: { Width: first.width, Height: first.height } };
  }

  /* ------------------------------------------------------------------ */
  /* UI：面板 / 进度 / 提示（复用参考项目写法）                           */
  /* ------------------------------------------------------------------ */

  function getDoc() {
    return document;
  }

  function createProgressPanel(doc, title) {
    const old = doc.getElementById(`${APP}-progress`);
    if (old) old.remove();

    const panel = doc.createElement("div");
    panel.id = `${APP}-progress`;
    panel.className = "cjyk-progress";
    panel.innerHTML = `
      <div class="cjyk-progress-head">
        <div class="cjyk-progress-title">${escapeHtml(title)}</div>
        <button type="button" class="cjyk-progress-close" aria-label="隐藏进度">×</button>
      </div>
      <div class="cjyk-progress-status">
        <span data-role="stage">准备</span>
        <span data-role="count">0%</span>
      </div>
      <div class="cjyk-progress-track"><div class="cjyk-progress-bar" data-role="bar"></div></div>
      <div class="cjyk-progress-detail" data-role="detail"></div>
    `;
    doc.body.appendChild(panel);

    const stageNode = panel.querySelector("[data-role='stage']");
    const countNode = panel.querySelector("[data-role='count']");
    const barNode = panel.querySelector("[data-role='bar']");
    const detailNode = panel.querySelector("[data-role='detail']");
    panel.querySelector(".cjyk-progress-close").addEventListener("click", () => panel.remove());

    return {
      update(state) {
        const total = Math.max(Number(state.total) || 0, 0);
        const current = Math.max(Number(state.current) || 0, 0);
        const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
        stageNode.textContent = state.stage || "处理中";
        countNode.textContent = total > 0 ? `${current}/${total}` : `${percent}%`;
        barNode.style.width = `${percent}%`;
        detailNode.textContent = state.detail || "";
      },
      close(delay = 0) {
        setTimeout(() => panel.remove(), delay);
      },
    };
  }

  function createProgressReporter(button, panel) {
    let lastToastAt = 0;
    return (state) => {
      const normalized = typeof state === "string"
        ? { stage: state, current: 0, total: 0, detail: "" }
        : state;
      const label = normalized.total
        ? `${normalized.stage} ${normalized.current}/${normalized.total}`
        : normalized.stage;
      if (button) button.textContent = normalized.stage || "处理中";
      if (panel) panel.update(normalized);
      const now = Date.now();
      if (now - lastToastAt > 6000) {
        lastToastAt = now;
        showToast(getDoc(), label, "info", 1600);
      }
    };
  }

  function setButtonBusy(button, text) {
    if (!button) return () => {};
    const oldText = button.textContent;
    const oldDisabled = button.disabled;
    button.disabled = true;
    button.classList.add("cjyk-busy");
    button.textContent = text;
    return () => {
      button.disabled = oldDisabled;
      button.classList.remove("cjyk-busy");
      button.textContent = oldText;
    };
  }

  function showToast(doc, message, type = "info", timeout = 3200) {
    const ownerDoc = doc || document;
    let wrap = ownerDoc.getElementById(`${APP}-toast-wrap`);
    if (!wrap) {
      wrap = ownerDoc.createElement("div");
      wrap.id = `${APP}-toast-wrap`;
      wrap.className = "cjyk-toast-wrap";
      ownerDoc.body.appendChild(wrap);
    }
    const toast = ownerDoc.createElement("div");
    toast.className = `cjyk-toast cjyk-toast-${type}`;
    toast.textContent = message;
    wrap.appendChild(toast);
    setTimeout(() => toast.remove(), timeout);
  }

  function createButton(doc, text, className) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = `cjyk-btn ${className || ""}`.trim();
    button.textContent = text;
    return button;
  }

  /* ------------------------------------------------------------------ */
  /* 页面注入                                                            */
  /* ------------------------------------------------------------------ */

  function addStylesOnce(doc) {
    if (injectedDocs.has(doc)) return;
    injectedDocs.add(doc);
    if (typeof GM_addStyle === "function") {
      GM_addStyle(styleText);
    } else {
      const style = doc.createElement("style");
      style.textContent = styleText;
      doc.head.appendChild(style);
    }
  }

  function injectToolbar(doc) {
    if (doc.querySelector(`.cjyk-toolbar[data-version="${STYLE_VERSION}"]`)) return;
    const anchor =
      doc.querySelector("#coursetree") ||
      doc.querySelector(".studentLog__body") ||
      doc.querySelector(".viewContainer") ||
      doc.body;

    const toolbar = doc.createElement("div");
    toolbar.className = "cjyk-toolbar";
    toolbar.dataset.version = STYLE_VERSION;
    toolbar.innerHTML = `<span class="cjyk-toolbar-title">雨课堂课件抓取</span>`;

    const scanButton = createButton(doc, "扫描课程", "");
    scanButton.addEventListener("click", () => handleScan(doc, scanButton));
    toolbar.appendChild(scanButton);

    const batchButton = createButton(doc, "批量下载", "");
    batchButton.addEventListener("click", () => openDownloadDialog(doc));
    toolbar.appendChild(batchButton);


    if (anchor === doc.body) {
      toolbar.style.position = "fixed";
      toolbar.style.right = "18px";
      toolbar.style.bottom = "18px";
      toolbar.style.zIndex = "2147482000";
      toolbar.style.background = "#fff";
      toolbar.style.padding = "6px 10px";
      toolbar.style.borderRadius = "8px";
      toolbar.style.boxShadow = "0 4px 18px rgba(0,0,0,.2)";
    } else {
      anchor.insertBefore(toolbar, anchor.firstChild);
    }
  }

  // 从 Vue 实例里取该卡片对应的活动数据（比按标题匹配可靠，且能区分 PPT/视频/作业）
  function activityDataFor(box) {
    const host = box.querySelector(".activity__wrap") || box;
    let vm = host.__vue__;
    let guard = 0;
    while (vm && guard < 8) {
      const data = vm.$props && vm.$props.tableData;
      if (data && data.courseware_id) return data;
      vm = vm.$parent;
      guard += 1;
    }
    return null;
  }

  // 在每条课件/视频卡片右侧挂按钮（对应参考项目 ensureActionButton）
  function mountActionButtons(doc) {
    const boxes = Array.from(doc.querySelectorAll(".activity-box"));
    for (const box of boxes) {
      if (box.querySelector(".cjyk-actions")) continue;
      const activity = activityDataFor(box);
      if (!activity || (activity.type !== 2 && activity.type !== 17 && activity.type !== 14)) continue;
      if (!activity.courseware_id) continue;

      const host = box.querySelector(".activity__wrap") || box;
      const holder = doc.createElement("span");
      holder.className = "cjyk-actions cjyk-actions-inline";
      holder.dataset.cjykFor = String(activity.courseware_id);
      holder.dataset.cjykType = String(activity.type);

      if (activity.type === 14) {
        // 课堂：上课时投的那套课件（老师另讲的课也在这里）
        const pdfButton = createButton(doc, "课件PDF", "cjyk-btn-small");
        pdfButton.addEventListener("click", (event) => {
          event.stopPropagation();
          handleClassPpt(doc, activity, "pdf", pdfButton);
        });
        const zipButton = createButton(doc, "课件ZIP", "cjyk-btn-small cjyk-btn-secondary");
        zipButton.addEventListener("click", (event) => {
          event.stopPropagation();
          handleClassPpt(doc, activity, "zip", zipButton);
        });
        const pptxButton = createButton(doc, "课件PPTX", "cjyk-btn-small cjyk-btn-secondary");
        pptxButton.addEventListener("click", (event) => {
          event.stopPropagation();
          handleClassPpt(doc, activity, "pptx", pptxButton);
        });
        const audioButton = createButton(doc, "录音", "cjyk-btn-small cjyk-btn-secondary");
        audioButton.title = "下载这节课的录音（mp3，不是录屏）";
        audioButton.addEventListener("click", (event) => {
          event.stopPropagation();
          handleClassAudio(doc, activity, audioButton);
        });
        holder.append(pdfButton, zipButton, pptxButton, audioButton);
      } else if (activity.type === 2) {
        const pdfButton = createButton(doc, "PDF", "cjyk-btn-small");
        pdfButton.addEventListener("click", (event) => {
          event.stopPropagation();
          handlePpt(doc, activity, "pdf", pdfButton);
        });
        const zipButton = createButton(doc, "图片ZIP", "cjyk-btn-small cjyk-btn-secondary");
        zipButton.addEventListener("click", (event) => {
          event.stopPropagation();
          handlePpt(doc, activity, "zip", zipButton);
        });
        const pptxButton = createButton(doc, "PPTX", "cjyk-btn-small cjyk-btn-secondary");
        pptxButton.addEventListener("click", (event) => {
          event.stopPropagation();
          handlePpt(doc, activity, "pptx", pptxButton);
        });
        holder.append(pdfButton, zipButton, pptxButton);
      } else {
        const videoButton = createButton(doc, "视频", "cjyk-btn-small");
        videoButton.addEventListener("click", (event) => {
          event.stopPropagation();
          handleVideo(doc, activity, videoButton);
        });
        const linkButton = createButton(doc, "直链", "cjyk-btn-small cjyk-btn-secondary");
        linkButton.addEventListener("click", (event) => {
          event.stopPropagation();
          copyVideoLink(doc, activity);
        });
        holder.append(videoButton, linkButton);
      }

      // 阻止冒泡，避免触发卡片自身的跳转
      holder.addEventListener("click", (event) => event.stopPropagation());
      holder.addEventListener("mousedown", (event) => event.stopPropagation());
      host.appendChild(holder);
    }
  }

  function observeDocument(doc) {
    if (observedDocs.has(doc)) return;
    observedDocs.add(doc);
    const observer = new MutationObserver((records) => {
      const relevant = records.some((record) =>
        Array.from(record.addedNodes || []).some(
          (node) => node.nodeType === 1 && !node.closest(OWN_SELECTOR) && node.matches && node.matches(UI_REFRESH_SELECTOR)
        )
      );
      if (relevant) scheduleMount();
    });
    observer.observe(doc.body, { childList: true, subtree: true });
  }

  let mountTimer = null;
  function scheduleMount() {
    clearTimeout(mountTimer);
    mountTimer = setTimeout(() => {
      mountActionButtons(getDoc());
    }, 200);
  }

  /* ------------------------------------------------------------------ */
  /* 业务状态                                                            */
  /* ------------------------------------------------------------------ */

  const state = {
    activities: [],
    chapterLeaves: null,
    chapterMeta: null,
    busy: false,
  };

  function pptActivities() {
    return state.activities.filter((activity) => activity.type === 2);
  }

  function videoActivities() {
    return state.activities.filter((activity) => activity.type === 17 && activity.content && activity.content.leaf_id);
  }

  function classActivities() {
    return state.activities.filter((activity) => activity.type === 14 && activity.courseware_id);
  }

  async function ensureChapterLeaves(reporter) {
    if (state.chapterLeaves) return state.chapterLeaves;
    if (!classroomId) throw new Error("未识别到 classroom_id");
    const result = await fetchChapterLeaves(reporter);
    state.chapterMeta = result.meta;
    state.chapterLeaves = result.leaves;
    return state.chapterLeaves;
  }

  // 章节树里的视频单元（覆盖学习日志里看不到的那些）
  function chapterVideoLeaves() {
    return (state.chapterLeaves || [])
      .filter((leaf) => leaf.leaf_type === 0 && leaf.id)
      .map((leaf) => ({ title: leaf.name, leafId: leaf.id, chapter: leaf.chapter }));
  }

  async function ensureActivities(doc, reporter) {
    if (state.activities.length) return state.activities;
    if (!classroomId) throw new Error("未识别到 classroom_id");
    state.activities = await fetchActivities(reporter);
    return state.activities;
  }

  /* ------------------------------------------------------------------ */
  /* PPT                                                                 */
  /* ------------------------------------------------------------------ */

  async function collectSlides(activity, reporter) {
    const detail = await fetchDetlist(activity.courseware_id);
    const slides = (detail.Slides || []).filter((slide) => slide.Cover);
    if (!slides.length) throw new Error("该课件没有可抓取的幻灯片");

    const results = [];
    let done = 0;
    const queue = slides.slice();

    const workers = Array.from({ length: Math.min(SLIDE_CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const slide = queue.shift();
        const pageIndex = slide.PageIndex || slide.index + 1;
        try {
          const buffer = await fetchBinary(slide.Cover);
          const size = jpegSize(buffer) || { width: 960, height: 720 };
          results.push({ pageIndex, buffer, width: size.width, height: size.height });
        } catch (error) {
          console.warn(`[${APP}] 第 ${pageIndex} 页失败`, error);
        }
        done += 1;
        if (typeof reporter === "function") {
          reporter({ stage: "下载幻灯片", current: done, total: slides.length, detail: `第 ${pageIndex} 页` });
        }
      }
    });
    await Promise.all(workers);
    results.sort((a, b) => a.pageIndex - b.pageIndex);
    if (!results.length) throw new Error("所有幻灯片都下载失败");
    return { pages: results, meta: detail };
  }

  const MODE_LABEL = { pdf: "PDF", zip: "ZIP", pptx: "PPTX" };

  // 把已下载的幻灯片图按目标格式组装成 Blob（三种格式共用）
  async function buildPptOutput(activity, pages, meta, mode, reporter) {
    const title = sanitizeFileName(activity.title);
    if (mode === "pdf") {
      if (reporter) reporter({ stage: "生成 PDF", current: pages.length, total: pages.length, detail: `${pages.length} 页` });
      await yieldToBrowser();
      return {
        blob: buildPdfFromJpegs(
          pages.map((page) => ({ jpeg: page.buffer, width: page.width, height: page.height })),
          meta.Width,
          meta.Height
        ),
        filename: `${title}.pdf`,
      };
    }
    if (mode === "pptx") {
      if (reporter) reporter({ stage: "生成 PPTX", current: 0, total: pages.length, detail: `${pages.length} 页` });
      await yieldToBrowser();
      const entries = buildPptxFromJpegs(
        pages.map((page) => ({ jpeg: page.buffer, width: page.width, height: page.height })),
        meta.Width,
        meta.Height,
        activity.title
      );
      const zipBlob = await createStoredZipBlob(entries, (current, total, detail) => {
        if (reporter) reporter({ stage: "打包 PPTX", current, total, detail });
      });
      // 关键：GM_download 按 Blob 的 MIME 决定扩展名，这里必须换成 pptx 的官方类型，
      // 否则文件会被存成 .zip（内容对、扩展名错，双击打不开）。
      const blob = new Blob([zipBlob], {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });
      return { blob, filename: `${title}.pptx` };
    }
    if (reporter) reporter({ stage: "打包 ZIP", current: 0, total: pages.length, detail: "" });
    const blob = await createStoredZipBlob(
      pages.map((page) => ({
        path: `${String(page.pageIndex).padStart(3, "0")}.jpg`,
        data: new Uint8Array(page.buffer),
      })),
      (current, total, detail) => {
        if (reporter) reporter({ stage: "打包 ZIP", current, total, detail });
      }
    );
    return { blob, filename: `${title}.zip` };
  }

  async function handlePpt(doc, activity, mode, button) {
    if (state.busy) {
      showToast(doc, "已有任务在进行中", "error");
      return;
    }
    state.busy = true;
    const restore = setButtonBusy(button, "处理中");
    const panel = createProgressPanel(doc, `${activity.title} ${MODE_LABEL[mode] || "PDF"}`);
    const reporter = createProgressReporter(button, panel);
    try {
      reporter({ stage: "读取课件详情", current: 0, total: 0, detail: activity.title });
      const { pages, meta } = await collectSlides(activity, reporter);
      const { blob, filename } = await buildPptOutput(activity, pages, meta, mode, reporter);
      triggerBlobDownload(doc, blob, filename);
      reporter({ stage: "已下载", current: pages.length, total: pages.length, detail: `${filename} ${formatBytes(blob.size)}` });
      showToast(doc, `已下载 ${filename}（${formatBytes(blob.size)}）`, "success", 4000);
      panel.close(6000);
    } catch (error) {
      reporter({ stage: "失败", current: 0, total: 0, detail: error.message });
      showToast(doc, `失败：${error.message}`, "error", 5000);
    } finally {
      state.busy = false;
      restore();
    }
  }

  // 单节课的课堂课件（上课时投的那套，含老师没上传到课程里的）
  async function handleClassPpt(doc, activity, mode, button) {
    if (state.busy) {
      showToast(doc, "已有任务在进行中", "error");
      return;
    }
    state.busy = true;
    const restore = setButtonBusy(button, "处理中");
    const title = (activity.title || "").trim() || "课堂课件";
    const panel = createProgressPanel(doc, `${title} ${MODE_LABEL[mode] || "PDF"}`);
    const reporter = createProgressReporter(button, panel);
    try {
      reporter({ stage: "读取课堂课件", current: 0, total: 0, detail: title });
      const { pages, meta } = await collectClassSlides({ id: String(activity.courseware_id) }, reporter);
      const { blob, filename } = await buildPptOutput({ title }, pages, meta, mode, reporter);
      triggerBlobDownload(doc, blob, filename);
      reporter({ stage: "已下载", current: pages.length, total: pages.length, detail: `${filename} ${formatBytes(blob.size)}` });
      showToast(doc, `已下载 ${filename}（${formatBytes(blob.size)}）`, "success", 4000);
      panel.close(6000);
    } catch (error) {
      reporter({ stage: "失败", current: 0, total: 0, detail: error.message });
      showToast(doc, `失败：${error.message}`, "error", 5000);
    } finally {
      state.busy = false;
      restore();
    }
  }

  // 单节课的课堂录音（回放数据里的音频轨，mp3）
  async function handleClassAudio(doc, activity, button) {
    if (state.busy) {
      showToast(doc, "已有任务在进行中", "error");
      return;
    }
    state.busy = true;
    const restore = setButtonBusy(button, "处理中");
    const title = (activity.title || "").trim() || "课堂录音";
    const panel = createProgressPanel(doc, `${title} 录音`);
    const reporter = createProgressReporter(button, panel);
    try {
      reporter({ stage: "读取课堂录音", current: 0, total: 0, detail: title });
      const { audioUrl, durationMs } = await fetchClassReplay(String(activity.courseware_id));
      if (!audioUrl) throw new Error("这节课没有录音");
      const minutes = durationMs ? Math.round(durationMs / 60000) : 0;
      const filename = `${sanitizeFileName(title)}_录音.mp3`;
      reporter({
        stage: "下载录音",
        current: 0,
        total: 0,
        detail: `${filename}${minutes ? ` · 约 ${minutes} 分钟` : ""}`,
      });
      await downloadVideoFile(audioUrl, filename, 0, (progress) => {
        if (!progress) return;
        reporter({
          stage: "下载录音",
          current: progress.loaded,
          total: progress.total,
          detail: `${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`,
        });
      });
      reporter({ stage: "已下载", current: 1, total: 1, detail: filename });
      showToast(doc, `已下载 ${filename}${minutes ? `（约 ${minutes} 分钟）` : ""}`, "success", 4000);
      panel.close(6000);
    } catch (error) {
      reporter({ stage: "失败", current: 0, total: 0, detail: error.message });
      showToast(doc, `失败：${error.message}`, "error", 5000);
    } finally {
      state.busy = false;
      restore();
    }
  }

  // 课程名（页面标题里的第一段），用来给批量压缩包起名
  function currentCourseTitle() {
    const nodes = Array.from(document.querySelectorAll(".classroom-ellipsis .title-inner-wrapper"));
    const text = nodes.map((node) => (node.textContent || "").trim()).find(Boolean);
    return text || `classroom_${classroomId || ""}`;
  }

  function timestampForName() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  }

  /* ------------------------------------------------------------------ */
  /* 视频                                                                */
  /* ------------------------------------------------------------------ */

  async function resolveVideoUrls(activity) {
    const leafId = activity.content && activity.content.leaf_id;
    if (!leafId) throw new Error("缺少 leaf_id");
    const info = await fetchVideoInfo(leafId);
    if (!info.ccid) throw new Error("未取到视频 ID");
    const urls = await fetchVideoUrls(info.ccid);
    return { info, urls };
  }

  async function handleVideo(doc, activity, button) {
    if (state.busy) {
      showToast(doc, "已有任务在进行中", "error");
      return;
    }
    state.busy = true;
    const restore = setButtonBusy(button, "解析中");
    const panel = createProgressPanel(doc, `${activity.title} 视频`);
    const reporter = createProgressReporter(button, panel);
    try {
      reporter({ stage: "解析视频直链", current: 0, total: 0, detail: "" });
      const { info, urls } = await resolveVideoUrls(activity);
      if (!urls.primary) throw new Error("没有可用清晰度");
      const filename = `${sanitizeFileName(info.name || activity.title)}.mp4`;
      reporter({ stage: "开始下载", current: 0, total: 0, detail: `${filename}（${formatBytes(info.size)}）` });
      await downloadVideoFile(urls.primary, filename, info.size, (progress) => {
        reporter({
          stage: "下载视频",
          current: progress.loaded || 0,
          total: progress.total || 0,
          detail: `${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`,
        });
      });
      showToast(doc, "视频下载已交给浏览器下载栏", "success", 4000);
      panel.close(5000);
    } catch (error) {
      reporter({ stage: "失败", current: 0, total: 0, detail: error.message });
      showToast(doc, `失败：${error.message}`, "error", 5000);
    } finally {
      state.busy = false;
      restore();
    }
  }

  // navigator.clipboard 在页面失焦 / 无激活时会抛 NotAllowedError，
  // 这里按「现代 API → execCommand → 弹窗让用户自己复制」三级降级。
  async function copyTextToClipboard(doc, text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return "clipboard";
      }
    } catch (error) {
      // 落到下面的降级路径
    }
    const area = doc.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:-1000px;left:-1000px;opacity:0";
    doc.body.appendChild(area);
    area.select();
    let copied = false;
    try {
      copied = doc.execCommand("copy");
    } catch (error) {
      copied = false;
    }
    area.remove();
    if (copied) return "execCommand";
    console.log(`[${APP}] 直链（剪贴板不可用，手动复制）：\n${text}`);
    try {
      window.prompt("剪贴板不可用，请手动复制直链：", text);
    } catch (error) {
      showToast(doc, "直链已打印到控制台", "info", 6000);
    }
    return "prompt";
  }

  async function copyVideoLink(doc, activity) {
    try {
      const { urls } = await resolveVideoUrls(activity);
      const text = [activity.title, urls.primary || "", ...urls.ordered.slice(1, 3)].filter(Boolean).join("\n");
      const how = await copyTextToClipboard(doc, text);
      if (how !== "prompt") showToast(doc, "直链已复制到剪贴板", "success");
    } catch (error) {
      showToast(doc, `取直链失败：${error.message}`, "error", 5000);
    }
  }

  async function handleVideoList(doc, button) {
    if (state.busy) {
      showToast(doc, "已有任务在进行中", "error");
      return;
    }
    const restore = setButtonBusy(button, "准备中");
    const panel = createProgressPanel(doc, "视频直链清单");
    const reporter = createProgressReporter(button, panel);
    try {
      let list = [];
      try {
        const leaves = await ensureChapterLeaves(reporter);
        list = leaves
          .filter((leaf) => leaf.leaf_type === 0 && leaf.id)
          .map((leaf) => ({ title: leaf.name, leafId: leaf.id }));
      } catch (error) {
        console.warn(`[${APP}] 章节树读取失败，退回学习日志`, error);
      }
      if (!list.length) {
        await ensureActivities(doc, reporter);
        list = videoActivities().map((activity) => ({
          title: activity.title,
          leafId: activity.content && activity.content.leaf_id,
        }));
      }
      if (!list.length) {
        showToast(doc, "本课没有可解析的视频", "error");
        return;
      }
      const lines = [
        `# 长江雨课堂 视频直链清单`,
        `# classroom_id=${classroomId}  生成时间=${new Date().toLocaleString()}`,
        `# 直链带签名，过期需重新导出；可用 aria2c/curl 下载`,
        "",
      ];
      for (let index = 0; index < list.length; index += 1) {
        const item = list[index];
        reporter({ stage: `(${index + 1}/${list.length}) ${item.title}`, current: index, total: list.length, detail: "" });
        try {
          const info = await fetchVideoInfo(item.leafId);
          if (!info.ccid) throw new Error("未取到视频 ID");
          const urls = await fetchVideoUrls(info.ccid);
          lines.push(`## ${item.title}`, `leaf_id=${item.leafId}`, `ccid=${info.ccid}`, `size=${info.size || ""}`);
          urls.ordered.forEach((url, order) => lines.push(`url${order + 1}=${url}`));
          lines.push("");
        } catch (error) {
          lines.push(`## ${item.title}`, `# 失败：${error.message}`, "");
        }
      }
      const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
      triggerBlobDownload(doc, blob, `视频直链_${classroomId}_${timestampName()}.txt`);
      showToast(doc, "直链清单已导出", "success");
      panel.close(4000);
    } catch (error) {
      reporter({ stage: "失败", current: 0, total: 0, detail: error.message });
      showToast(doc, `失败：${error.message}`, "error", 5000);
    } finally {
      state.busy = false;
      restore();
    }
  }

  /* ------------------------------------------------------------------ */
  /* 扫描                                                                */
  /* ------------------------------------------------------------------ */

  async function handleScan(doc, button) {
    if (state.busy) {
      showToast(doc, "已有任务在进行中", "error");
      return;
    }
    const restore = setButtonBusy(button, "扫描中");
    const panel = createProgressPanel(doc, "扫描课程");
    const reporter = createProgressReporter(button, panel);
    try {
      state.activities = [];
      await ensureActivities(doc, reporter);
      mountActionButtons(doc);
      const pptCount = pptActivities().length;
      const logVideoCount = videoActivities().length;
      let chapterNote = "";
      let chapterVideoCount = 0;
      try {
        const leaves = await ensureChapterLeaves(reporter);
        const countOf = (type) => leaves.filter((leaf) => leaf.leaf_type === type).length;
        chapterVideoCount = countOf(0);
        chapterNote = `；学习内容里视频 ${countOf(0)}、课件 ${countOf(7)}、课堂 ${countOf(8)}、作业 ${countOf(6)}`;
      } catch (error) {
        console.warn(`[${APP}] 章节树读取失败`, error);
      }
      const videoTotal = Math.max(chapterVideoCount, logVideoCount);
      const extra = chapterVideoCount > logVideoCount ? `（日志 ${logVideoCount} + 学习内容 ${chapterVideoCount - logVideoCount}）` : "";
      reporter({
        stage: "扫描完成",
        current: state.activities.length,
        total: state.activities.length,
        detail: `PPT ${pptCount} 个，视频 ${videoTotal} 个${extra}${chapterNote}`,
      });
      showToast(doc, `扫描完成：PPT ${pptCount} 个，视频 ${videoTotal} 个${extra}`, "success", 5000);
      panel.close(5000);
    } catch (error) {
      reporter({ stage: "失败", current: 0, total: 0, detail: error.message });
      showToast(doc, `扫描失败：${error.message}`, "error", 5000);
    } finally {
      restore();
    }
  }

  /* ------------------------------------------------------------------ */
  /* 学习空间视频页（/ai-workspace/lms-graph/{cid}/video/{leaf}）         */
  /* ------------------------------------------------------------------ */

  function setupVideoPage(doc) {
    const match = location.pathname.match(/\/lms-graph\/(\d+)\/video\/(\d+)/);
    if (!match) return;
    classroomId = match[1];
    const leafId = match[2];

    const bar = doc.createElement("div");
    bar.className = "cjyk-toolbar";
    bar.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147482000;background:#fff;padding:6px 10px;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.2);margin:0";
    bar.innerHTML = `<span class="cjyk-toolbar-title">本视频</span>`;
    const button = createButton(doc, "下载 MP4", "");
    button.addEventListener("click", async () => {
      const restore = setButtonBusy(button, "解析中");
      try {
        const info = await fetchVideoInfo(leafId);
        if (!info.ccid) throw new Error("未取到视频 ID");
        const urls = await fetchVideoUrls(info.ccid);
        if (!urls.primary) throw new Error("没有可用直链");
        const filename = `${sanitizeFileName(info.name || `视频_${leafId}`)}.mp4`;
        showToast(doc, `开始下载 ${filename}（${formatBytes(info.size)}）`, "info", 4000);
        await downloadVideoFile(urls.primary, filename, info.size);
      } catch (error) {
        showToast(doc, `失败：${error.message}`, "error", 5000);
      } finally {
        restore();
      }
    });
    bar.appendChild(button);
    doc.body.appendChild(bar);
  }

  /* ------------------------------------------------------------------ */
  /* 批量下载对话框                                                      */
  /* ------------------------------------------------------------------ */

  const PPT_FORMATS = [
    { id: "pdf", label: "PDF（体积小，阅读/打印）" },
    { id: "zip", label: "ZIP（逐页 JPG 图片）" },
    { id: "pptx", label: "PPTX（图片版，可放映/批注）" },
  ];

  // 用 HEAD 拿真实文件大小（CDN 带 ACAO:*，GM_xmlhttpRequest 不受跨域限制）
  function fetchHeadSize(url) {
    return new Promise((resolve) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        resolve(null);
        return;
      }
      try {
        GM_xmlhttpRequest({
          method: "HEAD",
          url,
          timeout: 15000,
          onload: (response) => {
            const match = /content-length:\s*(\d+)/i.exec(response.responseHeaders || "");
            resolve(match ? Number(match[1]) : null);
          },
          onerror: () => resolve(null),
          ontimeout: () => resolve(null),
        });
      } catch (error) {
        resolve(null);
      }
    });
  }

  // 视频真实大小：leaf_info 拿 ccid → playurl 拿直链 → HEAD 取 content-length
  async function resolveVideoSize(leafId) {
    try {
      const info = await fetchVideoInfo(leafId);
      let size = 0;
      if (info.ccid) {
        const urls = await fetchVideoUrls(info.ccid);
        if (urls.primary) size = (await fetchHeadSize(urls.primary)) || 0;
      }
      return { size: size || info.size || 0, approx: !size };
    } catch (error) {
      return { size: 0, approx: true };
    }
  }

  // 汇总「可下载的东西」：学习日志里的 PPT + 学习内容章节树里的 PPT 与视频
  // 章节树里的 PPT 只有 leaf id，真正下载要用的 courseware_id 在 leaf_info.content_info.leaf_type_id
  async function collectDownloadItems(reporter) {
    const ppts = [];
    const videos = [];
    const seenPpt = new Set();
    const titles = new Set();
    try {
      await ensureActivities(null, reporter);
      for (const activity of pptActivities()) {
        const id = String(activity.courseware_id);
        if (seenPpt.has(id)) continue;
        seenPpt.add(id);
        titles.add((activity.title || "").trim());
        ppts.push({
          kind: "ppt",
          id,
          title: activity.title,
          meta: activity.count ? `${activity.count} 页` : "PPT 课件",
        });
      }
    } catch (error) {
      console.warn(`[${APP}] 课程日志读取失败`, error);
    }
    try {
      const leaves = await ensureChapterLeaves(reporter);
      // 章节树里日志没列到的 PPT（学习内容独有的那些）
      const extraPptLeaves = leaves.filter(
        (leaf) => leaf.leaf_type === 7 && leaf.id && !titles.has((leaf.name || "").trim())
      );
      for (const leaf of extraPptLeaves) {
        try {
          const data = await fetchJson(`/mooc-api/v1/lms/learn/leaf_info/${classroomId}/${leaf.id}/?classroom_id=${classroomId}`);
          const content = (data.data && data.data.content_info) || {};
          const coursewareId = content.leaf_type_id ? String(content.leaf_type_id) : "";
          if (!coursewareId || seenPpt.has(coursewareId)) continue;
          seenPpt.add(coursewareId);
          ppts.push({
            kind: "ppt",
            id: coursewareId,
            title: leaf.name,
            meta: leaf.chapter || "PPT 课件",
          });
        } catch (error) {
          console.warn(`[${APP}] ${leaf.name} 读取失败`, error);
        }
      }
      for (const leaf of leaves) {
        if (leaf.leaf_type === 0 && leaf.id) {
          videos.push({ kind: "video", id: String(leaf.id), title: leaf.name, meta: leaf.chapter || "视频" });
        }
      }
    } catch (error) {
      console.warn(`[${APP}] 章节树读取失败`, error);
    }
    if (!videos.length) {
      for (const activity of videoActivities()) {
        videos.push({
          kind: "video",
          id: String(activity.content.leaf_id),
          title: activity.title,
          meta: "视频",
        });
      }
    }
    // 课堂（上课那节）：每一节自带一套课件，和课程里上传的课件是两套东西
    const classes = [];
    const audios = [];
    for (const activity of classActivities()) {
      const title = (activity.title || "").trim() || "课堂";
      const id = String(activity.courseware_id);
      classes.push({ kind: "classppt", id, title, meta: "课堂课件" });
      audios.push({ kind: "audio", id, title, meta: "课堂录音" });
    }
    return { ppts, videos, classes, audios };
  }

  function closeDialog(backdrop) {
    if (backdrop && backdrop.parentNode) backdrop.remove();
    delete document.documentElement.dataset.cjykDialog;
  }

  let dialogOpening = false;

  async function openDownloadDialog(doc) {
    if (state.busy) {
      showToast(doc, "已有任务在进行中", "error");
      return;
    }
    // 同一个页面可能注入了多份脚本实例，点一次会触发多次；这里做单例保护
    // （锁挂在 document 上，跨实例共享；只用模块变量在多次注入时会各算各的）
    if (dialogOpening || doc.documentElement.dataset.cjykDialog === "1") return;
    if (doc.querySelector(".cjyk-dl-backdrop")) return;
    dialogOpening = true;
    doc.documentElement.dataset.cjykDialog = "1";
    showToast(doc, "正在读取课程内容…", "info", 2000);
    let items;
    try {
      items = await collectDownloadItems(null);
    } catch (error) {
      dialogOpening = false;
      delete doc.documentElement.dataset.cjykDialog;
      showToast(doc, `读取失败：${error.message}`, "error", 5000);
      return;
    }
    if (!items.ppts.length && !items.videos.length && !items.classes.length && !items.audios.length) {
      dialogOpening = false;
      delete doc.documentElement.dataset.cjykDialog;
      showToast(doc, "本课没有可下载的内容", "error");
      return;
    }
    Array.from(doc.querySelectorAll(".cjyk-dl-backdrop")).forEach((node) => node.remove());

    const sectionHtml = (title, list, checkedByDefault) => list.length
      ? `<div class="cjyk-dl-section">
          <div class="cjyk-dl-section-head">${escapeHtml(title)}（${list.length}）</div>
          ${list.map((item) => `
            <label class="cjyk-dl-row">
              <input type="checkbox" data-kind="${item.kind}" data-id="${escapeHtml(item.id)}" data-title="${escapeHtml(item.title)}"${checkedByDefault ? " checked" : ""}>
              <span class="cjyk-dl-name" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
              <span class="cjyk-dl-meta">${escapeHtml(item.meta)}</span>
            </label>`).join("")}
        </div>`
      : "";

    const backdrop = doc.createElement("div");
    backdrop.className = "cjyk-modal-backdrop cjyk-dl-backdrop";
    backdrop.innerHTML = `
      <div class="cjyk-modal cjyk-dl-modal" role="dialog" aria-modal="true">
        <button type="button" class="cjyk-modal-close" aria-label="关闭">×</button>
        <h3 class="cjyk-modal-title">批量下载 · ${escapeHtml(currentCourseTitle())}</h3>
        <div class="cjyk-dl-toolbar">
          <label><input type="checkbox" data-role="all"> 全选</label>
          <label title="全部 PPT 课件"><input type="checkbox" data-role="all-ppt"> PPT</label>
          <label title="全部视频"><input type="checkbox" data-role="all-video"> 视频</label>
          <label title="全部课堂课件"><input type="checkbox" data-role="all-class"> 课堂</label>
          <label title="全部课堂录音"><input type="checkbox" data-role="all-audio"> 录音</label>
          <label class="cjyk-dl-format">PPT 格式
            <select data-role="format">${PPT_FORMATS.map((item) => `<option value="${item.id}">${item.label}</option>`).join("")}</select>
          </label>
        </div>
        <div class="cjyk-dl-list">
          ${sectionHtml("PPT 课件", items.ppts, true)}
          ${sectionHtml("视频", items.videos, true)}
          ${sectionHtml("课堂课件（可能与PPT课件重复，默认不勾选）", items.classes, false)}
          ${sectionHtml("课堂录音（音频，默认不勾选）", items.audios, false)}
        </div>
        <div class="cjyk-dl-foot">
          <span class="cjyk-dl-summary" data-role="summary">未选择</span>
          <div class="cjyk-dl-actions">
            <button type="button" class="cjyk-btn cjyk-btn-secondary" data-role="links">导出直链</button>
            <button type="button" class="cjyk-btn" data-role="start" disabled>开始下载</button>
          </div>
        </div>
      </div>`;
    doc.body.appendChild(backdrop);

    const boxes = () => Array.from(backdrop.querySelectorAll('input[type="checkbox"][data-id]'));
    const boxesOf = (kind) => boxes().filter((box) => box.dataset.kind === kind);
    const allBox = backdrop.querySelector('[data-role="all"]');
    const allPptBox = backdrop.querySelector('[data-role="all-ppt"]');
    const allVideoBox = backdrop.querySelector('[data-role="all-video"]');
    const allClassBox = backdrop.querySelector('[data-role="all-class"]');
    const allAudioBox = backdrop.querySelector('[data-role="all-audio"]');
    const formatSelect = backdrop.querySelector('[data-role="format"]');
    const summary = backdrop.querySelector('[data-role="summary"]');
    const startButton = backdrop.querySelector('[data-role="start"]');

    const videoSizes = new Map();
    const sync = () => {
      const selected = boxes().filter((box) => box.checked);
      const pptSelected = selected.filter((box) => box.dataset.kind === "ppt").length;
      const classSelected = selected.filter((box) => box.dataset.kind === "classppt").length;
      const audioSelected = selected.filter((box) => box.dataset.kind === "audio").length;
      const videoSelected = selected.length - pptSelected - classSelected - audioSelected;
      const videoBytes = selected
        .filter((box) => box.dataset.kind === "video")
        .reduce((sum, box) => sum + (videoSizes.get(box.dataset.id) || 0), 0);
      const sizeText = videoBytes ? ` · 视频合计 ${formatBytes(videoBytes)}` : "";
      const classText = classSelected ? ` · 课堂课件 ${classSelected}` : "";
      const audioText = audioSelected ? ` · 课堂录音 ${audioSelected}` : "";
      summary.textContent = selected.length
        ? `已选 ${selected.length} 项（PPT ${pptSelected} · 视频 ${videoSelected}${classText}${audioText}）${sizeText}`
        : "未选择";
      startButton.disabled = selected.length === 0;
      const pptBoxes = boxesOf("ppt");
      const videoBoxes = boxesOf("video");
      allPptBox.checked = pptBoxes.length > 0 && pptBoxes.every((box) => box.checked);
      allPptBox.indeterminate = !allPptBox.checked && pptBoxes.some((box) => box.checked);
      allVideoBox.checked = videoBoxes.length > 0 && videoBoxes.every((box) => box.checked);
      allVideoBox.indeterminate = !allVideoBox.checked && videoBoxes.some((box) => box.checked);
      const classBoxes = boxesOf("classppt");
      if (allClassBox) {
        allClassBox.checked = classBoxes.length > 0 && classBoxes.every((box) => box.checked);
        allClassBox.indeterminate = !allClassBox.checked && classBoxes.some((box) => box.checked);
      }
      const audioBoxes = boxesOf("audio");
      if (allAudioBox) {
        allAudioBox.checked = audioBoxes.length > 0 && audioBoxes.every((box) => box.checked);
        allAudioBox.indeterminate = !allAudioBox.checked && audioBoxes.some((box) => box.checked);
      }
      allBox.checked = boxes().length > 0 && boxes().every((box) => box.checked);
      allBox.indeterminate = !allBox.checked && boxes().some((box) => box.checked);
    };

    boxes().forEach((box) => box.addEventListener("change", sync));
    allBox.addEventListener("change", () => {
      boxes().forEach((box) => { box.checked = allBox.checked; });
      sync();
    });
    allPptBox.addEventListener("change", () => {
      boxesOf("ppt").forEach((box) => { box.checked = allPptBox.checked; });
      sync();
    });
    allVideoBox.addEventListener("change", () => {
      boxesOf("video").forEach((box) => { box.checked = allVideoBox.checked; });
      sync();
    });
    if (allClassBox) {
      allClassBox.addEventListener("change", () => {
        boxesOf("classppt").forEach((box) => { box.checked = allClassBox.checked; });
        sync();
      });
    }
    if (allAudioBox) {
      allAudioBox.addEventListener("change", () => {
        boxesOf("audio").forEach((box) => { box.checked = allAudioBox.checked; });
        sync();
      });
    }
    backdrop.querySelector(".cjyk-modal-close").addEventListener("click", () => closeDialog(backdrop));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeDialog(backdrop);
    });
    backdrop.querySelector('[data-role="links"]').addEventListener("click", async (event) => {
      closeDialog(backdrop);
      await handleVideoList(doc, event.currentTarget);
    });
    startButton.addEventListener("click", async () => {
      const chosen = boxes().filter((box) => box.checked).map((box) => ({
        kind: box.dataset.kind,
        id: box.dataset.id,
        title: box.dataset.title || box.dataset.id,
      }));
      const mode = formatSelect.value;
      closeDialog(backdrop);
      await runDownloadPlan(doc, chosen, mode);
    });

    sync();
    dialogOpening = false;
    delete doc.documentElement.dataset.cjykDialog;

    // 后台把每个视频的真实大小补到行尾（并发 3 个，不阻塞弹窗出现）
    const pending = boxesOf("video").slice();
    Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (pending.length) {
        const box = pending.shift();
        const row = box.closest(".cjyk-dl-row");
        const metaNode = row && row.querySelector(".cjyk-dl-meta");
        const base = metaNode ? metaNode.textContent : "";
        const { size, approx } = await resolveVideoSize(box.dataset.id);
        if (!size) continue;
        videoSizes.set(box.dataset.id, size);
        if (metaNode) metaNode.textContent = `${approx ? "≈" : ""}${formatBytes(size)} · ${base}`;
        sync();
      }
    });

    // 课堂录音：每节课补「XX 分钟」，没有音频的直接禁用
    const pendingAudio = boxesOf("audio").slice();
    Array.from({ length: Math.min(2, pendingAudio.length) }, async () => {
      while (pendingAudio.length) {
        const box = pendingAudio.shift();
        const row = box.closest(".cjyk-dl-row");
        const metaNode = row && row.querySelector(".cjyk-dl-meta");
        try {
          const { audioUrl, durationMs } = await fetchClassReplay(box.dataset.id);
          if (!audioUrl) {
            if (metaNode) metaNode.textContent = "无录音";
            box.disabled = true;
            box.checked = false;
          } else if (metaNode) {
            const minutes = durationMs ? Math.round(durationMs / 60000) : 0;
            metaNode.textContent = minutes ? `${minutes} 分钟` : "录音";
          }
          sync();
        } catch (error) {
          if (metaNode) metaNode.textContent = "读取失败";
        }
      }
    });

    // 课堂课件：把每节课的页数补到行尾（没有课件的显示「无课件」）
    const pendingClass = boxesOf("classppt").slice();
    Array.from({ length: Math.min(2, pendingClass.length) }, async () => {
      while (pendingClass.length) {
        const box = pendingClass.shift();
        const row = box.closest(".cjyk-dl-row");
        const metaNode = row && row.querySelector(".cjyk-dl-meta");
        try {
          const { slides } = await fetchClassSlides(box.dataset.id);
          if (metaNode) metaNode.textContent = slides.length ? `${slides.length} 页` : "无课件";
          if (!slides.length) {
            box.disabled = true;
            box.checked = false;
            sync();
          }
        } catch (error) {
          if (metaNode) metaNode.textContent = "读取失败";
        }
      }
    });
  }

  // 按对话框里勾选的结果执行：PPT 先全部生成再打一个包，视频逐个下载
  async function runDownloadPlan(doc, chosen, pptMode) {
    if (!chosen.length) return;
    state.busy = true;
    const panel = createProgressPanel(doc, "批量下载");
    const reporter = createProgressReporter(null, panel);
    const used = new Set();
    const ppts = chosen.filter((item) => item.kind === "ppt");
    const classes = chosen.filter((item) => item.kind === "classppt");
    const videos = chosen.filter((item) => item.kind === "video");
    const audios = chosen.filter((item) => item.kind === "audio");
    const pickedPpts = pptActivities().filter((activity) => ppts.some((item) => item.id === String(activity.courseware_id)));
    // 学习日志的课件和「课堂」自带课件走两套接口，这里合并成一个作业队列
    const deckJobs = [
      ...pickedPpts.map((activity) => ({ kind: "ppt", title: activity.title, activity })),
      ...classes.map((item) => ({ kind: "classppt", title: `${item.title}（课堂）`, lesson: { id: item.id } })),
    ];
    let doneVideos = 0;
    try {
      if (deckJobs.length) {
        const entries = [];
        let ok = 0;
        for (let index = 0; index < deckJobs.length; index += 1) {
          const job = deckJobs[index];
          const safeTitle = sanitizeFileName(job.title) || `课件${index + 1}`;
          const stage = `${job.kind === "classppt" ? "课堂" : "PPT"} ${index + 1}/${deckJobs.length}：${job.title}`;
          reporter({ stage, current: index, total: deckJobs.length, detail: "" });
          try {
            const collector = job.kind === "classppt"
              ? (helper) => collectClassSlides(job.lesson, helper)
              : (helper) => collectSlides(job.activity, helper);
            const { pages, meta } = await collector((progress) => {
              reporter({ stage, current: progress.current, total: progress.total, detail: progress.detail });
            });
            if (pptMode === "zip") {
              for (const page of pages) {
                entries.push({
                  path: `${safeTitle}/${String(page.pageIndex).padStart(3, "0")}.jpg`,
                  data: new Uint8Array(page.buffer),
                });
              }
            } else {
              const { blob } = await buildPptOutput(job, pages, meta, pptMode, null);
              entries.push({
                path: `${safeTitle}.${pptMode === "pptx" ? "pptx" : "pdf"}`,
                data: new Uint8Array(await blob.arrayBuffer()),
              });
            }
            ok += 1;
          } catch (error) {
            console.warn(`[${APP}] ${job.title} 生成失败`, error);
          }
        }

        if (entries.length === 1 && pptMode !== "zip") {
          const only = entries[0];
          const mime = pptMode === "pptx"
            ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            : "application/pdf";
          triggerBlobDownload(doc, new Blob([only.data], { type: mime }), only.path.split("/").pop());
        } else if (entries.length) {
          const label = pptMode === "zip" ? "图片ZIP" : pptMode.toUpperCase();
          reporter({ stage: "打包 PPT", current: 0, total: entries.length, detail: `${entries.length} 个文件` });
          const zipBlob = await createStoredZipBlob(entries, (current, total, detail) => {
            reporter({ stage: "打包 PPT", current, total, detail });
          });
          const filename = makeUniqueFileName(
            `${sanitizeFileName(currentCourseTitle())}_PPT_${label}_${timestampForName()}.zip`,
            used
          );
          triggerBlobDownload(doc, zipBlob, filename);
        }
        if (ok) showToast(doc, `课件已处理 ${ok}/${deckJobs.length} 个`, "success", 4000);
      }

      for (let index = 0; index < videos.length; index += 1) {
        const item = videos[index];
        const stage = `视频 ${index + 1}/${videos.length}：${item.title}`;
        reporter({ stage, current: index, total: videos.length, detail: "解析直链" });
        try {
          const info = await fetchVideoInfo(item.id);
          if (!info.ccid) throw new Error("未取到视频 ID");
          const urls = await fetchVideoUrls(info.ccid);
          if (!urls.primary) throw new Error("没有可用直链");
          const filename = makeUniqueFileName(`${sanitizeFileName(info.name || item.title)}.mp4`, used);
          reporter({ stage, current: index, total: videos.length, detail: `${filename} · ${formatBytes(info.size)}` });
          await downloadVideoFile(urls.primary, filename, info.size, (progress) => {
            reporter({
              stage,
              current: index,
              total: videos.length,
              detail: `${formatBytes(progress && progress.loaded)} / ${formatBytes((progress && progress.total) || info.size)}`,
            });
          });
          doneVideos += 1;
        } catch (error) {
          reporter({ stage, current: index + 1, total: videos.length, detail: `失败：${error.message}` });
        }
        await sleep(400);
      }

      let doneAudios = 0;
      for (let index = 0; index < audios.length; index += 1) {
        const item = audios[index];
        const stage = `课堂录音 ${index + 1}/${audios.length}：${item.title}`;
        reporter({ stage, current: index, total: audios.length, detail: "解析音频直链" });
        try {
          const { audioUrl, durationMs } = await fetchClassReplay(item.id);
          if (!audioUrl) throw new Error("这节课没有录音");
          const filename = makeUniqueFileName(`${sanitizeFileName(item.title)}_录音.mp3`, used);
          const minutes = durationMs ? Math.round(durationMs / 60000) : 0;
          reporter({ stage, current: index, total: audios.length, detail: `${filename}${minutes ? ` · ${minutes} 分钟` : ""}` });
          await downloadVideoFile(audioUrl, filename, 0, null);
          doneAudios += 1;
        } catch (error) {
          reporter({ stage, current: index + 1, total: audios.length, detail: `失败：${error.message}` });
        }
        await sleep(400);
      }

      reporter({
        stage: "完成",
        current: chosen.length,
        total: chosen.length,
        detail: `课件 ${deckJobs.length} 个（含课堂 ${classes.length}）· 视频 ${doneVideos}/${videos.length} · 录音 ${doneAudios}/${audios.length}`,
      });
      showToast(doc, `批量下载结束：视频 ${doneVideos}/${videos.length}，录音 ${doneAudios}/${audios.length}`, "success", 6000);
      panel.close(7000);
    } catch (error) {
      reporter({ stage: "失败", current: 0, total: 0, detail: error.message });
      showToast(doc, `失败：${error.message}`, "error", 5000);
    } finally {
      state.busy = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* 入口                                                                */
  /* ------------------------------------------------------------------ */

  function initDocument(doc) {
    if (doc !== document) return;
    // 学习内容页常常是学习日志里嵌的 iframe，顶层已经有工具栏，这里不再重复挂
    if (/\/pro\/lms\/[^/]+\/\d+\/studycontent/.test(location.pathname) && window.top !== window.self) return;
    addStylesOnce(doc);

    if (/\/lms-graph\/\d+\/video\//.test(location.pathname)) {
      setupVideoPage(doc);
      return;
    }

    classroomId = detectClassroomId();
    if (!classroomId) return;

    injectToolbar(doc);
    observeDocument(doc);

    // 页面列表懒加载：滚动/切换标签后补挂按钮
    window.addEventListener("scroll", scheduleMount, { passive: true });
    setInterval(() => {
      mountActionButtons(doc);
    }, 3000);

    console.log(`[${APP}] v${VERSION} 已加载 classroom_id=${classroomId}`);
  }

  function main() {
    try {
      initDocument(document);
    } catch (error) {
      console.error(`[${APP}] 初始化失败`, error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
