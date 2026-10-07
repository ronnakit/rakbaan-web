import { spawn } from 'child_process';
import fs from 'fs';

async function run() {
  console.log('Launching headless Chrome for Tech Portal inspection...');
  const chromeProc = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--headless=new",
    "--remote-debugging-port=9222",
    "--window-size=430,932",
    "--user-data-dir=C:\\Users\\WINDOWS\\AppData\\Local\\Temp\\chrome_tech_view",
    "http://localhost:5173/tech.html?techId=RPS-T01"
  ]);

  await new Promise(r => setTimeout(r, 2500));

  try {
    const res = await fetch("http://127.0.0.1:9222/json/list");
    const tabs = await res.json();
    const tab = tabs.find(t => t.url.includes("tech.html")) || tabs[0];
    const ws = new WebSocket(tab.webSocketDebuggerUrl);

    await new Promise(resolve => ws.onopen = resolve);

    let idCounter = 1;
    function send(method, params = {}) {
      const id = idCounter++;
      return new Promise((resolve) => {
        const handler = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.id === id) {
            ws.removeEventListener('message', handler);
            resolve(msg.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await send("Page.enable");
    await send("Runtime.enable");

    // Wait 2s for Firestore onSnapshot to deliver jobs
    await new Promise(r => setTimeout(r, 2500));

    // Click "งานเสร็จแล้ว" tab to view completed job cards
    console.log('Switching to "งานเสร็จแล้ว" tab...');
    await send("Runtime.evaluate", {
      expression: `document.querySelector('[data-tab="completed"]').click();`
    });
    await new Promise(r => setTimeout(r, 1200));

    console.log('Capturing completed jobs view...');
    const sc1 = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync("E:\\rakbaan\\dev\\rakbaan\\claudecode\\rakbaan_ops\\tech_view_completed.png", Buffer.from(sc1.data, 'base64'));

    // Open Tech Switcher modal
    console.log('Opening "สลับช่าง" modal...');
    await send("Runtime.evaluate", {
      expression: `document.getElementById('btn-open-tech-picker').click();`
    });
    await new Promise(r => setTimeout(r, 1000));

    console.log('Capturing tech switcher modal...');
    const sc2 = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync("E:\\rakbaan\\dev\\rakbaan\\claudecode\\rakbaan_ops\\tech_view_modal.png", Buffer.from(sc2.data, 'base64'));

    ws.close();
    console.log('Screenshots saved successfully!');
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    chromeProc.kill();
  }
}

run();
