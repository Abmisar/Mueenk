import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 5500;

/* =========================
   Database Connection
========================= */
const db = new pg.Client({
  user: "postgres",
  host: "localhost",
  database: "secrets",
  password: "abodegamerr3",
  port: 5432,
});

db.connect()
  .then(() => console.log("✅ Connected to PostgreSQL successfully!"))
  .catch((err) => console.error("❌ Database connection error:", err));

/* =========================
   Middlewares
========================= */
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");

/* =========================
   Status Codes (DB values)
========================= */
const STATUS = {
  PENDING: "PENDING",
  DELIVERED_SPL: "DELIVERED_SPL",
  RECEIVED_WASFTI: "RECEIVED_WASFTI",
  CANCELLED: "CANCELLED",
  PRESCRIPTION_EXPIRED: "PRESCRIPTION_EXPIRED",
};

const COMPLETED_STATUSES = [
  STATUS.DELIVERED_SPL,
  STATUS.RECEIVED_WASFTI,
  STATUS.CANCELLED,
  STATUS.PRESCRIPTION_EXPIRED,
];

/* =========================
   Patient Routes
========================= */
app.get("/", (req, res) => {
  res.render("home", { isHomePage: true, isPharmacistPage: false });
});

app.get("/create-request", (req, res) => {
  res.render("create-request", {
    errorMsg: null,
    successMsg: null,
    isHomePage: false,
    isPharmacistPage: false,
  });
});

app.get("/track-request", (req, res) => {
  res.render("track-request", {
    successMsg: null,
    requestsList: null,
    errorMsg: null,
    isHomePage: false,
    isPharmacistPage: false,
  });
});

app.post("/create-request", async (req, res) => {
  const {
    fullName,
    medicalFile,
    nationalId,
    phone,
    city,
    district,
    street,
    buildingNum,
    postalCode,
    shortAddress,
    extraNum,
    patientNotes,
  } = req.body;

  try {
    // منع أكثر من طلب نشط لنفس المريض
    const activeRequest = await db.query(
      `
      SELECT * 
      FROM patient_requests
      WHERE national_id = $1
      AND NOT (status = ANY($2::text[]))
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [nationalId, COMPLETED_STATUSES]
    );

    if (activeRequest.rows.length > 0) {
      return res.render("create-request", {
        errorMsg: `عذراً، لديك طلب نشط بالفعل (رقم: ${activeRequest.rows[0].req_id}). لا يمكنك تقديم طلب جديد حالياً.`,
        successMsg: null,
        isHomePage: false,
        isPharmacistPage: false,
      });
    }

    // إنشاء الطلب (status الافتراضي في DB يكون PENDING)
    const result = await db.query(
      `
      INSERT INTO patient_requests
      (full_name, medical_file, national_id, phone, city, district, street, building_num, postal_code, short_address, extra_num, patient_notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING req_id
      `,
      [
        fullName,
        medicalFile,
        nationalId,
        phone,
        city,
        district,
        street,
        buildingNum,
        postalCode,
        shortAddress,
        extraNum,
        patientNotes || null,
      ]
    );

    const newGeneratedId = result.rows[0].req_id;

    return res.render("track-request", {
      successMsg: newGeneratedId,
      requestsList: null,
      errorMsg: null,
      isHomePage: false,
      isPharmacistPage: false,
    });
  } catch (err) {
    console.error("Error saving request:", err);
    return res.status(500).render("create-request", {
      errorMsg: "حدث خطأ في السيرفر، يرجى المحاولة لاحقاً.",
      successMsg: null,
      isHomePage: false,
      isPharmacistPage: false,
    });
  }
});

// تتبع الطلب (بالرقم أو بالهوية) - يرجع كل الطلبات الأحدث أولاً
app.post("/track-request", async (req, res) => {
  const query = req.body.searchQuery;

  try {
    const result = await db.query(
      `
      SELECT *
      FROM patient_requests
      WHERE req_id = $1 OR national_id = $2
      ORDER BY created_at DESC
      `,
      [query, query]
    );

    return res.render("track-request", {
      requestsList: result.rows,
      successMsg: null,
      errorMsg: result.rows.length > 0 ? null : "عذراً، لم يتم العثور على طلبات بهذا الرقم.",
      isHomePage: false,
      isPharmacistPage: false,
    });
  } catch (err) {
    console.error("track-request error:", err);
    return res.render("track-request", {
      requestsList: null,
      successMsg: null,
      errorMsg: "حدث خطأ أثناء البحث.",
      isHomePage: false,
      isPharmacistPage: false,
    });
  }
});

/* =========================
   Pharmacist Routes
========================= */
app.get("/pharmacist-login", (req, res) => {
  res.render("pharmacist-login", {
    errorMsg: null,
    isPharmacistPage: false,
    isLoginPage: true,
    isHomePage: false,
  });
});

app.post("/ph-login", async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await db.query(
        "SELECT pharmacist_id, username, password FROM pharmacists WHERE username = $1 LIMIT 1",
        [username]
        );

        // إذا ما لقينا مستخدم
        if (result.rows.length === 0) {
        return res.render("pharmacist-login", {
            errorMsg: "اسم المستخدم أو كلمة المرور غير صحيحة ❌",
            isPharmacistPage: false,
            isLoginPage: true,
            isHomePage: false,
        });
        }

        const pharmacist = result.rows[0];

        // مقارنة كلمة المرور (plain text حالياً)
        if (pharmacist.password !== password) {
        return res.render("pharmacist-login", {
            errorMsg: "اسم المستخدم أو كلمة المرور غير صحيحة ❌",
            isPharmacistPage: false,
            isLoginPage: true,
            isHomePage: false,
        });
        }

        // ✅ نجاح: (حالياً بدون sessions)
        return res.redirect("/requests-list");
    } catch (err) {
        console.error("ph-login error:", err);
        return res.render("pharmacist-login", {
        errorMsg: "حدث خطأ في السيرفر. حاول مرة أخرى.",
        isPharmacistPage: false,
        isLoginPage: true,
        isHomePage: false,
        });
    }
});
  

// الطلبات النشطة (NOT completed)
app.get("/requests-list", async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT *
      FROM patient_requests
      WHERE NOT (status = ANY($1::text[]))
      ORDER BY created_at DESC
      `,
      [COMPLETED_STATUSES]
    );

    return res.render("requests-list", {
      requests: result.rows,
      isPharmacistPage: true,
      isHomePage: false,
    });
  } catch (err) {
    console.error("requests-list error:", err);
    return res.render("requests-list", {
      requests: [],
      isPharmacistPage: true,
      isHomePage: false,
    });
  }
});

// الطلبات المكتملة (completed)
app.get("/completed-requests", async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT *
      FROM patient_requests
      WHERE status = ANY($1::text[])
      ORDER BY created_at DESC
      `,
      [COMPLETED_STATUSES]
    );

    return res.render("completed-requests", {
      requests: result.rows,
      isPharmacistPage: true,
      isHomePage: false,
    });
  } catch (err) {
    console.error("completed-requests error:", err);
    return res.render("completed-requests", {
      requests: [],
      isPharmacistPage: true,
      isHomePage: false,
    });
  }
});

// تحديث حالة الطلب + ملاحظات الصيدلي
app.post("/update-status/:id", async (req, res) => {
  const requestId = req.params.id;
  const { newStatus, pharmacistName, clientNotes } = req.body;

  // Debug (مفيد جدًا وقت التطوير)
  console.log("Updating:", requestId);
  console.log("BODY:", req.body);

  try {
    await db.query(
      `
      UPDATE patient_requests
      SET status = $1,
          pharmacist_name = $2,
          pharmacist_notes = $3
      WHERE req_id = $4
      `,
      [newStatus, pharmacistName, clientNotes || null, requestId]
    );

    // رجعه لنفس صفحة التفاصيل عشان تشوف التغيير فوراً
    return res.redirect(`/completed-requests`);
  } catch (err) {
    console.error("Error updating status:", err);
    return res.redirect(`/completed-requests`);
  }
});

app.get("/patient-lookup", (req, res) => {
  res.render("patient-lookup", {
    patientsList: null,
    errorMsg: null,
    isPharmacistPage: true,
    isHomePage: false,
  });
});

app.post("/patient-lookup", async (req, res) => {
  const query = req.body.patientQuery;

  try {
    const result = await db.query(
      `
      SELECT *
      FROM patient_requests
      WHERE medical_file = $1 OR national_id = $2
      ORDER BY created_at DESC
      `,
      [query, query]
    );

    return res.render("patient-lookup", {
      patientsList: result.rows,
      errorMsg: result.rows.length > 0 ? null : "لم يتم العثور على المريض.",
      isPharmacistPage: true,
      isHomePage: false,
    });
  } catch (err) {
    console.error("patient-lookup error:", err);
    return res.render("patient-lookup", {
      patientsList: null,
      errorMsg: "خطأ في الاتصال.",
      isPharmacistPage: true,
      isHomePage: false,
    });
  }
});

app.get("/request-details/:id", async (req, res) => {
  const requestId = req.params.id;

  try {
    const result = await db.query(
      "SELECT * FROM patient_requests WHERE req_id = $1",
      [requestId]
    );

    if (!result.rows[0]) return res.redirect("/requests-list");

    return res.render("request-details", {
      request: result.rows[0],
      isPharmacistPage: true,
      isHomePage: false,
    });
  } catch (err) {
    console.error("request-details error:", err);
    return res.redirect("/requests-list");
  }
});

/* =========================
   Start Server
========================= */
app.listen(port, () => {
  console.log(`🚀 Maeenak Server running on http://localhost:${port}`);
});
