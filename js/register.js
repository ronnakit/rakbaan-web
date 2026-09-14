// ─────────────────────────────────────────────────────────────
// js/register.js — จัดการการสมัครสมาชิกใหม่ของ รักบ้าน@CNX
// ─────────────────────────────────────────────────────────────

(function () {
  var form = document.getElementById("ฟอร์มสมัคร");
  var fullNameInput = document.getElementById("fullName");
  var emailInput = document.getElementById("email");
  var passwordInput = document.getElementById("password");
  var phoneInput = document.getElementById("phone");
  var roleSelect = document.getElementById("role");
  var submitBtn = document.getElementById("ปุ่มสมัคร");
  var alertBox = document.getElementById("ข้อความเตือน");
  var okBox = document.getElementById("ข้อความสำเร็จ");

  firebase.auth().onAuthStateChanged(function (user) {
    if (user && !sessionStorage.getItem("rb_just_registered")) {
      location.href = "jobs.html";
    }
  });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    alertBox.classList.add("hidden");
    okBox.classList.add("hidden");

    var fullName = fullNameInput.value.trim();
    var email = emailInput.value.trim();
    var password = passwordInput.value;
    var phone = phoneInput.value.trim();
    var role = roleSelect.value || "customer";

    if (!fullName || !email || !password) {
      alertBox.textContent = "⚠️ กรุณากรอกข้อมูลสำคัญให้ครบถ้วน";
      alertBox.classList.remove("hidden");
      return;
    }

    if (password.length < 6) {
      alertBox.textContent = "⚠️ รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร";
      alertBox.classList.remove("hidden");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "กำลังสร้างบัญชี…";

    try {
      sessionStorage.setItem("rb_just_registered", "1");

      // 1. สร้างบัญชีใน Firebase Auth
      var cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
      var user = cred.user;

      // 2. ตั้งค่า Display Name
      try {
        await user.updateProfile({ displayName: fullName });
      } catch (pErr) {
        console.warn("Update profile warning:", pErr);
      }

      // 3. บันทึกข้อมูลลงคอลเลกชัน users ด้วย ID เดียวกับ Auth UID
      await window.db.collection("users").doc(user.uid).set({
        userId: user.uid,
        fullName: fullName,
        email: email,
        phone: phone,
        role: role,
        createdAt: typeof เวลาตอนนี้ === "function" ? เวลาตอนนี้() : new Date().toISOString()
      });

      sessionStorage.removeItem("rb_just_registered");
      okBox.textContent = "✅ สมัครสมาชิกสำเร็จ กำลังพาเข้าสู่ระบบ…";
      okBox.classList.remove("hidden");

      setTimeout(function () {
        location.href = "jobs.html";
      }, 700);
    } catch (err) {
      sessionStorage.removeItem("rb_just_registered");
      console.error("Register error:", err);
      var msg = "สมัครสมาชิกไม่สำเร็จ: ";
      if (err.code === "auth/email-already-in-use") {
        msg += "อีเมลนี้ถูกใช้งานแล้ว กรุณาใช้อีเมลอื่นหรือเข้าสู่ระบบ";
      } else if (err.code === "auth/weak-password") {
        msg += "รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร";
      } else if (err.code === "auth/invalid-email") {
        msg += "รูปแบบอีเมลไม่ถูกต้อง";
      } else {
        msg += err.message;
      }
      alertBox.textContent = "⚠️ " + msg;
      alertBox.classList.remove("hidden");
      submitBtn.disabled = false;
      submitBtn.textContent = "ยืนยันการสมัครสมาชิก";
    }
  });
})();
