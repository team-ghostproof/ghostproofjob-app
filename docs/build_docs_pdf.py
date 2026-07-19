#!/usr/bin/env python3
"""
docs/build_docs_pdf.py — regenerates the two founder-facing PDFs from one source
of truth so they never drift again:

    python docs/build_docs_pdf.py

  -> docs/GPJ_Master_Audit_Checklist.pdf
  -> docs/GPJ_Recruiter_Tier_Master_Plan.pdf

NOTE: no emoji anywhere. ReportLab's built-in fonts have no emoji glyphs (they
render as solid black boxes), and lone-surrogate emoji in Python string writes
have previously corrupted files in this repo. Status is carried by text markers.
"""

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, HRFlowable,
)
import os

# ---- brand -----------------------------------------------------------------
PLUM = colors.HexColor("#120F1D")
PLUM2 = colors.HexColor("#1C1830")
PLUM3 = colors.HexColor("#251F3A")
MINT = colors.HexColor("#00B87A")      # darkened for print legibility on white
CYBER = colors.HexColor("#8B3FD0")
WARN = colors.HexColor("#B4761A")
STOP = colors.HexColor("#C22C48")
INK = colors.HexColor("#1B1526")
MUTED = colors.HexColor("#5F5977")

BUILD = "v128"
DATE = "2026-07-18"
HERE = os.path.dirname(os.path.abspath(__file__))

ss = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=ss["Title"], fontName="Helvetica-Bold", fontSize=22,
                    textColor=INK, spaceAfter=4, alignment=TA_LEFT, leading=26)
SUB = ParagraphStyle("SUB", parent=ss["Normal"], fontName="Helvetica", fontSize=9.5,
                     textColor=MUTED, spaceAfter=14, leading=13)
H2 = ParagraphStyle("H2", parent=ss["Heading2"], fontName="Helvetica-Bold", fontSize=13,
                    textColor=CYBER, spaceBefore=14, spaceAfter=6, leading=16)
H3 = ParagraphStyle("H3", parent=ss["Heading3"], fontName="Helvetica-Bold", fontSize=10.5,
                    textColor=INK, spaceBefore=8, spaceAfter=3, leading=13)
BODY = ParagraphStyle("BODY", parent=ss["Normal"], fontName="Helvetica", fontSize=9.3,
                      textColor=INK, leading=13.4, spaceAfter=5)
SMALL = ParagraphStyle("SMALL", parent=BODY, fontSize=8.4, textColor=MUTED, leading=11.6)
CELL = ParagraphStyle("CELL", parent=BODY, fontSize=8.5, leading=11.4, spaceAfter=0)
CELLB = ParagraphStyle("CELLB", parent=CELL, fontName="Helvetica-Bold")


def hdr(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PLUM)
    canvas.rect(0, LETTER[1] - 0.5 * inch, LETTER[0], 0.5 * inch, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 10)
    canvas.drawString(0.75 * inch, LETTER[1] - 0.32 * inch, "GhostProofJob")
    canvas.setFillColor(colors.HexColor("#00F5A0"))
    canvas.setFont("Helvetica", 8.5)
    # offset past the measured wordmark width so the tagline can never collide with it
    canvas.drawString(0.75 * inch + canvas.stringWidth("GhostProofJob", "Helvetica-Bold", 10) + 10,
                      LETTER[1] - 0.32 * inch, "Build - Optimize - Apply")
    canvas.setFillColor(colors.HexColor("#8A85A0"))
    canvas.drawRightString(LETTER[0] - 0.75 * inch, LETTER[1] - 0.32 * inch,
                           "%s  -  %s" % (BUILD, DATE))
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawCentredString(LETTER[0] / 2, 0.42 * inch, "Page %d" % doc.page)
    canvas.drawString(0.75 * inch, 0.42 * inch, "Living source: docs/master-audit-checklist.md")
    canvas.restoreState()


def doc_for(path, title):
    return SimpleDocTemplate(path, pagesize=LETTER,
                             leftMargin=0.75 * inch, rightMargin=0.75 * inch,
                             topMargin=0.85 * inch, bottomMargin=0.7 * inch,
                             title=title, author="GhostProofJob")


def status_tbl(rows, widths):
    """rows: [[status, item, detail], ...] with status in DONE/PART/TODO/STOP."""
    tone = {"DONE": MINT, "PART": WARN, "TODO": MUTED, "STOP": STOP}
    data = [[Paragraph("<b>%s</b>" % h, CELLB) for h in ("Status", "Item", "Detail")]]
    for st, item, detail in rows:
        data.append([
            Paragraph('<font color="%s"><b>%s</b></font>' % (tone[st].hexval(), st), CELL),
            Paragraph(item, CELLB),
            Paragraph(detail, CELL),
        ])
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PLUM3),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#DDD8E8")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F5FB")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def rule():
    return HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#DDD8E8"),
                      spaceBefore=8, spaceAfter=8)


# ============================================================================
# 1) MASTER AUDIT CHECKLIST
# ============================================================================
def build_checklist():
    path = os.path.join(HERE, "GPJ_Master_Audit_Checklist.pdf")
    s = []
    s.append(Paragraph("Master Audit Checklist &amp; Roadmap", H1))
    s.append(Paragraph(
        "Live build <b>%s</b> - updated %s. Benchmark all-pass (div 2091/2091, boot RAN TO COMPLETION, "
        "mirror byte-identical, 0 duplicate DOM ids, 251 handlers / 0 missing). "
        "Playwright <b>267 pass</b>. Rules emulator <b>83/83</b>. SEO tests <b>13/13</b>. CI green." % (BUILD, DATE), SUB))

    s.append(Paragraph("Where the product stands", H2))
    s.append(Paragraph(
        "The candidate product is launch-ready and the employer product is complete end-to-end "
        "(post - apply - reverse-match - outreach - interview), with the anti-ghosting promise enforced "
        "structurally on both sides. Live AI and lifecycle email are deployed. What remains is "
        "operational and growth work, not missing product.", BODY))

    s.append(Paragraph("1. Candidate product - LAUNCH READY", H2))
    s.append(status_tbl([
        ("DONE", "Job discovery", "Swipe deck + Browse, location-scoped, ghost-risk flagging, stale/verified detection, pool de-dupe."),
        ("DONE", "F-GEO distance filter (v106)", "Max Distance re-enabled: offline city centroids + haversine, client-side, ZERO extra reads. Remote/unknown always pass."),
        ("DONE", "Resume Studio + Jett AI", "Parse, LinkedIn import, summary synthesis, key duties, skills tidy, 5 templates, PDF export."),
        ("DONE", "AI honesty + self-heal (v105)", "Every AI button is transparent when it falls back to smart templates (says why + when live AI returns). Double-verb bullets self-heal at render."),
        ("DONE", "Match-to-Job + Requirements Check", "Real overlap vs a posting; honest gaps, no echoed skills."),
        ("DONE", "Cover letters", "Job-aware, revisable, stored; no placeholder text."),
        ("DONE", "Accounts + sync", "Auth, cloud profile, cross-device, account-switch desync fixed."),
        ("DONE", "Fair-use tiers", "Hyper-Drive / Core Search / Base Camp. Applications ALWAYS unlimited. No dark patterns."),
        ("DONE", "Referral engine (v107)", "Invite link -> Booster when a friend joins + sets up a resume. Rules-gated: no self-referral, no pre-onboarded farming."),
        ("DONE", "PWA + Admin portal", "Installable, versioned cache, iOS auto-update; admin counts + verification queues + view-as-employer."),
        ("PART", "iOS PWA safe-area (7c)", "Coded and test-locked; only verifiable on a real installed iPhone (env() cannot be emulated). FOUNDER CHECK."),
    ], [0.6 * inch, 1.75 * inch, 4.65 * inch]))

    s.append(Paragraph("2. Employer / recruiter product - COMPLETE", H2))
    s.append(status_tbl([
        ("DONE", "R2-A Signup + email gate", "Corporate-domain only; account-type fork; full company + hiring-contact onboarding."),
        ("DONE", "R2-B Post + admin review", "Roles hidden until an admin verifies them."),
        ("DONE", "R2-C Internal apply", "In-app apply; applicant counts. v110: apply snapshots a bounded resume + cover letter (consent-to-share)."),
        ("DONE", "R2-D Candidate opt-in", "Discoverable, default OFF - consent to be found AND contacted."),
        ("DONE", "R3 Reverse-match engine", "Nightly GitHub Action scores opted-in candidates per role; applicants ranked first; bounded reads."),
        ("DONE", "R4 Matched candidates", "Ranked cards, match %, skill chips. Never sold, never purchasable."),
        ("DONE", "R5 Outreach + Anti-Ghosting Badge", "Reach out or send a respectful decline; responsive recruiters earn a visible badge. Appeal flow for declines."),
        ("DONE", "R6 Candidate tray", "Reach-outs + declines in Settings; Interested / Not now."),
        ("DONE", "R7 Interview scheduling", "Recruiter proposes up to 3 slots; candidate picks one; confirmed time returns to the recruiter inbox."),
        ("DONE", "R8 Plan caps + Stripe", "Free tier = 5 live roles. Recruiter Premium $79/mo + Pro $149/mo wired to Stripe hosted checkout."),
        ("DONE", "Billing automation (v114-v116)", "Stripe webhook GRANTS and REVOKES on both sides: checkout grants; cancel / non-payment / full refund / chargeback auto-drop to free. A lapsed paidUntil reads as free even if a webhook is ever missed."),
        ("DONE", "Company team (v112)", "Owner / admin / standard roles; email-bound invites redeem a company seat on first sign-in; seats by plan (Free 1 / Premium 5 / Pro unlimited)."),
        ("DONE", "Notification centre (v116)", "Bell + unread badge between the account chip and the plan button; reuses existing data (no new reads); click-through lands on the right tab."),
        ("DONE", "Listings EDIT in place (v117)", "The same form edits a live role - previously it could only be deleted and re-posted, which threw away its applicants. The seat cap does not fire on an edit. A repaint mid-edit no longer eats unsaved typing."),
        ("DONE", "Founder live-test sprint (v118-v121)", "Employer jobs can never be buried in the pool; preferences persist across logins; ghost-risk is REAL signals only (no fabricated %); street-safe City/State; benefits + up to 5 custom application questions; company logo upload; admin approval alerts (bell + nightly email digest); candidate withdrawal + Seen-by-employer status; signup attribution; honest duplicate-apply guard."),
        ("DONE", "Password recovery (v122)", "Forgot password on BOTH auth modals - before this a forgotten password was a permanent lockout (no reset path existed anywhere)."),
        ("DONE", "Verified fill-source (v117)", "Closing a role asks HOW it was filled: hired via GhostProofJob / filled elsewhere / cancelled. A GPJ hire logs an anonymous aggregate proof-point; 'filled elsewhere' deliberately does NOT count as our hire."),
        ("DONE", "R9 Full recruiter view (v109-v110)", "All 6 tabs reskin by role with real functionality. Fixed the desktop 'For Employers' bug. Zero candidate regression by construction."),
        ("DONE", "Security rules", "Scoped writes, no self-verify, verified-recruiter gates, consent-gated outreach. Emulator-proven 103/103."),
    ], [0.6 * inch, 1.75 * inch, 4.65 * inch]))

    s.append(PageBreak())
    s.append(Paragraph("3. Ghost-proofing, growth &amp; marketing", H2))
    s.append(status_tbl([
        ("DONE", "F-GHOST cross-user reports", "Shape-locked ghost_reports collection (no free-text/PII). 'Another hunter reported this' works cross-device."),
        ("DONE", "Email opt-out / CAN-SPAM", "/api/unsubscribe one-click + suppression honored globally; Worker attaches the footer + mailing address; daily cron skips opt-outs."),
        ("DONE", "Ghost-content engine", "Drafts a week of posts from live ghost data with defamation guardrails; never auto-posts."),
        ("DONE", "SEO page generator", "61 static 'ghost jobs in {city}' pages + index + sitemap.xml + robots.txt. ZERO runtime reads. Honesty rules enforced as tests. No company pages (legal review)."),
        ("DONE", "Referral engine", "See candidate section."),
    ], [0.6 * inch, 1.75 * inch, 4.65 * inch]))

    s.append(Paragraph("4. Outstanding - the real remaining list", H2))
    s.append(status_tbl([
        ("TODO", "D1 Firestore read-cost", "~163K reads/day, over free tier. Blaze trial credit ends 2026-09-19. Pagination + session cache + query caps, or a budget. DELIBERATELY LAST - after all features + marketing, so there is less read/write to optimize."),
        ("PART", "iOS PWA safe-area (7c)", "Founder device check clears it."),
        ("TODO", "Reviews: public replies", "v110 ships view + dispute-to-admin. Public company replies to individual reviews need a moderation model - phased for later."),
        ("TODO", "Company SEO pages", "Deliberately OFF until legal review."),
        ("TODO", "Full internal scheduling", "R7 minimal-real slots shipped; NEXT SPRINT: date/time pickers, an Interviews section both sides, reschedule/cancel, bell reminders."),
        ("TODO", "Account deletion", "No delete-my-account path exists yet (privacy/trust gap found in the v122 e2e audit; auth imports already anticipate it)."),
        ("TODO", "Surface the verified-hire data", "v117 STARTS capturing how each role was filled. Nothing displays it yet - the aggregate ('N roles filled via GhostProofJob') needs a view before it can be used as a public proof-point."),
        ("PART", "Candidate messaging depth", "Outreach is one reach-out + one structured response (interested / not now / slot / appeal). There is no back-and-forth thread; scheduling is free-text slots, not calendar integration. Honest framing: minimal-real, not a full ATS inbox."),
    ], [0.6 * inch, 1.75 * inch, 4.65 * inch]))

    s.append(Paragraph("5. Founder actions", H2))
    s.append(Paragraph(
        "<b>1. Redeploy firestore.rules</b> - carries three security fixes (recruiters could self-set isValidated, "
        "claim another company's domain, or self-grant a paid tier), the company team model, and the close-role "
        "rule (a role owner may CLOSE their live role, active true-&gt;false, but never self-activate). Without it, "
        "'Close / filled' is denied.<br/>"
        "<b>2. Verify recruiter@ is a recruiter account</b> - sign in, open For Employers. Company profile = real "
        "recruiter account (auto-routes now). 'Create employer account' = it was made via candidate signup and "
        "needs recreating through the employer path.<br/>"
        "<b>3. Sitemap</b> - DONE: Search Console reports it processed, 63 pages discovered.<br/>"
        "<b>3b. Stripe billing</b> - set Vercel env STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET, then add the webhook "
        "endpoint https://ghostproofjob.com/api/stripe-webhook with SIX events (checkout.session.completed, "
        "customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed, charge.refunded, "
        "charge.dispute.created). Until this is done, paying customers are granted NOTHING. See docs/stripe-setup.md.<br/>"
        "<b>3c. Weekly Content Pack</b> - the marketing engine has never run; trigger it once to confirm.<br/>"
        "<b>4. Deployed already:</b> Worker (mode:summary + CAN-SPAM footers), Firestore rules through v107, "
        "Vercel FIREBASE_SERVICE_ACCOUNT.", BODY))

    s.append(rule())
    s.append(Paragraph("Non-negotiable rules still in force", H2))
    s.append(Paragraph(
        "INSERT-ONLY (never rebuild/redesign; add narrowly). [UI-REVIEW] gate on any layout/view/overlay change. "
        "Full drop-in files, never snippets. Works on mobile, iOS, Android, tablet, desktop. No misleading copy: "
        "honest 'jump to apply' only, auto-apply is architecturally impossible, no demo data in live views, no "
        "Google scraping. Never break a prior fix. Honesty over optimism. [STATE-COVERAGE] matrix before any "
        "feature or fix (guest / authed / failed-network / empty-data) with a Playwright test for uncovered states.", SMALL))

    doc_for(path, "GPJ Master Audit Checklist").build(s, onFirstPage=hdr, onLaterPages=hdr)
    return path


# ============================================================================
# 2) RECRUITER TIER MASTER PLAN
# ============================================================================
def build_recruiter():
    path = os.path.join(HERE, "GPJ_Recruiter_Tier_Master_Plan.pdf")
    s = []
    s.append(Paragraph("Recruiter Tier - Master Plan", H1))
    s.append(Paragraph(
        "Live build <b>%s</b> - updated %s. Status: <b>R0 through R9 COMPLETE.</b> The two-sided marketplace is "
        "built end-to-end and is honestly advertisable." % (BUILD, DATE), SUB))

    s.append(Paragraph("The invariant that governs everything", H2))
    s.append(Paragraph(
        "<b>Candidate-first.</b> The candidate product is the product. No recruiter feature may add a Firestore read "
        "to the candidate hot path (deck / Browse / auth), and a pure candidate must never trigger a recruiter-doc "
        "read. This is enforced by a Playwright test that counts recruiter reads during candidate browse/swipe/auth "
        "and asserts zero. It is why the v108 cross-device recruiter detection reads the PROFILE role marker "
        "(already loaded at sign-in) rather than probing the recruiters collection for everyone.", BODY))

    s.append(Paragraph("Consent + privacy model (non-negotiable)", H2))
    s.append(Paragraph(
        "Candidate contact is <b>never sold and never purchasable</b> - on any plan. A candidate is surfaced to "
        "employers only if they opted in (discoverable, default OFF), and opting in is consent to be found AND "
        "contacted. In the recruiter Candidates tab, matches are <b>anonymous until the candidate accepts</b>: "
        "match %, market and skills only - no name, contact or resume. An applicant who applies to a role shares a "
        "bounded resume + cover letter snapshot <b>with that employer only</b> - applying is the consent.", BODY))

    s.append(Paragraph("Sprint status", H2))
    s.append(status_tbl([
        ("DONE", "R0 Foundation", "Security rules + emulator suite + in-repo reverse-match scorer + scaffolding."),
        ("DONE", "R1 Frontend entry", "Employers nav + footer link, employer view, recruiter auth with live corporate-email gate, admin verification queue."),
        ("DONE", "R2-A Onboarding", "Signup fork, required company + website, full company/contact profile."),
        ("DONE", "R2-B Job posting", "Create/list own internal roles; hidden until admin-approved."),
        ("DONE", "R2-C Internal apply", "In-app apply + applicant counts (count aggregation, D1-safe)."),
        ("DONE", "R2-D Candidate opt-in", "Discoverable toggle, default OFF, top-level profile field."),
        ("DONE", "R3 Reverse-match", "buildMatchTokens (opted-in only) + runReverseMatch -> jobs/{id}/recommended_candidates. Nightly Action 06:30 UTC."),
        ("DONE", "R4 Matched dashboard", "Ranked candidate cards, bounded owner-gated query."),
        ("DONE", "R5 Outreach + anti-ghosting", "Reach-out / respectful decline, Anti-Ghosting Badge, appeal flow. Consent-gated at the rules layer."),
        ("DONE", "R6 Candidate tray", "Employer messages in Settings; Interested / Not now."),
        ("DONE", "R7 Scheduling", "Propose up to 3 slots; candidate picks; confirmed time returns to the recruiter inbox."),
        ("DONE", "R8 Billing", "Free = 5 live roles. Premium $79/mo, Pro $149/mo via Stripe hosted checkout."),
        ("DONE", "R9 Full recruiter view", "The 6-tab reskin. See below."),
    ], [0.6 * inch, 1.6 * inch, 4.8 * inch]))

    s.append(PageBreak())
    s.append(Paragraph("R9 - the recruiter view (v109-v110)", H2))
    s.append(Paragraph(
        "<b>Architecture (founder-approved):</b> reskin the existing 6 tabs by account role rather than build a "
        "parallel view system. One role check drives each tab's content and the nav labels. Recruiter content lives "
        "in a .rec-panel per view; a .rec-mode CSS class hides the candidate content. <b>The candidate views are "
        "never modified</b> - zero regression by construction, proven by a dedicated no-regression test. This also "
        "fixed the desktop 'For Employers' bug for free: the root cause was that buildDesktopGrid never moved "
        "#view-employer into the desktop workspace, so the view rendered outside the clipped grid and clicking did "
        "nothing.", BODY))

    data = [[Paragraph("<b>Tab</b>", CELLB), Paragraph("<b>Candidate</b>", CELLB), Paragraph("<b>Recruiter (v110)</b>", CELLB)]]
    for a, b, c in [
        ("Swipe", "Job matches deck", "<b>Candidates</b> - anonymous matches across live roles (match %, local, skills; no PII). 'Send them this role' fires the R5 outreach; the candidate sees a hot match in their tray."),
        ("Browse", "Job list", "<b>Applicants</b> - your roles, expand to the applicant list, tap for the <b>Candidate Card</b> with resume + cover letter."),
        ("Resume", "Resume Studio", "<b>Listings</b> - post roles, applicant counts, Mark filled (closes the role), Remove."),
        ("Ghosts", "Ghost reports", "<b>Reviews</b> - your company ghost-risk score + report count + dispute to GhostProofJob."),
        ("Account", "Personal profile", "<b>Company</b> - full company profile, saved to Firestore."),
        ("Settings", "Candidate settings", "<b>Settings</b> - recruiter verbiage + the Stripe Plan card."),
    ]:
        data.append([Paragraph(a, CELLB), Paragraph(b, CELL), Paragraph(c, CELL)])
    t = Table(data, colWidths=[0.75 * inch, 1.3 * inch, 4.95 * inch], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PLUM3), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#DDD8E8")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F5FB")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    s.append(t)
    s.append(Paragraph(
        "Nav relabels on both the mobile footer and the desktop rail. Recruiters auto-route to the Candidates tab on "
        "sign-in (cloud role marker, works on any device). 'For Employers' is hidden for signed-in individuals and "
        "shown to guests (marketing), admins (testing) and recruiters.", SMALL))

    s.append(Paragraph("Data + rules model", H2))
    s.append(Paragraph(
        "<b>recruiters/{uid}</b> - the recruiter doc; isValidated is admin-only (no self-verify).<br/>"
        "<b>companies/{domain}</b> - recruiter may create/update only their own-domain doc; can never self-set "
        "verifiedEmployer.<br/>"
        "<b>jobs/{id}</b> - owner creates internal roles hidden (active:false, isValidated:false). Owner may edit "
        "content and <b>close</b> a live role (active true-&gt;false, v110) but never self-activate (false-&gt;true). "
        "Admin approval sets active + isValidated.<br/>"
        "<b>jobs/{id}/applications/{uid}</b> - candidate owns their application; owner-recruiter reads it. Carries the "
        "apply-time resume/cover snapshot.<br/>"
        "<b>match_tokens/{uid}</b> - backend-written, opted-in candidates only; verified-recruiter read.<br/>"
        "<b>reachouts/{id}</b> - verified recruiter creates, consent-gated (candidate has a match token OR applied); "
        "status sent; kind reachout|rejection; message &lt;= 800. Only the recipient may respond "
        "(interested|declined|appealed), accept a slot (acceptedTime &lt;= 200) or appeal a rejection "
        "(appealMessage &lt;= 400). No deletes - the outreach trail is an audit record.<br/>"
        "All of the above is emulator-proven: <b>83/83</b>.", BODY))

    s.append(Paragraph("Pricing", H2))
    s.append(Paragraph(
        "<b>Free</b> - up to 5 live roles, matched candidates, outreach + anti-ghosting included.<br/>"
        "<b>Recruiter Premium - $79/mo</b> - more live roles + candidate matching.<br/>"
        "<b>Recruiter Pro - $149/mo</b> - highest role limit + priority placement + full reverse-match reach.<br/>"
        "Both open Stripe hosted checkout in a new tab; card data never touches the app. Candidate-side pricing is "
        "unchanged and unaffected: free until hired, applications always unlimited.", BODY))

    s.append(Paragraph("What remains", H2))
    s.append(status_tbl([
        ("TODO", "Public review replies", "v110 ships view + dispute-to-admin. Public replies to individual reviews need a moderation model."),
        ("PART", "Matches need data", "Candidates/Applicants are empty until the nightly reverse-match runs and candidates opt in or apply. Honest empty states ship."),
        ("TODO", "Rules redeploy", "v110 adds the close-role permission. FOUNDER ACTION."),
        ("TODO", "D1 read-cost", "Deliberately last, after all features + marketing."),
    ], [0.6 * inch, 1.6 * inch, 4.8 * inch]))

    doc_for(path, "GPJ Recruiter Tier Master Plan").build(s, onFirstPage=hdr, onLaterPages=hdr)
    return path


if __name__ == "__main__":
    for p in (build_checklist(), build_recruiter()):
        print("[docs] wrote %s (%.1f KB)" % (os.path.basename(p), os.path.getsize(p) / 1024.0))
