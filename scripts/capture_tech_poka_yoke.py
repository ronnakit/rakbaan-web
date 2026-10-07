import sys
import subprocess
import time
import requests
import base64
import os
import asyncio
import aiohttp

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

output_dir = r"D:\antigravity\session"
tech_png = os.path.join(output_dir, "screen_tech_poka_yoke.png")

print("📸 Launching Chrome headless to capture updated Tech Portal with Poka-Yoke...")
chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
user_data = r"C:\Users\WINDOWS\AppData\Local\Temp\chrome_cdp_tech_poka"

chrome_proc = subprocess.Popen([
    chrome_path,
    "--headless=new",
    "--remote-debugging-port=9225",
    "--window-size=430,932",
    f"--user-data-dir={user_data}",
    "http://localhost:5173/tech.html?techId=RPS-T01"
])

tab = None
for i in range(10):
    time.sleep(1)
    try:
        tabs = requests.get("http://127.0.0.1:9225/json/list", timeout=2).json()
        if tabs:
            tab = tabs[0]
            print(f"Connected to Chrome tab on attempt {i+1}: {tab.get('title')}")
            break
    except Exception:
        pass

if not tab:
    print("Could not connect to Chrome tab")
    chrome_proc.terminate()
    sys.exit(1)

ws_url = tab["webSocketDebuggerUrl"]

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
            await asyncio.sleep(3)

            res = await send("Page.captureScreenshot", {"format": "png"})
            data = base64.b64decode(res["data"])
            with open(tech_png, "wb") as f:
                f.write(data)
            print(f"✅ Saved Tech Portal screenshot: {tech_png}")

try:
    asyncio.run(capture())
except Exception as e:
    print("Capture error:", e)
finally:
    chrome_proc.terminate()
