// ─────────────────────────────────────────────────────────────
// js/login.js — จัดการการเข้าสู่ระบบ Firebase Authentication
// ─────────────────────────────────────────────────────────────

(function () {
  var form = document.getElementById("ฟอร์มล็อกอิน");
  var emailInput = document.getElementById("email");
  var passwordInput = document.getElementById("password");
  var submitBtn = document.getElementById("ปุ่มล็อกอิน");
  var alertBox = document.getElementById("ข้อความเตือน");
  var okBox = document.getElementById("ข้อความสำเร็จ");

  // ถ้าล็อกอินอยู่แล้ว ให้ไปหน้ารายการงานซ่อม
  firebase.auth().onAuthStateChanged(function (user) {
    if (user) {
      location.href = "jobs.html";
    }
  });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    alertBox.classList.add("hidden");
    okBox.classList.add("hidden");

    var email = emailInput.value.trim();
    var password = passwordInput.value;

    if (!email || !password) {
      alertBox.textContent = "⚠️ กรุณากรอกอีเมลและรหัสผ่านให้ครบถ้วน";
      alertBox.classList.remove("hidden");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "กำลังเข้าสู่ระบบ…";

    try {
      await firebase.auth().signInWithEmailAndPassword(email, password);
      okBox.textContent = "✅ เข้าสู่ระบบสำเร็จ กำลังพาไปยังหน้ารายการงาน…";
      okBox.classList.remove("hidden");
      setTimeout(function () {
        location.href = "jobs.html";
      }, 500);
    } catch (err) {
      console.error("Login error:", err);
      var msg = "เข้าสู่ระบบไม่สำเร็จ: ";
      if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
        msg += "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
      } else if (err.code === "auth/invalid-email") {
        msg += "รูปแบบอีเมลไม่ถูกต้อง";
      } else {
        msg += err.message;
      }
      alertBox.textContent = "⚠️ " + msg;
      alertBox.classList.remove("hidden");
      submitBtn.disabled = false;
      submitBtn.textContent = "เข้าสู่ระบบ";
    }
  });
})();
