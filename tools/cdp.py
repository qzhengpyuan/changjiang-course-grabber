#!/usr/bin/env python3
"""极简 CDP 客户端：给 :99 影子 Vivaldi 用。

用法:
  python3 cdp.py eval "<js>"          # 在页面上下文执行(支持 await)
  python3 cdp.py nav <url>            # 导航并等 load
  python3 cdp.py targets              # 列 target
  python3 cdp.py cookies              # 打印 cookie 名/域
"""
import asyncio
import json
import sys
import urllib.request

import websockets

PORT = 9223


def http_json(path, method="GET", timeout=5):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def page_target(match=None):
    ts = http_json("/json/list")
    pages = [t for t in ts if t["type"] == "page"]
    if match:
        hit = [t for t in pages if match in t["url"]]
        if hit:
            return hit[0]
    if not pages:
        t = http_json("/json/new?about:blank", method="PUT")
        return t
    return pages[0]


class CDP:
    def __init__(self, ws_url):
        self.ws_url = ws_url
        self.i = 0

    async def __aenter__(self):
        self.ws = await websockets.connect(self.ws_url, max_size=None)
        return self

    async def __aexit__(self, *a):
        await self.ws.close()

    async def send(self, method, params=None):
        self.i += 1
        mid = self.i
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    async def evaluate(self, expr, await_promise=True):
        r = await self.send("Runtime.evaluate", {
            "expression": expr, "awaitPromise": await_promise,
            "returnByValue": True, "userGesture": True,
        })
        if r.get("exceptionDetails"):
            raise RuntimeError(json.dumps(r["exceptionDetails"])[:2000])
        return r["result"].get("value")


async def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "targets"
    t = page_target()
    async with CDP(t["webSocketDebuggerUrl"]) as c:
        if cmd == "targets":
            print(json.dumps(t, indent=2, ensure_ascii=False))
        elif cmd == "eval":
            v = await c.evaluate(sys.argv[2])
            print(v if isinstance(v, str) else json.dumps(v, indent=2, ensure_ascii=False))
        elif cmd == "nav":
            await c.send("Page.enable")
            await c.send("Page.navigate", {"url": sys.argv[2]})
            await asyncio.sleep(float(sys.argv[3]) if len(sys.argv) > 3 else 3)
            print(await c.evaluate("location.href"))
        elif cmd == "cookies":
            r = await c.send("Storage.getCookies")
            for ck in r["cookies"]:
                if "yuketang" in ck["domain"]:
                    print(ck["domain"], ck["name"], ck["value"][:20], "expires", ck.get("expires"))


if __name__ == "__main__":
    asyncio.run(main())
