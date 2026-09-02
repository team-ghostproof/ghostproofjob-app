#!/usr/bin/env node
'use strict';
/**
 * scripts/build_resume_checker.mjs — the PUBLIC "Free Résumé Strength Checker".
 * ---------------------------------------------------------------------------
 * WHY: a genuinely-useful, shareable, ZERO-cost public tool page — the honest SEO
 * growth lever (unlike the thin templated city/company pages, which Google won't
 * index). It scores a pasted résumé's WRITING STRENGTH with the SAME structural
 * rubric the signed-in rater uses (api/rate/rateCore.js), entirely in the visitor's
 * browser: no Firestore reads, no AI/Worker cost, no data stored or sent anywhere.
 * The AI (role-specific matching + tailoring) stays the signed-in payoff — this
 * page is the free, honest hook that drives sign-ups.
 *
 * SINGLE SOURCE OF TRUTH: rateCore.js is INLINED here at build time, so there is
 * no divergent copy of the rubric. Re-run this after editing rateCore.js:
 *     node scripts/build_resume_checker.mjs   → writes resume-checker.html
 * The benchmark's [checker] step asserts the inlined rateCore matches the source.
 *
 * [FREE-TIER]: the output is a single STATIC .html served by Vercel — 0 Serverless
 * Functions, 0 per-visitor cost. Safe at any traffic.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const RATECORE = path.join(ROOT, 'api', 'rate', 'rateCore.js');
const OUT = path.join(ROOT, 'resume-checker.html');

const rateCoreSrc = fs.readFileSync(RATECORE, 'utf8');

/* The client UI: a lightweight parser (pasted text -> the {skills, jobs:[{b}]}
   shape rateStructure expects) + render. Kept as a plain string (no backticks)
   so it nests cleanly inside the page template below. Honest by design: it scores
   WRITING STRENGTH, and says so. */
const UI_JS = [
"(function(){",
"  var RC = window.GPJRateCore;",
"  function $(id){ return document.getElementById(id); }",
"  function parseResume(text){",
"    var lines = String(text||'').split('\\n').map(function(l){return l.trim();});",
"    var ne = lines.filter(Boolean);",
"    var email = (text.match(/[\\w.+-]+@[\\w-]+\\.[\\w.-]+/)||[])[0]||'';",
"    var name = (ne[0] && ne[0].length<60 && !/\\d/.test(ne[0]) && ne[0].split(' ').length<=5) ? ne[0] : '';",
"    var skills='';",
"    for(var i=0;i<ne.length;i++){ if(/^skills?\\b/i.test(ne[i])){ skills = (ne[i].replace(/^skills?\\s*:?\\s*/i,'')) || (ne[i+1]||''); break; } }",
"    if(!skills){ var cand = ne.find(function(l){ return l.split(/[,\\u00b7|]/).length>=4 && l.length<200; }); if(cand) skills=cand; }",
"    var summary='';",
"    for(var j=0;j<ne.length;j++){ if(/^(summary|profile|objective|about)\\b/i.test(ne[j])){ summary=(ne[j].replace(/^(summary|profile|objective|about)\\s*:?\\s*/i,''))||(ne[j+1]||''); break; } }",
"    var bullets = ne.filter(function(l){",
"      if(l===name||l===summary||l===skills) return false;",
"      if(/@/.test(l)) return false;",
"      return /^[\\u2022\\u2013\\-\\*]/.test(l) || (l.length>20 && /\\s/.test(l));",
"    });",
"    return { name:name, contact:email, summary:summary, skills:skills, jobs:[{ b: bullets.join('\\n') }] };",
"  }",
"  function ring(pct){",
"    var c = 2*Math.PI*52, off = c*(1-pct/100);",
"    var col = pct>=75?'#00F5A0':(pct>=50?'#FFB347':'#FF4D6A');",
"    return '<svg width=\"140\" height=\"140\" viewBox=\"0 0 120 120\"><circle cx=\"60\" cy=\"60\" r=\"52\" fill=\"none\" stroke=\"rgba(255,255,255,.10)\" stroke-width=\"10\"/><circle cx=\"60\" cy=\"60\" r=\"52\" fill=\"none\" stroke=\"'+col+'\" stroke-width=\"10\" stroke-linecap=\"round\" stroke-dasharray=\"'+c+'\" stroke-dashoffset=\"'+off+'\" transform=\"rotate(-90 60 60)\"/><text x=\"60\" y=\"58\" text-anchor=\"middle\" fill=\"#F0EEF8\" font-size=\"30\" font-weight=\"800\">'+pct+'</text><text x=\"60\" y=\"78\" text-anchor=\"middle\" fill=\"#9B93B8\" font-size=\"11\">/ 100</text></svg>';",
"  }",
"  /* Share loop (growth): all client-side, nothing stored, 0 functions. The shared",
"     card carries ONLY the score + brand — never résumé text or any PII. */",
"  var SHARE_URL = 'https://ghostproofjob.com/resume-checker.html?ref=share';",
"  function drawCard(pct, band){",
"    var W=1200, H=630, cv=document.createElement('canvas'); cv.width=W; cv.height=H;",
"    var x=cv.getContext('2d');",
"    x.fillStyle='#120F1D'; x.fillRect(0,0,W,H);",
"    x.strokeStyle='rgba(181,95,230,.40)'; x.lineWidth=6; x.strokeRect(16,16,W-32,H-32);",
"    x.fillStyle='#00F5A0'; x.fillRect(W/2-142, 66, 34, 34);",
"    x.textAlign='left'; x.fillStyle='#F0EEF8'; x.font='800 34px system-ui,Segoe UI,Arial';",
"    x.fillText('GhostProofJob', W/2-98, 94);",
"    var cx=340, cy=350, r=150; x.lineWidth=30; x.lineCap='round';",
"    x.beginPath(); x.arc(cx,cy,r,0,2*Math.PI); x.strokeStyle='rgba(255,255,255,.10)'; x.stroke();",
"    var col = pct>=75?'#00F5A0':(pct>=50?'#FFB347':'#FF4D6A');",
"    x.beginPath(); x.arc(cx,cy,r,-Math.PI/2, -Math.PI/2 + 2*Math.PI*(Math.max(1,pct)/100)); x.strokeStyle=col; x.stroke();",
"    x.textAlign='center'; x.fillStyle='#F0EEF8'; x.font='800 108px system-ui,Segoe UI,Arial';",
"    x.fillText(String(pct), cx, cy+22);",
"    x.fillStyle='#9B93B8'; x.font='700 30px system-ui,Segoe UI,Arial'; x.fillText('/ 100', cx, cy+72);",
"    var rx=560;",
"    x.textAlign='left'; x.fillStyle='#B55FE6'; x.font='800 24px system-ui,Segoe UI,Arial';",
"    x.fillText('RÉSUMÉ STRENGTH', rx, 268);",
"    x.fillStyle='#F0EEF8'; x.font='800 40px system-ui,Segoe UI,Arial';",
"    x.fillText(String(band||'').split('—')[0].trim(), rx, 320);",
"    x.fillStyle='#9B93B8'; x.font='400 26px system-ui,Segoe UI,Arial';",
"    x.fillText('I scored my résumé free at', rx, 388);",
"    x.fillStyle='#00F5A0'; x.font='700 30px system-ui,Segoe UI,Arial';",
"    x.fillText('ghostproofjob.com/resume-checker', rx, 430);",
"    return cv;",
"  }",
"  function downloadCard(pct, band){",
"    try{ var cv=drawCard(pct, band), url=cv.toDataURL('image/png'); var a=document.createElement('a'); a.href=url; a.download='my-resume-strength.png'; document.body.appendChild(a); a.click(); document.body.removeChild(a); }catch(e){}",
"  }",
"  function legacyCopy(t){ try{ var ta=document.createElement('textarea'); ta.value=t; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }catch(e){} }",
"  function flash(btn, msg){ if(!btn) return; var t=btn.innerHTML; btn.innerHTML=msg; setTimeout(function(){ btn.innerHTML=t; }, 1600); }",
"  function copyLink(){ var b=$('rc-copy'); if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(SHARE_URL).then(function(){ flash(b,'✓ Copied'); }, function(){ legacyCopy(SHARE_URL); flash(b,'✓ Copied'); }); } else { legacyCopy(SHARE_URL); flash(b,'✓ Copied'); } }",
"  function shareScore(pct){ if(navigator.share){ navigator.share({ title:'My Résumé Strength', text:'I scored '+pct+'/100 on my résumé strength. Check yours free:', url:SHARE_URL }).catch(function(){}); } }",
"  function run(){",
"    var text = ($('rc-input')||{}).value || '';",
"    if(text.trim().length<40){ $('rc-out').innerHTML='<p style=\"color:#9B93B8\">Paste a bit more of your résumé (at least a few lines) and try again.</p>'; $('rc-out').style.display='block'; return; }",
"    var st = RC.rateStructure(parseResume(text));",
"    var pct = st.max ? Math.round(st.pts/st.max*100) : 1;",
"    var band = pct>=75?'Strong — callback-ready writing':(pct>=50?'Decent — a few quick lifts will help':'Needs work — big, easy gains here');",
"    var items = st.items.map(function(it){ var ok=it[0]; return '<div style=\"display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid rgba(181,95,230,.14)\"><span style=\"color:'+(ok?'#00F5A0':'#6E667F')+';font-weight:800\">'+(ok?'\\u2713':'\\u25CB')+'</span><span style=\"font-size:13.5px;color:'+(ok?'#C6C0DD':'#F0EEF8')+'\">'+it[1]+'</span></div>'; }).join('');",
"    var tip = st.needsMetrics ? '<div style=\"margin-top:12px;background:rgba(0,245,160,.10);border:1px solid rgba(0,245,160,.3);border-radius:12px;padding:12px 14px;font-size:13px;color:#C6C0DD\">\\uD83D\\uDCA1 Your biggest lever: <b style=\"color:#00F5A0\">add real numbers</b> to more bullets. \"Managed accounts\" \\u2192 \"Managed 100 accounts, grew retention 20%\". Recruiters reward outcomes, not tasks.</div>' : '';",
"    var _btn = 'flex:1;min-width:130px;text-align:center;background:rgba(255,255,255,.06);border:1px solid rgba(181,95,230,.35);border-radius:10px;padding:10px 12px;font-size:13px;font-weight:700;color:#F0EEF8;cursor:pointer;font-family:inherit';",
"    var _canShare = (typeof navigator!=='undefined' && !!navigator.share);",
"    var share = '<div style=\"margin-top:16px;border:1px solid rgba(0,245,160,.30);border-radius:12px;padding:13px 14px;background:rgba(0,245,160,.06)\">'",
"      + '<div style=\"font-size:11px;font-weight:800;letter-spacing:.1em;color:#00C880;text-transform:uppercase;margin-bottom:9px\">Share your score</div>'",
"      + '<div style=\"display:flex;gap:8px;flex-wrap:wrap\">'",
"      + '<button id=\"rc-dl\" type=\"button\" style=\"'+_btn+'\">⭳ Download score card</button>'",
"      + '<button id=\"rc-copy\" type=\"button\" style=\"'+_btn+'\">🔗 Copy link</button>'",
"      + (_canShare ? '<button id=\"rc-share\" type=\"button\" style=\"'+_btn+'\">Share →</button>' : '')",
"      + '</div>'",
"      + '<div style=\"font-size:11px;color:#6E667F;margin-top:8px\">No résumé text or personal info ever leaves the card — just your score.</div>'",
"      + '</div>';",
"    $('rc-out').innerHTML = '<div style=\"display:flex;gap:20px;align-items:center;flex-wrap:wrap;justify-content:center;margin-bottom:14px\">'+ring(pct)+'<div style=\"min-width:220px\"><div style=\"font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#B55FE6\">Résumé Strength</div><div style=\"font-size:18px;font-weight:800;margin:2px 0 4px\">'+band+'</div><div style=\"font-size:12px;color:#9B93B8\">How strong the writing is \\u2014 outcomes, metrics, strong verbs, tight &amp; clean.</div></div></div>'+items+tip+share+'<div style=\"margin-top:18px;text-align:center\"><a href=\"https://ghostproofjob.com/\" style=\"display:inline-block;background:linear-gradient(90deg,#00F5A0,#00C880);color:#120F1D;font-weight:800;text-decoration:none;border-radius:12px;padding:12px 22px;font-size:14px\">Get your role-specific match + AI tailoring \\u2192</a><div style=\"font-size:11px;color:#6E667F;margin-top:8px\">Free to join \\u2014 the AI tailors a copy to each job using only your real experience.</div></div>';",
"    $('rc-out').style.display='block';",
"    var _dl=$('rc-dl'); if(_dl) _dl.addEventListener('click', function(){ downloadCard(pct, band); });",
"    var _cp=$('rc-copy'); if(_cp) _cp.addEventListener('click', copyLink);",
"    var _sh=$('rc-share'); if(_sh) _sh.addEventListener('click', function(){ shareScore(pct); });",
"  }",
"  function setText(t){ var el=$('rc-input'); if(el) el.value=String(t||'').trim(); var s=$('rc-filestatus'); var ok=!!(t&&String(t).trim()); if(s) s.textContent = ok?'\\u2713 Loaded \\u2014 scoring…':''; if(ok) run(); }",
"  function extractPdf(buf){ if(!window.pdfjsLib){ var s=$('rc-filestatus'); if(s) s.textContent='PDF reader still loading \\u2014 try again in a second, or paste the text.'; return; } pdfjsLib.getDocument({data:buf}).promise.then(function(pdf){ var out=[]; var chain=Promise.resolve(); for(var i=1;i<=pdf.numPages;i++){ (function(p){ chain=chain.then(function(){ return pdf.getPage(p).then(function(pg){ return pg.getTextContent().then(function(tc){ out[p]=tc.items.map(function(it){return it.str;}).join(' '); }); }); }); })(i); } chain.then(function(){ setText(out.join('\\n')); }); }).catch(function(){ var s=$('rc-filestatus'); if(s) s.textContent='Could not read that PDF \\u2014 try pasting the text.'; }); }",
"  function extractDocx(buf){ if(!window.mammoth){ var s=$('rc-filestatus'); if(s) s.textContent='DOCX reader unavailable \\u2014 paste the text.'; return; } mammoth.extractRawText({arrayBuffer:buf}).then(function(res){ setText(res.value); }).catch(function(){ var s=$('rc-filestatus'); if(s) s.textContent='Could not read that file \\u2014 try pasting the text.'; }); }",
"  var fi = $('rc-file'); if(fi) fi.addEventListener('change', function(e){ var f=e.target.files&&e.target.files[0]; if(!f) return; var nm=f.name.toLowerCase(); var s=$('rc-filestatus'); if(s) s.textContent='Reading '+f.name+'…'; var r=new FileReader(); if(/\\.txt$/.test(nm)){ r.onload=function(){ setText(r.result); }; r.readAsText(f); } else if(/\\.pdf$/.test(nm)){ r.onload=function(){ extractPdf(r.result); }; r.readAsArrayBuffer(f); } else if(/\\.docx?$/.test(nm)){ r.onload=function(){ extractDocx(r.result); }; r.readAsArrayBuffer(f); } else { if(s) s.textContent='Unsupported file \\u2014 use PDF, DOCX, or TXT.'; } });",
"  var btn = document.getElementById('rc-go'); if(btn) btn.addEventListener('click', run);",
"})();"
].join("\n");

const html =
'<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
'<meta charset="UTF-8"/>\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1"/>\n' +
'<title>Free Résumé Strength Checker — score your résumé in seconds | GhostProofJob</title>\n' +
'<meta name="description" content="Paste your résumé and get an instant, honest strength score — outcomes, metrics, strong verbs, and concision — with the exact fixes named. Free, runs in your browser, nothing stored."/>\n' +
'<link rel="canonical" href="https://ghostproofjob.com/resume-checker.html"/>\n' +
'<meta property="og:type" content="website"/>\n' +
'<meta property="og:title" content="Free Résumé Strength Checker — GhostProofJob"/>\n' +
'<meta property="og:description" content="Instant, honest résumé strength score with the exact fixes named. Free, private, in your browser."/>\n' +
'<meta property="og:url" content="https://ghostproofjob.com/resume-checker.html"/>\n' +
'<meta name="twitter:card" content="summary_large_image"/>\n' +
'<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>\n' +
'<script>if(window.pdfjsLib){pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";}</script>\n' +
'<script src="https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js"></script>\n' +
'<style>\n' +
'  :root{--plum:#120F1D;--plum2:#1C1830;--plum3:#251F3A;--mint:#00F5A0;--cyber:#B55FE6;--off:#F0EEF8;--muted:#9B93B8;--line:rgba(181,95,230,.18)}\n' +
'  *{box-sizing:border-box}body{margin:0;background:radial-gradient(1000px 500px at 80% -10%,rgba(0,245,160,.10),transparent 60%),radial-gradient(800px 460px at 10% 0,rgba(181,95,230,.12),transparent 55%),var(--plum);color:var(--off);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.6;padding:0 20px 80px}\n' +
'  .wrap{max-width:760px;margin:0 auto}\n' +
'  header{text-align:center;padding:56px 0 20px}\n' +
'  .gm{font-size:46px}.gm img{width:58px;height:58px;object-fit:contain;filter:drop-shadow(0 0 8px rgba(0,245,160,.35))}\n' +
'  h1{font-size:clamp(28px,5vw,40px);line-height:1.05;margin:12px 0 6px;letter-spacing:-.02em}\n' +
'  h1 .g{color:var(--mint)}h1 .p{color:var(--cyber)}\n' +
'  .lede{color:#D7D2EA;max-width:560px;margin:14px auto 0;font-size:16.5px}\n' +
'  .card{background:var(--plum2);border:1px solid var(--line);border-radius:18px;padding:20px}\n' +
'  textarea{width:100%;min-height:220px;background:var(--plum);border:1px solid var(--plum3);border-radius:12px;color:var(--off);font-size:13.5px;padding:14px;font-family:ui-monospace,Menlo,Consolas,monospace;resize:vertical}\n' +
'  .go{margin-top:12px;width:100%;background:linear-gradient(90deg,var(--mint),#00C880);color:var(--plum);font-weight:800;border:none;border-radius:12px;padding:14px;font-size:15px;cursor:pointer}\n' +
'  .note{font-size:11.5px;color:var(--muted);text-align:center;margin-top:10px}\n' +
'  #rc-out{display:none;margin-top:18px;background:var(--plum2);border:1px solid var(--line);border-radius:18px;padding:20px}\n' +
'  .how{margin-top:26px}\n' +
'  .how h2{font-size:20px;margin:0 0 8px}\n' +
'  .how p{color:#C6C0DD;font-size:14px}\n' +
'  footer{text-align:center;color:var(--muted);font-size:12.5px;padding-top:36px}\n' +
'  a.brand{color:var(--cyber);text-decoration:none;font-weight:800}\n' +
'  .brandwm{display:inline-flex;align-items:center;gap:7px;text-decoration:none;font-weight:800;vertical-align:middle}.brandwm .bm{width:22px;height:22px;object-fit:contain}.brandwm .bt{background:linear-gradient(90deg,var(--mint),var(--cyber));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:var(--mint)}\n' +
'</style>\n</head>\n<body>\n<div class="wrap">\n' +
'  <header>\n' +
'    <div class="gm"><img src="/assets/logo-mark.png" alt="GhostProofJob"/></div>\n' +
'    <h1>Free <span class="g">Résumé</span> <span class="p">Strength</span> Checker</h1>\n' +
'    <p class="lede">Upload your résumé (PDF, DOCX or TXT) or paste it — or your LinkedIn profile — for an instant, honest strength score: outcomes, metrics, strong verbs, and concision, with the exact fixes named. It all runs in your browser; your file never leaves your device.</p>\n' +
'  </header>\n' +
'  <div class="card">\n' +
'    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px">\n' +
'      <label for="rc-file" style="cursor:pointer;background:linear-gradient(90deg,var(--cyber),#9340CC);color:#fff;font-weight:800;border-radius:10px;padding:11px 16px;font-size:13px">📄 Upload résumé — PDF, DOCX or TXT</label>\n' +
'      <input type="file" id="rc-file" accept=".pdf,.doc,.docx,.txt" style="display:none"/>\n' +
'      <span id="rc-filestatus" style="font-size:12px;color:var(--muted)"></span>\n' +
'    </div>\n' +
'    <label for="rc-input" style="font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--cyber)">…or paste your résumé (or LinkedIn profile) text</label>\n' +
'    <textarea id="rc-input" placeholder="Paste the full text of your résumé — or your LinkedIn profile — here: summary, experience bullets, skills…"></textarea>\n' +
'    <button class="go" id="rc-go">Check my résumé strength →</button>\n' +
'    <div class="note">100% private — the scoring runs entirely in your browser. We never see, store, or sell your résumé.</div>\n' +
'    <div id="rc-out"></div>\n' +
'  </div>\n' +
'  <div class="how">\n' +
'    <h2>What this checks</h2>\n' +
'    <p>The same structural rubric our signed-in rater uses: whether your bullets show <b>measurable outcomes</b> (not just tasks), how many are <b>quantified</b>, whether your <b>verbs are strong and varied</b>, and whether the writing is <b>tight and clean</b>. It scores how your résumé is <em>written</em> — not any one job. For a role-specific match score and AI tailoring to a posting, <a class="brand" href="https://ghostproofjob.com/">join GhostProofJob free</a>.</p>\n' +
'  </div>\n' +
'  <footer>\n' +
'    <div><a class="brandwm" href="https://ghostproofjob.com/"><img class="bm" src="/assets/logo-mark.png" alt=""/><span class="bt">GhostProofJob</span></a> — the ethical, free-until-hired job search.</div>\n' +
'    <div style="margin-top:6px">No ads · no data selling · your résumé never leaves your device on this page.</div>\n' +
'  </footer>\n' +
'</div>\n' +
'<script>\n/* GPJRateCore — inlined verbatim from api/rate/rateCore.js (single source of truth) */\n' +
rateCoreSrc +
'\n</script>\n<script>\n' + UI_JS + '\n</script>\n</body>\n</html>\n';

fs.writeFileSync(OUT, html, 'utf8');
console.log('[checker] wrote', path.relative(ROOT, OUT), '(' + (html.length / 1024).toFixed(1) + ' KB, rateCore inlined ' + (rateCoreSrc.length / 1024).toFixed(1) + ' KB)');
