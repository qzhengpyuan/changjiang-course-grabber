#!/usr/bin/env python3
"""测试视频下载按钮：滚动找到目标卡片，点「视频」，等文件落地。"""
import asyncio, os, sys
from cdp import CDP, page_target

import os
CID = os.environ.get("CJYK_CID", "00000000")  # 运行前设置：export CJYK_CID=<classroom_id>
SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "changjiang-courseware-grabber.user.js")
SHIM = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_e2e.py"), encoding="utf-8").read().split('SHIM = r"""')[1].split('"""')[0]
DL = "/tmp/cjyk-dl"
FRAG = sys.argv[1] if len(sys.argv) > 1 else "示例课件"

async def main():
    os.makedirs(DL, exist_ok=True)
    for f in os.listdir(DL):
        try: os.remove(os.path.join(DL, f))
        except OSError: pass
    t = page_target("studentLog") or page_target()
    async with CDP(t["webSocketDebuggerUrl"]) as c:
        await c.send("Browser.setDownloadBehavior", {"behavior": "allow", "downloadPath": DL})
        await c.send("Page.navigate", {"url": f"https://changjiang.yuketang.cn/v2/web/studentLog/{CID}"})
        await asyncio.sleep(7)
        await c.evaluate(SHIM)
        await c.evaluate(open(SCRIPT, encoding="utf-8").read() + "\n;'ok'")
        await asyncio.sleep(3)
        r = "not-found"
        for _ in range(15):
            r = await c.evaluate("""(() => {
              const frag = %s;
              const box = [...document.querySelectorAll('.activity-box')].find(b => b.innerText.includes(frag));
              if (!box) return 'box-not-found';
              const b = [...box.querySelectorAll('.cjyk-btn')].find(x => x.textContent.trim() === '视频');
              if (!b) return 'btn-not-found';
              b.click(); return 'clicked';
            })()""" % repr(FRAG).replace("'", '"'))
            if r == "clicked":
                break
            await c.evaluate("window.scrollBy(0, 1200)")
            await asyncio.sleep(2)
        print("click:", r, flush=True)
        for i in range(60):
            await asyncio.sleep(3)
            files = [(f, os.path.getsize(os.path.join(DL, f))) for f in os.listdir(DL)]
            prog = await c.evaluate("(document.querySelector('.cjyk-progress')||{}).innerText||''")
            if files and not any(f.endswith('.crdownload') for f, _ in files):
                print(i, files, "|", (prog or "").replace("\n", " ")[:150], flush=True)
                break
            if i % 5 == 0:
                print(i, files, "|", (prog or "").replace("\n", " ")[:150], flush=True)
asyncio.run(main())
