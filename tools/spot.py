#!/usr/bin/env python3
"""抓包：点开某个活动，记录 XHR/fetch 的请求与响应体。

用法: python3 spot.py <标题片段> [等待秒数] [url]
"""
import asyncio
import json
import sys

import websockets

from cdp import page_target

CLICK_JS = """
(async () => {
  const frag = %s;
  const boxes = [...document.querySelectorAll('.activity-box')];
  const b = boxes.find(x => x.innerText.includes(frag));
  if (!b) return 'not-found';
  const sec = b.querySelector('.activity__wrap') || b;
  sec.scrollIntoView({block:'center'});
  await new Promise(r=>setTimeout(r,400));
  for (const ev of ['mousedown','mouseup','click']) {
    sec.dispatchEvent(new MouseEvent(ev,{bubbles:true,cancelable:true,view:window}));
    await new Promise(r=>setTimeout(r,200));
  }
  return 'clicked';
})()
"""


class Conn:
    def __init__(self, ws):
        self.ws = ws
        self.i = 0
        self.pending = {}
        self.events = []

    async def reader(self):
        async for raw in self.ws:
            m = json.loads(raw)
            if "id" in m:
                fut = self.pending.pop(m["id"], None)
                if fut and not fut.done():
                    fut.set_result(m)
            else:
                self.events.append(m)

    async def send(self, method, params=None):
        self.i += 1
        mid = self.i
        fut = asyncio.get_event_loop().create_future()
        self.pending[mid] = fut
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        m = await asyncio.wait_for(fut, 20)
        if "error" in m:
            raise RuntimeError(str(m["error"]))
        return m.get("result", {})

    async def evaluate(self, expr):
        r = await self.send("Runtime.evaluate", {"expression": expr, "awaitPromise": True,
                                                 "returnByValue": True, "userGesture": True})
        return r["result"].get("value")


async def main():
    frag = sys.argv[1]
    wait = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0
    nav_url = sys.argv[3] if len(sys.argv) > 3 else None
    t = page_target(sys.argv[4] if len(sys.argv) > 4 else None)
    async with websockets.connect(t["webSocketDebuggerUrl"], max_size=None) as ws:
        c = Conn(ws)
        rt = asyncio.create_task(c.reader())
        await c.send("Network.enable")
        await c.send("Page.enable")
        await c.send("Page.navigate", {"url": nav_url or t["url"]})
        await asyncio.sleep(7)
        print("events after nav:", len(c.events))
        c.events.clear()
        print("click:", await c.evaluate(CLICK_JS % json.dumps(frag)))
        await asyncio.sleep(wait)

        reqs = {}
        for m in c.events:
            if m.get("method") == "Network.requestWillBeSent":
                p = m["params"]
                x = p["request"]
                reqs[p["requestId"]] = {"url": x["url"], "method": x["method"],
                                        "post": x.get("postData", ""), "type": x.get("type")}
            elif m.get("method") == "Network.responseReceived":
                p = m["params"]
                if p["requestId"] in reqs:
                    reqs[p["requestId"]]["status"] = p["response"]["status"]
                    reqs[p["requestId"]]["mime"] = p["response"].get("mimeType")
        print("events after click:", len(c.events), "reqs:", len(reqs))
        for rid, info in reqs.items():
            xhr = info["type"] in ("XHR", "Fetch")
            if not xhr:
                continue
            print("=" * 100)
            print(info["method"], info.get("status"), info["url"][:170])
            if info.get("post"):
                print("  body:", info["post"][:500])
            try:
                r = await c.send("Network.getResponseBody", {"requestId": rid})
                b = r.get("body", "")
                if r.get("base64Encoded"):
                    b = "<base64>"
                print("  resp:", b[:800].replace("\n", " "))
            except Exception as e:
                print("  resp:", f"<{e}>")
        rt.cancel()


if __name__ == "__main__":
    asyncio.run(main())
