#!/usr/bin/env python3
"""
scripts/job_spy_harvester.py

Free job ingestion via python-jobspy -> Firestore.
Normalizes to the GhostProofJob schema:
    title, company, location, direct_apply_url, source, region
Deterministic doc IDs (sha1 of title-company-region) make .set(merge=True)
idempotent so re-runs never duplicate cards.

Env:
    FIREBASE_SERVICE_ACCOUNT  - JSON string of the service account credentials
"""

import os
import sys
import json
import hashlib
import datetime

import firebase_admin
from firebase_admin import credentials, firestore

try:
    from jobspy import scrape_jobs
except ImportError:
    from python_jobspy import scrape_jobs  # fallback import name

COLLECTION = "jobs"
RESULTS_PER_QUERY = 100
# ZipRecruiter removed: it consistently returns 403 (Cloudflare bot-block) and
# wastes ~2 min per attempt failing, burning harvest budget for zero results.
# LinkedIn + Indeed return reliably. Re-add "zip_recruiter" only if they relax it.
SITES = ["linkedin", "indeed"]

# country -> (region label, [locations], [roles])
TARGETS = [
    # 🇺🇸 NORTH AMERICA (US, CA, MX)
    {"country": "usa", "region": "United States", "locations": ["United States", "Houston, TX", "Remote"], "roles": ["operations", "sales", "retail", "hospitality", "trades", "marketing", "data entry", "executive", "engineering", "healthcare", "administrative", "customer service", "finance", "internship"]},
    {"country": "canada", "region": "Canada", "locations": ["Canada"], "roles": ["operations", "sales", "retail", "trades", "internship", "data entry"]},
    {"country": "mexico", "region": "Mexico", "locations": ["Mexico"], "roles": ["operaciones", "ventas", "retail", "practicante"]},

    # 🇬🇧/🇪🇺 EUROPE & UK (GB, DE, FR, IT, ES, NL, BE, AT, PL, CH)
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

    # 🇦🇺/🇳🇿 OCEANIA (AU, NZ)
    {"country": "australia", "region": "Australia", "locations": ["Australia"], "roles": ["operations", "sales", "retail", "trades", "internship", "hospitality"]},
    {"country": "new zealand", "region": "New Zealand", "locations": ["New Zealand"], "roles": ["operations", "sales", "retail", "trades"]},

    # 🌏 ASIA (IN, SG)
    {"country": "india", "region": "India", "locations": ["India"], "roles": ["operations", "sales", "marketing", "data entry", "internship", "tech"]},
    {"country": "singapore", "region": "Singapore", "locations": ["Singapore"], "roles": ["operations", "sales", "retail", "internship"]},

    # 🇿🇦/🇧🇷 AFRICA & SOUTH AMERICA (ZA, BR)
    {"country": "south africa", "region": "South Africa", "locations": ["South Africa"], "roles": ["operations", "sales", "retail", "trades", "internship"]},
    {"country": "brazil", "region": "Brazil", "locations": ["Brasil"], "roles": ["operacoes", "vendas", "retail", "estagio"]}
]


def init_firestore():
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


def doc_id(title, company, region):
    basis = "{}-{}-{}".format(
        (title or "").strip().lower(),
        (company or "").strip().lower(),
        (region or "").strip().lower(),
    )
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()


def safe_str(v):
    if v is None:
        return ""
    try:
        # pandas NaN guard
        if isinstance(v, float) and v != v:
            return ""
    except Exception:
        pass
    return str(v).strip()


def parse_salary(row):
    """Normalize JobSpy salary fields into numeric annual (salary_min, salary_max)."""
    def to_num(v):
        if v is None:
            return 0
        try:
            if isinstance(v, float) and v != v:  # NaN
                return 0
            n = float(v)
        except (TypeError, ValueError):
            return 0
        return int(round(n))
    lo = to_num(row.get("min_amount"))
    hi = to_num(row.get("max_amount"))
    interval = safe_str(row.get("interval")).lower()
    if interval in ("hourly", "hour"):
        lo = lo * 2080
        hi = hi * 2080
    if lo and hi and lo > hi:
        lo, hi = hi, lo
    return lo, hi


import re as _re

# headers that typically introduce a requirements/qualifications block in a posting
_REQ_HEADERS = _re.compile(
    r"(?im)\b("
    r"requirements?|qualifications?|required skills?|required qualifications?|"
    r"what you(?:'| a)?ll need|what we(?:'| a)?re looking for|who you are|"
    r"minimum qualifications?|basic qualifications?|skills? (?:&|and) experience|"
    r"must[- ]haves?|you have|your profile|experience required|what you bring|"
    r"job responsibilities|responsibilities|role requirements|key requirements|"
    r"about you|the ideal candidate|we(?:'| a)?re looking for|you(?:'| a)?ll bring"
    r")\b[:\s]*"
)
# headers that usually END the requirements block (next section)
_REQ_END = _re.compile(
    r"(?im)\b("
    r"benefits?|perks?|what we offer|about (?:us|the company|our)|"
    r"compensation|salary range|how to apply|equal opportunity|why join|"
    r"nice[- ]to[- ]haves?|our culture|what we provide|pay range|to apply"
    r")\b"
)
# specific section headers (responsibilities vs experience/qualifications)
_RESP_HEADER = _re.compile(
    r"(?im)\b(job responsibilities|responsibilities|what you(?:'| a)?ll do|"
    r"key responsibilities|duties|the role|role overview|day[- ]to[- ]day)\b[:\s]*"
)
_EXP_HEADER = _re.compile(
    r"(?im)\b(skills?\s*/?\s*(?:&|and)?\s*competenc(?:y|ies)|"
    r"qualifications?|required qualifications?|minimum qualifications?|"
    r"basic qualifications?|what you(?:'| a)?ll need|what you bring|"
    r"skills? (?:&|and) experience|who you are|the ideal candidate|"
    r"about you|required skills?|experience required|requirements?|experience)\b[:\s]*"
)
# any major next-section boundary, so a captured block stops cleanly
_SECTION_NEXT = _re.compile(
    r"(?im)\b(experience|qualifications?|requirements?|responsibilities|benefits?|"
    r"compensation|the compensation|what we offer|about (?:us|the company)|"
    r"equal opportunity|pay range|salary range|how to apply|to apply|our culture|"
    r"perks?|why join)\b"
)


def extract_requirements(description):
    """Pull the most decision-relevant sections (Responsibilities + Experience/
    Qualifications) out of the description. Real postings vary wildly, so we look
    for several header families, capture each block, and combine them. Returns a
    trimmed string or '' if nothing requirement-like is found."""
    if not description:
        return ""
    text = description

    def grab(header_rx):
        m = header_rx.search(text)
        if not m:
            return ""
        rest = text[m.end():]
        end_m = _REQ_END.search(rest)
        nxt = _SECTION_NEXT.search(rest)
        cut = len(rest)
        if end_m: cut = min(cut, end_m.start())
        if nxt: cut = min(cut, nxt.start())
        block = rest[:cut].strip(" :*#->\n\t")
        block = _re.sub(r"(?:^|\s)[*]\s+", "\n• ", block)
        block = _re.sub(r"(?:^|\s)[+](?=\s)\s*", "\n• ", block)
        block = _re.sub(r"\n{3,}", "\n\n", block).strip()
        return block

    parts = []
    resp = grab(_RESP_HEADER)
    if len(resp) >= 25:
        parts.append("What you'll do:\n" + resp[:700])
    exp = grab(_EXP_HEADER)
    if len(exp) >= 25:
        parts.append("What you need:\n" + exp[:700])
    if parts:
        return ("\n\n".join(parts))[:1400]

    # fallback: single requirements-style block (older logic)
    m = _REQ_HEADERS.search(text)
    if m:
        rest = text[m.end():]
        end_m = _REQ_END.search(rest)
        block = (rest[:end_m.start()] if end_m else rest).strip(" :*#->\n\t")
        block = _re.sub(r"(?:^|\s)[*]\s+", "\n• ", block)
        block = _re.sub(r"(?:^|\s)[+](?=\s)\s*", "\n• ", block)
        block = _re.sub(r"\n{3,}", "\n\n", block).strip()
        if len(block) >= 25:
            return block[:1200]
    # last resort: a bulleted list with no recognizable header
    bullets = _re.findall(r"(?:^|\n)\s*[*\-•+]\s+(.{8,200})", text)
    if len(bullets) >= 3:
        return ("• " + "\n• ".join(b.strip() for b in bullets[:12]))[:1200]
    return ""


def extract_salary_from_text(text):
    """When JobSpy's structured salary field is empty, many postings still state
    pay in the description prose (e.g. 'The compensation for this role is
    $90,000 - $110,000'). Pull a numeric range out of the text. Returns
    (min, max) annualized ints, or (0, 0) if nothing credible is found."""
    if not text:
        return 0, 0
    t = text.replace(",", "")
    # hourly range first: $45/hr - $60/hr  (annualize at 2080 h/yr)
    hr = _re.search(r"\$\s?(\d{1,3})\s?/?\s?(?:hr|hour|hourly)?\s?(?:-|–|to)\s?\$?\s?(\d{1,3})\s?/?\s?(?:hr|hour|hourly)\b", t)
    if hr:
        lo = int(hr.group(1)) * 2080; hi = int(hr.group(2)) * 2080
        if 10000 <= lo <= 2000000 and hi >= lo:
            return lo, hi
    # annual range: $90000 - $110000  |  $90K-$110K  |  $90000 to $110000
    rng = _re.search(
        r"\$\s?(\d{2,7})\s?([kK])?\s?(?:-|–|to)\s?\$?\s?(\d{2,7})\s?([kK])?",
        t)
    if rng:
        lo = int(rng.group(1)); hi = int(rng.group(3))
        if rng.group(2): lo *= 1000          # $90K
        if rng.group(4): hi *= 1000
        # sanity: ignore absurd or tiny matches (years of experience, etc.)
        if 10000 <= lo <= 2000000 and 10000 <= hi <= 5000000 and hi >= lo:
            return lo, hi
    # single value: "$95,000 per year" / "$95K annually"
    one = _re.search(r"\$\s?(\d{2,7})\s?([kK])?\s?(?:per\s+year|/?\s?yr|annually)", t)
    if one:
        v = int(one.group(1));  v *= 1000 if one.group(2) else 1
        if 10000 <= v <= 2000000:
            return v, v
    return 0, 0


def normalize_row(row, region, source_hint):
    title = safe_str(row.get("title"))
    company = safe_str(row.get("company"))
    location = safe_str(row.get("location")) or region
    url = safe_str(row.get("job_url_direct")) or safe_str(row.get("job_url"))
    source = safe_str(row.get("site")) or source_hint or "jobspy"
    if not title or not url:
        return None
    smin, smax = parse_salary(row)
    full_desc = safe_str(row.get("description"))
    description = full_desc[:2000]
    requirements = extract_requirements(full_desc)
    # FALLBACK: if JobSpy gave no structured salary, try to pull it from the prose
    # (e.g. LinkedIn often omits the salary field but states pay in the text)
    if not smin and not smax:
        smin, smax = extract_salary_from_text(full_desc)
    # capture the posting date when JobSpy provides it — powers the "Newest" sort.
    # JobSpy uses date_posted; some sources use date. Both handled.
    date_posted = safe_str(row.get("date_posted")) or safe_str(row.get("date"))
    # JOB SPECIFICS (the "On-site · Full-time" tags) — all optional, any source.
    job_type = safe_str(row.get("job_type")).lower()          # fulltime/parttime/contract/internship
    remote_flag = row.get("is_remote")
    is_remote_job = bool(remote_flag) if remote_flag is not None else ("remote" in (location or "").lower())
    job_level = safe_str(row.get("job_level")).lower()         # entry/mid/senior when present
    # WORK SETTING: prefer an explicit mention in the text, else derive from remote flag.
    work_setting = ""
    ws_m = _re.search(r"(?i)work setting[:\s]*\b(in[- ]person|on[- ]site|hybrid|remote)\b", full_desc)
    if ws_m:
        raw_ws = ws_m.group(1).lower().replace("-", " ")
        work_setting = {"in person":"On-site","on site":"On-site","hybrid":"Hybrid","remote":"Remote"}.get(raw_ws, "")
    if not work_setting and is_remote_job:
        work_setting = "Remote"

    # Build a human-readable salary string so Browse cards display it correctly.
    # Without this field the frontend shows "Salary on request" even when
    # salary_min / salary_max exist in Firestore.
    if smin and smax:
        salary_display = "${:,}K – ${:,}K / yr".format(smin // 1000, smax // 1000)
    elif smin:
        salary_display = "${:,}K+ / yr".format(smin // 1000)
    elif smax:
        salary_display = "Up to ${:,}K / yr".format(smax // 1000)
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
        "salary": salary_display,        # display string for Browse cards
        "description": description,
        "requirements": requirements,    # extracted req/qualifications block
        "date_posted": date_posted,      # source posting date (for "Newest" sort)
        "job_type": job_type,            # fulltime/parttime/contract/internship
        "is_remote": is_remote_job,      # bool
        "work_setting": work_setting,    # "Remote" or "" (display tag)
        "job_level": job_level,          # entry/mid/senior when source provides it
    }


def harvest_one(db, country, region, location, role):
    # JobSpy breaks when location is literally "Remote" — Indeed tries to geocode
    # it and guesses random invalid countries (fiji, cambodia, etc.). The correct
    # way is the is_remote flag with a real country location string.
    is_remote = (str(location).strip().lower() == "remote")
    real_loc = region if is_remote else location
    # METRO RADIUS: a city search ("Houston, TX") should cover the surrounding
    # area (Missouri City, Katy, Stafford, Sugar Land...), not just the city
    # proper. JobSpy's `distance` is in miles. Only apply it to a specific
    # city/region search — national ("United States") and remote searches don't
    # use a radius. A city is detected by the presence of a comma (e.g. "City, ST").
    is_city = ("," in str(location)) and not is_remote
    radius_mi = int(os.environ.get("METRO_RADIUS_MI", "50"))
    scrape_kwargs = dict(
        site_name=SITES,
        search_term=role,
        location=real_loc,
        is_remote=is_remote,
        results_wanted=RESULTS_PER_QUERY,
        country_indeed=(country or "usa").strip().lower(),
        linkedin_fetch_description=True,
        description_format="markdown",
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
        did = doc_id(rec["title"], rec["company"], rec["region"])
        if did in seen:
            continue
        seen.add(did)
        rec["ingestedAt"] = firestore.SERVER_TIMESTAMP
        rec["active"] = True
        batch.set(col.document(did), rec, merge=True)
        written += 1
        # Firestore batch hard limit is 500; commit early to stay safe
        if written % 450 == 0:
            batch.commit()
            batch = db.batch()
    if written % 450 != 0:
        batch.commit()
    return written


def prune_stale_jobs(db, max_delete, stale_days):
    """Day-7 cleanup: delete jobs whose ingestedAt is older than stale_days.
    Because every re-harvest refreshes a live job's ingestedAt, a job that hasn't
    been re-seen in stale_days is almost certainly filled/delisted. This is the
    reliable way to verify freshness — re-pinging each job URL is blocked by
    LinkedIn/Indeed (Cloudflare), so age-since-last-seen is the practical signal.
    Returns the number of jobs removed."""
    from google.cloud import firestore as _fs
    col = db.collection("jobs")
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=stale_days)
    removed = 0
    try:
        # oldest first so we always clear the most stale; cap the batch to max_delete
        q = col.order_by("ingestedAt", direction=_fs.Query.ASCENDING).limit(max_delete)
        docs = list(q.stream())
        batch = db.batch()
        pending = 0
        for d in docs:
            data = d.to_dict() or {}
            ing = data.get("ingestedAt")
            # ing is a Firestore timestamp; compare to cutoff (skip if missing/newer)
            try:
                ing_dt = ing if isinstance(ing, datetime.datetime) else ing.replace(tzinfo=None)
            except Exception:
                continue
            if ing_dt and ing_dt < cutoff:
                batch.delete(d.reference)
                removed += 1
                pending += 1
                if pending % 450 == 0:
                    batch.commit(); batch = db.batch()
        if pending % 450 != 0:
            batch.commit()
    except Exception as e:
        print("prune skipped (index/permission?):", e, file=sys.stderr)
    return removed


# US METROS for deep local coverage (Option A). Each is searched with a 50mi
# radius so surrounding towns are included (Houston pulls Missouri City, Katy,
# Stafford, Sugar Land, etc.). These ROTATE a few per day on top of the always-on
# national "United States" + "Houston, TX" search. The rotation is sized so the
# whole list cycles in well under STALE_DAYS (8) — every metro is re-harvested
# before its jobs could age out and be pruned, so NO location or data is lost.
US_METROS = [
    "Houston, TX", "Dallas, TX", "Austin, TX", "San Antonio, TX",
    "New York, NY", "Los Angeles, CA", "Chicago, IL", "Phoenix, AZ",
    "Philadelphia, PA", "Atlanta, GA", "Miami, FL", "Seattle, WA",
    "Denver, CO", "Boston, MA", "Charlotte, NC", "Detroit, MI",
    "Minneapolis, MN", "Portland, OR", "Las Vegas, NV", "Nashville, TN",
]
# how many metros to deep-search per run (cycles the full list in ceil(len/N) days)
US_METROS_PER_RUN = int(os.environ.get("US_METROS_PER_RUN", "5"))


def main():
    db = init_firestore()
    total = 0
    slice_size = int(os.environ.get("TARGETS_PER_RUN", "6"))
    max_scrapes = int(os.environ.get("MAX_SCRAPES_PER_RUN", "120"))
    # workflow timeout is 60 min; leave a safety margin and stop at 52 min
    budget_secs = int(os.environ.get("RUN_BUDGET_SECS", "3120"))
    start_ts = datetime.datetime.utcnow()
    day_index = datetime.datetime.utcnow().timetuple().tm_yday

    # ---- 7-DAY ROTATION ----
    # Days 1-6 of each weekly cycle: harvest-heavy, fill all markets broadly.
    # Day 7: harvest a smaller fresh batch, then spend the rest of the budget
    # PRUNING stale jobs (verify freshness) so the database stays real & current.
    cycle_day = (day_index % 7) + 1   # 1..7
    is_verify_day = (cycle_day == 7)
    if is_verify_day:
        # leave roughly half the budget for harvesting, half for pruning
        budget_secs = int(budget_secs * 0.5)
        print("=== DAY 7 (verify day): reduced harvest + stale-job prune ===")

    # PRIORITY: US-based userbase — always harvest the US FIRST every run, then
    # rotate the rest of the world a slice at a time.
    us_targets = [t for t in TARGETS if t["country"] == "usa"]
    intl_targets = [t for t in TARGETS if t["country"] != "usa"]

    # OPTION A — rotating deep metro coverage. Pick today's slice of US metros and
    # build a US target whose locations are those metros (each gets the 50mi radius
    # in harvest_one because they contain a comma). The base US target above
    # already covers national + Houston + Remote every run, so we DROP Houston from
    # the rotation slice to avoid harvesting it twice.
    m_total = max(1, len(US_METROS))
    m_start = (day_index * US_METROS_PER_RUN) % m_total
    todays_metros = [m for m in (US_METROS + US_METROS)[m_start:m_start + US_METROS_PER_RUN] if m != "Houston, TX"]
    us_roles = us_targets[0]["roles"] if us_targets else ["operations", "sales", "marketing"]
    metro_target = {"country": "usa", "region": "United States", "locations": todays_metros, "roles": us_roles} if todays_metros else None

    start = (day_index * slice_size) % max(1, len(intl_targets))
    rotated_intl = (intl_targets + intl_targets)[start:start + slice_size]
    todays = us_targets + ([metro_target] if metro_target else []) + rotated_intl
    print("US metros this run ({}-day full cycle): {}".format(
        -(-m_total // max(1, US_METROS_PER_RUN)), ", ".join(todays_metros) or "(base only)"))
    scrapes = 0
    stopped = False
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
                    stopped = True
                    break
                n = harvest_one(db, t["country"], t["region"], loc, role)
                scrapes += 1
                print("harvested {:>3}  {} | {} | {}".format(n, t["region"], loc, role))
                total += n

    removed = 0
    if is_verify_day:
        # prune up to ~10k stale jobs not re-seen in STALE_DAYS days
        max_delete = int(os.environ.get("MAX_PRUNE_PER_RUN", "10000"))
        stale_days = int(os.environ.get("STALE_DAYS", "8"))
        print("PRUNING stale jobs older than {} days (cap {})…".format(stale_days, max_delete))
        removed = prune_stale_jobs(db, max_delete, stale_days)
        print("PRUNED {} stale jobs".format(removed))

    print("DONE. cycle_day={} verify={} slice start={} scrapes={} upserts={} pruned={}".format(
        cycle_day, is_verify_day, start, scrapes, total, removed))


if __name__ == "__main__":
    main()
