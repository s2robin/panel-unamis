import { useEffect, useState, useMemo, useRef } from "react";
import "./index.css";
import logo from "./assets/logo.png";
import FinanceModule from "./FinanceModule";
import {
  MAILBOX_CONFIG as AUTH_MAILBOX_CONFIG,
  MODULE_KEYS,
  USER_DIRECTORY,
  authenticateUser,
  canAccessMailbox,
  canAccessModule,
  getAccessibleModuleCount,
} from "./authConfig";

// Función auxiliar para formatear los bytes a KB/MB
const formatBytes = (bytes) => {
  if (bytes === 0 || !bytes) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const OFFICE_FILE_EXTENSIONS = new Set([
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
]);

const getFileExtension = (fileName = "", fallbackUrl = "") => {
  const source = fileName || fallbackUrl;
  const cleanSource = source.split("?")[0].split("#")[0];
  const extension = cleanSource.includes(".") ? cleanSource.split(".").pop() : "";
  return extension.toLowerCase();
};

const buildPreviewFile = ({ name, url, sourceUrl, previewUrlOverride }) => {
  const extension = getFileExtension(name, sourceUrl || url);
  const openUrl = url || sourceUrl || "";

  if (!openUrl) {
    return null;
  }

  if (extension === "pdf") {
    const pdfPreviewUrl = previewUrlOverride || sourceUrl || openUrl;

    return {
      name,
      url: openUrl,
      previewUrl: pdfPreviewUrl,
      previewType: "iframe",
    };
  }

  if (OFFICE_FILE_EXTENSIONS.has(extension) && sourceUrl) {
    return {
      name,
      url: openUrl,
      previewUrl: `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(sourceUrl)}`,
      previewType: "office",
    };
  }

  return {
    name,
    url: openUrl,
    previewUrl: openUrl,
    previewType: "iframe",
  };
};

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const [, contentBase64 = ""] = result.split(",");

      resolve({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size || 0,
        contentBase64,
      });
    };
    reader.onerror = () => reject(new Error(`No se pudo leer el archivo ${file.name}`));
    reader.readAsDataURL(file);
  });

const revokePreviewObjectUrl = (previewObjectUrlRef) => {
  if (previewObjectUrlRef.current) {
    URL.revokeObjectURL(previewObjectUrlRef.current);
    previewObjectUrlRef.current = null;
  }
};

const SESSION_USER_KEY = "panel_unamis_user";
const SESSION_VIEW_KEY = "panel_unamis_view";
const SESSION_ONEDRIVE_HISTORY_KEY = "panel_unamis_onedrive_history";
const SESSION_MAIL_READ_STATUS_KEY = "panel_unamis_mail_read_status";
const NON_PERSISTENT_VIEWS = new Set([
  "course-details",
  "student-report",
  "docs-detail",
  "mail-detail",
]);

const getStoredJson = (key, fallback = null) => {
  try {
    const rawValue = localStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) : fallback;
  } catch {
    return fallback;
  }
};

const getMailReadStorageKey = (userId = "guest", account = "institutional") =>
  `${SESSION_MAIL_READ_STATUS_KEY}_${userId}_${account}`;

const normalizeFolderHistory = (storedHistory, rootFolder) => {
  if (!Array.isArray(storedHistory) || storedHistory.length === 0) {
    return [rootFolder];
  }

  const normalizedHistory = storedHistory
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: item.id ?? null,
      name: item.name || "Carpeta",
    }));

  return normalizedHistory.length > 0 ? normalizedHistory : [rootFolder];
};

const normalizeContentId = (value = "") =>
  value.trim().replace(/^cid:/i, "").replace(/^<|>$/g, "").toLowerCase();

const hydrateMailBodyContent = (htmlContent = "", inlineAttachments = []) => {
  if (!htmlContent || !Array.isArray(inlineAttachments) || inlineAttachments.length === 0) {
    return htmlContent || "<p>Sin contenido</p>";
  }

  const inlineAttachmentMap = new Map(
    inlineAttachments
      .filter((item) => item?.contentId && item?.contentBytes)
      .map((item) => [
        normalizeContentId(item.contentId),
        `data:${item.contentType || "application/octet-stream"};base64,${item.contentBytes}`,
      ])
  );

  return htmlContent.replace(/src=(["'])cid:([^"']+)\1/gi, (match, quote, cidValue) => {
    const resolvedSrc = inlineAttachmentMap.get(normalizeContentId(cidValue));
    return resolvedSrc ? `src=${quote}${resolvedSrc}${quote}` : match;
  });
};

// Base URL para la API - Cambia 'tudominio.com' por tu dominio real en Hostinger
const API_BASE_URL = window.location.hostname === "localhost"
  ? "http://localhost:3001"
  : "https://panel-unamis-production.up.railway.app"; 

const MAILBOX_CONFIG = {
  personal: {
    key: "personal",
    title: "Correo personal",
    badge: "Correo personal",
    heading: "Correo personal",
    subtitle: "Bandeja de entrada, enviados y spam del buzón personal dentro del panel.",
  },
  institutional: {
    key: "institutional",
    title: "Correo institucional",
    badge: "Correo Microsoft 365",
    heading: "Outlook institucional",
    subtitle: "Bandeja de entrada, enviados y spam del buzón institucional dentro del panel.",
  },
};

const createEmptyMailboxState = () => ({
  loaded: false,
  loading: false,
  error: "",
  inbox: [],
  sent: [],
  spam: [],
  selectedMail: null,
  selectedMailDetail: null,
  detailLoading: false,
  detailError: "",
  readStatuses: {},
});

const createInitialMailboxesData = () =>
  Object.fromEntries(
    Object.keys(MAILBOX_CONFIG).map((accountKey) => [accountKey, createEmptyMailboxState()])
  );

const MODULE_VIEW_ACCESS = {
  mail: (currentUser, currentMailbox) => canAccessMailbox(currentUser, currentMailbox),
  "mail-detail": (currentUser, currentMailbox) => canAccessMailbox(currentUser, currentMailbox),
  communication: (currentUser) => canAccessModule(currentUser, MODULE_KEYS.communication),
  onedrive: (currentUser) => canAccessModule(currentUser, MODULE_KEYS.onedrive),
  docs: (currentUser) => canAccessModule(currentUser, MODULE_KEYS.docs),
  "docs-detail": (currentUser) => canAccessModule(currentUser, MODULE_KEYS.docs),
  moodle: (currentUser) => canAccessModule(currentUser, MODULE_KEYS.moodle),
  "course-details": (currentUser) => canAccessModule(currentUser, MODULE_KEYS.moodle),
  "student-report": (currentUser) => canAccessModule(currentUser, MODULE_KEYS.moodle),
  finance: (currentUser) => canAccessModule(currentUser, MODULE_KEYS.finance),
};

const canAccessCurrentView = (currentUser, currentView, currentMailbox) => {
  const accessResolver = MODULE_VIEW_ACCESS[currentView];
  return accessResolver ? accessResolver(currentUser, currentMailbox) : true;
};

function AnimatedStatValue({ value }) {
  const isNumeric = /^\d+$/.test(String(value || ""));
  const [displayValue, setDisplayValue] = useState(() => (isNumeric ? "00" : value));

  useEffect(() => {
    if (!isNumeric) {
      setDisplayValue(value);
      return;
    }

    const numericValue = Number(value);
    const duration = 900;
    const startTime = performance.now();
    let frameId = 0;

    const tick = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextValue = Math.round(numericValue * eased);
      setDisplayValue(String(nextValue).padStart(String(value).length, "0"));

      if (progress < 1) {
        frameId = requestAnimationFrame(tick);
      }
    };

    frameId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frameId);
  }, [isNumeric, value]);

  return <strong className="hero-stat-value">{displayValue}</strong>;
}

function DashboardBackground() {
  return (
    <div className="dashboard-background" aria-hidden="true">
      <div className="dashboard-background__glow"></div>
      <div className="dashboard-background__curves"></div>
    </div>
  );
}

function App() {
  const [view, setView] = useState(() => localStorage.getItem(SESSION_VIEW_KEY) || "home");
  const [user, setUser] = useState(() => {
    const storedUser = getStoredJson(SESSION_USER_KEY, null);
    return storedUser?.moduleAccess ? storedUser : null;
  });

  /* =========================
     MOODLE
  ========================= */
  const [categories, setCategories] = useState([]);
  const [loadingTree, setLoadingTree] = useState(false);
  const [treeError, setTreeError] = useState("");

  const [expandedCareers, setExpandedCareers] = useState({});
  const [expandedYears, setExpandedYears] = useState({});

  const [coursesByCategory, setCoursesByCategory] = useState({});
  const [loadingCoursesByCategory, setLoadingCoursesByCategory] = useState({});

  const [selectedCourse, setSelectedCourse] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState("");

  const [studentReport, setStudentReport] = useState(null);
  const [studentOutline, setStudentOutline] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);

  /* =========================
     DOCS
  ========================= */
  const [docsTab, setDocsTab] = useState("INBOX");
  const [docsFilter, setDocsFilter] = useState("TODOS");
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState("");
  const [docsInbox, setDocsInbox] = useState([]);
  const [docsSent, setDocsSent] = useState([]);

  const [selectedMemo, setSelectedMemo] = useState(null);
  const [selectedMemoDetail, setSelectedMemoDetail] = useState(null);
  const [memoLoading, setMemoLoading] = useState(false);
  const [memoError, setMemoError] = useState("");

  const [memoReadStatus, setMemoReadStatus] = useState({
    visto: false,
    lecturaConfirmada: false,
    updatedAt: null,
  });
  const [memoReadStatusLoading, setMemoReadStatusLoading] = useState(false);

  const [allReadStatuses, setAllReadStatuses] = useState({});
  const [previewFile, setPreviewFile] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewObjectUrlRef = useRef(null);

  /* =========================
     ONEDRIVE
  ========================= */
  const ROOT_ONEDRIVE_FOLDER = { id: null, name: "Raíz" };
  const [onedriveFiles, setOnedriveFiles] = useState([]);
  const [onedriveLoading, setOnedriveLoading] = useState(false);
  const [onedriveError, setOnedriveError] = useState("");
  const [folderHistory, setFolderHistory] = useState(() =>
    normalizeFolderHistory(
      getStoredJson(SESSION_ONEDRIVE_HISTORY_KEY, [ROOT_ONEDRIVE_FOLDER]),
      ROOT_ONEDRIVE_FOLDER
    )
  );
  const onedriveRequestIdRef = useRef(0);

  /* =========================
     MAIL
  ========================= */
  const [mailTab, setMailTab] = useState("INBOX");
  const [mailAccount, setMailAccount] = useState("institutional");
  const [mailboxesData, setMailboxesData] = useState(createInitialMailboxesData);
  const [communicationLoaded, setCommunicationLoaded] = useState(false);
  const [communicationLoading, setCommunicationLoading] = useState(false);
  const [communicationError, setCommunicationError] = useState("");
  const [conversations, setConversations] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [conversationMessages, setConversationMessages] = useState([]);
  const [conversationMessagesLoading, setConversationMessagesLoading] = useState(false);
  const [conversationMessagesError, setConversationMessagesError] = useState("");
  const [communicationRoleFilter, setCommunicationRoleFilter] = useState("all");
  const [recipientUserId, setRecipientUserId] = useState("");
  const [messageSubject, setMessageSubject] = useState("");
  const [messagePriority, setMessagePriority] = useState("normal");
  const [messageText, setMessageText] = useState("");
  const [messageFiles, setMessageFiles] = useState([]);
  const [sendingMessage, setSendingMessage] = useState(false);

  useEffect(() => {
    return () => revokePreviewObjectUrl(previewObjectUrlRef);
  }, []);

  useEffect(() => {
    if (user) {
      localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(SESSION_USER_KEY);
      localStorage.removeItem(SESSION_ONEDRIVE_HISTORY_KEY);
      setMailboxesData(createInitialMailboxesData());
      setCommunicationLoaded(false);
      setCommunicationError("");
      setConversations([]);
      setSelectedConversationId(null);
      setConversationMessages([]);
      setConversationMessagesError("");
      setRecipientUserId("");
      setMessageSubject("");
      setMessagePriority("normal");
      setMessageText("");
      setMessageFiles([]);
    }
  }, [user]);

  useEffect(() => {
    const persistedView = NON_PERSISTENT_VIEWS.has(view) ? "home" : view;
    localStorage.setItem(SESSION_VIEW_KEY, persistedView);
  }, [view]);

  useEffect(() => {
    if (user) {
      localStorage.setItem(SESSION_ONEDRIVE_HISTORY_KEY, JSON.stringify(folderHistory));
    }
  }, [user, folderHistory]);

  useEffect(() => {
    if (!user?.id) return;

    setMailboxesData((prev) => {
      const next = { ...prev };

      Object.keys(MAILBOX_CONFIG).forEach((accountKey) => {
        next[accountKey] = {
          ...(prev[accountKey] || createEmptyMailboxState()),
          readStatuses: getStoredJson(getMailReadStorageKey(user.id, accountKey), {}),
        };
      });

      return next;
    });
  }, [user]);

  useEffect(() => {
    if (!user?.id) return;

    Object.keys(MAILBOX_CONFIG).forEach((accountKey) => {
      localStorage.setItem(
        getMailReadStorageKey(user.id, accountKey),
        JSON.stringify(mailboxesData[accountKey]?.readStatuses || {})
      );
    });
  }, [user, mailboxesData]);

  useEffect(() => {
    if (user && view === "onedrive" && !onedriveLoading && onedriveFiles.length === 0) {
      loadOneDriveData(folderHistory);
    }
  }, [user, view]);

  useEffect(() => {
    const activeMailbox = mailboxesData[mailAccount];

    if (user && view === "mail" && activeMailbox && !activeMailbox.loaded && !activeMailbox.loading) {
      loadMailData(mailAccount);
    }
  }, [user, view, mailAccount, mailboxesData]);

  useEffect(() => {
    if (!user) return;

    if (!canAccessCurrentView(user, view, mailAccount)) {
      setView("home");
    }
  }, [user, view, mailAccount]);

  /* =========================
     ONEDRIVE FUNCTIONS
  ========================= */
  const loadOneDriveData = async (nextHistory = [ROOT_ONEDRIVE_FOLDER]) => {
    const safeHistory =
      Array.isArray(nextHistory) && nextHistory.length > 0 ? nextHistory : [ROOT_ONEDRIVE_FOLDER];
    const currentFolder = safeHistory[safeHistory.length - 1] || ROOT_ONEDRIVE_FOLDER;
    const requestId = ++onedriveRequestIdRef.current;

    setOnedriveLoading(true);
    setOnedriveError("");
    setOnedriveFiles([]); // Limpiamos archivos previos para evitar que el render intente usar datos viejos
    
    try {
      let url = `${API_BASE_URL}/api/onedrive/files`;
      if (currentFolder.id) {
        url += `?folderId=${currentFolder.id}`;
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error("No se pudieron cargar los archivos de la nube.");

      const data = await res.json();
      if (requestId !== onedriveRequestIdRef.current) return;

      setFolderHistory(safeHistory); // Actualizamos la historia solo después de obtener los datos con éxito
      const normalizedFiles = Array.isArray(data)
        ? data.filter((item) => item && typeof item === "object")
        : [];

      setOnedriveFiles(normalizedFiles);
      setOnedriveLoading(false);
    } catch (error) {
      if (requestId !== onedriveRequestIdRef.current) return;

      setOnedriveFiles([]);
      setOnedriveError(error.message);
      setOnedriveLoading(false);
    }
  };

  const openOneDriveView = () => {
    if (!canAccessModule(user, MODULE_KEYS.onedrive)) return;

    setView("onedrive");
    if (onedriveFiles.length === 0) {
      loadOneDriveData(folderHistory);
    }
  };

  const openOneDriveFolder = (folderId, folderName) => {
    if (!folderId) return;

    const nextFolder = { id: folderId, name: folderName || "Carpeta sin nombre" };
    const lastFolder = folderHistory[folderHistory.length - 1];
    const nextHistory =
      lastFolder?.id === nextFolder.id ? folderHistory : [...folderHistory, nextFolder];

    loadOneDriveData(nextHistory);
  };

  const closePreviewFile = () => {
    revokePreviewObjectUrl(previewObjectUrlRef);
    setPreviewLoading(false);
    setPreviewFile(null);
  };

  const openOneDriveFilePreview = async (itemData, itemName) => {
    const sourceUrl = itemData?.["@microsoft.graph.downloadUrl"] || itemData?.webUrl || "";
    const fileExtension = getFileExtension(itemName, sourceUrl);

    if (fileExtension === "pdf") {
      const pdfUrl = itemData?.webUrl || sourceUrl || "";
      if (pdfUrl) {
        window.open(pdfUrl, "_blank", "noopener,noreferrer");
      }
      return;
    }

    const basePreviewData = buildPreviewFile({
      name: itemName,
      url: itemData?.webUrl || sourceUrl,
      sourceUrl,
    });

    if (!basePreviewData) return;

    setPreviewFile(basePreviewData);
  };

  const goBackOneDrive = () => {
    if (!Array.isArray(folderHistory) || folderHistory.length <= 1) return;

    const newHistory = [...folderHistory].slice(0, -1);
    loadOneDriveData(newHistory); // Disparamos la carga de la carpeta anterior
  };

  /* =========================
     MAIL FUNCTIONS
  ========================= */
  const normalizeMailData = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.value)) return payload.value;
    return [];
  };

  const getMailboxTarget = (accountKey = mailAccount) =>
    user?.mailboxAccess?.[accountKey]?.target || "";

  const updateMailboxState = (accountKey, updater) => {
    setMailboxesData((prev) => {
      const currentMailbox = prev[accountKey] || createEmptyMailboxState();
      const nextMailbox =
        typeof updater === "function" ? updater(currentMailbox) : { ...currentMailbox, ...updater };

      return {
        ...prev,
        [accountKey]: nextMailbox,
      };
    });
  };

  const loadMailData = async (accountKey = mailAccount) => {
    try {
      updateMailboxState(accountKey, {
        loading: true,
        error: "",
      });

      const mailboxTarget = getMailboxTarget(accountKey);
      const accountParam =
        `account=${encodeURIComponent(accountKey)}` +
        `&mailbox=${encodeURIComponent(mailboxTarget)}`;

      const [inboxRes, sentRes, spamRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/mail/inbox?${accountParam}`),
        fetch(`${API_BASE_URL}/api/mail/sent?${accountParam}`),
        fetch(`${API_BASE_URL}/api/mail/spam?${accountParam}`),
      ]);

      if (!inboxRes.ok) throw new Error("No se pudo cargar la bandeja de entrada");
      if (!sentRes.ok) throw new Error("No se pudo cargar enviados");
      if (!spamRes.ok) throw new Error("No se pudo cargar spam");

      const [inboxData, sentData, spamData] = await Promise.all([
        inboxRes.json(),
        sentRes.json(),
        spamRes.json(),
      ]);

      updateMailboxState(accountKey, (currentMailbox) => ({
        ...currentMailbox,
        inbox: normalizeMailData(inboxData),
        sent: normalizeMailData(sentData),
        spam: normalizeMailData(spamData),
        loaded: true,
        loading: false,
        error: "",
      }));
    } catch (error) {
      updateMailboxState(accountKey, (currentMailbox) => ({
        ...currentMailbox,
        error: error.message,
        loading: false,
      }));
    }
  };

  const openMailView = async (accountKey = "institutional", tab = "INBOX") => {
    if (!canAccessMailbox(user, accountKey)) return;

    const targetMailbox = mailboxesData[accountKey] || createEmptyMailboxState();

    setMailAccount(accountKey);
    setView("mail");
    setMailTab(tab);
    updateMailboxState(accountKey, (currentMailbox) => ({
      ...currentMailbox,
      selectedMail: null,
      selectedMailDetail: null,
      detailError: "",
      error: "",
    }));

    if (targetMailbox.loaded) return;

    await loadMailData(accountKey);
  };

  const changeMailTab = (tab) => {
    setMailTab(tab);
    updateMailboxState(mailAccount, (currentMailbox) => ({
      ...currentMailbox,
      selectedMail: null,
      selectedMailDetail: null,
      detailError: "",
    }));
  };

  const openMailDetail = async (mail) => {
    if (!canAccessMailbox(user, mailAccount)) return;

    updateMailboxState(mailAccount, (currentMailbox) => ({
      ...currentMailbox,
      selectedMail: mail,
      selectedMailDetail: null,
      detailLoading: true,
      detailError: "",
    }));
    setView("mail-detail");

    try {
      const mailboxTarget = getMailboxTarget(mailAccount);
      const accountParam =
        `account=${encodeURIComponent(mailAccount)}` +
        `&mailbox=${encodeURIComponent(mailboxTarget)}`;
      const res = await fetch(`${API_BASE_URL}/api/mail/message/${mail.id}?${accountParam}`);
      if (!res.ok) {
        throw new Error("No se pudo cargar el detalle del correo");
      }

      const data = await res.json();
      updateMailboxState(mailAccount, (currentMailbox) => ({
        ...currentMailbox,
        selectedMailDetail: data || null,
        detailLoading: false,
      }));
    } catch (error) {
      updateMailboxState(mailAccount, (currentMailbox) => ({
        ...currentMailbox,
        detailError: error.message,
        detailLoading: false,
      }));
    }
  };

  const currentMailConfig = AUTH_MAILBOX_CONFIG[mailAccount] || AUTH_MAILBOX_CONFIG.institutional;
  const currentMailState = mailboxesData[mailAccount] || createEmptyMailboxState();
  const currentMailList =
    mailTab === "INBOX"
      ? currentMailState.inbox
      : mailTab === "SENT"
        ? currentMailState.sent
        : currentMailState.spam;

  const isMailReadLocally = (mailId) => !!currentMailState.readStatuses[mailId];

  const toggleLocalMailRead = (mailId) => {
    if (!mailId) return;

    updateMailboxState(mailAccount, (currentMailbox) => ({
      ...currentMailbox,
      readStatuses: {
        ...currentMailbox.readStatuses,
        [mailId]: !currentMailbox.readStatuses[mailId],
      },
    }));
  };

  const mailToShow = currentMailState.selectedMailDetail || currentMailState.selectedMail;
  const hydratedMailBody = hydrateMailBodyContent(
    mailToShow?.body?.content,
    mailToShow?.inlineAttachments
  );
  const isCurrentMailReadLocally = isMailReadLocally(mailToShow?.id);

  const getMailSender = (mail) => {
    return mail?.from?.emailAddress?.name || mail?.from?.emailAddress?.address || "Sin remitente";
  };

  const getMailRecipients = (mail) => {
    if (!Array.isArray(mail?.toRecipients) || mail.toRecipients.length === 0) {
      return "Sin destinatarios";
    }

    return mail.toRecipients
      .map((item) => item?.emailAddress?.name || item?.emailAddress?.address)
      .filter(Boolean)
      .join(", ");
  };

  const formatMailDate = (date) => {
    if (!date) return "Sin fecha";
    try {
      return new Date(date).toLocaleString();
    } catch {
      return date;
    }
  };

  /* =========================
     INTERNAL COMMUNICATION
  ========================= */
  const userDirectoryMap = useMemo(
    () => new Map(USER_DIRECTORY.map((entry) => [entry.id, entry])),
    []
  );

  const communicationRoleOptions = useMemo(() => {
    const seenRoles = new Set();

    return USER_DIRECTORY.filter((entry) => entry.id !== user?.id).filter((entry) => {
      if (seenRoles.has(entry.role)) return false;
      seenRoles.add(entry.role);
      return true;
    });
  }, [user]);

  const communicationRecipients = useMemo(
    () =>
      USER_DIRECTORY.filter((entry) => entry.id !== user?.id).filter(
        (entry) => communicationRoleFilter === "all" || entry.role === communicationRoleFilter
      ),
    [user, communicationRoleFilter]
  );

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) || null,
    [conversations, selectedConversationId]
  );

  useEffect(() => {
    if (
      recipientUserId &&
      !communicationRecipients.some((entry) => entry.id === recipientUserId)
    ) {
      setRecipientUserId("");
    }
  }, [communicationRecipients, recipientUserId]);

  useEffect(() => {
    if (!selectedConversation || !user?.id) return;

    const partnerId = selectedConversation.participants.find(
      (participantId) => participantId !== user.id
    );

    if (partnerId) {
      setRecipientUserId(partnerId);
    }

    if (selectedConversation.subject) {
      setMessageSubject(selectedConversation.subject);
    }

    if (selectedConversation.priority) {
      setMessagePriority(selectedConversation.priority);
    }
  }, [selectedConversation, user]);

  const loadCommunicationConversations = async (preferredConversationId = null) => {
    if (!user?.id) return null;

    try {
      setCommunicationLoading(true);
      setCommunicationError("");

      const response = await fetch(
        `${API_BASE_URL}/api/internal/conversations?userId=${encodeURIComponent(user.id)}`
      );

      if (!response.ok) {
        throw new Error("No se pudieron cargar las conversaciones internas.");
      }

      const payload = await response.json();
      const nextConversations = Array.isArray(payload?.conversations)
        ? payload.conversations
        : [];

      setConversations(nextConversations);
      setCommunicationLoaded(true);

      const nextSelectedId =
        preferredConversationId ||
        (nextConversations.some((conversation) => conversation.id === selectedConversationId)
          ? selectedConversationId
          : nextConversations[0]?.id || null);

      setSelectedConversationId(nextSelectedId);
      setCommunicationLoading(false);

      return nextSelectedId;
    } catch (error) {
      setCommunicationError(error.message);
      setCommunicationLoading(false);
      return null;
    }
  };

  const loadConversationMessages = async (conversationId) => {
    if (!conversationId || !user?.id) {
      setConversationMessages([]);
      return;
    }

    try {
      setConversationMessagesLoading(true);
      setConversationMessagesError("");

      const response = await fetch(
        `${API_BASE_URL}/api/internal/conversations/${conversationId}/messages?userId=${encodeURIComponent(user.id)}`
      );

      if (!response.ok) {
        throw new Error("No se pudieron cargar los mensajes de esta conversación.");
      }

      const payload = await response.json();
      setConversationMessages(Array.isArray(payload?.messages) ? payload.messages : []);
      setConversationMessagesLoading(false);
    } catch (error) {
      setConversationMessagesError(error.message);
      setConversationMessagesLoading(false);
    }
  };

  const openCommunicationView = async () => {
    if (!canAccessModule(user, MODULE_KEYS.communication)) return;

    setView("communication");

    const nextSelectedId = await loadCommunicationConversations();
    if (nextSelectedId) {
      await loadConversationMessages(nextSelectedId);
    }
  };

  const openConversation = async (conversationId) => {
    setSelectedConversationId(conversationId);
    await loadConversationMessages(conversationId);
  };

  const submitInternalMessage = async (event) => {
    event.preventDefault();

    if (!user?.id) return;

    const targetRecipientId =
      selectedConversation?.participants.find((participantId) => participantId !== user.id) ||
      recipientUserId;

    if (!targetRecipientId) {
      alert("Selecciona primero el destinatario interno.");
      return;
    }

    if (!messageText.trim() && messageFiles.length === 0) {
      alert("Escribe un mensaje o adjunta al menos un archivo.");
      return;
    }

    try {
      setSendingMessage(true);
      setCommunicationError("");

      const attachments = await Promise.all(messageFiles.map((file) => fileToBase64(file)));

      const response = await fetch(`${API_BASE_URL}/api/internal/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          senderId: user.id,
          recipientId: targetRecipientId,
          conversationId: selectedConversation?.id || null,
          subject: messageSubject.trim(),
          priority: messagePriority,
          text: messageText.trim(),
          attachments,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "No se pudo enviar el mensaje interno.");
      }

      setMessageText("");
      setMessageFiles([]);

      const nextConversationId = payload?.conversation?.id || selectedConversation?.id || null;
      const resolvedConversationId =
        (await loadCommunicationConversations(nextConversationId)) || nextConversationId;

      if (resolvedConversationId) {
        await loadConversationMessages(resolvedConversationId);
      }
    } catch (error) {
      setCommunicationError(error.message);
    } finally {
      setSendingMessage(false);
    }
  };

  const selectedConversationPartner = selectedConversation
    ? userDirectoryMap.get(
        selectedConversation.participants.find((participantId) => participantId !== user?.id)
      )
    : null;

  /* =========================
     MOODLE FUNCTIONS
  ========================= */
  const openMoodleView = async () => {
    if (!canAccessModule(user, MODULE_KEYS.moodle)) return;

    setView("moodle");

    if (categories.length > 0) return;

    try {
      setLoadingTree(true);
      setTreeError("");

      const res = await fetch(`${API_BASE_URL}/api/moodle/categories`);
      if (!res.ok) throw new Error("No se pudieron cargar las categorías");

      const data = await res.json();
      setCategories(Array.isArray(data) ? data : []);
      setLoadingTree(false);
    } catch (error) {
      setTreeError(error.message);
      setLoadingTree(false);
    }
  };

  const getSantaRosaCategory = () => {
    return categories.find(
      (cat) => cat.name?.trim().toLowerCase() === "sede santa rosa"
    );
  };

  const getChildren = (parentId) => {
    return categories.filter((cat) => Number(cat.parent) === Number(parentId));
  };

  const santaRosa = getSantaRosaCategory();
  const careers = santaRosa ? getChildren(santaRosa.id) : [];

  const toggleCareer = (careerId) => {
    setExpandedCareers((prev) => ({
      ...prev,
      [careerId]: !prev[careerId],
    }));
  };

  const loadCoursesForCategory = async (categoryId) => {
    if (coursesByCategory[categoryId] || loadingCoursesByCategory[categoryId]) {
      return;
    }

    try {
      setLoadingCoursesByCategory((prev) => ({
        ...prev,
        [categoryId]: true,
      }));

      const res = await fetch(
        `${API_BASE_URL}/api/moodle/category/${categoryId}/courses`
      );

      if (!res.ok) {
        throw new Error("No se pudieron cargar las materias");
      }

      const data = await res.json();

      let courses = [];
      if (Array.isArray(data)) {
        courses = data;
      } else if (Array.isArray(data?.courses)) {
        courses = data.courses;
      }

      setCoursesByCategory((prev) => ({
        ...prev,
        [categoryId]: courses,
      }));

      setLoadingCoursesByCategory((prev) => ({
        ...prev,
        [categoryId]: false,
      }));
    } catch (error) {
      setCoursesByCategory((prev) => ({
        ...prev,
        [categoryId]: [],
      }));

      setLoadingCoursesByCategory((prev) => ({
        ...prev,
        [categoryId]: false,
      }));
    }
  };

  const toggleYear = async (category) => {
    const categoryId = category.id;
    const isOpen = expandedYears[categoryId];

    setExpandedYears((prev) => ({
      ...prev,
      [categoryId]: !prev[categoryId],
    }));

    if (!isOpen) {
      await loadCoursesForCategory(categoryId);
    }
  };

  const openCourseDetails = async (course) => {
    setSelectedCourse(course);
    setView("course-details");
    setLoadingDetails(true);
    setDetailsError("");
    setParticipants([]);
    setAssignments([]);

    try {
      const [participantsRes, assignmentsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/moodle/courses/${course.id}/participants`),
        fetch(`${API_BASE_URL}/api/moodle/courses/${course.id}/assignments`),
      ]);

      if (!participantsRes.ok) {
        throw new Error("No se pudieron cargar los participantes");
      }

      if (!assignmentsRes.ok) {
        throw new Error("No se pudieron cargar las tareas");
      }

      const participantsData = await participantsRes.json();
      const assignmentsData = await assignmentsRes.json();

      setParticipants(Array.isArray(participantsData) ? participantsData : []);

      const courseAssignments = Array.isArray(assignmentsData?.courses?.[0]?.assignments)
        ? assignmentsData.courses[0].assignments
        : [];

      setAssignments(courseAssignments);
      setLoadingDetails(false);
    } catch (error) {
      setDetailsError(error.message);
      setLoadingDetails(false);
    }
  };

  const openStudentReport = async (courseId, student) => {
    setSelectedStudent(student);
    setView("student-report");
    setLoadingReport(true);
    setStudentReport(null);
    setStudentOutline([]);

    try {
      const [reportRes, outlineRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/moodle/courses/${courseId}/users/${student.id}/report`),
        fetch(`${API_BASE_URL}/api/moodle/courses/${courseId}/users/${student.id}/outline`)
      ]);

      if (!reportRes.ok || !outlineRes.ok) throw new Error("No se pudo cargar el informe completo");

      const reportData = await reportRes.json();
      const outlineData = await outlineRes.json();

      setStudentReport(reportData?.usergrades?.[0] || null);
      setStudentOutline(Array.isArray(outlineData) ? outlineData : []);
      
      setLoadingReport(false);
    } catch (error) {
      setDetailsError(error.message);
      setLoadingReport(false);
    }
  };

  /* =========================
     DOCS FUNCTIONS
  ========================= */
  const loadAllReadStatuses = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/docs/read-status`);
      if (res.ok) {
        const data = await res.json();
        setAllReadStatuses(data);
      }
    } catch (error) {
      console.error("Error cargando los estados locales de la bandeja:", error);
    }
  };

  const normalizeDocsData = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  };

  const getStatusLabel = (status) => {
    if (!status) return "SIN ESTADO";
    const upper = String(status).toUpperCase();

    if (upper.includes("PEND")) return "PENDIENTE";
    if (upper.includes("PROCES")) return "EN PROCESO";
    if (upper.includes("FINAL")) return "FINALIZADO";

    return upper;
  };

  const getLocalReadLabel = () => {
    if (memoReadStatus.lecturaConfirmada) return "LECTURA CONFIRMADA";
    if (memoReadStatus.visto) return "VISTO";
    return "NO VISTO";
  };

  const getLocalReadClass = () => {
    if (memoReadStatus.lecturaConfirmada) return "local-read-confirmed";
    if (memoReadStatus.visto) return "local-read-viewed";
    return "local-read-pending";
  };

  const loadMemoReadStatus = (memoId) => {
    const status = allReadStatuses[memoId] || {
      visto: false,
      lecturaConfirmada: false,
      updatedAt: null,
    };
    setMemoReadStatus(status);
  };

  const openDocsView = async (tab = "INBOX") => {
    if (!canAccessModule(user, MODULE_KEYS.docs)) return;

    setView("docs");
    setDocsTab(tab);
    setSelectedMemo(null);
    setSelectedMemoDetail(null);
    setMemoError("");
    closePreviewFile();

    loadAllReadStatuses();

    if (docsLoaded) return;

    try {
      setDocsLoading(true);
      setDocsError("");

      const [inboxRes, sentRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/docs/inbox`),
        fetch(`${API_BASE_URL}/api/docs/sent`),
      ]);

      if (!inboxRes.ok) throw new Error("No se pudo cargar la bandeja de entrada");
      if (!sentRes.ok) throw new Error("No se pudo cargar enviados");

      const inboxData = await inboxRes.json();
      const sentData = await sentRes.json();

      setDocsInbox(normalizeDocsData(inboxData));
      setDocsSent(normalizeDocsData(sentData));
      setDocsLoaded(true);
      setDocsLoading(false);
    } catch (error) {
      setDocsError(error.message);
      setDocsLoading(false);
    }
  };

  const changeDocsTab = (tab) => {
    setDocsTab(tab);
    setSelectedMemo(null);
    setSelectedMemoDetail(null);
    setMemoError("");
    closePreviewFile();
  };

  const currentDocs = docsTab === "INBOX" ? docsInbox : docsSent;

  const filteredDocs = useMemo(() => {
    if (docsFilter === "TODOS") return currentDocs;
    return currentDocs.filter(
      (doc) => getStatusLabel(doc.status) === docsFilter
    );
  }, [currentDocs, docsFilter]);

  const openMemoDetails = async (memo) => {
    setSelectedMemo(memo);
    setSelectedMemoDetail(null);
    setMemoLoading(true);
    setMemoError("");
    setPreviewFile(null);
    setView("docs-detail");

    try {
      loadMemoReadStatus(memo.id);
      const detailRes = await fetch(`${API_BASE_URL}/api/docs/document/${memo.id}`);

      if (!detailRes.ok) {
        throw new Error("No se pudo cargar el detalle del memorándum");
      }

      const data = await detailRes.json();
      const detail = Array.isArray(data?.data) ? data.data[0] : data?.data || data;

      setSelectedMemoDetail(detail || null);
      setMemoLoading(false);
    } catch (error) {
      setMemoError(error.message);
      setMemoLoading(false);
    }
  };

  const markMemoAsRead = async () => {
    if (!memoToShow?.id) return;
    const optimisticData = { ...memoReadStatus, visto: true, updatedAt: new Date().toISOString() };
    setMemoReadStatus(optimisticData);
    setAllReadStatuses((prev) => ({ ...prev, [memoToShow.id]: optimisticData }));

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/docs/read-status/${memoToShow.id}/viewed`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!res.ok) {
        throw new Error("No se pudo marcar como visto");
      }

      const data = await res.json();
      setMemoReadStatus(data);
      setAllReadStatuses((prev) => ({ ...prev, [memoToShow.id]: data }));
    } catch (error) {
      alert(error.message);
    }
  };

  const confirmMemoRead = async () => {
    if (!memoToShow?.id) return;
    const optimisticData = { ...memoReadStatus, visto: true, lecturaConfirmada: true, updatedAt: new Date().toISOString() };
    setMemoReadStatus(optimisticData);
    setAllReadStatuses((prev) => ({ ...prev, [memoToShow.id]: optimisticData }));

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/docs/read-status/${memoToShow.id}/confirmed`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!res.ok) {
        throw new Error("No se pudo confirmar la lectura");
      }

      const data = await res.json();
      setMemoReadStatus(data);
      setAllReadStatuses((prev) => ({ ...prev, [memoToShow.id]: data }));
    } catch (error) {
      alert(error.message);
    }
  };

  const openFinanceView = () => {
    if (!canAccessModule(user, MODULE_KEYS.finance)) return;
    setView("finance");
  };

  const memoToShow = selectedMemoDetail || selectedMemo;
  const memoFiles = Array.isArray(memoToShow?.files) ? memoToShow.files : [];
  const memoHistory = Array.isArray(memoToShow?.history) ? memoToShow.history : [];

  // Ordenamos los participantes para que los profesores aparezcan primero
  const sortedParticipants = useMemo(() => {
    return [...participants].sort((a, b) => {
      const aIsTeacher = a.roles?.some(r => r.shortname === 'editingteacher' || r.shortname === 'teacher');
      const bIsTeacher = b.roles?.some(r => r.shortname === 'editingteacher' || r.shortname === 'teacher');
      
      if (aIsTeacher && !bIsTeacher) return -1; // 'a' sube
      if (!aIsTeacher && bIsTeacher) return 1;  // 'b' sube
      return 0; // se quedan igual
    });
  }, [participants]);

  const handleLogin = (username, password) => {
    // Credenciales hardcodeadas para el ejemplo
    if (username === "admin" && password === "admin123") {
      setUser({ username: "Administrador", role: "admin" });
    } else if (username === "tesoreria" && password === "teso123") {
      setUser({ username: "Departamento de Tesorería", role: "finance" });
      setView("finance"); // Ir directamente a finanzas
    } else {
      alert("Usuario o contraseña incorrectos");
    }
  };

  const handleLogout = () => {
    if (user?.id) {
      Object.keys(MAILBOX_CONFIG).forEach((accountKey) => {
        localStorage.removeItem(getMailReadStorageKey(user.id, accountKey));
      });
    }
    setUser(null);
    setView("home");
  };

  const handleAuthLogin = (username, password) => {
    const authenticatedUser = authenticateUser(username, password);

    if (!authenticatedUser) {
      alert("Usuario o contraseÃ±a incorrectos");
      return;
    }

    setUser(authenticatedUser);
    setView("home");
  };

  const logoutUser = () => {
    if (user?.id) {
      Object.keys(MAILBOX_CONFIG).forEach((accountKey) => {
        localStorage.removeItem(getMailReadStorageKey(user.id, accountKey));
      });
    }

    setUser(null);
    setView("home");
  };

  const roleAwareHomeCards = [
    {
      moduleKey: MODULE_KEYS.communication,
      title: "Comunicacion Interna",
      description: "Canal privado entre usuarios del panel para mensajes importantes y adjuntos.",
      icon: "\uD83D\uDCAC",
      action: "Coordinar",
      tone: "blue",
      accent: "Interno",
      priority: "featured",
      onClick: openCommunicationView,
    },
    {
      moduleKey: MODULE_KEYS.mailPersonal,
      mailboxKey: "personal",
      title: "Correo Personal",
      description: "Bandeja de entrada, enviados y spam con seguimiento local.",
      icon: "\uD83D\uDCE7",
      action: "Mensajes",
      tone: "blue",
      accent: "Comunicacion",
      priority: "primary",
      onClick: () => openMailView("personal", "INBOX"),
    },
    {
      moduleKey: MODULE_KEYS.mailInstitutional,
      mailboxKey: "institutional",
      title: "Correo Institucional",
      description: "Microsoft 365 dentro del panel con lectura interna y detalle enriquecido.",
      icon: "\uD83C\uDFE2",
      action: "Outlook",
      tone: "green",
      accent: "Microsoft 365",
      priority: "secondary",
      onClick: () => openMailView("institutional", "INBOX"),
    },
    {
      moduleKey: MODULE_KEYS.onedrive,
      title: "OneDrive",
      description: "Acceso persistente a la nube institucional con navegacion restaurable.",
      icon: "\u2601\uFE0F",
      action: "Explorar",
      tone: "light-blue",
      accent: "Archivos",
      priority: "featured",
      onClick: openOneDriveView,
    },
    {
      moduleKey: MODULE_KEYS.docs,
      title: "UNAMIS DOCS",
      description: "Bandeja documental, memorandums y control interno de lectura.",
      icon: "\uD83D\uDCC1",
      action: "Revisar",
      tone: "orange",
      accent: "Gestion",
      priority: "secondary",
      onClick: () => openDocsView("INBOX"),
    },
    {
      moduleKey: MODULE_KEYS.moodle,
      title: "Moodle",
      description: "Comunidad de aprendizaje con carreras, cursos y reportes academicos.",
      icon: "\uD83C\uDF93",
      action: "Campus",
      tone: "purple",
      accent: "Academico",
      priority: "secondary",
      onClick: openMoodleView,
    },
    {
      moduleKey: MODULE_KEYS.finance,
      title: "Equilibrio Mensual",
      description: "Control de ingresos, gastos y presupuesto de la sede con lectura rapida.",
      icon: "\uD83D\uDCCA",
      action: "Balance",
      tone: "light-blue",
      accent: "Finanzas",
      priority:
        canAccessModule(user, MODULE_KEYS.finance) && getAccessibleModuleCount(user) === 1
          ? "featured"
          : "secondary",
      onClick: openFinanceView,
    },
  ].filter(
    (card) =>
      canAccessModule(user, card.moduleKey) &&
      (!card.mailboxKey || canAccessMailbox(user, card.mailboxKey))
  );

  const roleAwareHighlights = [
    {
      label: "Modulos activos",
      value: String(roleAwareHomeCards.length).padStart(2, "0"),
      hint: "Herramientas disponibles hoy",
    },
    {
      label: "Sesion",
      value: user?.roleLabel || user?.role || "Invitado",
      hint: "Acceso persistente en este dispositivo",
    },
  ];

  if (!user) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <img src={logo} alt="UNAMIS" className="login-logo" />
          <h2>Panel UNAMIS</h2>
          <p>Sede Santa Rosa</p>
          <form onSubmit={(e) => {
            e.preventDefault();
            handleAuthLogin(e.target.username.value, e.target.password.value);
          }}>
            <div className="form-group" style={{ textAlign: 'left' }}>
              <label>Usuario</label>
              <input name="username" type="text" className="form-control" required />
            </div>
            <div className="form-group" style={{ textAlign: 'left', marginTop: '15px' }}>
              <label>Contraseña</label>
              <input name="password" type="password" className="form-control" required />
            </div>
            <button type="submit" className="btn-submit" style={{ marginTop: '20px' }}>Iniciar Sesión</button>
          </form>
        </div>
      </div>
    );
  }

  const homeCards = [
    ...(user?.role === "admin"
      ? [
          {
            title: "Correo Personal",
            description: "Bandeja de entrada, enviados y spam con seguimiento local.",
            icon: "📧",
            action: "Mensajes",
            tone: "blue",
            accent: "Comunicación",
            priority: "primary",
            onClick: () => openMailView("personal", "INBOX"),
          },
          {
            title: "Correo Institucional",
            description: "Microsoft 365 dentro del panel con lectura interna y detalle enriquecido.",
            icon: "🏢",
            action: "Outlook",
            tone: "green",
            accent: "Microsoft 365",
            priority: "secondary",
            onClick: () => openMailView("institutional", "INBOX"),
          },
          {
            title: "OneDrive",
            description: "Acceso persistente a la nube institucional con navegación restaurable.",
            icon: "☁️",
            action: "Explorar",
            tone: "light-blue",
            accent: "Archivos",
            priority: "featured",
            onClick: openOneDriveView,
          },
          {
            title: "UNAMIS DOCS",
            description: "Bandeja documental, memorándums y control interno de lectura.",
            icon: "📁",
            action: "Revisar",
            tone: "orange",
            accent: "Gestión",
            priority: "secondary",
            onClick: () => openDocsView("INBOX"),
          },
          {
            title: "Moodle",
            description: "Comunidad de aprendizaje con carreras, cursos y reportes académicos.",
            icon: "🎓",
            action: "Campus",
            tone: "purple",
            accent: "Académico",
            priority: "secondary",
            onClick: openMoodleView,
          },
        ]
      : []),
    {
      title: "Equilibrio Mensual",
      description: "Control de ingresos, gastos y presupuesto de la sede con lectura rápida.",
      icon: "📊",
      action: "Balance",
      tone: "light-blue",
      accent: "Finanzas",
      priority: user?.role === "finance" ? "featured" : "secondary",
      onClick: () => setView("finance"),
    },
  ];

  const accessibleHomeCards = [
    {
      moduleKey: MODULE_KEYS.mailPersonal,
      mailboxKey: "personal",
      title: "Correo Personal",
      description: "Bandeja de entrada, enviados y spam con seguimiento local.",
      icon: "ðŸ“§",
      action: "Mensajes",
      tone: "blue",
      accent: "ComunicaciÃ³n",
      priority: "primary",
      onClick: () => openMailView("personal", "INBOX"),
    },
    {
      moduleKey: MODULE_KEYS.mailInstitutional,
      mailboxKey: "institutional",
      title: "Correo Institucional",
      description: "Microsoft 365 dentro del panel con lectura interna y detalle enriquecido.",
      icon: "ðŸ¢",
      action: "Outlook",
      tone: "green",
      accent: "Microsoft 365",
      priority: "secondary",
      onClick: () => openMailView("institutional", "INBOX"),
    },
    {
      moduleKey: MODULE_KEYS.onedrive,
      title: "OneDrive",
      description: "Acceso persistente a la nube institucional con navegaciÃ³n restaurable.",
      icon: "â˜ï¸",
      action: "Explorar",
      tone: "light-blue",
      accent: "Archivos",
      priority: "featured",
      onClick: openOneDriveView,
    },
    {
      moduleKey: MODULE_KEYS.docs,
      title: "UNAMIS DOCS",
      description: "Bandeja documental, memorÃ¡ndums y control interno de lectura.",
      icon: "ðŸ“",
      action: "Revisar",
      tone: "orange",
      accent: "GestiÃ³n",
      priority: "secondary",
      onClick: () => openDocsView("INBOX"),
    },
    {
      moduleKey: MODULE_KEYS.moodle,
      title: "Moodle",
      description: "Comunidad de aprendizaje con carreras, cursos y reportes acadÃ©micos.",
      icon: "ðŸŽ“",
      action: "Campus",
      tone: "purple",
      accent: "AcadÃ©mico",
      priority: "secondary",
      onClick: openMoodleView,
    },
    {
      moduleKey: MODULE_KEYS.finance,
      title: "Equilibrio Mensual",
      description: "Control de ingresos, gastos y presupuesto de la sede con lectura rÃ¡pida.",
      icon: "ðŸ“Š",
      action: "Balance",
      tone: "light-blue",
      accent: "Finanzas",
      priority: canAccessModule(user, MODULE_KEYS.finance) && getAccessibleModuleCount(user) === 1 ? "featured" : "secondary",
      onClick: openFinanceView,
    },
  ].filter((card) => (
    canAccessModule(user, card.moduleKey) &&
    (!card.mailboxKey || canAccessMailbox(user, card.mailboxKey))
  ));

  const homeHighlights = [
    {
      label: "Módulos activos",
      value: String(homeCards.length).padStart(2, "0"),
      hint: "Herramientas disponibles hoy",
    },
    {
      label: "Sesión",
      value: user?.role === "admin" ? "Admin" : "Finance",
      hint: "Acceso persistente en este dispositivo",
    },
  ];

  const dashboardHighlights = [
    {
      label: "MÃ³dulos activos",
      value: String(accessibleHomeCards.length).padStart(2, "0"),
      hint: "Herramientas disponibles hoy",
    },
    {
      label: "SesiÃ³n",
      value: user?.roleLabel || user?.role || "Invitado",
      hint: "Acceso persistente en este dispositivo",
    },
  ];

  return (
    <div className="page">
      <DashboardBackground />

      <main className="container">
        <header className="hero">
          <div className="hero-orbit" aria-hidden="true">
            <span className="hero-orbit-ring ring-a"></span>
            <span className="hero-orbit-ring ring-b"></span>
            <span className="hero-orbit-dot dot-a"></span>
            <span className="hero-orbit-dot dot-b"></span>
          </div>

          <div className="logo-container hero-logo-shell">
            <div className="hero-logo-glow"></div>
            <img src={logo} alt="UNAMIS" className="logo" />
          </div>

          <div className="hero-content">
            <div className="hero-badge">Administración Interina</div>
            <p className="mini-text">Centro operativo con acceso rápido, continuidad visual y foco institucional</p>
            <h1 className="hero-title">Panel UNAMIS</h1>
            <p className="subtitle">Dirección Sede Santa Rosa</p>
            <p className="description">
              Un entorno interno más claro, más dinámico y más cómodo para trabajar entre correo,
              documentos, nube institucional, aula virtual y finanzas.
            </p>

            <div className="hero-actions-row">
              <p className="description welcome-line">
                Bienvenido, <strong>{user.displayName || user.username}</strong>
              </p>
              <button onClick={logoutUser} className="memo-action ghost hero-logout">
                Cerrar Sesión
              </button>
            </div>
          </div>

          <aside className="hero-panel">
            <div className="hero-panel-header">
              <span className="hero-panel-kicker">Pulso del panel</span>
              <span className="hero-panel-live"></span>
            </div>
            <div className="hero-stats">
              {roleAwareHighlights.map((item) => (
                <div key={item.label} className="hero-stat-card">
                  <span>{item.label}</span>
                  <AnimatedStatValue value={item.value} />
                  <small>{item.hint}</small>
                </div>
              ))}
            </div>
          </aside>
        </header>

        {view === "home" && (
          <>
            <section className="home-intro-panel">
              <div className="section-title home-section-title">
                <h2>Accesos principales</h2>
                <p>Una portada más viva para entrar más rápido a lo que realmente usas todos los días.</p>
              </div>

              <div className="home-marquee" aria-hidden="true">
                <span>Comunicacion</span>
                <span>Correo</span>
                <span>OneDrive</span>
                <span>Docs</span>
                <span>Moodle</span>
                <span>Finanzas</span>
                <span>Panel UNAMIS</span>
              </div>
            </section>

            <section className="grid home-grid">
              {roleAwareHomeCards.map((card, index) => (
                <button
                  key={card.title}
                  type="button"
                  className={`card ${card.tone} card-button-reset card-animated card-priority-${card.priority}`}
                  onClick={card.onClick}
                  style={{ animationDelay: `${index * 90}ms` }}
                >
                  <div className="card-glow"></div>
                  <div className="card-noise"></div>
                  <div className="card-top">
                    <div className="card-top-main">
                      <span className="icon">{card.icon}</span>
                      <div className="card-chip-row">
                        <span className="card-accent-tag">{card.accent}</span>
                        <span className="open-text">{card.action}</span>
                      </div>
                    </div>
                  </div>
                  <div className="card-content">
                    <h3>{card.title}</h3>
                    <p>{card.description}</p>
                  </div>
                  <div className="card-footer">
                    <span className="card-link-text">Entrar al módulo</span>
                    <span className="card-arrow">↗</span>
                  </div>
                </button>
              ))}
            </section>
          </>
        )}

        {view === "communication" && (
          <>
            <section className="moodle-header">
              <div>
                <p className="moodle-tag">Canal institucional</p>
                <h2>Comunicacion interna</h2>
                <p className="moodle-subtitle">
                  Conversaciones privadas entre usuarios del panel para coordinacion, enlaces y
                  archivos relevantes.
                </p>
              </div>

              <button
                type="button"
                className="back-button"
                onClick={() => setView("home")}
              >
                ← Volver al inicio
              </button>
            </section>

            <section className="communication-layout">
              <aside className="communication-sidebar">
                <div className="communication-panel">
                  <div className="communication-panel-head">
                    <div>
                      <p className="communication-kicker">Nuevo envio</p>
                      <h3>Mensaje interno</h3>
                    </div>
                    <span className="communication-private-pill">Privado</span>
                  </div>

                  <form className="communication-compose" onSubmit={submitInternalMessage}>
                    <div className="communication-field-grid">
                      <label className="communication-field">
                        <span>Remitente</span>
                        <div className="communication-readonly-field">
                          <strong>{user.displayName || user.username}</strong>
                          <small>{user.roleLabel || user.role}</small>
                        </div>
                      </label>

                      <label className="communication-field">
                        <span>Destinatario</span>
                        <select
                          value={recipientUserId}
                          onChange={(event) => setRecipientUserId(event.target.value)}
                        >
                          <option value="">Seleccionar usuario</option>
                          {communicationRecipients.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.displayName} · {entry.roleLabel}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="communication-field-grid compact">
                      <label className="communication-field">
                        <span>Filtrar destinatarios por rol</span>
                        <select
                          value={communicationRoleFilter}
                          onChange={(event) => setCommunicationRoleFilter(event.target.value)}
                        >
                          <option value="all">Todos los roles</option>
                          {communicationRoleOptions.map((entry) => (
                            <option key={entry.role} value={entry.role}>
                              {entry.roleLabel}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="communication-field">
                        <span>Asunto</span>
                        <input
                          type="text"
                          value={messageSubject}
                          onChange={(event) => setMessageSubject(event.target.value)}
                          placeholder="Ej. Revision de presupuesto o enlace urgente"
                        />
                      </label>

                      <label className="communication-field">
                        <span>Prioridad</span>
                        <select
                          value={messagePriority}
                          onChange={(event) => setMessagePriority(event.target.value)}
                        >
                          <option value="low">Baja</option>
                          <option value="normal">Normal</option>
                          <option value="high">Alta</option>
                        </select>
                      </label>
                    </div>

                    <label className="communication-field">
                      <span>Mensaje</span>
                      <textarea
                        rows="4"
                        value={messageText}
                        onChange={(event) => setMessageText(event.target.value)}
                        placeholder="Redacta aqui la comunicacion institucional..."
                      />
                    </label>

                    <label className="communication-upload">
                      <span>Adjuntar archivos</span>
                      <input
                        type="file"
                        multiple
                        onChange={(event) =>
                          setMessageFiles(Array.from(event.target.files || []))
                        }
                      />
                      <small>Railway guardara estos adjuntos en el backend actual.</small>
                    </label>

                    {messageFiles.length > 0 && (
                      <div className="communication-file-list">
                        {messageFiles.map((file) => (
                          <span key={`${file.name}-${file.lastModified}`} className="communication-file-pill">
                            {file.name} · {formatBytes(file.size)}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="communication-compose-actions">
                      <button
                        type="button"
                        className="memo-action ghost"
                        onClick={() => {
                          setMessageText("");
                          setMessageFiles([]);
                        }}
                      >
                        Limpiar
                      </button>

                      <button
                        type="submit"
                        className="memo-action blue"
                        disabled={sendingMessage}
                      >
                        {sendingMessage ? "Enviando..." : "Enviar mensaje"}
                      </button>
                    </div>
                  </form>
                </div>

                <div className="communication-panel">
                  <div className="communication-panel-head">
                    <div>
                      <p className="communication-kicker">Bandeja privada</p>
                      <h3>Conversaciones</h3>
                    </div>
                    <button
                      type="button"
                      className="memo-action ghost"
                      onClick={() => openCommunicationView()}
                    >
                      Actualizar
                    </button>
                  </div>

                  {communicationLoading && (
                    <div className="status-box">Cargando conversaciones internas...</div>
                  )}

                  {!communicationLoading && conversations.length === 0 && !communicationError && (
                    <div className="status-box">
                      Todavia no hay conversaciones. Puedes iniciar una desde el formulario.
                    </div>
                  )}

                  {!communicationLoading && conversations.length > 0 && (
                    <div className="communication-conversation-list">
                      {conversations.map((conversation) => {
                        const partner = userDirectoryMap.get(
                          conversation.participants.find((participantId) => participantId !== user.id)
                        );

                        return (
                          <button
                            key={conversation.id}
                            type="button"
                            className={`communication-conversation-card ${
                              selectedConversationId === conversation.id ? "active" : ""
                            }`}
                            onClick={() => openConversation(conversation.id)}
                          >
                            <div className="communication-conversation-top">
                              <strong>{partner?.displayName || "Usuario interno"}</strong>
                              <span>{formatMailDate(conversation.updatedAt || conversation.createdAt)}</span>
                            </div>
                            <p>{conversation.subject || "Sin asunto"}</p>
                            <small>
                              {conversation.lastMessage?.text || "Adjunto o mensaje sin texto"}
                            </small>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </aside>

              <section className="communication-thread-panel">
                <div className="communication-panel communication-thread-shell">
                  <div className="communication-panel-head">
                    <div>
                      <p className="communication-kicker">Chat interno</p>
                      <h3>
                        {selectedConversationPartner?.displayName || "Selecciona una conversacion"}
                      </h3>
                    </div>
                    <span className="communication-priority">
                      {selectedConversation?.priority || messagePriority || "normal"}
                    </span>
                  </div>

                  {selectedConversation && (
                    <div className="communication-thread-meta">
                      <span>{selectedConversation.subject || "Sin asunto"}</span>
                      <span>{selectedConversationPartner?.roleLabel || "Rol interno"}</span>
                    </div>
                  )}

                  {conversationMessagesLoading && (
                    <div className="status-box">Cargando mensajes internos...</div>
                  )}

                  {!conversationMessagesLoading &&
                    !selectedConversation &&
                    !communicationError && (
                      <div className="status-box">
                        Elige una conversacion existente o inicia una nueva desde la izquierda.
                      </div>
                    )}

                  {!conversationMessagesLoading && selectedConversation && (
                    <div className="communication-thread">
                      {conversationMessages.length === 0 ? (
                        <div className="status-box">
                          Esta conversacion aun no tiene mensajes visibles.
                        </div>
                      ) : (
                        conversationMessages.map((message) => {
                          const sender = userDirectoryMap.get(message.senderId);
                          const ownMessage = message.senderId === user.id;

                          return (
                            <article
                              key={message.id}
                              className={`communication-message ${
                                ownMessage ? "own" : "incoming"
                              }`}
                            >
                              <div className="communication-message-meta">
                                <strong>{ownMessage ? "Tu mensaje" : sender?.displayName || "Usuario"}</strong>
                                <span>{formatMailDate(message.createdAt)}</span>
                              </div>

                              {message.text ? <p>{message.text}</p> : <p>Archivo adjunto sin texto.</p>}

                              {Array.isArray(message.attachments) &&
                                message.attachments.length > 0 && (
                                  <div className="communication-attachment-list">
                                    {message.attachments.map((attachment) => (
                                      <a
                                        key={attachment.id}
                                        className="communication-attachment"
                                        href={`${API_BASE_URL}${attachment.url}`}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {attachment.name} · {formatBytes(attachment.size)}
                                      </a>
                                    ))}
                                  </div>
                                )}
                            </article>
                          );
                        })
                      )}
                    </div>
                  )}

                  {(communicationError || conversationMessagesError) && (
                    <div className="status-box error-box">
                      {communicationError || conversationMessagesError}
                    </div>
                  )}
                </div>
              </section>
            </section>
          </>
        )}

        {view === "mail" && (
          <>
            <section className="moodle-header">
              <div>
                <p className="moodle-tag">{currentMailConfig.badge}</p>
                <h2>{currentMailConfig.heading}</h2>
                <p className="moodle-subtitle">
                  {currentMailConfig.subtitle}
                </p>
              </div>

              <button
                type="button"
                className="back-button"
                onClick={() => setView("home")}
              >
                ← Volver al inicio
              </button>
            </section>

            <section className="docs-toolbar">
              <div className="docs-tabs">
                <button
                  className={`docs-tab ${mailTab === "INBOX" ? "active" : ""}`}
                  onClick={() => changeMailTab("INBOX")}
                >
                  Bandeja de entrada
                </button>

                <button
                  className={`docs-tab ${mailTab === "SENT" ? "active" : ""}`}
                  onClick={() => changeMailTab("SENT")}
                >
                  Enviados
                </button>

                <button
                  className={`docs-tab ${mailTab === "SPAM" ? "active" : ""}`}
                  onClick={() => changeMailTab("SPAM")}
                >
                  Spam
                </button>
              </div>
            </section>

            {currentMailState.loading && (
              <div className="status-box">Cargando correos...</div>
            )}

            {currentMailState.error && (
              <div className="status-box error-box">{currentMailState.error}</div>
            )}

            {!currentMailState.loading && !currentMailState.error && (
              <section className="docs-list">
                {currentMailList.length === 0 ? (
                  <div className="status-box">No hay correos para mostrar.</div>
                ) : (
                  currentMailList.map((mail) => {
                    const isLocallyRead = isMailReadLocally(mail.id);

                    return (
                      <div className="doc-card" key={mail.id}>
                        <div className="doc-main">
                          <div className="doc-topline">
                            <span className="doc-exp">
                              {mailTab === "SENT" ? "Enviado a" : "De"}
                            </span>

                            <span
                              className={`doc-status ${
                                isLocallyRead ? "status-finalizado" : "status-en-proceso"
                              }`}
                            >
                              {isLocallyRead ? "LEÍDO INTERNO" : "PENDIENTE"}
                            </span>
                          </div>

                          <h3>{mail.subject || "Sin asunto"}</h3>

                          <p className="doc-desc">
                            {mail.bodyPreview || "Sin vista previa"}
                          </p>

                          <div className="doc-meta">
                            <span>
                              <b>{mailTab === "SENT" ? "Para:" : "Remitente:"}</b>{" "}
                              {mailTab === "SENT" ? getMailRecipients(mail) : getMailSender(mail)}
                            </span>
                            <span>
                              <b>Fecha:</b>{" "}
                              {formatMailDate(mail.receivedDateTime || mail.sentDateTime)}
                            </span>
                          </div>
                        </div>

                        <div className="doc-actions-container">
                          {mail.hasAttachments ? (
                            <span className="badge-visto">
                              <span className="dot dot-green"></span> ADJUNTOS
                            </span>
                          ) : (
                            <span className="badge-nuevo">
                              <span className="dot dot-red"></span> SIN ADJUNTOS
                            </span>
                          )}

                          <button
                            className="memo-action ghost"
                            type="button"
                            onClick={() => toggleLocalMailRead(mail.id)}
                          >
                            {isLocallyRead ? "Desmarcar" : "Marcar leído"}
                          </button>

                          <button
                            className="course-button"
                            onClick={() => openMailDetail(mail)}
                          >
                            Abrir correo
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </section>
            )}
          </>
        )}

        {view === "mail-detail" && mailToShow && (
          <>
            <section className="memo-detail-shell">
              <div className="memo-top-red">
                <div>
                  <p className="memo-top-kicker">Detalle del correo</p>
                  <h2>{mailToShow.subject || "Sin asunto"}</h2>
                </div>

                <div className="memo-top-badges">
                  <span className="memo-pill">
                    {isCurrentMailReadLocally ? "LEÍDO INTERNO" : "PENDIENTE"}
                  </span>
                  <span className="memo-pill">
                    {mailToShow.importance || "normal"}
                  </span>
                </div>
              </div>

              <div className="memo-top-actions">
                <button
                  className="memo-action ghost"
                  onClick={() => toggleLocalMailRead(mailToShow.id)}
                >
                  {isCurrentMailReadLocally ? "Desmarcar leído" : "Marcar como leído"}
                </button>
                <button
                  className="memo-action blue"
                  onClick={() => setView("mail")}
                >
                  Volver
                </button>
              </div>

              {currentMailState.detailLoading && (
                <div className="status-box">Cargando detalle del correo...</div>
              )}

              {currentMailState.detailError && (
                <div className="status-box error-box">{currentMailState.detailError}</div>
              )}

              {!currentMailState.detailLoading && !currentMailState.detailError && (
                <div className="memo-detail-grid">
                  <section className="memo-panel large">
                    <h3>Información del correo</h3>

                    <div className="memo-info-grid">
                      <div className="memo-info-card">
                        <span>Asunto</span>
                        <strong>{mailToShow.subject || "Sin asunto"}</strong>
                      </div>

                      <div className="memo-info-card">
                        <span>De</span>
                        <strong>{getMailSender(mailToShow)}</strong>
                      </div>

                      <div className="memo-info-card">
                        <span>Fecha</span>
                        <strong>
                          {formatMailDate(mailToShow.receivedDateTime || mailToShow.sentDateTime)}
                        </strong>
                      </div>
                    </div>

                    <div className="memo-block">
                      <h4>Destinatarios</h4>
                      <div className="memo-detail-card">
                        <p>{getMailRecipients(mailToShow)}</p>
                      </div>
                    </div>

                    <div className="memo-block">
                      <h4>Vista previa</h4>
                      <div className="memo-detail-card">
                        <p>{mailToShow.bodyPreview || "Sin vista previa"}</p>
                      </div>
                    </div>
                  </section>

                  <section className="memo-panel side">
                    <h3>Resumen</h3>
                    <div className="detail-list">
                      <div className="detail-item">
                        <strong>Estado</strong>
                        <span>{isCurrentMailReadLocally ? "LEÍDO INTERNO" : "PENDIENTE"}</span>
                      </div>
                      <div className="detail-item">
                        <strong>Importancia</strong>
                        <span>{mailToShow.importance || "Normal"}</span>
                      </div>
                      <div className="detail-item">
                        <strong>Adjuntos</strong>
                        <span>{mailToShow.hasAttachments ? "Sí" : "No"}</span>
                      </div>
                    </div>
                  </section>

                  <section className="memo-panel large">
                    <h3>Contenido</h3>
                    <div className="memo-detail-card">
                      <div
                        dangerouslySetInnerHTML={{
                          __html: hydratedMailBody,
                        }}
                      />
                    </div>
                  </section>
                </div>
              )}
            </section>
          </>
        )}

        {view === "onedrive" && (
          <>
            <section className="moodle-header">
              <div>
                <p className="moodle-tag">Nube Institucional</p>
                <h2>Documentos de OneDrive</h2>

                <div
                  className="moodle-subtitle"
                  style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}
                >
                  <strong>Ruta:</strong>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                    {folderHistory.map((fh, idx) => (
                      <span
                        key={`${fh.id ?? "root"}-${idx}`}
                        style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                      >
                        <span>{fh.name}</span>
                        {idx < folderHistory.length - 1 && <span aria-hidden="true">{">"}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                {folderHistory.length > 1 && (
                  <button type="button" className="memo-action ghost" onClick={goBackOneDrive}>
                    ↑ Volver atrás
                  </button>
                )}
                <button type="button" className="back-button" onClick={() => setView("home")}>
                  X Cerrar OneDrive
                </button>
              </div>
            </section>

            {onedriveLoading && (
              <div className="status-box">Conectando con Microsoft 365 y cargando archivos...</div>
            )}

            {onedriveError && (
              <div className="status-box error-box">{onedriveError}</div>
            )}

            {!onedriveLoading && !onedriveError && (
              <section className="onedrive-list-container">
                {onedriveFiles.length === 0 ? (
                  <div className="status-box">Esta carpeta está vacía.</div>
                ) : (
                  <table className="onedrive-table">
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>Modificado</th>
                        <th>Tamaño / Elementos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {onedriveFiles.filter(Boolean).map((file, index) => {
                        const itemData = file?.remoteItem || file || {};
                        const isFolder = !!itemData.folder;
                        const icon = isFolder ? "📁" : "📄";
                        const itemName = itemData.name || file.name || "Archivo sin nombre";
                        const rowKey = file?.id || itemData?.id || `${itemName}-${index}`;

                        return (
                          <tr
                            key={rowKey}
                            className="onedrive-row"
                            onClick={() => {
                              if (isFolder) {
                                openOneDriveFolder(itemData.id, itemName);
                              } else if (itemData.webUrl || itemData?.["@microsoft.graph.downloadUrl"]) {
                                openOneDriveFilePreview(itemData, itemName);
                              }
                            }}
                          >
                            <td>
                              <div className="file-name-cell">
                                <span className="file-icon">{icon}</span>
                                <span>{itemName}</span>
                              </div>
                            </td>
                            <td>
                              {itemData.lastModifiedDateTime
                                ? new Date(itemData.lastModifiedDateTime).toLocaleDateString()
                                : "-"}
                            </td>
                            <td>
                              {isFolder
                                ? `${itemData.folder.childCount || 0} elementos`
                                : formatBytes(itemData.size)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </section>
            )}
          </>
        )}

        {view === "docs" && (
          <>
            <section className="moodle-header">
              <div>
                <p className="moodle-tag">Sección interna</p>
                <h2>UNAMIS Docs</h2>
                <p className="moodle-subtitle">
                  Bandeja documental con filtros y acceso a memorándums.
                </p>
              </div>

              <button
                type="button"
                className="back-button"
                onClick={() => setView("home")}
              >
                ← Volver al inicio
              </button>
            </section>

            <section className="docs-toolbar">
              <div className="docs-tabs">
                <button
                  className={`docs-tab ${docsTab === "INBOX" ? "active" : ""}`}
                  onClick={() => changeDocsTab("INBOX")}
                >
                  Bandeja de entrada
                </button>

                <button
                  className={`docs-tab ${docsTab === "SENT" ? "active" : ""}`}
                  onClick={() => changeDocsTab("SENT")}
                >
                  Enviados
                </button>
              </div>

              <div className="docs-filters">
                {["TODOS", "PENDIENTE", "EN PROCESO", "FINALIZADO"].map((item) => (
                  <button
                    key={item}
                    className={`docs-filter ${docsFilter === item ? "active" : ""}`}
                    onClick={() => setDocsFilter(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </section>

            {docsLoading && (
              <div className="status-box">Cargando documentos...</div>
            )}

            {docsError && (
              <div className="status-box error-box">{docsError}</div>
            )}

            {!docsLoading && !docsError && (
              <section className="docs-list">
                {filteredDocs.length === 0 ? (
                  <div className="status-box">No hay documentos para mostrar.</div>
                ) : (
                  filteredDocs.map((memo) => {
                    const statusLocal = allReadStatuses[memo.id] || { visto: false };

                    return (
                      <div className="doc-card" key={memo.id}>
                        <div className="doc-main">
                          <div className="doc-topline">
                            <span className="doc-exp">
                              {memo.expediente_number || "Sin expediente"}
                            </span>
                            <span
                              className={`doc-status status-${getStatusLabel(memo.status)
                                .replace(/\s+/g, "-")
                                .toLowerCase()}`}
                            >
                              {getStatusLabel(memo.status)}
                            </span>
                          </div>

                          <h3>{memo.title || "Sin título"}</h3>
                          <p className="doc-desc">
                            {memo.description || "Sin descripción"}
                          </p>

                          <div className="doc-meta">
                            <span><b>Área:</b> {memo.current_area || "Sin área"}</span>
                            <span><b>Fecha:</b> {memo.created_at || "Sin fecha"}</span>
                          </div>
                        </div>

                        <div className="doc-actions-container">
                          {statusLocal.visto ? (
                            <span className="badge-visto">
                              <span className="dot dot-green"></span> VISTO
                            </span>
                          ) : (
                            <span className="badge-nuevo">
                              <span className="dot dot-red pulse"></span> NUEVO
                            </span>
                          )}
                          <button
                            className="course-button"
                            onClick={() => openMemoDetails(memo)}
                          >
                            Abrir memorándum
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </section>
            )}
          </>
        )}

        {view === "docs-detail" && memoToShow && (
          <>
            <section className="memo-detail-shell">
              <div 
                className="memo-top-red" 
                style={{ 
                  background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
                  border: '1px solid rgba(255, 255, 255, 0.3)', 
                  borderRadius: '16px', 
                  padding: '25px',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                  color: '#ffffff'
                }}
              >
                <div>
                  <p className="memo-top-kicker" style={{ color: 'rgba(255, 255, 255, 0.8)', marginBottom: '4px' }}>Resumen del expediente</p>
                  <h2 style={{ color: '#ffffff', margin: 0 }}>{memoToShow.expediente_number || "Sin expediente"}</h2>
                </div>

                <div className="memo-top-badges">
                  <span className="memo-pill" style={{ background: 'rgba(255, 255, 255, 0.2)', color: '#ffffff', border: '1px solid rgba(255, 255, 255, 0.3)', padding: '4px 12px', borderRadius: '20px', fontSize: '0.85rem' }}>{memoToShow.current_area || "Sin área"}</span>
                  <span className="memo-pill" style={{ background: 'rgba(255, 255, 255, 0.2)', color: '#ffffff', border: '1px solid rgba(255, 255, 255, 0.3)', padding: '4px 12px', borderRadius: '20px', fontSize: '0.85rem' }}>{getStatusLabel(memoToShow.status)}</span>
                  <span className={`memo-pill ${getLocalReadClass()}`} style={{ background: 'rgba(255, 255, 255, 0.2)', color: '#ffffff', border: '1px solid rgba(255, 255, 255, 0.3)', padding: '4px 12px', borderRadius: '20px', fontSize: '0.85rem' }}>
                    {getLocalReadLabel()}
                  </span>
                </div>
              </div>

              <div className="memo-top-actions">
                <button
                  className="memo-action ghost"
                  onClick={markMemoAsRead}
                  disabled={memoReadStatusLoading}
                >
                  {memoReadStatusLoading ? "Guardando..." : "Marcar como visto"}
                </button>

                <button
                  className="memo-action white"
                  onClick={confirmMemoRead}
                  disabled={memoReadStatusLoading}
                >
                  {memoReadStatusLoading ? "Guardando..." : "Confirmar lectura"}
                </button>

                <button
                  className="memo-action blue"
                  onClick={() => {
                    loadAllReadStatuses();
                    setView("docs");
                  }}
                >
                  Volver
                </button>
              </div>

              {memoLoading && (
                <div className="status-box">Cargando detalle real del memorándum...</div>
              )}

              {memoError && (
                <div className="status-box error-box">{memoError}</div>
              )}

              {!memoLoading && !memoError && (
                <div className="memo-detail-grid">
                  <section className="memo-panel large">
                    <h3>Información del expediente</h3>

                    <div className="memo-info-grid">
                      <div className="memo-info-card">
                        <span>Número de expediente</span>
                        <strong>{memoToShow.expediente_number || "Sin expediente"}</strong>
                      </div>

                      <div className="memo-info-card">
                        <span>Tipo de documento</span>
                        <strong>{memoToShow.title || "Memorándum"}</strong>
                      </div>

                      <div className="memo-info-card">
                        <span>Prioridad</span>
                        <strong>{memoToShow.priority || "Sin prioridad"}</strong>
                      </div>
                    </div>

                    <div className="memo-block">
                      <h4>Remitente y contacto</h4>
                      <div className="memo-info-grid">
                        <div className="memo-info-card">
                          <span>Nombre del remitente</span>
                          <strong>{memoToShow.sender_name || "Sin remitente"}</strong>
                        </div>

                        <div className="memo-info-card">
                          <span>Correo</span>
                          <strong>{memoToShow.sender_email || "Sin correo"}</strong>
                        </div>
                      </div>
                    </div>

                    <div className="memo-block">
                      <h4>Detalle del trámite</h4>
                      <div className="memo-detail-card">
                        <strong>{memoToShow.title || "Sin título"}</strong>
                        <p>{memoToShow.description || "Sin descripción"}</p>
                      </div>
                    </div>
                  </section>

                  <section className="memo-panel side">
                    <h3>Resumen</h3>
                    <div className="detail-list">
                      <div className="detail-item">
                        <strong>Estado</strong>
                        <span>{getStatusLabel(memoToShow.status)}</span>
                      </div>
                      <div className="detail-item">
                        <strong>Fecha creación</strong>
                        <span>{memoToShow.created_at || "Sin fecha"}</span>
                      </div>
                      <div className="detail-item">
                        <strong>Última actualización</strong>
                        <span>{memoToShow.updated_at || "Sin actualización"}</span>
                      </div>
                      <div className="detail-item">
                        <strong>Origen</strong>
                        <span>{memoToShow.origin_type || "Sin origen"}</span>
                      </div>
                      <div className="detail-item">
                        <strong>Estado interno</strong>
                        <span>{getLocalReadLabel()}</span>
                      </div>
                      <div className="detail-item">
                        <strong>Último cambio interno</strong>
                        <span>{memoReadStatus.updatedAt || "Sin cambios"}</span>
                      </div>
                    </div>
                  </section>

                  <section className="memo-panel large">
                    <h3>Anexos y adjuntos ({memoFiles.length})</h3>

                    {memoFiles.length === 0 ? (
                      <p className="empty-text">No hay archivos adjuntos.</p>
                    ) : (
                      <div className="memo-files-grid">
                        {memoFiles.map((file) => (
                          <button
                            key={file.id}
                            className="memo-file-card custom-file-btn"
                            onClick={() =>
                              setPreviewFile(
                                buildPreviewFile({
                                  name: file.name,
                                  url: file.url,
                                  sourceUrl: file.url,
                                })
                              )
                            }
                            type="button"
                          >
                            <div style={{ textAlign: "left" }}>
                              <strong>{file.name || "Archivo"}</strong>
                              <p>
                                {file.file_type || "Sin tipo"} ·{" "}
                                {file.file_size ? `${file.file_size} bytes` : "Sin tamaño"}
                              </p>
                            </div>
                            <span>Ver</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="memo-panel large">
                    <h3>Línea de tiempo ({memoHistory.length})</h3>

                    {memoHistory.length === 0 ? (
                      <p className="empty-text">No hay historial disponible.</p>
                    ) : (
                      <div className="timeline-list">
                        {memoHistory.map((item, index) => (
                          <div className="timeline-item" key={item.id || index}>
                            <div className="timeline-dot"></div>
                            <div className="timeline-content">
                              <strong>{item.action || "Movimiento"}</strong>
                              <p>{item.description || "Sin descripción"}</p>
                              <span>
                                {item.timestamp || "Sin fecha"} · {item.user || "Sin usuario"}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              )}
            </section>
          </>
        )}

        {(previewFile || previewLoading) && (
          <div className="file-preview-overlay" onClick={closePreviewFile}>
            <div className="file-preview-modal" onClick={(e) => e.stopPropagation()}>
              <div className="file-preview-header">
                <h3>{previewFile?.name || "Vista previa de documento"}</h3>
                <div className="file-preview-actions">
                  {previewFile?.url && (
                    <a
                    href={previewFile.url}
                    target="_blank"
                    rel="noreferrer"
                    className="memo-action ghost"
                  >
                    Abrir en pestaña
                    </a>
                  )}
                  <button
                    className="memo-action bordo"
                    onClick={closePreviewFile}
                  >
                    Cerrar
                  </button>
                </div>
              </div>
              <div className="file-preview-content">
                {previewLoading ? (
                  <div className="status-box">Cargando vista previa del archivo...</div>
                ) : (
                  <iframe
                    src={previewFile?.previewUrl || previewFile?.url}
                    title="Vista previa"
                    className="file-preview-iframe"
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {view === "moodle" && (
          <>
            <section className="moodle-header">
              <div>
                <p className="moodle-tag">Sección interna</p>
                <h2>Comunidad de Aprendizaje</h2>
                <p className="moodle-subtitle">
                  Sede Santa Rosa organizada por carreras, años y materias.
                </p>
              </div>

              <button
                type="button"
                className="back-button"
                onClick={() => setView("home")}
              >
                ← Volver al inicio
              </button>
            </section>

            {loadingTree && (
              <div className="status-box">Cargando estructura académica...</div>
            )}

            {treeError && (
              <div className="status-box error-box">{treeError}</div>
            )}

            {!loadingTree && !treeError && santaRosa && (
              <section className="tree-panel">
                <div className="tree-header">
                  <h3>📍 {santaRosa.name}</h3>
                  <p>Carreras disponibles en esta sede.</p>
                </div>

                <div className="tree-list">
                  {careers.map((career) => {
                    const years = getChildren(career.id);

                    return (
                      <div className="tree-block" key={career.id}>
                        <button
                          className="tree-toggle level-career"
                          onClick={() => toggleCareer(career.id)}
                        >
                          <span>
                            {expandedCareers[career.id] ? "▾" : "▸"} {career.name}
                          </span>
                        </button>

                        {expandedCareers[career.id] && (
                          <div className="tree-children">
                            {years.length === 0 ? (
                              <p className="empty-text">No hay años cargados.</p>
                            ) : (
                              years.map((year) => {
                                const subYears = getChildren(year.id);
                                const yearCourses = coursesByCategory[year.id] || [];
                                const loadingYear = loadingCoursesByCategory[year.id];

                                return (
                                  <div className="tree-subblock" key={year.id}>
                                    <button
                                      className="tree-toggle level-year"
                                      onClick={() => toggleYear(year)}
                                    >
                                      <span>
                                        {expandedYears[year.id] ? "▾" : "▸"} {year.name}
                                      </span>
                                    </button>

                                    {expandedYears[year.id] && (
                                      <div className="tree-courses">
                                        {subYears.length > 0 ? (
                                          subYears.map((sub) => {
                                            const subCourses =
                                              coursesByCategory[sub.id] || [];
                                            const loadingSub =
                                              loadingCoursesByCategory[sub.id];

                                            return (
                                              <div className="tree-subblock" key={sub.id}>
                                                <button
                                                  className="tree-toggle"
                                                  onClick={() => toggleYear(sub)}
                                                >
                                                  <span>
                                                    {expandedYears[sub.id] ? "▾" : "▸"}{" "}
                                                    {sub.name}
                                                  </span>
                                                </button>

                                                {expandedYears[sub.id] && (
                                                  <div className="tree-courses">
                                                    {loadingSub && (
                                                      <p className="empty-text">
                                                        Cargando materias...
                                                      </p>
                                                    )}

                                                    {!loadingSub &&
                                                      subCourses.length === 0 && (
                                                        <p className="empty-text">
                                                          No hay materias en esta categoría.
                                                        </p>
                                                      )}

                                                    {!loadingSub &&
                                                      subCourses.length > 0 &&
                                                      subCourses.map((course) => (
                                                        <div
                                                          className="subject-card"
                                                          key={course.id}
                                                        >
                                                          <div>
                                                            <strong>
                                                              {course.fullname ||
                                                                course.displayname}
                                                            </strong>
                                                            <p>
                                                              {course.shortname ||
                                                                "Sin código"}
                                                            </p>
                                                          </div>

                                                          <button
                                                            className="course-button"
                                                            onClick={() =>
                                                              openCourseDetails(course)
                                                            }
                                                          >
                                                            Ver detalles
                                                          </button>
                                                        </div>
                                                      ))}
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })
                                        ) : (
                                          <>
                                            {loadingYear && (
                                              <p className="empty-text">
                                                Cargando materias...
                                              </p>
                                            )}

                                            {!loadingYear &&
                                              yearCourses.length === 0 && (
                                                <p className="empty-text">
                                                  No hay materias en esta categoría.
                                                </p>
                                              )}

                                            {!loadingYear &&
                                              yearCourses.length > 0 &&
                                              yearCourses.map((course) => (
                                                <div
                                                  className="subject-card"
                                                  key={course.id}
                                                >
                                                  <div>
                                                    <strong>
                                                      {course.fullname ||
                                                        course.displayname}
                                                    </strong>
                                                    <p>
                                                      {course.shortname ||
                                                        "Sin código"}
                                                    </p>
                                                  </div>

                                                  <button
                                                    className="course-button"
                                                    onClick={() =>
                                                      openCourseDetails(course)
                                                    }
                                                  >
                                                    Ver detalles
                                                  </button>
                                                </div>
                                              ))}
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {!loadingTree && !treeError && !santaRosa && (
              <div className="status-box error-box">
                No se encontró la categoría "Sede Santa Rosa".
              </div>
            )}
          </>
        )}

        {view === "course-details" && selectedCourse && (
          <>
            <section className="moodle-header">
              <div>
                <p className="moodle-tag">Detalle del curso</p>
                <h2>{selectedCourse.fullname || selectedCourse.displayname}</h2>
                <p className="moodle-subtitle">
                  Código: {selectedCourse.shortname || "Sin código"}
                </p>
              </div>

              <button
                type="button"
                className="back-button"
                onClick={() => setView("moodle")}
              >
                ← Volver a Moodle
              </button>
            </section>

            {loadingDetails && (
              <div className="status-box">
                Cargando participantes y tareas...
              </div>
            )}

            {detailsError && (
              <div className="status-box error-box">{detailsError}</div>
            )}

            {!loadingDetails && !detailsError && (
              <div className="details-layout">
                <section className="detail-panel">
                  <h3>Participantes</h3>
                  <p className="detail-count">Total: {participants.length}</p>

                  <div className="detail-list">
                    {sortedParticipants.length === 0 ? (
                      <p className="empty-text">No hay participantes para mostrar.</p>
                    ) : (
                      sortedParticipants.map((person) => {
                        // Identificamos si el usuario es profesor basándonos en el shortname del rol de Moodle
                        const isTeacher = person.roles?.some(role => 
                          role.shortname === 'editingteacher' || role.shortname === 'teacher'
                        );
                        
                        return (
                          <div className={`detail-item ${isTeacher ? 'is-teacher' : ''}`} key={person.id}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <strong 
                                style={{ cursor: isTeacher ? 'default' : 'pointer', color: isTeacher ? 'inherit' : 'var(--primary-dark)' }}
                                onClick={() => !isTeacher && openStudentReport(selectedCourse.id, person)}
                              >
                                {person.fullname || `${person.firstname || ""} ${person.lastname || ""}`}
                              </strong>
                              {isTeacher && <span className="badge-role">Profesor</span>}
                            </div>
                            <span>{person.email || "Sin correo"}</span>
                            <span style={{ fontSize: '0.82rem', color: 'var(--muted-2)', marginTop: '4px' }}>
                              <b>Último acceso:</b> {person.lastaccess ? new Date(person.lastaccess * 1000).toLocaleString() : "Sin registros"}
                            </span>
                            {!isTeacher && (
                              <button 
                                className="memo-action blue" 
                                style={{marginTop: '10px', fontSize: '0.8rem', width: 'fit-content'}}
                                onClick={() => openStudentReport(selectedCourse.id, person)}
                              >
                                📂 Informe completo del perfil
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>

                <section className="detail-panel">
                  <h3>Tareas</h3>
                  <p className="detail-count">Total: {assignments.length}</p>

                  <div className="detail-list">
                    {assignments.length === 0 ? (
                      <p className="empty-text">No hay tareas para mostrar.</p>
                    ) : (
                      assignments.map((task) => (
                        <div className="detail-item" key={task.id}>
                          <strong>{task.name}</strong>
                          <span>
                            {task.duedate
                              ? `Entrega: ${new Date(
                                  task.duedate * 1000
                                ).toLocaleDateString()}`
                              : "Sin fecha de entrega"}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            )}
          </>
        )}

        {view === "student-report" && selectedStudent && (
          <>
            <section className="moodle-header">
              <div>
                <p className="moodle-tag">Informe Académico</p>
                <h2>{selectedStudent.fullname}</h2>
                <p className="moodle-subtitle">Curso: {selectedCourse.fullname}</p>
              </div>
              <button className="back-button" onClick={() => setView("course-details")}>
                ← Volver al curso
              </button>
            </section>

            {loadingReport && <div className="status-box">Cargando calificaciones y progreso...</div>}

            {!loadingReport && studentReport && (
              <div className="detail-panel">
                <h3>Calificaciones y Retroalimentación</h3>
                <div className="table-container" style={{marginTop: '15px', overflowX: 'auto'}}>
                  <table className="onedrive-table">
                    <thead>
                      <tr>
                        <th>Actividad</th>
                        <th>Calificación</th>
                        <th>Rango</th>
                        <th>Retroalimentación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {studentReport.gradeitems?.map((item) => (
                        <tr key={item.id}>
                          <td>{item.itemname || "Total del curso"}</td>
                          <td><strong>{item.graderaw ?? "-"}</strong></td>
                          <td>{item.grademin} - {item.grademax}</td>
                          <td dangerouslySetInnerHTML={{ __html: item.feedback || "Sin comentarios" }}></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!loadingReport && studentOutline.length > 0 && (
              <div className="detail-panel" style={{marginTop: '25px'}}>
                <h3>Informe de Seguimiento (Actividad)</h3>
                <p className="detail-count">Registro de interacciones con los recursos del curso.</p>
                <div className="table-container" style={{marginTop: '15px', overflowX: 'auto'}}>
                  <table className="onedrive-table">
                    <thead>
                      <tr>
                        <th>Módulo/Recurso</th>
                        <th>Información de acceso</th>
                        <th>Último acceso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {studentOutline.map((item, idx) => (
                        <tr key={idx}>
                          <td>
                            <div className="file-name-cell">
                              <span className="file-icon">
                                {item.modname === 'resource' ? '📄' : item.modname === 'assign' ? '📝' : '🔗'}
                              </span>
                              <span>{item.name}</span>
                            </div>
                          </td>
                          <td>{item.info || "Sin interacciones registradas"}</td>
                          <td>
                            {item.time 
                              ? new Date(item.time * 1000).toLocaleString() 
                              : "Nunca"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {view === "finance" && (
          <>
            <button 
              className="back-button" 
              onClick={() => setView("home")} 
              style={{margin: '20px'}}
            >
               ← Volver al inicio
            </button>
            <FinanceModule />
          </>
        )}

        <footer className="footer">
          <p>Panel interno · UNAMIS · Dirección Sede Santa Rosa</p>
        </footer>
      </main>
    </div>
  );
}

export default App;
