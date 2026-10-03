# Jiggered SEO and discoverability audit

## Summary

Audited `jnnngs/jiggered` at commit `af2c086ee753c02a870d5970f577fb1e5ef79de7` (default branch `main`), 2 October 2026.

The findings below describe the original audited snapshot. The implementation update at the end records the subsequent authorized changes and verification.

- **Rendering:** signed-out `/` and `/welcome` return complete static landing HTML from Go, with a client-side signup-status enhancement. `/login` and `/register` return static account-form HTML with JavaScript enhancements. Signed-in `/` returns an app shell whose personal data and hash-based views render client-side. There is no framework SSR, SSG build, ISR, or locale router; the public content is nevertheless present in the initial response.
- **Indexable pages found:** **1 distinct public content page at 2 eligible URLs**, `/` signed out and `/welcome`. Both carry the same content and a canonical to `/welcome`. This is code-level eligibility, not proof that Google has indexed either URL. Private app views, account forms, health checks, and APIs inherit `X-Robots-Tag: noindex, nofollow`.
- **Robots:** `web/robots.txt` exists and has a public route. It blocks `/login`, `/register`, and `/api/`; it does not block landing assets. Its `Allow: /$` and `Allow: /welcome$` rules do **not** make the rest of the site blocked: unspecified paths remain allowed. AI user agents inherit the wildcard policy.
- **Sitemap:** no sitemap file or handler; no `Sitemap:` directive. A signed-out sitemap request falls through to an authentication redirect, based on the routing source.
- **Verdict:** the public site has a sound crawlable foundation, but very little search coverage. Its main opportunity is to explain the product plainly and expose useful feature/help content as public pages. No verified critical de-indexing defect was found. Canonical/origin consistency and deployment indexing controls need attention before expanding the site.

### Evidence and limits

The source tree was retrieved through the GitHub connector at the pinned commit because the initial Git clone failed to connect to the workspace proxy. Routing, authentication middleware, asset serving, metadata, CSS, service worker, app boot, help content, configuration, README deployment guidance, and relevant existing tests were inspected. The tree contains no `AGENTS.md`.

An attempt to run `go build` failed: the installed `/usr/bin/go` did not recognize `build` or `version`; no other Go toolchain was found. **The actual Go application was not run, and its tests were not executed.** A temporary static preview outside the source tree served the actual landing HTML, styles, fonts, icon, and `login.js`. Playwright/Chromium inspected it with JavaScript disabled and enabled at 1440, 390, and 320 pixels wide, each 900 pixels high. The preview mocked `/api/auth/options` as closed, and separately as open; these are scenarios, not observations of production registration settings. This was DOM enhancement, not framework hydration. The preview did not emulate Go routing, asset version rewriting, security headers, auth, or CSP. Browser findings below concern markup/layout/client behavior; HTTP findings are explicitly source-derived.

No production origin was supplied. **Needs confirmation:** deployed headers/statuses, selected Google canonical, actual indexed URL count, registration availability, historical URL migrations, redirect chains at the CDN/proxy, rankings, query demand, backlinks, field Core Web Vitals, and Search Console coverage. No traffic-loss or ranking claim is inferred from source alone.

### What already works

- `web/landing.html` has `lang="en"`, a responsive viewport, one H1, header/nav/main/footer landmarks, sensible section headings, and real `<a href>` navigation/CTAs. Its feature, hosting, privacy, and FAQ answer text is in the original HTML, including the native `<details>` answers.
- Logos use SVG with explicit width/height. Empty alt text is appropriate where the adjacent wordmark names the brand; the illustrative preview is DOM/CSS/SVG rather than an oversized raster hero. No public image issue requiring descriptive alt or lazy loading was found.
- `main.go:318–327` explicitly opts the landing page into indexing; `main.go:546–555` deliberately keeps personal pages out. Missing descriptions or button/hash navigation inside the private tracker are not public SEO defects.
- Public CSS, fonts, login JS, and icons are reachable without authentication according to `publicAssets`, `/fonts/`, and `versionedAsset`. Fonts are self-hosted WOFF2 with `font-display: swap`. Public pages do not load the tracker’s large module graph.
- Existing SoftwareApplication microdata is present (`web/landing.html:81–88`); it is not a site with no structured data at all.
- No public calendar/filter pagination trap, session identifier in public URLs, or infinite public faceted navigation was found. App dates/filters stay behind authentication and hash navigation.
- No translation/localization config or alternative-language pages were found. English `lang` is correct; hreflang is not currently needed.
- The service worker is registered by the signed-in app, excludes `/welcome` and account/API paths, and distinguishes private `/` with `X-Jiggered-App`. It is not the reason public content needs JavaScript.

## 1. Critical

**No confirmed critical findings.** The landing page is neither client-only nor accidentally noindexed in the source. The relative canonical resolves correctly; the two homepage URLs are duplicate aliases, not evidence of mass duplication. Do not remove privacy/auth controls to increase the apparent page count.

## 2. High impact

### H1 — The title and hero under-explain what Jiggered is

**Pass:** Technical review / Searcher walkthrough  
**Where:** `web/landing.html:9–32, 89–126, 241–283`; routes `/` and `/welcome`.

**Problem:** The title is `Jiggered — Understand your energy. Find your rhythm.`; the H1 is `Your energy. Your pace. Your rhythm.` Neither names an energy and symptom tracker. The description is better, but spends scarce snippet space on a planned source release. Hero text says “personal log” without naming symptom tracking or identifying who benefits. A new searcher must scroll to distinguish this from a wellness service or motivational content. In the local preview, `#features` begins around y=962 on desktop and y=1440 on a 390px phone, so the symptom feature is not above the fold. An AI reader can infer the category from the full HTML, but lacks a concise visible introductory statement to quote.

**Fix:** Replace the homepage title with **`Jiggered — Free Energy & Symptom Tracker`** and description with **`Track daily energy, activities and symptom episodes with Jiggered. Review patterns in your personal log. Free hosted service when registration is open.`** Use an H1 such as **`Track your energy and symptoms, at your own pace.`** Follow it with **`Jiggered is a personal energy and symptom tracker for people whose energy varies from day to day. Log activities and rest, record symptom episodes, and review your history. It is a personal log, not a medical device.`** Add a short visible price/availability line beside the CTA, rendered from server settings as described in H6. Align OG/Twitter copy with this category statement. Keep source-release information in its dedicated section.

**Verify:** Inspect the actual response source at `/welcome`; confirm one H1, the revised title/description, and category text without running scripts. At 390px, confirm the category and primary action are visible on the first screen. Check search snippets after recrawl; actual CTR improvement **Needs confirmation** in Search Console.

### H2 — Useful capabilities and help have no public search landing pages

**Pass:** Searcher walkthrough / Technical review  
**Where:** `main.go:292–405` route list; `web/landing.html:54–57, 237–283, 415–471, 497–505`; `web/help.js`; `web/history.js`; `README.md:1–28`.

**Problem:** All public navigation leads to homepage fragments or noindexed account forms. Energy budgets, episode logging, history graphs, CSV/print exports, and offline behavior have detailed explanations in private JavaScript help and the repository README, but no corresponding public routes. `/api/docs` stores personal records; it is not public product documentation. A single generic page has to satisfy every non-branded query. Private repository documentation is not an accessible citation source for prospective users or answer engines.

**Fix:** Create a small, useful public content set, starting with `/features/energy-tracking`, `/features/symptom-tracking`, and `/docs/getting-started`. Add a guide for `/docs/export-and-share` and one for `/docs/offline-use`. Each should return complete HTML, have a distinct intent-led title/description, one descriptive H1, an absolute self-canonical, and relevant links to the other guides and the account CTA. Put real examples and limitations near the top; use fictitious logs, never member data. Promote accurate explanations from `web/help.js` rather than indexing the private app. For example, symptom-page title: **`Track Symptom Episodes, Duration & Triggers | Jiggered`**; description: **`Record when symptoms start, how long they last and relevant activities. Review your personal history and export records with Jiggered.`** Explicitly explain that observed patterns do not establish causes.

Implement each route before the authenticated catch-all, and intentionally set `X-Robots-Tag: index, follow` on approved production pages. Add real `<a href>` links in the header/footer and relevant feature cards, rather than only `#features`. See the query table below for exact missing coverage. Publish a self-hosting guide only when source, licensing, and installation access are actually available to the public.

**Verify:** Fetch every new route signed out and check HTTP 200, full explanatory HTML, unique metadata, canonical, and index header. Crawl internal links from `/welcome` with JavaScript disabled. Validate that logged-in data endpoints remain protected and excluded. Add only the resulting canonical public routes to the sitemap.

### H3 — Every deployment opts the same marketing page into indexing

**Pass:** Technical review  
**Where:** `main.go:318–327, 389–405, 546–555`; `compose.yaml`; `README.md:138–157`.

**Problem:** The landing handler unconditionally replaces the default `noindex, nofollow` with `index, follow` on every instance. There is no staging/preview/official-marketing-site distinction. A preview or publicly reachable personal deployment therefore serves the same index-eligible marketing copy, including “We take care of hosting,” even when it is merely someone’s private instance. The code-level exposure is confirmed; whether such hosts exist or have indexed copies **Needs confirmation**. Cross-host duplicates and incorrect hosted-service claims can dilute the official product identity.

**Fix:** Add an explicit deployment-level public-indexing setting, for example `APP_PUBLIC_INDEXING`, defaulting to false for new personal/preview installations. Set it true only for the intended production marketing host. Have the shared public handler preserve `noindex` otherwise; make its copy describe the actual instance rather than imply the operator is the official hosting provider. Document migration for an existing official host so it remains opted in. Protect preview deployments with access control where appropriate; do not rely on robots.txt as confidentiality protection. Keep assets accessible for rendering and let crawlers read a noindex response instead of blocking those pages from crawling.

**Verify:** On preview/personal hosts, fetch `/` signed out and `/welcome` and confirm `X-Robots-Tag: noindex`. On the explicitly enabled official host, confirm 200 and `index, follow`. Inspect Search Console for alternate hosts/copies if they exist. Verify sitemap behavior follows the same deployment policy.

### H4 — Canonical signals are confined to a relative path on each host

**Pass:** Technical review  
**Where:** `web/landing.html:26, 48, 498`; `main.go:327, 389–405`; `remote_services.go:57–59, 209–216`; `README.md:240–251`.

**Problem:** Both landing URLs use `<link rel="canonical" href="/welcome">`. This correctly resolves to the current host’s `/welcome`; it is not a broken canonical. It does not establish one preferred HTTPS host across apex/www, proxy host aliases, or copied deployments. There is no Go route that consolidates the signed-out `/` alias or host/scheme variants. The README provides an HTTPS Caddy example, but the actual proxy configuration and redirect behavior **Need confirmation**. Query variants also return the same landing HTML, with canonicalization as their only consolidation signal.

**Fix:** Retain `/welcome` as the stable public home because signed-in `/` is the app. Render an absolute canonical such as `https://<official-host>/welcome` from a validated configured origin, never an arbitrary request Host header. The validated `Accounts.PublicURL` could be reused on the official deployment if its semantics match; otherwise add a dedicated public-site origin. Consider a signed-out-only permanent redirect from `/` to `/welcome`, leaving signed-in `/` intact, or retain the alias with consistent canonical signals if the conditional redirect is undesirable. Put HTTP→HTTPS and alternate-host→preferred-host permanent redirects in the reverse proxy, preserving paths and meaningful query parameters in one hop. Keep public page slugs lowercase without trailing slashes, and redirect only recognized case/slash aliases to their canonical routes. Do not redirect all unknown URLs to the homepage.

**Verify:** Use signed-out `curl -I` and `curl -IL` on each host/scheme/home alias and inspect the final URL and hop count; confirm authenticated `/` still opens the app. Test `/welcome?utm_source=a`, `/welcome/`, and `/Welcome` according to the chosen policy. Every public page should have one absolute canonical matching its sitemap entry. Inspect Google's selected canonical in URL Inspection; canonical tags are hints, not guarantees.

### H5 — No discoverable public sitemap endpoint

**Pass:** Technical review  
**Where:** repository tree; `web/robots.txt`; `main.go:290, 292–405`; `auth.go:151–164`.

**Problem:** No sitemap exists in the tree or routing. Requests for `/sitemap.xml` currently enter the authenticated catch-all and produce a 303 to `/login` for anonymous visitors, based on source. With one public page this is not a blocker, but it becomes a material discovery gap as useful pages are added. Simply placing a file under `web/` would still leave it gated unless routing is updated.

**Fix:** Register `GET /sitemap.xml` explicitly outside auth, with `Content-Type: application/xml`. Generate it from a small registry of actual public pages used by the public handlers, with absolute production URLs and only one homepage URL, `/welcome`. Exclude `/`, `/login`, `/register`, `/healthz`, APIs, private hash tabs, and query variants. Add `Sitemap: https://<official-host>/sitemap.xml` to production robots.txt. If maintaining accurate page-level modification dates is not practical, omit `lastmod`; otherwise update each value when that page's substantive content changes, not on requests or unrelated releases. Suppress public sitemap advertising on non-indexable deployments.

Example initial entry (replace the illustrative host):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://jiggered.example.com/welcome</loc></url>
</urlset>
```

**Verify:** Signed-out `/sitemap.xml` returns XML with 200, not a login redirect or HTML. Parse it and request every listed URL: each must return canonical, index-eligible content. Confirm robots.txt advertises the correct official URL; submit the sitemap in Search Console. Repeated requests must not fabricate changing lastmod dates.

### H6 — Signup availability and accurate calls to action depend on JavaScript

**Pass:** Technical review / Searcher walkthrough  
**Where:** `web/landing.html:103–125, 302–321, 446–453`; `web/login.js:1–35`; `main.go:318–325`; `security_accounts.go:47–52`; `README.md:138–157`.

**Problem:** Initial HTML always says “Create your free account” while signup status is “CHECKING SIGNUP AVAILABILITY.” `login.js` fetches `/api/auth/options` and changes CTAs to sign-in if closed. The README says registration is closed by default. JavaScript-disabled browser inspection confirms the unresolved status and signup CTAs persist; with a mocked closed response, hydrated/enhanced CTAs become “Open your personal log.” This is a narrow dynamic-content problem, not client-only rendering of the whole page. Search/AI readers can quote a free-account offer without knowing whether access is available. The closure notice is far below the hero (hosting section around y=2703 on a 390px phone). Actual hosted signup status **Needs confirmation**.

**Fix:** Read the same registration/email capability settings on the server when serving landing HTML. Render the initial availability status, explanatory sentence, and CTA href/text correctly. With open signup: **`Free hosted accounts · Email verification required`** and **`Create your free account`**. With closed signup: **`New account registration is currently closed. Existing members can sign in.`** and **`Log in`**; provide a real access-request/waitlist path only if the operator offers one. Handle unavailable settings with neutral availability copy rather than an unverified signup promise. Keep the browser fetch as an optional refresh, and expose the server-rendered message near the hero and in the hosting section.

**Verify:** Fetch the actual HTML with registration enabled, disabled, and unavailable; check accurate initial copy and links in each scenario without JS. Compare the enhanced page with that source. Complete a real email-verification signup on the hosted deployment before advertising open signup.

### H7 — Explain Spoon Theory and connect it to personal energy budgets

**Pass:** Searcher walkthrough / Technical review  
**Where:** `web/landing.html:237–258`; `web/help.js` daily-energy explanation; `web/model.js:55, 129–130, 378`; proposed `/features/energy-tracking` and `/guides/spoon-theory`.

**Problem:** The public energy-budget copy and private help explain points without referencing Spoon Theory, the familiar limited-energy metaphor created by Christine Miserandino. No Spoon Theory attribution or source link was found in the inspected landing/help/model/README content. People who already describe their energy in “spoons” have no explanation connecting that vocabulary to Jiggered's actual points-based log. This is a user-requested content opportunity, not a technical indexing defect. Search volume and demand for “spoon theory energy tracker” **Need confirmation**.

**Fix:** Add a short visible section titled **`Think about your energy in spoons?`** to the energy-tracking feature page, and a concise reference alongside the homepage's energy-budget explanation. Attribute the metaphor explicitly and link to [Christine Miserandino's original Spoon Theory essay on But You Don't Look Sick](https://www.butyoudontlooksick.com/articles/written-by-christine/the-spoon-theory/). Use a normal descriptive `<a href>` link. Paraphrase in original words; do not reproduce the essay or imply endorsement, affiliation, or that Jiggered invented the idea.

Suggested feature-page copy:

> Spoon Theory, created by Christine Miserandino, uses spoons as a metaphor for the limited energy available when living with chronic illness. Everyday tasks can draw on that energy, and what you have available can vary from day to day. Read [Christine's original explanation of Spoon Theory](https://www.butyoudontlooksick.com/articles/written-by-christine/the-spoon-theory/).
>
> If you find that idea helpful, Jiggered gives you a way to record your own daily energy budget, activities and rest. It uses personal points rather than a medical measurement or a universal spoon scale. You choose what activities cost in your log and can review your recorded days alongside symptom episodes.
>
> A rest entry records your own estimate of recovery; it does not guarantee restored energy or tell you how much activity is safe. Your log is a planning aid, not medical advice.

Suggested homepage sentence: **`If you think of energy in “spoons,” Jiggered can help you log your own budget and activities. Learn about Spoon Theory and how personal energy points work.`** Link that sentence to the substantive public guide, which in turn credits and links the original essay. Keep this below the clear product-category introduction rather than replacing it with an unexplained “spoonie” slogan. Do not describe the app as “inspired by Spoon Theory” unless the owner confirms that origin story; the current source does not establish it.

Create `/guides/spoon-theory` only with useful depth: plain-language attribution, a fictional personalized logging example, how variable days and rest entries are recorded, and the limits of the metaphor and the app. Suggested title: **`Spoon Theory & Personal Energy Budgets | Jiggered`**. Suggested description: **`Learn what Spoon Theory means, read Christine Miserandino's original essay, and see how to log your own energy budget and activities in Jiggered.`** Link the guide to `/features/energy-tracking` and `/docs/getting-started`. One meaningful guide is enough; do not create condition-specific copies of the same explanation.

**Verify:** Confirm the attribution against the original essay and check the external link before publishing. The attempted source fetch redirected to the `www` URL but timed out before returning page content; current accessibility and final response status **Need confirmation**. Fetch the implemented public pages without JavaScript and confirm the explanation, author credit, and real internal/external links are in the initial HTML. Ensure examples describe the app's actual configurable points, and never imply a fixed spoon-to-point conversion, guaranteed recovery, clinical validation, or endorsement.

### Searcher walkthrough — 10 plausible target queries

These are intent hypotheses derived from actual capabilities, not measured keyword volumes. For every query, the only current public title is the slogan in H1 and the only current description is “A calmer way to track energy and symptoms at your own pace. Start a personal log with free hosted Jiggered. An open-source release is planned.” Click appeal below is a reviewer judgment, not an observed SERP or CTR. “Above fold” refers to the inspected homepage at 1440×900 and 390×900; proposed pages have not been built.

| Query | Page that should answer it; exists? | Would current title/description earn the click? | Does landing answer it above the fold? | Could an AI reader accurately summarize/recommend it? |
|---|---|---|---|---|
| **Jiggered energy tracker** | `/welcome` — yes; signed-out `/` alias | Moderate branded recognition; category missing from title, description supplies it. | Partly: energy log and CTA are visible; symptom tracking and limits require scrolling. | Yes from the full page for basic tracking, but signup availability needs a server answer. |
| **daily energy tracker app** | `/features/energy-tracking` — absent; homepage partial | Weak: slogan does not say “tracker”; description is relevant but vague. | Partly: illustrative energy ring; no clear explanation of check-ins, budget, or activity costs. | Can summarize logging, but not the actual budgeting mechanics without private help. |
| **free energy and symptom tracker** | `/welcome` initially; `/pricing` for access details — absent | Description is relevant; title misses both category and free availability. | Signup CTA implies free; full feature/hosting explanation is below fold. | Can identify the free hosted claim, but cannot establish current signup availability from initial HTML. |
| **symptom diary app with triggers** | `/features/symptom-tracking` — absent | Weak: “symptoms” appears only in description; no episode/trigger detail. | No: episode and trigger explanation is in the third feature card. | Can mention symptom/trigger recording after reading the page, but lacks examples, duration details, and export workflow. |
| **spoon theory energy tracker** | `/guides/spoon-theory`, linked to `/features/energy-tracking` — both absent | Weak: neither snippet references Spoon Theory or explains personal budgets. | No: illustrative points appear, but no spoon metaphor, attribution, or explanation connects them to the user's intent. | Cannot explain the connection from current public copy. The proposed guide should credit Christine Miserandino, link her essay, and distinguish configurable points from measured energy. |
| **best symptom tracker for fluctuating energy** | Public energy/symptom feature guide explaining fit and limits — absent | Weak: no concrete fit, offline/export details, or comparison criteria. | No: category/target audience is indirect. | Full homepage supports a limited suggestion, not a reasoned “best” claim. Publish decision criteria and tradeoffs, not a self-declared ranking. |
| **Jiggered vs Bearable** | `/compare/bearable` — absent | Poor comparison match: no comparison title or evidence. | No comparison exists anywhere in the public page. | Cannot compare reliably from Jiggered's homepage alone. Research and date competitor capabilities/pricing before publishing. |
| **offline energy and symptom tracker** | `/docs/offline-use` — absent; homepage FAQ partial | Weak: neither title nor description mentions offline operation. | No: offline-after-setup detail is in a lower FAQ. | Can state basic offline support, but limits around first login, queued saves, device storage and revocation are private-help-only. |
| **export symptom diary to PDF or CSV** | `/docs/export-and-share` — absent | Poor match: snippet does not mention export or sharing. | No: lower privacy/FAQ says export, without formats or steps. | Cannot describe the export formats and note-exclusion behavior from public copy; actual functionality exists in help/history. |
| **self hosted symptom tracker Docker** | `/self-hosting` — absent; homepage explains release planned | Mixed: planned release is honestly disclosed, but install-ready searchers have no usable public guide. | No: planned source/self-host status appears well below fold. | Can report a planned release, not recommend an immediately accessible open-source install. Private repo visibility is confirmed; public licensing/release readiness needs owner confirmation. |

These gaps should be served by a few substantive pages, not ten near-duplicate query pages. Keep the pricing/free-access answer accurate, comparison claims sourced, and health-related copy limited to recording and personal planning.

## 3. Nice to have

### N1 — Extend the existing application schema with supported facts

**Pass:** Technical review  
**Where:** `web/landing.html:81–88, 302–334, 422–443`; `main.go:552` CSP.

**Problem:** SoftwareApplication microdata already supplies name, category, operating system, and description. It lacks a URL and offer data despite the visible free hosted-service claim; there are no WebSite/Organization identity links. This limits machine-readable context, but is not an indexing blocker and does not establish rich-result eligibility. No JSON-LD currently exists, so there is no invalid JSON-LD to report.

**Fix:** The least disruptive option is to extend the existing microdata: add an absolute `itemprop="url"`, and nest an Offer around the real hosted-price statement with `price="0"` and the applicable currency, after confirming the offer and signup/access terms. Do not invent reviews, ratings, availability, or an organization address. Add publisher/Organization facts only when verified. If migrating to JSON-LD, an illustrative application object is below; replace the host and confirm currency/offer before use:

```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": "https://jiggered.example.com/welcome#app",
  "name": "Jiggered",
  "url": "https://jiggered.example.com/welcome",
  "applicationCategory": "LifestyleApplication",
  "operatingSystem": "Web",
  "description": "A personal tracker for daily energy, activities and symptom episodes.",
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "GBP" }
}
```

Keep structured facts consistent with visible content and the release status. Do not ship conflicting microdata and JSON-LD objects. The current CSP disallows inline scripts: if inserting JSON-LD, review and test it with a narrowly scoped nonce/hash policy rather than enabling arbitrary inline JavaScript. FAQPage markup is optional semantic work; do not promise FAQ rich results for this app. BreadcrumbList becomes useful once real public subpages exist.

**Verify:** Inspect source and extract the final schema; use Schema Markup Validator and Google's Rich Results Test. Check browser CSP diagnostics if JSON-LD is adopted. Absence of genuine ratings can still mean no software rich result; do not add fabricated ratings to satisfy a validator.

### N2 — Social previews do not identify a canonical absolute URL

**Pass:** Technical review  
**Where:** `web/landing.html:14–32, 34`; public asset allowlist in `main.go:290`.

**Problem:** OG and Twitter tags exist, but there is no `og:url`, `og:image` is relative (`/icon-512.png`), and the Twitter card has no explicit image. A square brand icon carries little product context. The landing head includes the SVG favicon but omits the PNG fallback and apple-touch icon already used on the account/app pages. These are sharing/device polish issues, not proven ranking losses; social platform handling **Needs confirmation**.

**Fix:** Generate `og:url`, `og:image`, and `twitter:image` from the trusted public origin. Add a dedicated readable product/social graphic and a factual alt description, with dimensions; use `summary_large_image` only with a suitable landscape image. Add the existing PNG favicon fallback and apple-touch-icon link to the landing head. If a new asset is added under `web/`, also add a public route/allowlist entry so anonymous preview bots can fetch it.

**Verify:** Fetch all preview images signed out and confirm image responses, not login HTML. Inspect OG/Twitter source and test actual cards on the sharing platforms used by the audience. Check favicon/touch-icon requests on mobile.

### N3 — Mobile removes the section navigation and pushes decision details down

**Pass:** Technical review / Searcher walkthrough  
**Where:** `web/presence.css:1064–1129`; `web/landing.html:54–57, 128–218, 287–338`.

**Problem:** Below 760px, `.site-nav` is hidden without a replacement. The content itself remains present, and local 320/390px checks showed no horizontal overflow. However, a 555px illustrative preview precedes substantive feature details, and hosting/availability begins around y=2703 at 390px. People looking for price, privacy, or offline/episode capabilities must scroll considerably. This is a usability/discovery issue, not evidence that Google loses mobile content.

**Fix:** Add a compact mobile navigation using real links to Features, Hosting & access, and Privacy, or a native disclosure menu with those anchors. Put category and availability in the hero; consider shortening or moving the illustration on small screens. Preserve the full feature and FAQ text. Existing primary buttons are at least 44/56px high; extend comfortable touch padding to mobile text navigation rather than enlarging every decorative element.

**Verify:** At 320 and 390px, confirm all section links are available by touch and keyboard, no overflow appears, and category/access information fits in the initial viewport. Confirm content parity between mobile and desktop with JS disabled.

### N4 — The public page downloads a stylesheet dominated by private-app rules

**Pass:** Technical review  
**Where:** `web/landing.html:35–43`; `web/style.css`; `web/presence.css`; `main.go:432–446, 471–477`.

**Problem:** The landing loads approximately 51 KB of shared app CSS plus 21 KB of presence CSS (uncompressed source sizes). Much of `style.css` styles private history, editor, admin, recovery, and account interfaces. Both stylesheets block initial rendering, and the display font adds roughly 77 KB before other font subsets. This is a modest code-visible performance opportunity, not a measured poor CWV result. Gzip, immutable versioned assets, self-hosted fonts, explicit image dimensions, and a small deferred public script already reduce risk.

**Fix:** Extract shared font definitions/tokens/reset into a small base sheet; retain public-page rules in presence CSS; load private dashboard/editor/history/admin rules only in the authenticated app. Preserve public font preload and `font-display: swap`; consider font metric overrides if a throttled trace demonstrates font-swap shifts. Add any new versioned stylesheet to `versionedFiles` and the relevant public asset routes; update the private offline shell if its imports change.

**Verify:** Compare public transferred CSS and unused-rule coverage in DevTools before/after, then run a throttled mobile performance trace. Check public layouts and offline app behavior. Use field CrUX/Search Console for LCP/INP/CLS; actual performance impact **Needs confirmation**.

### N5 — Unknown anonymous paths redirect to login instead of returning 404

**Pass:** Technical review  
**Where:** `main.go:389–392`; `auth.go:151–164`; `main.go:518–524`; `server_test.go:112–115`.

**Problem:** Every unhandled non-root GET is wrapped in `requireAuth(files)`. An anonymous `/does-not-exist`, `/welcome/`, or `/Welcome` therefore redirects to `/login` with 303, while an authenticated nonexistent file can reach the file server's 404. Missing public paths are indistinguishable from existing private resources to an anonymous crawler. This is not a confirmed 200 error page: the login target is deliberately noindexed, and current tests check an authenticated missing asset. Historical public URLs that deserve redirects **Need confirmation** from logs/old sitemaps.

**Fix:** Before authentication, distinguish known private assets/routes from nonexistent paths using the embedded FS or an explicit registry. Return a real 404 for unknown public requests, preserving `noindex` on errors; keep authentication redirects for known private resources. Implement permanent redirects only for deliberate public URL aliases or verified old URLs with a relevant replacement. Do not replace the intentional 303 redirects after login/logout POSTs with 301/308.

**Verify:** Anonymous and authenticated requests to a nonexistent page/asset return 404. Known protected assets still require auth; valid public routes return 200; chosen slash/case aliases redirect correctly. Check live logs/Search Console before constructing any legacy migration map.

### N6 — AI crawler policy is implicit, and no public machine-readable guide exists

**Pass:** Technical review / Searcher walkthrough  
**Where:** `web/robots.txt`; repository tree; public route list in `main.go`; `web/landing.html`.

**Problem:** There are no named AI bot rules and no `llms.txt`. Wildcard rules currently allow the landing page for crawlers that honor them, including AI crawlers; absence of named rules is not a block. The site offers only one public document for citation, and its useful help is private. `llms.txt` absence is not an indexing defect or an established ranking factor.

**Fix:** Document the operator's intended policies for search/answer indexing versus model-training crawlers, and use current provider-documented user agents only when a distinction is desired. Continue to protect member data with auth, not bot rules. After public guides exist, optionally serve `/llms.txt` without auth with a short factual product definition, release/access status, and links to the canonical feature, price/access, privacy, and help pages. It should be an index into maintained public content, not a dump of internal help, APIs, or personal records. Plain HTML improvements in H1/H2/H6 are the priority.

**Verify:** Fetch robots.txt and optional llms.txt anonymously; confirm no unintended landing/asset blocks, stale release claims, private links, or redirects to login. Consult the target providers' crawler documentation and access logs. Actual AI citation gains **Need confirmation**; an llms.txt file does not guarantee ingestion or recommendation.

### Top five fixes by expected traffic impact

Relative prioritization, not numerical forecasts: keyword demand, baseline traffic and CTR are unavailable.

1. **Publish substantive energy/symptom feature pages and public task guides (H2/H7).** This creates relevant landing pages for non-branded searches currently unserved. Include a useful, attributed Spoon Theory explanation and link the pages from the homepage with real anchors.
2. **Rewrite the homepage title, H1 and introduction around the product category (H1).** This improves branded/category relevance and gives humans and AI readers a concise product explanation.
3. **Make price, signup status and release/access terms accurate in initial HTML (H6).** Resolve the gap between a free-account promise and instance-dependent availability; support it with a clear public access/pricing page.
4. **Establish one official indexable host and consistent absolute canonicals (H3/H4).** Consolidate signals and keep personal/preview deployments from advertising duplicate official marketing content. Expected benefit depends on whether alternate hosts exist.
5. **Ship a sitemap from the public route registry (H5).** A small gain today; more useful as the new content set launches. Keep private pages and homepage aliases out.

### New pages worth creating

| Suggested route | Suggested title | Primary target query | Minimum useful content |
|---|---|---|---|
| `/features/energy-tracking` | **Daily Energy Tracking & Personal Budgets \| Jiggered** | daily energy tracker app | Real check-in example; activity/rest points; personalization; personal estimates and planning limits. Include a short attributed Spoon Theory reference and link to the guide; also answer pacing intent without treatment claims. |
| `/guides/spoon-theory` | **Spoon Theory & Personal Energy Budgets \| Jiggered** | spoon theory energy tracker | Explain and credit Christine Miserandino's metaphor; link the original essay; demonstrate personalized activity logging with fictional data; explain variable days, rest entries, and limits. |
| `/features/symptom-tracking` | **Track Symptom Episodes, Duration & Triggers \| Jiggered** | symptom diary app with triggers | Episode example; onset/end/duration; notes and relevant circumstances; how history works; observations versus causation. |
| `/pricing` | **Jiggered Pricing & Account Availability** | Jiggered pricing / free energy and symptom tracker | Free hosted terms, current account availability, verification requirements, genuine limits, operator identity, and accurate source-release status. |
| `/docs/getting-started` | **Start Your Energy & Symptom Log \| Jiggered Guide** | how to use Jiggered | First check-in, activity entry, episode and history walkthrough; screenshots with synthetic data; mobile setup. |
| `/docs/export-and-share` | **Export Your Symptom Diary to CSV or PDF \| Jiggered** | export symptom diary to PDF | Actual CSV/print-to-PDF steps, filter scope, excluding private notes, and safe sharing choices. |
| `/docs/offline-use` | **Use Jiggered Offline: Setup, Saving & Sync** | offline energy and symptom tracker | Online first setup, supported browser/device behavior, queued versus acknowledged saves, storage limits, sign-out and recovery. |
| `/privacy` | **Jiggered Privacy: Your Logs, Hosting & Data Control** | Jiggered privacy / private symptom tracker | Clear distinction between account isolation and operator access; device copies, backups, exports and deletion. Verify any operator-specific retention/support claims before publishing. |
| `/compare/bearable` | **Jiggered vs Bearable: Features, Privacy & Fit** | Jiggered vs Bearable | Optional after feature guides: sourced, dated comparison with balanced tradeoffs and verified competitor pricing. Do not publish an unsupported “best” verdict. |

Defer `/self-hosting` (suggested title **Self-Host Jiggered with Docker**, query **self hosted symptom tracker Docker**) until public source access, licensing, release status, and installation instructions are genuinely available. Until then, explain the planned release clearly on `/pricing` and the homepage. Avoid separate near-identical pages for each condition or wording variation.

### Implementation update — 2 October 2026

The audit recommendations and Spoon Theory additions have now been implemented in the local source workspace:

- Nine public server-rendered pages: the homepage, two feature pages, Spoon Theory guide, pricing/access, getting started, exports, offline use and privacy. Public navigation and contextual links connect them; the mobile section navigation remains visible.
- Category-led homepage copy, unique titles/descriptions, canonical and OG URLs from a validated deployment origin, absolute social image URLs, explicit Twitter image, favicon/touch icons, application/offer microdata and breadcrumb microdata. Inline script permissions were not broadened.
- Initial HTML includes open/closed/unknown account availability, accurate CTA links and email-verification requirements. JavaScript can refresh that availability in either direction.
- Spoon Theory references on the homepage, energy feature page, standalone guide and private help attribute Christine Miserandino and link to her original essay. Copy distinguishes personal points from a universal spoon scale, medical measurement or guaranteed recovery.
- A shared public-route registry drives the sitemap and llms index. Robots advertises the sitemap on index-enabled deployments and allows crawlers to observe account noindex responses. Private APIs remain disallowed and authenticated. No lastmod dates were invented.
- Deployment opt-in indexing: `APP_PUBLIC_ORIGIN` supplies the trusted canonical HTTPS origin and `APP_PUBLIC_INDEXING=true` enables indexing. Personal/preview deployments default to noindex. **Existing official deployments must set both before upgrading to retain public indexing.** Sitemap and llms return 404 when indexing is disabled.
- Known public case/slash aliases use permanent redirects; unknown paths and raw public templates return 404. Signed-in `/`, personal APIs, private assets and account forms retain their privacy controls. Public guide/metadata endpoints are excluded from the app's offline cache.
- Public pages load a small base stylesheet rather than the private dashboard stylesheet. Private app styles and its offline shell remain intact. README, environment examples and CI document/check the changes.

Verification on the actual Go server (the matching Go 1.27.1 toolchain was installed after network access recovered):

- `go test -race ./...` passed, including new tests for public routing, complete HTML, metadata, indexing defaults, origin validation, signup states, sitemap XML, aliases and privacy boundaries.
- `go vet ./...`, Go formatting checks and a local build passed. The source workspace is a connector-reconstructed snapshot without Git history, so the local build used `-buildvcs=false`; no product build behavior was changed for that limitation.
- All seven frontend logic test files passed.
- The new public browser test passed 54 page/viewport checks with JavaScript on/off at 1440, 390 and 320 pixels, plus an open-registration enhancement scenario. It checks metadata, headers, internal links, readable content, mobile navigation, overflow and browser errors. Screenshots were inspected.
- Existing Today, History, mobile, security, account enrollment/recovery, admin and full app walkthrough browser suites passed.

Deferred: an evidence-based competitor comparison, public self-hosting launch instructions, verified organization/operator facts and a dedicated landscape social graphic. Current code/copy retains the planned source-release status. The original Spoon Theory URL fetch still timed out, so its live accessibility needs confirmation. Search Console, field CWV, production host redirects, deployment enablement and live indexing remain unverified. No deployment or GitHub write was performed.

PR preparation: rebased onto `e897bc5724c2c10fb9ef7008f462978792c74c12`, preserving the newly merged optional Spoons display theme. Public guides explain its one-spoon-per-point display mapping while distinguishing it from a universal or clinical energy scale.
