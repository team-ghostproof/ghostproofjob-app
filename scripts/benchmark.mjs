// ============================================================================
// GhostProofJob — §4 BENCHMARK (the verifiable gate)
// ----------------------------------------------------------------------------
// Run:  npm run benchmark      Exit 0 = green, 1 = red. CI blocks a merge on red.
//
// This is the ONE command that says whether a build is shippable. It is checked
// in (not a scratch file) precisely so the answer is reproducible by anyone, on
// any machine, at any commit — the founder can run it before deploying and CI
// runs it on every push. `node --check` alone does NOT catch the boot crashes
// (TDZ) that have broken this app before; step [2] does.
// ============================================================================
import fs from 'node:fs';
import vm from 'node:vm';

// repo-root relative so it runs identically on any machine and in CI
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..') + path.sep;
const html = fs.readFileSync(ROOT + 'index.html', 'utf8');
let fails = 0;
const ok = (n, p, extra = '') => { console.log(`${p ? '  PASS' : '  FAIL'}  ${n}${extra ? ' — ' + extra : ''}`); if (!p) fails++; };

// 0) not emptied
console.log('\n[0] file sanity');
ok('index.html non-trivial', html.length > 500000, html.length.toLocaleString() + ' bytes, ' + html.split('\n').length.toLocaleString() + ' lines');

// 1) extract inline scripts + syntax check
console.log('\n[1] JS syntax of inline <script> blocks');
const blocks = [];
const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
let m;
while ((m = re.exec(html)) !== null) {
  const attrs = m[1] || '';
  if (/type\s*=\s*["']?(application\/ld\+json|text\/template)/i.test(attrs)) continue;
  blocks.push({ attrs, code: m[2], isModule: /type\s*=\s*["']?module/i.test(attrs) });
}
let mainBlock = null;
blocks.forEach((b, i) => {
  try {
    // ESM can't go through vm.Script; wrap so import/export parse as syntax only
    if (b.isModule) new vm.Script('(async()=>{' + b.code.replace(/^\s*import\s[^;]+;/gm, '').replace(/^\s*export\s+/gm, '') + '})');
    else new vm.Script(b.code);
    if (!b.isModule && b.code.length > (mainBlock ? mainBlock.code.length : 0)) mainBlock = b;
  } catch (e) { ok(`block #${i} parses`, false, e.message); }
});
ok(`all ${blocks.length} inline blocks parse`, fails === 0);

// 2) boot harness — run the main script in a mocked browser
console.log('\n[2] boot harness (gold check — catches TDZ that node --check misses)');
if (!mainBlock) { ok('main inline block found', false); }
else {
  const mkEl = () => new Proxy({
    style: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    dataset: {}, children: [], attributes: {},
    appendChild(c){ return c; }, removeChild(c){ return c; }, remove(){},
    setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){},
    addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return true; },
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    getBoundingClientRect(){ return { top:0,left:0,right:0,bottom:0,width:0,height:0 }; },
    insertAdjacentHTML(){}, focus(){}, blur(){}, click(){}, scrollIntoView(){},
    closest(){ return null; }, matches(){ return false; }, contains(){ return false; },
    cloneNode(){ return mkEl(); }, insertBefore(c){ return c; }, replaceChild(c){ return c; },
    animate(){ return { finished: Promise.resolve(), cancel(){} }; },
    getContext(){ return null; }, submit(){}, reset(){}, select(){}, scrollTo(){},
    textContent:'', innerHTML:'', innerText:'', value:'', checked:false,
    scrollHeight:0, offsetHeight:0, clientHeight:0, offsetWidth:0,
  }, { get(t,k){ if (k in t) return t[k]; if (typeof k === 'symbol') return undefined; return undefined; }, set(t,k,v){ t[k]=v; return true; } });

  const store = {};
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k,v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }, clear: () => { for (const k in store) delete store[k]; },
  };
  const document = new Proxy({
    body: mkEl(), documentElement: mkEl(), head: mkEl(), readyState: 'complete', cookie: '',
    getElementById(){ return mkEl(); }, querySelector(){ return mkEl(); }, querySelectorAll(){ return []; },
    createElement(){ return mkEl(); }, createTextNode(){ return mkEl(); },
    createDocumentFragment(){ return mkEl(); },
    addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return true; },
    getElementsByClassName(){ return []; }, getElementsByTagName(){ return []; },
  }, { get(t,k){ if (k in t) return t[k]; return undefined; }, set(t,k,v){ t[k]=v; return true; } });

  const sandbox = {
    document, localStorage, sessionStorage: localStorage, console,
    setTimeout: () => 0, clearTimeout(){}, setInterval: () => 0, clearInterval(){},
    requestAnimationFrame: () => 0, cancelAnimationFrame(){},
    fetch: () => Promise.resolve({ ok:true, json:()=>Promise.resolve({}), text:()=>Promise.resolve('') }),
    navigator: { userAgent:'node', language:'en-US', onLine:true, serviceWorker:{ register:()=>Promise.resolve() }, clipboard:{ writeText:()=>Promise.resolve() }, deviceMemory:8 },
    location: { href:'http://localhost/', hostname:'localhost', pathname:'/', search:'', hash:'', origin:'http://localhost', reload(){}, replace(){} },
    screen: { width:1440, height:900 },
    matchMedia: () => ({ matches:false, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }),
    URL: Object.assign(function(){ return { href:'' }; }, { createObjectURL: () => 'blob:x', revokeObjectURL(){} }),
    Blob: function(){}, FileReader: function(){ return { readAsDataURL(){}, readAsText(){} }; },
    Image: function(){ return mkEl(); }, FormData: function(){}, Headers: function(){},
    alert(){}, confirm(){ return true; }, prompt(){ return ''; },
    open(){ return null; }, print(){}, scrollTo(){}, getComputedStyle: () => ({ getPropertyValue: () => '', height:'0px' }),
    innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1,
    addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return true; },
    performance: { now: () => 0 }, crypto: { randomUUID: () => 'x', getRandomValues: a => a },
    btoa: s => Buffer.from(String(s)).toString('base64'), atob: s => Buffer.from(String(s),'base64').toString(),
    IntersectionObserver: function(){ return { observe(){}, unobserve(){}, disconnect(){} }; },
    MutationObserver: function(){ return { observe(){}, disconnect(){} }; },
    ResizeObserver: function(){ return { observe(){}, disconnect(){} }; },
    KeyboardEvent: function(){}, CustomEvent: function(){}, Event: function(){},
    history: { pushState(){}, replaceState(){}, back(){} },
    __RAN__: false,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  try {
    vm.createContext(sandbox);
    new vm.Script(mainBlock.code + '\n;window.__RAN__=true;').runInContext(sandbox, { timeout: 30000 });
    ok('RAN TO COMPLETION', sandbox.__RAN__ === true);
    ok('reached buildDesktopGrid', typeof sandbox.buildDesktopGrid === 'function');
    // v143 surface checks
    ok('_gpjMonotonicLists defined', typeof sandbox._gpjMonotonicLists === 'function');
    ok('gpjExplainReports defined', typeof sandbox.gpjExplainReports === 'function');
    ok('syncDeckHeight defined', typeof sandbox.syncDeckHeight === 'function');
  } catch (e) {
    ok('RAN TO COMPLETION', false, e.message);
  }
}

// 3) div balance
console.log('\n[3] <div> balance');
const opens = (html.match(/<div\b/gi) || []).length;
const closes = (html.match(/<\/div>/gi) || []).length;
ok('open/close delta = 0', opens === closes, `${opens} open / ${closes} close (delta ${opens - closes})`);

// 4) mirror byte-identical
console.log('\n[4] mirror');
const mirror = fs.existsSync(ROOT + 'GhostProofJob.html') ? fs.readFileSync(ROOT + 'GhostProofJob.html', 'utf8') : null;
ok('GhostProofJob.html byte-identical', mirror === html, mirror === null ? 'MISSING' : (mirror === html ? '' : `differs (${mirror.length} vs ${html.length})`));

// 5) duplicate DOM ids
console.log('\n[5] duplicate DOM ids');
// only STATIC markup — ids inside <script> are JS template strings that render into
// modals which never coexist in the DOM (verified: opt-count / m2j-checks / m2j-c)
const staticHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '');
const ids = {};
const idRe = /\sid\s*=\s*["']([^"']+)["']/g;
let im;
while ((im = idRe.exec(staticHtml)) !== null) ids[im[1]] = (ids[im[1]] || 0) + 1;
const dupes = Object.entries(ids).filter(([, c]) => c > 1);
ok('no duplicate ids', dupes.length === 0, dupes.length ? dupes.map(d => d[0] + '×' + d[1]).join(', ') : '');

// 6) handler audit
console.log('\n[6] on* handler audit');
const declared = new Set();
const codeAll = blocks.map(b => b.code).join('\n');
for (const rx of [/function\s+([A-Za-z_$][\w$]*)/g, /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/g, /window\.([A-Za-z_$][\w$]*)\s*=/g]) {
  let d; while ((d = rx.exec(codeAll)) !== null) declared.add(d[1]);
}
const DOM_OK = new Set(['slice','contains','test','toggle','remove','add','value','checked','focus','blur','click','preventDefault','stopPropagation','length','style','classList','target','currentTarget','key','textContent','indexOf','push','forEach','map','filter','trim','split','join','replace','toLowerCase','toUpperCase','parentNode','querySelector','files','dataset','reset','submit','select','scrollIntoView','showPicker','play','pause','requestFullscreen','name','id','href','src','innerHTML','options','selectedIndex','closest','matches',
  // host-object methods reached via document./localStorage./window./JSON. in handlers
  'getElementById','querySelectorAll','setItem','getItem','removeItem','stringify','parse','open','write','assign','reload','now','random','round','floor','max','min','from','keys','values','entries','isArray','toFixed','charAt','substring','substr','concat','includes','startsWith','endsWith','padStart','repeat','sort','reverse','find','findIndex','some','every','reduce','splice','shift','unshift','pop','fill','flat','trimStart','trimEnd','normalize','localeCompare','toString','valueOf','hasOwnProperty']);
const missing = new Set();
const hRe = /\son[a-z]+\s*=\s*["']([^"']+)["']/gi;
let hm;
while ((hm = hRe.exec(html)) !== null) {
  const body = hm[1];
  let cm; const cRe = /([A-Za-z_$][\w$]*)\s*\(/g;
  while ((cm = cRe.exec(body)) !== null) {
    const fn = cm[1];
    if (declared.has(fn) || DOM_OK.has(fn)) continue;
    if (['if','for','while','switch','return','typeof','new','function','catch','try','else','this','true','false','null','undefined','Number','String','Boolean','Array','Object','JSON','Math','Date','parseInt','parseFloat','alert','confirm','event','window','document','console','setTimeout','encodeURIComponent','decodeURIComponent'].includes(fn)) continue;
    missing.add(fn);
  }
}
ok('every on* handler resolves', missing.size === 0, missing.size ? [...missing].join(', ') : '');

// 7) version markers
console.log('\n[7] version markers in sync');
const appV = (html.match(/APP_VERSION\s*=\s*['"]v?(\d+)/) || [])[1];
const stamp = (html.match(/id=["']build-stamp["'][^>]*>\s*[^<]*?v(\d+)/) || [])[1];
const sw = fs.readFileSync(ROOT + 'sw.js', 'utf8');
const cacheV = (sw.match(/CACHE_VERSION\s*=\s*['"]gpj-v(\d+)/) || [])[1];
ok('APP_VERSION / build-stamp / CACHE_VERSION agree', appV && appV === stamp && appV === cacheV, `APP_VERSION=${appV} build-stamp=${stamp} CACHE_VERSION=${cacheV}`);

/* 8) FREE-TIER PLATFORM LIMITS (v152)
   GPJ runs on free plans by design — the ONLY paid items are the AI helper and
   Claude. A build that is perfect in code but exceeds a platform quota still
   fails to deploy, so the quota is now a benchmark gate, not something to
   remember. This has bitten twice: adding a handler under api/ silently raises
   the Vercel Serverless Function count and every deploy hard-fails with
   "No more than 12 Serverless Functions can be added ... on the Hobby plan". */
console.log('\n[8] free-tier platform limits');
const VERCEL_HOBBY_FN_CAP = 12;
const SITEMAP_URL_CAP = 50000;          // sitemaps.org / Google hard limit per file

const ignoreLines = fs.existsSync(ROOT + '.vercelignore')
  ? fs.readFileSync(ROOT + '.vercelignore', 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  : [];
const isIgnored = (rel) => ignoreLines.some(i => rel === i || rel.startsWith(i.replace(/\/$/, '') + '/'));

const walkJs = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(abs, out);
    else if (e.name.endsWith('.js')) out.push(path.relative(ROOT, abs).split(path.sep).join('/'));
  }
  return out;
};
const apiAll = walkJs(ROOT + 'api');
const deployedFns = apiAll.filter(f => !isIgnored(f));
ok(`Vercel Hobby serverless functions ≤ ${VERCEL_HOBBY_FN_CAP}`,
   deployedFns.length <= VERCEL_HOBBY_FN_CAP,
   `${deployedFns.length}/${VERCEL_HOBBY_FN_CAP} deployed` +
   (deployedFns.length > VERCEL_HOBBY_FN_CAP
     ? ` — OVER by ${deployedFns.length - VERCEL_HOBBY_FN_CAP}. Add helper/dead dirs to .vercelignore (only real HTTP handlers should deploy).`
     : ` (${VERCEL_HOBBY_FN_CAP - deployedFns.length} slots free)`));

/* A vercel.json `functions` pattern that matches ZERO deployed files is itself a
   Vercel build error — easy to hit right after excluding a directory. */
let vjson = null;
try { vjson = JSON.parse(fs.readFileSync(ROOT + 'vercel.json', 'utf8')); } catch (e) {}

/* vercel.json's schema is STRICT: any unrecognised top-level key fails the build
   with "should NOT have additional property '<key>'". That bit us when a
   "_comment_*" note was added for documentation — JSON.parse happily accepted it,
   so syntax validation alone was NOT enough. Keep explanatory notes in
   .vercelignore (which allows # comments) instead. */
const VERCEL_TOP_LEVEL_KEYS = new Set([
  'version', 'name', 'alias', 'scope', 'regions', 'public', 'github', 'git', 'images',
  'env', 'build', 'builds', 'routes', 'cleanUrls', 'trailingSlash', 'redirects',
  'rewrites', 'headers', 'functions', 'crons', 'framework', 'buildCommand',
  'devCommand', 'installCommand', 'outputDirectory', 'ignoreCommand', 'rootDirectory',
  'functionFailoverRegions', 'headersCacheControl',
]);
const badKeys = vjson ? Object.keys(vjson).filter(k => !VERCEL_TOP_LEVEL_KEYS.has(k)) : [];
ok('vercel.json has no unrecognised top-level keys', badKeys.length === 0,
   badKeys.length ? 'would fail Vercel schema validation: ' + badKeys.join(', ') + ' (put notes in .vercelignore)' : '');

const fnPatterns = Object.keys((vjson && vjson.functions) || {});
const orphanPatterns = fnPatterns.filter(p => {
  const rx = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '§').replace(/\*/g, '[^/]*').replace(/§/g, '.*') + '$');
  return !deployedFns.some(f => rx.test(f));
});
ok('every vercel.json `functions` pattern matches a deployed file',
   orphanPatterns.length === 0,
   orphanPatterns.length ? 'orphaned: ' + orphanPatterns.join(', ') : (fnPatterns.length ? fnPatterns.join(', ') : 'no patterns declared'));

/* Case-sensitivity trap (CLAUDE.md §5): Vercel's filesystem is case-SENSITIVE,
   Windows/macOS are not — so a relative require can pass locally and throw in
   production. Only DEPLOYED functions matter here. */
const caseBroken = [];
for (const f of deployedFns) {
  let src = ''; try { src = fs.readFileSync(ROOT + f, 'utf8'); } catch (e) { continue; }
  const dir = path.dirname(ROOT + f);
  const rr = /require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;
  let m;
  while ((m = rr.exec(src)) !== null) {
    const spec = m[1];
    const base = path.basename(spec).replace(/\.js$/, '') + '.js';
    const targetDir = path.dirname(path.resolve(dir, spec));
    if (!fs.existsSync(targetDir)) { caseBroken.push(`${f} → ${spec} (missing dir)`); continue; }
    if (!fs.readdirSync(targetDir).includes(base)) caseBroken.push(`${f} → ${spec}`);
  }
}
ok('deployed relative requires resolve with EXACT case', caseBroken.length === 0,
   caseBroken.length ? caseBroken.join('; ') : '');

if (fs.existsSync(ROOT + 'sitemap.xml')) {
  const urlCount = (fs.readFileSync(ROOT + 'sitemap.xml', 'utf8').match(/<loc>/g) || []).length;
  ok(`sitemap.xml under ${SITEMAP_URL_CAP.toLocaleString()} URLs`, urlCount <= SITEMAP_URL_CAP,
     `${urlCount.toLocaleString()} URLs` + (urlCount > SITEMAP_URL_CAP ? ' — split into a sitemap index' : ''));
}

console.log(`\n${'='.repeat(58)}\n${fails === 0 ? 'BENCHMARK GREEN' : 'BENCHMARK RED — ' + fails + ' failure(s)'}\n${'='.repeat(58)}`);
process.exit(fails === 0 ? 0 : 1);
