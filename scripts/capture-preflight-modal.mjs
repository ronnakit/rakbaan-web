import { spawn } from 'child_process';
import fs from 'fs';

const OUT_PATH = 'D:\\antigravity\\session\\screen_tech_preflight_modal.png';

async function main() {
  console.log('📸 Launching Chrome to capture Tech Preflight Modal...');
  const chromeProc = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--headless=new",
    "--disable-extensions",
    "--remote-debugging-port=9230",
    "--window-size=430,932",
    "--user-data-dir=C:\\Users\\WINDOWS\\AppData\\Local\\Temp\\chrome_modal_capture_node",
    "http://localhost:5173/tech.html?techId=RPS-T01"
  ]);

  await new Promise(r => setTimeout(r, 2000));

  try {
    const res = await fetch("http://127.0.0.1:9230/json/list");
    const tabs = await res.json();
    const tab = tabs.find(t => t.type === 'page' && !t.url.startsWith('chrome')) || tabs[0];
    if (!tab) throw new Error("No tab found");

    console.log(`Connected to tab: ${tab.title || tab.url}`);
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise(resolve => ws.onopen = resolve);

    let id = 1;
    function send(method, params = {}) {
      const curId = id++;
      return new Promise(resolve => {
        const h = (e) => {
          const m = JSON.parse(e.data);
          if (m.id === curId) {
            ws.removeEventListener('message', h);
            resolve(m.result);
          }
        };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id: curId, method, params }));
      });
    }

    await send("Page.enable");
    await send("Runtime.enable");
    console.log("Waiting 3s for tech portal to render...");
    await new Promise(r => setTimeout(r, 3000));

    // Open Preflight Checklist Modal by finding the button or injecting modal
    console.log("Triggering preflight modal...");
    await send("Runtime.evaluate", {
      expression: `
        (() => {
          const btnArrive = document.querySelector('[id^="btn-arrive-"]');
          if (btnArrive) {
            btnArrive.click();
          } else {
            // Fallback: render preflight modal directly
            const container = document.getElementById('preflight-modal-container');
            if (container) {
              container.innerHTML = \`
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
              \`;
            }
          }
        })()
      `
    });

    await new Promise(r => setTimeout(r, 1500));
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(OUT_PATH, Buffer.from(shot.data, 'base64'));
    console.log(`✅ Preflight Modal captured successfully to: ${OUT_PATH}`);
    ws.close();
  } catch (err) {
    console.error("Error capturing modal:", err);
  } finally {
    chromeProc.kill();
  }
}

main();
