[GPJ_v73_Implementation.md](https://github.com/user-attachments/files/29640983/GPJ_v73_Implementation.md)
## **GPJ v73 — Deck Fixes: Implementation & Test Guide** 

**Build:** v73 (frontend). **Full drop-in files — replace all three** (upload, don't paste): `index.html` , `GhostProofJob.html` (mirror), `sw.js` (gpj-v73). 

**Auto-verified:** JS clean · div delta 0 · mirror identical · boot harness runs to completion · markers v73. 

## **What changed (three fixes)** 

1. **Deck "Best Match" now leads with YOUR FIELD.** This is why v72 didn't change anything: the deck's FINAL sort ( `applySwipeFilters` ) re-sorted by raw match %, discarding v72's role ranking. Now that final sort leads with in-field titles (job title contains your résumé field word), then match %. Off-field roles (Operations, Pharmacy, Project Manager) fall behind your in-field roles. Falls back to pure match if there's no résumé. 

2. **Remote jobs always appear in your deck.** They were only added when local roles dropped below 8 — that's why "no remote jobs came up." Remote roles are location-agnostic, so they're now always included. This also gives the deck more to show before it dead-ends. 

3. **"View Full Posting" now records to Applied + advances.** Opening the real posting is the apply action, so it now moves the job to your Applied bucket (de-duplicated) and brings up the next card — no more applying and seeing 0 Applied. 

## **YOUR TEST CHECKLIST — v73 (live confirmation, esp. #1–#2)** 

[ ] Deploy, hard-refresh, self-test runs, desktop + sign-in OK. 

[ ] **Ordering:** reset the deck; the FIRST cards should be Marketing / in-field — Operations/Pharmacy/PM should come later. If off-field still leads, tell me the top 2–3 cards + your résumé title. 

[ ] **Remote:** confirm remote roles now appear in the deck. 

[ ] **Apply:** tap "View Full Posting" on a card → it opens the posting AND the card moves to Applied (count goes up) and the next card appears. 

[ ] **Location:** confirm the deck is still Houston + remote (not other-city on-site). 

[ ] **Huntsman:** flag "Sr. Operations Manager @ Huntsman" once more (its real title has "Sr." — earlier flags stored a different key). With v72+ it binds to the exact card, so it should now stick and not recycle. 

## **STILL OPEN** → **v74 (logged in the checklist)** 

• **B-DECK-POOL:** the deck still dead-ends at ~45 while Browse shows 925. v73 adds remote; the fuller fix is refilling/broadening (same-state) before the empty state + refreshing more often (ties to Firestore-cost work). Needs live location verification. 

• **B-SALARY-CYCLE + market hard-scope + "other regions" control** (the Saratoga NY out-of-region job lives here). 

• **F-COVERLETTER:** the letter said "the this role position" and forced "Operations" onto the role — will fix the title fill + make emphasis reflect the actual posting. 

- **B-DESC-CUT:** the "Job Re" mid-word cutoff — investigating source vs display slice. 

- **Playwright screenshots / more backend coverage** (F-TEST). 

