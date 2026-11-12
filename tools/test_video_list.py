#!/usr/bin/env python3
"""测试「视频直链清单」导出。"""
import asyncio, os, sys
from cdp import CDP, page_target

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "changjiang-courseware-grabber.user.js")
DL_DIR = "/tmp/cjyk-dl"
SHIM = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_e2e.py"), encoding="utf-8").read().split('SHIM = r"""')[1].split('"""')[0]

async def main():
    os.makedirs(DL_DIR, exist_ok=True)
    for f in os.listdir(DL_DIR): os.remove(os.path.join(DL_DIR, f))
    t = page_target("studentLog")
    async with CDP(t["webSocketDebuggerUrl"]) as c:
        await c.send("Browser.setDownloadBehavior", {"behavior": "allow", "downloadPath": DL_DIR})
        await c.send("Page.navigate", {"url": t["url"]})
        await asyncio.sleep(6)
        await c.evaluate(SHIM)
        await c.evaluate(open(SCRIPT, encoding="utf-8").read() + "\n;'ok'")
        await asyncio.sleep(2)
        await c.evaluate("""[...document.querySelectorAll('.cjyk-toolbar .cjyk-btn')].find(x=>x.textContent.includes('视频直链清单')).click()""")
        for _ in range(60):
            await asyncio.sleep(1)
            files = [f for f in os.listdir(DL_DIR) if f.endswith('.txt')]
            if files: break
        await asyncio.sleep(2)
        print("files:", os.listdir(DL_DIR))
        for f in os.listdir(DL_DIR):
            print("="*60); print(open(os.path.join(DL_DIR,f), encoding="utf-8").read()[:1500])
asyncio.run(main())
