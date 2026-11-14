#!/usr/bin/env python3
"""端到端测试 v2：注入用户脚本（带 GM_* shim），点工具栏「扫描课程」，
再点某条课件的「PDF」按钮，检查下载产物。

用法: python3 test_e2e.py [--ppt 标题片段] [--mode pdf|zip]
"""
import asyncio
import json
import os
import sys

from cdp import CDP, page_target

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                      "changjiang-courseware-grabber.user.js")
DL_DIR = "/tmp/cjyk-dl"

SHIM = r"""
(() => {
  if (window.__cjykShim) return 'already';
  window.__cjykShim = true;
  window.GM_getValue = (k) => { try { return localStorage.getItem('__shim:'+k); } catch(e){ return null; } };
  window.GM_setValue = (k,v) => { try { localStorage.setItem('__shim:'+k, v); } catch(e){} };
  window.GM_addStyle = (css) => {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); return s;
  };
  window.GM_xmlhttpRequest = (o) => {
    fetch(o.url, {credentials:'omit'})
      .then(async r => {
        if (!r.ok) throw new Error('HTTP '+r.status);
        const buf = o.responseType === 'arraybuffer' ? await r.arrayBuffer() : await r.text();
        o.onload && o.onload({status:r.status, response:buf});
      })
      .catch(e => o.onerror && o.onerror(e));
  };
  window.GM_download = (o) => {
    fetch(o.url, {credentials:'omit'}).then(async r => {
      if (!r.ok) throw new Error('HTTP '+r.status);
      const total = Number(r.headers.get('content-length')) || 0;
      const reader = r.body.getReader(); const chunks = []; let loaded = 0;
      while (true) { const {done, value} = await reader.read(); if (done) break; chunks.push(value); loaded += value.length; o.onprogress && o.onprogress({loaded, total}); }
      const blob = new Blob(chunks);
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = o.name;
      document.body.appendChild(a); a.click(); a.remove();
      o.onload && o.onload();
    }).catch(e => o.onerror && o.onerror({error:String(e)}));
  };
  return 'ok';
})()
"""


async def wait_download(timeout_s=240):
    deadline = timeout_s
    while deadline > 0:
        files = [f for f in os.listdir(DL_DIR) if not f.endswith(".crdownload")]
        partial = [f for f in os.listdir(DL_DIR) if f.endswith(".crdownload")]
        if files and not partial:
            await asyncio.sleep(2)
            return files
        await asyncio.sleep(2)
        deadline -= 2
    return []


async def main():
    frag = os.environ.get("CJYK_TITLE_FRAG", "示例课件")
    mode = "pdf"
    for i, a in enumerate(sys.argv):
        if a == "--ppt":
            frag = sys.argv[i + 1]
        if a == "--mode":
            mode = sys.argv[i + 1]

    os.makedirs(DL_DIR, exist_ok=True)
    for f in os.listdir(DL_DIR):
        os.remove(os.path.join(DL_DIR, f))

    t = page_target("studentLog")
    if not t:
        print("没有 studentLog 页面")
        return 1
    print("target:", t["url"][:100], flush=True)

    async with CDP(t["webSocketDebuggerUrl"]) as c:
        try:
            await c.send("Browser.setDownloadBehavior", {"behavior": "allow", "downloadPath": DL_DIR})
        except Exception as e:
            print("setDownloadBehavior:", e)
        await c.send("Page.navigate", {"url": t["url"]})
        for _ in range(40):
            await asyncio.sleep(0.5)
            if await c.evaluate("document.readyState === 'complete'"):
                break
        await asyncio.sleep(3)

        print("shim:", await c.evaluate(SHIM))
        src = open(SCRIPT, encoding="utf-8").read()
        print("inject:", await c.evaluate(src + "\n;'injected'"))
        await asyncio.sleep(2)

        print("toolbar:", await c.evaluate("!!document.querySelector('.cjyk-toolbar')"))
        clicked = await c.evaluate("""(() => {
          const b=[...document.querySelectorAll('.cjyk-toolbar .cjyk-btn')].find(x=>x.textContent.includes('扫描课程'));
          if(!b) return 'no-scan-btn';
          b.click(); return 'clicked';
        })()""")
        print("scan:", clicked)

        for _ in range(60):
            await asyncio.sleep(1)
            n = await c.evaluate("document.querySelectorAll('.cjyk-actions').length")
            if n:
                break
        print("action holders:", await c.evaluate("document.querySelectorAll('.cjyk-actions').length"))

        clicked = await c.evaluate("""(() => {
          const frag = %s;
          const boxes=[...document.querySelectorAll('.activity-box')];
          const box=boxes.find(b=>b.innerText.includes(frag));
          if(!box) return 'box-not-found';
          const b=[...box.querySelectorAll('.cjyk-btn')].find(x=>x.textContent.includes(%s));
          if(!b) return 'btn-not-found';
          b.click(); return 'clicked';
        })()""" % (json.dumps(frag), json.dumps("PDF" if mode == "pdf" else "图片ZIP")))
        print("item:", clicked)

        files = await wait_download(240)
        print("files:", [(f, os.path.getsize(os.path.join(DL_DIR, f))) for f in files])
        prog = await c.evaluate("(document.querySelector('.cjyk-progress')||{}).innerText || ''")
        print("progress:", (prog or "")[-300:])
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
