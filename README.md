# รักบ้าน@CNX — Ops Portal (MVP)

หน้าเดียว ไม่มี framework หนัก (Vite + vanilla JS + Firebase SDK) สำหรับ staff
ใช้ "เดินงาน": ดูงานที่ `status = pending_review` มอบหมายช่าง แล้วเลื่อนสถานะงาน
ไปเรื่อยๆจนถึง `completed` — ปลดบล็อกปัญหาที่ mobile app สร้างงานแล้วงานติดค้างที่
`pending_review` ตลอดไป (ไม่มีใครเลื่อนสถานะได้)

**Scope ที่ตั้งใจไม่ทำตอนนี้** (ดู `rakbaan_md/BACKLOG.md`): ไม่มี technician
directory จริง (พิมพ์ชื่อช่างเป็น string ธรรมดาเก็บใน `jobs.assignedTeamId`),
ไม่มี milestone/BOQ/photo review, ไม่มี dashboard/KPI ตาม wireframe เดิมใน
`02-app-features-ui.md §6.2` — เป็นแค่ตัวปลดบล็อกให้ pipeline เดินได้จริงก่อน

## Setup (ครั้งแรก)

1. **เปิด Email/Password sign-in** — Firebase Console > Authentication >
   Sign-in method > เปิด "Email/Password"
   https://console.firebase.google.com/project/rakbaan-cnx/authentication/providers
2. `npm install`
3. `npm run dev` แล้วเปิดลิงก์ที่ terminal พิมพ์ออกมา
4. กด "สร้างบัญชี staff ใหม่" ในหน้าเว็บ ใส่อีเมล/รหัสผ่านของตัวเอง
5. **ให้สิทธิ์ staff กับบัญชีนั้น** (ต้องทำนอกเว็บ เพราะการตั้ง custom claim
   ต้องใช้ Admin SDK เท่านั้น — client ไม่มีทางแก้ค่านี้เอง):
   - ดาวน์โหลด service account key: Firebase Console > Project settings >
     Service accounts > Generate new private key
     https://console.firebase.google.com/project/rakbaan-cnx/settings/serviceaccounts/adminsdk
   - เซฟไฟล์เป็น `service-account-key.json` ที่ root ของโฟลเดอร์นี้ (อยู่ใน
     `.gitignore` แล้ว — **ห้าม commit ไฟล์นี้เด็ดขาด** เพราะเป็นกุญแจ admin
     เข้าถึง Firebase project ทั้งหมด)
   - `node scripts/grant-staff-role.js you@example.com`
6. กลับไปที่เว็บ กด "ออกจากระบบ" แล้ว "เข้าสู่ระบบ" ใหม่ (custom claim ติดกับ
   ID token ตอน sign-in เท่านั้น — refresh หน้าเฉยๆไม่พอ)

## รันครั้งต่อไป

แค่ `npm run dev` — ไม่ต้องทำซ้ำ setup ข้างบนอีก (claim ติดอยู่กับ Firebase Auth
user ถาวรจนกว่าจะถูกเปลี่ยน)

## เพิ่ม staff คนใหม่

ให้เขาสร้างบัญชีที่หน้าเว็บ (ปุ่ม "สร้างบัญชี staff ใหม่") แล้วรัน
`node scripts/grant-staff-role.js <email ของเขา>` ให้ — ต้องมี
`service-account-key.json` อยู่แล้วเท่านั้น
