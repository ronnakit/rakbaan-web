import { spawn } from 'child_process';
import fs from 'fs';

async function run() {
  console.log('Launching headless Chrome with CDP...');
  const chromeProc = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--headless=new",
    "--remote-debugging-port=9222",
    "--window-size=1920,1080",
    "--user-data-dir=C:\\Users\\WINDOWS\\AppData\\Local\\Temp\\chrome_cdp",
    "http://localhost:5173/cockpit.html"
  ]);

  // Wait for Chrome to listen
  await new Promise(r => setTimeout(r, 2500));

  try {
    const res = await fetch("http://127.0.0.1:9222/json/list");
    const tabs = await res.json();
    const tab = tabs.find(t => t.url.includes("cockpit.html")) || tabs[0];
    if (!tab) {
      throw new Error("Tab not found");
    }

    console.log('Connected to tab:', tab.title, tab.webSocketDebuggerUrl);
    const ws = new WebSocket(tab.webSocketDebuggerUrl);

    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

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

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map(a => a.value || a.description || '').join(' ');
        if (text) console.log('  [Browser]', text);
      }
    });

    console.log('Clicking button #btn-trigger-simulation (Happy Path)...');
    await send("Runtime.evaluate", {
      expression: `document.getElementById('btn-trigger-simulation').click();`
    });

    console.log('Waiting for 10-step simulation to complete...');
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const evalRes = await send("Runtime.evaluate", {
        expression: `({
          btnDisabled: document.getElementById('btn-trigger-simulation').disabled,
          logCount: document.getElementById('log-count').textContent,
          firstRow: document.querySelector('.audit-row')?.textContent || ''
        })`,
        returnByValue: true
      });
      const val = evalRes?.result?.value;
      if (i % 3 === 0) {
        console.log(`  [Sec ${i}] Status: ${val?.btnDisabled ? 'Running' : 'Ready'} | Logs: ${val?.logCount}`);
      }
      if (val && !val.btnDisabled && i >= 13) {
        console.log(`Simulation finished successfully at second ${i}! Total Logs: ${val.logCount}`);
        break;
      }
    }

    // Wait 2s for UI repaint
    await new Promise(r => setTimeout(r, 2000));

    console.log('Capturing final screenshot...');
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync("E:\\rakbaan\\dev\\rakbaan\\claudecode\\rakbaan_ops\\cockpit_sim_new_tech.png", Buffer.from(screenshot.data, 'base64'));
    console.log('Screenshot successfully saved to cockpit_sim_new_tech.png');

    ws.close();
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    chromeProc.kill();
  }
}

run();
