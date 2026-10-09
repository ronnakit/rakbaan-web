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
user_data = r"C:\Users\WINDOWS\AppData\Local\Temp\chrome_cdp_session_fresh"

screens = [
    {
        "name": "screen_cockpit.png",
        "url": "http://localhost:5173/cockpit.html",
        "width": 1920,
        "height": 1080,
        "wait": 5
    },
    {
        "name": "screen_ops_admin_queue.png",
        "url": "http://localhost:5173/?devAdmin=true",
        "width": 1440,
        "height": 900,
        "wait": 3
    },
    {
        "name": "screen_tech.png",
        "url": "http://localhost:5173/tech.html?techId=RPS-T01",
        "width": 430,
        "height": 932,
        "wait": 3
    },
    {
        "name": "screen_customer.png",
        "url": "http://localhost:5173/customer.html",
        "width": 430,
        "height": 932,
        "wait": 3
    }
]

async def capture_all():
    port = 9255
    print(f"📸 Starting Chrome headless on port {port}...")
    chrome_proc = subprocess.Popen([
        chrome_path,
        "--headless=new",
        "--disable-extensions",
        f"--remote-debugging-port={port}",
        "--window-size=1920,1080",
        f"--user-data-dir={user_data}",
        "about:blank"
    ])
    
    await asyncio.sleep(2.5)
    
    try:
        tabs = requests.get(f"http://127.0.0.1:{port}/json/list").json()
        tab = next((t for t in tabs if t.get("type") == "page"), tabs[0])
        ws_url = tab["webSocketDebuggerUrl"]
        print(f"Connected to Chrome WebSocket: {ws_url}")
        
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

                for s in screens:
                    print(f"Navigating to {s['name']} -> {s['url']} ({s['width']}x{s['height']})...")
                    await send("Emulation.setDeviceMetricsOverride", {
                        "width": s["width"],
                        "height": s["height"],
                        "deviceScaleFactor": 1,
                        "mobile": s["width"] < 600
                    })
                    await send("Page.navigate", {"url": s["url"]})
                    await asyncio.sleep(s["wait"])
                    
                    res = await send("Page.captureScreenshot", {"format": "png"})
                    data = base64.b64decode(res["data"])
                    target_file = os.path.join(output_dir, s["name"])
                    with open(target_file, "wb") as f:
                        f.write(data)
                    print(f"✅ บันทึกหน้าจอสำเร็จ: {target_file} ({len(data)} bytes)")

        print("🎉 แคปเจอร์หน้าจอจริงทั้ง 4 หน้าจอสำเร็จเรียบร้อยแล้ว!")
    except Exception as e:
        print("Capture error:", e)
    finally:
        chrome_proc.terminate()

if __name__ == '__main__':
    asyncio.run(capture_all())
