import sys
import requests
import json
import time
from datetime import datetime, timedelta

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

print("=" * 75)
print("🏠 รักบ้าน@CNX — การจำลองติดตามกระบวนการงานซ่อม 10 ขั้นตอน (End-to-End Service Journey)")
print("⏱️ ปรัชญา MVP: 'เวลาคือสิ่งล้ำค่ามากกว่าเงิน'")
print("🔍 ผู้ตรวจ QC: ระบุชื่อคนจริง 100% [คุณวิชัย ตรวจการ (QC-01)]")
print("=" * 75)

# 1. Sign in anonymously to get Firebase Auth token
print("\n🔐 กำลังตรวจสอบสิทธิ์และเชื่อมต่อ Firebase Auth...")
auth_url = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=AIzaSyAzQILf3Ib1fARM-UtGycbehUJ1W4-QfU0'
auth_res = requests.post(auth_url, json={'returnSecureToken': True})
auth_data = auth_res.json()
token = auth_data.get('idToken')
if not token:
    raise RuntimeError("Failed to authenticate anonymously")

headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
base_fs_url = 'https://firestore.googleapis.com/v1/projects/rakbaan-cnx/databases/(default)/documents'
print("✅ เชื่อมต่อฐานข้อมูล Cloud Firestore สำเร็จ")

def log_audit(agent_id, agent_name, actor_name, step, step_name, action, job_id, status, dwell_mins, time_spent, items, details, agent_color="#64748b"):
    payload = {
        'fields': {
            'timestamp': {'stringValue': datetime.utcnow().isoformat() + 'Z'},
            'agentId': {'stringValue': agent_id},
            'agentName': {'stringValue': agent_name},
            'actorName': {'stringValue': actor_name},
            'agentColor': {'stringValue': agent_color},
            'step': {'integerValue': str(step)},
            'stepName': {'stringValue': step_name},
            'action': {'stringValue': action},
            'jobId': {'stringValue': str(job_id)},
            'status': {'stringValue': status},
            'dwellMinutes': {'integerValue': str(int(dwell_mins))},
            'timeSpent': {'stringValue': time_spent},
            'items': {'stringValue': items},
            'details': {'stringValue': json.dumps(details, ensure_ascii=False)}
        }
    }
    r = requests.post(f"{base_fs_url}/audit_logs", headers=headers, json=payload)
    return r.status_code == 200

def create_job(job_data):
    fields = {}
    for k, v in job_data.items():
        if isinstance(v, str):
            fields[k] = {'stringValue': v}
        elif isinstance(v, bool):
            fields[k] = {'booleanValue': v}
        elif isinstance(v, (int, float)):
            fields[k] = {'integerValue': str(int(v))}
        elif isinstance(v, dict):
            fields[k] = {'stringValue': json.dumps(v, ensure_ascii=False)}
        elif isinstance(v, list):
            fields[k] = {'stringValue': json.dumps(v, ensure_ascii=False)}
    r = requests.post(f"{base_fs_url}/jobs", headers=headers, json={'fields': fields})
    if r.status_code == 200:
        doc = r.json()
        job_id = doc['name'].split('/')[-1]
        return job_id
    else:
        print("Create job error:", r.text)
        return None

def update_job(job_id, update_data):
    fields = {}
    mask_keys = []
    for k, v in update_data.items():
        mask_keys.append(k)
        if isinstance(v, str):
            fields[k] = {'stringValue': v}
        elif isinstance(v, bool):
            fields[k] = {'booleanValue': v}
        elif isinstance(v, (int, float)):
            fields[k] = {'integerValue': str(int(v))}
        elif isinstance(v, dict):
            fields[k] = {'stringValue': json.dumps(v, ensure_ascii=False)}
        elif isinstance(v, list):
            fields[k] = {'stringValue': json.dumps(v, ensure_ascii=False)}
    mask_query = "&".join([f"updateMask.fieldPaths={k}" for k in mask_keys])
    url = f"{base_fs_url}/jobs/{job_id}?{mask_query}"
    r = requests.patch(url, headers=headers, json={'fields': fields})
    return r.status_code == 200

# -------------------------------------------------------------
# Service Journey 10 Steps Simulation Execution
# -------------------------------------------------------------
print("\n🚀 งานบริการแจ้งซ่อม [RB-JOB-2601] กำลังเริ่มต้นกระบวนการ 10 ขั้นตอน...")

# Baseline Job Data
now = datetime.now()
journey_job_payload = {
    "customerId": "cust_wipha",
    "customerName": "คุณวิภา สุขเจริญ",
    "customerPhone": "089-888-1234",
    "category": "air_con",
    "serviceCode": "AC-CLN-01",
    "title": "ล้างแอร์ทั่วไป (ติดผนัง) + งานด่วนพิเศษ",
    "room": "ห้องนอนใหญ่ (แอร์ไม่เย็น มีกลิ่นอับ)",
    "addressText": "129/4 หมู่บ้านกรีนพาร์ค ต.สันทรายน้อย อ.สันทราย จ.เชียงใหม่",
    "distanceKm": 3.8,
    "travelFee": 0,
    "urgencySla": "urgent",
    "urgencyFee": 150,
    "basePrice": 600,
    "price": 750,
    "carePlus": True,
    "escrowStatus": "pending",
    "status": "pending_review",
    "workflowStep": 1,
    "workflowStatus": "new_booking",
    "createdAt": now.isoformat(),
    "timeMetrics": {
        "responseMinutes": 2,
        "dispatchMinutes": 3,
        "travelMinutes": 22,
        "procurementMinutes": 15,
        "executionMinutes": 40,
        "qcMinutes": 8,
        "totalElapsedMinutes": 0,
        "slaTargetMinutes": 120,
        "slaStatus": "on_track"
    }
}

job_id = create_job(journey_job_payload)
print(f"📦 สร้างใบงานสำเร็จ: รหัสงาน {job_id[:10].upper()} (ID: {job_id})")

# -------------------------------------------------------------
# ขั้นตอนที่ 1: ลูกค้าจ้าง (Step 1: Customer Books)
# -------------------------------------------------------------
print("\n📋 [ขั้นตอนที่ 1] ลูกค้าจ้าง (Customer Books)")
print("   👥 คน: คุณวิภา สุขเจริญ (ลูกค้า)")
print("   📦 สัมภาระ/เงิน: ค่าบริการ ฿750 (ค่าล้าง 600฿ + นัดด่วน 150฿)")
print("   ⏱️ ระยะเวลา: 0 นาที (เริ่มส่งคำขอ)")
log_audit(
    agent_id="agent-1-customer",
    agent_name="Agent-1: ลูกค้า 👤",
    actor_name="คุณวิภา สุขเจริญ",
    step=1,
    step_name="1. ลูกค้าจ้าง (Customer Books)",
    action="CUSTOMER_BOOK_SERVICE",
    job_id=job_id,
    status="success",
    dwell_mins=0,
    time_spent="ส่งคำขอทันที 0 นาที",
    items="คำขอแจ้งซ่อม ล้างแอร์ติดผนัง (฿750)",
    details={"customer": "คุณวิภา สุขเจริญ", "service": "ล้างแอร์ติดผนัง", "sla": "urgent (+150฿)"},
    agent_color="#0284c7"
)
time.sleep(1)

# -------------------------------------------------------------
# ขั้นตอนที่ 2: เราเห็น (Step 2: Ops Acknowledges)
# -------------------------------------------------------------
print("\n📋 [ขั้นตอนที่ 2] เราเห็น (Ops Acknowledges)")
print("   👥 คน: คุณรินรดา (AD-02 แอดมิน OCC ศูนย์ควบคุม)")
print("   📦 สิ่งของ: ตรวจสอบพิกัด GPS สันทรายน้อย 3.8 กม. (ฟรีค่าเดินทาง)")
print("   ⏱️ ระยะเวลา: 2 นาที (เวลาตอบรับฉับไว 🟢)")
update_job(job_id, {
    "workflowStep": 2,
    "workflowStatus": "ops_acknowledged",
    "acknowledgedAt": (now + timedelta(minutes=2)).isoformat(),
    "acknowledgedBy": "คุณรินรดา (AD-02)"
})
log_audit(
    agent_id="agent-3-ops",
    agent_name="Agent-3: แอดมิน Ops 🏛️",
    actor_name="คุณรินรดา (AD-02)",
    step=2,
    step_name="2. เราเห็น (Ops Acknowledges)",
    action="OPS_ACKNOWLEDGE_JOB",
    job_id=job_id,
    status="success",
    dwell_mins=2,
    time_spent="เวลาตอบรับ 2 นาที",
    items="ตรวจสอบหมุด GPS (3.8 กม. ฟรีค่าเดินทาง)",
    details={"dispatcher": "คุณรินรดา (AD-02)", "reactionTime": "2 mins"},
    agent_color="#16a34a"
)
time.sleep(1)

# -------------------------------------------------------------
# ขั้นตอนที่ 3: ส่งช่างรับ (Step 3: Dispatch Pro Tech)
# -------------------------------------------------------------
print("\n📋 [ขั้นตอนที่ 3] ส่งช่างรับ (Dispatch Pro Tech)")
print("   👥 คน: คุณรินรดา ➔ มอบหมาย [RPS-T01] ช่างสมหมาย ใจซื่อ (ช่างแอร์ Top 1)")
print("   📦 สิ่งของ: ใบมอบหมายงานดิจิทัลตรงสาย HVAC")
print("   ⏱️ ระยะเวลา: 3 นาที (จ่ายงานทันที 🟢)")
update_job(job_id, {
    "workflowStep": 3,
    "assignedTeamId": "RPS-T01",
    "assignedTechId": "RPS-T01",
    "assignedTechName": "ช่างสมหมาย ใจซื่อ",
    "assignedTechPhone": "089-123-45xx",
    "status": "assigned",
    "assignedAt": (now + timedelta(minutes=5)).isoformat()
})
log_audit(
    agent_id="agent-3-ops",
    agent_name="Agent-3: แอดมิน Ops 🏛️",
    actor_name="คุณรินรดา (AD-02)",
    step=3,
    step_name="3. ส่งช่างรับ (Dispatch Pro Tech)",
    action="OPS_DISPATCH_TECH",
    job_id=job_id,
    status="success",
    dwell_mins=3,
    time_spent="เวลาจ่ายงาน 3 นาที",
    items="มอบหมายช่างแอร์มือหนึ่ง [RPS-T01] ช่างสมหมาย",
    details={"techId": "RPS-T01", "techName": "ช่างสมหมาย ใจซื่อ", "trade": "air"},
    agent_color="#16a34a"
)
time.sleep(1)

# -------------------------------------------------------------
# ขั้นตอนที่ 4: พักเงิน PPT (Step 4: Escrow Held)
# -------------------------------------------------------------
print("\n📋 [ขั้นตอนที่ 4] พักเงินค่าบริการ PPT (Escrow Held)")
print("   👥 คน: ระบบ RakBaan Escrow Vault")
print("   📦 เงิน: ล็อคยอดมัดจำ 750 บาท ปลอดภัย (ไม่หักเข้าใครจนกว่าจะตรวจรับ)")
print("   ⏱️ ระยะเวลา: 0 นาที (ระบบเงินอัตโนมัติ 🟢)")
update_job(job_id, {
    "workflowStep": 4,
    "escrowStatus": "held_ppt",
    "escrowAmount": 750,
    "escrowHeldAt": (now + timedelta(minutes=5)).isoformat()
})
log_audit(
    agent_id="mali-lead",
    agent_name="น้องมะลิ: แม่ทัพ 👩‍💼",
    actor_name="ระบบ Escrow รักบ้าน",
    step=4,
    step_name="4. พักเงิน PPT (Escrow Held)",
    action="ESCROW_FUNDS_HELD",
    job_id=job_id,
    status="success",
    dwell_mins=0,
    time_spent="อัตโนมัติ 0 นาที",
    items="พักเงินค่าบริการ ฿750 ปลอดภัย",
    details={"amount": 750, "escrow": "PPT Protected"},
    agent_color="#e11d48"
)
time.sleep(1)

# -------------------------------------------------------------
# ขั้นตอนที่ 5: ช่างรับงาน & ออกเดินทาง (Step 5: Tech Accepts & Travel)
# -------------------------------------------------------------
print("\n📋 [ขั้นตอนที่ 5] ช่างรับงาน & ออกเดินทาง (Tech Accepts & Travel)")
print("   👥 คน: [RPS-T01] ช่างสมหมาย ใจซื่อ")
print("   📦 สิ่งของ: สัมภาระเครื่องมือล้างแอร์, ผ้าใบคลุม, ถังน้ำยา R32")
print("   ⏱️ ระยะเวลา: 22 นาที (เวลาเดินทางบนถนนเชียงใหม่ 🟢)")
update_job(job_id, {
    "status": "traveling",
    "workflowStep": 5,
    "workflowStatus": "traveling",
    "techAcceptedAt": (now + timedelta(minutes=7)).isoformat(),
    "travelStartedAt": (now + timedelta(minutes=8)).isoformat(),
    "arrivedAt": (now + timedelta(minutes=30)).isoformat(),
    "travelMinutes": 22
})
log_audit(
    agent_id="agent-2-tech",
    agent_name="Agent-2: ช่าง Pro 🔧",
    actor_name="[RPS-T01] ช่างสมหมาย ใจซื่อ",
    step=5,
    step_name="5. ช่างรับงาน (Tech Accepts & Travel)",
    action="TECH_ACCEPT_AND_TRAVEL",
    job_id=job_id,
    status="success",
    dwell_mins=22,
    time_spent="เวลาเดินทาง 22 นาที",
    items="สัมภาระเครื่องมือช่าง & เช็คอิน GPS ถึงหน้างาน",
    details={"travelDuration": "22 mins", "status": "arrived_on_site"},
    agent_color="#d97706"
)
time.sleep(1)

# -------------------------------------------------------------
# ขั้นตอนที่ 6: เราประสานงาน (Step 6: Coordination & Parts)
# -------------------------------------------------------------
print("\n📋 [ขั้นตอนที่ 6] เราประสานงาน (Ops 3-Way Coordination)")
print("   👥 คน: ช่างสมหมาย & แอดมินคุณรินรดา")
print("   📦 สิ่งของ: ตรวจหน้างาน + เพิ่มท่อน้ำทิ้ง PVC 2 เมตร (฿120 คุณวิภาอนุมัติผ่านแอป)")
print("   ⏱️ ระยะเวลา: 15 นาที (เวลาตรวจหน้างาน & ประสานอะไหล่ 🟢)")
update_job(job_id, {
    "workflowStep": 6,
    "coordination": {
        "partsChecked": True,
        "scheduleConfirmed": True,
        "additionalParts": "ท่อน้ำทิ้ง PVC 2 เมตร (120฿)",
        "customerApproved": True,
        "coordinatedAt": (now + timedelta(minutes=45)).isoformat()
    },
    "procurementMinutes": 15
})
log_audit(
    agent_id="agent-3-ops",
    agent_name="Agent-3: แอดมิน Ops 🏛️",
    actor_name="คุณรินรดา (AD-02) & ช่างสมหมาย",
    step=6,
    step_name="6. เราประสานงาน (Ops 3-Way Coordination)",
    action="OPS_COORDINATE_PARTS",
    job_id=job_id,
    status="success",
    dwell_mins=15,
    time_spent="เวลาประสานอะไหล่ 15 นาที",
    items="ท่อน้ำทิ้ง PVC 2 เมตร (120฿ ได้รับอนุมัติ)",
    details={"parts": "PVC Pipe 2m", "customerApproval": True},
    agent_color="#16a34a"
)
time.sleep(1)

# -------------------------------------------------------------
# ขั้นตอนที่ 7: เราสั่งเริ่มงาน (Step 7: Authorize Start)
# -------------------------------------------------------------
print("\n📋 [ขั้นตอนที่ 7] เราสั่งเริ่มงาน (Ops Authorizes Work)")
print("   👥 คน: คุณรินรดา (แอดมิน OCC ปล่อยไฟเขียว)")
print("   📦 สิ่งของ: สัญญาณเริ่มปฏิบัติการซ่อมบำรุง")
print("   ⏱️ ระยะเวลา: 1 นาที (ปล่อยไฟเขียวทันที 🟢)")
update_job(job_id, {
    "status": "in_progress",
    "workflowStep": 7,
    "workflowStatus": "in_progress",
    "opsAuthorizedAt": (now + timedelta(minutes=46)).isoformat(),
    "workStartedAt": (now + timedelta(minutes=46)).isoformat()
})
log_audit(
    agent_id="agent-3-ops",
    agent_name="Agent-3: แอดมิน Ops 🏛️",
    actor_name="คุณรินรดา (AD-02)",
    step=7,
    step_name="7. เราสั่งเริ่มงาน (Ops Authorizes Work)",
    action="OPS_AUTHORIZE_START_WORK",
    job_id=job_id,
    status="success",
    dwell_mins=1,
    time_spent="เวลาสั่งการ 1 นาที",
    items="คำสั่งอนุมัติเริ่มซ่อม (ไฟเขียว)",
    details={"authorizedBy": "คุณรินรดา (AD-02)"},
    agent_color="#16a34a"
)
time.sleep(1)

# -------------------------------------------------------------
# ขั้นตอนที่ 8: ช่างส่งงาน (Step 8: Tech Submits Photos)
# -------------------------------------------------------------
print("\n📋 [ขั้นตอนที่ 8] ช่างส่งงาน (Tech Submits Photos)")
print("   👥 คน: [RPS-T01] ช่างสมหมาย ใจซื่อ")
print("   📦 สิ่งของ: ล้างแอร์สะอาด 100% + รูปก่อนทำ 2 ภาพ + รูปหลังทำ 2 ภาพ")
print("   ⏱️ ระยะเวลา: 40 นาที (เวลาลงมือซ่อมบำรุงจริง 🟢)")
sample_before = [
    "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=500&auto=format&fit=crop&q=60",
    "https://images.unsplash.com/photo-1585338107529-13afc5f02586?w=500&auto=format&fit=crop&q=60"
]
sample_after = [
    "https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=500&auto=format&fit=crop&q=60",
    "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=500&auto=format&fit=crop&q=60"
]
update_job(job_id, {
    "workflowStep": 8,
    "workflowStatus": "tech_submitted",
    "beforePhotos": sample_before,
    "afterPhotos": sample_after,
    "techNotes": "ล้างคอยล์เย็น คอยล์ร้อน เช็คน้ำยาแอร์ 75 PSI ลมเย็นปกติ 19°C เปลี่ยนท่อน้ำทิ้งใหม่เรียบร้อย",
    "workCompletedAt": (now + timedelta(minutes=86)).isoformat(),
    "executionMinutes": 40
})
log_audit(
    agent_id="agent-2-tech",
    agent_name="Agent-2: ช่าง Pro 🔧",
    actor_name="[RPS-T01] ช่างสมหมาย ใจซื่อ",
    step=8,
    step_name="8. ช่างส่งงาน (Tech Submits Photos)",
    action="TECH_SUBMIT_COMPLETION",
    job_id=job_id,
    status="success",
    dwell_mins=40,
    time_spent="เวลาลงมือซ่อม 40 นาที",
    items="รูปคู่ ก่อนทำ 2 รูป + หลังทำ 2 รูป + วัดลมเย็น 19°C",
    details={"beforeCount": 2, "afterCount": 2, "pressurePSI": 75},
    agent_color="#d97706"
)
time.sleep(1)

# -------------------------------------------------------------
# ขั้นตอนที่ 9: เราตรวจ QC (ผู้ตรวจ QC ชื่อคนจริง 100%!)
# -------------------------------------------------------------
print("\n📋 [ขั้นตอนที่ 9] เราตรวจ QC (Named QC Inspector)")
print("   👥 คน: คุณวิชัย ตรวจการ (QC-01: ผู้ตรวจมาตรฐานงานอาวุโส)")
print("   📦 สิ่งของ: ตรวจสอบรูปภาพคู่ Before/After + มาตรฐาน Senior-First ผ่าน 100%")
print("   ⏱️ ระยะเวลา: 8 นาที (เวลาตรวจ QC ละเอียดลออ 🟢)")
update_job(job_id, {
    "workflowStep": 9,
    "workflowStatus": "customer_review",
    "qcInspector": "คุณวิชัย ตรวจการ (QC-01)",
    "qcInspectorId": "QC-01",
    "qcInspectorName": "คุณวิชัย ตรวจการ (QC-01)",
    "qcInspectorTitle": "ผู้ตรวจมาตรฐานงานอาวุโส (Senior QC Lead)",
    "qcNotes": "ตรวจสอบรูปเปรียบเทียบเรียบร้อย คอยล์สะอาด ไม่มีรอยรั่วซึม ลมเย็นฉ่ำตรงตามเกณฑ์มาตรฐานรักบ้าน 100%",
    "qcPassedAt": (now + timedelta(minutes=94)).isoformat(),
    "qcMinutes": 8
})
log_audit(
    agent_id="agent-4-qc",
    agent_name="คุณวิชัย ตรวจการ (QC-01) 🔍",
    actor_name="คุณวิชัย ตรวจการ (QC-01)",
    step=9,
    step_name="9. เราตรวจงาน (QC Inspection)",
    action="QC_INSPECTION_PASSED",
    job_id=job_id,
    status="success",
    dwell_mins=8,
    time_spent="เวลาตรวจ QC 8 นาที",
    items="อนุมัติผ่านเกณฑ์รูปคู่ 100% (ลงนามรับรอง: คุณวิชัย ตรวจการ)",
    details={
        "inspectorId": "QC-01",
        "inspectorName": "คุณวิชัย ตรวจการ",
        "license": "QC-CERT-2026-001",
        "result": "PASSED 100%"
    },
    agent_color="#9333ea"
)
time.sleep(1)

# -------------------------------------------------------------
# ขั้นตอนที่ 10: ลูกค้ารับงานและประกัน (Step 10: Customer Accepts)
# -------------------------------------------------------------
print("\n📋 [ขั้นตอนที่ 10] ลูกค้ารับงาน & ออกใบรับประกัน (Customer Accepts)")
print("   👥 คน: คุณวิภา สุขเจริญ (ลูกค้า)")
print("   📦 สิ่งของ: ใบรับประกันดิจิทัล 90 วัน + ปลดล็อคเงินโอนให้ช่างสมหมาย ฿750")
print("   ⏱️ ระยะเวลา: 2 นาที | เวลารวมตั้งแต่ต้นจนจบ: 96 นาที (SLA 120 นาที 🟢 เร็วกว่ากำหนด 24 นาที!)")

warranty_start = now.strftime('%Y-%m-%d')
warranty_end = (now + timedelta(days=90)).strftime('%Y-%m-%d')

update_job(job_id, {
    "status": "completed",
    "workflowStep": 10,
    "workflowStatus": "completed_with_warranty",
    "customerAcceptedAt": (now + timedelta(minutes=96)).isoformat(),
    "warranty": {
        "days": 90,
        "startDate": warranty_start,
        "endDate": warranty_end,
        "status": "active",
        "coverage": "งานฝีมือล้างแอร์ ท่อน้ำทิ้ง และการรั่วซึม 90 วันเต็ม"
    },
    "payout": {
        "status": "unlocked",
        "amount": 750,
        "beneficiary": "ช่างสมหมาย ใจซื่อ [RPS-T01]"
    },
    "timeMetrics": {
        "responseMinutes": 2,
        "dispatchMinutes": 3,
        "travelMinutes": 22,
        "procurementMinutes": 15,
        "executionMinutes": 40,
        "qcMinutes": 8,
        "totalElapsedMinutes": 96,
        "slaTargetMinutes": 120,
        "slaStatus": "ahead_of_schedule",
        "minutesAhead": 24
    }
})

log_audit(
    agent_id="agent-1-customer",
    agent_name="Agent-1: ลูกค้า 👤",
    actor_name="คุณวิภา สุขเจริญ",
    step=10,
    step_name="10. ลูกค้ารับงานและประกัน (Customer Accepts)",
    action="CUSTOMER_ACCEPT_JOB_WARRANTY",
    job_id=job_id,
    status="success",
    dwell_mins=2,
    time_spent="เวลารวมตลอดกระบวนการ 96 นาที (เร็วกว่าเป้า 24 นาที)",
    items="เปิดระบบรับประกัน 90 วัน + ปลดล็อคโอนเงินช่าง ฿750",
    details={
        "customer": "คุณวิภา สุขเจริญ",
        "warrantyDays": 90,
        "totalMinutes": 96,
        "slaTarget": 120,
        "savedMinutes": 24
    },
    agent_color="#0284c7"
)

print("\n" + "=" * 75)
print("🎉 งานบริการแจ้งซ่อม [RB-JOB-2601] ดำเนินการครบ 10 ขั้นตอนสมบูรณ์แบบ 100%!")
print("=" * 75)
print("📊 สรุปรายงานการบริการ 3 มิติ (Audit Trail Summary):")
print(f"1. ⏱️ มิติด้านเวลา (Time Dimension):")
print(f"   • เวลารวมตั้งแต่ต้นจนจบ: 96 นาที (1 ชม. 36 นาที)")
print(f"   • เป้าหมาย SLA งานด่วน: 120 นาที (2 ชม.)")
print(f"   • ผลลัพธ์: 🟢 ตรงเวลาและเร็วกว่ากำหนด 24 นาที!")
print(f"   • รายละเอียดเวลาแต่ละขั้นตอน:")
print(f"     - ขั้นตอน 2 (เวลาตอบรับ): 2 นาที")
print(f"     - ขั้นตอน 3 (เวลาจ่ายงาน): 3 นาที")
print(f"     - ขั้นตอน 5 (เวลาเดินทาง): 22 นาที")
print(f"     - ขั้นตอน 6 (เวลาจัดหาอะไหล่): 15 นาที")
print(f"     - ขั้นตอน 7 (เวลาสั่งการ): 1 นาที")
print(f"     - ขั้นตอน 8 (เวลาลงมือซ่อม): 40 นาที")
print(f"     - ขั้นตอน 9 (เวลาตรวจ QC): 8 นาที")
print(f"\n2. 👥 มิติคนรับผิดชอบตัวจริง (People Dimension):")
print(f"   • ลูกค้า: คุณวิภา สุขเจริญ (สันทรายน้อย)")
print(f"   • แอดมิน OCC: คุณรินรดา (AD-02)")
print(f"   • ช่าง Pro ผู้รับผิดชอบงาน: [RPS-T01] ช่างสมหมาย ใจซื่อ")
print(f"   • ผู้ตรวจ QC ตัวจริง: คุณวิชัย ตรวจการ (QC-01: ผู้ตรวจมาตรฐานงานอาวุโส)")
print(f"\n3. 📦 มิติสิ่งของและเงิน (Items & Money Dimension):")
print(f"   • ค่าบริการสุทธิ: ฿750 (ผ่าน Escrow ปลอดภัย ➔ ปลดล็อคโอนให้ช่างแล้ว)")
print(f"   • อะไหล่เพิ่มเติม: ท่อน้ำทิ้ง PVC 2 เมตร (฿120 ลูกค้าอนุมัติ)")
print(f"   • ผลงาน: ภาพถ่าย Before 2 รูป + After 2 รูป (ตรวจรับรอง 100%)")
print(f"   • การคุ้มครอง: กรมธรรม์ดิจิทัล 90 วัน ({warranty_start} ถึง {warranty_end})")
print("=" * 75)
