/**
 * รักบ้าน@CNX — Multi-Agent Audit Logger
 * บันทึกร่องรอยการทำงาน (Audit Trail) ของ 5 Agents ตามกฎเหล็กข้อ 6 ใน GEMINI.md
 * ซิงค์ข้อมูลผ่าน BroadcastChannel สำหรับ Instant Cockpit Stream + Firestore สำหรับความคงทนถาวร
 */

import { db } from './firebase.js';
import { collection, addDoc, query, orderBy, limit, onSnapshot } from 'firebase/firestore';

// BroadcastChannel สำหรับการสื่อสารแบบ Real-time ระหว่าง iframes และ tabs ใน Origin เดียวกัน
const auditChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('rakbaan_audit_channel') : null;

export const AGENT_ROLES = {
  AGENT_1: { id: 'agent-1-customer', name: 'บทบาทที่ 1: ลูกค้า 👤', color: '#0284c7' },
  AGENT_2: { id: 'agent-2-tech', name: 'บทบาทที่ 2: ช่างมืออาชีพ 🔧', color: '#d97706' },
  AGENT_3: { id: 'agent-3-ops', name: 'บทบาทที่ 3: ฝ่ายบริหารรักบ้าน 🏛️', color: '#16a34a' },
  AGENT_4: { id: 'agent-4-qc', name: 'บทบาทที่ 4: คุณวิชัย ตรวจการ (QC-01) 🔍', color: '#9333ea' },
  MALI:    { id: 'mali-lead', name: 'น้องมะลิ: ผู้ดูแลโครงการ 👩‍💼', color: '#e11d48' },
};

export const STEP_NAMES = {
  1: '1. ลูกค้าแจ้งซ่อม',
  2: '2. เราเห็นและรับเรื่อง',
  3: '3. ส่งมอบหมายช่างมืออาชีพ',
  4: '4. พักเงินค่าบริการในระบบ',
  5: '5. ช่างรับงานและออกเดินทาง',
  6: '6. เราประสานงานสามฝ่าย',
  7: '7. เราสั่งเริ่มงานซ่อม',
  8: '8. ช่างส่งมอบงานพร้อมรูปภาพ',
  9: '9. เราตรวจมาตรฐานคุณภาพงาน',
  10: '10. ลูกค้ารับมอบงานและเปิดใบรับประกัน',
};

/**
 * บันทึกการกระทำของ Agent ตาม 3 มิติ: คน (Actor) - สิ่งของ/เงิน (Items/Cost) - เวลา (Time/Dwell)
 * @param {Object} entry 
 * @param {string} entry.agentId รหัส Agent เช่น 'agent-1-customer'
 * @param {string} [entry.agentName] ชื่อ Agent
 * @param {string} [entry.actorName] ชื่อคนจริงผู้รับผิดชอบ (เช่น คุณวิชัย ตรวจการ QC-01)
 * @param {number} entry.step ลำดับขั้นตอน 1-10
 * @param {string} [entry.stepName] ชื่อขั้นตอน
 * @param {string} entry.action ชื่อ Action เช่น 'SUBMIT_JOB'
 * @param {string} [entry.jobId] รหัสงาน
 * @param {'info'|'success'|'warning'|'error'} [entry.status='info'] สถานะ
 * @param {number} [entry.dwellMinutes] เวลาที่ใช้ในขั้นตอนนี้ (นาที)
 * @param {string} [entry.timeSpent] ข้อความสรุปเวลา เช่น 'เวลาในขั้นตอนนี้ 22 นาที'
 * @param {string|Object} [entry.items] สิ่งของหรือเงินที่เคลื่อนไหวในขั้นตอนนี้
 * @param {Object} [entry.details] รายละเอียดเพิ่มเติม
 * @param {string} [entry.error] ข้อความแจ้งเตือนข้อผิดพลาด
 */
export async function logAgentActivity({
  agentId,
  agentName,
  actorName,
  step,
  stepName,
  action,
  jobId = null,
  status = 'info',
  dwellMinutes = null,
  timeSpent = null,
  items = null,
  details = {},
  error = null,
}) {
  const role = Object.values(AGENT_ROLES).find(r => r.id === agentId) || { name: agentId, color: '#64748b' };
  const resolvedStepName = stepName || STEP_NAMES[step] || `ขั้นตอนที่ ${step}`;
  const resolvedActor = actorName || agentName || (agentId === 'agent-4-qc' ? 'คุณวิชัย ตรวจการ (QC-01)' : role.name);

  const payload = {
    timestamp: new Date().toISOString(),
    agentId,
    agentName: agentName || role.name,
    actorName: resolvedActor,
    agentColor: role.color,
    step: Number(step) || 0,
    stepName: resolvedStepName,
    action,
    jobId: jobId || '(ไม่ระบุ)',
    status,
    dwellMinutes: dwellMinutes !== null ? Number(dwellMinutes) : (details?.dwellMinutes ?? null),
    timeSpent: timeSpent || details?.timeSpent || (dwellMinutes ? `ใช้เวลา ${dwellMinutes} นาที` : null),
    items: items || details?.items || null,
    details,
    error: error ? String(error) : null,
  };

  // 1. ส่งผ่าน BroadcastChannel ทันที (0ms Local Event Bus)
  if (auditChannel) {
    try {
      auditChannel.postMessage(payload);
    } catch (e) {
      console.warn('BroadcastChannel error:', e);
    }
  }

  // 2. Dispatch Local Window Custom Event
  try {
    window.dispatchEvent(new CustomEvent('rakbaan:audit-log', { detail: payload }));
  } catch (e) {}

  // 3. บันทึกลงใน Console เพื่อ Debug ทันที
  const badgeStyle = `background: ${role.color}; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;`;
  console.log(`%c[${payload.agentName}]%c [Step ${step}] ${action}`, badgeStyle, 'color: #0f172a; font-weight: bold;', payload);

  // 4. บันทึกลง Firestore คอลเลกชัน audit_logs (Persistent Cloud Audit)
  try {
    await addDoc(collection(db, 'audit_logs'), payload);
  } catch (err) {
    // ถ้า offline หรือติดสิทธิ์ ให้ log ไว้ใน console
    console.warn('[AuditLogger] Firestore audit write notice:', err.message);
  }

  return payload;
}

/**
 * สับสไครบ์รับ Audit Logs แบบสดๆ
 * @param {function(Object): void} onLogCallback 
 * @returns {function(): void} unsubscribe
 */
export function subscribeToAuditLogs(onLogCallback) {
  const seenLogs = new Set();
  const emitOnce = (data) => {
    if (!data) return;
    const key = `${data.timestamp || ''}_${data.agentId || ''}_${data.step || ''}_${data.action || ''}`;
    if (seenLogs.has(key)) return;
    seenLogs.add(key);
    if (seenLogs.size > 200) {
      const first = seenLogs.values().next().value;
      seenLogs.delete(first);
    }
    onLogCallback(data);
  };

  // 1. รับจาก BroadcastChannel (Instant Local จาก iframes และ tabs อื่น)
  const channelHandler = (event) => {
    if (event.data) emitOnce(event.data);
  };

  if (auditChannel) {
    auditChannel.addEventListener('message', channelHandler);
  }

  // 2. รับจาก Window CustomEvent (กรณี log เกิดใน window เดียวกัน เช่น Cockpit simulation)
  const windowHandler = (event) => {
    if (event.detail) emitOnce(event.detail);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('rakbaan:audit-log', windowHandler);
  }

  // 3. รับจาก Firestore (Persistent History & Multi-browser)
  let unsubscribeFirestore = null;
  try {
    const q = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(50));
    unsubscribeFirestore = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          emitOnce({ id: change.doc.id, ...change.doc.data() });
        }
      });
    }, (err) => {
      console.warn('[AuditLogger] Firestore subscribe warning:', err.message);
    });
  } catch (err) {
    console.warn('[AuditLogger] Firestore query init warning:', err.message);
  }

  return () => {
    if (auditChannel) {
      auditChannel.removeEventListener('message', channelHandler);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('rakbaan:audit-log', windowHandler);
    }
    if (unsubscribeFirestore) {
      unsubscribeFirestore();
    }
  };
}
