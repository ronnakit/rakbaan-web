import sys
import subprocess
import time
import requests
import json
import base64
import os

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Output paths in D:\antigravity\session\
output_dir = r"D:\antigravity\session"
os.makedirs(output_dir, exist_ok=True)
cockpit_png = os.path.join(output_dir, "screen_cockpit_5cases_dashboard.png")
ops_png = os.path.join(output_dir, "screen_ops_5cases_dashboard.png")

print("📸 Launching Chrome headless to capture Cockpit & Ops Hub dashboard...")
chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
user_data = r"C:\Users\WINDOWS\AppData\Local\Temp\chrome_cdp_dash"

chrome_proc = subprocess.Popen([
    chrome_path,
    "--headless=new",
    "--remote-debugging-port=9223",
    "--window-size=1920,1080",
    f"--user-data-dir={user_data}",
    "http://localhost:5173/cockpit.html"
])

time.sleep(3)

try:
    tabs = requests.get("http://127.0.0.1:9223/json/list").json()
    tab = next((t for t in tabs if "cockpit.html" in t.get("url", "")), tabs[0])
    ws_url = tab["webSocketDebuggerUrl"]
    print("Connected to Cockpit CDP tab:", tab["title"])

    import asyncio
    import aiohttp

    async def capture():
        async with aiohttp.ClientSession() as session:
            async with session.ws_connect(ws_url) as ws:
                msg_id = 1

                async def send(method, params=None):
                    nonlocal msg_id
                    mid = msg_id
                    msg_id += 1
                    payload = {"id": mid, "method": method, "params": params or {}}
                    await ws.send_json(payload)
                    while True:
                        resp = await ws.receive_json()
                        if resp.get("id") == mid:
                            return resp.get("result", {})

                await send("Page.enable")
                await send("Runtime.enable")

                # Wait for frames and audit logs to render
                await asyncio.sleep(4)

                # Capture Cockpit
                res = await send("Page.captureScreenshot", {"format": "png"})
                data = base64.b64decode(res["data"])
                with open(cockpit_png, "wb") as f:
                    f.write(data)
                print(f"✅ Saved Cockpit screenshot: {cockpit_png}")

                # Navigate to Ops Hub
                await send("Page.navigate", {"url": "http://localhost:5173/?devAdmin=true"})
                await asyncio.sleep(3)

                res2 = await send("Page.captureScreenshot", {"format": "png"})
                data2 = base64.b64decode(res2["data"])
                with open(ops_png, "wb") as f:
                    f.write(data2)
                print(f"✅ Saved Ops Hub screenshot: {ops_png}")

    asyncio.run(capture())

except Exception as e:
    print("Capture error:", e)
finally:
    chrome_proc.terminate()
