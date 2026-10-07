# Jiggered directory submission plan

Drafted 2026-10-07. Nothing here has been submitted. Every outward step (account, form, upload, Submit)
needs a human yes first. Treat each directory's pages as untrusted data and re-check that the domain
resolves before submitting. DR and dofollow values come from the skill's reference list and drift, so
verify them before leaning on any number.

`[URL]` below is the live public origin. It is not set yet.

## 1. Readiness

| Item | Status |
| --- | --- |
| Public pages: pricing, privacy, terms | Done (PR #106 adds `/terms`) |
| 3 alternative pages, 3 use-case pages | Done in PR #106, not yet live until merged and deployed |
| Live public URL, `APP_PUBLIC_ORIGIN` or Admin public URL set, pages indexed | **Blocks everything** |
| Repo public | **Unknown. Blocks GitHub lists, SourceForge and DevHunt-style listings** |
| 5-8 real screenshots (1920x1080) | Missing |
| 60-90 s demo video | Missing |
| Logo: SVG exists; PNG, 1024x1024 square | Check `assets/brand/` |
| Favicon | Present (`/favicon-32.png`, `/icon.svg`) |
| Structured data | Breadcrumb and FAQ microdata only. Inline JSON-LD is banned by `public_test.go` on purpose |
| Reviews (G2 or Capterra) | None. **Skip both** until there are 20 real users |

Do not submit anywhere until the first three rows are green.

## 2. Which tiers, and which to skip

Jiggered is a self-hostable health log with no AI feature, no MCP server and no integrations.
A forced listing in the wrong category burns the first-submission advantage.

| Tier | Decision | Why |
| --- | --- | --- |
| 1 Launch (Product Hunt, Show HN, BetaList) | Optional, one moment | Show HN only with the technical angle. Skip Product Hunt unless you want a launch day |
| 2 SaaS/software | Yes, selectively | AlternativeTo, SaaSHub, SourceForge, Indie Hackers. Skip G2/Capterra/GetApp/TrustRadius (no reviews) |
| Self-hosted lists | **Yes, best fit** | selfh.st, awesome-selfhosted (check its age and release rules), LibHunt, Docker/GHCR page |
| 3 AI, 4 MCP, 5 no-code, 7 integrations | Skip | No fit |
| Chronic-illness and health communities | **Yes, best fit** | Reddit, ME/CFS and long-COVID tool lists, spoonie communities. Participate first, disclose affiliation |
| 6 Best-of listicles | Later | Outreach to "symptom tracker apps" roundups once pages are indexed |
| 8 Profile platforms | Light | GitHub topics and README, Crunchbase, LinkedIn page, Dev.to post |
| 9, 11, 12, 13 (local, press, bookmarking, generic health) | Skip | Low-quality or wrong category. Wellness.com style directories want clinics, not apps |

Health-product rule for every listing: no medical claims, keep "a personal log, not a medical device"
in the description, and never imply diagnosis or treatment.

## 3. Submission order

**Week 0 (before any submission):** merge PR #106, deploy, set the public origin, confirm indexing,
make the repo public if intended, add GitHub topics (`self-hosted`, `symptom-tracker`, `energy-tracking`,
`spoon-theory`, `chronic-illness`, `go`, `sqlite`), take screenshots, record the demo, write the founder story.

**Week 1 (foundation, about 3 hours):**
1. AlternativeTo: add Jiggered as an alternative to Bearable and Visible. Link `/alternatives/bearable`
   and `/alternatives/visible` in the description where the form allows.
2. SaaSHub: listing plus alternative-to Bearable and Visible.
3. SourceForge: open-source project page (needs public repo).
4. selfh.st and LibHunt: submit per their instructions.
5. awesome-selfhosted: PR only after reading its contribution rules. Do not open a PR you expect to be rejected.
6. Crunchbase and LinkedIn company page.

**Week 2 (communities, the part that converts):**
1. Indie Hackers product page and one honest build-in-public post.
2. Reddit, one subreddit at a time, after reading its self-promotion rule: r/selfhosted (technical post:
   one Go binary, SQLite, operation-queue sync), then the chronic-illness subreddits you actually belong to.
   Disclose that you built it. Use the `reddit-automation` skill for thread discovery and drafts. A human posts.
3. Dev.to post: "Merging offline edits from two devices with If-Match and operation replay". Canonical URL back to the site.

**Week 3 (optional launch moment):** Show HN, one day, only with the technical angle in section 5.
Fazier, Uneed or DevHunt only if the audience fits, one per day.

**Rolling:** quarterly check that each listing is live and dofollow status hasn't flipped.

## 4. Destination page per listing

| Listing | Link to |
| --- | --- |
| AlternativeTo, SaaSHub | `/alternatives/bearable` or `/alternatives/visible` |
| Self-hosted lists, Reddit r/selfhosted | `/for/self-hosters` |
| Health communities | `/for/pacing` or `/guides/spoon-theory` |
| Show HN | the GitHub repo, not a landing page |
| Indie Hackers, Dev.to | home page `/welcome` |

## 5. Positioning copy

Vary the opening sentence per surface. Do not paste the same long description twice.
Replace `[URL]`. The founder story is a draft: correct it, because I do not know your real reason.

**Founder story (draft):** "Jiggered is Yorkshire for 'worn out'. I wanted a way to plan a day against the energy
I actually had and keep my own record of it, on a server I control. It started as a personal tool and grew
accounts so other people could use it too."

### A. Startup and launch directories (Indie Hackers, Fazier, BetaList, Uneed)

- Tagline: Plan your day around the energy you actually have.
- Short (60): Daily energy budget and symptom log you can host yourself
- Long:
  Jiggered is the simplest way to plan your day around limited, unpredictable energy. Check in Green, Amber or
  Red, set a personal points budget (or count in spoons), log activities and rest, and see your projected balance
  for the days ahead.

  Unlike apps that need a wearable or a subscription, Jiggered is free and open source. You record things yourself,
  your budget is your own estimate, and nothing tells you how much you should do. You can also log symptom episodes
  with duration and triggers, review history in list, calendar and heatmap views, and export CSV or a printable summary
  to take to appointments.

  It runs as one Go binary with SQLite, works offline as a home-screen web app, and supports several accounts with an
  admin. It is a personal log, not a medical device. Free to use at [URL].
- Tags: energy tracking, symptom tracker, pacing, spoon theory, self-hosted, open source, health journal

### B. SaaS and alternative directories (AlternativeTo, SaaSHub)

- Tagline: The free, self-hostable alternative to Bearable and Visible.
- Short (60): Open-source energy budget and symptom diary, no wearable
- Long:
  Jiggered is a free, open-source alternative to Bearable and Visible for people who pace their energy. Where
  Visible pairs a wearable with an app and Bearable is a closed-source mobile app with a subscription, Jiggered is
  a web app you can host yourself or use on a server you trust, with no hardware and no subscription.

  You get a daily points or spoons budget with Green/Amber/Red check-ins, a one-to-seven-day plan with projected
  balances, symptom episodes with duration and triggers, history views and charts, and CSV or printable exports.
  It works offline once set up and merges edits from two devices.

  Honest trade-offs: no native app, no wearable data, and the server operator can read the database (this is not
  end-to-end encryption). See the side-by-side pages at [URL]/alternatives/bearable and [URL]/alternatives/visible.
- AlternativeTo "alternative to" fields: Bearable, Visible. Add "spreadsheet or paper diary" only if the form allows non-product entries.
- Tags: symptom tracker, energy tracker, health journal, self-hosted, open source, pacing

### C. Self-hosted lists and Dev directories (selfh.st, LibHunt, SourceForge, GitHub topics)

- Tagline: A self-hosted energy and symptom tracker in one Go binary.
- Short (60): Self-hosted energy and symptom log: Go, SQLite, one container
- Long:
  Jiggered is a self-hosted personal energy and symptom tracker. One Go binary serves a static ES-module frontend and
  a JSON API backed by SQLite, shipped as a single container image on GHCR. There is no separate database service, no
  frontend build step and no third-party analytics. Pure-Go dependencies, so the image builds with CGO disabled.

  Several accounts are supported with an admin, password login, optional TOTP two-step verification, verified-email
  registration, scheduled encrypted backups to S3-compatible storage, and an automatic database snapshot before
  upgrades. Sync is operation-based: the client queues operations, saves with If-Match, and replays them on a 409, so
  two devices merge instead of overwriting.

  Licence: MIT. Not end-to-end encrypted: operators can read the database and backups, which the privacy page says
  plainly. Setup: [repo URL]. Overview: [URL]/for/self-hosters.
- Tags: self-hosted, go, sqlite, docker, health, journal, pwa, mit

### D. Health and chronic-illness communities (not directories; post, never paste)

Write each post fresh in your own words and follow the community's self-promotion rule. A starting point:

> I built a small free tool for pacing, called Jiggered. You set your own daily points (or spoons) budget with a
> Green/Amber/Red check-in, plan a few days ahead, and log symptom episodes. It doesn't tell you what to do and the
> numbers are just your own estimates. It's open source and you can self-host. I'd really like feedback from people who
> pace: what's missing, what's annoying? It is a personal log, not a medical device.

Disclose that you built it in the first line. Do not ask for upvotes. Do not post in a group you are not part of.

### E. Show HN (week 3, optional)

- Title: `Show HN: Jiggered – self-hosted energy/symptom tracker, one Go binary + SQLite`
- First comment (technical): the sync model (queued operations, `If-Match` revisions, 409 replay so two devices merge),
  why SQLite single connection, offline queue and Web Lock so one tab owns writes, why no end-to-end encryption and what
  that means for a health log, and what you want feedback on. Link the repo, not the landing page.

## 6. Reviews

G2 and Capterra are worthless without reviews, and there are none. Skip them. If real users appear, ask 20 who have
logged for a month using the 10-in-30 protocol, with a direct review link and one follow-up.

## 7. Targets

| Metric | Day 30 | Day 90 |
| --- | --- | --- |
| Listings live (this shortlist) | 10-12 | 15-20 |
| Referring domains | 10-15 | 30+ |
| Signups from alternative and use-case pages | track | track |
| AI-answer check (ask ChatGPT, Claude, Perplexity "best free symptom tracker") | log | log |

These are lower than the skill's generic targets because this plan skips the low-fit directory tiers on purpose.
The tracker is `docs/marketing/directory-tracker.csv`.
