import { spawn } from 'child_process';
import fs from 'fs';

async function run() {
  console.log('Testing http://localhost:8080...');
  const p = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9223',
    '--window-size=430,932',
    'http://localhost:8080'
  ]);

  await new Promise(r => setTimeout(r, 4000));

  try {
    const res = await fetch('http://127.0.0.1:9223/json/list');
    const tabs = await res.json();
    console.log('Tabs:', tabs.map(t => t.url));
    const tab = tabs.find(t => t.url.includes('8080')) || tabs[0];
    if (!tab) throw new Error('No tab');

    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);

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

    await send('Page.enable');
    // Flutter CanvasKit takes 3-4s to boot, then splash screen transitions to home screen after ~3s
    console.log('Waiting for Flutter CanvasKit and splash transition...');
    await new Promise(r => setTimeout(r, 6500));

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('test_8080_now.png', Buffer.from(shot.data, 'base64'));
    console.log('Successfully saved test_8080_now.png, size:', shot.data.length);
    ws.close();
  } catch(err) {
    console.error('Error:', err);
  } finally {
    p.kill();
  }
}

run();
