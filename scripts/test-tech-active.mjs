import { spawn } from 'child_process';
import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAzQILf3Ib1fARM-UtGycbehUJ1W4-QfU0',
  authDomain: 'rakbaan-cnx.firebaseapp.com',
  projectId: 'rakbaan-cnx',
  storageBucket: 'rakbaan-cnx.firebasestorage.app',
  messagingSenderId: '41492967250',
  appId: '1:41492967250:web:d4b5c6c8f09cb2fb69948b',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function run() {
  await signInAnonymously(auth);

  // 1. Create active assigned job
  const testJob = {
    customerId: 'customer_cherd',
    customerName: 'คุณเชิดศักดิ์ (เจ้าของบ้าน)',
    customerPhone: '081-882-9988',
    title: 'ล้างแอร์ทั่วไป (ติดผนัง) (ห้องรับแขก)',
    category: 'air_con',
    price: 600,
    status: 'assigned',
    workflowStep: 3,
    workflowStatus: 'assigned',
    assignedTeamId: 'RPS-T01',
    assignedTechId: 'RPS-T01',
    assignedTechName: 'ช่างสมหมาย ใจซื่อ (ช่างหมาย)',
    addressDetail: '88/12 ถ.สุเทพ ต.สุเทพ อ.เมือง จ.เชียงใหม่',
    createdAt: new Date().toISOString(),
  };

  const docRef = await addDoc(collection(db, 'jobs'), testJob);
  const jobId = docRef.id;
  console.log('Created test job:', jobId);

  // 2. Launch Chrome
  const chromeProc = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--headless=new",
    "--remote-debugging-port=9222",
    "--window-size=430,932",
    "--user-data-dir=C:\\Users\\WINDOWS\\AppData\\Local\\Temp\\chrome_tech_active",
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

    // Wait for card to appear
    await new Promise(r => setTimeout(r, 2500));

    console.log('Capturing Assigned job card...');
    const sc1 = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync("E:\\rakbaan\\dev\\rakbaan\\claudecode\\rakbaan_ops\\tech_view_assigned.png", Buffer.from(sc1.data, 'base64'));

    // Update job to in_progress
    console.log('Updating job to in_progress...');
    await updateDoc(doc(db, 'jobs', jobId), {
      status: 'in_progress',
      workflowStep: 7,
      workflowStatus: 'in_progress'
    });

    await new Promise(r => setTimeout(r, 2000));

    console.log('Capturing In-Progress job card (Photo Upload Form)...');
    const sc2 = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync("E:\\rakbaan\\dev\\rakbaan\\claudecode\\rakbaan_ops\\tech_view_inprogress.png", Buffer.from(sc2.data, 'base64'));

    ws.close();
  } catch (err) {
    console.error('Error during test:', err);
  } finally {
    chromeProc.kill();
    // Cleanup test job
    await deleteDoc(doc(db, 'jobs', jobId));
    console.log('Deleted test job. Done!');
  }
}

run();
