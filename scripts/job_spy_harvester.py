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
    r"(?im)^[\s>*#-]*\b("
    r"requirements?|qualifications?|required skills?|required qualifications?|"
    r"what you(?:'| a)?ll need|what we(?:'| a)?re looking for|who you are|"
    r"minimum qualifications?|basic qualifications?|skills? (?:&|and) experience|"
    r"must[- ]haves?|you have|your profile|experience required"
    r")\b[:\s]*$"
)
# headers that usually END the requirements block (next section)
_REQ_END = _re.compile(
    r"(?im)^[\s>*#-]*\b("
    r"responsibilities|benefits?|perks?|what we offer|about (?:us|the|our)|"
    r"compensation|salary|how to apply|equal opportunity|why join|nice[- ]to[- ]haves?|"
    r"preferred qualifications?|duties|day[- ]to[- ]day|the role|overview"
    r")\b"
)


def extract_requirements(description):
    """Pull a requirements/qualifications block out of the description markdown.
    JobSpy provides no dedicated requirements field — it's embedded in the text.
    Returns a trimmed string (bullets/lines) or '' if no clear section is found."""
    if not description:
        return ""
    lines = description.split("\n")
    out, capturing = [], False
    for ln in lines:
        if not capturing:
            if _REQ_HEADERS.search(ln):
                capturing = True
            continue
        # we're inside the block — stop at the next major section header
        if _REQ_END.search(ln) or _REQ_HEADERS.search(ln):
            break
        out.append(ln)
        # cap the block so a runaway description doesn't fill it
        if len("\n".join(out)) > 1200:
            break
    text = "\n".join(out).strip()
    # tidy: collapse blank runs, strip leading/trailing empties
    text = _re.sub(r"\n{3,}", "\n\n", text).strip()
    return text[:1200]


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
