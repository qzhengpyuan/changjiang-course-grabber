#!/usr/bin/env python3
"""校验逐条按钮挂载：每个卡片对应的活动 type 与按钮类型是否一致。"""
import asyncio, json, os
from cdp import CDP, page_target
SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "changjiang-courseware-grabber.user.js")
SHIM = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_e2e.py"), encoding="utf-8").read().split('SHIM = r"""')[1].split('"""')[0]

async def main():
    t = page_target("studentLog")
    async with CDP(t["webSocketDebuggerUrl"]) as c:
        await c.send("Page.navigate", {"url": t["url"]})
        await asyncio.sleep(7)
        await c.evaluate(SHIM)
        await c.evaluate(open(SCRIPT, encoding="utf-8").read() + "\n;'ok'")
        await asyncio.sleep(3)
        v = await c.evaluate("""(() => {
          const out=[];
          for (const box of document.querySelectorAll('.activity-box')) {
            const host=box.querySelector('.activity__wrap')||box;
            let vm=host.__vue__, data=null, g=0;
            while(vm&&g<8){ const d=vm.$props&&vm.$props.tableData; if(d&&d.courseware_id){data=d;break;} vm=vm.$parent; g++; }
            const btns=[...box.querySelectorAll('.cjyk-btn')].map(x=>x.textContent);
            if (data && (data.type===2||data.type===17)) out.push({type:data.type, title:(data.title||'').slice(0,26), btns});
          }
          return out;
        })()""")
        for item in v:
            print(item["type"], "|", item["title"], "|", item["btns"])
        print("total:", len(v))
asyncio.run(main())
