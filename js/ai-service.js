// ─────────────────────────────────────────────────────────────
// js/ai-service.js — โมดูลกลางบริการ AI ผู้ช่วย 2 ระดับ รักบ้าน@CNX
// สัปดาห์ที่ 8: รองรับ AI ระดับ 1 (วิเคราะห์หมวดหมู่ช่าง)
// และ AI ระดับ 2 (ประเมินงานช่าง/เครื่องมือ/ความปลอดภัย)
// ใช้โมเดล google/gemini-2.5-flash-lite พร้อม Timeout 15 วิ และ Smart Fallback
// ─────────────────────────────────────────────────────────────

(function () {
  // นิยาม 9 หมวดหมู่หลักของรักบ้าน@CNX
  var CATEGORY_MAP = {
    "plumbing": "ระบบประปา",
    "electrical": "ระบบไฟฟ้า",
    "air_con": "ล้าง/ซ่อมแอร์",
    "roof_structure": "หลังคา/โครงสร้าง",
    "wall_paint": "งานผนัง/สี",
    "floor_tile": "งานพื้น/กระเบื้อง",
    "door_window": "ประตู/หน้าต่าง",
    "appliance_ventilation": "เครื่องใช้ไฟฟ้า",
    "emergency_safety": "ฉุกเฉินเร่งด่วน"
  };

  window.RakbaanAIService = {
    categoryMap: CATEGORY_MAP,

    // ── 1. ฟังก์ชันเรียก OpenRouter API พร้อม Timeout 15s ──
    async callAPI(messages, systemPrompt) {
      var config = window.RAKBAAN_AI_CONFIG || {};
      var apiKey = config.apiKey || localStorage.getItem("rakbaan_ai_key") || localStorage.getItem("leaveeasy_ai_key") || "";
      var model = config.model || "google/gemini-2.5-flash-lite";
      var endpoint = config.endpoint || "https://openrouter.ai/api/v1/chat/completions";
      var timeoutMs = config.timeoutMs || 15000;

      if (!apiKey || apiKey.length < 10 || apiKey.indexOf("YOUR-") !== -1) {
        throw new Error("NO_API_KEY");
      }


      var reqMessages = [];
      if (systemPrompt) {
        reqMessages.push({ role: "system", content: systemPrompt });
      }
      reqMessages = reqMessages.concat(messages);

      var controller = new AbortController();
      var timer = setTimeout(function () {
        controller.abort();
      }, timeoutMs);

      try {
        var resp = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + apiKey,
            "HTTP-Referer": window.location.origin || "http://localhost",
            "X-Title": "Rakbaan CNX Home Repair Web Portal"
          },
          body: JSON.stringify({
            model: model,
            messages: reqMessages,
            temperature: 0.2
          }),
          signal: controller.signal
        });

        clearTimeout(timer);

        if (!resp.ok) {
          var errBody = await resp.text();
          throw new Error("HTTP " + resp.status + ": " + errBody);
        }

        var data = await resp.json();
        if (data.choices && data.choices[0] && data.choices[0].message) {
          return data.choices[0].message.content.trim();
        } else {
          throw new Error("รูปแบบคำตอบจาก OpenRouter ไม่ถูกต้อง");
        }
      } catch (err) {
        clearTimeout(timer);
        if (err.name === "AbortError") {
          throw new Error("TIMEOUT_15S");
        }
        throw err;
      }
    },

    // ── 2. AI ระดับ 1: วิเคราะห์และเลือกหมวดหมู่ช่าง (new-job.html) ──
    async classifyRepairCategory(title, description) {
      var fullText = (title + " " + description).trim();
      if (!fullText) {
        return {
          success: false,
          message: "กรุณากรอกหัวข้อหรือรายละเอียดอาการเสียก่อนให้ AI วิเคราะห์"
        };
      }

      var categoriesPrompt = Object.keys(CATEGORY_MAP).map(function (k) {
        return "- ID: \"" + k + "\" (" + CATEGORY_MAP[k] + ")";
      }).join("\n");

      var systemPrompt =
        "คุณคือ AI ผู้ช่วยวิเคราะห์งานซ่อมบ้านของระบบ 'รักบ้าน@CNX' ให้บริการในจังหวัดเชียงใหม่\n" +
        "หน้าที่ของคุณคือ อ่านอาการเสียของบ้าน แล้วเลือกหมวดหมู่งานซ่อมที่ตรงที่สุด 1 หมวด จากรายการนี้เท่านั้น:\n" +
        categoriesPrompt + "\n\n" +
        "กติกาเคร่งครัด:\n" +
        "1. ต้องตอบเป็น JSON เท่านั้น ห้ามมีข้อความทักทายหรือ markdown อื่นใดนอกบล็อก json\n" +
        "2. รูปแบบ JSON: {\"selectedCategory\": \"รหัสหมวดหมู่\", \"reason\": \"เหตุผลสั้น ๆ 1 ประโยคภาษาไทย\"}\n" +
        "3. ถ้าอาการเสียเข้าข่ายอันตรายร้ายแรงทันที เช่น ไฟไหม้ ก๊าซรั่ว ท่อประปาเมนแตก ให้เลือก 'emergency_safety'";

      var userPrompt = "อาการเสียที่ลูกค้าแจ้ง:\n" +
        "- หัวข้อ: " + (title || "-") + "\n" +
        "- รายละเอียด: " + (description || "-");

      try {
        var rawResp = await this.callAPI([
          { role: "user", content: userPrompt }
        ], systemPrompt);

        var clean = rawResp.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
        var parsed = JSON.parse(clean);

        if (parsed.selectedCategory && CATEGORY_MAP[parsed.selectedCategory]) {
          return {
            success: true,
            selectedCategory: parsed.selectedCategory,
            categoryName: CATEGORY_MAP[parsed.selectedCategory],
            reason: parsed.reason || ("AI แนะนำหมวดหมู่ " + CATEGORY_MAP[parsed.selectedCategory]),
            source: "openrouter"
          };
        }
        return {
          success: false,
          message: parsed.reason || "AI ไม่พบหมวดหมู่ที่ตรงกับอาการเสีย กรุณาเลือกด้วยตนเอง"
        };
      } catch (err) {
        console.warn("AI Service Call Error, fallback to Smart Rule Engine:", err.message);
        return this.fallbackClassify(title, description);
      }
    },

    // Smart Rule Engine สำรองสำหรับการจัดหมวดหมู่ (ไม่พึ่งพาอินเทอร์เน็ต)
    fallbackClassify(title, description) {
      var text = (title + " " + description).toLowerCase();
      var selected = "plumbing";
      var reason = "";

      if (/ฉุกเฉิน|ไฟไหม้|ควัน|แก๊ส|คานทรุด|บ้านจะถล่ม|ท่อเมนแตก|น้ำท่วมบ้าน/i.test(text)) {
        selected = "emergency_safety";
        reason = "ตรวจพบเหตุฉุกเฉินที่อาจมีผลต่อความปลอดภัยในชีวิตและทรัพย์สิน";
      } else if (/แอร์|คอยล์|น้ำยาแอร์|ไม่เย็น|ฟิลเตอร์|เครื่องปรับอากาศ/i.test(text)) {
        selected = "air_con";
        reason = "ตรวจพบอาการเกี่ยวกับระบบเครื่องปรับอากาศและความเย็น";
      } else if (/หลังคา|ดาดฟ้า|รางน้ำ|ฝ้าเพดาน|น้ำหยดจากเพดาน|รั่วซึม|แป|โครงเหล็ก/i.test(text)) {
        selected = "roof_structure";
        reason = "ตรวจพบปัญหาเกี่ยวกับโครงสร้างหลังคาและฝ้าเพดานรั่วซึม";
      } else if (/ไฟ|สวิตช์|ปลั๊ก|เบรกเกอร์|ไฟดับ|ช็อต|หลอดไฟ|สายไฟ|ตู้คอนซูเมอร์/i.test(text)) {
        selected = "electrical";
        reason = "ตรวจพบความผิดปกติของระบบไฟฟ้าและอุปกรณ์ส่องสว่าง";
      } else if (/น้ำ|ประปา|ท่อ|ก๊อก|ชักโครก|ปั๊มน้ำ|ลูกลอย|อ่างล้าง|ท่อตัน/i.test(text)) {
        selected = "plumbing";
        reason = "ตรวจพบปัญหาเกี่ยวกับระบบส่งน้ำ ท่อประปา หรือสุขภัณฑ์";
      } else if (/สี|ผนัง|รอยร้าว|ฉาบ|ลอก|เชื้อรา|โป๊ว/i.test(text)) {
        selected = "wall_paint";
        reason = "ตรวจพบปัญหาพื้นผิวผนัง สีลอกล่อน หรือรอยร้าว";
      } else if (/กระเบื้อง|พื้น|ร่อน|ยาแนว|ลามิเนต|ปาร์เกต์|พื้นทรุด/i.test(text)) {
        selected = "floor_tile";
        reason = "ตรวจพบงานปูพื้น กระเบื้องร่อน หรือยาแนวชำรุด";
      } else if (/ประตู|หน้าต่าง|ลูกบิด|บานพับ|กระจก|มุ้งลวด|กุญแจ/i.test(text)) {
        selected = "door_window";
        reason = "ตรวจพบปัญหาอุปกรณ์เปิด-ปิด ประตู หน้าต่าง หรือลูกบิด";
      } else if (/เครื่องทำน้ำอุ่น|พัดลมดูดอากาศ|ไมโครเวฟ|เตาอบ|ปั๊ม/i.test(text)) {
        selected = "appliance_ventilation";
        reason = "ตรวจพบปัญหาเครื่องใช้ไฟฟ้าและระบบระบายอากาศ";
      } else {
        selected = "plumbing";
        reason = "วิเคราะห์เบื้องต้นแนะนำหมวดหมู่ทั่วไป โปรดตรวจสอบและปรับเปลี่ยนตามต้องการ";
      }

      return {
        success: true,
        selectedCategory: selected,
        categoryName: CATEGORY_MAP[selected],
        reason: reason,
        source: "smart-engine"
      };
    },

    // ── 3. AI ระดับ 2 (Agentic): ประเมินงานช่าง/เครื่องมือ/ความปลอดภัย (job-detail.html) ──
    async analyzeJob(jobData) {
      var systemPrompt =
        "คุณคือ 'หัวหน้าช่างผู้เชี่ยวชาญ AI' ประจำระบบ 'รักบ้าน@CNX' (เชียงใหม่)\n" +
        "หน้าที่ของคุณคือ วิเคราะห์อาการเสีย สรุปสาระสำคัญ ประเมินความเร่งด่วน และจัดรายการเครื่องมือ/อะไหล่ที่ช่างต้องนำไปหน้างาน\n" +
        "⚠️ กฎเหล็ก: คุณให้คำแนะนำเพื่อสนับสนุนการทำงานของมนุษย์เท่านั้น ห้ามตัดสินใจเปลี่ยนสถานะงานแทนคน\n\n" +
        "โครงสร้างคำตอบ (ตอบเป็นข้อความ Markdown ชัดเจน):\n" +
        "### 🔍 1. สรุปวิเคราะห์สาเหตุที่เป็นไปได้\n" +
        "(อธิบายสาเหตุที่เป็นไปได้ 2-3 บรรทัด)\n\n" +
        "### ⚡ 2. ระดับความเร่งด่วน: [ระบุ ด่วนมาก / ปานกลาง / ปกติ]\n" +
        "(เหตุผลประกอบความเร่งด่วน)\n\n" +
        "### 🧰 3. เครื่องมือและอะไหล่ที่ช่างควรเตรียมขึ้นรถ\n" +
        "- รายการเครื่องมือและอะไหล่ 3-5 รายการ\n\n" +
        "### ⚠️ 4. ข้อควรระวังด้านความปลอดภัยหน้างาน\n" +
        "(คำเตือนสำคัญ เช่น ตัดระบบไฟฟ้าก่อนตรวจ, ตรวจโครงสร้างฝ้าเพดาน)";

      var userPrompt =
        "ข้อมูลงานแจ้งซ่อม:\n" +
        "- รหัสงาน: " + (jobData.id || "-") + "\n" +
        "- หัวข้องาน: " + (jobData.title || "-") + "\n" +
        "- หมวดหมู่: " + (CATEGORY_MAP[jobData.category] || jobData.category || "-") + "\n" +
        "- รายละเอียดอาการ: " + (jobData.description || "-") + "\n" +
        "- สถานที่หน้างาน: " + (jobData.address || "เชียงใหม่") + "\n" +
        "- ผู้แจ้งซ่อม: " + (jobData.customerName || "-") + "\n" +
        "- สถานะปัจจุบัน: " + (jobData.status || "pending_review") + "\n" +
        "- บันทึกหน้างานล่าสุด: " + (jobData.recentComments || "ยังไม่มีบันทึกเพิ่มเติม");

      try {
        var rawResp = await this.callAPI([
          { role: "user", content: userPrompt }
        ], systemPrompt);

        return {
          success: true,
          suggestion: rawResp,
          urgency: rawResp.includes("ด่วนมาก") ? "high" : (rawResp.includes("ปานกลาง") ? "medium" : "normal"),
          source: "openrouter"
        };
      } catch (err) {
        console.warn("AI Level 2 Call Error, fallback to Smart Rule Engine:", err.message);
        return this.fallbackAnalyzeJob(jobData);
      }
    },

    // Smart Rule Engine สำรองสำหรับ AI ระดับ 2
    fallbackAnalyzeJob(jobData) {
      var catName = CATEGORY_MAP[jobData.category] || jobData.category || "งานซ่อมทั่วไป";
      var title = jobData.title || "";
      var desc = jobData.description || "";
      var combined = (title + " " + desc).toLowerCase();

      var urgency = "normal";
      var urgencyText = "🟢 ปกติ — สามารถจัดคิวเข้าซ่อมตามรอบการทำงาน";
      var reason = "อาการเสียยังไม่ก่อความเสียหายต่อโครงสร้างหลัก";

      if (/ไฟไหม้|ควัน|ช็อต|ไฟดูด|ท่อแตก|น้ำท่วม|รั่วมาก|พัง/i.test(combined)) {
        urgency = "high";
        urgencyText = "🔴 ด่วนมาก — ควรส่งช่างเข้าตรวจสอบภายใน 2–4 ชั่วโมง";
        reason = "มีสัญญาณเสี่ยงต่อความปลอดภัยหรือทรัพย์สินเสียหายต่อเนื่อง";
      } else if (/ไม่เย็น|รั่ว|ตัน|ไม่มีน้ำ|มีเสียงดัง/i.test(combined)) {
        urgency = "medium";
        urgencyText = "🟠 ปานกลาง — แนะนำเข้าบริการภายใน 24 ชั่วโมง";
        reason = "ส่งผลต่อการใช้ชีวิตประจำวันของผู้อยู่อาศัย";
      }

      var tools = [
        "ชุดเครื่องมือช่างพื้นฐาน (ไขควง, คีม, ตลับเมตร, ประแจเลื่อน)",
        "มัลติมิเตอร์ / ไขควงวัดไฟดิจิทัล",
        "ไฟฉายคาดหัวและไฟสปอร์ตไลท์แบบพกพา",
        "อะไหล่และอุปกรณ์เสริมประจำหมวด " + catName
      ];

      var safety = "ตรวจสอบตัดกระแสไฟฟ้าหรือวาล์วน้ำหลักก่อนลงมือปฏิบัติงาน และสวมอุปกรณ์ป้องกันภัยส่วนบุคคล (PPE) ทุกครั้ง";

      var markdownSuggestion =
        "### 🔍 1. สรุปวิเคราะห์สาเหตุที่เป็นไปได้\n" +
        "จากการประเมินอาการ '" + (title || catName) + "' ในหมวดหมู่ " + catName + " ที่ " + (jobData.address || "เชียงใหม่") + " คาดว่าเกิดจากอุปกรณ์เสื่อมสภาพตามการใช้งานหรือเกิดจุดรั่ว/หลวมภายในระบบ ซึ่งจำเป็นต้องเปิดตรวจจุดเกิดเหตุอย่างละเอียด\n\n" +
        "### ⚡ 2. ระดับความเร่งด่วน: " + urgencyText + "\n" +
        "เหตุผล: " + reason + "\n\n" +
        "### 🧰 3. เครื่องมือและอะไหล่ที่ช่างควรเตรียมขึ้นรถ\n" +
        tools.map(function (t) { return "- " + t; }).join("\n") + "\n\n" +
        "### ⚠️ 4. ข้อควรระวังด้านความปลอดภัยหน้างาน\n" +
        safety;

      return {
        success: true,
        suggestion: markdownSuggestion,
        urgency: urgency,
        reason: reason,
        source: "smart-engine"
      };
    },

    // ── 4. บันทึกผลวิเคราะห์ AI ลง Firestore (aiSuggestion, aiReason, aiLog) ──
    async saveJobAnalysis(jobId, aiResult, actorUser) {
      if (!window.db || !jobId) {
        throw new Error("ไม่มีการเชื่อมต่อ Firestore หรือไม่พบ jobId");
      }

      var actorId = actorUser ? actorUser.uid : "system";
      var actorName = window.currentUserName || (actorUser ? (actorUser.displayName || actorUser.email) : "ผู้ใช้งาน");
      var nowIso = typeof เวลาตอนนี้ === "function" ? เวลาตอนนี้() : new Date().toISOString();

      // 1. บันทึกลงเอกสาร jobs/{jobId}
      await window.db.collection("jobs").doc(jobId).update({
        aiSuggestion: aiResult.suggestion || "",
        aiReason: aiResult.reason || (aiResult.urgency === "high" ? "งานเร่งด่วนพิเศษ" : "งานมาตรฐาน"),
        aiUrgency: aiResult.urgency || "normal",
        aiSource: aiResult.source || "openrouter",
        aiAnalyzedAt: nowIso,
        aiAnalyzedBy: actorName
      });

      // 2. บันทึกประวัติลง subcollection jobs/{jobId}/aiLog
      try {
        await window.db.collection("jobs").doc(jobId).collection("aiLog").add({
          timestamp: nowIso,
          model: "google/gemini-2.5-flash-lite",
          source: aiResult.source || "openrouter",
          urgency: aiResult.urgency || "normal",
          suggestionSnippet: (aiResult.suggestion || "").substring(0, 300) + "...",
          actorId: actorId,
          actorName: actorName
        });
      } catch (logErr) {
        console.warn("Save aiLog warning:", logErr);
      }

      return true;
    }
  };
})();
