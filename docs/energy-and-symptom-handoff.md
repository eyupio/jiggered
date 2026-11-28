# Energy planning and symptom diary implementation handoff

Jiggered should help someone adapt a difficult day and later explain what happened across several weeks. Capture the moment once. Let the person choose whether to adjust their plan and which details to share. The eight stages below deliver three usable releases. Stage numbers describe dependencies, not calendar commitments.

## Product decisions

- Offer one personalised Today screen with three editable starting views: **Plan my energy**, **Track symptoms**, and **Both**. Existing accounts retain their familiar layout unless they choose another. For Both, prototype **Something changed** and **Adjust today** directly above the remaining plan on a phone. Check that both actions and the next commitment are easy to find with enlarged text.
- Make planning useful independently. A person can move the shop, keep a work call or use an easier dinner without recording a reason. Record an association with symptoms only when the person chooses it. Planning reserves energy. Only confirming an actual activity records usage.
- Support discrete episodes, persistent symptoms and changes from the person's usual level. Allow approximate times, later detail and recovery after an episode ends. Migraine, FND and personal shortcuts can coexist. Historical wording survives template edits and removal.
- Keep descriptions in the person's own terms. Summaries distinguish missing observations from an explicit symptom-free day and describe recorded associations without inferring medical causes. Let the person preview precisely what they are about to share.

## Working in this repository

Read [AGENTS.md](../AGENTS.md), [CONTRIBUTING.md](../CONTRIBUTING.md), [GLOSSARY.md](../GLOSSARY.md) and relevant decisions in [docs/adr](adr/). Trace the current branch before choosing a representation. The Go service, SQLite store and embedded JavaScript frontend already support Today, Plan, Episodes, History, offline operations and account backup and restore. Extend those paths. Start with `web/today.js`, `web/episodes.js`, `web/planner-model.js`, `web/planner.js`, `web/history-model.js` and `web/history.js`. Follow changes through `web/model.js`, `web/sync.js`, `web/device.js`, server validation and restore where relevant.

**Ponytail for coding and code review.** Load the skill in the implementing runner. Trace callers and existing helpers before editing. Pick the smallest change that satisfies the whole stage, including compatibility, conflict handling, accessibility and focused regression tests. Review the change and the affected callers before handing it over. [Ponytail](https://github.com/DietrichGebert/ponytail)

**Impeccable for UX and web UI.** Establish product and design context from Jiggered. Use its shape workflow before changing a journey, then critique and audit the rendered result. Review phone and desktop, keyboard and touch, enlarged text, light and dark themes, and alternatives to dragging. Record what was actually checked. If a runner lacks a packaged skill, load the official skill instructions and applicable references through its supported mechanism. Record the version or revision used and disclose any capability that could not be exercised. [Impeccable](https://github.com/pbakaus/impeccable)

## Release 1 — Adapt today and explain the week

### Stage 1 — Establish the baseline and design the journeys

**Lead:** Claude Opus for UX, Codex for the reusable test fixture.

Walk an existing planner account and a fresh account through Today, Plan, Episodes and History on mobile and desktop. Map the save, replay, export and restore paths. Using fictional data, create one representative week containing an ongoing symptom, an explicitly symptom-free day, a blank day, a shop that moves and a call the person keeps. Record which facts the existing model can represent and keep the remaining facts as expected outcomes for later stages. Produce mobile layouts for all three Today preferences and describe the first tap and return path for each.

**Acceptance:** The fixture reproduces the baseline on a fresh checkout. Each proposed change maps to an existing surface or a demonstrated gap. The handoff identifies existing tests and the smallest next change needed for one-tap capture.

### Stage 2 — Save a change in one tap

**Lead:** Codex. **Depends on:** Stage 1.

Extend capture so tapping Something changed persists the timestamp immediately. Distinguish a locally queued save, server acknowledgement and failure. Support Undo, later detail, approximate onset and a change from usual. Keep exact capture time and the person's estimate distinguishable. Trace the entry through History, export and restore.

**Acceptance:** Tap offline, close, reopen and reconnect. Exactly one editable entry appears. Exercise retry, Undo and a competing edit from another device. A legacy episode still opens, ends, exports and restores.

### Stage 3 — Adjust the remaining plan

**Lead:** Codex. **Depends on:** Stage 1 for the independent planner journey and Stage 2 for the optional link.

Reuse the existing planner to keep, move or swap remaining activities. Allow a saved easier alternative. Before moving an activity, show the destination day's commitments and projected energy. For a recurring activity, allow changing one occurrence. From a symptom entry, offer an explicit choice to link the adjustment. From Plan, allow the same actions directly.

**Acceptance:** Moving the shop releases its original reservation and reserves it once on the destination day. Actual usage and other occurrences remain accurate. Test Undo and interrupted or retried cross-day saves. Swapping dinner uses the alternative's cost. An unlinked change stays unlinked in History.

### Stage 4 — Personalise Today and ship the weekly recap

**Lead:** Claude Sonnet. **Depends on:** Stages 2 and 3.

Add the three editable starting views. Preserve existing account preferences and make symptom capture available before energy setup. Build a deterministic recap from recorded observations, plan changes and explicit links. Reuse the existing History range and day navigation.

**Acceptance:** A new diary user can save immediately. An existing spoons user can still plan and log an actual activity. A Both user can capture offline, adjust the shop, and find the confirmed link after sync. A day with no entry stays unknown. The fixture demonstrates the complete first-release journey.

## Release 2 — Track fluctuating symptoms and prepare for an appointment

### Stage 5 — Add composable migraine, FND and personal templates

**Lead:** Claude Opus for interaction and wording, Codex for persistence. **Depends on:** Release 1.

Offer optional migraine shortcuts for headache including none or unsure, sensory or language changes, medication taken, impact and recovery. Offer FND shortcuts for changes in walking, movement, speech or the person's own descriptions. Support a change from usual without requiring a start or end time. Let people pin, combine and edit shortcuts. Keep historical entries readable when labels or templates change.

**Acceptance:** Exercise a multi-day episode, a change against an ongoing baseline and recovery recorded later. Combine both templates, pin a personal phrase, disable one template, then export and restore. Check that original wording and timing survive. Seek feedback on the language from people who would use it and identify any feedback still outstanding.

### Stage 6 — Prepare a selective appointment summary

**Lead:** Codex for counts and selection, Claude Sonnet for preview and print. **Depends on:** Stage 5.

Extend printable History with a date range, selected entries, highlights, practical effects, and optional personal notes and medication. Derive preview and output from the same selection. Show distinct episode counts, observed symptom days, explicit symptom-free days and gaps. Explain how the chosen range handles an ongoing episode that crosses its boundary.

**Acceptance:** A single episode spanning three recorded symptom dates can count as one episode and three dates. Unobserved days remain distinguishable. Deselect a private note and verify it is absent from the actual output. Check A4 print, mobile preview, range boundaries and the restored fixture.

## Release 3 — Help people discover, try and extend Jiggered

### Stage 7 — Try a fictional week before setting up an account

**Lead:** OpenCode running Claude Sonnet or an equivalent configured frontend model. **Depends on:** Releases 1 and 2.

Offer two routes into a resettable fictional example: adapt a busy day or explore a symptom diary. Use the Stage 1 fixture and real planner and summary behaviour. Show how to join an existing instance where registration permits, or self-host. Follow the public route registry and private account boundary.

**Acceptance:** A signed-out visitor can move the shop, see the changed week, preview the summary and reset. A signed-in person's data and offline queue remain isolated from the demo. Check both entry routes on mobile and the route back to setup.

### Stage 8 — Rehearse upgrades and hand over maintenance

**Lead:** Codex for compatibility, Claude Opus for independent UX review. **Depends on:** Stages 1–7.

Upgrade an older disposable database, restore a backup, replay an offline change and exercise an account using two templates. Document how contributors propose a template with sample wording, a fictional example and expected summary output. Prepare release notes for existing and new users. Conduct short observed trials with an existing planner and newcomers interested in migraine or FND when participants are available.

**Acceptance:** Report upgrade and restore results, the actual device and accessibility checks, and the disposition of each usability finding. Distinguish observed participant feedback from simulated scenarios. Identify any pending human validation in the release handoff.

## Evidence and continuation

Use the applicable checks in CONTRIBUTING.md, including `make check` and `make browser` for application changes. Include a regression scenario for behaviour that existing tests would miss. Use fictional data throughout fixtures, screenshots and demos. Each stage handoff should identify its branch, base and head commits, PR, acceptance evidence, remaining risks and the next stage. Distinguish merged work, open PRs and proposals so another model can resume safely.

### Paste into a fresh agent session

```text
Work in eyupio/jiggered. Read docs/energy-and-symptom-handoff.md in full.
If it is not on main yet, read it from branch docs/energy-and-symptom-handoff.
Use that document as the implementation plan. Read AGENTS.md, GLOSSARY.md
and CONTRIBUTING.md. Check main, relevant open and merged PRs, and the latest
stage handoff. Start at Stage 1 on the first run. On later runs, resume the
earliest incomplete stage whose prerequisites are available, including any
unfinished work on its existing branch. Avoid duplicating another open PR.

Complete that stage and its acceptance criteria. Follow its recommended
agent assignment. Use Ponytail for all coding and review, and Impeccable
for user experience and web UI. Follow the skill and verification guidance
in the handoff. Work on a stage branch. Preserve the shared fictional week
and the agreed record, planning, privacy and offline behaviour.

Open or update the stage PR with the outcome, branch and commits, tests and
browser checks actually run, unresolved items, and a paste-ready continuation
prompt naming the next stage, its recommended agent and the same handoff file.
```
