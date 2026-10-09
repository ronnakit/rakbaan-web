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
user_data = r"C:\Users\WINDOWS\AppData\Local\Temp\chrome_occ_deck_cap"

async def capture():
    port = 9266
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

                # 1. Click toggle sim issues button to turn on the 4 emergency trains
                print("Activating 4 simulated emergency trains...")
                await send("Runtime.evaluate", {
                    "expression": "document.getElementById('btn-toggle-sim-issues')?.click();"
                })
                await asyncio.sleep(2)

                # Capture Multi-Incident Deck
                res = await send("Page.captureScreenshot", {"format": "png"})
                deck_file = os.path.join(output_dir, "screen_ops_admin_multi_incident_deck.png")
                with open(deck_file, "wb") as f:
                    f.write(base64.b64decode(res["data"]))
                print(f"✅ บันทึกภาพ Multi-Incident Deck: {deck_file}")

                # 2. Click quick-issue-open on the first incident card to open the emergency modal
                print("Opening emergency dispatch modal...")
                await send("Runtime.evaluate", {
                    "expression": "document.querySelector('.btn-quick-issue-open')?.click();"
                })
                await asyncio.sleep(2)

                # Capture Emergency Resolution Modal with Next Train Flow
                res2 = await send("Page.captureScreenshot", {"format": "png"})
                modal_file = os.path.join(output_dir, "screen_ops_admin_next_train_flow.png")
                with open(modal_file, "wb") as f:
                    f.write(base64.b64decode(res2["data"]))
                print(f"✅ บันทึกภาพ Next Train Flow Modal: {modal_file}")

    except Exception as e:
        print("Capture error:", e)
    finally:
        chrome_proc.terminate()

if __name__ == '__main__':
    asyncio.run(capture())
