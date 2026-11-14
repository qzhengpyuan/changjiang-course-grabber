#!/usr/bin/env python3
"""在 :99 影子 Vivaldi（装了脚本猫）里点脚本按钮，观察进度面板与落盘文件。

用法：
  python3 ui_test.py scan                     # 扫描课程
  python3 ui_test.py batch_zip                # 全课 PPT→ZIP
  python3 ui_test.py batch_pdf                # 全课 PPT→PDF
  python3 ui_test.py card <标题子串> pdf|zip   # 单个课件的逐条按钮
  python3 ui_test.py videolist                # 视频直链清单
  python3 ui_test.py video <标题子串>          # 下载单个视频 MP4
"""
import asyncio
import json
import os
import sys
import urllib.request

from cdp import CDP

PORT = int(os.environ.get("CJYK_PORT", "9224"))
DL = os.environ.get("CJYK_DL", os.path.expanduser("~/Downloads"))


def page():
    ts = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list"))
    return [t for t in ts if t["type"] == "page" and "changjiang" in t["url"]][0]


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


CLICK_JS = {
    "scan": "(()=>{const b=[...document.querySelectorAll('.cjyk-toolbar button')].find(e=>e.textContent.includes('扫描课程'));if(!b)return 'no-btn';b.click();return 'ok';})()",
    "batch_zip": "(()=>{const b=[...document.querySelectorAll('.cjyk-toolbar button')].find(e=>e.textContent.includes('全课 PPT→ZIP'));if(!b)return 'no-btn';b.click();return 'ok';})()",
    "batch_pdf": "(()=>{const b=[...document.querySelectorAll('.cjyk-toolbar button')].find(e=>e.textContent.includes('全课 PPT→PDF'));if(!b)return 'no-btn';b.click();return 'ok';})()",
    "videolist": "(()=>{const b=[...document.querySelectorAll('.cjyk-toolbar button')].find(e=>e.textContent.includes('视频直链'));if(!b)return 'no-btn';b.click();return 'ok';})()",
}

CARD_JS = """((title, mode) => {
  const boxes=[...document.querySelectorAll('.activity-box')]
    .filter(b=>(b.textContent||'').includes(title));
  if(!boxes.length) return 'no-card';
  for (const b of boxes) {
    const btn=[...b.querySelectorAll('.cjyk-actions button')].find(e=>e.textContent.trim()===mode);
    if (btn) { btn.click(); return 'ok'; }
  }
  const all=[...document.querySelectorAll('.cjyk-actions button')].map(e=>e.textContent.trim());
  return 'no-btn:' + [...new Set(all)].join('|');
})(%TITLE%, %MODE%)"""

VIDEO_JS = """((title) => {
  const boxes=[...document.querySelectorAll('.activity-box')]
    .filter(b=>(b.textContent||'').includes(%TITLE%));
  if(!boxes.length) return 'no-card';
  const btn=[...boxes[0].querySelectorAll('.cjyk-actions button')].find(e=>e.textContent.trim()==='视频');
  if(!btn) return 'no-btn';
  btn.click(); return 'ok';
})(%TITLE%)"""


async def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "scan"
    arg = sys.argv[2] if len(sys.argv) > 2 else ""
    mode = sys.argv[3] if len(sys.argv) > 3 else "pdf"

    if action == "card":
        label = {"pdf": "PDF", "zip": "图片ZIP", "pptx": "PPTX", "video": "视频", "link": "直链"}.get(mode, "PDF")
        js = CARD_JS.replace("%TITLE%", json.dumps(arg)).replace("%MODE%", json.dumps(label))
    elif action == "video":
        js = VIDEO_JS.replace("%TITLE%", json.dumps(arg))
    else:
        js = CLICK_JS[action]

    before = snap()
    print(f"before files: {len(before)}")
    pg = page()
    async with CDP(pg["webSocketDebuggerUrl"]) as c:
        r = await c.evaluate(js)
        print("click:", r)
        if r != "ok":
            return
        idle = 0
        for i in range(150):
            await asyncio.sleep(3)
            st = await c.evaluate("""(() => {
              const p=document.getElementById('cjyk-progress');
              const g=s=>p?p.querySelector(s):null;
              return {has:!!p, stage:g('[data-role=stage]')?.textContent,
                      count:g('[data-role=count]')?.textContent,
                      detail:g('[data-role=detail]')?.textContent};
            })()""")
            new = sorted(snap() - before)
            print(f"{i*3}s {json.dumps(st, ensure_ascii=False)[:200]}  new={new}")
            if not st.get("has"):
                idle += 1
                if idle >= 2:
                    break
            else:
                idle = 0
    new = sorted(snap() - before)
    print(f"\nFINAL {len(new)} file(s):")
    for f in new:
        p = os.path.join(DL, f)
        print(f"  {f}  {fmt(os.path.getsize(p)) if os.path.exists(p) else '?'}")


asyncio.run(main())
