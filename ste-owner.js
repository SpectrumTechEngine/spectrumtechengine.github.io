/* =========================================================
   STE Owner: usage numbers and owner tools for every
   Spectrum Tech Engine app (thespectrumtechengine.com)

   Add to an app with:
     <script src="https://thespectrumtechengine.com/ste-owner.js" data-app="archer-duel" defer></script>

   What it sends (to the Firebase project "ste-owner"): only numbers.
   - each day, per app: opens (website / installed / Android app), plays, shares, installs,
     how many phones used it and how many were new, plus the app's own details
     (e.g. which place was picked, average score)
   - one entry per phone: a random ID made by Firebase, first and last day seen. No names.
   Nothing is sent while testing on a computer (only on thespectrumtechengine.com),
   and nothing is counted from the owner's own unlocked phone.

   For players: pop-up messages, a maintenance banner, and feature switches from the owner.

   For the owner: tap the "Spectrum Tech Engine" logo/badge 5 times quickly and enter the
   owner code. The database checks the code against a fingerprint only it can see.
   Once a phone is unlocked, every app on this website is unlocked on that phone.

   The app can use:
     STE.track('play')            add 1 to plays (also 'share', or any name)
     STE.detail('place-beach')    count a choice or event (shown as a top-list)
     STE.value('score', 37)       add a number (shown as an average)
     STE.feature('new-birds')     true if that switch is on for this phone
     STE.features = { 'new-birds': 'What the switch does' }   (lists switches for the owner)
     STE.ownerTabs.push({ title, render(el, api) })           (extra owner tools for this app)
   ========================================================= */
(() => {
  if (window.STE && window.STE.loaded) return;
  const me = document.currentScript;
  const APP = String((me && me.dataset.app) || location.pathname.split('/').filter(Boolean)[0] || 'site').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'site';
  const FB = 'https://www.gstatic.com/firebasejs/12.19.0/';
  const CONFIG = {
    apiKey: 'AIzaSyAZZEit4XKY2BXEEAaeodyCLqnq2t4Zei4',
    authDomain: 'ste-owner.firebaseapp.com',
    projectId: 'ste-owner',
    storageBucket: 'ste-owner.firebasestorage.app',
    messagingSenderId: '829458613758',
    appId: '1:829458613758:web:4e620c438e6cfcf526acaf',
  };
  const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  // counts on the website and inside the Android apps (some carry their own copy of the app), never on a test computer
  const LIVE = /(^|\.)thespectrumtechengine\.com$/i.test(location.hostname) || NATIVE || new URLSearchParams(location.search).has('ste-live');
  const KIND = NATIVE ? 'apk' : (matchMedia('(display-mode: standalone)').matches || navigator.standalone) ? 'installed' : 'web';
  const TAPS = 5, TAP_WINDOW = 2500, MAX_WRONG = 5, LOCKOUT = 60 * 60 * 1000;

  /* ---------------- small helpers ---------------- */
  const local = {
    get(k, d) { try { const v = localStorage.getItem('ste-' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { v == null ? localStorage.removeItem('ste-' + k) : localStorage.setItem('ste-' + k, JSON.stringify(v)); } catch (_) {} },
  };
  const day = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin' }).format(new Date(ms));
  const daysAgo = n => day(Date.now() - n * 864e5);
  const key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => (Number.isFinite(+v) ? +v : 0);
  async function fingerprint(code) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ste-owner:' + code));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* ---------------- Firebase, loaded quietly after the app ---------------- */
  let fbP = null;
  function fb() {
    if (!fbP) fbP = (async () => {
      const [appM, authM, fsM] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
      const app = appM.initializeApp(CONFIG, 'ste-owner');
      const auth = authM.getAuth(app), db = fsM.getFirestore(app);
      await auth.authStateReady();
      if (!auth.currentUser) await authM.signInAnonymously(auth);
      return { authM, fsM, auth, db, uid: auth.currentUser.uid };
    })().catch(e => { fbP = null; throw e; });
    return fbP;
  }

  /* ---------------- counting ---------------- */
  let owner = !!local.get('owner', false);  // this phone has unlocked the owner tools
  const pending = local.get('pending-' + APP, {}); // numbers not yet sent: { day: { field: n } }
  function bump(field, n = 1) {
    if (!LIVE || (owner && !local.get('count-me', false))) return;
    const d = day(), f = key(field); if (!f) return;
    (pending[d] = pending[d] || {})[f] = num(pending[d][f]) + n;
    local.set('pending-' + APP, pending);
    clearTimeout(bump.t); bump.t = setTimeout(flush, 8000);
  }
  let flushing = false;
  async function flush() {
    if (flushing || !Object.keys(pending).length) return;
    flushing = true;
    try {
      const { fsM, db } = await fb();
      for (const d of Object.keys(pending)) {
        const all = Object.entries(pending[d]);
        while (all.length) {
          const part = all.splice(0, 20), data = {}; // the rules allow a few numbers per write
          for (const [f, n] of part) data[f] = fsM.increment(n);
          await fsM.setDoc(fsM.doc(db, 'apps', APP, 'days', d), data, { merge: true });
          for (const [f] of part) delete pending[d][f];
          local.set('pending-' + APP, pending);
        }
        delete pending[d]; local.set('pending-' + APP, pending);
      }
    } catch (e) { console.warn('STE: numbers will be sent later', e); }
    finally { flushing = false; }
  }
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', flush);

  // one entry per phone, and today's "phones" / "new phones" numbers
  async function seePhone() {
    if (!LIVE || (owner && !local.get('count-me', false))) return;
    const today = day(), seen = local.get('seen-' + APP, null);
    if (seen === today) return;
    bump('phones'); if (!seen) bump('new_phones');
    local.set('seen-' + APP, today);
    try {
      const { fsM, db, uid } = await fb();
      const data = { last: today, kind: KIND, days: fsM.increment(1) };
      if (!seen) data.first = today;
      await fsM.setDoc(fsM.doc(db, 'apps', APP, 'devices', uid), data, { merge: true });
    } catch (e) { console.warn(e); }
  }

  /* ---------------- messages from the owner: pop-up, banner, switches ---------------- */
  let cfg = local.get('cfg-' + APP, {});
  const featureOn = name => { const s = (cfg.switches || {})[key(name)]; return s === 'all' || (s === 'owner' && owner); };
  async function loadConfig() {
    if (!LIVE && !owner) return;
    try {
      const { fsM, db, uid } = await fb();
      // is this phone still unlocked?
      const a = await fsM.getDoc(fsM.doc(db, 'admins', uid)).catch(() => null);
      if (a) { owner = a.exists(); local.set('owner', owner); }
      const s = await fsM.getDoc(fsM.doc(db, 'apps', APP, 'config', 'main'));
      cfg = s.exists() ? s.data() : {}; local.set('cfg-' + APP, cfg);
      showBanner(); showNotice();
      document.dispatchEvent(new CustomEvent('ste-config', { detail: cfg }));
    } catch (e) { console.warn(e); }
  }
  function live(x) { return x && x.text && (!x.until || x.until > Date.now()); }
  function showBanner() {
    let b = document.getElementById('ste-banner');
    if (!live(cfg.banner) || sessionStorage.getItem('ste-banner-x') === cfg.banner.text) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('div'); b.id = 'ste-banner'; b.setAttribute('role', 'status'); document.body.appendChild(b); }
    b.innerHTML = `<span>${esc(cfg.banner.text)}</span><button type="button" aria-label="Hide this message">×</button>`;
    b.querySelector('button').onclick = () => { try { sessionStorage.setItem('ste-banner-x', cfg.banner.text); } catch (_) {} b.remove(); };
  }
  function showNotice() {
    const n = cfg.notice; if (!live(n) || local.get('notice-seen-' + APP) === n.id) return;
    if (n.who === 'owner' && !owner) return;
    const l = layer(`<h2>${esc(n.title || 'A message from The Spectrum Tech Engine')}</h2><p class="ste-pre">${esc(n.text)}</p><div class="ste-row"><button class="ste-btn go" data-ok>OK</button></div>`);
    l.querySelector('[data-ok]').onclick = () => { local.set('notice-seen-' + APP, n.id); l.remove(); };
  }

  /* ---------------- styles (kept to this add-on) ---------------- */
  const css = document.createElement('style');
  css.textContent = `
  #ste-banner{position:fixed;left:0;right:0;top:0;z-index:2147483000;display:flex;gap:.6rem;align-items:center;justify-content:center;padding:calc(.5rem + env(safe-area-inset-top,0px)) 2.6rem .5rem 1rem;background:#7a1f12;color:#fff;font:600 15px/1.35 system-ui,sans-serif;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.35)}
  #ste-banner button{position:absolute;right:.5rem;top:calc(.25rem + env(safe-area-inset-top,0px));border:0;background:none;color:#fff;font-size:1.5rem;line-height:1;cursor:pointer;padding:.2rem .5rem}
  .ste-layer{position:fixed;inset:0;z-index:2147483001;background:rgba(15,12,10,.6);display:grid;place-items:center;padding:16px;font:15px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1d1a17}
  .ste-card{width:min(100%,30rem);max-height:88dvh;overflow:auto;background:#fbf8f3;border-radius:16px;padding:18px 18px 16px;box-shadow:0 24px 60px -18px rgba(0,0,0,.6)}
  .ste-card.wide{width:min(100%,40rem)}
  .ste-card h2{margin:0 0 .5rem;font-size:1.2rem}
  .ste-card h3{margin:1rem 0 .4rem;font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:#6d6359}
  .ste-card p{margin:.35rem 0}
  .ste-pre{white-space:pre-wrap}
  .ste-muted{color:#6d6359;font-size:.88rem}
  .ste-err{color:#a1260f;font-weight:600}
  .ste-card,.ste-card *{letter-spacing:normal;text-transform:none;-webkit-user-select:text;user-select:text}
  .ste-card label{display:block;margin-top:.6rem;font-weight:600}
  .ste-card input,.ste-card textarea,.ste-card select{width:100%;box-sizing:border-box;font:inherit;font-weight:400;color:inherit;background:#fff;border:1.5px solid #d6cdc1;border-radius:10px;padding:.55rem .65rem;text-align:left;margin-top:.25rem}
  .ste-card textarea{min-height:5.5rem;resize:vertical}
  .ste-row{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.7rem;align-items:center}
  .ste-btn{font:inherit;font-weight:700;font-size:.9rem;border:1.5px solid #d6cdc1;background:#fff;color:#1d1a17;border-radius:999px;padding:.5rem .95rem;cursor:pointer;min-height:40px}
  .ste-btn.go{background:#1d1a17;border-color:#1d1a17;color:#fff}
  .ste-btn.danger{color:#a1260f;border-color:#a1260f}
  .ste-btn:disabled{opacity:.5;cursor:default}
  .ste-top{display:flex;justify-content:space-between;align-items:center;gap:.5rem}
  .ste-x{border:0;background:none;font-size:1.6rem;line-height:1;cursor:pointer;color:#6d6359;padding:.2rem .4rem}
  .ste-tabs{display:flex;flex-wrap:wrap;gap:.35rem;margin:.3rem 0 .6rem}
  .ste-tabs button{font:inherit;font-weight:700;font-size:.85rem;border:0;background:#ece5da;color:#1d1a17;border-radius:999px;padding:.45rem .85rem;cursor:pointer}
  .ste-tabs button[aria-selected=true]{background:#1d1a17;color:#fff}
  .ste-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(7.2rem,1fr));gap:.5rem}
  .ste-tile{background:#fff;border:1.5px solid #ece5da;border-radius:12px;padding:.55rem .65rem}
  .ste-tile b{display:block;font-size:1.35rem;font-variant-numeric:tabular-nums}
  .ste-tile span{font-size:.78rem;color:#6d6359}
  .ste-table{width:100%;border-collapse:collapse;font-size:.85rem;font-variant-numeric:tabular-nums}
  .ste-table th,.ste-table td{text-align:right;padding:.3rem .35rem;border-bottom:1px solid #ece5da}
  .ste-table th:first-child,.ste-table td:first-child{text-align:left}
  .ste-bar{height:8px;border-radius:4px;background:#c8743a;min-width:2px}
  .ste-scroll{overflow-x:auto}
  @media (prefers-color-scheme: dark){
    .ste-layer{color:#efe8de}
    .ste-card{background:#1f1b17}
    .ste-card h3,.ste-muted{color:#b3a898}
    .ste-card input,.ste-card textarea,.ste-card select,.ste-btn,.ste-tile{background:#2a251f;border-color:#3d362e;color:#efe8de}
    .ste-btn.go{background:#efe8de;color:#1d1a17;border-color:#efe8de}
    .ste-tabs button{background:#2f2922;color:#efe8de}
    .ste-tabs button[aria-selected=true]{background:#efe8de;color:#1d1a17}
    .ste-table th,.ste-table td{border-color:#3d362e}
    .ste-err{color:#ff8a6a}
  }`;
  document.head.appendChild(css);

  function layer(html, wide) {
    const l = document.createElement('div'); l.className = 'ste-layer';
    l.innerHTML = `<div class="ste-card${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    // keep taps inside the panel away from the game underneath
    for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'keydown', 'click']) l.addEventListener(ev, e => e.stopPropagation());
    l.addEventListener('click', e => { if (e.target === l) l.remove(); });
    document.body.appendChild(l);
    return l;
  }

  /* ---------------- unlocking: 5 quick taps on the STE badge ---------------- */
  let taps = [];
  const isBadge = el => el && el.closest && el.closest('[data-ste-badge], img.ste-logo, img[alt*="Spectrum Tech Engine" i], [aria-label*="Spectrum Tech Engine" i], .ste-logo, .steLogo, .ste-badge');
  // an app with its own owner tools on the badge (What's 4 the Gaff) sets data-badge="off" and opens these with STE.openOwner()
  const BADGE_OFF = !!(me && me.dataset.badge === 'off');
  document.addEventListener('click', e => {
    if (BADGE_OFF || !isBadge(e.target)) return;
    const now = Date.now(); taps = taps.filter(t => now - t < TAP_WINDOW); taps.push(now);
    if (taps.length >= TAPS) { taps = []; e.preventDefault(); openOwner(); }
  }, true);

  function openOwner() { owner ? ownerPanel() : unlockPanel(); }
  function unlockPanel() {
    const lock = local.get('lock', null);
    if (lock && Date.now() < lock.until) {
      const l = layer(`<h2>Owner tools</h2><p>Too many wrong codes. Try again in ${Math.ceil((lock.until - Date.now()) / 60000)} minutes.</p><div class="ste-row"><button class="ste-btn go" data-x>OK</button></div>`);
      l.querySelector('[data-x]').onclick = () => l.remove(); return;
    }
    const l = layer(`<div class="ste-top"><h2>Owner tools</h2><button class="ste-x" data-x aria-label="Close">×</button></div>
      <p class="ste-muted">Enter the owner code to unlock this phone. It unlocks every app on thespectrumtechengine.com on this phone.</p>
      <input type="password" autocomplete="off" data-code aria-label="Owner code" placeholder="Owner code">
      <p class="ste-err" data-msg></p>
      <div class="ste-row"><button class="ste-btn go" data-go>Unlock</button></div>`);
    const inp = l.querySelector('[data-code]'), msg = l.querySelector('[data-msg]'), go = l.querySelector('[data-go]');
    l.querySelector('[data-x]').onclick = () => l.remove();
    setTimeout(() => inp.focus(), 50);
    const tryIt = async () => {
      const code = inp.value; if (!code) return;
      go.disabled = true; msg.textContent = 'Checking…';
      try {
        const { fsM, db, uid } = await fb();
        await fsM.setDoc(fsM.doc(db, 'admins', uid), { key: await fingerprint(code), at: Date.now(), app: APP });
        owner = true; local.set('owner', true); local.set('wrong', 0);
        l.remove(); ownerPanel(); loadConfig();
      } catch (e) {
        const wrong = num(local.get('wrong', 0)) + 1; local.set('wrong', wrong);
        if (wrong >= MAX_WRONG) { local.set('lock', { until: Date.now() + LOCKOUT }); local.set('wrong', 0); l.remove(); unlockPanel(); return; }
        msg.textContent = /permission/i.test(String(e && (e.code || e.message))) ? `That code isn't right. ${MAX_WRONG - wrong} tries left.` : "Couldn't reach the owner database. Check the internet connection.";
        go.disabled = false; inp.select();
      }
    };
    go.onclick = tryIt; inp.addEventListener('keydown', e => { if (e.key === 'Enter') tryIt(); });
  }

  /* ---------------- the owner panel ---------------- */
  const STE = window.STE = window.STE || {};
  STE.ownerTabs = STE.ownerTabs || [];
  STE.features = STE.features || {};
  const LABEL = { opens: 'Opens', plays: 'Plays', shares: 'Shares', installs: 'Installs', phones: 'Phones', new_phones: 'New phones' };

  function ownerPanel() {
    const tabs = [['Stats', statsTab], ['Players', playersTab], ['Pop-up', popupTab], ['Banner', bannerTab], ['Switches', switchTab], ...STE.ownerTabs.map(t => [t.title, t.render]), ['This phone', phoneTab]];
    const l = layer(`<div class="ste-top"><h2>Owner tools: ${esc(document.title.split(':')[0] || APP)}</h2><button class="ste-x" data-x aria-label="Close">×</button></div>
      <div class="ste-tabs" role="tablist">${tabs.map(([t], i) => `<button role="tab" data-t="${i}" aria-selected="${i === 0}">${esc(t)}</button>`).join('')}</div><div data-body></div>`, true);
    l.querySelector('[data-x]').onclick = () => l.remove();
    const body = l.querySelector('[data-body]');
    const show = i => { l.querySelectorAll('[data-t]').forEach(b => b.setAttribute('aria-selected', b.dataset.t == i)); body.innerHTML = '<p class="ste-muted">Loading…</p>'; Promise.resolve(tabs[i][1](body, api)).catch(e => { console.warn(e); body.innerHTML = `<p class="ste-err">That couldn't be loaded. ${esc(e && e.code === 'permission-denied' ? 'This phone is no longer unlocked.' : 'Check the internet connection.')}</p>`; }); };
    l.querySelector('[role=tablist]').onclick = e => { const b = e.target.closest('[data-t]'); if (b) show(+b.dataset.t); };
    show(0);
  }
  const api = { fb, APP, day, daysAgo, esc, layer, saveConfig };
  async function saveConfig(patch) {
    const { fsM, db } = await fb();
    await fsM.setDoc(fsM.doc(db, 'apps', APP, 'config', 'main'), patch, { merge: true });
    Object.assign(cfg, patch); local.set('cfg-' + APP, cfg); showBanner();
  }
  async function readDays(n) {
    const { fsM, db } = await fb();
    const q = fsM.query(fsM.collection(db, 'apps', APP, 'days'), fsM.where(fsM.documentId(), '>=', daysAgo(n - 1)));
    const snap = await fsM.getDocs(q), out = {};
    snap.forEach(d => { out[d.id] = d.data(); });
    return out;
  }
  const sum = (rows, f) => rows.reduce((a, r) => a + num(r[f]), 0);

  async function statsTab(el) {
    const data = await readDays(30), list = Object.entries(data).sort((a, b) => a[0] < b[0] ? 1 : -1);
    const within = n => list.filter(([d]) => d >= daysAgo(n - 1)).map(([, r]) => r);
    const t = within(1), w = within(7), m = within(30);
    const tiles = rows => ['opens', 'plays', 'phones', 'new_phones', 'shares', 'installs'].map(f => `<div class="ste-tile"><b>${sum(rows, f)}</b><span>${LABEL[f]}</span></div>`).join('');
    // the app's own details over 30 days: counts as a top-list, values as averages
    const det = {}, val = {};
    for (const r of m) for (const [k, v] of Object.entries(r)) {
      if (k.startsWith('d_')) det[k.slice(2)] = num(det[k.slice(2)]) + num(v);
      else if (k.startsWith('v_') && k.endsWith('_sum')) { const n = k.slice(2, -4); (val[n] = val[n] || { s: 0, n: 0 }).s += num(v); }
      else if (k.startsWith('v_') && k.endsWith('_n')) { const n = k.slice(2, -2); (val[n] = val[n] || { s: 0, n: 0 }).n += num(v); }
    }
    const top = Object.entries(det).sort((a, b) => b[1] - a[1]).slice(0, 20), max = top.length ? top[0][1] : 1;
    const how = ['web', 'installed', 'apk'].map(k => [k, sum(m, 'opens_' + k)]);
    el.innerHTML = `
      <h3>Today</h3><div class="ste-tiles">${tiles(t)}</div>
      <h3>Last 7 days</h3><div class="ste-tiles">${tiles(w)}</div>
      <h3>Last 30 days</h3><div class="ste-tiles">${tiles(m)}</div>
      <h3>How it was opened (30 days)</h3>
      <p>${how.map(([k, v]) => `${{ web: 'Website', installed: 'Installed web app', apk: 'Android app' }[k]}: <b>${v}</b>`).join(' &nbsp;·&nbsp; ')}</p>
      ${Object.keys(val).length ? `<h3>Averages (30 days)</h3><table class="ste-table"><tr><th>What</th><th>Average</th><th>Times</th></tr>${Object.entries(val).map(([k, v]) => `<tr><td>${esc(k.replace(/_/g, ' '))}</td><td>${v.n ? (v.s / v.n).toFixed(1) : '–'}</td><td>${v.n}</td></tr>`).join('')}</table>` : ''}
      ${top.length ? `<h3>Most picked (30 days)</h3><table class="ste-table">${top.map(([k, v]) => `<tr><td>${esc(k.replace(/_/g, ' '))}</td><td style="width:45%"><div class="ste-bar" style="width:${Math.round(v / max * 100)}%"></div></td><td>${v}</td></tr>`).join('')}</table>` : ''}
      <h3>Day by day</h3>
      <div class="ste-scroll"><table class="ste-table"><tr><th>Day</th><th>Opens</th><th>Plays</th><th>Phones</th><th>New</th><th>Shares</th></tr>
      ${list.slice(0, 30).map(([d, r]) => `<tr><td>${esc(d.slice(5))}</td><td>${num(r.opens)}</td><td>${num(r.plays)}</td><td>${num(r.phones)}</td><td>${num(r.new_phones)}</td><td>${num(r.shares)}</td></tr>`).join('') || '<tr><td colspan="6">No numbers yet.</td></tr>'}
      </table></div>
      <p class="ste-muted">Numbers from the website only. Your own unlocked phone isn't counted (see "This phone").</p>`;
  }

  async function playersTab(el) {
    const { fsM, db } = await fb(), col = fsM.collection(db, 'apps', APP, 'devices');
    const count = async q => (await fsM.getCountFromServer(q)).data().count;
    const [all, d7, d30, apk, inst] = await Promise.all([
      count(col),
      count(fsM.query(col, fsM.where('last', '>=', daysAgo(6)))),
      count(fsM.query(col, fsM.where('last', '>=', daysAgo(29)))),
      count(fsM.query(col, fsM.where('kind', '==', 'apk'))),
      count(fsM.query(col, fsM.where('kind', '==', 'installed'))),
    ]);
    el.innerHTML = `<div class="ste-tiles">
      <div class="ste-tile"><b>${all}</b><span>Phones ever</span></div>
      <div class="ste-tile"><b>${d7}</b><span>Used in last 7 days</span></div>
      <div class="ste-tile"><b>${d30}</b><span>Used in last 30 days</span></div>
      <div class="ste-tile"><b>${inst}</b><span>Last opened as installed web app</span></div>
      <div class="ste-tile"><b>${apk}</b><span>Last opened as Android app</span></div></div>
      <p class="ste-muted">Each phone is a random ID with no name attached, so nobody can be identified here.</p>`;
  }

  function popupTab(el) {
    const n = cfg.notice || {};
    el.innerHTML = `<p class="ste-muted">A message that pops up once for everyone who opens this app.</p>
      <label>Title <input data-title maxlength="60" value="${esc(n.title || '')}" placeholder="A message from The Spectrum Tech Engine"></label>
      <label>Message <textarea data-text maxlength="500">${esc(live(n) ? n.text : '')}</textarea></label>
      <label>Show it for <select data-days><option value="1">1 day</option><option value="3">3 days</option><option value="7" selected>7 days</option><option value="30">30 days</option></select></label>
      <label>Who sees it <select data-who><option value="all">Everyone</option><option value="owner">Only my phone (a test)</option></select></label>
      <div class="ste-row"><button class="ste-btn go" data-send>Send</button><button class="ste-btn danger" data-stop>Take it down</button></div>
      <p data-msg class="ste-muted">${live(n) ? `Showing now, until ${esc(new Date(n.until).toLocaleDateString())}${n.who === 'owner' ? ' (only your phone)' : ''}.` : 'No pop-up showing.'}</p>`;
    const msg = el.querySelector('[data-msg]');
    el.querySelector('[data-send]').onclick = async () => {
      const text = el.querySelector('[data-text]').value.trim(); if (!text) { msg.textContent = 'Write a message first.'; return; }
      const notice = { id: Date.now().toString(36), title: el.querySelector('[data-title]').value.trim(), text, who: el.querySelector('[data-who]').value, until: Date.now() + num(el.querySelector('[data-days]').value) * 864e5 };
      await saveConfig({ notice }); msg.textContent = notice.who === 'owner' ? 'Sent to your phone only. Reopen the app to see it.' : 'Sent. Everyone sees it the next time they open the app.';
    };
    el.querySelector('[data-stop]').onclick = async () => { await saveConfig({ notice: null }); msg.textContent = 'Taken down.'; };
  }

  function bannerTab(el) {
    const b = cfg.banner || {};
    el.innerHTML = `<p class="ste-muted">A strip across the top of this app, e.g. "Online play is down for a bit".</p>
      <label>Banner text <input data-text maxlength="140" value="${esc(live(b) ? b.text : '')}"></label>
      <label>Show it for <select data-hours><option value="2">2 hours</option><option value="24" selected>1 day</option><option value="168">7 days</option><option value="0">Until I take it down</option></select></label>
      <div class="ste-row"><button class="ste-btn go" data-on>Show banner</button><button class="ste-btn danger" data-off>Take it down</button></div>
      <p data-msg class="ste-muted">${live(b) ? 'The banner is showing now.' : 'No banner showing.'}</p>`;
    const msg = el.querySelector('[data-msg]');
    el.querySelector('[data-on]').onclick = async () => {
      const text = el.querySelector('[data-text]').value.trim(); if (!text) { msg.textContent = 'Write the banner text first.'; return; }
      const h = num(el.querySelector('[data-hours]').value);
      await saveConfig({ banner: { text, until: h ? Date.now() + h * 36e5 : 0 } }); msg.textContent = 'The banner is showing now.';
    };
    el.querySelector('[data-off]').onclick = async () => { await saveConfig({ banner: null }); msg.textContent = 'Banner taken down.'; };
  }

  function switchTab(el) {
    const names = Object.keys(STE.features);
    if (!names.length) { el.innerHTML = '<p class="ste-muted">This app has no feature switches yet. When a new feature is added, it can come with a switch here so you can try it on your phone first.</p>'; return; }
    const cur = cfg.switches || {};
    el.innerHTML = `<p class="ste-muted">"Only my phone" lets you try a feature before everyone gets it.</p>
      <table class="ste-table">${names.map(n => `<tr><td>${esc(STE.features[n])}</td><td style="width:11rem"><select data-sw="${esc(key(n))}">${[['off', 'Off'], ['owner', 'Only my phone'], ['all', 'Everyone']].map(([v, t]) => `<option value="${v}"${(cur[key(n)] || 'off') === v ? ' selected' : ''}>${t}</option>`).join('')}</select></td></tr>`).join('')}</table>
      <p data-msg class="ste-muted"></p>`;
    el.querySelectorAll('[data-sw]').forEach(s => s.onchange = async () => {
      const switches = { ...(cfg.switches || {}), [s.dataset.sw]: s.value };
      await saveConfig({ switches }); el.querySelector('[data-msg]').textContent = 'Saved. Players get it the next time they open the app.';
    });
  }

  function phoneTab(el) {
    el.innerHTML = `<p>This phone is unlocked for the owner tools in every app on thespectrumtechengine.com.</p>
      <label style="display:flex;gap:.5rem;align-items:center;margin-top:.6rem"><input type="checkbox" data-me style="width:auto"${local.get('count-me', false) ? ' checked' : ''}> Count my own use in the numbers</label>
      <div class="ste-row"><button class="ste-btn danger" data-lock>Lock this phone</button></div><p data-msg class="ste-muted"></p>`;
    el.querySelector('[data-me]').onchange = e => local.set('count-me', e.target.checked);
    el.querySelector('[data-lock]').onclick = async () => {
      try { const { fsM, db, uid } = await fb(); await fsM.deleteDoc(fsM.doc(db, 'admins', uid)); } catch (_) {}
      owner = false; local.set('owner', false);
      el.querySelector('[data-msg]').textContent = 'Locked. Tap the badge 5 times and enter the code to unlock again.';
    };
  }

  /* ---------------- what the app can call ---------------- */
  Object.assign(STE, {
    loaded: true, app: APP,
    track(name, n = 1) { bump(name, n); },
    detail(name, n = 1) { const k = key(name); if (k) bump('d_' + k, n); },
    value(name, v) { const k = key(name); if (k && Number.isFinite(+v)) { bump('v_' + k + '_sum', +v); bump('v_' + k + '_n', 1); } },
    feature: featureOn,
    isOwner: () => owner,
    openOwner,
  });
  addEventListener('appinstalled', () => bump('installs'));

  // count this open, then load the owner's messages once the app has had its moment
  bump('opens'); bump('opens_' + KIND);
  const start = () => setTimeout(() => { seePhone(); loadConfig(); flush(); }, 1500);
  if (document.readyState === 'complete') start(); else addEventListener('load', start);
})();
