import os
import asyncio, json, os, time, urllib.request, sys
from cdp import CDP
PORT=9224
def targets():
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list"))
pg=[t for t in targets() if "studentLog" in t["url"]][0]
DL = os.environ.get("CJYK_DL", os.path.expanduser("~/Downloads"))
def snap():
    return set(os.listdir(DL))
before=snap()
print("before:", len(before))

async def main():
    async with CDP(pg["webSocketDebuggerUrl"]) as c:
        # 捕获 console
        await c.evaluate("""(() => {
          if (window.__cjykLog) return 'already';
          window.__cjykLog=[];
          ['warn','error','log'].forEach(k=>{
            const o=console[k].bind(console);
            console[k]=(...a)=>{ try{window.__cjykLog.push(k+': '+a.map(x=>x&&x.message?x.message:String(x)).join(' ').slice(0,200));}catch(e){} return o(...a); };
          });
          return 'hooked';
        })()""")
        # 点「全课 PPT→PDF」
        r=await c.evaluate("""(() => {
          const b=[...document.querySelectorAll('.cjyk-toolbar button, .cjyk-toolbar a')].find(e=>e.textContent.includes('全课 PPT→PDF'));
          if(!b) return {ok:false, toolbar: !!document.querySelector('.cjyk-toolbar')};
          b.click(); return {ok:true};
        })()""")
        print("click:", r)
        for i in range(80):
            await asyncio.sleep(4)
            st=await c.evaluate("""(() => {
              const p=document.getElementById('cjyk-progress');
              const g=s=>p?p.querySelector(s):null;
              return {has:!!p, stage:g('[data-role=stage]')?.textContent, count:g('[data-role=count]')?.textContent,
                      detail:g('[data-role=detail]')?.textContent, logs:(window.__cjykLog||[]).slice(-3)};
            })()""")
            print(i, json.dumps(st, ensure_ascii=False)[:300])
            files=sorted(snap()-before)
            if i%5==0:
                print("   downloaded:", files)
            if not st.get("has") and i>3:
                print("panel gone"); break
    files=sorted(snap()-before)
    print("FINAL new files:", len(files))
    for f in files: print("  ", f, os.path.getsize(os.path.join(DL,f)))
asyncio.run(main())
