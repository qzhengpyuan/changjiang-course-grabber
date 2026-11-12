#!/usr/bin/env python3
"""在空白页开网络抓包，导航到指定 URL，打印 XHR/Fetch/Media 请求与响应。

用法: python3 sniff.py <url> [等待秒数] [--click <js表达式>]
"""
import asyncio
import json
import sys

import websockets

from cdp import http_json


async def main():
    url = sys.argv[1]
    wait = float(sys.argv[2]) if len(sys.argv) > 2 else 12.0
    click_js = None
    if "--click" in sys.argv:
        click_js = sys.argv[sys.argv.index("--click") + 1]

    t = http_json("/json/new?about:blank", method="PUT")
    i = [0]
    pend = {}
    events = []
    async with websockets.connect(t["webSocketDebuggerUrl"], max_size=None) as ws:
        async def reader():
            async for raw in ws:
                m = json.loads(raw)
                if "id" in m:
                    f = pend.pop(m["id"], None)
                    if f and not f.done():
                        f.set_result(m)
                else:
                    events.append(m)

        async def send(method, params=None):
            i[0] += 1
            mid = i[0]
            f = asyncio.get_event_loop().create_future()
            pend[mid] = f
            await ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
            return (await asyncio.wait_for(f, 30)).get("result", {})

        rt = asyncio.create_task(reader())
        await send("Network.enable")
        await send("Page.enable")
        await send("Page.navigate", {"url": url})
        await asyncio.sleep(wait)
        if click_js:
            r = await send("Runtime.evaluate", {"expression": click_js, "awaitPromise": True,
                                                "returnByValue": True, "userGesture": True})
            print("click:", json.dumps(r.get("result", {}).get("value"))[:200])
            await asyncio.sleep(8)

        reqs = {}
        for m in events:
            if m.get("method") == "Network.requestWillBeSent":
                p = m["params"]
                x = p["request"]
                reqs[p["requestId"]] = {"url": x["url"], "method": x["method"],
                                        "post": x.get("postData", ""), "type": x.get("type")}
            elif m.get("method") == "Network.responseReceived":
                p = m["params"]
                if p["requestId"] in reqs:
                    reqs[p["requestId"]]["status"] = p["response"]["status"]
        print("events:", len(events), "reqs:", len(reqs))
        for rid, inf in reqs.items():
            if inf["type"] not in ("XHR", "Fetch", "Media"):
                continue
            print("=" * 100)
            print(inf["method"], inf.get("status"), inf["url"][:180])
            if inf.get("post"):
                print("  body:", inf["post"][:400])
            try:
                r = await send("Network.getResponseBody", {"requestId": rid})
                b = r.get("body", "")
                print("  resp:", ("<b64>" if r.get("base64Encoded") else b[:800]).replace("\n", " "))
            except Exception as e:
                print("  resp:", f"<{e}>")
        rt.cancel()
        try:
            http_json(f"/json/close/{t['id']}")
        except Exception:
            pass


if __name__ == "__main__":
    asyncio.run(main())
