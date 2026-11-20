#!/usr/bin/env python3
"""Minimal MCP client to check the bridge is running: python3 scripts/smoke_test.py [tool] [json-args]"""
import json, sys, urllib.request

URL = "http://127.0.0.1:23119/claude-bridge/mcp"

def rpc(method, params=None, id=1):
    body = {"jsonrpc": "2.0", "method": method}
    if id is not None:
        body["id"] = id
    if params is not None:
        body["params"] = params
    req = urllib.request.Request(URL, json.dumps(body).encode(), {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    })
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw else None

init = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                          "clientInfo": {"name": "smoke", "version": "0"}})
print("server:", init["result"]["serverInfo"], init["result"]["protocolVersion"])
rpc("notifications/initialized", id=None)
if len(sys.argv) > 1:
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    res = rpc("tools/call", {"name": sys.argv[1], "arguments": args}, id=2)
    r = res.get("result", res)
    if r.get("isError"):
        print("ERROR:", end=" ")
    for c in r.get("content", []):
        print(c.get("text"))
    if "error" in res:
        print(res["error"])
else:
    tools = rpc("tools/list", id=2)["result"]["tools"]
    print(len(tools), "tools:", ", ".join(t["name"] for t in tools))
