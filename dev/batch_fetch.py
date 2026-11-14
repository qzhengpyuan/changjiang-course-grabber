#!/usr/bin/env python3
"""用影子浏览器跑脚本的「全课 PPT→PDF」，落到指定目录。

用法: python3 batch_fetch.py "<下载目录>"
"""
import asyncio, os, sys
from cdp import CDP, page_target

import os
CID = os.environ.get("CJYK_CID", "00000000")  # 运行前设置：export CJYK_CID=<classroom_id>
SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "changjiang-courseware-grabber.user.js")
SHIM = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_e2e.py"), encoding="utf-8").read().split('SHIM = r"""')[1].split('"""')[0]
OUT = sys.argv[1]

async def main():
    os.makedirs(OUT, exist_ok=True)
    t = page_target("studentLog") or page_target()
    async with CDP(t["webSocketDebuggerUrl"]) as c:
        await c.send("Browser.setDownloadBehavior", {"behavior": "allow", "downloadPath": OUT})
        await c.send("Page.navigate", {"url": f"https://changjiang.yuketang.cn/v2/web/studentLog/{CID}"})
        await asyncio.sleep(7)
        await c.evaluate(SHIM)
        await c.evaluate(open(SCRIPT, encoding="utf-8").read() + "\n;'ok'")
        await asyncio.sleep(3)
        r = await c.evaluate("""(() => {
          const b=[...document.querySelectorAll('.cjyk-toolbar .cjyk-btn')].find(x=>x.textContent.includes('全课 PPT→PDF'));
          if(!b) return 'no-btn'; b.click(); return 'clicked';
        })()""")
        print("batch:", r, flush=True)
        for i in range(180):
            await asyncio.sleep(5)
            files = sorted(f for f in os.listdir(OUT) if f.endswith('.pdf'))
            partial = [f for f in os.listdir(OUT) if f.endswith('.crdownload')]
            prog = await c.evaluate("(document.querySelector('.cjyk-progress')||{}).innerText||''")
            print(i, len(files), "pdf |", (prog or "").replace("\n", " ")[:140], flush=True)
            if len(files) >= 6 and not partial:
                await asyncio.sleep(5)
                break
        print("FILES:", [(f, os.path.getsize(os.path.join(OUT, f))) for f in sorted(os.listdir(OUT))])
asyncio.run(main())
