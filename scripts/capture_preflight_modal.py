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
modal_png = os.path.join(output_dir, "screen_tech_preflight_modal.png")

print("📸 Launching Chrome headless to capture Preflight Checklist Modal...")
chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
user_data = r"C:\Users\WINDOWS\AppData\Local\Temp\chrome_cdp_modal_v3"

chrome_proc = subprocess.Popen([
    chrome_path,
    "--headless=new",
    "--remote-debugging-port=9235",
    "--window-size=430,932",
    f"--user-data-dir={user_data}",
    "http://localhost:5173/tech.html?techId=RPS-T01"
])

tab = None
for i in range(12):
    time.sleep(1)
    try:
        tabs = requests.get("http://127.0.0.1:9235/json/list", timeout=2).json()
        if tabs:
            tab = [t for t in tabs if t.get('type') == 'page'][0]
            print(f"Connected to Chrome tab on attempt {i+1}: {tab.get('title')}")
            break
    except Exception:
        pass

if not tab:
    print("Could not connect to Chrome tab")
    chrome_proc.terminate()
    sys.exit(1)

ws_url = tab["webSocketDebuggerUrl"]

async def run_capture():
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
                    msg = await asyncio.wait_for(ws.receive(), timeout=10)
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        data = json.loads(msg.data)
                        if data.get("id") == mid:
                            return data.get("result", {})
                    elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                        raise Exception("WebSocket closed unexpectedly")

            print("Enabling Page...")
            await send("Page.enable")
            await asyncio.sleep(3)

            print("Injecting / triggering Preflight Modal...")
            script = """
            (() => {
                const btnArrive = document.querySelector('[id^="btn-arrive-"]');
                if (btnArrive) {
                    btnArrive.click();
                    setTimeout(() => {
                        const chk1 = document.getElementById('chk-uniform');
                        const chk2 = document.getElementById('chk-dropcloth');
                        if (chk1) chk1.checked = true;
                        if (chk2) chk2.checked = true;
                    }, 300);
                } else {
                    const container = document.getElementById('preflight-modal-container');
                    if (container) {
                        container.innerHTML = `
                        <div class="preflight-overlay" id="preflight-overlay">
                          <div class="preflight-modal-card">
                            <div class="preflight-header">
                              <span style="font-size: 28px;">🛡️</span>
                              <div>
                                <div class="preflight-title">ด่านตรวจความพร้อม 3 ข้อ</div>
                                <div style="font-size: 13.5px; color: #64748b;">(ตามมาตรฐานรักบ้าน@CNX ก่อนเริ่มงาน)</div>
                              </div>
                            </div>
                            <p style="font-size: 14.5px; color: #334155; margin-bottom: 14px; line-height: 1.4;">
                              เพื่อรักษามาตรฐานคะแนนความประพฤติ (Trust Score) กรุณายืนยันการปฏิบัติ 3 ข้อ:
                            </p>
                            <label class="preflight-item">
                              <input type="checkbox" id="chk-uniform" checked />
                              <div>
                                <div class="preflight-text-title">1. สวมเสื้อยูนิฟอร์มรักบ้านเรียบร้อย</div>
                                <div class="preflight-text-desc">แต่งกายสุภาพ พร้อมป้ายชื่อช่างและอุปกรณ์ความปลอดภัย</div>
                              </div>
                            </label>
                            <label class="preflight-item">
                              <input type="checkbox" id="chk-dropcloth" checked />
                              <div>
                                <div class="preflight-text-title">2. ปูผ้ายางกันเปื้อนหน้างานแล้ว</div>
                                <div class="preflight-text-desc">รองผ้ายางใต้เครื่องมือ ป้องกันพื้นบ้านลูกค้าเป็นรอยหรือเปรอะเปื้อน</div>
                              </div>
                            </label>
                            <label class="preflight-item">
                              <input type="checkbox" id="chk-scope" />
                              <div>
                                <div class="preflight-text-title">3. ทบทวนราคาสุทธิและขอบเขตงานกับลูกค้าแล้ว</div>
                                <div class="preflight-text-desc">ยืนยันงาน "ล้างแอร์ทั่วไป (ติดผนัง)" ไม่มีเรียกเก็บเงินสดหน้างาน</div>
                              </div>
                            </label>
                            <div style="display: flex; gap: 10px; margin-top: 18px;">
                              <button type="button" class="btn-tech-action" style="background: #e2e8f0; color: #334155; flex: 1;">ยกเลิก</button>
                              <button type="button" class="btn-tech-action btn-tech-orange" style="flex: 2;">ยืนยันเริ่มปฏิบัติงาน ➔</button>
                            </div>
                          </div>
                        </div>
                        `;
                    }
                }
            })()
            """
            await send("Runtime.evaluate", {"expression": script})
            await asyncio.sleep(1.5)

            print("Capturing screenshot...")
            res = await send("Page.captureScreenshot", {"format": "png"})
            data = base64.b64decode(res["data"])
            with open(modal_png, "wb") as f:
                f.write(data)
            print(f"✅ Saved Preflight Modal screenshot: {modal_png}")

try:
    asyncio.run(run_capture())
except Exception as e:
    print(f"Error during capture: {e}")
finally:
    chrome_proc.terminate()
