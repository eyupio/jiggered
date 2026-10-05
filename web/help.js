// Task-focused help lives in the app and remains available offline.
import { energyCopy, themeOf } from "./energy-theme.js";
import { applyRegion } from "./region.js";
import { $, html, raw, setHTML } from "./util.js";

export function init(ctx) {
  const topics = [
    [
      "start",
      "Getting started",
      "Make Jiggered fit your day",
      html`<p>Start in Today with a green, amber or red check-in. Tap an activity when you do it. Use Episode when you want to record symptoms, and History when you want to review or share your log.</p><p>Your account is created by the person who runs Jiggered, or you can register from sign-in if they allow it. Email verification is required for registration. A temporary password must be changed at first sign-in.</p><button class="secondary" data-help-go="today">Open Today</button>`,
    ],
    [
      "spoons",
      "Personalise",
      "Can I use spoon theory instead of points?",
      html`<p>Yes. In Account → Profile → Energy language, choose Spoons and Save profile. One spoon represents one point: budgets, activity costs and past records keep the same numbers. Your preference follows your account across devices, and you can switch back at any time.</p><p>Christine Miserandino's spoon theory describes limited daily energy using spoons as a metaphor. You decide the estimates that fit your day. Recovery entries are your own observations, rather than a guarantee that rest restores energy.</p><p>History and printed summaries follow your choice. CSV column names stay the same so existing spreadsheets keep working; JSON backups include your preference.</p><button class="secondary" data-settings="profile-panel">Choose my energy language</button>`,
    ],
    [
      "security",
      "Account & privacy",
      "Recover your password and protect sign-in",
      html`<p>In Account → Sign-in security, add a recovery email and verify the emailed link. If the administrator enables email recovery, Forgot password on the sign-in page sends a one-use link that expires in 30 minutes. Check spam too. Otherwise ask the administrator to reset your password.</p><p>For two-step verification, enter your password, scan the QR code in an authenticator app and confirm the six-digit code. Save the recovery codes shown once. Every recovery code works once, and a used authenticator code cannot be reused.</p><p>Password recovery keeps two-step protection on and needs an authenticator or recovery code. Lost your phone and all codes? Ask an administrator to verify your identity and reset two-step verification.</p><button class="secondary" data-help-go="account">Open Account</button>`,
    ],
    [
      "points",
      "Daily energy",
      "What do points and check-in colours mean?",
      html`<p>Points are personal planning estimates. Your starting budget is the amount you plan around each day. An activity's cost is what you type in a form: 2 uses 2 points, −1 gives 1 back, and 0 only records the activity. Everywhere else the sign is the effect on your balance, so those show as −2 and +1.</p><p>Green means a normal plan, amber a reduced plan and red essentials only. Tapping the selected colour clears that check-in. Poor sleep reduces the day's starting budget by your chosen amount.</p><p>Your balance can go below zero or above the starting budget. It is a record, not a recommendation to do more. Past days retain their recorded budget.</p><p>If you think about energy in spoons, read our <a href="/guides/spoon-theory">Spoon Theory guide</a> and <a href="https://www.butyoudontlooksick.com/articles/written-by-christine/the-spoon-theory/" target="_blank" rel="noopener">Christine Miserandino’s original essay<span class="sr-only"> (opens in a new tab)</span></a>. Jiggered points are your own estimates, not a fixed spoon scale.</p><button class="secondary" data-settings="set-budget">Adjust my budget</button>`,
    ],
    [
      "activities",
      "Daily energy",
      "Log, correct or reorder activities",
      html`<p>Tap a preset to log it at the current time. The activity turns green with how many times you logged it. Use + to log another and − to take the latest one off (Undo is offered). To log something that already happened, use Your day on a timeline: drag an activity onto the hour (on a phone, tap it, then tap the hour), drag a block to move it, and drag its bottom edge to change how long it took: the points follow. Right-click a block, or press its ⋯ menu, to edit, duplicate, colour or change its points. With a keyboard, focus a block, then use Up and Down to move it 15 minutes, Shift with Up and Down to change its length, Enter to edit and Delete to remove it. Other activity records a one-off item without adding a preset. Choose a past day with the arrows or date picker; its time field is optional.</p><p>Use Edit beside a logged item to change its name, points or time. Corrections and removals offer Undo briefly after the action.</p><p>In Account, drag a list handle to move an item. With a keyboard, focus the handle and use Up, Down, Home or End. Move buttons are also available. Press Escape to cancel a drag. Save settings to keep the new order.</p><button class="secondary" data-settings="set-acts">Personalise my activities</button>`,
    ],
    [
      "plan",
      "Daily energy",
      "Plan ahead on a timeline",
      html`<p>Plan shows the coming days with a timeline for each. Pick an activity from the list and drop it on an hour (on a phone, tap the activity, then tap the hour), or use Add activity or recovery for a form. Untimed items wait in the Any time row. Drag a block to move it, and drag its bottom edge to change how long it takes.</p><p>Each day starts from your full budget unless you change its starting points. Planning does not change your history until you finish a planned item on Today.</p>`,
    ],
    [
      "fretboard",
      "Tools",
      "Fretboard: see what is fretting you",
      html`<p>Fretboard, in Tools, is a board for the things on your mind. Each card sits where it belongs: further right means it is more in your hands, higher up means it matters more right now. Colour a card by where it stands: not started, in progress, done, or not my problem (dashed, for things that weigh on you but are not yours to fix). Choosing a card's current colour again takes it back to not started.</p><p>Double-click an empty spot to add a card and start typing. Drag cards to move them, drag on empty space to select several, and right-click (or press and hold on a phone) for the menu: status, duplicate, bring to front, add to today's three, delete. Arrow keys nudge a selected card, 1 to 4 set its status, Delete removes it and Ctrl+Z undoes.</p><p>Today's three, beside the board, is the immediate plan: small, concrete and yours. Add a card from its menu, type one in (it gets a card in the top right too), or let Jiggered suggest from the top-right of the board. Tick them off as the day goes, and start fresh tomorrow. Click an axis label to rename it.</p><button class="secondary" data-help-tool="fretboard">Open Fretboard</button>`,
    ],
    [
      "episodes",
      "Episodes",
      "Record symptoms and finish an ongoing episode",
      html`<p>Enter when symptoms started, what you noticed, how they came on, a duration and anything relevant from the day or two before. Notes are optional. Save episode to add it to your history.</p><p>Still going keeps an episode visible in Today and Episode. Choose Record when it ended to finish it. An exact end time is optional; it must be between the start and now.</p><p>New times use this device's time zone. Existing captures retain their recorded offset when you edit them. Older records may have no offset.</p><div class="warn"><b data-emergency-call>Call your local emergency number</b> if symptoms come on suddenly, or with weakness, face drooping, speech problems or severe headache. Don't log first.</div><button class="secondary" data-help-go="episode">Open Episode</button>`,
    ],
    [
      "history",
      "Review & share",
      "Find records and share a summary",
      html`<p>History starts with a calendar and the day you've selected. Choose 7, 30, 90, 180 or 365 days, or all time. Filter and search lets you enter custom dates and find activities or episodes. The same period and filters apply to the calendar, records, charts, printed summary and CSVs. Check-in filters affect days; symptom and ongoing filters affect episodes. Clearing search and filters keeps your selected dates.</p><p>Colour the calendar by morning check-in, episodes, points remaining, activity points used, net activity points or poor sleep. Select a day to review its check-in, sleep, activities and episodes. The ← and → buttons move a day at a time; Edit day opens its log. Arrow keys move through the calendar by day or week; Enter selects and Escape clears. The day selector offers larger targets. Long histories page through windows of up to 366 days.</p><p>Browse records opens the full day and episode lists. Explore patterns opens the charts and observations when you want more detail. Graphs average only days with activities logged; gaps mean no activity log. Negative-cost entries record your recovery estimates. A missing poor-sleep flag does not prove good sleep. Comparisons need enough recorded days and do not establish a cause.</p><p>Prepare summary opens a preview for the current period and filters. Private episode notes are omitted unless you choose to include them. Print or save as PDF uses the same preview. CSV files include private notes and the matching records. Check what you're sharing before you export.</p><p>Your selected period, day, filters, open sections and position stay in place when you refresh this browser tab. These are your observations, not a diagnosis.</p><button class="secondary" data-help-go="history">Review my history</button>`,
    ],
    [
      "settings",
      "Personalise",
      "Personal settings or shared defaults?",
      html`<p>Account contains your daily budget, sleep cost, date format and activity, symptom and trigger lists. Lists can be reordered with drag, keyboard or move buttons. Save to apply changes; Discard draft removes unfinished edits.</p><p>When your admin adds items to the shared defaults, a notice offers to add just the new ones to the end of your lists; Account also has Add new shared items. Replace with shared defaults starts a draft again from theirs. Review and save to adopt either. Admin edits never rewrite your lists on their own.</p><button class="secondary" data-help-go="account">Open Account</button>`,
    ],
    [
      "restore",
      "Your data",
      "Download a backup or restore an export",
      html`<p>Download everything (JSON) creates a server export that the restore form can read. Resolve queued or refused changes first so the export includes them.</p><p>Choose an export and Preview restore. Keep-existing is the default; replace mode changes matching records, including settings. Review the counts before confirming. A copy of your current server data downloads before the restore commits.</p><p>If records or your selection change after preview, preview again. Invalid records reject the entire restore with a reason. A backup can restore replaced records; it does not remove records newly added by a restore.</p><p>Device recovery files include drafts and unsent changes for manual recovery. They cannot be uploaded to the restore form. Keep all downloads private.</p><button class="secondary" data-help-go="account">Open data tools</button>`,
    ],
    [
      "offline",
      "Troubleshooting",
      "Offline, unfinished drafts or refused changes",
      html`<p>After you've signed in online, Jiggered can open using this device's copy. Changes queue locally and retry when connected. A queued change has not yet reached your server. If storage is blocked or full, keep the page open and download recovery.</p><p>Episode, activity, profile and settings drafts stay on this device for seven days. Acknowledged saves and explicit discard clear the relevant draft. Signing out warns before removing unfinished work. A confirmed session expiry or revocation clears this browser’s logs and drafts; offline devices learn of it when they reconnect.</p><p>Recovery keeps refused or conflicting edits. Retry a refused save, edit a recovered copy where offered, or download it. For a conflict, choose Keep server copy or Use my change. Restoring a deleted record needs an explicit choice.</p><p>If you can't sign in, use Forgot password if email recovery is enabled and you have verified a recovery address, or ask your Jiggered admin to reset your password.</p><button class="secondary" data-help-go="account">Open recovery and data tools</button>`,
    ],
    [
      "tabs",
      "Troubleshooting",
      "Why is this tab read-only?",
      html`<p>One browser tab owns editing so tabs cannot overwrite each other's queued work. Other tabs can browse and download, and follow changes from the editing tab.</p><p>Close the editing tab, then choose Reload to edit here in the tab you want to use. Close tabs running an older Jiggered version after an upgrade.</p><p>Editing needs a supported browser on HTTPS (or localhost). If your browser reports that coordination is unavailable, ask your admin to check the connection.</p>`,
    ],
    [
      "privacy",
      "Your data",
      "Who can see my log?",
      html`<p>Personal check-ins and episodes belong to your account. Admin screens show account details and record counts, not your log. An admin can reset passwords, and a full database backup contains everyone's data, so use an instance and administrator you trust.</p><p>Device drafts, JSON downloads, CSVs and printed summaries may contain private health data. Keep them on trusted devices. Account lets you set a private display name and focus, choose appearance and a starting history period, change your password, sign out other devices and delete your account. Profile changes save separately from your energy settings and lists. Your sign-in username stays the same. Use the account shortcuts to jump to a section.</p><p>Deleting an account permanently removes its server records. Download what you need first.</p>`,
    ],
  ];
  const adminTopic = [
    "admin",
    "Admin guide",
    "Maintain shared defaults and support accounts",
    html`<p>Most admin changes ask for your password; Backups and Email & signup remember it for 30 minutes. Admin lets you create accounts, reset passwords, revoke sessions, change roles and disable or remove accounts. A new or reset temporary password is shown once; the person changes it at sign-in.</p><p>Shared product defaults set starting budgets and lists for new users. Reorder, add, edit or remove items in the same editor as personal settings, then save. Reload latest defaults after a conflicting change; your draft is kept.</p><p>Existing users keep personal choices unless they adopt shared defaults from Account. The final active admin cannot be removed or demoted. Activity records account-management events; it does not expose personal health logs.</p><p>Database backups contain everyone's data. Backups and Email & signup let you set up S3-compatible storage, scheduling, retention, verification and SMTP alerts. Test the saved configuration before relying on it. Registration and email recovery require working SMTP and a trusted public application URL. Keep the separate credential encryption key securely when restoring to another host. Connection settings should match your actual reverse-proxy setup.</p><button class="secondary" data-help-go="admin">Open Admin</button>`,
  ];
  const first = topics.find((t) => t[0] === "start") || topics[0];
  first[3] = html`${first[3]}<button class="secondary" data-help-setup>Review first-use setup</button>`;
  const list = $("help-topics"),
    search = $("help-search");
  const saved = ctx.ui?.get("help") || {};
  search.value = typeof saved.query === "string" ? saved.query.slice(0, 2000) : "";
  let role, theme;
  function mount() {
    if (role === ctx.me.role && theme === themeOf(ctx)) return;
    const opened = [...list.querySelectorAll("details[open]")].map((el) => el.id);
    role = ctx.me.role;
    theme = themeOf(ctx);
    setHTML(
      list,
      html`${[...topics, ...(role === "admin" ? [adminTopic] : [])].map(([id, category, title, content]) => html`<details class="help-topic" id="help-${id}" data-topic="${id}"><summary><span class="help-category">${category}</span><span>${id === "spoons" ? title : energyCopy(title, theme)}</span></summary><div class="help-answer">${id === "spoons" ? content : raw(energyCopy(content.s, theme))}</div></details>`)}`,
    );
    for (const id of opened) $(id).open = true;
  }
  mount();
  const filter = () => {
    const query = search.value.trim().toLocaleLowerCase();
    let count = 0;
    for (const detail of list.children) {
      detail.hidden = !detail.textContent.toLocaleLowerCase().includes(query);
      if (!detail.hidden) count++;
    }
    $("help-count").textContent = query ? `${count} ${count === 1 ? "topic" : "topics"} found` : "";
    $("help-empty").hidden = count !== 0;
  };
  search.addEventListener("input", filter);
  $("help-clear").addEventListener("click", () => {
    search.value = "";
    filter();
    search.focus();
  });
  $("help-back").addEventListener("click", () => ctx.back());
  $("help-panel").addEventListener("click", (e) => {
    const b = e.target.closest("[data-help-go]");
    if (b) ctx.go(b.dataset.helpGo);
    const tool = e.target.closest("[data-help-tool]");
    if (tool) ctx.openTool(tool.dataset.helpTool);
    if (e.target.closest("[data-help-setup]")) ctx.reopenSetup();
  });
  function open(topic) {
    search.value = "";
    filter();
    ctx.go("help");
    const detail = $("help-" + topic);
    if (detail) {
      detail.open = true;
      detail.querySelector("summary").focus();
      detail.scrollIntoView({ block: "nearest" });
    }
  }
  return {
    open,
    snapshot: () => ({ query: search.value }),
    render() {
      mount();
      applyRegion(ctx.store?.view("settings")?.profile?.region, list);
      filter();
    },
    show() {
      mount();
      applyRegion(ctx.store?.view("settings")?.profile?.region, list);
      filter();
    },
  };
}
