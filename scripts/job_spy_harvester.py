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


def normalize_row(row, region, source_hint):
    title = safe_str(row.get("title"))
    company = safe_str(row.get("company"))
    location = safe_str(row.get("location")) or region
    url = safe_str(row.get("job_url_direct")) or safe_str(row.get("job_url"))
    source = safe_str(row.get("site")) or source_hint or "jobspy"
    if not title or not url:
        return None
    smin, smax = parse_salary(row)
    description = safe_str(row.get("description"))[:2000]

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
    }


def harvest_one(db, country, region, location, role):
    # JobSpy breaks when location is literally "Remote" — Indeed tries to geocode
    # it and guesses random invalid countries (fiji, cambodia, etc.). The correct
    # way is the is_remote flag with a real country location string.
    is_remote = (str(location).strip().lower() == "remote")
    real_loc = region if is_remote else location
    try:
        df = scrape_jobs(
            site_name=SITES,
            search_term=role,
            location=real_loc,
            is_remote=is_remote,
            results_wanted=RESULTS_PER_QUERY,
            country_indeed=(country or "usa").strip().lower(),
            linkedin_fetch_description=True,
            description_format="markdown",
        )
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
    start = (day_index * slice_size) % max(1, len(intl_targets))
    rotated_intl = (intl_targets + intl_targets)[start:start + slice_size]
    todays = us_targets + rotated_intl
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
