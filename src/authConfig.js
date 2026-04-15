export const INITIAL_PASSWORD = "Unamis2026*";

export const MODULE_KEYS = {
  communication: "communication",
  mailInstitutional: "mail_institutional",
  mailPersonal: "mail_personal",
  onedrive: "onedrive",
  docs: "docs",
  moodle: "moodle",
  finance: "finance",
};

export const MAILBOX_CONFIG = {
  personal: {
    key: "personal",
    title: "Correo personal",
    badge: "Correo personal",
    heading: "Correo personal",
    subtitle: "Bandeja de entrada, enviados y spam del buzón personal dentro del panel.",
    defaultTarget: "martina.fernandez@unamis.edu.py",
  },
  institutional: {
    key: "institutional",
    title: "Correo institucional",
    badge: "Correo Microsoft 365",
    heading: "Outlook institucional",
    subtitle: "Bandeja de entrada, enviados y spam del buzón institucional dentro del panel.",
    defaultTarget: "direccion.santa.rosa@unamis.edu.py",
  },
};

const ALL_MODULES = Object.values(MODULE_KEYS);
const ALL_MAILBOXES = {
  personal: {
    enabled: true,
    target: MAILBOX_CONFIG.personal.defaultTarget,
  },
  institutional: {
    enabled: true,
    target: MAILBOX_CONFIG.institutional.defaultTarget,
  },
};

export const ROLE_CONFIG = {
  direccion: {
    label: "Dirección",
    modules: ALL_MODULES,
    mailboxes: ALL_MAILBOXES,
  },
  secretaria: {
    label: "Secretaria",
    modules: ALL_MODULES,
    mailboxes: ALL_MAILBOXES,
  },
  coordinador_ead: {
    label: "Técnico Docente Coordinador/a de EaD",
    modules: [MODULE_KEYS.communication, MODULE_KEYS.moodle],
    mailboxes: {},
  },
  administrativo_ead: {
    label: "Técnico Docente Personal administrativo para EaD",
    modules: [MODULE_KEYS.communication, MODULE_KEYS.finance],
    mailboxes: {},
  },
  coordinacion_academica: {
    label: "Coordinación de Gestión Académica",
    modules: [
      MODULE_KEYS.communication,
      MODULE_KEYS.mailInstitutional,
      MODULE_KEYS.onedrive,
      MODULE_KEYS.docs,
      MODULE_KEYS.moodle,
    ],
    mailboxes: {
      institutional: {
        enabled: true,
        target: MAILBOX_CONFIG.institutional.defaultTarget,
      },
    },
  },
  soporte_tecnologico: {
    label: "Técnico Docente Soporte tecnológico",
    modules: ALL_MODULES,
    mailboxes: ALL_MAILBOXES,
  },
  director_informatica: {
    label: "Director de informática",
    modules: ALL_MODULES,
    mailboxes: {
      personal: {
        enabled: true,
        target: "pablo.ramos@unamis.edu.py",
      },
      institutional: {
        enabled: true,
        target: MAILBOX_CONFIG.institutional.defaultTarget,
      },
    },
  },
};

const USER_RECORDS = [
  {
    id: "direccion",
    username: "direccion",
    displayName: "Dirección",
    role: "direccion",
    password: INITIAL_PASSWORD,
  },
  {
    id: "secretaria",
    username: "secretaria",
    displayName: "Secretaria",
    role: "secretaria",
    password: INITIAL_PASSWORD,
  },
  {
    id: "coordinacion_academica",
    username: "coordinacion_academica",
    displayName: "Coordinación de Gestión Académica",
    role: "coordinacion_academica",
    password: INITIAL_PASSWORD,
  },
  {
    id: "soporte_tecnologico",
    username: "soporte_tecnologico",
    displayName: "Soporte tecnológico",
    role: "soporte_tecnologico",
    password: INITIAL_PASSWORD,
  },
  {
    id: "coordinador_ead",
    username: "coordinador_ead",
    displayName: "Coordinador/a de EaD",
    role: "coordinador_ead",
    password: INITIAL_PASSWORD,
  },
  {
    id: "administrativo_ead",
    username: "administrativo_ead",
    displayName: "Administrativo EaD",
    role: "administrativo_ead",
    password: INITIAL_PASSWORD,
  },
  {
    id: "director_informatica",
    username: "director_informatica",
    displayName: "Director de informática",
    role: "director_informatica",
    password: INITIAL_PASSWORD,
    permissions: {
      mailboxes: {
        personal: {
          enabled: true,
          target: "pablo.ramos@unamis.edu.py",
        },
      },
    },
  },
];

const buildModuleAccess = (roleModules = [], userPermissions = {}) => {
  const moduleAccess = Object.fromEntries(
    ALL_MODULES.map((moduleKey) => [moduleKey, roleModules.includes(moduleKey)])
  );

  (userPermissions.allowModules || []).forEach((moduleKey) => {
    moduleAccess[moduleKey] = true;
  });

  (userPermissions.denyModules || []).forEach((moduleKey) => {
    moduleAccess[moduleKey] = false;
  });

  return moduleAccess;
};

const buildMailboxAccess = (roleMailboxes = {}, userPermissions = {}) => {
  const mailboxOverrides = userPermissions.mailboxes || {};

  return Object.fromEntries(
    Object.entries(MAILBOX_CONFIG).map(([mailboxKey, mailboxConfig]) => {
      const roleMailbox = roleMailboxes[mailboxKey] || {};
      const userMailbox = mailboxOverrides[mailboxKey] || {};

      return [
        mailboxKey,
        {
          enabled: Boolean(
            userMailbox.enabled ?? roleMailbox.enabled ?? false
          ),
          target:
            userMailbox.target ??
            roleMailbox.target ??
            mailboxConfig.defaultTarget,
        },
      ];
    })
  );
};

export const resolveUserSession = (userRecord) => {
  if (!userRecord?.role || !ROLE_CONFIG[userRecord.role]) return null;

  const roleConfig = ROLE_CONFIG[userRecord.role];
  const userPermissions = userRecord.permissions || {};

  return {
    id: userRecord.id,
    username: userRecord.username,
    displayName: userRecord.displayName,
    role: userRecord.role,
    roleLabel: roleConfig.label,
    moduleAccess: buildModuleAccess(roleConfig.modules, userPermissions),
    mailboxAccess: buildMailboxAccess(roleConfig.mailboxes, userPermissions),
    permissions: userPermissions,
  };
};

export const authenticateUser = (username, password) => {
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const normalizedPassword = String(password || "");

  const userRecord = USER_RECORDS.find(
    (user) =>
      user.username.toLowerCase() === normalizedUsername &&
      user.password === normalizedPassword
  );

  return userRecord ? resolveUserSession(userRecord) : null;
};

export const canAccessModule = (user, moduleKey) =>
  Boolean(user?.moduleAccess?.[moduleKey]);

export const canAccessMailbox = (user, mailboxKey) =>
  Boolean(user?.mailboxAccess?.[mailboxKey]?.enabled);

export const getAccessibleModuleCount = (user) =>
  Object.values(user?.moduleAccess || {}).filter(Boolean).length;

export const getDefaultMailboxForUser = (user) => {
  if (canAccessMailbox(user, "institutional")) return "institutional";
  if (canAccessMailbox(user, "personal")) return "personal";
  return null;
};

export const USER_DIRECTORY = USER_RECORDS.map((userRecord) => {
  const resolvedUser = resolveUserSession(userRecord);

  return {
    id: userRecord.id,
    username: userRecord.username,
    displayName: userRecord.displayName,
    role: userRecord.role,
    roleLabel: resolvedUser?.roleLabel || userRecord.role,
    moduleAccess: resolvedUser?.moduleAccess || {},
  };
});
