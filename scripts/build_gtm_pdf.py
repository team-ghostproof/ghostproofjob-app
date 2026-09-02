# Builds docs/GhostProofJob-Overview.pdf — a polished, shareable value one-pager for
# potential users. Honest, on-brand (Midnight Plum + Mint + Cyber). reportlab only.
import os
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, KeepTogether)

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "docs", "GhostProofJob-Overview.pdf")

PLUM  = HexColor("#120F1D")
PLUM2 = HexColor("#1C1830")
MINT  = HexColor("#00F5A0")
MINT2 = HexColor("#0B8A5E")
CYBER = HexColor("#B55FE6")
INK   = HexColor("#1B1726")
MUT   = HexColor("#5B5570")
FAINT = HexColor("#8A83A0")
CARD  = HexColor("#F5F3FB")
LINE  = HexColor("#E4E0EE")

def P(txt, size=10.5, color=INK, bold=False, align=TA_LEFT, leading=None, space=4, font=None):
    st = ParagraphStyle("s", fontName=(font or ("Helvetica-Bold" if bold else "Helvetica")),
                        fontSize=size, textColor=color, alignment=align,
                        leading=leading or size*1.42, spaceAfter=space)
    return Paragraph(txt, st)

def band(flowables, bg, pad=14, radius=12):
    t = Table([[flowables]], colWidths=[6.9*inch])
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,-1),bg),
        ("LEFTPADDING",(0,0),(-1,-1),pad),("RIGHTPADDING",(0,0),(-1,-1),pad),
        ("TOPPADDING",(0,0),(-1,-1),pad),("BOTTOMPADDING",(0,0),(-1,-1),pad),
        ("ROUNDEDCORNERS",[radius,radius,radius,radius]),
    ]))
    return t

def pillar(icon, title, body):
    cell = [P(icon+"  "+title, 11.5, INK, bold=True, space=3),
            P(body, 9.3, MUT, leading=13)]
    t = Table([[cell]], colWidths=[3.28*inch])
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,-1),CARD),
        ("LEFTPADDING",(0,0),(-1,-1),13),("RIGHTPADDING",(0,0),(-1,-1),13),
        ("TOPPADDING",(0,0),(-1,-1),12),("BOTTOMPADDING",(0,0),(-1,-1),12),
        ("ROUNDEDCORNERS",[11,11,11,11]),("VALIGN",(0,0),(-1,-1),"TOP"),
    ]))
    return t

def pillar_row(a, b):
    t = Table([[a, b]], colWidths=[3.42*inch, 3.42*inch])
    t.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),
                           ("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(0,0),13),
                           ("RIGHTPADDING",(1,0),(1,0),0),("TOPPADDING",(0,0),(-1,-1),0),
                           ("BOTTOMPADDING",(0,0),(-1,-1),0)]))
    return t

def header(canvas, doc):
    canvas.saveState()
    w, h = LETTER
    canvas.setFillColor(PLUM); canvas.rect(0, h-1.55*inch, w, 1.55*inch, fill=1, stroke=0)
    # mint accent line
    canvas.setFillColor(MINT); canvas.rect(0, h-1.58*inch, w, 0.05*inch, fill=1, stroke=0)
    canvas.setFillColor(white); canvas.setFont("Helvetica-Bold", 26)
    canvas.drawString(0.8*inch, h-0.75*inch, "GhostProofJob")
    canvas.setFillColor(MINT); canvas.setFont("Helvetica-Bold", 14)
    canvas.drawString(0.82*inch, h-1.06*inch, "Get answered, not ghosted.")
    canvas.setFillColor(HexColor("#B9B3CC")); canvas.setFont("Helvetica", 10)
    canvas.drawString(0.82*inch, h-1.28*inch, "The ethical, free-until-hired job search  ·  ghostproofjob.com")
    # footer
    canvas.setFillColor(FAINT); canvas.setFont("Helvetica", 8)
    canvas.drawCentredString(w/2, 0.42*inch, "GhostProofJob  ·  No ads. No data selling. Ever.  ·  ghostproofjob.com")
    canvas.restoreState()

def build():
    doc = SimpleDocTemplate(OUT, pagesize=LETTER, topMargin=1.85*inch, bottomMargin=0.7*inch,
                            leftMargin=0.8*inch, rightMargin=0.8*inch, title="GhostProofJob — Overview")
    S = []
    # ---- problem ----
    S.append(P("Job hunting is broken.", 16, INK, bold=True, space=4))
    S.append(P("You apply into the void, wait weeks, and hear nothing back. Worse, many postings are "
               "<b>“ghost jobs”</b> — roles that aren’t really hiring, quietly wasting your time. "
               "GhostProofJob fixes it: only <b>verified, live openings</b>, a <b>community ghosting-risk score</b> on "
               "every company, and an honest AI co-pilot that never invents experience.", 11, MUT, leading=16, space=12))

    # ---- pillars ----
    S.append(P("What you get", 13, CYBER, bold=True, space=8))
    S.append(pillar_row(
        pillar("\U0001F50D", "Build", "Swipe real, verified openings near you — each one flagged with its ghost-risk before you invest."),
        pillar("✨", "Optimize", "An honest AI co-pilot tailors your résumé + cover letter per role — using only your real experience."),
    ))
    S.append(Spacer(1, 11))
    S.append(pillar_row(
        pillar("\U0001F680", "Apply", "Jump straight to the real posting. Track every application so nothing falls through the cracks."),
        pillar("\U0001F49A", "Simplify", "One inbox for every message, interview, and match. See where you stand — no more silence."),
    ))
    S.append(Spacer(1, 14))

    # ---- the difference (dark band) ----
    diff = [P("The difference: see the ghosting risk <i>before</i> you apply", 12.5, white, bold=True, space=5),
            P("Every company carries a <b>community-sourced ghosting-risk score</b>, built from real applicant reports and "
              "verified-employer signals — never a made-up number. When a company goes quiet on you, one tap logs it, and "
              "your wasted hour becomes a warning that protects the next hunter.", 10, HexColor("#D9D4E8"), leading=15)]
    S.append(band(diff, PLUM, pad=15))
    S.append(Spacer(1, 14))

    # ---- honesty promise (mint-tinted box) ----
    S.append(P("Why you can trust it", 13, CYBER, bold=True, space=7))
    promises = [
        "<b>Always free until you’re hired.</b> No ads, ever. Applications are always unlimited.",
        "<b>We never sell your data.</b> Your résumé is shared with an employer <b>only</b> when <i>you</i> apply — never sold, never purchasable.",
        "<b>Real data only.</b> Verified roles and honest community signals — the AI never fabricates experience or metrics.",
        "<b>You’re in control.</b> See exactly what’s stored about you, export it, or delete it — anytime.",
    ]
    body = []
    for pr in promises:
        body.append(P("✓  "+pr, 9.7, INK, leading=14, space=6))
    S.append(band(body, CARD, pad=14))
    S.append(Spacer(1, 14))

    # ---- how it works ----
    S.append(P("How it works", 13, CYBER, bold=True, space=7))
    steps = [
        ("1", "Upload your résumé (or start blank) and see your matches instantly — no credit card, no account required to look."),
        ("2", "Swipe real openings, check each company’s ghost-risk, tailor your résumé to the role, and jump straight to apply."),
        ("3", "Track every application in one place — and rate the companies that ghost, so the community gets stronger with every hunter."),
    ]
    for n, txt in steps:
        num = Table([[P(n, 12, white, bold=True, align=TA_CENTER)]], colWidths=[0.34*inch], rowHeights=[0.34*inch])
        num.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),MINT2),("ROUNDEDCORNERS",[17,17,17,17]),
                                 ("VALIGN",(0,0),(-1,-1),"MIDDLE"),("LEFTPADDING",(0,0),(-1,-1),0),
                                 ("RIGHTPADDING",(0,0),(-1,-1),0),("TOPPADDING",(0,0),(-1,-1),0),("BOTTOMPADDING",(0,0),(-1,-1),0)]))
        row = Table([[num, P(txt, 10, MUT, leading=14)]], colWidths=[0.5*inch, 6.4*inch])
        row.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),0),
                                 ("TOPPADDING",(0,0),(-1,-1),1),("BOTTOMPADDING",(0,0),(-1,-1),7)]))
        S.append(row)

    S.append(Spacer(1, 12))
    # ---- CTA (mint band) ----
    cta = [P("Start free — today.", 15, PLUM, bold=True, align=TA_CENTER, space=3),
           P("<b>ghostproofjob.com</b>  ·  no credit card, no résumé required to start.", 11, PLUM, align=TA_CENTER, space=3),
           P("Or try the free Résumé Strength Checker — an instant, honest score with no sign-up.", 9.5, MINT2, align=TA_CENTER, space=0)]
    S.append(band(cta, HexColor("#D8FBEE"), pad=15))

    doc.build(S, onFirstPage=header, onLaterPages=header)
    print("WROTE", OUT, os.path.getsize(OUT), "bytes")

if __name__ == "__main__":
    build()
