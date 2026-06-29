#!/usr/bin/env python3
"""
scripts/job_spy_harvester.py

Free job ingestion via python-jobspy -> Firestore.
Normalizes to the GhostProofJob schema:
    title, company, location, direct_apply_url, source, region
Deterministic doc IDs (sha1 of title-company-region-citytoken) make
.set(merge=True) idempotent so re-runs never duplicate cards, while still
keeping the SAME role+employer in different cities as distinct jobs.

This version (v2) focuses on READING REAL DATA off LinkedIn/Indeed correctly:
  * clean_md()  — strips JobSpy markdown escapes ("\\-", "**bold**") that were
                  breaking salary parsing and leaking raw markup onto cards.
  * salary      — currency-anchored ranges/singles, K-inheritance ("$85-$100k"),
                  hourly, European dot-thousands, "/yr" + "a year" noise removed.
  * requirements/responsibilities/benefits — pulled from the real sections
                  ("Requirements added by the job poster", "Featured benefits",
                  responsibilities prose) instead of the "About us" blurb.
  * STACKING_MODE=1 — disables pruning + lets the workflow widen the budget so
                  you can stack jobs hard for a few days, then revert to normal.

Run `python job_spy_harvester.py --selftest` to validate the parsers offline
(no network / no Firestore needed). CI runs this before the real harvest.

Env:
    FIREBASE_SERVICE_ACCOUNT  - JSON string of the service account credentials
"""

import os
import sys
import json
import hashlib
import datetime
import re as _re

COLLECTION = "jobs"
RESULTS_PER_QUERY = int(os.environ.get("RESULTS_PER_QUERY", "200"))
# ZipRecruiter removed: it consistently returns 403 (Cloudflare bot-block) and
# wastes ~2 min per attempt failing. LinkedIn + Indeed return reliably.
SITES = ["linkedin", "indeed"]

US_ROLE_LIBRARY = [
    # broad buckets (each returns many related titles)
    "operations", "sales", "retail", "hospitality", "trades", "marketing",
    "data entry", "executive", "engineering", "administrative",
    "customer service", "finance", "internship",
    # healthcare (specific)
    "registered nurse", "medical assistant", "physician", "pharmacy technician",
    "home health aide", "physical therapist", "dental assistant",
    # education
    "teacher", "substitute teacher", "teaching assistant", "school counselor",
    # transportation / logistics
    "truck driver", "delivery driver", "bus driver", "warehouse associate",
    "forklift operator", "diesel mechanic",
    # skilled trades
    "electrician", "plumber", "hvac technician", "welder", "carpenter",
    # tech / office
    "software engineer", "data analyst", "project manager", "accountant",
    "human resources", "graphic designer", "social worker",
    # service
    "security guard", "janitor", "cook", "barista", "cashier", "receptionist",
]
TARGETS = [
    {"country": "usa", "region": "United States", "locations": ["United States", "Houston, TX", "Remote"], "roles": US_ROLE_LIBRARY},
    {"country": "canada", "region": "Canada", "locations": ["Canada"], "roles": ["operations", "sales", "retail", "trades", "internship", "data entry", "registered nurse", "truck driver", "teacher"]},
    {"country": "mexico", "region": "Mexico", "locations": ["Mexico"], "roles": ["operaciones", "ventas", "retail", "practicante", "enfermera", "chofer"]},
    {"country": "uk", "region": "United Kingdom", "locations": ["United Kingdom", "London"], "roles": ["operations", "sales", "retail", "hospitality", "trades", "internship", "data entry", "creative"]},
    {"country": "germany", "region": "Germany", "locations": ["Deutschland"], "roles": ["betrieb", "verkauf", "einzelhandel", "praktikum"]},
    {"country": "france", "region": "France", "locations": ["France"], "roles": ["operations", "vente", "commerce", "stage"]},
    {"country": "italy", "region": "Italy", "locations": ["Italia"], "roles": ["operazioni", "vendite", "retail", "stage"]},
    {"country": "spain", "region": "Spain", "locations": ["España"], "roles": ["operaciones", "ventas", "retail", "practicas"]},
    {"country": "netherlands", "region": "Netherlands", "locations": ["Nederland"], "roles": ["operations", "sales", "retail", "internship"]},
    {"country": "belgium", "region": "Belgium", "locations": ["Belgique", "België"], "roles": ["operations", "sales", "retail"]},
    {"country": "austria", "region": "Austria", "locations": ["Österreich"], "roles": ["operations", "sales", "retail"]},
    {"country": "poland", "region": "Poland", "locations": ["Polska"], "roles": ["operacje", "sprzedaz", "retail", "staz"]},
    {"country": "switzerland", "region": "Switzerland", "locations": ["Schweiz", "Suisse"], "roles": ["operations", "sales", "retail"]},
    {"country": "australia", "region": "Australia", "locations": ["Australia"], "roles": ["operations", "sales", "retail", "trades", "internship", "hospitality"]},
    {"country": "new zealand", "region": "New Zealand", "locations": ["New Zealand"], "roles": ["operations", "sales", "retail", "trades"]},
    {"country": "india", "region": "India", "locations": ["India"], "roles": ["operations", "sales", "marketing", "data entry", "internship", "tech"]},
    {"country": "singapore", "region": "Singapore", "locations": ["Singapore"], "roles": ["operations", "sales", "retail", "internship"]},
    {"country": "south africa", "region": "South Africa", "locations": ["South Africa"], "roles": ["operations", "sales", "retail", "trades", "internship"]},
    {"country": "brazil", "region": "Brazil", "locations": ["Brasil"], "roles": ["operacoes", "vendas", "retail", "estagio"]},
]


# ─────────────────────────────────────────────────────────────────────────────
# TEXT CLEANING — the root fix. JobSpy returns markdown ("description_format=
# markdown"), which escapes hyphens as "\-" and wraps headers in "**". That
# broke salary ranges ("$85\-$100k") and leaked "**About us**" onto cards.
# ─────────────────────────────────────────────────────────────────────────────
def clean_md(text):
    if not text:
        return ""
    t = str(text)
    # 1) unescape backslash-escaped markdown punctuation:  \-  \$  \.  \(  \*
    t = _re.sub(r"\\([\\`*_{}\[\]()#+\-.!$~>|])", r"\1", t)
    # 2) strip bold / italic markers but keep the words
    t = _re.sub(r"\*\*([^*]+)\*\*", r"\1", t)
    t = _re.sub(r"__([^_]+)__", r"\1", t)
    t = _re.sub(r"(?<!\*)\*(?!\*)([^*\n]+?)\*(?!\*)", r"\1", t)
    # 3) drop leading markdown heading hashes
    t = _re.sub(r"(?m)^\s{0,3}#{1,6}\s*", "", t)
    # 4) normalize bullet markers to "• "
    t = _re.sub(r"(?m)^[ \t]*[*\-+]\s+", "• ", t)
    # 5) collapse whitespace
    t = _re.sub(r"[ \t]{2,}", " ", t)
    t = _re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def safe_str(v):
    if v is None:
        return ""
    try:
        if isinstance(v, float) and v != v:  # pandas NaN
            return ""
    except Exception:
        pass
    return str(v).strip()


# ─────────────────────────────────────────────────────────────────────────────
# CITY TOKEN — make the doc_id keep "RN @ HCA · Houston" and "RN @ HCA · Dallas"
# distinct (region is country-level, so without this they collide & overwrite).
# Normalized to "city, st" so the SAME posting re-harvested stays stable.
# ─────────────────────────────────────────────────────────────────────────────
def city_token(location, region):
    loc = (location or "").strip()
    if not loc:
        return ""
    low = loc.lower()
    if low in ("remote", "anywhere"):
        return "remote"
    # national/region-level strings carry no city distinction
    if low == (region or "").strip().lower():
        return ""
    # strip trailing zip/postal codes
    s = _re.sub(r"\b\d{4,6}(?:-\d{4})?\b", "", loc).strip(" ,")
    parts = [p.strip() for p in s.split(",") if p.strip()]
    if not parts:
        return ""
    city = parts[0]
    state = parts[1] if len(parts) > 1 else ""
    # 2-letter state/province only (drop country names like "US"/"PL"? keep ST)
    tok = (city + ((", " + state) if state else "")).lower()
    tok = _re.sub(r"\s+", " ", tok).strip()
    return tok


def doc_id(title, company, region, location=""):
    ctok = city_token(location, region)
    basis = "{}-{}-{}-{}".format(
        (title or "").strip().lower(),
        (company or "").strip().lower(),
        (region or "").strip().lower(),
        ctok,
    )
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()


# ─────────────────────────────────────────────────────────────────────────────
# SALARY — currency-anchored, K-inheritance, hourly, EU dot-thousands.
# Operates on cleaned text. Returns (min, max, currency_symbol, hr_lo, hr_hi).
# ─────────────────────────────────────────────────────────────────────────────
_CURRENCY = {
    "$": "$", "£": "£", "€": "€", "₹": "₹", "¥": "¥",
    "usd": "$", "gbp": "£", "eur": "€", "cad": "C$", "aud": "A$",
    "inr": "₹", "mxn": "$", "brl": "R$", "jpy": "¥",
}
_CUR = r"(?:\$|£|€|₹|¥|R\$|C\$|A\$)"


def _detect_currency(text):
    for sym in ("£", "€", "₹", "R$", "C$", "A$", "¥", "$"):
        if sym in text:
            return sym
    low = text.lower()
    for code, sym in _CURRENCY.items():
        if len(code) == 3 and _re.search(r"\b" + code + r"\b", low):
            return sym
    return "$"


def parse_salary(row):
    """Numeric annual {min,max} from JobSpy's STRUCTURED salary fields."""
    def to_num(v):
        if v is None:
            return 0
        try:
            if isinstance(v, float) and v != v:
                return 0
            return int(round(float(v)))
        except (TypeError, ValueError):
            return 0
    lo = to_num(row.get("min_amount"))
    hi = to_num(row.get("max_amount"))
    interval = safe_str(row.get("interval")).lower()
    is_hourly = interval in ("hourly", "hour")
    hr_lo = hr_hi = 0
    if is_hourly:
        hr_lo, hr_hi = lo, hi
        lo *= 2080
        hi *= 2080
    if lo and hi and lo > hi:
        lo, hi = hi, lo
        hr_lo, hr_hi = hr_hi, hr_lo
    return lo, hi, is_hourly, hr_lo, hr_hi


def extract_salary_from_text(text):
    """When JobSpy's structured salary is empty, mine it from the prose —
    handles '$85-$100k/year', '$85K/yr - $100K/yr', '$77,000 - $120,000 a year',
    '€45.000 - €55.000', '$22 per hour', '$18.50 - $22.00/hr'."""
    if not text:
        return 0, 0, "$", 0, 0
    t = clean_md(text)
    cur = _detect_currency(t)
    low = t.lower()
    hourly_ctx = bool(_re.search(r"(/\s*h(?:r|our)?\b|per\s+hour|an\s+hour|hourly)", low))

    # normalize EU dot-thousands (€45.000 -> €45000), strip commas, drop unit noise
    scan = _re.sub(r"(\d)\.(\d{3})(?!\d)", r"\1\2", t)
    scan = scan.replace(",", "")
    scan = _re.sub(r"(?i)\b(per\s+year|per\s+annum|a\s+year|annually|p\.?a\.?)\b", " ", scan)
    scan = _re.sub(r"(?i)\b(per\s+hour|an\s+hour|hourly)\b", " ", scan)
    scan = _re.sub(r"(?i)/\s*(yr|year|hr|hour|h)\b", " ", scan)

    def _annualize(lo, hi, lok, hik):
        if lok:
            lo *= 1000
        if hik:
            hi *= 1000
        # K-inheritance: "$85-$100k" -> both in thousands
        if hik and not lok and lo < 1000:
            lo *= 1000
        if lok and not hik and 0 < hi < 1000:
            hi *= 1000
        return lo, hi

    # currency-anchored RANGE
    rng = _re.search(
        _CUR + r"\s*(\d{1,7}(?:\.\d+)?)\s*([kK])?\s*(?:-|–|—|to)\s*" + _CUR + r"?\s*(\d{1,7}(?:\.\d+)?)\s*([kK])?",
        scan, _re.I)
    if rng:
        lo = float(rng.group(1)); hi = float(rng.group(3))
        lok = bool(rng.group(2)); hik = bool(rng.group(4))
        if hourly_ctx and lo < 1000 and hi < 1000:
            rlo, rhi = lo, hi
            alo, ahi = int(lo * 2080), int(hi * 2080)
            if alo > ahi:
                alo, ahi, rlo, rhi = ahi, alo, rhi, rlo
            if 6000 <= alo <= 3000000:
                return alo, ahi, cur, rlo, rhi
        lo, hi = _annualize(lo, hi, lok, hik)
        lo, hi = int(lo), int(hi)
        if lo > hi:
            lo, hi = hi, lo
        if 8000 <= lo <= 3000000 and hi >= lo:
            return lo, hi, cur, 0, 0

    # currency-anchored SINGLE
    one = _re.search(_CUR + r"\s*(\d{1,7}(?:\.\d+)?)\s*([kK])?", scan, _re.I)
    if one:
        v = float(one.group(1)); k = bool(one.group(2))
        if hourly_ctx and v < 1000:
            av = int(v * 2080)
            if 6000 <= av <= 3000000:
                return av, av, cur, v, v
        if k:
            v *= 1000
        v = int(v)
        if 8000 <= v <= 3000000 and (k or v >= 8000) and _re.search(r"salary|compensation|pay|wage|/yr|per year|annually|a year", low):
            return v, v, cur, 0, 0
        if 8000 <= v <= 3000000 and k:
            return v, v, cur, 0, 0
    return 0, 0, "$", 0, 0


# ─────────────────────────────────────────────────────────────────────────────
# SECTION EXTRACTION — responsibilities / requirements / benefits.
# Built to catch real LinkedIn/Indeed sections, not the "About us" blurb.
# ─────────────────────────────────────────────────────────────────────────────
_RESP_HEADER = _re.compile(
    r"(?im)^\s*(?:•\s*)?(job responsibilities|responsibilities|what you(?:'| a)?ll do|"
    r"key responsibilities|duties|the role|role overview|day[- ]to[- ]day|"
    r"essential functions|what you will do)\b[:\s]*")
_REQ_HEADER = _re.compile(
    r"(?im)^\s*(?:•\s*)?(requirements added by the job poster|requirements?|"
    r"required qualifications?|minimum qualifications?|basic qualifications?|"
    r"qualifications?|what you(?:'| a)?ll need|what you bring|required skills?|"
    r"skills? (?:&|and) experience|who you are|the ideal candidate|"
    r"experience required|must[- ]haves?)\b[:\s]*")
_BENE_HEADER = _re.compile(
    r"(?im)^\s*(?:•\s*)?(featured benefits|benefits?(?: and perks)?|perks?(?: and benefits)?|"
    r"what we offer|compensation (?:&|and) benefits|our benefits)\b[:\s]*")
_NEXT_SECTION = _re.compile(
    r"(?im)^\s*(?:•\s*)?(about (?:us|the company|the team|our)|featured benefits|benefits?|perks?|"
    r"requirements?|qualifications?|responsibilities|duties|what we offer|"
    r"how to apply|to apply|equal opportunity|why join|our culture|"
    r"compensation|pay range|salary range|set alert|job description)\b")


def _grab(header_rx, text, limit=900):
    m = header_rx.search(text)
    if not m:
        return ""
    rest = text[m.end():]
    nxt = _NEXT_SECTION.search(rest)
    block = (rest[:nxt.start()] if nxt else rest).strip(" :*#->\n\t")
    block = _re.sub(r"\n{3,}", "\n\n", block).strip()
    return block[:limit]


def extract_benefits(text):
    if not text:
        return ""
    t = clean_md(text)
    b = _grab(_BENE_HEADER, t, 500)
    if len(b) >= 6:
        return b
    # inline common-benefit sniff
    hits = []
    for kw in ("medical insurance", "health insurance", "dental insurance",
               "vision insurance", "401(k)", "401k", "paid time off", "pto",
               "life insurance", "remote work", "flexible schedule", "tuition"):
        if _re.search(_re.escape(kw), t, _re.I):
            hits.append(kw)
    if len(hits) >= 2:
        # de-dupe + tidy
        seen, out = set(), []
        for h in hits:
            key = h.lower().replace("401k", "401(k)")
            if key in seen:
                continue
            seen.add(key); out.append(key.title().replace("401(K)", "401(k)").replace("Pto", "PTO"))
        return ", ".join(out)
    return ""


def extract_requirements(description):
    """Responsibilities + Requirements, from the real sections. Falls back to a
    duties sentence ('... is responsible for ...') so prose-only postings (like
    the UTHealth 'About us' example) still surface the actual job, not boilerplate."""
    if not description:
        return ""
    text = clean_md(description)
    parts = []
    resp = _grab(_RESP_HEADER, text)
    if len(resp) >= 20:
        parts.append("What you'll do:\n" + resp[:700])
    req = _grab(_REQ_HEADER, text)
    if len(req) >= 20:
        parts.append("What you need:\n" + req[:700])
    if parts:
        return ("\n\n".join(parts))[:1400]

    # fallback A: a "responsible for ..." duties sentence (UTHealth-style prose)
    duty = _re.search(r"(?is)\b(?:will be |is |are )?responsible for\b(.{30,500}?)(?:\.\s|\n|$)", text)
    if duty:
        d = _re.sub(r"\s+", " ", duty.group(1)).strip(" ,;")
        if len(d) >= 25:
            return ("Responsible for " + d + ".")[:900]

    # fallback B: a bulleted list with no recognizable header
    bullets = _re.findall(r"(?m)^\s*•\s+(.{8,200})", text)
    if len(bullets) >= 3:
        return ("• " + "\n• ".join(b.strip() for b in bullets[:12]))[:1200]
    return ""


def normalize_row(row, region, source_hint):
    title = safe_str(row.get("title"))
    company = safe_str(row.get("company"))
    location = safe_str(row.get("location")) or region
    url = safe_str(row.get("job_url_direct")) or safe_str(row.get("job_url"))
    source = safe_str(row.get("site")) or source_hint or "jobspy"
    if not title or not url:
        return None

    smin, smax, is_hourly, hr_lo, hr_hi = parse_salary(row)
    raw_desc = safe_str(row.get("description"))
    full_desc = clean_md(raw_desc)            # cleaned ONCE, reused everywhere
    description = full_desc[:2000]
    requirements = extract_requirements(raw_desc)
    benefits = extract_benefits(raw_desc)

    cur_code = safe_str(row.get("currency")).lower()
    region_cur = {"United Kingdom": "£", "Germany": "€", "France": "€", "Italy": "€",
                  "Spain": "€", "Netherlands": "€", "Canada": "C$", "Mexico": "$",
                  "Brazil": "R$", "India": "₹", "Australia": "A$", "Japan": "¥"}.get(region, "$")
    currency = _CURRENCY.get(cur_code, region_cur if cur_code == "" else "$")

    # FALLBACK: structured salary empty -> mine the cleaned prose
    if not smin and not smax:
        smin, smax, cur_from_text, p_hr_lo, p_hr_hi = extract_salary_from_text(full_desc)
        if smin or smax:
            currency = cur_from_text or currency
            if p_hr_lo or p_hr_hi:
                is_hourly = True
                hr_lo, hr_hi = p_hr_lo, p_hr_hi

    date_posted = safe_str(row.get("date_posted")) or safe_str(row.get("date"))
    job_type = safe_str(row.get("job_type")).lower()
    remote_flag = row.get("is_remote")
    is_remote_job = bool(remote_flag) if remote_flag is not None else ("remote" in (location or "").lower())
    job_level = safe_str(row.get("job_level")).lower()

    work_setting = ""
    ws_m = _re.search(r"(?i)\b(in[- ]person|on[- ]site|on site|hybrid|remote)\b", full_desc[:400])
    if ws_m:
        raw_ws = ws_m.group(1).lower().replace("-", " ")
        work_setting = {"in person": "On-site", "on site": "On-site", "hybrid": "Hybrid", "remote": "Remote"}.get(raw_ws, "")
    if not work_setting and is_remote_job:
        work_setting = "Remote"

    def _fmt(n, useK):
        return "{:,}K".format(n // 1000) if useK else "{:,}".format(n)

    def _hr(n):
        if isinstance(n, float) and n != int(n):
            return "{:.2f}".format(n)
        return "{}".format(int(n))

    if is_hourly and (hr_lo or hr_hi):
        if hr_lo and hr_hi and hr_lo != hr_hi:
            salary_display = "{}{}–{}{} / hr".format(currency, _hr(hr_lo), currency, _hr(hr_hi))
        else:
            salary_display = "{}{} / hr".format(currency, _hr(hr_lo or hr_hi))
    elif smin and smax:
        useK = (smin >= 100000 or smax >= 100000)
        if smin == smax:
            salary_display = "{}{} / yr".format(currency, _fmt(smin, useK))
        else:
            salary_display = "{}{} – {}{} / yr".format(currency, _fmt(smin, useK), currency, _fmt(smax, useK))
    elif smin:
        salary_display = "{}{}+ / yr".format(currency, _fmt(smin, smin >= 100000))
    elif smax:
        salary_display = "Up to {}{} / yr".format(currency, _fmt(smax, smax >= 100000))
    else:
        salary_display = ""

    return {
        "title": title,
        "company": company,
        "location": location,
        "direct_apply_url": url,
        "source": source,
        "region": region,
        "salary_min": smin if smin else None,
        "salary_max": smax if smax else None,
        "salary": salary_display,
        "currency": currency,
        "is_hourly": is_hourly,
        "description": description,
        "requirements": requirements,
        "benefits": benefits,            # NEW: surfaced in the collapsible card section
        "date_posted": date_posted,
        "job_type": job_type,
        "is_remote": is_remote_job,
        "work_setting": work_setting,
        "job_level": job_level,
    }


# ─────────────────────────────────────────────────────────────────────────────
# HARVEST + PRUNE (orchestration unchanged except doc_id + STACKING_MODE)
# ─────────────────────────────────────────────────────────────────────────────
def init_firestore():
    import firebase_admin
    from firebase_admin import credentials, firestore
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not raw:
        print("ERROR: FIREBASE_SERVICE_ACCOUNT not set", file=sys.stderr)
        sys.exit(1)
    try:
        cred_dict = json.loads(raw)
    except json.JSONDecodeError as e:
        print("ERROR: FIREBASE_SERVICE_ACCOUNT is not valid JSON:", e, file=sys.stderr)
        sys.exit(1)
    cred = credentials.Certificate(cred_dict)
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)
    return firestore.client()


def harvest_one(db, country, region, location, role):
    from firebase_admin import firestore
    from jobspy import scrape_jobs
    is_remote = (str(location).strip().lower() == "remote")
    real_loc = region if is_remote else location
    is_city = ("," in str(location)) and not is_remote
    radius_mi = int(os.environ.get("METRO_RADIUS_MI", "50"))
    scrape_kwargs = dict(
        site_name=SITES, search_term=role, location=real_loc, is_remote=is_remote,
        results_wanted=RESULTS_PER_QUERY, country_indeed=(country or "usa").strip().lower(),
        linkedin_fetch_description=True, description_format="markdown",
    )
    if is_city:
        scrape_kwargs["distance"] = radius_mi
    try:
        df = scrape_jobs(**scrape_kwargs)
    except Exception as e:
        print("scrape failed [{} / {}]: {}".format(role, location, e), file=sys.stderr)
        return 0
    if df is None or len(df) == 0:
        return 0
    records = df.to_dict("records")
    batch = db.batch()
    col = db.collection(COLLECTION)
    written = 0
    seen = set()
    for row in records:
        rec = normalize_row(row, region, "jobspy")
        if not rec:
            continue
        did = doc_id(rec["title"], rec["company"], rec["region"], rec["location"])
        if did in seen:
            continue
        seen.add(did)
        rec["ingestedAt"] = firestore.SERVER_TIMESTAMP
        rec["active"] = True
        batch.set(col.document(did), rec, merge=True)
        written += 1
        if written % 450 == 0:
            batch.commit(); batch = db.batch()
    if written % 450 != 0:
        batch.commit()
    return written


def prune_stale_jobs(db, max_delete, stale_days):
    from google.cloud import firestore as _fs
    col = db.collection("jobs")
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=stale_days)
    removed = 0
    try:
        q = col.order_by("ingestedAt", direction=_fs.Query.ASCENDING).limit(max_delete)
        docs = list(q.stream())
        batch = db.batch(); pending = 0
        for d in docs:
            data = d.to_dict() or {}
            ing = data.get("ingestedAt")
            try:
                ing_dt = ing if isinstance(ing, datetime.datetime) else ing.replace(tzinfo=None)
            except Exception:
                continue
            if ing_dt and ing_dt < cutoff:
                batch.delete(d.reference); removed += 1; pending += 1
                if pending % 450 == 0:
                    batch.commit(); batch = db.batch()
        if pending % 450 != 0:
            batch.commit()
    except Exception as e:
        print("prune skipped (index/permission?):", e, file=sys.stderr)
    return removed


US_METROS = [
    "Houston, TX", "Dallas, TX", "Austin, TX", "San Antonio, TX",
    "New York, NY", "Los Angeles, CA", "Chicago, IL", "Phoenix, AZ",
    "Philadelphia, PA", "Atlanta, GA", "Miami, FL", "Seattle, WA",
    "Denver, CO", "Boston, MA", "Charlotte, NC", "Detroit, MI",
    "Minneapolis, MN", "Portland, OR", "Las Vegas, NV", "Nashville, TN",
]
US_METROS_PER_RUN = int(os.environ.get("US_METROS_PER_RUN", "4"))


def main():
    if "--selftest" in sys.argv:
        return run_selftest()

    db = init_firestore()
    total = 0
    # STACKING MODE: set STACKING_MODE=1 in the workflow to stack hard for a few
    # days — disables pruning and lets the (workflow-provided) wide budget run.
    stacking = os.environ.get("STACKING_MODE", "0") == "1"
    slice_size = int(os.environ.get("TARGETS_PER_RUN", "20" if stacking else "6"))
    max_scrapes = int(os.environ.get("MAX_SCRAPES_PER_RUN", "2000" if stacking else "240"))
    budget_secs = int(os.environ.get("RUN_BUDGET_SECS", "20400" if stacking else "3120"))
    start_ts = datetime.datetime.utcnow()
    day_index = datetime.datetime.utcnow().timetuple().tm_yday

    cycle_day = (day_index % 7) + 1
    is_verify_day = (cycle_day == 7) and not stacking
    if is_verify_day:
        budget_secs = int(budget_secs * 0.5)
        print("=== DAY 7 (verify day): reduced harvest + stale-job prune ===")
    if stacking:
        print("=== STACKING MODE: pruning OFF, wide budget ({}s), all targets ===".format(budget_secs))

    us_targets = [t for t in TARGETS if t["country"] == "usa"]
    intl_targets = [t for t in TARGETS if t["country"] != "usa"]

    roles_per_run = int(os.environ.get("US_ROLES_PER_RUN", str(len(US_ROLE_LIBRARY)) if stacking else "8"))
    lib = US_ROLE_LIBRARY
    r_total = max(1, len(lib))
    if stacking:
        todays_us_roles = list(lib)
    else:
        # ROLE BALANCE: the library is grouped by category, so a contiguous window
        # used to land on an all-service day (e.g. cook/barista/cashier) and leave
        # white-collar users with nothing to match. Instead we (1) ALWAYS include a
        # core of broad professional buckets, then (2) fill the rest by striding
        # ACROSS the whole library so every run still rotates full coverage.
        core = ["sales", "marketing", "operations", "customer service"]
        core = [r for r in core if r in lib][:max(0, roles_per_run - 3)]
        todays_us_roles = list(core)
        seen = set(core)
        stride = max(1, r_total // max(1, roles_per_run))
        offset = day_index % r_total
        i = 0
        while len(todays_us_roles) < min(roles_per_run, r_total) and i < r_total * 3:
            role = lib[(offset + i * stride) % r_total]
            if role not in seen:
                seen.add(role); todays_us_roles.append(role)
            i += 1
        j = 0
        while len(todays_us_roles) < min(roles_per_run, r_total) and j < r_total:
            if lib[j] not in seen:
                seen.add(lib[j]); todays_us_roles.append(lib[j])
            j += 1
    us_targets = [dict(t, roles=todays_us_roles) for t in us_targets]
    print("US roles this run: {}".format(", ".join(todays_us_roles)))

    m_total = max(1, len(US_METROS))
    metros_per_run = len(US_METROS) if stacking else US_METROS_PER_RUN
    m_start = (day_index * metros_per_run) % m_total
    todays_metros = [m for m in (US_METROS + US_METROS)[m_start:m_start + metros_per_run] if m != "Houston, TX"]
    METRO_ROLES = [r.strip() for r in os.environ.get(
        "METRO_ROLES", ",".join(US_ROLE_LIBRARY) if stacking else
        "operations,sales,retail,registered nurse,administrative").split(",") if r.strip()]
    metro_target = {"country": "usa", "region": "United States", "locations": todays_metros, "roles": METRO_ROLES} if todays_metros else None

    start = (day_index * slice_size) % max(1, len(intl_targets))
    rotated_intl = intl_targets if stacking else (intl_targets + intl_targets)[start:start + slice_size]
    todays = us_targets + ([metro_target] if metro_target else []) + rotated_intl
    print("US metros this run: {}".format(", ".join(todays_metros) or "(base only)"))

    scrapes = 0; stopped = False
    for t in todays:
        if stopped:
            break
        for loc in t["locations"]:
            if stopped:
                break
            for role in t["roles"]:
                elapsed = (datetime.datetime.utcnow() - start_ts).total_seconds()
                if elapsed > budget_secs or scrapes >= max_scrapes:
                    print("HARVEST BUDGET REACHED — stopping cleanly (elapsed {:.0f}s, scrapes {})".format(elapsed, scrapes))
                    stopped = True; break
                n = harvest_one(db, t["country"], t["region"], loc, role)
                scrapes += 1
                print("harvested {:>3}  {} | {} | {}".format(n, t["region"], loc, role))
                total += n

    removed = 0
    if is_verify_day:
        max_delete = int(os.environ.get("MAX_PRUNE_PER_RUN", "10000"))
        stale_days = int(os.environ.get("STALE_DAYS", "8"))
        print("PRUNING stale jobs older than {} days (cap {})…".format(stale_days, max_delete))
        removed = prune_stale_jobs(db, max_delete, stale_days)
        print("PRUNED {} stale jobs".format(removed))

    print("DONE. stacking={} cycle_day={} verify={} scrapes={} upserts={} pruned={}".format(
        stacking, cycle_day, is_verify_day, scrapes, total, removed))


# ─────────────────────────────────────────────────────────────────────────────
# SELF-TEST — runs offline against REAL posting text from the app screenshots.
# ─────────────────────────────────────────────────────────────────────────────
def run_selftest():
    fails = []

    def check(name, cond, got=""):
        print(("  PASS " if cond else "  FAIL ") + name + (("  -> " + str(got)) if (got != "" and not cond) else ""))
        if not cond:
            fails.append(name)

    # 1) Taylor Ryan (real LinkedIn text, markdown-escaped exactly as JobSpy returns it)
    taylor = (
        "**Position: Marketing Manager \\- Commercial Real Estate**\n\n"
        "**Location: The Woodlands, TX**\n\n"
        "**Salary: $85\\-$100k/year**\n\n"
        "**Job Description**\n\n"
        "The Real Estate Company, is looking for an experienced Marketing Manager to "
        "become part of our commercial real estate team. The Marketing Manager is "
        "responsible for developing and executing marketing strategies to promote "
        "commercial properties, attract tenants and buyers.\n\n"
        "**Featured benefits**\n\n"
        "Medical insurance, Vision insurance, Dental insurance, 401(k)\n\n"
        "**Requirements added by the job poster**\n\n"
        "* Bachelor's Degree\n"
        "* 9+ years of work experience with Google Ads\n"
        "* 10+ years of experience in Marketing\n"
        "* 10+ years of work experience with Adobe InDesign\n"
        "* 10+ years of work experience with Google Analytics\n")
    smin, smax, cur, _, _ = extract_salary_from_text(taylor)
    check("taylor salary min=85000", smin == 85000, smin)
    check("taylor salary max=100000", smax == 100000, smax)
    check("taylor currency=$", cur == "$", cur)
    cleaned = clean_md(taylor)
    check("taylor no leftover backslash-escapes", "\\-" not in cleaned and "\\$" not in cleaned)
    check("taylor no leftover bold markers", "**" not in cleaned)
    bens = extract_benefits(taylor)
    check("taylor benefits found 401(k)", "401(k)" in bens, bens)
    reqs = extract_requirements(taylor)
    check("taylor requirements has Bachelor's", "Bachelor" in reqs, reqs[:80])
    check("taylor requirements NOT the about-us blurb", "looking for an experienced" not in reqs)

    # 2) UTHealth "About us" prose (no headers) — must surface duties, not boilerplate
    uth = ("**About us** The Houston Group is seeking a full\\-time Office Manager to provide "
           "administrative support to our team of real estate professionals. The Office Manager "
           "will be responsible for managing appointments, greeting clients, answering phones, "
           "preparing comprehensive marketing packages, ordering supplies and maintaining files.")
    ureq = extract_requirements(uth)
    check("uthealth surfaces duties (managing appointments)", "managing appointments" in ureq, ureq[:80])

    # 3) Indeed Tomball PM — clean range with commas + 'a year'
    ind = "$77,000 - $120,000 a year Health insurance, 401(k) matching, Paid time off Full-time Tomball, TX 77377"
    s2min, s2max, _, _, _ = extract_salary_from_text(ind)
    check("indeed range 77000", s2min == 77000, s2min)
    check("indeed range 120000", s2max == 120000, s2max)

    # 4) LinkedIn card chip style "$85K/yr - $100K/yr"
    chip = "Compensation: $85K/yr - $100K/yr On-site Full-time"
    c1, c2, _, _, _ = extract_salary_from_text(chip)
    check("chip range 85000", c1 == 85000, c1)
    check("chip range 100000", c2 == 100000, c2)

    # 5) Hourly range
    hourly = "Pay: $18.50 - $22.00 per hour"
    h1, h2, _, hr1, hr2 = extract_salary_from_text(hourly)
    check("hourly annualized min", h1 == int(18.5 * 2080), h1)
    check("hourly keeps hr rate 18.5", abs(hr1 - 18.5) < 0.01, hr1)

    # 6) European dot-thousands
    eu = "Salaire: €45.000 - €55.000 par an"
    e1, e2, ecur, _, _ = extract_salary_from_text(eu)
    check("eu min 45000", e1 == 45000, e1)
    check("eu max 55000", e2 == 55000, e2)
    check("eu currency €", ecur == "€", ecur)

    # 7) doc_id keeps cities distinct, collapses national/region duplicates
    d_h = doc_id("Registered Nurse", "HCA", "United States", "Houston, TX 77002")
    d_d = doc_id("Registered Nurse", "HCA", "United States", "Dallas, TX")
    d_nat1 = doc_id("Registered Nurse", "HCA", "United States", "United States")
    d_nat2 = doc_id("Registered Nurse", "HCA", "United States", "")
    check("doc_id Houston != Dallas (no collision)", d_h != d_d)
    check("doc_id national stable regardless of blank/region", d_nat1 == d_nat2)
    check("doc_id Houston re-harvest stable (zip ignored)",
          doc_id("Registered Nurse", "HCA", "United States", "Houston, TX") == d_h)

    # 8) no-salary posting stays empty (no false positives from "9+ years - 10+ years")
    nopay = "Requirements: 9+ years with Google Ads, 10+ years in Marketing. Great team!"
    n1, n2, _, _, _ = extract_salary_from_text(nopay)
    check("no false salary from years range", n1 == 0 and n2 == 0, (n1, n2))

    print("\nSELF-TEST: {} checks, {} failed".format("all" if not fails else "", len(fails)))
    if fails:
        print("FAILED:", ", ".join(fails))
        sys.exit(1)
    print("ALL PARSER SELF-TESTS PASSED ✓")


if __name__ == "__main__":
    main()
