#!/usr/bin/env python3
"""在 :99 影子 Vivaldi（装了脚本猫）里点脚本按钮，观察进度面板与落盘文件。

适配 2.9 之后的界面：工具栏只有 扫描课程 / 批量下载 / 下载设置，
具体格式与录音都在批量弹窗里选。

用法：
  python3 ui_test.py scan                        # 扫描课程
  python3 ui_test.py rows                        # 打开批量弹窗，列出所有条目
  python3 ui_test.py selftest                    # 下载设置 → 接口自检
  python3 ui_test.py batch pdf [标题1,标题2]      # 批量导出（标题留空=全选该类）
  python3 ui_test.py batch zip
  python3 ui_test.py batch pptx
  python3 ui_test.py dialogvideo 标题子串         # 在弹窗里只勾这个视频并下载
  python3 ui_test.py dialogaudio 标题子串         # 在弹窗里只勾这节录音并下载
  python3 ui_test.py card <标题子串> <kind>       # 点卡片按钮
       kind: download | pdf | zip | pptx | classpdf | classzip | classpptx | audio | audiolink | video | link
  python3 ui_test.py exportlinks                 # 弹窗里点「导出直链」

环境变量：CJYK_PORT（默认 9224）、CJYK_DL（默认 ~/Downloads）。
"""
import asyncio
import json
import os
import sys
import urllib.request

from cdp import CDP

PORT = int(os.environ.get("CJYK_PORT", "9224"))
DL = os.environ.get("CJYK_DL", os.path.expanduser("~/Downloads"))

PANEL_JS = """(() => {
  const p = document.querySelector('.cjyk-progress');
  return p ? p.innerText.replace(/\\n+/g, ' | ').slice(-200) : null;
})()"""

OPEN_DIALOG_JS = """(async () => {
  const btn = [...document.querySelectorAll('.cjyk-toolbar button')].find(b => b.textContent.includes('批量下载'));
  if (!btn) return 'no-btn';
  btn.click();
  await new Promise(r => setTimeout(r, 3200));
  const modals = [...document.querySelectorAll('.cjyk-dl-modal')];
  return modals.length ? 'ok' : 'no-modal';
})()"""

ROWS_JS = """(() => {
  const modals = [...document.querySelectorAll('.cjyk-dl-modal')];
  const m = modals[modals.length - 1];
  if (!m) return 'no-modal';
  const rows = [...m.querySelectorAll('.cjyk-dl-row')].map(row => {
    const cb = row.querySelector('input[type=checkbox]');
    return {
      kind: cb && cb.dataset.kind,
      title: cb && cb.dataset.title,
      checked: !!(cb && cb.checked),
      disabled: !!(cb && cb.disabled),
      text: (row.innerText || '').replace(/\\n+/g, ' ').slice(0, 100)
    };
  });
  const by = {};
  rows.forEach(r => { by[r.kind] = (by[r.kind] || 0) + 1; });
  const foot = m.querySelector('.cjyk-dl-foot');
  return { total: rows.length, by, foot: foot ? foot.innerText.replace(/\\n+/g, ' | ') : '' };
})()"""

CARD_JS = """((title, label) => {
  const holders = [...document.querySelectorAll('.cjyk-actions')];
  const hit = holders.find(h => {
    const box = h.closest('.activity-box');
    return box && (box.innerText || '').includes(title);
  });
  if (!hit) return 'no-card';
  const btn = [...hit.querySelectorAll('button')].find(b => b.textContent.trim() === label);
  if (!btn) return 'no-btn:' + [...hit.querySelectorAll('button')].map(b => b.textContent.trim()).join('|');
  btn.click();
  return 'ok';
})(%TITLE%, %LABEL%)"""

SET_FORMAT_JS = """((format) => {
  const modals = [...document.querySelectorAll('.cjyk-dl-modal')];
  const m = modals[modals.length - 1];
  if (!m) return 'no-modal';
  const sel = m.querySelector('select[data-role=format]');
  if (!sel) return 'no-format-select';
  sel.value = format;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return 'format:' + sel.value;
})(%FORMAT%)"""

SELECT_JS = """((kind, title, mode) => {
  const modals = [...document.querySelectorAll('.cjyk-dl-modal')];
  const m = modals[modals.length - 1];
  if (!m) return 'no-modal';
  const want = (row) => {
    const cb = row.querySelector('input[type=checkbox]');
    if (!cb) return false;
    if (kind && cb.dataset.kind !== kind) return false;
    if (title && !(cb.dataset.title || '').includes(title)) return false;
    return true;
  };
  let n = 0;
  for (const row of m.querySelectorAll('.cjyk-dl-row')) {
    const cb = row.querySelector('input[type=checkbox]');
    const target = want(row) && !cb.disabled;
    if (cb.checked !== target) cb.click();
    if (target) n += 1;
  }
  if (!n) return 'nothing-selected';
  if (mode === 'export') {
    const ex = [...m.querySelectorAll('button')].find(b => /导出直链/.test(b.textContent));
    if (!ex) return 'no-export-btn';
    ex.click();
    return 'exported:' + n;
  }
  const start = [...m.querySelectorAll('button')].find(b => /开始下载/.test(b.textContent));
  if (!start) return 'no-start-btn';
  start.click();
  return 'started:' + n;
})(%KIND%, %TITLE%, %MODE%)"""


def page():
    ts = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list"))
    pages = [t for t in ts if t["type"] == "page" and "changjiang" in t["url"]]
    if not pages:
        raise SystemExit(f"没有找到雨课堂页面（端口 {PORT}）")
    return pages[0]


def snap():
    try:
        return set(os.listdir(DL))
    except FileNotFoundError:
        return set()


def fmt(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f}{unit}" if unit != "B" else f"{n}B"
        n /= 1024


async def wait_panel(c, before, seconds=450, quiet=2):
    """等进度面板出现再消失；返回落盘的新文件。"""
    idle = 0
    last = None
    for i in range(seconds // 3):
        await asyncio.sleep(3)
        text = await c.evaluate(PANEL_JS)
        new = sorted(snap() - before)
        if text != last:
            print(f"{i * 3 + 3}s {text}")
            last = text
        if not text:
            idle += 1
            if idle >= quiet:
                break
        else:
            idle = 0
    return sorted(snap() - before)


async def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "scan"
    arg = sys.argv[2] if len(sys.argv) > 2 else ""
    arg2 = sys.argv[3] if len(sys.argv) > 3 else ""

    before = snap()
    print(f"before files: {len(before)}")
    pg = page()
    async with CDP(pg["webSocketDebuggerUrl"]) as c:
        if action == "scan":
            r = await c.evaluate("""(() => {
              const b = [...document.querySelectorAll('.cjyk-toolbar button')].find(e => e.textContent.includes('扫描课程'));
              if (!b) return 'no-btn'; b.click(); return 'ok';
            })()""")
            print("click:", r)
            if r == "ok":
                await wait_panel(c, before, seconds=120)
        elif action == "rows":
            r = await c.evaluate(OPEN_DIALOG_JS)
            print("open:", r)
            if r == "ok":
                print(json.dumps(await c.evaluate(ROWS_JS), ensure_ascii=False, indent=1))
        elif action == "selftest":
            r = await c.evaluate("""(async () => {
              const s = [...document.querySelectorAll('.cjyk-toolbar button')].find(e => e.textContent.includes('下载设置'));
              if (!s) return 'no-btn';
              s.click();
              await new Promise(r => setTimeout(r, 1200));
              const b = [...document.querySelectorAll('.cjyk-set-modal button')].find(x => /接口自检/.test(x.textContent));
              if (!b) return 'no-selfcheck';
              b.click();
              return 'ok';
            })()""")
            print("click:", r)
            if r == "ok":
                for _ in range(30):
                    await asyncio.sleep(2)
                    text = await c.evaluate("""(() => {
                      const m = document.querySelector('.cjyk-set-modal');
                      if (!m) return null;
                      const log = m.querySelector('[data-role=log]');
                      const t = (log || m).innerText || '';
                      if (/脚本版本/.test(t) && !/正在自检/.test(t)) return t.replace(/\\n+/g, ' | ');
                      return null;
                    })()""")
                    if text:
                        print(text)
                        break
        elif action == "card":
            label = {
                "download": "下载", "pdf": "PDF", "zip": "图片ZIP", "pptx": "PPTX",
                "classpdf": "课件PDF", "classzip": "课件ZIP", "classpptx": "课件PPTX",
                "audio": "录音", "audiolink": "录音直链", "video": "视频", "link": "直链",
            }.get(arg2 or "download", "下载")
            js = CARD_JS.replace("%TITLE%", json.dumps(arg)).replace("%LABEL%", json.dumps(label))
            r = await c.evaluate(js)
            print("click:", r)
            if r == "ok":
                await wait_panel(c, before)
        elif action.startswith("batch") or action in ("dialogvideo", "dialogaudio", "exportlinks"):
            open_r = await c.evaluate(OPEN_DIALOG_JS)
            print("open:", open_r)
            if open_r != "ok":
                return
            if action == "batch":
                mode = arg or "pdf"
                titles = [t for t in arg2.split(",") if t]
                kinds = {"pdf": ("ppt",), "zip": ("ppt",), "pptx": ("ppt",)}.get(mode, ("ppt",))
                fmt_res = await c.evaluate(SET_FORMAT_JS.replace("%FORMAT%", json.dumps(mode)))
                print("format:", fmt_res)
                r = await c.evaluate(
                    SELECT_JS.replace("%KIND%", json.dumps(kinds[0]))
                    .replace("%TITLE%", json.dumps(titles[0] if titles else ""))
                    .replace("%MODE%", json.dumps("download"))
                )
                # 多标题时逐个补勾
                if titles[1:]:
                    for title in titles[1:]:
                        await c.evaluate(
                            """((title) => {
                              const m = [...document.querySelectorAll('.cjyk-dl-modal')].pop();
                              for (const row of m.querySelectorAll('.cjyk-dl-row')) {
                                const cb = row.querySelector('input[type=checkbox]');
                                if (cb && !cb.disabled && (cb.dataset.title || '').includes(title) && !cb.checked) cb.click();
                              }
                              return 'ok';
                            })(%TITLE%)""".replace("%TITLE%", json.dumps(title))
                        )
                print("select:", r)
                if str(r).startswith("started"):
                    await wait_panel(c, before)
            elif action in ("dialogvideo", "dialogaudio"):
                kind = "video" if action == "dialogvideo" else "audio"
                r = await c.evaluate(
                    SELECT_JS.replace("%KIND%", json.dumps(kind))
                    .replace("%TITLE%", json.dumps(arg))
                    .replace("%MODE%", json.dumps("download"))
                )
                print("select:", r)
                if str(r).startswith("started"):
                    await wait_panel(c, before)
            else:
                r = await c.evaluate(
                    SELECT_JS.replace("%KIND%", "null")
                    .replace("%TITLE%", "null")
                    .replace("%MODE%", json.dumps("export"))
                )
                print("export:", r)
                await asyncio.sleep(3)
        else:
            raise SystemExit(f"未知动作：{action}")

    new = sorted(snap() - before)
    print(f"\nFINAL {len(new)} file(s):")
    for f in new:
        p = os.path.join(DL, f)
        print(f"  {f}  {fmt(os.path.getsize(p)) if os.path.exists(p) else '?'}")


asyncio.run(main())
