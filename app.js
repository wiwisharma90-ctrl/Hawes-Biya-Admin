import { 
  getSupabaseConfiguration,
  SUPABASE_URL,
  SUPABASE_PUBLIC_KEY
 } from "./supabase-config.js";

const ADMIN_SECURITY_CODE = "123@wiwi";

const pageLabels = {
  dashboard: "لوحة التحكم",
  users: "المستخدمون",
  hosts: "المنظمون",
  programs: "البرامج",
  bookings: "الحجوزات",
  complaints: "الشكاوى",
  notifications: "الإشعارات",
  settings: "الإعدادات"
};

const state = {
  page: "dashboard",
  data: null,
  requestId: 0,
  filters: {
    userRole: "all",
    programStatus: "all",
    bookingStatus: "all",
    complaintStatus: "all"
  },
  searches: {
    users: "",
    hosts: "",
    programs: "",
    bookings: "",
    complaints: ""
  }
};

let supabaseClient = null;
let supabaseConfigurationError = null;

const pageContent = document.getElementById("page-content");
const loginScreen = document.getElementById("login-screen");
const appShell = document.getElementById("app-shell");

/* -------------------------------------------------------
   General helpers
------------------------------------------------------- */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function displayName(profile) {
  if (!profile) return "غير معروف";

  const fullName = [
    profile.first_name,
    profile.last_name
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  return fullName || profile.company_name || profile.email || "غير معروف";
}

function initials(name) {
  const value = String(name || "؟").trim();

  if (!value) return "؟";

  const parts = value.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return escapeHtml(value);
  }

  return new Intl.DateTimeFormat("ar-DZ", {
    dateStyle: "medium"
  }).format(date);
}

function formatNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return "0";

  return new Intl.NumberFormat("ar-DZ").format(number);
}

function formatPrice(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return "—";

  return `${new Intl.NumberFormat("ar-DZ", {
    maximumFractionDigits: 2
  }).format(number)} دج`;
}

function translateRole(role) {
  const values = {
    tourist: "مسافر",
    host: "منظم"
  };

  return values[role] || role || "غير محدد";
}

function translateStatus(status) {
  const values = {
    pending: "قيد المراجعة",
    published: "منشور",
    rejected: "مرفوض",
    confirmed: "مؤكد",
    cancelled: "ملغى",
    solved: "تم الحل",
    new: "جديدة",
    processing: "قيد المعالجة",
    read: "مقروء",
    unread: "غير مقروء"
  };

  return values[status] || status || "غير محدد";
}

function badgeClass(status) {
  const classes = {
    active: "status-active",
    published: "status-published",
    confirmed: "status-confirmed",
    solved: "status-solved",
    pending: "status-pending",
    review: "status-review",
    new: "status-new",
    unread: "status-unread",
    rejected: "status-rejected",
    cancelled: "status-cancelled",
    processing: "status-processing",
    read: "status-read"
  };

  return classes[status] || "status-read";
}

function badge(status, label = translateStatus(status)) {
  return `<span class="status-badge ${badgeClass(status)}">${escapeHtml(label)}</span>`;
}

function heading(title, description, actions = "") {
  return `
    <div class="page-heading">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(description)}</p>
      </div>
      ${actions ? `<div class="heading-actions">${actions}</div>` : ""}
    </div>
  `;
}

function searchField(key, placeholder) {
  return `
    <label class="search-field">
      <span aria-hidden="true">⌕</span>
      <input
        type="search"
        data-search="${escapeHtml(key)}"
        value="${escapeHtml(state.searches[key] || "")}"
        placeholder="${escapeHtml(placeholder)}"
        autocomplete="off"
      >
    </label>
  `;
}

function filterSelect(key, options, ariaLabel) {
  return `
    <select class="filter-select" data-filter="${escapeHtml(key)}" aria-label="${escapeHtml(ariaLabel)}">
      ${options.map(([value, label]) => `
        <option
          value="${escapeHtml(value)}"
          ${state.filters[key] === value ? "selected" : ""}
        >
          ${escapeHtml(label)}
        </option>
      `).join("")}
    </select>
  `;
}

function dataTable(headers, rows) {
  if (!rows.length) {
    return `
      <section class="panel">
        <div class="empty-state">
          <span>⌕</span>
          لا توجد نتائج مطابقة.
          <small class="visibility-note">
            إذا كانت الصفحة فارغة بالكامل، فقد تكون سجلات قاعدة البيانات مخفية بسبب RLS.
          </small>
        </div>
      </section>
    `;
  }

  return `
    <section class="panel table-panel">
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              ${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows.join("")}
          </tbody>
        </table>
      </div>
      <div class="table-footer">
        <span>النتائج المعروضة: ${formatNumber(rows.length)}</span>
        <span>Haws Biya</span>
      </div>
    </section>
  `;
}

function loadingState() {
  return `
    <section class="panel async-state">
      <span class="spinner" aria-hidden="true"></span>
      <strong>جارٍ تحميل البيانات…</strong>
      <small>يتم جلب البيانات من Supabase.</small>
    </section>
  `;
}

function errorState(error) {
  return `
    <section class="panel async-state error-state">
      <span class="state-icon" aria-hidden="true">!</span>
      <h2>تعذر تحميل البيانات</h2>
      <p>${escapeHtml(formatError(error))}</p>
      <small>
        إذا كان السبب متعلقًا بـRLS، فلن يتم تجاوز صلاحيات قاعدة البيانات من الواجهة.
      </small>
      <button class="button button-primary" type="button" data-action="retry">
        إعادة المحاولة
      </button>
    </section>
  `;
}

function emptyRelatedValue(value) {
  return escapeHtml(value || "غير متاح");
}

function relatedName(profile, id) {
  if (profile) return escapeHtml(displayName(profile));

  return id
    ? `${escapeHtml(id)} (غير ظاهر وفق صلاحيات القراءة الحالية)`
    : "—";
}

function relatedValue(value, id) {
  if (value) return escapeHtml(value);

  return id
    ? `${escapeHtml(id)} (غير ظاهر وفق صلاحيات القراءة الحالية)`
    : "—";
}

function safeAvatar(profile, name) {
  const url = profile?.avatar_url;

  if (url) {
    try {
      const parsed = new URL(url, window.location.href);

      if (
        parsed.protocol === "https:" ||
        parsed.protocol === "http:"
      ) {
        return `
          <span class="table-avatar">
            <img
              src="${escapeHtml(parsed.href)}"
              alt=""
              loading="lazy"
            >
          </span>
        `;
      }
    } catch {
      // Fall back to initials.
    }
  }

  return `
    <span class="table-avatar">
      ${escapeHtml(initials(name))}
    </span>
  `;
}

function requireClient() {
  if (supabaseConfigurationError) {
    throw new Error(supabaseConfigurationError);
  }

  if (!supabaseClient) {
    throw new Error("تعذر تهيئة عميل Supabase.");
  }

  return supabaseClient;
}

async function loadAdminProfiles() {
  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
    throw new Error("إعدادات Supabase غير مكتملة.");
  }

  const profiles = await selectRows(
    "profiles",
    "id,first_name,last_name,email,phone,wilaya,role,company_name,avatar_url,created_at",
    (query) => query.order("created_at", { ascending: false })
  );

  const tourists = profiles.filter(p => p.role === 'tourist');
  const hosts = profiles.filter(p => p.role === 'host');

  return {
    success: true,
    total: profiles.length,
    tourists: tourists,
    hosts: hosts.map(host => ({
      ...host,
      programCount: 0,
      subscriptionStatus: "active"
    })),
    profiles: profiles
  };
}

function formatError(error) {
  if (error instanceof Error) return error.message;

  if (error?.message) return error.message;

  return String(error);
}

/* -------------------------------------------------------
   Supabase reads
------------------------------------------------------- */

async function selectRows(table, columns, configureQuery) {
  let query = requireClient()
    .from(table)
    .select(columns);

  if (configureQuery) {
    query = configureQuery(query);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(
      `${table}: ${error.message}${error.code ? ` (${error.code})` : ""}`
    );
  }

  if (!Array.isArray(data)) {
    throw new Error(
      `${table}: أعادت قاعدة البيانات استجابة غير متوقعة.`
    );
  }

  return data;
}

async function selectAllRows(table, columns, configureQuery) {
  const pageSize = 1000;
  const rows = [];

  for (let offset = 0; ; offset += pageSize) {
    let query = requireClient()
      .from(table)
      .select(columns);

    if (configureQuery) {
      query = configureQuery(query);
    }

    const { data, error } = await query.range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(
        `${table}: ${error.message}${error.code ? ` (${error.code})` : ""}`
      );
    }

    if (!Array.isArray(data)) {
      throw new Error(
        `${table}: أعادت قاعدة البيانات استجابة غير متوقعة.`
      );
    }

    rows.push(...data);

    if (data.length < pageSize) {
      return rows;
    }
  }
}

async function selectProfilesByIds(ids) {
  const uniqueIds = [
    ...new Set(
      ids.filter(Boolean)
    )
  ];

  if (!uniqueIds.length) {
    return [];
  }

  const profiles = [];
  const batchSize = 100;

  for (let offset = 0; offset < uniqueIds.length; offset += batchSize) {
    profiles.push(
      ...await selectRows(
        "profiles",
        "id,first_name,last_name,email,phone,wilaya,role,company_name,avatar_url,created_at",
        (query) => query.in("id", uniqueIds.slice(offset, offset + batchSize))
      )
    );
  }

  const profilesById = new Map(
    profiles.map((profile) => [profile.id, profile])
  );
  return uniqueIds
    .map((id) => profilesById.get(id))
    .filter(Boolean);
}

async function countRows(table, column, value) {
  let query = requireClient()
    .from(table)
    .select("id", {
      count: "exact",
      head: true
    });

  if (column) {
    query = query.eq(column, value);
  }

  const { count, error } = await query;

  if (error) {
    throw new Error(
      `${table}: ${error.message}${error.code ? ` (${error.code})` : ""}`
    );
  }

  if (typeof count !== "number") {
    throw new Error(
      `${table}: لم تُرجع قاعدة البيانات عدد السجلات.`
    );
  }

  return count;
}

/* -------------------------------------------------------
   Dashboard
------------------------------------------------------- */

async function loadDashboard() {
  const adminProfiles = await loadAdminProfiles();
  const profileCount = (value, field) => {
    if (Array.isArray(value)) {
      return value.length;
    }

    const count = typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : value;

    if (!Number.isInteger(count) || count < 0) {
      throw new Error(
        `قيمة غير صالحة للحقل ${field}.`
      );
    }

    return count;
  };

  const definitions = [
    ["إجمالي المستخدمين", null, null, profileCount(adminProfiles.total, "total"), "♙"],
    ["المسافرون", null, null, profileCount(adminProfiles.tourists, "tourists"), "♙"],
    ["المنظمون", null, null, profileCount(adminProfiles.hosts, "hosts"), "♧"],

    ["إجمالي البرامج", "programs", null, null, "⌖"],
    ["البرامج المنشورة", "programs", "status", "published", "⌖"],
    ["البرامج قيد المراجعة", "programs", "status", "pending", "◷"],
    ["البرامج المرفوضة", "programs", "status", "rejected", "⌖"],

    ["إجمالي الحجوزات", "bookings", null, null, "▤"],
    ["الحجوزات المعلقة", "bookings", "status", "pending", "▤"],
    ["الحجوزات المؤكدة", "bookings", "status", "confirmed", "▤"],
    ["الحجوزات الملغاة", "bookings", "status", "cancelled", "▤"],

    ["إجمالي الشكاوى", "complaints", null, null, "⚑"]
  ];

  const stats = await Promise.all(
    definitions.map(
      async ([label, table, column, value, icon]) => {
        return {
          label,
          value: table
            ? await countRows(table, column, value)
            : value,
          icon
        };
      }
    )
  );

  let notifications = [];
  let notificationError = null;

  try {
    notifications = await selectRows(
      "notifications",
      "id,title,body,type,read,created_at",
      (query) =>
        query
          .order("created_at", {
            ascending: false
          })
          .limit(5)
    );
  } catch (error) {
    notificationError = error;
  }

  return {
    stats,
    notifications,
    notificationError
  };
}

/* -------------------------------------------------------
   Users
------------------------------------------------------- */

async function loadUsers() {
  const data = await loadAdminProfiles();

  if (!Array.isArray(data.tourists)) {
    throw new Error(
      "لم يتم جلب قائمة المسافرين بالشكل المتوقع."
    );
  }

  return data.tourists;
}

/* -------------------------------------------------------
   Hosts
------------------------------------------------------- */
async function loadHosts() {
  const data = await loadAdminProfiles();

  if (!Array.isArray(data.hosts)) {
    throw new Error(
      "لم يتم جلب قائمة المنظمين بالشكل المتوقع."
    );
  }

  return data.hosts;
}

/* -------------------------------------------------------
   Programs
------------------------------------------------------- */

async function loadPrograms() {
  const programs = await selectAllRows(
    "programs",
    "id,host_id,title,location,price,duration_days,start_dae,status,created_at",
    (query) => query
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
  );

  if (!programs.length) {
    return [];
  }

  let hosts = [];

  try {
    hosts = await selectProfilesByIds(
      programs.map((program) => program.host_id)
    );
  } catch {
    hosts = [];
  }

  const hostsById = new Map(
    hosts.map((host) => [host.id, host])
  );

  return programs.map(
    (program) => ({
      ...program,
      host: hostsById.get(program.host_id)
    })
  );
}

/* -------------------------------------------------------
   Bookings
------------------------------------------------------- */
async function loadBookings() {
  const bookings = await selectAllRows(
    "bookings",
    "id,tourist_id,program_id,people_count,total_price,budget,status,created_at",
    (query) => query
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
  );

  if (!bookings.length) {
    return [];
  }

  const programIds = [...new Set(bookings.map((b) => b.program_id).filter(Boolean))];

  const programs = [];
  for (let offset = 0; offset < programIds.length; offset += 100) {
    programs.push(
      ...await selectAllRows(
        "programs",
        "id,title,host_id",
        (query) => query.in("id", programIds.slice(offset, offset + 100))
      )
    );
  }

  const programsById = new Map(programs.map((p) => [p.id, p]));

  const userIds = [
    ...new Set([
      ...bookings.map((b) => b.tourist_id),
      ...programs.map((p) => p.host_id)
    ].filter(Boolean))
  ];

  const profiles = await selectProfilesByIds(userIds);

  const profilesById = new Map(profiles.map((p) => [p.id, p]));

  return bookings.map((booking) => {
    const program = programsById.get(booking.program_id);
    return {
      ...booking,
      tourist: profilesById.get(booking.tourist_id),
      program: program,
      host: profilesById.get(program?.host_id)
    };
  });
}

/* -------------------------------------------------------
   Complaints
------------------------------------------------------- */

async function loadComplaints() {
  const complaints = await selectAllRows(
    "complaints",
    "id,created_at,user_id,program_id,host_id,reason,description,status,updated_at",
    (query) => query
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
  );

  if (!complaints.length) {
    return [];
  }

  const programIds = [
    ...new Set(
      complaints
        .map((complaint) => complaint.program_id)
        .filter(Boolean)
    )
  ];

  const programs = [];
  for (let offset = 0; offset < programIds.length; offset += 100) {
    programs.push(
      ...await selectAllRows(
        "programs",
        "id,title",
        (query) => query.in("id", programIds.slice(offset, offset + 100))
      )
    );
  }

  let profiles = [];

  try {
    profiles = await selectProfilesByIds([
      ...complaints.map((complaint) => complaint.user_id),
      ...complaints.map((complaint) => complaint.host_id)
    ]);
  } catch {
    profiles = [];
  }

  const programsById = new Map(
    programs.map((program) => [program.id, program])
  );

  const profilesById = new Map(
    profiles.map((profile) => [profile.id, profile])
  );

  return complaints.map(
    (complaint) => ({
      ...complaint,
      user: profilesById.get(complaint.user_id),
      host: profilesById.get(complaint.host_id),
      program: programsById.get(complaint.program_id)
    })
  );
}

/* -------------------------------------------------------
   Notifications
------------------------------------------------------- */

async function loadNotifications() {
  const notifications = await selectRows(
    "notifications",
    "id,user_id,title,body,type,read,created_at",
    (query) =>
      query.order("created_at", {
        ascending: false
      })
  );

  if (!notifications.length) {
    return [];
  }

  let users = [];

  try {
    users = await selectProfilesByIds(
      notifications.map((notification) => notification.user_id)
    );
  } catch {
    users = [];
  }

  const usersById = new Map(
    users.map((user) => [user.id, user])
  );

  return notifications.map(
    (notification) => ({
      ...notification,
      user: usersById.get(notification.user_id)
    })
  );
}

const pageLoaders = {
  dashboard: loadDashboard,
  users: loadUsers,
  hosts: loadHosts,
  programs: loadPrograms,
  bookings: loadBookings,
  complaints: loadComplaints,
  notifications: loadNotifications
};

/* -------------------------------------------------------
   Dashboard renderer
------------------------------------------------------- */

function dashboardPage(data) {
  const stats = data.stats
    .map(
      ({ label, value, icon }) => `
        <article class="stat-card">
          <div class="stat-top">
            <span class="stat-label">
              ${escapeHtml(label)}
            </span>
            <span class="stat-icon">
              ${icon}
            </span>
          </div>

          <div class="stat-value">
            ${formatNumber(value)}
          </div>
        </article>
      `
    )
    .join("");

  let activities;

  if (data.notificationError) {
    activities = `
      <div class="inline-error" role="alert">
        تعذر تحميل النشاطات من notifications:
        ${escapeHtml(data.notificationError.message)}
      </div>
    `;
  } else if (!data.notifications.length) {
    activities = `
      <div class="empty-state compact-empty">
        لا توجد إشعارات حديثة في قاعدة البيانات
      </div>
    `;
  } else {
    activities = data.notifications
      .map(
        (notification) => `
          <div class="activity-item">
            <span class="activity-marker">
              ♧
            </span>

            <span class="activity-copy">
              <strong>
                ${escapeHtml(notification.title)}
              </strong>

              <small>
                ${escapeHtml(notification.body)}
              </small>
            </span>

            <span class="activity-time">
              ${formatDate(notification.created_at)}
            </span>
          </div>
        `
      )
      .join("");
  }

  return `
    ${heading("لوحة التحكم", "نظرة عامة على منصة Haws Biya")}

    <h2 class="section-kicker">
      إحصائيات قاعدة البيانات
    </h2>

    <div class="stats-grid">
      ${stats}
    </div>

    <p class="visibility-note dashboard-visibility-note">
      الأعداد هي ما تسمح سياسات القراءة الحالية بعرضه للمفتاح العام.
    </p>

    <div class="dashboard-lower">

      <section class="panel">
        <div class="panel-header">
          <h2>آخر الإشعارات</h2>

          <button
            class="panel-link"
            type="button"
            data-page="notifications"
          >
            عرض الإشعارات ←
          </button>
        </div>

        <div class="activity-list">
          ${activities}
        </div>
      </section>

      <section class="panel welcome-panel">
        <div>
          <span class="eyebrow">
            مساحة الإدارة
          </span>

          <h2>
            إدارة تجارب السفر الجزائرية.
          </h2>

          <p>
            تعرض هذه اللوحة البيانات التي تسمح سياسات Supabase الحالية بقراءتها.
          </p>
        </div>

        <div class="welcome-bottom">
          <span>
            مصدر البيانات: Supabase
          </span>
        </div>
      </section>

    </div>
  `;
}

/* -------------------------------------------------------
   Users renderer
------------------------------------------------------- */

function usersPage(users) {
  const roleMap = {
    tourists: "tourist",
    hosts: "host"
  };

  const role = roleMap[state.filters.userRole];

  const search = state.searches.users
    .trim()
    .toLocaleLowerCase();

  const filteredUsers = users.filter((user) => {
    const searchable = [
      user.first_name,
      user.last_name,
      user.email,
      user.phone,
      user.wilaya,
      user.role
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();

    return (
      (!role || user.role === role) &&
      searchable.includes(search)
    );
  });

  const rows = filteredUsers.map(
    (user) => `
      <tr>
        <td>
          ${safeAvatar(user, displayName(user))}
        </td>

        <td>
          ${emptyRelatedValue(user.first_name)}
        </td>

        <td>
          ${emptyRelatedValue(user.last_name)}
        </td>

        <td>
          ${emptyRelatedValue(user.email)}
        </td>

        <td>
          ${emptyRelatedValue(user.phone)}
        </td>

        <td>
          ${emptyRelatedValue(user.wilaya)}
        </td>

        <td>
          ${badge(user.role, translateRole(user.role))}
        </td>

        <td>
          ${formatDate(user.created_at)}
        </td>
      </tr>
    `
  );

  return `
    ${heading("المستخدمون", "المسافرون والمنظمون المسجلون في قاعدة البيانات")}

    <div class="toolbar">
      ${searchField("users", "ابحث بالاسم أو البريد أو الهاتف أو الولاية…")}

      ${filterSelect(
        "userRole",
        [
          ["all", "الكل"],
          ["tourists", "مسافرون"],
          ["hosts", "منظمون"]
        ],
        "تصفية حسب الدور"
      )}
    </div>

    ${dataTable(
      [
        "الصورة",
        "الاسم",
        "اللقب",
        "البريد الإلكتروني",
        "الهاتف",
        "الولاية",
        "الدور",
        "تاريخ التسجيل"
      ],
      rows
    )}
  `;
}

/* -------------------------------------------------------
   Hosts renderer
------------------------------------------------------- */

function hostsPage(hosts) {
  const search = state.searches.hosts
    .trim()
    .toLocaleLowerCase();

  const filteredHosts = hosts.filter((host) =>
    [
      host.first_name,
      host.last_name,
      host.company_name,
      host.email,
      host.phone,
      host.wilaya
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase()
      .includes(search)
  );

  const rows = filteredHosts.map(
    (host) => `
      <tr>
        <td>
          <span class="table-person">
            ${escapeHtml(displayName(host))}
          </span>
        </td>

        <td>
          ${emptyRelatedValue(host.company_name)}
        </td>

        <td>
          ${emptyRelatedValue(host.email)}
        </td>

        <td>
          ${emptyRelatedValue(host.phone)}
        </td>

        <td>
          ${emptyRelatedValue(host.wilaya)}
        </td>

        <td>
          ${formatNumber(host.programCount)}
        </td>

        <td>
          ${badge("read", host.subscriptionStatus)}
        </td>

        <td>
          ${formatDate(host.created_at)}
        </td>
      </tr>
    `
  );

  return `
    ${heading("المنظمون", "حسابات المنظمين والبرامج والاشتراكات المرتبطة بهم")}

    <div class="toolbar">
      ${searchField("hosts", "ابحث عن منظم أو شركة…")}
    </div>

    ${dataTable(
      [
        "اسم المنظم",
        "اسم الشركة",
        "البريد الإلكتروني",
        "الهاتف",
        "الولاية",
        "عدد البرامج",
        "حالة الاشتراك",
        "تاريخ التسجيل"
      ],
      rows
    )}
  `;
}

/* -------------------------------------------------------
   Programs renderer
------------------------------------------------------- */

function programsPage(programs) {
  const search = state.searches.programs
    .trim()
    .toLocaleLowerCase();

  const filteredPrograms = programs.filter((program) => {
    const matchesStatus =
      state.filters.programStatus === "all" ||
      program.status === state.filters.programStatus;

    const searchable = [
      program.title,
      program.location,
      displayName(program.host),
      program.host?.company_name
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();

    return matchesStatus && searchable.includes(search);
  });

  const rows = filteredPrograms.map(
    (program) => `
      <tr>
        <td>
          <span class="table-person">
            ${emptyRelatedValue(program.title)}
          </span>
        </td>

        <td>
          ${relatedName(program.host, program.host_id)}
        </td>

        <td>
          ${emptyRelatedValue(program.location)}
        </td>

        <td>
          ${formatPrice(program.price)}
        </td>

        <td>
          ${
            program.duration_days === null || program.duration_days === undefined
              ? "—"
              : formatNumber(program.duration_days)
          }
        </td>

        <td>
          ${formatDate(program.start_dae)}
        </td>

        <td>
          ${badge(program.status)}
        </td>

        <td>
          ${formatDate(program.created_at)}
        </td>

        <td>
          <button
            class="button button-danger program-delete-button"
            type="button"
            data-delete-program="${escapeHtml(program.id)}"
            aria-label="حذف البرنامج ${escapeHtml(program.title || "")}"
          >
            حذف البرنامج
          </button>
        </td>
      </tr>
    `
  );

  return `
    ${heading("البرامج", "البرامج المسجلة وحالات نشرها في قاعدة البيانات")}

    <div class="toolbar">
      ${searchField("programs", "ابحث عن برنامج أو منظم أو موقع…")}

      ${filterSelect(
        "programStatus",
        [
          ["all", "الكل"],
          ["pending", "قيد المراجعة"],
          ["published", "منشور"],
          ["rejected", "مرفوض"]
        ],
        "تصفية حسب الحالة"
      )}
    </div>

    ${dataTable(
      [
        "اسم البرنامج",
        "المنظم",
        "الموقع",
        "السعر",
        "المدة (يوم)",
        "تاريخ البدء",
        "الحالة",
        "تاريخ الإنشاء",
        "إجراء"
      ],
      rows
    )}
  `;
}

/* -------------------------------------------------------
   Bookings renderer
------------------------------------------------------- */

function bookingsPage(bookings) {
  const search = state.searches.bookings
    .trim()
    .toLocaleLowerCase();

  const filteredBookings = bookings.filter((booking) => {
    const matchesStatus =
      state.filters.bookingStatus === "all" ||
      booking.status === state.filters.bookingStatus;

    const searchable = [
      booking.id,
      displayName(booking.tourist),
      booking.program?.title,
      displayName(booking.host)
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();

    return matchesStatus && searchable.includes(search);
  });

  const rows = filteredBookings.map(
    (booking) => `
      <tr>
        <td>
          <span class="table-person">
            ${escapeHtml(booking.id)}
          </span>
        </td>

        <td>
          ${relatedName(booking.tourist, booking.tourist_id)}
        </td>

        <td>
          ${relatedValue(booking.program?.title, booking.program_id)}
        </td>

        <td>
          ${relatedName(booking.host, booking.program?.host_id)}
        </td>

        <td>
          ${formatNumber(booking.people_count)}
        </td>

        <td>
          ${formatPrice(booking.total_price)}
        </td>

        <td>
          ${formatPrice(booking.budget)}
        </td>

        <td>
          ${badge(booking.status)}
        </td>

        <td>
          ${formatDate(booking.created_at)}
        </td>
      </tr>
    `
  );

  return `
    ${heading("الحجوزات", "الحجوزات الفعلية المرتبطة بالمسافرين والبرامج")}

    <p class="visibility-note">
      تُعرض جميع الحجوزات التي تسمح صلاحيات Supabase (RLS) بقراءتها. إذا كانت هناك حجوزات لا تظهر، فلن تتجاوز لوحة الإدارة صلاحيات قاعدة البيانات.
    </p>

    <div class="toolbar">
      ${searchField("bookings", "ابحث برقم الحجز أو المسافر أو البرنامج…")}

      ${filterSelect(
        "bookingStatus",
        [
          ["all", "الكل"],
          ["pending", "معلق"],
          ["confirmed", "مؤكد"],
          ["cancelled", "ملغى"]
        ],
        "تصفية حسب الحالة"
      )}
    </div>

    ${dataTable(
      [
        "رقم الحجز",
        "المسافر",
        "البرنامج",
        "المنظم",
        "عدد الأشخاص",
        "السعر الإجمالي",
        "الميزانية",
        "الحالة",
        "تاريخ الحجز"
      ],
      rows
    )}
  `;
}

/* -------------------------------------------------------
   Complaints renderer
------------------------------------------------------- */

function complaintsPage(complaints) {
  const search = state.searches.complaints
    .trim()
    .toLocaleLowerCase();

  const filteredComplaints = complaints.filter((complaint) => {
    const matchesStatus =
      state.filters.complaintStatus === "all" ||
      complaint.status === state.filters.complaintStatus;

    const searchable = [
      displayName(complaint.user),
      displayName(complaint.host),
      complaint.program?.title,
      complaint.reason,
      complaint.description,
      complaint.status
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();

    return matchesStatus && searchable.includes(search);
  });

  const statuses = [
    ...new Set(
      complaints
        .map((complaint) => complaint.status)
        .filter(Boolean)
    )
  ];

  const options = [
    ["all", "الكل"],
    ...statuses.map((status) => [status, translateStatus(status)])
  ];

  const rows = filteredComplaints.map(
    (complaint) => `
      <tr>
        <td>
          ${relatedName(complaint.user, complaint.user_id)}
        </td>

        <td>
          ${relatedValue(complaint.program?.title, complaint.program_id)}
        </td>

        <td>
          ${relatedName(complaint.host, complaint.host_id)}
        </td>

        <td>
          ${emptyRelatedValue(complaint.reason)}
        </td>

        <td>
          ${emptyRelatedValue(complaint.description)}
        </td>

        <td>
          ${badge(complaint.status)}
        </td>

        <td>
          ${formatDate(complaint.created_at)}
        </td>

        <td>
          ${formatDate(complaint.updated_at)}
        </td>
      </tr>
    `
  );

  return `
    ${heading("الشكاوى", "الشكاوى الواردة وحالتها كما هي مسجلة في قاعدة البيانات")}

    <div class="toolbar">
      ${searchField("complaints", "ابحث في المستخدم أو البرنامج أو السبب…")}

      ${filterSelect("complaintStatus", options, "تصفية حسب الحالة")}
    </div>

    ${dataTable(
      [
        "المستخدم",
        "البرنامج",
        "المنظم",
        "السبب",
        "الوصف",
        "الحالة",
        "تاريخ الإنشاء",
        "تاريخ التحديث"
      ],
      rows
    )}
  `;
}

/* -------------------------------------------------------
   Notifications renderer
------------------------------------------------------- */

function notificationsPage(notifications) {
  const items = notifications
    .map(
      (notification) => `
        <article class="notification-card ${notification.read ? "" : "unread-card"}">
          <span class="notification-icon">
            ♧
          </span>

          <div class="notification-body">
            <div class="notification-title-row">
              <strong>
                ${escapeHtml(notification.title)}
              </strong>

              ${badge(
                notification.read ? "read" : "unread",
                notification.read ? "مقروء" : "غير مقروء"
              )}
            </div>

            <p>
              ${escapeHtml(notification.body)}
            </p>

            <div class="notification-meta">
              <span>
                ${escapeHtml(notification.type || "general")}
              </span>

              <span>·</span>

              <span>
                ${relatedName(notification.user, notification.user_id)}
              </span>

              <span>·</span>

              <span>
                ${formatDate(notification.created_at)}
              </span>
            </div>
          </div>
        </article>
      `
    )
    .join("");

  return `
    ${heading(
      "الإشعارات",
      "الإشعارات المحفوظة في قاعدة البيانات"
    )}

    ${
      items
        ? `
          <div class="notification-list">
            ${items}
          </div>
        `
        : `
          <div class="panel empty-state">
            <span>♧</span>
            لا توجد إشعارات مرئية وفق صلاحيات القراءة الحالية
          </div>
        `
    }
  `;
}

/* -------------------------------------------------------
   Local settings
------------------------------------------------------- */

const SETTINGS_KEYS = {
  theme: "haws_biya_admin_theme",
  language: "haws_biya_admin_language"
};

function getSavedTheme() {
  const value = localStorage.getItem(SETTINGS_KEYS.theme);
  return value === "dark" ? "dark" : "light";
}

function getSavedLanguage() {
  const value = localStorage.getItem(SETTINGS_KEYS.language);
  return value === "en" ? "en" : "ar";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(SETTINGS_KEYS.theme, theme);
}

function applyLanguage(language) {
  if (language !== "ar") {
    showToast("اللغة الإنجليزية ستُضاف دون تغيير تصميم اللوحة.");
    localStorage.setItem(SETTINGS_KEYS.language, "ar");
    return;
  }

  document.documentElement.lang = "ar";
  document.documentElement.dir = "rtl";
  localStorage.setItem(SETTINGS_KEYS.language, "ar");
}

function settingsPage() {
  const theme = getSavedTheme();

  return `
    ${heading("الإعدادات", "إعدادات واجهة لوحة الإدارة")}

    <div class="settings-layout">
      <nav class="panel settings-nav" aria-label="أقسام الإعدادات">
        <button class="selected" type="button" data-setting-section="info">
          ♙ معلومات لوحة الإدارة
        </button>
        <button type="button" data-setting-section="appearance">
          ◐ المظهر
        </button>
        <button type="button" data-setting-section="language">
          文 اللغة
        </button>
        <button type="button" data-setting-section="general">
          ⚙ إعدادات عامة
        </button>
      </nav>

      <section class="panel settings-panel" id="settings-panel-content">
        <h2>معلومات لوحة الإدارة</h2>
        <p>إعدادات لوحة الإدارة المحلية محفوظة على هذا المتصفح فقط.</p>

        <div class="setting-row">
          <div>
            <strong>اسم المنصة</strong>
            <small>واجهة إدارة منصة Haws Biya</small>
          </div>
          <span class="setting-value">Haws Biya</span>
        </div>

        <div class="setting-row">
          <div>
            <strong>لغة الواجهة</strong>
            <small>اتجاه ومحتوى لوحة الإدارة</small>
          </div>
          <span class="setting-value">العربية (RTL)</span>
        </div>

        <div class="setting-row">
          <div>
            <strong>مصدر البيانات</strong>
            <small>قراءة الجداول وفق سياسات قاعدة البيانات</small>
          </div>
          <span class="setting-value">Supabase</span>
        </div>

        <div class="setting-row">
          <div>
            <strong>المظهر الحالي</strong>
            <small>تفضيل محلي لهذا المتصفح</small>
          </div>
          <span class="setting-value">${theme === "dark" ? "داكن" : "فاتح"}</span>
        </div>
      </section>
    </div>
  `;
}

function renderSettingsSection(section) {
  const panel = document.getElementById("settings-panel-content");
  if (!panel) return;

  document.querySelectorAll(".settings-nav button").forEach((button) => {
    button.classList.toggle("selected", button.dataset.settingSection === section);
  });

  if (section === "appearance") {
    const current = getSavedTheme();
    panel.innerHTML = `
      <h2>المظهر</h2>
      <p>يمكنك تغيير تفضيل المظهر دون المساس بتصميم لوحة الإدارة.</p>
      <div class="setting-row">
        <div>
          <strong>المظهر الفاتح</strong>
          <small>المظهر الأساسي الحالي للوحة</small>
        </div>
        <button class="toggle-switch ${current === "light" ? "on" : ""}" type="button" data-theme-choice="light" aria-label="المظهر الفاتح"></button>
      </div>
      <div class="setting-row">
        <div>
          <strong>المظهر الداكن</strong>
          <small>سيتم حفظ الاختيار لهذا المتصفح</small>
        </div>
        <button class="toggle-switch ${current === "dark" ? "on" : ""}" type="button" data-theme-choice="dark" aria-label="المظهر الداكن"></button>
      </div>
    `;
    return;
  }

  if (section === "language") {
    panel.innerHTML = `
      <h2>اللغة</h2>
      <p>لغة لوحة الإدارة الحالية هي العربية.</p>
      <div class="setting-row">
        <div>
          <strong>العربية</strong>
          <small>العربية مع اتجاه RTL</small>
        </div>
        <button class="button button-soft" type="button" data-language-choice="ar">استخدام العربية</button>
      </div>
    `;
    return;
  }

  if (section === "general") {
    panel.innerHTML = `
      <h2>إعدادات عامة</h2>
      <p>إعدادات عامة للوحة الإدارة لا تحتاج إلى جدول جديد في Supabase حاليًا.</p>
      <div class="setting-row">
        <div>
          <strong>مصدر البيانات</strong>
          <small>البيانات المعروضة تأتي من Supabase وفق RLS.</small>
        </div>
        <span class="setting-value">Supabase</span>
      </div>
    `;
    return;
  }

  panel.innerHTML = `
    <h2>معلومات لوحة الإدارة</h2>
    <p>إعدادات لوحة الإدارة المحلية محفوظة على هذا المتصفح فقط.</p>
  `;
}

/* -------------------------------------------------------
   Render / navigation
------------------------------------------------------- */

const renderers = {
  dashboard: dashboardPage,
  users: usersPage,
  hosts: hostsPage,
  programs: programsPage,
  bookings: bookingsPage,
  complaints: complaintsPage,
  notifications: notificationsPage,
  settings: settingsPage
};

function renderPage() {
  const title = pageLabels[state.page];
  document.getElementById("breadcrumb-current").textContent = title;

  document.querySelectorAll(".nav-item[data-page]").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === state.page);
  });

  if (state.page === "settings") {
    pageContent.innerHTML = settingsPage();
    return;
  }

  if (state.data === null) {
    pageContent.innerHTML = loadingState();
    return;
  }

  pageContent.innerHTML = renderers[state.page](state.data);
}

async function loadCurrentPage(requestId) {
  const loader = pageLoaders[state.page];

  if (!loader) {
    state.data = null;
    renderPage();
    return;
  }

  state.data = null;
  renderPage();

  try {
    const data = await loader();

    if (requestId !== state.requestId) return;

    state.data = data;
    renderPage();
  } catch (error) {
    if (requestId !== state.requestId) return;

    state.data = { error };
    pageContent.innerHTML = errorState(error);
  }
}

function navigate(page) {
  if (!renderers[page]) return;

  state.page = page;
  state.requestId += 1;

  closeSidebar();

  if (page === "settings") {
    state.data = null;
    renderPage();
    return;
  }

  void loadCurrentPage(state.requestId);
}

function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-scrim").classList.remove("open");
}

/* -------------------------------------------------------
   Toast
------------------------------------------------------- */

function showToast(message) {
  const region = document.getElementById("toast-region");
  const toast = document.createElement("div");

  toast.className = "toast";
  toast.textContent = message;

  region.append(toast);
  window.setTimeout(() => toast.remove(), 3500);
}

/* -------------------------------------------------------
   Global click handling
------------------------------------------------------- */

document.addEventListener("click", (event) => {
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) {
    event.preventDefault();
    navigate(pageButton.dataset.page);
    return;
  }

  const retryButton = event.target.closest('[data-action="retry"]');
  if (retryButton) {
    state.requestId += 1;
    void loadCurrentPage(state.requestId);
    return;
  }

  const deleteProgramButton = event.target.closest("[data-delete-program]");
  if (deleteProgramButton) {
    void deleteProgram(deleteProgramButton);
    return;
  }

  const settingButton = event.target.closest("[data-setting-section]");
  if (settingButton) {
    renderSettingsSection(settingButton.dataset.settingSection);
    return;
  }

  const themeButton = event.target.closest("[data-theme-choice]");
  if (themeButton) {
    applyTheme(themeButton.dataset.themeChoice);
    renderSettingsSection("appearance");
    showToast("تم حفظ إعداد المظهر");
    return;
  }

  const languageButton = event.target.closest("[data-language-choice]");
  if (languageButton) {
    applyLanguage(languageButton.dataset.languageChoice);
    renderSettingsSection("language");
    showToast("تم استخدام العربية");
    return;
  }
});

async function deleteProgram(button) {
  const programId = button.dataset.deleteProgram;
  const program = state.data?.find(
    (item) => String(item.id) === programId
  );

  if (!programId || !program) {
    showToast("تعذر تحديد البرنامج المطلوب حذفه. حدّث القائمة وحاول مجددًا.");
    return;
  }

  const programName = program.title || programId;
  if (!window.confirm(`هل أنت متأكد من حذف البرنامج «${programName}»؟ لا يمكن التراجع عن هذا الإجراء.`)) {
    return;
  }

  button.disabled = true;
  button.textContent = "جارٍ الحذف…";

  try {
    const { data, error } = await requireClient()
      .from("programs")
      .delete()
      .eq("id", programId)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new Error(
        [
          error.message,
          error.details,
          error.hint,
          error.code ? `(${error.code})` : ""
        ].filter(Boolean).join(" — ")
      );
    }

    if (!data || String(data.id) !== programId) {
      throw new Error(
        "لم يُحذف السجل. قد تمنع صلاحيات RLS الحذف أو قد يكون البرنامج مرتبطًا بسجلات أخرى."
      );
    }

    if (state.page === "programs" && Array.isArray(state.data)) {
      state.data = state.data.filter(
        (item) => String(item.id) !== programId
      );
      renderPage();
    }
    showToast("تم حذف البرنامج من Supabase.");
  } catch (error) {
    showToast(`تعذر حذف البرنامج من Supabase: ${formatError(error)}`);
    button.disabled = false;
    button.textContent = "حذف البرنامج";
  }
}

/* -------------------------------------------------------
   Search & Filters
------------------------------------------------------- */

document.addEventListener("input", (event) => {
  const search = event.target.closest("[data-search]");
  if (!search || state.data === null || state.data?.error) return;

  state.searches[search.dataset.search] = search.value;
  const position = search.selectionStart;

  renderPage();

  const replacement = pageContent.querySelector(
    `[data-search="${search.dataset.search}"]`
  );
  replacement?.focus();
  replacement?.setSelectionRange(position, position);
});

document.addEventListener("change", (event) => {
  const filter = event.target.closest("[data-filter]");
  if (!filter || state.data === null || state.data?.error) return;

  state.filters[filter.dataset.filter] = filter.value;
  renderPage();
});

/* -------------------------------------------------------
   Login & Logout
------------------------------------------------------- */

document.addEventListener("submit", async (event) => {
  if (event.target.id !== "login-form") return;

  event.preventDefault();

  const input = document.getElementById("security-code");
  const errorMessage = document.getElementById("security-error");

  if (input.value !== ADMIN_SECURITY_CODE) {
    errorMessage.textContent = "رمز الدخول غير صحيح. تحقق من الرمز وحاول مرة أخرى.";
    errorMessage.classList.remove("is-hidden");
    input.setAttribute("aria-invalid", "true");
    input.focus();
    return;
  }

  errorMessage.textContent = "";
  errorMessage.classList.add("is-hidden");
  input.removeAttribute("aria-invalid");

  const submitButton = event.target.querySelector('button[type="submit"]');
  const submitLabel = submitButton.innerHTML;

  submitButton.disabled = true;
  submitButton.textContent = "جارٍ تهيئة الاتصال…";
  input.disabled = true;

  try {
    const configuration = await getSupabaseConfiguration();
    supabaseClient = configuration.client;
    supabaseConfigurationError = configuration.error;

    if (configuration.error || !configuration.client) {
      throw new Error(configuration.error || "تعذر إنشاء اتصال Supabase.");
    }

    applyTheme(getSavedTheme());
    applyLanguage(getSavedLanguage());

    loginScreen.classList.add("is-hidden");
    appShell.classList.remove("is-hidden");

    document.getElementById("today-date").textContent =
      new Intl.DateTimeFormat("ar-DZ", { dateStyle: "medium" }).format(new Date());

    showToast("تم فتح لوحة الإدارة");
    navigate("dashboard");
  } catch (error) {
    errorMessage.textContent = `تعذر تهيئة الاتصال: ${formatError(error)}`;
    errorMessage.classList.remove("is-hidden");
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = submitLabel;
    input.disabled = false;
  }
});

document.getElementById("logout-button").addEventListener("click", () => {
  state.requestId += 1;
  state.data = null;

  appShell.classList.add("is-hidden");
  loginScreen.classList.remove("is-hidden");

  const form = document.getElementById("login-form");
  form.reset();

  const errorMessage = document.getElementById("security-error");
  errorMessage.textContent = "";
  errorMessage.classList.add("is-hidden");

  document.getElementById("security-code").removeAttribute("aria-invalid");
  document.getElementById("security-code").focus();

  showToast("تم تسجيل الخروج");
});

/* -------------------------------------------------------
   Mobile sidebar & preferences initialization
------------------------------------------------------- */

document.getElementById("menu-button").addEventListener("click", () => {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("sidebar-scrim").classList.add("open");
});

document.getElementById("sidebar-scrim").addEventListener("click", closeSidebar);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSidebar();
});

applyTheme(getSavedTheme());
applyLanguage(getSavedLanguage());

window.testAdminProfiles = async function () {
  try {
    const result = await loadAdminProfiles();
    console.log("ADMIN PROFILES RESULT:", result);
    return result;
  } catch (error) {
    console.error("ADMIN PROFILES ERROR:", error);
    throw error;
  }
};