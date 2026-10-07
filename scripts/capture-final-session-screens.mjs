import { spawn } from 'child_process';
import fs from 'fs';

const OUT_DIR = 'D:\\antigravity\\session';

async function captureUrl(url, outputPath, width, height, waitMs = 3000) {
  console.log(`Capturing ${url} (${width}x${height}) -> ${outputPath}...`);
  const chromeProc = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--headless=new",
    "--disable-extensions",
    "--remote-debugging-port=9226",
    `--window-size=${width},${height}`,
    "--user-data-dir=C:\\Users\\WINDOWS\\AppData\\Local\\Temp\\chrome_final_capture_clean",
    url
  ]);

  await new Promise(r => setTimeout(r, 2500));

  try {
    const res = await fetch("http://127.0.0.1:9226/json/list");
    const tabs = await res.json();
    const tab = tabs.find(t => t.type === 'page' && !t.url.startsWith('chrome')) || tabs[0];
    if (!tab) throw new Error("No tab found");

    console.log(`  Connected to tab: ${tab.title || tab.url}`);
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
    console.log(`  Waiting ${waitMs}ms for render...`);
    await new Promise(r => setTimeout(r, waitMs));

    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(outputPath, Buffer.from(shot.data, 'base64'));
    console.log(`  Saved: ${outputPath}`);
    ws.close();
  } catch (err) {
    console.error(`Error capturing ${url}:`, err);
  } finally {
    chromeProc.kill();
  }
  await new Promise(r => setTimeout(r, 1200));
}

async function run() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  // 1. Customer screen (Flutter Web on port 8080)
  await captureUrl('http://localhost:8080/', `${OUT_DIR}\\screen_1_customer_final.png`, 430, 932, 7000);

  // 2. Ops Hub ("การบริหารรักบ้าน")
  await captureUrl('http://localhost:5173/?devAdmin=true', `${OUT_DIR}\\screen_2_ops_final.png`, 1440, 900, 3000);

  // 3. Technician Portal ("จอช่างมืออาชีพ")
  await captureUrl('http://localhost:5173/tech.html?techId=RPS-T01', `${OUT_DIR}\\screen_3_tech_final.png`, 430, 932, 3000);

  // 4. Cockpit ("ศูนย์ควบคุม 3 หน้าจอ")
  await captureUrl('http://localhost:5173/cockpit.html', `${OUT_DIR}\\screen_cockpit_3screens_final.png`, 1920, 1080, 8000);

  console.log('🎉 ALL 4 SCREENS CAPTURED SUCCESSFULLY!');
}

run();
