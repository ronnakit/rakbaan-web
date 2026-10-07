import { spawn } from 'child_process';
import fs from 'fs';

async function run() {
  console.log('Testing cockpit with customer port 8080...');
  const chromeProc = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--headless=new",
    "--remote-debugging-port=9224",
    "--window-size=1920,1080",
    "--user-data-dir=C:\\Users\\WINDOWS\\AppData\\Local\\Temp\\chrome_cockpit_test",
    "http://localhost:5173/cockpit.html"
  ]);

  await new Promise(r => setTimeout(r, 3000));

  try {
    const res = await fetch("http://127.0.0.1:9224/json/list");
    const tabs = await res.json();
    const tab = tabs.find(t => t.url.includes("cockpit.html")) || tabs[0];
    if (!tab) throw new Error("No tab");

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
    console.log('Waiting 8 seconds for Flutter Web (port 8080) to render inside iframe...');
    await new Promise(r => setTimeout(r, 8000));

    console.log('Capturing cockpit screenshot...');
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync("E:\\rakbaan\\dev\\rakbaan\\claudecode\\rakbaan_ops\\cockpit_with_flutter_8080.png", Buffer.from(screenshot.data, 'base64'));
    console.log('Saved cockpit_with_flutter_8080.png successfully!');
    ws.close();
  } catch(err) {
    console.error('Error:', err);
  } finally {
    chromeProc.kill();
  }
}

run();
