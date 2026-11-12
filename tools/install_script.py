import asyncio, json, sys, urllib.request
from cdp import CDP
import os
CID = os.environ.get("CJYK_CID", "00000000")  # 运行前设置：export CJYK_CID=<classroom_id>
PORT = int(sys.argv[1]) if len(sys.argv)>1 else 9224
URL = sys.argv[2] if len(sys.argv)>2 else "http://127.0.0.1:8899/changjiang-courseware-grabber.user.js"
def targets():
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list"))
async def m():
    pg=[t for t in targets() if t["type"]=="page"][0]
    async with CDP(pg["webSocketDebuggerUrl"]) as c:
        await c.send("Page.enable",{})
        await c.send("Page.navigate",{"url":URL})
        await asyncio.sleep(4)
        r=await c.evaluate("""(() => {
          const btns=[...document.querySelectorAll('button')].filter(e=>['安装','更新','重新安装'].includes(e.textContent.trim()));
          if(!btns.length) return {ok:false, txt:document.body.innerText.slice(0,150)};
          btns[btns.length-1].click(); return {ok:true, label:btns[btns.length-1].textContent.trim()};
        })()""")
        print("install:", r)
        await asyncio.sleep(3)
        await c.send("Page.navigate",{"url": f"https://changjiang.yuketang.cn/v2/web/studentLog/{CID}"})
        await asyncio.sleep(7)
        v=await c.evaluate("({url:location.href, toolbar:!!document.querySelector('.cjyk-toolbar')})")
        print(json.dumps(v,ensure_ascii=False))
asyncio.run(m())
