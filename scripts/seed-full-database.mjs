import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.join(__dirname, '..', 'service-account-key.json');
const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const T = admin.firestore.Timestamp;
const ts = (s) => T.fromDate(new Date(s));

const U1 = 'BOifBMGDGgW9zMvh1XRNcxMVRGz1';
const U2 = 'cust-somying-002';
const TECH1 = 'tech-somchai-001';
const TECH2 = 'tech-wichai-002';
const FOREMAN1 = 'foreman-anan-001';

async function main() {
  const batch = db.batch();
  const set = (ref, data) => batch.set(ref, data);

  set(db.collection('users').doc(U1), {
    role: 'customer', fullName: 'สมชาย ใจดี', phone: '081-234-5671', email: 'somchai@example.com',
    idCardMasked: '', avatarUrl: '', isVerified: false, createdAt: ts('2026-07-20T09:00:00+07:00'),
    recordStatus: 0, lastActorId: U1, lastActorType: 'customer',
  });
  set(db.collection('users').doc(U2), {
    role: 'customer', fullName: 'สมหญิง รักบ้าน', phone: '081-234-5672', email: 'somying@example.com',
    idCardMasked: '', avatarUrl: '', isVerified: false, createdAt: ts('2026-07-22T10:00:00+07:00'),
    recordStatus: 0, lastActorId: U2, lastActorType: 'customer',
  });
  set(db.collection('users').doc(TECH1), {
    role: 'technician', fullName: 'ช่างสมชาย เก่งกาจ', phone: '089-111-2221', email: 'tech.somchai@rakbaan.internal',
    idCardMasked: '1-2345-XXXXX-67-8', avatarUrl: '', isVerified: true, createdAt: ts('2026-06-01T09:00:00+07:00'),
    recordStatus: 0, lastActorId: FOREMAN1, lastActorType: 'team',
  });
  set(db.collection('users').doc(TECH2), {
    role: 'technician', fullName: 'ช่างวิชัย ไฟฟ้าดี', phone: '089-111-2222', email: 'tech.wichai@rakbaan.internal',
    idCardMasked: '1-2345-XXXXX-89-0', avatarUrl: '', isVerified: true, createdAt: ts('2026-06-05T09:00:00+07:00'),
    recordStatus: 0, lastActorId: FOREMAN1, lastActorType: 'team',
  });
  set(db.collection('users').doc(FOREMAN1), {
    role: 'foreman', fullName: 'หัวหน้าช่างอนันต์', phone: '089-111-2223', email: 'foreman.anan@rakbaan.internal',
    idCardMasked: '1-2345-XXXXX-11-2', avatarUrl: '', isVerified: true, createdAt: ts('2026-05-01T09:00:00+07:00'),
    recordStatus: 0, lastActorId: FOREMAN1, lastActorType: 'team',
  });

  const ADDR = { home1: 'addr-u1-home', condo1: 'addr-u1-condo', parents1: 'addr-u1-parents', home2: 'addr-u2-home', shop2: 'addr-u2-shop' };
  set(db.collection('addresses').doc(ADDR.home1), { userId: U1, label: 'บ้านหลัก', recipientName: 'สมชาย ใจดี', phone: '081-234-5671', addressDetail: '99/1 ถ.นิมมานเหมินท์ ต.สุเทพ อ.เมือง เชียงใหม่ 50200', lat: 18.7969, lng: 98.9678, isDefault: true, recordStatus: 0, lastActorId: U1, lastActorType: 'customer' });
  set(db.collection('addresses').doc(ADDR.condo1), { userId: U1, label: 'คอนโด', recipientName: 'สมชาย ใจดี', phone: '081-234-5671', addressDetail: 'ดิ แอสตร้า คอนโด ห้อง 12B ถ.ห้วยแก้ว เชียงใหม่ 50200', lat: 18.8067, lng: 98.9578, isDefault: false, recordStatus: 0, lastActorId: U1, lastActorType: 'customer' });
  set(db.collection('addresses').doc(ADDR.parents1), { userId: U1, label: 'บ้านพ่อแม่', recipientName: 'สมศรี ใจดี', phone: '081-234-9999', addressDetail: '45 หมู่ 3 ต.แม่เหียะ อ.เมือง เชียงใหม่ 50100', lat: 18.7501, lng: 98.9397, isDefault: false, recordStatus: 0, lastActorId: U1, lastActorType: 'customer' });
  set(db.collection('addresses').doc(ADDR.home2), { userId: U2, label: 'บ้านพักอาศัย', recipientName: 'สมหญิง รักบ้าน', phone: '081-234-5672', addressDetail: '12 ถ.สันทราย ต.สันทรายหลวง อ.สันทราย เชียงใหม่ 50210', lat: 18.8823, lng: 99.0064, isDefault: true, recordStatus: 0, lastActorId: U2, lastActorType: 'customer' });
  set(db.collection('addresses').doc(ADDR.shop2), { userId: U2, label: 'ร้านค้า', recipientName: 'สมหญิง รักบ้าน', phone: '081-234-5672', addressDetail: '8 ถ.ช้างคลาน ต.ช้างคลาน อ.เมือง เชียงใหม่ 50100', lat: 18.7797, lng: 98.9917, isDefault: false, recordStatus: 0, lastActorId: U2, lastActorType: 'customer' });

  const JOB1 = 'job-seed-u1-active-construction';
  const JOB2 = 'job-seed-u1-completed-repair';
  const JOB3 = 'job-seed-u2-pending';
  const JOB4 = 'job-seed-u2-assigned';
  const JOB5 = 'job-seed-u2-traveling';

  set(db.collection('jobs').doc(JOB1), { customerId: U1, customerName: 'สมชาย ใจดี', category: 'roof_structure', title: 'ต่อเติมหลังคาโรงรถ + เดินระบบไฟใหม่', jobType: 'construction', addressId: ADDR.home1, assignedTeamId: TECH1, status: 'in_progress', escrowStatus: 'holding', createdAt: ts('2026-08-01T08:30:00+07:00'), recordStatus: 0, lastActorId: FOREMAN1, lastActorType: 'team' });
  set(db.collection('jobs').doc(JOB2), { customerId: U1, customerName: 'สมชาย ใจดี', category: 'plumbing', title: 'ก๊อกน้ำห้องครัวรั่ว', jobType: 'repair', addressId: ADDR.home1, assignedTeamId: TECH2, status: 'completed', escrowStatus: 'released', createdAt: ts('2026-07-28T10:00:00+07:00'), recordStatus: 0, lastActorId: TECH2, lastActorType: 'team' });
  set(db.collection('jobs').doc(JOB3), { customerId: U2, customerName: 'สมหญิง รักบ้าน', category: 'electrical', title: 'ปลั๊กไฟห้องนั่งเล่นไม่มีไฟ', jobType: 'repair', addressId: ADDR.home2, assignedTeamId: null, status: 'pending_review', escrowStatus: null, createdAt: ts('2026-08-11T14:00:00+07:00'), recordStatus: 0, lastActorId: U2, lastActorType: 'customer' });
  set(db.collection('jobs').doc(JOB4), { customerId: U2, customerName: 'สมหญิง รักบ้าน', category: 'air_con', title: 'แอร์ไม่เย็น มีเสียงดังผิดปกติ', jobType: 'repair', addressId: ADDR.shop2, assignedTeamId: TECH1, status: 'assigned', escrowStatus: 'holding', createdAt: ts('2026-08-10T09:00:00+07:00'), recordStatus: 0, lastActorId: FOREMAN1, lastActorType: 'team' });
  set(db.collection('jobs').doc(JOB5), { customerId: U2, customerName: 'สมหญิง รักบ้าน', category: 'door_window', title: 'บานเลื่อนหน้าต่างเลื่อนไม่ลื่น มีเสียงลั่น', jobType: 'repair', addressId: ADDR.home2, assignedTeamId: TECH2, status: 'traveling', escrowStatus: 'holding', createdAt: ts('2026-08-12T07:00:00+07:00'), recordStatus: 0, lastActorId: TECH2, lastActorType: 'team' });

  const historyEntries = [
    { status: 'pending_review', title: 'รับเรื่องแล้ว', timestamp: ts('2026-08-01T08:30:00+07:00') },
    { status: 'assigned', title: 'มอบหมายทีมช่าง', timestamp: ts('2026-08-02T09:00:00+07:00') },
    { status: 'traveling', title: 'กำลังเดินทาง', timestamp: ts('2026-08-03T08:00:00+07:00') },
    { status: 'in_progress', title: 'กำลังซ่อม', timestamp: ts('2026-08-03T09:30:00+07:00') },
    { status: 'in_progress', title: 'อัปเดต: เดินระบบไฟเสร็จงวด 2', timestamp: ts('2026-08-10T16:00:00+07:00') },
  ];
  historyEntries.forEach((h, i) => set(db.collection('jobs').doc(JOB1).collection('status_history').doc('hist-' + (i + 1)), Object.assign({ jobId: JOB1 }, h)));

  const PRICE_ITEMS = ['pl-cement-01', 'pl-steel-01', 'pl-labor-mason', 'pl-labor-electrician', 'pl-roof-sheet'];
  const boqRows = [
    { itemName: 'ปูนซีเมนต์ปอร์ตแลนด์ 50 กก.', quantity: 20, totalPrice: 3800 },
    { itemName: 'เหล็กกล่อง 2 นิ้ว', quantity: 30, totalPrice: 9000 },
    { itemName: 'ค่าแรงช่างปูน', quantity: 5, totalPrice: 7500 },
    { itemName: 'ค่าแรงช่างไฟ', quantity: 3, totalPrice: 4500 },
    { itemName: 'แผ่นหลังคาเมทัลชีท', quantity: 15, totalPrice: 12750 },
  ];
  boqRows.forEach((row, i) => set(db.collection('jobs').doc(JOB1).collection('boq_items').doc('boq-' + (i + 1)), Object.assign({ jobId: JOB1, priceListId: PRICE_ITEMS[i] }, row, { recordStatus: 0, lastActorId: FOREMAN1, lastActorType: 'team' })));

  const milestoneRows = [
    { sequence: 1, title: 'งวด 1: รื้อถอนหลังคาเดิม', amount: 15000, status: 'paid', dueDate: ts('2026-08-04T00:00:00+07:00'), completedAt: ts('2026-08-03T17:00:00+07:00'), approvedAt: ts('2026-08-04T09:00:00+07:00') },
    { sequence: 2, title: 'งวด 2: เดินระบบไฟใหม่', amount: 20000, status: 'approved', dueDate: ts('2026-08-11T00:00:00+07:00'), completedAt: ts('2026-08-10T16:00:00+07:00'), approvedAt: ts('2026-08-11T08:00:00+07:00') },
    { sequence: 3, title: 'งวด 3: มุงหลังคาเมทัลชีท', amount: 25000, status: 'in_progress', dueDate: ts('2026-08-18T00:00:00+07:00'), completedAt: null, approvedAt: null },
    { sequence: 4, title: 'งวด 4: ทาสี+เก็บงาน', amount: 10000, status: 'pending', dueDate: ts('2026-08-24T00:00:00+07:00'), completedAt: null, approvedAt: null },
    { sequence: 5, title: 'งวด 5: ตรวจรับงานสุดท้าย', amount: 5000, status: 'pending', dueDate: ts('2026-08-28T00:00:00+07:00'), completedAt: null, approvedAt: null },
  ];
  const milestoneIds = milestoneRows.map((_, i) => 'milestone-' + (i + 1));
  milestoneRows.forEach((row, i) => set(db.collection('jobs').doc(JOB1).collection('milestones').doc(milestoneIds[i]), Object.assign({ jobId: JOB1, description: '', escrowTransactionId: null }, row, { recordStatus: 0, lastActorId: FOREMAN1, lastActorType: 'team' })));

  const photoRows = [
    { uploadedBy: U1, uploaderType: 'customer', photoType: 'damage_report', relatedMilestoneId: null },
    { uploadedBy: TECH1, uploaderType: 'technician', photoType: 'before', relatedMilestoneId: null },
    { uploadedBy: TECH1, uploaderType: 'technician', photoType: 'progress_update', relatedMilestoneId: milestoneIds[0] },
    { uploadedBy: TECH1, uploaderType: 'technician', photoType: 'progress_update', relatedMilestoneId: milestoneIds[1] },
    { uploadedBy: TECH1, uploaderType: 'technician', photoType: 'after', relatedMilestoneId: null },
  ];
  photoRows.forEach((row, i) => set(db.collection('jobs').doc(JOB1).collection('photos').doc('photo-' + (i + 1)), Object.assign({ jobId: JOB1, storageUrl: 'https://storage.example.com/rakbaan-cnx/seed/' + JOB1 + '/photo-' + (i + 1) + '.jpg', aiVisionResult: null, createdAt: ts('2026-08-0' + ((i % 9) + 1) + 'T12:00:00+07:00') }, row, { recordStatus: 0, lastActorId: row.uploadedBy, lastActorType: row.uploaderType })));

  const priceListRows = [
    { itemId: 'pl-cement-01', category: 'material', subCategory: 'construction', itemName: 'ปูนซีเมนต์ปอร์ตแลนด์ 50 กก.', unit: 'ถุง', unitCost: 190 },
    { itemId: 'pl-steel-01', category: 'material', subCategory: 'construction', itemName: 'เหล็กกล่อง 2 นิ้ว', unit: 'เส้น', unitCost: 300 },
    { itemId: 'pl-labor-mason', category: 'labor', subCategory: 'construction', itemName: 'ค่าแรงช่างปูน', unit: 'วัน', unitCost: 1500 },
    { itemId: 'pl-labor-electrician', category: 'labor', subCategory: 'electrical', itemName: 'ค่าแรงช่างไฟ', unit: 'วัน', unitCost: 1500 },
    { itemId: 'pl-roof-sheet', category: 'material', subCategory: 'roof_structure', itemName: 'แผ่นหลังคาเมทัลชีท', unit: 'แผ่น', unitCost: 850 },
  ];
  priceListRows.forEach((row) => set(db.collection('price_lists').doc(row.itemId), Object.assign({}, row, { source: 'สำนักงานพาณิชย์จังหวัดเชียงใหม่', updatedAt: ts('2026-07-01T00:00:00+07:00') })));

  const membershipRows = [
    { userId: U1, packageCode: 'HOMECARE-BASIC', status: 'active', expiryDate: ts('2027-07-20T00:00:00+07:00') },
    { userId: U2, packageCode: 'HOMECARE-PLUS', status: 'active', expiryDate: ts('2027-07-22T00:00:00+07:00') },
    { userId: U1, packageCode: 'HOMECARE-BASIC', status: 'expired', expiryDate: ts('2026-01-01T00:00:00+07:00') },
    { userId: U2, packageCode: 'HOMECARE-BASIC', status: 'expired', expiryDate: ts('2025-12-31T00:00:00+07:00') },
    { userId: U1, packageCode: 'HOMECARE-PREMIUM', status: 'active', expiryDate: ts('2027-12-31T00:00:00+07:00') },
  ];
  membershipRows.forEach((row, i) => set(db.collection('memberships').doc('membership-' + (i + 1)), Object.assign({}, row, { recordStatus: 0, lastActorId: row.userId, lastActorType: 'customer' })));

  const reviewRows = [
    { jobId: JOB2, customerId: U1, technicianId: TECH2, raterRole: 'customer', rating: 5, tags: ['ตรงต่อเวลา', 'งานเรียบร้อย'], comment: 'ช่างมาตรงเวลา ซ่อมเรียบร้อยดีมากค่ะ' },
    { jobId: JOB2, customerId: U1, technicianId: TECH2, raterRole: 'technician', rating: 5, tags: ['ให้ความร่วมมือดี', 'จ่ายตรงเวลา'], comment: 'ลูกค้าน่ารัก ให้ความร่วมมือดีครับ' },
    { jobId: JOB4, customerId: U2, technicianId: TECH1, raterRole: 'customer', rating: 4, tags: ['สุภาพ'], comment: 'ช่างสุภาพดี แต่มาช้ากว่านัดเล็กน้อย' },
    { jobId: JOB5, customerId: U2, technicianId: TECH2, raterRole: 'customer', rating: 3, tags: [], comment: 'ยังไม่เสร็จงาน รอประเมินอีกครั้ง' },
    { jobId: JOB1, customerId: U1, technicianId: TECH1, raterRole: 'technician', rating: 5, tags: ['จ่ายตรงเวลา'], comment: 'ลูกค้าจ่ายเงินตรงงวดดีครับ' },
  ];
  reviewRows.forEach((row) => set(db.collection('reviews').doc(row.jobId + '_' + row.raterRole), Object.assign({}, row, { createdAt: ts('2026-08-05T18:00:00+07:00'), recordStatus: 0, lastActorId: row.raterRole === 'customer' ? row.customerId : row.technicianId, lastActorType: row.raterRole })));

  const notificationRows = [
    { userId: U1, title: 'ทีมช่างกำลังเดินทาง', body: 'ช่างสมชายกำลังเดินทางไปยังที่อยู่ของคุณ', type: 'job_update', isRead: true },
    { userId: U1, title: 'งวดงานที่ 2 เสร็จแล้ว', body: 'กรุณายืนยันรับงวดงาน เดินระบบไฟใหม่', type: 'job_update', isRead: false },
    { userId: U2, title: 'รับเรื่องแจ้งซ่อมแล้ว', body: 'ทีมงานได้รับเรื่องแจ้งซ่อมของคุณแล้ว กำลังจัดหาช่าง', type: 'job_update', isRead: true },
    { userId: U2, title: 'โปรโมชั่นใหม่', body: 'รับส่วนลด 10% สำหรับงานซ่อมแอร์เดือนนี้', type: 'promotion', isRead: false },
    { userId: U1, title: 'ระบบปรับปรุงเวอร์ชันใหม่', body: 'เวอร์ชันใหม่มีฟีเจอร์ติดตามงวดงานก่อสร้าง', type: 'system', isRead: false },
  ];
  notificationRows.forEach((row, i) => set(db.collection('notifications').doc('notif-' + (i + 1)), Object.assign({}, row, { createdAt: ts('2026-08-10T12:00:00+07:00'), recordStatus: 0, lastActorId: FOREMAN1, lastActorType: 'team' })));

  const disputeRows = [
    { jobId: JOB2, raisedBy: U1, reason: 'ค่าใช้จ่ายเกินจากที่แจ้งไว้ตอนแรก', status: 'resolved', resolutionNotes: 'ทีมงานคืนส่วนต่าง 200 บาทให้ลูกค้าแล้ว' },
    { jobId: JOB4, raisedBy: U2, reason: 'ช่างมาช้ากว่านัด 2 ชั่วโมง', status: 'investigating', resolutionNotes: '' },
    { jobId: JOB5, raisedBy: U2, reason: 'สงสัยว่าอะไหล่ที่เปลี่ยนไม่ตรงตามที่ตกลง', status: 'open', resolutionNotes: '' },
    { jobId: JOB1, raisedBy: U1, reason: 'สอบถามความคืบหน้างวดที่ 3 ล่าช้ากว่ากำหนด', status: 'open', resolutionNotes: '' },
    { jobId: JOB3, raisedBy: U2, reason: 'ยกเลิกงานเพราะเปลี่ยนใจ', status: 'resolved', resolutionNotes: 'ปิดเคสตามคำขอลูกค้า ไม่มีค่าใช้จ่าย' },
  ];
  disputeRows.forEach((row, i) => set(db.collection('disputes').doc('dispute-' + (i + 1)), Object.assign({}, row, { createdAt: ts('2026-08-09T15:00:00+07:00'), recordStatus: 0, lastActorId: FOREMAN1, lastActorType: 'team' })));

  const costCodeRows = [
    { codeId: 'cc-material', category: 'material', description: 'ต้นทุนวัสดุ', isTaxable: true },
    { codeId: 'cc-labor', category: 'labor', description: 'ต้นทุนค่าแรง', isTaxable: true },
    { codeId: 'cc-platform-fee', category: 'fee', description: 'ค่าธรรมเนียม Payment Gateway', isTaxable: false },
    { codeId: 'cc-platform-revenue', category: 'revenue', description: 'รายได้ส่วนแบ่งแพลตฟอร์ม', isTaxable: true },
    { codeId: 'cc-membership', category: 'revenue', description: 'รายได้ค่าสมาชิก Home Care', isTaxable: true },
  ];
  costCodeRows.forEach((row) => set(db.collection('cost_codes').doc(row.codeId), Object.assign({}, row, { updatedAt: ts('2026-07-01T00:00:00+07:00') })));

  const promoRows = [
    { promoId: 'promo-cnxhome10', code: 'CNXHOME10', discountType: 'percentage', value: 10, usageLimit: 500 },
    { promoId: 'promo-newuser100', code: 'NEWUSER100', discountType: 'fixed', value: 100, usageLimit: 1000 },
    { promoId: 'promo-aircon15', code: 'AIRCON15', discountType: 'percentage', value: 15, usageLimit: 200 },
    { promoId: 'promo-referral50', code: 'REFERRAL50', discountType: 'fixed', value: 50, usageLimit: 2000 },
    { promoId: 'promo-rainyseason', code: 'RAINYSEASON', discountType: 'percentage', value: 20, usageLimit: 300 },
  ];
  promoRows.forEach((row) => set(db.collection('promotions').doc(row.promoId), Object.assign({}, row, { startDate: ts('2026-08-01T00:00:00+07:00'), expiryDate: ts('2026-09-30T00:00:00+07:00'), updatedAt: ts('2026-08-01T00:00:00+07:00') })));

  const consentRows = [
    { userId: U1, marketingConsent: true, ipAddress: '203.0.113.10' },
    { userId: U2, marketingConsent: false, ipAddress: '203.0.113.11' },
    { userId: TECH1, marketingConsent: true, ipAddress: '203.0.113.12' },
    { userId: TECH2, marketingConsent: true, ipAddress: '203.0.113.13' },
    { userId: FOREMAN1, marketingConsent: false, ipAddress: '203.0.113.14' },
  ];
  consentRows.forEach((row, i) => set(db.collection('consent_logs').doc('consent-' + (i + 1)), Object.assign({}, row, { policyVersion: 'v1.0', timestamp: ts('2026-07-20T09:05:00+07:00') })));

  const activityRows = [
    { userId: U1, actionType: 'view_screen', targetName: 'home_screen', durationSeconds: 45 },
    { userId: U1, actionType: 'view_screen', targetName: 'tracking_screen', durationSeconds: 120 },
    { userId: U2, actionType: 'click_item', targetName: 'report_job_button', durationSeconds: 5 },
    { userId: U2, actionType: 'search', targetName: 'ช่างแอร์ใกล้ฉัน', durationSeconds: 15 },
    { userId: TECH1, actionType: 'view_screen', targetName: 'ops_portal_dashboard', durationSeconds: 300 },
  ];
  activityRows.forEach((row, i) => set(db.collection('user_activity_logs').doc('activity-' + (i + 1)), Object.assign({}, row, { timestampIn: ts('2026-08-11T09:00:00+07:00'), timestampOut: ts('2026-08-11T09:05:00+07:00') })));

  const escrowRows = [
    { jobId: JOB1, customerId: U1, milestoneId: milestoneIds[0], status: 'released', releaseReason: 'milestone_approved', amount: 15000 },
    { jobId: JOB1, customerId: U1, milestoneId: milestoneIds[1], status: 'holding', releaseReason: null, amount: 20000 },
    { jobId: JOB2, customerId: U1, milestoneId: null, status: 'released', releaseReason: 'job_completed', amount: 800 },
    { jobId: JOB3, customerId: U2, milestoneId: null, status: 'pending', releaseReason: null, amount: 0 },
    { jobId: JOB4, customerId: U2, milestoneId: null, status: 'refunded', releaseReason: 'dispute_resolved', amount: 1500 },
  ];
  escrowRows.forEach((row, i) => set(db.collection('escrow_transactions').doc('escrow-' + (i + 1)), Object.assign({}, row, { pgProvider: 'opn', pgTransactionId: 'opn-txn-' + (1000 + i), paymentMethod: 'promptpay', platformFee: Math.round(row.amount * 0.0165), heldAt: ts('2026-08-03T10:00:00+07:00'), releasedAt: row.status === 'released' ? ts('2026-08-04T10:00:00+07:00') : null, refundedAt: row.status === 'refunded' ? ts('2026-08-11T10:00:00+07:00') : null, createdAt: ts('2026-08-03T09:00:00+07:00'), recordStatus: 0, lastActorId: FOREMAN1, lastActorType: 'team' })));

  const revenueRows = [
    { jobId: JOB1, codeId: 'cc-platform-revenue', grossAmount: 15000, platformRevenue: 1500, vatAmount: 105 },
    { jobId: JOB2, codeId: 'cc-platform-revenue', grossAmount: 800, platformRevenue: 80, vatAmount: 5.6 },
    { jobId: JOB1, codeId: 'cc-membership', grossAmount: 1200, platformRevenue: 1200, vatAmount: 84 },
    { jobId: JOB4, codeId: 'cc-platform-revenue', grossAmount: 1500, platformRevenue: 150, vatAmount: 10.5 },
    { jobId: JOB5, codeId: 'cc-platform-revenue', grossAmount: 900, platformRevenue: 90, vatAmount: 6.3 },
  ];
  revenueRows.forEach((row, i) => set(db.collection('revenue_transactions').doc('revenue-' + (i + 1)), Object.assign({}, row, { timestamp: ts('2026-08-04T11:00:00+07:00') })));

  const sessionRows = [
    { userId: U1, status: 'closed', relatedJobId: JOB1 },
    { userId: U1, status: 'closed', relatedJobId: JOB2 },
    { userId: U2, status: 'active', relatedJobId: JOB3 },
    { userId: U2, status: 'escalated_to_human', relatedJobId: null },
    { userId: U1, status: 'closed', relatedJobId: null },
  ];
  sessionRows.forEach((row, i) => set(db.collection('chat_sessions').doc('chat-' + (i + 1)), Object.assign({}, row, { startedAt: ts('2026-08-01T08:00:00+07:00'), lastMessageAt: ts('2026-08-01T08:10:00+07:00'), recordStatus: 0, lastActorId: row.userId, lastActorType: 'customer' })));
  const messageRows = [
    { role: 'user', content: 'หลังคาโรงรถรั่ว ต้องทำยังไงบ้างคะ', flaggedOutOfScope: false },
    { role: 'assistant', content: 'สวัสดีค่ะ มะลิแนะนำให้แจ้งซ่อมหมวดหลังคา-โครงสร้างเลยนะคะ จะได้ให้ทีมช่างประเมินหน้างานค่ะ', flaggedOutOfScope: false },
    { role: 'user', content: 'ประเมินราคาคร่าวๆได้ไหมคะ', flaggedOutOfScope: false },
    { role: 'assistant', content: 'ราคาคร่าวๆขึ้นกับขนาดพื้นที่และความเสียหายค่ะ ทีมช่างจะให้ใบเสนอราคาหลังลงพื้นที่ตรวจสอบนะคะ', flaggedOutOfScope: false },
    { role: 'user', content: 'ขอบคุณค่ะ', flaggedOutOfScope: false },
  ];
  messageRows.forEach((row, i) => set(db.collection('chat_sessions').doc('chat-1').collection('messages').doc('msg-' + (i + 1)), Object.assign({ sessionId: 'chat-1' }, row, { timestamp: ts('2026-08-01T08:0' + i + ':00+07:00') })));

  const auditRows = [
    { actorId: FOREMAN1, actorRole: 'team', action: 'read', targetCollection: 'users', targetDocId: U1, targetUserId: U1, details: 'ดูข้อมูลลูกค้าเพื่อมอบหมายงาน' },
    { actorId: FOREMAN1, actorRole: 'team', action: 'read', targetCollection: 'jobs', targetDocId: JOB1, targetUserId: U1, details: 'ตรวจสอบรายละเอียดงาน' },
    { actorId: TECH1, actorRole: 'team', action: 'read', targetCollection: 'addresses', targetDocId: ADDR.home1, targetUserId: U1, details: 'ดูที่อยู่ก่อนเดินทาง' },
    { actorId: FOREMAN1, actorRole: 'admin', action: 'export', targetCollection: 'users', targetDocId: U2, targetUserId: U2, details: 'export ข้อมูลตามคำขอ Data Subject Right' },
    { actorId: FOREMAN1, actorRole: 'team', action: 'read', targetCollection: 'disputes', targetDocId: 'dispute-2', targetUserId: U2, details: 'ตรวจสอบข้อพิพาทที่เปิดอยู่' },
  ];
  auditRows.forEach((row, i) => set(db.collection('audit_logs').doc('audit-' + (i + 1)), Object.assign({}, row, { ipAddress: '203.0.113.50', timestamp: ts('2026-08-11T13:00:00+07:00') })));

  const editLogRows = [
    { targetCollection: 'jobs', targetDocId: JOB1, actorId: FOREMAN1, actorType: 'team', actionType: 'UPDATE', previousStatus: 0, newStatus: 0 },
    { targetCollection: 'jobs', targetDocId: JOB4, actorId: FOREMAN1, actorType: 'team', actionType: 'UPDATE', previousStatus: 0, newStatus: 0 },
    { targetCollection: 'reviews', targetDocId: JOB2 + '_customer', actorId: U1, actorType: 'customer', actionType: 'CREATE', previousStatus: 0, newStatus: 0 },
    { targetCollection: 'addresses', targetDocId: ADDR.parents1, actorId: U1, actorType: 'customer', actionType: 'DELETE', previousStatus: 0, newStatus: 3 },
    { targetCollection: 'addresses', targetDocId: ADDR.parents1, actorId: FOREMAN1, actorType: 'team', actionType: 'RESTORE', previousStatus: 3, newStatus: 0 },
  ];
  editLogRows.forEach((row, i) => set(db.collection('database_edit_log').doc('edit-' + (i + 1)), Object.assign({}, row, { reason: row.actionType === 'DELETE' ? 'ลูกค้าลบที่อยู่นี้เอง' : (row.actionType === 'RESTORE' ? 'กู้คืนตามคำขอลูกค้า' : null), timestamp: ts('2026-08-11T14:00:00+07:00') })));

  await batch.commit();
  console.log('SEED_OK');
  console.log('JOB1(active/construction, tablet-visible)=' + JOB1);
  console.log('JOB2(completed, tablet-visible history)=' + JOB2);
}

main().catch((e) => { console.error(e); process.exit(1); });
