# Level-Up Referral / Affiliate Plan (GhostProofJob)

> **Status:** PLAN ONLY — approved 2026-09-25. **Nothing is wired yet.** The disclosure
> copy changes below are written but **HELD** until tracking links are confirmed (founder
> instruction). Claude to remind the founder about the links on **2026-09-29**.

## The idea
Turn the **"🚀 Level Up Your Salary"** section (`#sec-levelup` → `#levelup-tracks`) — which
already recommends course/certification roadmaps ranked by salary & hiring data — into a
modest **affiliate revenue** stream: when a user enrolls in a recommended course via our
tracking link, we earn a referral commission.

## ⚠️ Non-negotiable: honesty first (this is GPJ's whole brand)
The app **currently promises, prominently:**
> *"We earn nothing from course recommendations… ranked by salary & hiring data alone…
> for your growth — nothing else."* (FAQ, `index.html` ~8631 & ~8639; section sub-copy ~3095)

Adding affiliate income **contradicts that** unless we do all three of these together:
1. **Rewrite the FAQ + section copy to disclose** we may earn a commission. (Drafts below — HELD.)
2. **Keep ranking by salary/hiring data, NEVER by payout.** No pay-to-play ordering — that
   would make it an ad, which GPJ forbids. Commission never influences which course shows.
3. **Add a plain inline disclosure** on the Level-Up section itself ("We may earn a
   commission if you enroll — it never changes what we recommend").

Do those and it's honest, on-brand, and legally clean (FTC requires clear affiliate disclosure).

## Where to sign up (self-serve — most need NO outreach email)
Education affiliate programs live inside a few **affiliate networks**. Create one account per
network, then apply to each provider inside it, get tracking links, and hand them to Claude.

| Network | Sign-up URL | Notable education partners |
|---|---|---|
| **Impact.com** | impact.com → "Partners / Publishers" sign-up | Coursera, Skillshare, some cert bodies |
| **CJ Affiliate** (Commission Junction) | cj.com → Publisher sign-up | Coursera, edX (varies), LinkedIn Learning (varies) |
| **Rakuten Advertising** | rakutenadvertising.com → Publisher | Coursera, edX (varies) |
| **PartnerStack** | partnerstack.com | DataCamp, Pluralsight, Codecademy (varies) |
| **ShareASale** (part of Awin) | shareasale.com → Affiliate sign-up | assorted course / cert providers |

**Direct/self-serve programs worth checking (no network needed):**
- **Coursera Affiliate** (also covers **Google Career Certificates**) — apply via their affiliate page (Impact/CJ).
- **edX Affiliate** — via their affiliate page.
- **Udemy** — historically limited; check current status.

### Step-by-step
1. Sign up as a **publisher/affiliate** on **Impact.com** first (widest education coverage), then CJ.
2. Under each network, **apply to** Coursera / Skillshare / edX / DataCamp / etc. (approval is usually fast; describe GPJ as a free job-search tool that recommends upskilling).
3. Once approved, **generate a tracking link** for each course/provider you want in the roadmaps.
4. **Send Claude the links** (provider → link). Claude wires them into `#levelup-tracks` and, in the *same* deploy, ships the disclosure copy (below). Not before.

## Email templates (only for partners that require direct outreach)

**A. Generic affiliate/partnership inquiry**
> Subject: Affiliate partnership — GhostProofJob (free job-search app) recommending your courses
>
> Hi [Team/Name],
> I run **GhostProofJob** (ghostproofjob.com), a free, ethical job-search app. Inside it we
> recommend upskilling paths ("Level Up Your Salary") chosen purely from salary & hiring
> data to help job seekers raise their odds. Your courses are a strong fit for several of
> these roadmaps.
> I'd like to join your **affiliate/referral program** so we can link learners to your
> courses with proper tracking. Could you point me to your program (or the network you use —
> Impact/CJ/Rakuten/PartnerStack)? We disclose affiliate relationships clearly to our users
> and never let commissions influence what we recommend.
> Thanks! — Aaliyah, GhostProofJob

**B. Certification body (PMP/CompTIA/AWS-style)**
> Subject: Referral partnership — sending motivated learners to [Cert] prep
>
> Hi [Team],
> GhostProofJob recommends certifications that measurably raise pay for specific roles, based
> on our own hiring/salary data. [Cert] comes up often for [field] seekers. Do you offer an
> affiliate/referral or bulk-voucher program we could route learners through? We disclose
> partnerships transparently. Happy to share our audience profile.
> — Aaliyah, GhostProofJob

## HELD copy changes (ship ONLY with the tracking links)
- **FAQ "Do you make money from course recommendations?"** → change from *"No…"* to:
  *"Yes — a little. When you enroll in a recommended course through our link, we may earn a
  small referral commission. It helps fund the app and keeps it free. It **never** changes
  what we recommend — roadmaps are still ranked by salary & hiring data alone. We'll always
  show this clearly."*
- **"We earn nothing from course recommendations"** (FAQ ~8639) → *"We may earn a small
  referral commission if you enroll in a recommended course — disclosed on the section, and
  it never changes the ranking. We still show no ads and never sell your data."*
- **Level-Up section sub-copy** (`#lv-sub`, ~3095) → append: *"We may earn a commission if
  you enroll — it never changes what we recommend."*
- **Guardrail (code):** ranking in `#levelup-tracks` stays salary/hiring-data driven; the
  affiliate link is attached AFTER ranking, never as a ranking input.

## Open reminder
- **2026-09-29:** Claude to check in with the founder: "Do you have the affiliate tracking
  links yet? Once you do, I'll wire them in and ship the disclosure copy together."
