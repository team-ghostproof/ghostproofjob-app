#!/usr/bin/env python3
"""Render docs/OUTSTANDING-INDEX.md -> docs/OUTSTANDING-INDEX.pdf (checkable, printable).
Minimal markdown subset: # ## ### headings, - [ ] / - [x] checkboxes, - bullets,
> blockquotes, --- rules, blank lines, paragraphs, **bold**, `code`.
No emoji font dependency: non-Latin-1 glyphs are transliterated/stripped for clean output."""
import os, re, html
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs", "OUTSTANDING-INDEX.md")
OUT = os.path.join(ROOT, "docs", "OUTSTANDING-INDEX.pdf")

PLUM = colors.HexColor("#120F1D")
MINT = colors.HexColor("#00875A")
CYBER = colors.HexColor("#6D28C9")
INK = colors.HexColor("#241F33")
MUTED = colors.HexColor("#5B5473")
LINE = colors.HexColor("#B9AEE0")

# transliterations so Helvetica renders cleanly (no tofu boxes)
XLIT = {
    "→": "->", "←": "<-", "↔": "<->", "↳": ">",
    "≥": ">=", "≤": "<=", "≈": "~", "×": "x",
    "·": "-", "—": "-", "–": "-", "…": "...",
    "‘": "'", "’": "'", "“": '"', "”": '"',
    "•": "-", " ": " ", "‑": "-", "°": "deg",
    "✅": "[x]", "❌": "[ ]", "⚠": "(!)", "️": "",
    "\U0001f534": "(!)", "\U0001f7e0": "(~)", "\U0001f9ea": "TEST:",
    "⏰": "", "\U0001f4bc": "", "\U0001f3e2": "",
}

def sanitize(s):
    for k, v in XLIT.items():
        s = s.replace(k, v)
    # drop any remaining non-Latin-1 (emoji etc.)
    return "".join(ch if ord(ch) < 256 else "" for ch in s).rstrip()

def inline(s):
    s = sanitize(s)
    s = html.escape(s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"`(.+?)`", r'<font face="Courier" size="8.5">\1</font>', s)
    return s

ss = getSampleStyleSheet()
def st(name, **kw):
    base = dict(fontName="Helvetica", fontSize=9.5, leading=13, textColor=INK, spaceAfter=4)
    base.update(kw)
    return ParagraphStyle(name, parent=ss["Normal"], **base)

H1 = st("h1", fontName="Helvetica-Bold", fontSize=17, leading=21, textColor=PLUM, spaceBefore=6, spaceAfter=8)
H2 = st("h2", fontName="Helvetica-Bold", fontSize=13, leading=17, textColor=CYBER, spaceBefore=12, spaceAfter=5)
H3 = st("h3", fontName="Helvetica-Bold", fontSize=11, leading=15, textColor=MINT, spaceBefore=8, spaceAfter=3)
BODY = st("body")
QUOTE = st("quote", fontSize=8.6, leading=12, textColor=MUTED, leftIndent=8, borderPadding=(0,0,0,0))
BULLET = st("bullet", leftIndent=14, bulletIndent=4, spaceAfter=3)
CHECK = st("check", leftIndent=16, spaceAfter=4)
CHECKDONE = st("checkdone", leftIndent=16, spaceAfter=4, textColor=MUTED)

def build():
    with open(SRC, encoding="utf-8") as f:
        lines = f.read().split("\n")
    flow = []
    para = []
    def flush():
        if para:
            flow.append(Paragraph(" ".join(para), BODY)); para.clear()
    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            flush(); flow.append(Spacer(1, 4)); continue
        if line.startswith("### "):
            flush(); flow.append(Paragraph(inline(line[4:]), H3)); continue
        if line.startswith("## "):
            flush(); flow.append(Paragraph(inline(line[3:]), H2)); continue
        if line.startswith("# "):
            flush(); flow.append(Paragraph(inline(line[2:]), H1)); continue
        if line.strip() == "---":
            flush(); flow.append(Spacer(1, 3))
            flow.append(HRFlowable(width="100%", thickness=0.6, color=LINE, spaceAfter=5)); continue
        m = re.match(r"^- \[( |x)\] (.*)$", line)
        if m:
            flush()
            done = m.group(1) == "x"
            box = "[X]" if done else "[  ]"
            style = CHECKDONE if done else CHECK
            flow.append(Paragraph(f'<font face="Courier"><b>{box}</b></font>&nbsp; ' + inline(m.group(2)), style)); continue
        if line.startswith("> "):
            flush(); flow.append(Paragraph(inline(line[2:]), QUOTE)); continue
        if re.match(r"^\s*- ", line):
            flush()
            txt = re.sub(r"^\s*- ", "", line)
            flow.append(Paragraph("&bull;&nbsp; " + inline(txt), BULLET)); continue
        para.append(inline(line))
    flush()

    doc = SimpleDocTemplate(OUT, pagesize=LETTER,
                            leftMargin=0.7*inch, rightMargin=0.7*inch,
                            topMargin=0.6*inch, bottomMargin=0.6*inch,
                            title="GhostProofJob - Outstanding Index")
    doc.build(flow)
    print("WROTE", OUT, os.path.getsize(OUT), "bytes")

if __name__ == "__main__":
    build()
