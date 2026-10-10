/**
 * ทะเบียนช่างมืออาชีพ รักบ้าน@CNX (Technician Registry Master Data)
 * โครงสร้างข้อมูลช่าง Pro 15 คน แปลงจาก E:\rakbaan\catalog\data_technicians.json
 * ดูแลโดย น้องกุหลาบ (Kulap) Data Architect Sub-Agent
 */

export const TRADE_CATEGORY_MAP = {
  // Category key from lib/models/job.dart -> Technician trade
  air_con: 'air',
  appliance_ventilation: 'air',
  electrical: 'electrical',
  emergency_safety: 'electrical',
  plumbing: 'plumbing',
  roof_structure: 'roof',
  wall_paint: 'general',
  floor_tile: 'general',
  door_window: 'general',
  general: 'general',
};

export const TRADE_LABELS = {
  air: { name: 'เครื่องปรับอากาศ & HVAC', icon: '❄️' },
  electrical: { name: 'ระบบไฟฟ้าและความปลอดภัย', icon: '⚡' },
  plumbing: { name: 'ระบบประปาและสุขภัณฑ์', icon: '💧' },
  roof: { name: 'ซ่อมบำรุงหลังคา & รางน้ำ', icon: '🏠' },
  general: { name: 'งานช่างซ่อมบำรุงทั่วไป & ทาสี', icon: '🛠️' },
};

export const TECHNICIANS = [
  {
    "id": "RPS-T01",
    "name": "ช่างสมหมาย ใจซื่อ",
    "nickname": "ช่างหมาย",
    "phone": "089-123-45xx",
    "trade": "air",
    "tradeName": "เครื่องปรับอากาศ & HVAC",
    "status": "busy",
    "statusText": "กำลังทำงานหน้างาน",
    "currentJob": "RB-24071 (ต.สุเทพ 4.2 กม.)",
    "completedJobs": 128,
    "yearsExp": 8,
    "coverageArea": "อ.เมือง, แม่ริม, สันทราย",
    "earningsTotal": 89500,
    "companyScore": 96.5,
    "companyAudit": {
      "punctuality": 98.0,
      "boqCompliance": 100.0,
      "uniformAndSafety": 96.0,
      "cleanliness": 95.0,
      "disputeRatio": 0.0,
      "notes": "วินัยดีเยี่ยม เข้างานตรงเวลา 98% ใส่หน้ากากอนามัยและปูผ้ายางกันเปื้อนทุกครั้ง คิดราคาตรงตาม BOQ"
    },
    "customerRating": 4.92,
    "reviewCount": 84,
    "customerReviews": [
      {
        "customer": "คุณเชิดศักดิ์ (สุเทพ)",
        "rating": 5.0,
        "date": "16 ก.ย. 2568",
        "comment": "ช่างสมหมายมาตรงเวลา ล้างแอร์สะอาดมาก มีผ้ายางคลุมกันน้ำเลอะพื้น แนะนำดีมากครับ"
      },
      {
        "customer": "คุณพิมพ์ใจ (หนองป่าครั่ง)",
        "rating": 5.0,
        "date": "04 ส.ค. 2568",
        "comment": "สุภาพ เรียบร้อย อธิบายระบบน้ำยาชัดเจน ไม่มีบวกเงินเพิ่มตาม BOQ เลยค่ะ"
      },
      {
        "customer": "คุณอรัญญา (ช้างเผือก)",
        "rating": 4.8,
        "date": "12 ก.ค. 2568",
        "comment": "งานเรียบร้อยดีมากค่ะ เก็บกวาดหลังทำงานสะอาด"
      }
    ],
    "certifications": [
      "หนังสือรับรองช่างเครื่องปรับอากาศ จากกรมพัฒนาฝีมือแรงงาน",
      "ผ่านการอบรมช่างติดตั้งระบบ Inverter และสารทำความเย็น R32/R410A",
      "ผ่านการอบรมจรรยาบรรณและการบริการ RakBaan Academy 2568",
      "ผ่านการตรวจสอบประวัติอาชญากรรม (100% Verified Clean Record)"
    ],
    "portfolio": [
      "ล้างระบบแอร์ VRV และแอร์ติดผนัง คอนโดมิเนียมนิมมาน (12 เครื่อง)",
      "แก้ไขปัญหาน้ำหยดและเดินท่อน้ำทิ้งใหม่ บ้านเดี่ยว ม.ธารดง สันทราย",
      "ติดตั้งแอร์ใหม่ 3 ชุดพร้อมระบบเบรกเกอร์แยก ตึกแถวช้างคลาน"
    ]
  },
  {
    "id": "RPS-T02",
    "name": "ช่างประสิทธิ์ วงศ์วิชัย",
    "nickname": "ช่างสิทธิ์",
    "phone": "081-456-78xx",
    "trade": "electrical",
    "tradeName": "ระบบไฟฟ้าและความปลอดภัย",
    "status": "active",
    "statusText": "พร้อมรับงานทันที",
    "currentJob": "สแตนด์บายโซนข่วงสามกษัตริย์",
    "completedJobs": 94,
    "yearsExp": 10,
    "coverageArea": "อ.เมือง, หางดง, สารภี",
    "earningsTotal": 68200,
    "companyScore": 98.0,
    "companyAudit": {
      "punctuality": 99.0,
      "boqCompliance": 100.0,
      "uniformAndSafety": 98.0,
      "cleanliness": 96.0,
      "disputeRatio": 0.0,
      "notes": "ช่างไฟฟ้ามืออาชีพ ผ่านมาตรฐานช่างไฟอาคารระดับ 1 อุปกรณ์วัดค่าไฟและเซฟตี้ครบครัน 100%"
    },
    "customerRating": 4.96,
    "reviewCount": 62,
    "customerReviews": [
      {
        "customer": "คุณธนพล (แม่เหียะ)",
        "rating": 5.0,
        "date": "14 ก.ย. 2568",
        "comment": "ติดตู้คอนซูเมอร์ใหม่ เดินสายไฟเรียบร้อย ปลอดภัยมาก มีเครื่องวัดสายดินโชว์ให้ดูด้วย"
      },
      {
        "customer": "คุณพงษ์ศักดิ์ (สารภี)",
        "rating": 5.0,
        "date": "29 ส.ค. 2568",
        "comment": "ติดตั้งเบรกเกอร์กันดูด RCBO เร็ว ละเอียด ทดสอบตัดไฟจริงให้ดู ประทับใจมาก"
      }
    ],
    "certifications": [
      "หนังสือรับรองความรู้ความสามารถ ช่างไฟฟ้าภายในอาคาร (ระดับ 1) กรมพัฒนาฝีมือแรงงาน",
      "ผ่านการอบรมระบบตู้ควบคุมไฟบ้านและเบรกเกอร์กันดูด Schneider/Panasonic",
      "ผ่านการอบรมการตรวจวัดค่าความต้านทานดินและสายล่อฟ้า"
    ],
    "portfolio": [
      "เปลี่ยนตู้คอนซูเมอร์ยูนิต 12 ช่อง พร้อมติดตั้งระบบ RCBO ป้องกันไฟดูด บ้านเดี่ยวแม่เหียะ",
      "เดินท่อร้อยสายไฟลอย EMT เพิ่มเต้ารับ 8 จุด สตูดิโอช้างเผือก",
      "ติดตั้งเครื่องทำน้ำอุ่นพร้อมตอกหลักดิน 2.4 เมตร 2 ห้องน้ำ"
    ]
  },
  {
    "id": "RPS-T03",
    "name": "ช่างวิชัย นามวงศ์",
    "nickname": "ช่างวิทย์",
    "phone": "084-789-12xx",
    "trade": "plumbing",
    "tradeName": "ระบบประปาและสุขภัณฑ์",
    "status": "busy",
    "statusText": "กำลังทำงานหน้างาน",
    "currentJob": "RB-24068 (ต.ช้างเผือก 5.8 กม.)",
    "completedJobs": 86,
    "yearsExp": 7,
    "coverageArea": "อ.เมือง, สันทราย, ดอยสะเก็ด",
    "earningsTotal": 54000,
    "companyScore": 94.0,
    "companyAudit": {
      "punctuality": 96.0,
      "boqCompliance": 100.0,
      "uniformAndSafety": 94.0,
      "cleanliness": 93.0,
      "disputeRatio": 0.0,
      "notes": "เชี่ยวชาญงานระบบปั๊มน้ำ ท่อ PPR และงานแก้ปัญหาท่อตันด้วยงูเหล็กแรงดันสูง"
    },
    "customerRating": 4.85,
    "reviewCount": 55,
    "customerReviews": [
      {
        "customer": "คุณอรัญญา (ช้างเผือก)",
        "rating": 4.8,
        "date": "15 ก.ย. 2568",
        "comment": "เปลี่ยนก๊อกน้ำ ซ่อมท่อรั่วเร็วมาก ไม่เลอะเทอะ"
      },
      {
        "customer": "คุณกิตติชัย (ท่าศาลา)",
        "rating": 5.0,
        "date": "02 ก.ย. 2568",
        "comment": "ปั๊มน้ำร้องไม่หยุด ช่างวิชัยมาตั้งแรงดันและเปลี่ยนสวิตช์แป๊บเดียวเสร็จ เงียบกริบ"
      }
    ],
    "certifications": [
      "ใบประกาศนียบัตรช่างสุขภัณฑ์และระบบน้ำอาคาร",
      "ผ่านการอบรมการติดตั้งปั๊มน้ำอัตโนมัติและถังเก็บน้ำบนดิน/ใต้ดิน Grundfos & Mitsubishi",
      "ผ่านการอบรม RakBaan Safety First"
    ],
    "portfolio": [
      "ติดตั้งปั๊มน้ำอินเวอร์เตอร์ + ระบบท่อบายพาส บ้านเดี่ยวท่าศาลา",
      "ซ่อมท่อประปารั่วใต้พื้นปูนและเทปูนคืนสภาพ",
      "เปลี่ยนสุขภัณฑ์ชักโครกและชุดลูกลอย 3 ห้องน้ำ คอนโดเมือง"
    ]
  },
  {
    "id": "RPS-T04",
    "name": "ช่างเอกชัย บุญเรือง",
    "nickname": "ช่างเอก",
    "phone": "086-321-65xx",
    "trade": "general",
    "tradeName": "งานช่างซ่อมบำรุงทั่วไป & ทาสี",
    "status": "active",
    "statusText": "พร้อมรับงานทันที",
    "currentJob": "สแตนด์บายโซนมหิดล/หนองหอย",
    "completedJobs": 64,
    "yearsExp": 6,
    "coverageArea": "อ.เมือง, สารภี, หางดง",
    "earningsTotal": 41500,
    "companyScore": 95.0,
    "companyAudit": {
      "punctuality": 97.0,
      "boqCompliance": 100.0,
      "uniformAndSafety": 95.0,
      "cleanliness": 96.0,
      "disputeRatio": 0.0,
      "notes": "งานประณีต เก็บสีเรียบ ไร้รอยด่าง งานประตูหน้าต่างและยาแนวไว้ใจได้"
    },
    "customerRating": 4.9,
    "reviewCount": 42,
    "customerReviews": [
      {
        "customer": "คุณพิมพ์ใจ (หนองป่าครั่ง)",
        "rating": 5.0,
        "date": "10 ก.ย. 2568",
        "comment": "ทาสีห้องรับแขกเรียบร้อยมาก รองพื้นดี สีเนียนกริบ ไร้กลิ่นฉุน"
      },
      {
        "customer": "คุณวาสนา (ป่าแดด)",
        "rating": 4.8,
        "date": "21 ส.ค. 2568",
        "comment": "ซ่อมบานพับประตูและลูกบิดที่ฝืด เปิดปิดนุ่มมือขึ้นเยอะ"
      }
    ],
    "certifications": [
      "ผ่านการอบรมมาตรฐานสีทาอาคารและเคมีภัณฑ์กันซึม TOA / Nippon Paint",
      "ผ่านการอบรมงานไม้และอุปกรณ์ฟิตติ้ง Hafele / Yale",
      "RakBaan Handyman Certified"
    ],
    "portfolio": [
      "ทาสีผนังภายในห้องนั่งเล่น 30 ตร.ม. พร้อมขัดโป๊วรอยร้าวลายงา",
      "ขูดลอกยาแนวเดิมและลงยาแนวใหม่ผสมสารกันเชื้อรา 2 ห้องน้ำ",
      "ปรับบานพับไสขอบประตูไม้สักที่โก่งตก 4 บาน"
    ]
  },
  {
    "id": "RPS-T05",
    "name": "ช่างบุญมี ศรีสุข",
    "nickname": "ช่างมี",
    "phone": "083-998-11xx",
    "trade": "roof",
    "tradeName": "ซ่อมบำรุงหลังคา & รางน้ำ",
    "status": "busy",
    "statusText": "กำลังทำงานหน้างาน",
    "currentJob": "RB-24040 (ต.หางดง 15.2 กม.)",
    "completedJobs": 56,
    "yearsExp": 12,
    "coverageArea": "อ.เมือง, หางดง, สันทราย, แม่ริม",
    "earningsTotal": 48900,
    "companyScore": 97.0,
    "companyAudit": {
      "punctuality": 98.0,
      "boqCompliance": 100.0,
      "uniformAndSafety": 98.0,
      "cleanliness": 95.0,
      "disputeRatio": 0.0,
      "notes": "เซฟตี้ปีนที่สูงดีเยี่ยม ใช้สาย Harness 100% สำรวจจุดรั่วซึมหลังคาแม่นยำ ไม่ฟันราคา"
    },
    "customerRating": 4.95,
    "reviewCount": 38,
    "customerReviews": [
      {
        "customer": "คุณสมชาย (หางดง)",
        "rating": 5.0,
        "date": "12 ก.ย. 2568",
        "comment": "หลังคารั่วมา 2 ปี ช่างอื่นแก้ไม่หาย ช่างบุญมีมาเปลี่ยนแผ่นที่ร้าวและซีลครอบสันหลังคา ฝนตกหนักรอบนี้แห้งสนิท"
      },
      {
        "customer": "คุณเกษม (ฟ้าฮ่าม)",
        "rating": 4.9,
        "date": "19 ส.ค. 2568",
        "comment": "ล้างรางน้ำฝนและติดตะแกรงกันใบไม้ ทำงานคล่องแคล่ว ปลอดภัยมาก"
      }
    ],
    "certifications": [
      "ใบประกาศนียบัตรการทำงานบนที่สูงอย่างปลอดภัย (Working at Heights Certified)",
      "ผ่านการอบรมระบบหลังคา SCG และแผ่นซีลกันรั่วสะท้อนความร้อน",
      "RakBaan Master Roofer 2568"
    ],
    "portfolio": [
      "ซ่อมรอยรั่วซึมหลังคาโรงรถและครอบสันหลังคาซีแพค หางดง",
      "ทำความสะอาดรางน้ำฝนสแตนเลสและเปลี่ยนตะแกรงดักใบไม้ 40 เมตร",
      "ซ่อมกระเบื้องหลังคาลอนคู่แตกจากพายุฤดูร้อน สันทราย"
    ]
  },
  {
    "id": "RPS-T06",
    "name": "ช่างมานพ ทิพย์มงคล",
    "nickname": "ช่างนพ",
    "phone": "092-334-90xx",
    "trade": "air",
    "tradeName": "เครื่องปรับอากาศ & ระบบกรองฝุ่น PM 2.5",
    "status": "active",
    "statusText": "พร้อมรับงานทันที",
    "currentJob": "สแตนด์บายโซนนิมมาน/มช.",
    "completedJobs": 42,
    "yearsExp": 5,
    "coverageArea": "อ.เมือง, แม่ริม",
    "earningsTotal": 31200,
    "companyScore": 94.0,
    "companyAudit": {
      "punctuality": 95.0,
      "boqCompliance": 100.0,
      "uniformAndSafety": 94.0,
      "cleanliness": 96.0,
      "disputeRatio": 0.0,
      "notes": "ช่างรุ่นใหม่ เชี่ยวชาญแอร์ระบบฝังฝ้า 4 ทิศทาง และการอบโอโซนฆ่าเชื้อฝุ่น PM 2.5"
    },
    "customerRating": 4.88,
    "reviewCount": 29,
    "customerReviews": [
      {
        "customer": "คุณณัฐพร (ช้างคลาน)",
        "rating": 5.0,
        "date": "22 ส.ค. 2568",
        "comment": "ล้างแอร์สะอาดและอบโอโซนให้ กลิ่นอับหายสนิท อากาศในห้องสดชื่นขึ้นชัดเจน"
      },
      {
        "customer": "คุณเกษม (ฟ้าฮ่าม)",
        "rating": 4.8,
        "date": "14 พ.ค. 2568",
        "comment": "ล้างแอร์ Cassette 4 ทิศทางได้คล่องแคล่วดีมาก มืออาชีพ"
      }
    ],
    "certifications": [
      "ผ่านการอบรมช่างเครื่องปรับอากาศ Daikin / Mitsubishi Heavy Duty",
      "ผ่านการอบรมเทคโนโลยีระบบกรองอากาศและโอโซนคลีนนิ่ง",
      "RakBaan Verified"
    ],
    "portfolio": [
      "ล้างแอร์ 4 ทิศทาง Cassette Type สำนักงานนิมมาน 4 เครื่อง",
      "ล้างแอร์ใหญ่กำจัดฝุ่น PM 2.5 + อบโอโซน คอนโดช้างคลาน",
      "ตรวจเช็คและเติมน้ำยาแอร์ R32 ประหยัดไฟเบอร์ 5"
    ]
  },
  {
    "id": "RPS-T07",
    "name": "ช่างกิตติศักดิ์ เมืองแก้ว",
    "nickname": "ช่างศักดิ์",
    "phone": "087-654-32xx",
    "trade": "electrical",
    "tradeName": "ระบบไฟฟ้าอาคาร & โซลาร์รูฟ",
    "status": "active",
    "statusText": "พร้อมรับงานทันที",
    "currentJob": "สแตนด์บายโซนสันทราย/รวมโชค",
    "completedJobs": 78,
    "yearsExp": 9,
    "coverageArea": "อ.เมือง, สันทราย, แม่โจ้",
    "earningsTotal": 62400,
    "companyScore": 97.5,
    "companyAudit": {
      "punctuality": 98.5,
      "boqCompliance": 100.0,
      "uniformAndSafety": 97.0,
      "cleanliness": 96.0,
      "disputeRatio": 0.0,
      "notes": "เชี่ยวชาญการต่อเติมระบบไฟโซลาร์เซลล์ อุปกรณ์วัด Solar Analyzer แม่นยำ มาตรฐาน กฟภ."
    },
    "customerRating": 4.94,
    "reviewCount": 51,
    "customerReviews": [
      {
        "customer": "คุณกฤษฎา (สันทราย)",
        "rating": 5.0,
        "date": "18 ก.ย. 2568",
        "comment": "ติดตั้งระบบไฟสำรองและเช็คระบบโซลาร์ ละเอียดมาก อธิบายเข้าใจง่ายครับ"
      },
      {
        "customer": "คุณพิมพา (รวมโชค)",
        "rating": 4.9,
        "date": "05 ก.ย. 2568",
        "comment": "มาตรงเวลา ตรวจสายดินและตู้คอนซูเมอร์ละเอียดมาก ปลอดภัย สบายใจเลยค่ะ"
      }
    ],
    "certifications": [
      "หนังสือรับรองมาตรฐานฝีมือแรงงานแห่งชาติ สาขาช่างไฟฟ้าภายในอาคาร ระดับ 1",
      "ผ่านการอบรมระบบ On-Grid / Hybrid Solar Inverter จากสถาบันพลังงาน มช.",
      "RakBaan Certified Smart Electrician"
    ],
    "portfolio": [
      "ติดตั้งอินเวอร์เตอร์และเบรกเกอร์ DC/AC โซลาร์เซลล์ 5kW บ้านสันทราย",
      "เปลี่ยนระบบตู้ไฟเมนตัดไฟรั่วสำหรับโฮมออฟฟิศรวมโชค"
    ]
  },
  {
    "id": "RPS-T08",
    "name": "ช่างอนุชา ปัญญาวงศ์",
    "nickname": "ช่างชา",
    "phone": "085-112-99xx",
    "trade": "plumbing",
    "tradeName": "ระบบประปา & ปั๊มน้ำอัตโนมัติ",
    "status": "active",
    "statusText": "พร้อมรับงานทันที",
    "currentJob": "สแตนด์บายโซนเจ็ดยอด/ช้างเผือก",
    "completedJobs": 69,
    "yearsExp": 7,
    "coverageArea": "อ.เมือง, แม่ริม, หางดง",
    "earningsTotal": 49800,
    "companyScore": 95.0,
    "companyAudit": {
      "punctuality": 96.0,
      "boqCompliance": 100.0,
      "uniformAndSafety": 95.0,
      "cleanliness": 94.0,
      "disputeRatio": 0.0,
      "notes": "เชี่ยวชาญปัญหาน้ำรั่วซึมใต้ดิน ท่ออุดตัน และระบบถังพักน้ำ"
    },
    "customerRating": 4.89,
    "reviewCount": 44,
    "customerReviews": [
      {
        "customer": "คุณกมลวรรณ (เจ็ดยอด)",
        "rating": 5.0,
        "date": "20 ก.ย. 2568",
        "comment": "ท่อน้ำตัน น้ำเอ่อ ช่างชาใช้เครื่องล้างท่อแรงดันแป๊บเดียวโล่ง สะอาด ไม่เลอะเลย"
      }
    ],
    "certifications": [
      "ใบรับรองช่างประปาอาคาร จากกรมพัฒนาฝีมือแรงงาน",
      "ผ่านการอบรมเครื่องมืองูเหล็ก RIDGID และระบบตรวจสอบท่อส่องกล้อง",
      "RakBaan Verified Plumber"
    ],
    "portfolio": [
      "ซ่อมแซมท่อประปารั่วซึมใต้พื้นกระเบื้องพร้อมปูกระเบื้องคืน เจ็ดยอด",
      "ติดตั้งชุดปั๊มน้ำแรงดันคงที่ 250W พร้อมระบบบายพาส บ้านเดี่ยวแม่ริม"
    ]
  },
  {
    "id": "RPS-T09",
    "name": "ช่างธนกร อินทร์แก้ว",
    "nickname": "ช่างกร",
    "phone": "082-998-77xx",
    "trade": "general",
    "tradeName": "งานปูกระเบื้อง & ซ่อมพื้นผนัง",
    "status": "active",
    "statusText": "พร้อมรับงานทันที",
    "currentJob": "สแตนด์บายโซนหนองหอย/สารภี",
    "completedJobs": 58,
    "yearsExp": 8,
    "coverageArea": "อ.เมือง, สารภี, สันทราย",
    "earningsTotal": 43200,
    "companyScore": 96.0,
    "companyAudit": {
      "punctuality": 97.0,
      "boqCompliance": 100.0,
      "uniformAndSafety": 96.0,
      "cleanliness": 95.0,
      "disputeRatio": 0.0,
      "notes": "ปูกระเบื้องได้ระดับ สวยงาม ยาแนวแน่นหนา ไร้โพรงอากาศ"
    },
    "customerRating": 4.91,
    "reviewCount": 36,
    "customerReviews": [
      {
        "customer": "คุณวิไลรัตน์ (หนองหอย)",
        "rating": 5.0,
        "date": "11 ก.ย. 2568",
        "comment": "เปลี่ยนกระเบื้องห้องน้ำที่ร่อนแตก งานสวยกริบ เคาะแล้วทึบทุกแผ่น ประทับใจมาก"
      }
    ],
    "certifications": [
      "ผ่านการอบรมช่างติดตั้งกระเบื้องแกรนิตโต้และปูนกาว จระเข้/Cotto",
      "RakBaan Handyman Pro"
    ],
    "portfolio": [
      "ปูกระเบื้องพื้นห้องน้ำกันลื่น 3 ห้อง บ้านเดี่ยวสารภี",
      "ซ่อมแซมกระเบื้องระเบียงแตกร้าวและลงกันซึมโพลียูรีเทน"
    ]
  },
  {
    "id": "RPS-T10",
    "name": "ช่างสุรชัย เชียงใหม่ดี",
    "nickname": "ช่างชัย",
    "phone": "089-887-65xx",
    "trade": "roof",
    "tradeName": "โครงสร้างหลังคา & ซีลกันซึมดาดฟ้า",
    "status": "active",
    "statusText": "พร้อมรับงานทันที",
    "currentJob": "สแตนด์บายโซนดอยสะเก็ด/สันทราย",
    "completedJobs": 51,
    "yearsExp": 11,
    "coverageArea": "อ.เมือง, ดอยสะเก็ด, สันทราย",
    "earningsTotal": 47500,
    "companyScore": 96.8,
    "companyAudit": {
      "punctuality": 98.0,
      "boqCompliance": 100.0,
      "uniformAndSafety": 98.0,
      "cleanliness": 94.0,
      "disputeRatio": 0.0,
      "notes": "เชี่ยวชาญแก้ปัญหาน้ำรั่วซึมดาดฟ้าและรอยต่อแผ่นคอนกรีต มีกล้องอินฟราเรดตรวจจับความชื้น"
    },
    "customerRating": 4.93,
    "reviewCount": 33,
    "customerReviews": [
      {
        "customer": "คุณประพันธ์ (ดอยสะเก็ด)",
        "rating": 5.0,
        "date": "08 ก.ย. 2568",
        "comment": "ดาดฟ้ารั่วหยดลงเพลากลางบ้าน ช่างชัยมาขูดลอกทากันซึมอะคริลิก 3 ชั้น ฝนตกหนักไม่ซึมเลยครับ"
      }
    ],
    "certifications": [
      "Working at Heights Certificate (ความปลอดภัยในการทำงานบนที่สูง)",
      "ผ่านการอบรมระบบกันซึมดาดฟ้า TOA Water Bloc & Sika Proof"
    ],
    "portfolio": [
      "ทากันซึมดาดฟ้าตึกแถวดอยสะเก็ด 120 ตร.ม.",
      "เปลี่ยนรางน้ำฝนสแตนเลส 304 หนา 0.5 มม. ความยาว 28 เมตร"
    ]
  },
  {
    "id": "RPS-T11",
    "name": "ช่างธีระวัฒน์ จันทร์เป็ง",
    "nickname": "ช่างวัฒน์",
    "phone": "081-332-11xx",
    "trade": "air",
    "tradeName": "แอร์ระบบ VRV & แอร์เชิงพาณิชย์",
    "status": "active",
    "statusText": "พร้อมรับงานทันที",
    "currentJob": "สแตนด์บายโซนคูเมือง/ช้างคลาน",
    "completedJobs": 83,
    "yearsExp": 9,
    "coverageArea": "อ.เมือง, หางดง, สารภี",
    "earningsTotal": 71200,
    "companyScore": 95.5,
    "companyAudit": {
      "punctuality": 96.0,
      "boqCompliance": 100.0,
      "uniformAndSafety": 96.0,
      "cleanliness": 95.0,
      "disputeRatio": 0.0,
      "notes": "เชี่ยวชาญแอร์เชิงพาณิชย์ แอร์ร้านกาแฟ คลินิก และระบบแอร์รวม"
    },
    "customerRating": 4.87,
    "reviewCount": 57,
    "customerReviews": [
      {
        "customer": "คุณศิริพร (นิมมาน)",
        "rating": 5.0,
        "date": "14 ก.ย. 2568",
        "comment": "ล้างแอร์ร้านกาแฟ 6 ตัว ทำงานเงียบ สะอาด ไม่รบกวนลูกค้าในร้านเลย ช่างมืออาชีพมาก"
      }
    ],
    "certifications": [
      "ช่างเครื่องปรับอากาศระดับ 2 กรมพัฒนาฝีมือแรงงาน",
      "Daikin Certified Commercial Air Installer"
    ],
    "portfolio": [
      "ล้างและเซอร์วิสแอร์ท่อลม Duct Type ร้านอาหารนิมมาน",
      "ติดตั้งแอร์คาสเซ็ท 4 ทิศทาง คลินิกความงามช้างคลาน"
    ]
  },
  {
    "id": "RPS-T12",
    "name": "ช่างเกรียงไกร มโนรมย์",
    "nickname": "ช่างเกรียง",
    "phone": "086-554-99xx",
    "trade": "electrical",
    "tradeName": "ตู้ควบคุมไฟฟ้า MDB & สายดิน",
    "status": "active",
    "statusText": "พร้อมรับงานทันที",
    "currentJob": "สแตนด์บายโซนแม่เหียะ/หางดง",
    "completedJobs": 91,
    "yearsExp": 12,
    "coverageArea": "อ.เมือง, แม่เหียะ, หางดง",
    "earningsTotal": 82000,
    "companyScore": 98.2,
    "companyAudit": {
      "punctuality": 99.0,
      "boqCompliance": 100.0,
      "uniformAndSafety": 99.0,
      "cleanliness": 97.0,
      "disputeRatio": 0.0,
      "notes": "ช่างไฟฟ้าอาวุโส ฝีมือระดับมาสเตอร์ เชี่ยวชาญระบบโหลดบาลานซ์และเซฟตี้เบรกเกอร์ขั้นสูง"
    },
    "customerRating": 4.97,
    "reviewCount": 68,
    "customerReviews": [
      {
        "customer": "คุณพรรณี (แม่เหียะ)",
        "rating": 5.0,
        "date": "17 ก.ย. 2568",
        "comment": "ไฟดับเฉพาะชั้นสอง ช่างเกรียงมาเช็คแป๊บเดียวเจอลัดวงจรตรงกล่องพักสาย เดินสายใหม่เรียบร้อยปลอดภัยมาก"
      }
    ],
    "certifications": [
      "หนังสือรับรองความรู้ความสามารถ ช่างไฟฟ้าภายในอาคาร ระดับ 2",
      "ผ่านการอบรม Schneider Electric Master Certified Installer"
    ],
    "portfolio": [
      "ปรับปรุงตู้เมน MDB อาคารพาณิชย์ 3 ชั้น แม่เหียะ",
      "ติดตั้งแท่งกราวด์ร็อดทองแดง 3 จุดพร้อมวัดค่าความต้านทานดินต่ำกว่า 5 โอห์ม"
    ]
  },
  {
    "id": "RPS-T13",
    "name": "ช่างพงษ์พัฒน์ ชัยมงคล",
    "nickname": "ช่างพัฒน์",
    "phone": "083-441-22xx",
    "trade": "plumbing",
    "tradeName": "เดินท่อ PPR & ระบบบำบัดน้ำเสีย",
    "status": "active",
    "statusText": "พร้อมรับงานทันที",
    "currentJob": "สแตนด์บายโซนหนองป่าครั่ง/สันกำแพง",
    "completedJobs": 62,
    "yearsExp": 6,
    "coverageArea": "อ.เมือง, สันกำแพง, สารภี",
    "earningsTotal": 44600,
    "companyScore": 94.8,
    "companyAudit": {
      "punctuality": 96.0,
      "boqCompliance": 100.0,
      "uniformAndSafety": 95.0,
      "cleanliness": 94.0,
      "disputeRatio": 0.0,
      "notes": "เชี่ยวชาญการเชื่อมท่อน้ำร้อน PPR ไร้รอยรั่ว และติดตั้งถังดักไขมัน"
    },
    "customerRating": 4.86,
    "reviewCount": 41,
    "customerReviews": [
      {
        "customer": "คุณวรินทร์ (หนองป่าครั่ง)",
        "rating": 5.0,
        "date": "06 ก.ย. 2568",
        "comment": "เดินท่อน้ำร้อน PPR เข้าเครื่องทำน้ำร้อน งานเชื่อมเรียบร้อยมาก ทดสอบแรงดันน้ำไม่รั่วสักหยด"
      }
    ],
    "certifications": [
      "ใบรับรองการเชื่อมท่อเทอร์โมพลาสติก PPR Green Pipe",
      "RakBaan Verified"
    ],
    "portfolio": [
      "เดินระบบท่อน้ำร้อน PPR คอนโดมิเนียมสันกำแพง 2 ห้อง",
      "ติดตั้งถังดักไขมันสแตนเลสและต่อท่อระบายน้ำทิ้งร้านอาหาร"
    ]
  },
  {
    "id": "RPS-T14",
    "name": "ช่างสมบูรณ์ ลานนา",
    "nickname": "ช่างบูลย์",
    "phone": "084-221-88xx",
    "trade": "general",
    "tradeName": "ประตู-หน้าต่าง อลูมิเนียม & มุ้งลวด",
    "status": "active",
    "statusText": "พร้อมรับงานทันที",
    "currentJob": "สแตนด์บายโซนฟ้าฮ่าม/สันทราย",
    "completedJobs": 74,
    "yearsExp": 10,
    "coverageArea": "อ.เมือง, สันทราย, แม่ริม",
    "earningsTotal": 56800,
    "companyScore": 96.2,
    "companyAudit": {
      "punctuality": 97.0,
      "boqCompliance": 100.0,
      "uniformAndSafety": 96.0,
      "cleanliness": 96.0,
      "disputeRatio": 0.0,
      "notes": "งานประณีต เชี่ยวชาญบานเลื่อน บานสวิง เปลี่ยนโช้คอัพ และมุ้งลวดจีบกันแมลง"
    },
    "customerRating": 4.92,
    "reviewCount": 48,
    "customerReviews": [
      {
        "customer": "คุณธิติมา (ฟ้าฮ่าม)",
        "rating": 5.0,
        "date": "13 ก.ย. 2568",
        "comment": "ประตูบานเลื่อนกระจกตกรางและฝืดมาก ช่างบูลย์มาเปลี่ยนลูกล้อสแตนเลส เลื่อนลื่นปรื๊ดเลย"
      }
    ],
    "certifications": [
      "ผ่านการอบรมช่างติดตั้งประตูหน้าต่างอลูมิเนียมมาตรฐาน Tostem / Thai Metal",
      "RakBaan Certified"
    ],
    "portfolio": [
      "ติดตั้งมุ้งลวดจีบกันฝุ่นและกันแมลง บ้านเดี่ยวฟ้าฮ่าม 8 บาน",
      "เปลี่ยนโช้คอัพฝังพื้นประตูกระจกบานเปลือย 2 ชุด"
    ]
  },
  {
    "id": "RPS-T15",
    "name": "ช่างณรงค์ฤทธิ์ สุริยะ",
    "nickname": "ช่างณรงค์",
    "phone": "088-776-55xx",
    "trade": "roof",
    "tradeName": "หลังคาเมทัลชีท & รางน้ำไวนิล SCG",
    "status": "active",
    "statusText": "พร้อมรับงานทันที",
    "currentJob": "สแตนด์บายโซนสารภี/ป่าแดด",
    "completedJobs": 66,
    "yearsExp": 8,
    "coverageArea": "อ.เมือง, สารภี, หางดง",
    "earningsTotal": 51200,
    "companyScore": 95.8,
    "companyAudit": {
      "punctuality": 97.0,
      "boqCompliance": 100.0,
      "uniformAndSafety": 97.0,
      "cleanliness": 95.0,
      "disputeRatio": 0.0,
      "notes": "เชี่ยวชาญการยิงสกรูหลังคาเมทัลชีทติดยาง EPDM กันรั่ว และติดตั้งรางน้ำฝนไวนิล SCG"
    },
    "customerRating": 4.9,
    "reviewCount": 43,
    "customerReviews": [
      {
        "customer": "คุณสุวิทย์ (ป่าแดด)",
        "rating": 5.0,
        "date": "09 ก.ย. 2568",
        "comment": "เปลี่ยนรางน้ำฝนไวนิล SCG รอบบ้าน ท่อระบายน้ำเรียบร้อย น้ำไม่ล้นราง สวยงามมาก"
      }
    ],
    "certifications": [
      "ใบรับรองการติดตั้งรางน้ำฝนไวนิล SCG",
      "Working at Heights Safety Certified"
    ],
    "portfolio": [
      "มุงหลังคาเมทัลชีทแซนวิช PU โฟมกันความร้อน โรงจอดรถป่าแดด",
      "เปลี่ยนสกรูยึดหลังคาพร้อมแหวนยางกันซึม 300 ตัว"
    ]
  }
];

/**
 * ดึงรายชื่อช่างทั้งหมด
 * @returns {Array} รายชื่อช่างทั้ง 15 คน
 */
export function getTechnicians() {
  return TECHNICIANS;
}

/**
 * ดึงข้อมูลช่างตามรหัส (เช่น 'RPS-T01')
 * @param {string} id รหัสช่าง
 * @returns {Object|undefined}
 */
export function getTechnicianById(id) {
  if (!id) return undefined;
  const cleanId = id.trim().toUpperCase();
  return TECHNICIANS.find((t) => t.id.toUpperCase() === cleanId || t.name.includes(id));
}

/**
 * ดึงรายชื่อช่างตามหมวดงาน (trade เช่น 'air', 'electrical', 'plumbing', 'general', 'roof')
 * @param {string} trade รหัสหมวดงาน
 * @returns {Array}
 */
export function getTechniciansByTrade(trade) {
  if (!trade || trade === 'ALL') return TECHNICIANS;
  const cleanTrade = trade.toLowerCase();
  return TECHNICIANS.filter((t) => t.trade === cleanTrade);
}

/**
 * ดึงรายชื่อช่างที่ตรงกับหมวดหมู่งานซ่อม (Category Key จาก Job)
 * พร้อมแสดงช่างที่ตรงหมวดขึ้นก่อน ตามด้วยช่างหมวดทั่วไป
 * @param {string} categoryKey คีย์หมวดหมู่งาน เช่น 'air_con', 'electrical', 'plumbing'
 * @returns {Array} รายชื่อช่างที่ตรงหมวด
 */
export function getTechniciansForCategory(categoryKey) {
  if (!categoryKey) return TECHNICIANS;
  const targetTrade = TRADE_CATEGORY_MAP[categoryKey] || categoryKey;
  
  // ช่างที่ตรงสาย
  const matched = TECHNICIANS.filter((t) => t.trade === targetTrade);
  if (matched.length > 0) {
    return matched;
  }
  
  // หากไม่พบตรงสาย ให้คืนช่างทั้งหมด
  return TECHNICIANS;
}

/**
 * ทะเบียนเจ้าหน้าที่ตรวจสอบคุณภาพ รักบ้าน@CNX (QC & QA Inspectors Registry)
 * ระบุตัวตนเป็นชื่อคนจริง 100% ตามคำสั่งการคุณเชิด เพื่อความรับผิดชอบส่วนบุคคล
 */
export const QC_INSPECTORS = [
  {
    id: "QC-01",
    name: "คุณวิชัย ตรวจการ",
    nickname: "พี่วิชัย",
    role: "ผู้ตรวจมาตรฐานงานอาวุโส",
    specialty: "เครื่องปรับอากาศ, ระบบไฟฟ้า และความปลอดภัย",
    license: "QC-CERT-2026-001",
    passRate: 98.5,
    inspectionsCount: 342,
    phone: "081-999-0101"
  },
  {
    id: "QC-02",
    name: "คุณอรพินท์ ประณีต",
    nickname: "คุณอร",
    role: "ผู้ตรวจมาตรฐานงานสถาปัตย์และสุขาภิบาล",
    specialty: "ระบบประปา, สุขภัณฑ์, งานหลังคา และงานสี",
    license: "QC-CERT-2026-002",
    passRate: 99.1,
    inspectionsCount: 288,
    phone: "081-999-0102"
  },
  {
    id: "QC-03",
    name: "คุณมนัส ละเอียดลออ",
    nickname: "ช่างมนัส",
    role: "ผู้ตรวจประเมินหน้างานฉุกเฉิน",
    specialty: "งานเร่งด่วน, งานซ่อมโครงสร้าง และข้อพิพาทหน้างาน",
    license: "QC-CERT-2026-003",
    passRate: 97.8,
    inspectionsCount: 195,
    phone: "081-999-0103"
  }
];

export function getQCInspectors() {
  return QC_INSPECTORS;
}

export function getQCInspectorById(id) {
  if (!id) return QC_INSPECTORS[0];
  const cleanId = id.trim().toUpperCase();
  return QC_INSPECTORS.find(q => q.id.toUpperCase() === cleanId || q.name.includes(id)) || QC_INSPECTORS[0];
}
