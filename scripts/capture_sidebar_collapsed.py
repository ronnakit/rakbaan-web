import sys
import subprocess
import time
import requests
import json
import base64
import os
import asyncio
import aiohttp

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

output_dir = r"D:\antigravity\session"
os.makedirs(output_dir, exist_ok=True)

chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
user_data = r"C:\Users\WINDOWS\AppData\Local\Temp\chrome_collapse_cap"

async def capture():
    port = 9277
    chrome_proc = subprocess.Popen([
        chrome_path,
        "--headless=new",
        "--disable-extensions",
        f"--remote-debugging-port={port}",
        "--window-size=1440,900",
        f"--user-data-dir={user_data}",
        "about:blank"
    ])
    
    await asyncio.sleep(2.5)
    
    try:
        tabs = requests.get(f"http://127.0.0.1:{port}/json/list").json()
        tab = next((t for t in tabs if t.get("type") == "page"), tabs[0])
        ws_url = tab["webSocketDebuggerUrl"]
        
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

                # Navigate to Ops Hub
                await send("Page.navigate", {"url": "http://localhost:5173/?devAdmin=true"})
                await asyncio.sleep(3.5)

                # 1. Capture normal view with sidebar
                res = await send("Page.captureScreenshot", {"format": "png"})
                normal_file = os.path.join(output_dir, "screen_ops_admin_sidebar_open.png")
                with open(normal_file, "wb") as f:
                    f.write(base64.b64decode(res["data"]))
                print(f"✅ บันทึกภาพเมนูปกติ: {normal_file}")

                # 2. Click button to collapse sidebar
                print("Clicking btn-toggle-sidebar...")
                await send("Runtime.evaluate", {
                    "expression": "document.getElementById('btn-toggle-sidebar')?.click();"
                })
                await asyncio.sleep(1.0)

                # Capture collapsed full-width view
                res2 = await send("Page.captureScreenshot", {"format": "png"})
                collapsed_file = os.path.join(output_dir, "screen_ops_admin_sidebar_collapsed.png")
                with open(collapsed_file, "wb") as f:
                    f.write(base64.b64decode(res2["data"]))
                print(f"✅ บันทึกภาพขยายจอกลางเต็มจอ: {collapsed_file}")

    except Exception as e:
        print("Capture error:", e)
    finally:
        chrome_proc.terminate()

if __name__ == '__main__':
    asyncio.run(capture())
