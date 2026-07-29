# v160 — Why "Match to Job" produced identical résumés

**Recorded 2026-07-29.** Founder-supplied artefacts + OpenAI logs, reproduced and
root-caused in code. Written down so nobody has to re-derive it.

---

## The symptom

Three résumés, tailored through the app for three different jobs at three different
companies. Extracted with `pdftotext` (bundled with Git for Windows) and diffed:

```
Securitize · Marketing Operations   vs   Murray Resources · Marketing Specialist
48c48
< Campaigns · Management · Campaign
> Campaigns · Management · Campaign · Projects · Software · Service

Securitize · Marketing Operations   vs   Legacy Community Health · Marketing Specialist
48c48
< Campaigns · Management · Campaign
> Campaigns · Management · Campaign · Analyst · Analyze · Communicate · Customers · Analytics
```

**One line differs. Every time.** Professional summary identical, all six roles identical,
all twenty-one bullets identical. The only change is keywords appended to the skills list.

---

## What made it confusing

The OpenAI logs showed the model **doing its job correctly**:

| | Text |
|---|---|
| Sent | `Optimized an $80K+ corporate tradeshow budget for cost-efficiency…` |
| **Returned** | `Optimized a corporate tradeshow budget exceeding $80K for enhanced cost-efficiency…` |
| **In the PDF** | `Optimized an $80K+ corporate tradeshow budget for cost-efficiency…` |

The call succeeded, was billed, returned valid JSON — and the output never reached the file.
So "the AI isn't working" was the wrong diagnosis for months. The AI was working.

---

## Root cause 1 — the tailored résumé was overwritten before it was drawn

`generateResumePDF()` began with:

```js
try{ if(typeof syncProfileToResume==='function') syncProfileToResume(); }catch(e){}
```

And `syncProfileToResume()` (index.html:10905) rebuilds the résumé **from the DOM form**:

```js
const entries=[...document.querySelectorAll('#jobs-container > div')]...
jobs.push({ t:…, c:…, d:…, b:(ta&&ta.value.trim())?ta.value.trim():'' });
if(jobs.length) resumeData.jobs=jobs;          // AI bullets wiped
…
if(summ&&summ.trim()) resumeData.summary=summ.trim();   // AI summary wiped
```

Match-to-Job writes tailored bullets and a re-aimed summary into `resumeData` **without
touching the form**. So the sync reverted all of it one line before the PDF was rendered.

**Skills survived because they are MERGED (index.html:10942), not replaced.** That single
asymmetry is the entire observed signature: skills change, nothing else does.

**Fix:** `generateResumePDF(baseName, labelExtra, skipSync)`. Match-to-Job passes
`skipSync=true`. Default `false`, so normal export still captures unsaved typing.

---

## Root cause 2 — the AI was tailoring against the wrong job (RC-1)

OpenAI log, 2026-07-28 22:28:

> **TARGET ROLE:** Senior Lifecycle Marketing Manager **COMPANY:** Jobgether
> **POSTING:** 📋 Director, Marketing Communications **Airspan** · today · — Summary
> **Open the role below for full details.** 🎯 **Match to Job** ✨ **Cover Letter** ⚡ **Apply**

Two defects in one string:

1. **A different company's job.** `matchToJobFromCard` read `document.querySelector('.job-card.top')`
   — the rotating DOM card, not the job acted on.
2. **The app's own buttons sent as job requirements.** `clGatherJobText` read
   `cm-jobsummary`.textContent — a *display* container whose innerHTML is built at
   index.html:13055-13063 and includes those exact labels.

This is the bug class CLAUDE.md §5 already warned about and v69/v70/v71 fixed for apply,
drawer, company view and flag. These two call sites were never converted.

**Fix:** bind to `_currentTopJob()`; keep the company modal's job **object**
(`window._cmJob`) instead of scraping its rendering; identity-check every source against
the job the caller named; return empty on mismatch (an honest generic letter beats a
confident letter about the wrong role).

---

## Root cause 3 — billed twice per tailor

One press of "Download resume for this role" produced **two byte-identical** bullet-rewrite
requests. `smartMatch` performs a single `fetch` with no retry, so the duplicate is a
concurrent second entry into `applyMatch2Job`.

Beyond the wasted spend, the second run would snapshot the **already-tailored** résumé as
its `_master` and restore that in `finally` — **corrupting the user's real résumé.**

**Fix:** an in-flight lock, released on every exit path.

---

## Secondary findings (recorded, not all fixed yet)

**Keyword mining is poor.** For the Legacy posting it produced
`Analyst, Analyze, Communicate, Customers, Analytics` — three morphological forms of one
root, plus two words that are not skills. Since the system prompt correctly forbids
inventing experience, feeding the model keywords unrelated to the candidate's bullets
*guarantees* cosmetic paraphrase. → v161.

**Duplicate bullets in the master résumé.** Account Specialist and Regional Account Manager
carry the same three bullets, paraphrased:

| Account Specialist | Regional Account Manager |
|---|---|
| Collaborated with operations to refine client **data pipelines, strengthening stakeholder relationships** | Enhanced client **data pipelines** through collaboration, improving **stakeholder relationships** |
| **Utilized Salesforce and CRM systems** to manage client accounts and ensure audit **accuracy** | Monitored client accounts **with Salesforce and CRM systems** … maintain compliance **accuracy** |
| **Resolved complex client escalations** promptly, maintaining **stakeholder satisfaction** | Supported the swift **resolution of complex client escalations** to uphold **stakeholder satisfaction** |

Plus `Managed 100 / 50 / 500+ accounts and client relationships end-to-end`. → v161-1.

**Stat rows measured a rolling 24h window, not calendar days** (index.html:11377). A job
skipped at 10pm read "today" at 2pm the next day. Fixed to compare local midnight
boundaries; rows with no timestamp now show `—` instead of a computed number.

**Generated PDFs reference non-embedded fonts** (`Symbol`, `ArialUnicode`) — surfaced by
poppler while rendering. May matter to strict ATS parsers. **Unverified** — needs testing
against a real parser before it is treated as a defect.

---

## How to reproduce the extraction

```bash
node scratchpad/pdftext.js "Resume_….pdf" > a.txt   # streams are UNCOMPRESSED (jsPDF)
diff a.txt b.txt
```

`pdftotext` ships with Git for Windows. `pdftoppm` (page rendering) was installed via
`winget install oschwartz10612.Poppler`.

---

## The pattern behind all three

Every one is the same shape: **a fix applied in the transform path, while the path that
actually produces the output keeps reading somewhere stale.** RC-1 read the DOM instead of
the data model; the PDF builder re-read the DOM over the data model. Worth checking for
directly whenever an AI feature "doesn't seem to do anything".
