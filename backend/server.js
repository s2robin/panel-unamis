const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

/* =========================
   FILE STORAGE
========================= */

const DATA_DIR = path.join(__dirname, "data");
const READ_STATUS_FILE = path.join(DATA_DIR, "docs-read-status.json");

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(READ_STATUS_FILE)) {
    fs.writeFileSync(READ_STATUS_FILE, JSON.stringify({}, null, 2), "utf8");
  }
}

async function readStatusStore() {
  ensureStorage();
  const raw = await fs.promises.readFile(READ_STATUS_FILE, "utf8");
  return raw ? JSON.parse(raw) : {};
}

async function writeStatusStore(data) {
  ensureStorage();
  await fs.promises.writeFile(READ_STATUS_FILE, JSON.stringify(data, null, 2), "utf8");
}

async function updateMemoStatus(id, patch) {
  const store = await readStatusStore();
  const current = store[id] || {
    visto: false,
    lecturaConfirmada: false,
    updatedAt: null,
  };
  
  const updated = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  store[id] = updated;
  await writeStatusStore(store);
  return updated;
}

/* =========================
   🔵 MOODLE CONFIG
========================= */

const BASE_URL = process.env.MOODLE_BASE_URL;
const TOKEN = process.env.MOODLE_TOKEN;
async function moodleGet(wsfunction, extraParams = {}) {
  const response = await axios.get(BASE_URL, {
    params: {
      wstoken: TOKEN,
      moodlewsrestformat: "json",
      wsfunction,
      ...extraParams,
    },
  });
  return response.data;
}

function moodleError(error, fallback) {
  return {
    error: fallback,
    detail: error.response?.data || error.message,
  };
}

/* =========================
   🟣 DOCS CONFIG
========================= */

const DOCS_BASE = process.env.DOCS_BASE_URL;
const DOCS_TOKEN = process.env.DOCS_TOKEN;

const DOCS_AREA = "Direcci%C3%B3n+Sede+Santa+Rosa+de+Lima";

function docsHeaders() {
  const authValue = DOCS_TOKEN.startsWith("Bearer ") ? DOCS_TOKEN : `Bearer ${DOCS_TOKEN}`;
  return {
    "Authorization": authValue,
    "Accept": "application/json, text/plain, */*",
    "X_Authorization": authValue,
    "X_Csrf-Token": process.env.DOCS_CSRF_TOKEN, // Nuevo token de seguridad
    "Cookie": process.env.DOCS_COOKIE // Nueva cookie de sesión
  };
}

async function docsGet(endpoint) {
  const response = await axios.get(`${DOCS_BASE}/api/${endpoint}`, {
    headers: docsHeaders(),
  });
  return response.data;
}

function docsError(error, fallback) {
  return {
    error: fallback,
    detail: error.response?.data || error.message,
  };
}

/* =========================
   🟢 TEST
========================= */

app.get("/", (req, res) => {
  res.send("Backend funcionando (Moodle + Docs 🚀)");
});

/* =========================
   🔵 MOODLE ROUTES
========================= */

app.get("/api/moodle/test", async (req, res) => {
  try {
    const data = await moodleGet("core_webservice_get_site_info");
    res.json(data);
  } catch (error) {
    res.status(500).json(moodleError(error, "Falló test Moodle"));
  }
});

app.get("/api/moodle/categories", async (req, res) => {
  try {
    const data = await moodleGet("core_course_get_categories");
    res.json(data);
  } catch (error) {
    res.status(500).json(moodleError(error, "Falló categories"));
  }
});

app.get("/api/moodle/courses", async (req, res) => {
  try {
    const data = await moodleGet(
      "core_course_get_enrolled_courses_by_timeline_classification",
      { classification: "all" }
    );
    res.json(data);
  } catch (error) {
    res.status(500).json(moodleError(error, "Falló courses"));
  }
});

app.get("/api/moodle/category/:id/courses", async (req, res) => {
  try {
    const data = await moodleGet("core_course_get_courses_by_field", {
      field: "category",
      value: req.params.id,
    });
    res.json(data);
  } catch (error) {
    res.status(500).json(moodleError(error, "Falló category courses"));
  }
});

app.get("/api/moodle/courses/:id/participants", async (req, res) => {
  try {
    const data = await moodleGet("core_enrol_get_enrolled_users", {
      courseid: req.params.id,
    });
    res.json(data);
  } catch (error) {
    res.status(500).json(moodleError(error, "Falló participants"));
  }
});

app.get("/api/moodle/courses/:courseId/users/:userId/report", async (req, res) => {
  try {
    const data = await moodleGet("gradereport_user_get_grade_items", {
      courseid: req.params.courseId,
      userid: req.params.userId,
    });
    res.json(data);
  } catch (error) {
    res.status(500).json(moodleError(error, "Falló el informe del alumno"));
  }
});

app.get("/api/moodle/courses/:courseId/users/:userId/outline", async (req, res) => {
  try {
    const data = await moodleGet("report_outline_get_user_outline", {
      courseid: req.params.courseId,
      userid: req.params.userId,
    });
    res.json(data);
  } catch (error) {
    res.status(500).json(moodleError(error, "Falló el informe de actividad"));
  }
});

app.get("/api/moodle/courses/:id/assignments", async (req, res) => {
  try {
    const data = await moodleGet("mod_assign_get_assignments", {
      "courseids[0]": req.params.id,
    });
    res.json(data);
  } catch (error) {
    res.status(500).json(moodleError(error, "Falló assignments"));
  }
});

/* =========================
   🟣 DOCS ROUTES
========================= */

app.get("/api/docs/inbox", async (req, res) => {
  try {
    const data = await docsGet(
      `documents.php?mode=INBOX&current_area=${DOCS_AREA}&role=ADMIN&limit=0&offset=0&summary=true`
    );
    res.json(data);
  } catch (error) {
    res.status(500).json(docsError(error, "Falló inbox"));
  }
});

app.get("/api/docs/sent", async (req, res) => {
  try {
    const data = await docsGet(
      `documents.php?mode=SENT&current_area=${DOCS_AREA}&role=ADMIN&limit=0&offset=0&summary=true`
    );
    res.json(data);
  } catch (error) {
    res.status(500).json(docsError(error, "Falló sent"));
  }
});

app.get("/api/docs/overview", async (req, res) => {
  try {
    const data = await docsGet(
      `documents.php?mode=OVERVIEW&current_area=${DOCS_AREA}&role=ADMIN&limit=0&offset=0&summary=true`
    );
    res.json(data);
  } catch (error) {
    res.status(500).json(docsError(error, "Falló overview"));
  }
});

app.get("/api/docs/notifications", async (req, res) => {
  try {
    const data = await docsGet(
      `documents.php?mode=NOTIFICATIONS&current_area=${DOCS_AREA}&role=ADMIN&limit=5`
    );
    res.json(data);
  } catch (error) {
    res.status(500).json(docsError(error, "Falló notifications"));
  }
});

app.get("/api/docs/document/:id", async (req, res) => {
  try {
    const data = await docsGet(
      `documents.php?id=${req.params.id}&token=${DOCS_TOKEN}`
    );
    res.json(data);
  } catch (error) {
    res.status(500).json(docsError(error, "Falló document detail"));
  }
});

app.get("/api/docs/document/:id/audit", async (req, res) => {
  try {
    const data = await docsGet(`audit.php?document_id=${req.params.id}`);
    res.json(data);
  } catch (error) {
    res.status(500).json(docsError(error, "Falló audit"));
  }
});

/* =========================
   🟡 READ STATUS LOCAL
========================= */

app.get("/api/docs/read-status", async (req, res) => {
  try {
    const allStatuses = await readStatusStore();
    res.json(allStatuses);
  } catch (error) {
    res.status(500).json({
      error: "Falló read all statuses",
      detail: error.message,
    });
  }
});

app.get("/api/docs/read-status/:id", async (req, res) => {
  try {
    const store = await readStatusStore();
    const status = store[req.params.id] || { visto: false, lecturaConfirmada: false, updatedAt: null };
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: "Falló read status",
      detail: error.message,
    });
  }
});

app.post("/api/docs/read-status/:id/viewed", async (req, res) => {
  try {
    const status = await updateMemoStatus(req.params.id, {
      visto: true,
    });
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: "Falló viewed",
      detail: error.message,
    });
  }
});
app.post("/api/docs/read-status/:id/confirmed", async (req, res) => {
  try {
    const status = await updateMemoStatus(req.params.id, {
      visto: true,
      lecturaConfirmada: true,
    });
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: "Falló confirmed",
      detail: error.message,
    });
  }
});

/* =========================
   🟠 MICROSOFT GRAPH API (ONEDRIVE)
========================= */
const MS_TENANT_ID = process.env.MS_TENANT_ID;
const MS_CLIENT_ID = process.env.MS_CLIENT_ID;
const MS_CLIENT_SECRET = process.env.MS_CLIENT_SECRET;
const MS_USER_EMAIL = process.env.MS_USER_EMAIL;
const MS_PERSONAL_USER_EMAIL = process.env.MS_PERSONAL_USER_EMAIL;

const MAILBOXES = {
  institutional: MS_USER_EMAIL,
  personal: MS_PERSONAL_USER_EMAIL,
};

function resolveMailbox(account = "institutional") {
  const normalizedAccount = String(account || "institutional").toLowerCase();
  const mailboxEmail = MAILBOXES[normalizedAccount];

  if (!mailboxEmail) {
    const error = new Error(`Buzon no configurado para account=${normalizedAccount}`);
    error.statusCode = 400;
    throw error;
  }

  return mailboxEmail;
}

async function getGraphToken() {
  const tokenUrl = `https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams();
  params.append("client_id", MS_CLIENT_ID);
  params.append("scope", "https://graph.microsoft.com/.default");
  params.append("client_secret", MS_CLIENT_SECRET);
  params.append("grant_type", "client_credentials");

  const response = await axios.post(tokenUrl, params, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });
  
  return response.data.access_token;
}

app.get("/api/onedrive/files", async (req, res) => {
  try {
    const token = await getGraphToken();
    const folderId = req.query.folderId;
    
    let graphUrl = folderId 
      ? `https://graph.microsoft.com/v1.0/users/${MS_USER_EMAIL}/drive/items/${folderId}/children?$top=999`
      : `https://graph.microsoft.com/v1.0/users/${MS_USER_EMAIL}/drive/root/children?$top=999`;

    const response = await axios.get(graphUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    res.json(response.data.value);
  } catch (error) {
    console.error("Error en OneDrive:", error.response?.data || error.message);
    res.status(500).json({
      error: "Falló la conexión con OneDrive",
      detail: error.response?.data || error.message
    });
  }
});

app.get("/api/onedrive/file/:id/content", async (req, res) => {
  try {
    const token = await getGraphToken();
    const { id } = req.params;
    const requestedName = req.query.name || "documento.pdf";

    const graphUrl = `https://graph.microsoft.com/v1.0/users/${MS_USER_EMAIL}/drive/items/${id}/content`;
    const response = await axios.get(graphUrl, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: "arraybuffer",
      maxRedirects: 5,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(requestedName)}"`
    );
    res.setHeader("Content-Length", response.data.length);
    res.send(response.data);
  } catch (error) {
    console.error("Error al obtener PDF de OneDrive:", error.response?.data || error.message);
    res.status(500).json({
      error: "No se pudo cargar el PDF de OneDrive",
      detail: error.response?.data || error.message,
    });
  }
});
/* =========================
   🔵 MICROSOFT GRAPH API (MAIL / OUTLOOK)
========================= */

async function getMailFolderMessages(userEmail, folderName, top = 25) {
  const token = await getGraphToken();

  const url =
    `https://graph.microsoft.com/v1.0/users/${userEmail}` +
    `/mailFolders('${folderName}')/messages` +
    `?$top=${top}` +
    `&$orderby=receivedDateTime desc` +
    `&$select=id,subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,isRead,hasAttachments,importance`;

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return response.data.value || [];
}

app.get("/api/mail/inbox", async (req, res) => {
  try {
    const userEmail = resolveMailbox(req.query.account);
    const data = await getMailFolderMessages(userEmail, "Inbox", 30);
    res.json(data);
  } catch (error) {
    console.error("Error inbox mail:", error.response?.data || error.message);
    res.status(error.statusCode || 500).json({
      error: "Falló inbox mail",
      detail: error.response?.data || error.message,
    });
  }
});

app.get("/api/mail/sent", async (req, res) => {
  try {
    const userEmail = resolveMailbox(req.query.account);
    const data = await getMailFolderMessages(userEmail, "SentItems", 30);
    res.json(data);
  } catch (error) {
    console.error("Error sent mail:", error.response?.data || error.message);
    res.status(error.statusCode || 500).json({
      error: "Falló sent mail",
      detail: error.response?.data || error.message,
    });
  }
});

app.get("/api/mail/spam", async (req, res) => {
  try {
    const userEmail = resolveMailbox(req.query.account);
    const data = await getMailFolderMessages(userEmail, "JunkEmail", 30);
    res.json(data);
  } catch (error) {
    console.error("Error spam mail:", error.response?.data || error.message);
    res.status(error.statusCode || 500).json({
      error: "Falló spam mail",
      detail: error.response?.data || error.message,
    });
  }
});

app.get("/api/mail/message/:id", async (req, res) => {
  try {
    const token = await getGraphToken();
    const userEmail = resolveMailbox(req.query.account);

    const messageUrl =
      `https://graph.microsoft.com/v1.0/users/${userEmail}/messages/${req.params.id}` +
      `?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,body,bodyPreview,isRead,hasAttachments,importance`;

    const messageResponse = await axios.get(messageUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    let inlineAttachments = [];

    if (messageResponse.data?.hasAttachments) {
      const attachmentsUrl =
        `https://graph.microsoft.com/v1.0/users/${userEmail}/messages/${req.params.id}/attachments` +
        `?$top=100`;

      try {
        const attachmentsResponse = await axios.get(attachmentsUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        inlineAttachments = (attachmentsResponse.data.value || [])
          .filter((item) => item?.isInline && item?.contentId && item?.contentBytes)
          .map((item) => ({
            id: item.id,
            name: item.name,
            contentId: item.contentId,
            contentType: item.contentType || "application/octet-stream",
            contentBytes: item.contentBytes,
          }));
      } catch (attachmentError) {
        console.warn(
          "No se pudieron cargar adjuntos inline del correo:",
          attachmentError.response?.data || attachmentError.message
        );
      }
    }

    res.json({
      ...messageResponse.data,
      inlineAttachments,
    });
  } catch (error) {
    console.error("Error message detail:", error.response?.data || error.message);
    res.status(error.statusCode || 500).json({
      error: "Falló detalle del correo",
      detail: error.response?.data || error.message,
    });
  }
});

/* =========================
   🚀 START SERVER
========================= */

app.listen(PORT, () => {
  ensureStorage();
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
