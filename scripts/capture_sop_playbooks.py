import sys
import subprocess
import time
import requests
import base64
import os
import json
import asyncio
import aiohttp

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

output_dir = r"D:\antigravity\session"
tech_sop_png = os.path.join(output_dir, "screen_tech_inapp_playbook.png")
ops_sop_png = os.path.join(output_dir, "screen_ops_inapp_playbook.png")

chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

async def capture_tech_playbook():
    print("📸 1. Capturing Tech Portal with In-App Playbook Modal...")
    user_data = r"C:\Users\WINDOWS\AppData\Local\Temp\chrome_cdp_tech_sop"
    proc = subprocess.Popen([
        chrome_path,
        "--headless=new",
        "--remote-debugging-port=9240",
        "--window-size=430,932",
        f"--user-data-dir={user_data}",
        "http://localhost:5173/tech.html?techId=RPS-T01"
    ])
    
    tab = None
    for _ in range(12):
        time.sleep(1)
        try:
            tabs = requests.get("http://127.0.0.1:9240/json/list", timeout=2).json()
            if tabs:
                tab = [t for t in tabs if t.get('type') == 'page'][0]
                break
        except Exception:
            pass

    if not tab:
        proc.terminate()
        print("Failed to connect to Tech Chrome")
        return

    ws_url = tab["webSocketDebuggerUrl"]
    async with aiohttp.ClientSession() as session:
        async with session.ws_connect(ws_url) as ws:
            msg_id = 1
            async def send(method, params=None):
                nonlocal msg_id
                mid = msg_id
                msg_id += 1
                await ws.send_json({"id": mid, "method": method, "params": params or {}})
                while True:
                    msg = await asyncio.wait_for(ws.receive(), timeout=10)
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        data = json.loads(msg.data)
                        if data.get("id") == mid:
                            return data.get("result", {})

            await send("Page.enable")
            await asyncio.sleep(2)
            # Open playbook modal
            await send("Runtime.evaluate", {"expression": "window.openTechPlaybookModal();"})
            await asyncio.sleep(1)
            res = await send("Page.captureScreenshot", {"format": "png"})
            with open(tech_sop_png, "wb") as f:
                f.write(base64.b64decode(res["data"]))
            print(f"✅ Saved Tech SOP: {tech_sop_png}")

    proc.terminate()

async def capture_ops_playbook():
    print("📸 2. Capturing Ops Admin Hub with In-App Playbook Modal...")
    user_data = r"C:\Users\WINDOWS\AppData\Local\Temp\chrome_cdp_ops_sop"
    proc = subprocess.Popen([
        chrome_path,
        "--headless=new",
        "--remote-debugging-port=9241",
        "--window-size=1280,850",
        f"--user-data-dir={user_data}",
        "http://localhost:5173/?devAdmin=true"
    ])

    tab = None
    for _ in range(12):
        time.sleep(1)
        try:
            tabs = requests.get("http://127.0.0.1:9241/json/list", timeout=2).json()
            if tabs:
                tab = [t for t in tabs if t.get('type') == 'page'][0]
                break
        except Exception:
            pass

    if not tab:
        proc.terminate()
        print("Failed to connect to Ops Chrome")
        return

    ws_url = tab["webSocketDebuggerUrl"]
    async with aiohttp.ClientSession() as session:
        async with session.ws_connect(ws_url) as ws:
            msg_id = 1
            async def send(method, params=None):
                nonlocal msg_id
                mid = msg_id
                msg_id += 1
                await ws.send_json({"id": mid, "method": method, "params": params or {}})
                while True:
                    msg = await asyncio.wait_for(ws.receive(), timeout=10)
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        data = json.loads(msg.data)
                        if data.get("id") == mid:
                            return data.get("result", {})

            await send("Page.enable")
            await asyncio.sleep(2)
            # Open ops playbook modal
            await send("Runtime.evaluate", {"expression": "window.openOpsPlaybookModal();"})
            await asyncio.sleep(1)
            res = await send("Page.captureScreenshot", {"format": "png"})
            with open(ops_sop_png, "wb") as f:
                f.write(base64.b64decode(res["data"]))
            print(f"✅ Saved Ops SOP: {ops_sop_png}")

    proc.terminate()

async def main():
    await capture_tech_playbook()
    await capture_ops_playbook()

if __name__ == "__main__":
    asyncio.run(main())
