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

console.log(`\n${'='.repeat(58)}\n${fails === 0 ? 'BENCHMARK GREEN' : 'BENCHMARK RED — ' + fails + ' failure(s)'}\n${'='.repeat(58)}`);
process.exit(fails === 0 ? 0 : 1);
