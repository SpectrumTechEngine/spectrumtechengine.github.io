/* =========================================================
   STE Owner: usage numbers and owner tools for every
   Spectrum Tech Engine app (thespectrumtechengine.com)

   Add to an app with:
     <script src="https://thespectrumtechengine.com/ste-owner.js" data-app="archer-duel" defer></script>

   What it sends (to the Firebase project "ste-owner"): only numbers.
   - each day, per app: opens (website / installed / Android app), plays, shares, installs,
     how many phones used it and how many were new, plus the app's own details
     (e.g. which place was picked, average score)
   - visitors: country (guessed from the phone's time zone; no IP address or location is used),
     where they came from (Google, WhatsApp, another site...), phone type, the hour and weekday
     they opened it, how long they stayed, whether they came back a week later, and short
     error messages when the app breaks (at most 3 per visit)
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
     STE.feedback()               open the "Send feedback" box (messages land in the owner tools)

   data-count="off" on the script tag: don't count this page (used by the /owner/ dashboard).
   On the main site (data-app="site") and /owner/, the owner panel also loads ste-owner-site.js:
   the all-apps dashboard, the everywhere banner, app of the week, feedback and Android builds.
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
  // Live sites: the main domain plus apps with their own domain (lanternrooms.org = Lantern)
  const LIVE = /(^|\.)(thespectrumtechengine\.com|lanternrooms\.org)$/i.test(location.hostname) || NATIVE || new URLSearchParams(location.search).has('ste-live');
  const KIND = NATIVE ? 'apk' : (matchMedia('(display-mode: standalone)').matches || navigator.standalone) ? 'installed' : 'web';
  const COUNT = !(me && me.dataset.count === 'off'); // the owner dashboard page doesn't count itself
  const ALL = 'all-apps';                               // settings that reach every app at once (the everywhere banner)
  const SITE_TOOLS = APP === 'site' || APP === 'owner'; // the main site and /owner/ also get the all-apps tools
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
    if (!LIVE || !COUNT || (owner && !local.get('count-me', false))) return;
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
        try {
          while (all.length) {
            const part = all.splice(0, 20), data = {}; // the rules allow a few numbers per write
            for (const [f, n] of part) data[f] = fsM.increment(n);
            await fsM.setDoc(fsM.doc(db, 'apps', APP, 'days', d), data, { merge: true });
            for (const [f] of part) delete pending[d][f];
            local.set('pending-' + APP, pending);
          }
        } catch (e) { if (e && e.code !== 'permission-denied') throw e; } // a refused day (e.g. full) is dropped, not retried forever
        delete pending[d]; local.set('pending-' + APP, pending);
      }
    } catch (e) { console.warn('STE: numbers will be sent later', e); }
    finally { flushing = false; }
  }

  /* ---------------- visitors: country, where from, phone type, busy times, time spent, errors ---------------- */
  // Country from the phone's time zone setting: no IP address or location is ever looked at
  const TZ = Object.fromEntries(('Dublin ie London gb Belfast gb Isle_of_Man im Jersey je Guernsey gg Gibraltar gi Paris fr Berlin de Busingen de '
    + 'Madrid es Canary es Ceuta es Lisbon pt Madeira pt Azores pt Rome it Vatican va San_Marino sm Malta mt Amsterdam nl Brussels be '
    + 'Luxembourg lu Zurich ch Vaduz li Vienna at Prague cz Warsaw pl Budapest hu Bratislava sk Ljubljana si Zagreb hr Belgrade rs '
    + 'Sarajevo ba Skopje mk Podgorica me Tirane al Athens gr Sofia bg Bucharest ro Chisinau md Kiev ua Kyiv ua Minsk by Vilnius lt '
    + 'Riga lv Tallinn ee Helsinki fi Mariehamn ax Stockholm se Oslo no Copenhagen dk Faroe fo Reykjavik is Moscow ru Kaliningrad ru '
    + 'Samara ru Yekaterinburg ru Novosibirsk ru Vladivostok ru Istanbul tr Nicosia cy Famagusta cy Monaco mc Andorra ad '
    + 'New_York us Chicago us Denver us Los_Angeles us Phoenix us Anchorage us Honolulu us Detroit us Boise us Juneau us Adak us '
    + 'Toronto ca Montreal ca Vancouver ca Edmonton ca Calgary ca Winnipeg ca Regina ca Halifax ca St_Johns ca Moncton ca Whitehorse ca '
    + 'Mexico_City mx Cancun mx Tijuana mx Monterrey mx Merida mx Chihuahua mx Sao_Paulo br Bahia br Fortaleza br Recife br Manaus br '
    + 'Santiago cl Bogota co Lima pe Caracas ve Montevideo uy Asuncion py La_Paz bo Guayaquil ec Panama pa Costa_Rica cr '
    + 'Jamaica jm Puerto_Rico pr Havana cu Santo_Domingo do Barbados bb Port_of_Spain tt Nassau bs Bermuda bm '
    + 'Kolkata in Calcutta in Karachi pk Dhaka bd Dubai ae Muscat om Riyadh sa Qatar qa Bahrain bh Kuwait kw Baghdad iq Amman jo '
    + 'Beirut lb Jerusalem il Tel_Aviv il Gaza ps Hebron ps Tehran ir Kabul af Tashkent uz Almaty kz Tbilisi ge Yerevan am Baku az '
    + 'Shanghai cn Urumqi cn Hong_Kong hk Macau mo Taipei tw Tokyo jp Seoul kr Pyongyang kp Ulaanbaatar mn Singapore sg '
    + 'Kuala_Lumpur my Manila ph Jakarta id Makassar id Jayapura id Bangkok th Ho_Chi_Minh vn Saigon vn Phnom_Penh kh Vientiane la '
    + 'Yangon mm Rangoon mm Kathmandu np Katmandu np Colombo lk Thimphu bt Maldives mv Brunei bn Dili tl '
    + 'Auckland nz Chatham nz Fiji fj Port_Moresby pg Guam gu Tongatapu to Apia ws Noumea nc Tahiti pf '
    + 'Lagos ng Johannesburg za Nairobi ke Cairo eg Casablanca ma Accra gh Algiers dz Tunis tn Tripoli ly Khartoum sd Addis_Ababa et '
    + 'Kampala ug Dar_es_Salaam tz Kigali rw Lusaka zm Harare zw Maputo mz Windhoek na Gaborone bw Kinshasa cd Luanda ao Dakar sn '
    + 'Abidjan ci Douala cm Mauritius mu Reunion re').split(' ').reduce((a, v, i, s) => (i % 2 || a.push([v, s[i + 1]]), a), []));
  function country() {
    let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
    const p = tz.split('/');
    if (p[0] === 'Australia') return 'au';
    if (p[0] === 'US' || ['Indiana', 'Kentucky', 'North_Dakota'].includes(p[1])) return 'us';
    if (p[0] === 'Canada') return 'ca';
    if (p[1] === 'Argentina' || p[0] === 'America' && p[1] === 'Buenos_Aires') return 'ar';
    if (TZ[p[p.length - 1]]) return TZ[p[p.length - 1]];
    const m = /-([A-Za-z]{2})\b/.exec(navigator.language || ''); // no match: fall back to the phone's language region
    return m ? m[1].toLowerCase() : 'zz';
  }
  function phoneType() {
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return /mobile/i.test(ua) ? 'android' : 'android_tablet';
    if (/iphone|ipod/i.test(ua)) return 'iphone';
    if (/ipad/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ipad';
    if (/windows/i.test(ua)) return 'windows';
    if (/cros/i.test(ua)) return 'chromebook';
    if (/mac os/i.test(ua)) return 'mac';
    if (/linux/i.test(ua)) return 'linux';
    return 'other';
  }
  const SOURCES = [['android.gm', 'email'], ['outlook', 'email'], ['hotmail', 'email'], ['live.com', 'email'], ['mail.', 'email'],
    ['google', 'google'], ['bing', 'bing'], ['duckduckgo', 'duckduckgo'], ['yahoo', 'yahoo'], ['ecosia', 'ecosia'], ['whatsapp', 'whatsapp'],
    ['facebook', 'facebook'], ['fb.', 'facebook'], ['messenger', 'facebook'], ['instagram', 'instagram'], ['tiktok', 'tiktok'],
    ['reddit', 'reddit'], ['t.co', 'x'], ['twitter', 'x'], ['x.com', 'x'], ['linkedin', 'linkedin'], ['youtube', 'youtube'],
    ['pinterest', 'pinterest'], ['snapchat', 'snapchat'], ['github', 'github'], ['chatgpt', 'ai_chat'], ['openai', 'ai_chat'],
    ['claude.ai', 'ai_chat'], ['perplexity', 'ai_chat'], ['gemini', 'ai_chat'], ['copilot', 'ai_chat']];
  function cameFrom() {
    if (KIND === 'apk') return 'android_app';
    if (KIND === 'installed') return 'home_screen';
    const q = new URLSearchParams(location.search), tag = key(q.get('from') || q.get('utm_source') || '').slice(0, 16);
    if (tag) return 'tag_' + tag; // links you share can say where they're from, e.g. ?from=poster
    let ref = null; try { ref = new URL(document.referrer); } catch (_) {}
    if (!ref) return 'direct';
    const h = ref.hostname.replace(/^www\./, ''), seg = u => (u.pathname.split('/')[1] || '').toLowerCase();
    if (/(^|\.)(thespectrumtechengine\.com|lanternrooms\.org)$/.test(h)) return h === location.hostname.replace(/^www\./, '') && seg(ref) === seg(location) ? null : 'ste_site';
    if (h === location.hostname) return null; // moving around inside the same app
    const s = SOURCES.find(([m]) => h.includes(m));
    return s ? s[1] : 'other_site';
  }
  function seeVisit() {
    if (!LIVE || !COUNT || (owner && !local.get('count-me', false))) return;
    const now = new Date();
    bump('hr_' + String(now.getHours()).padStart(2, '0')); // the visitor's own clock
    bump('wd_' + ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()]);
    let fresh = true; try { fresh = !sessionStorage.getItem('ste-arrived-' + APP); sessionStorage.setItem('ste-arrived-' + APP, '1'); } catch (_) {}
    if (fresh) { const src = cameFrom(); if (src) bump('rf_' + src); }
  }
  // how long the app was on screen (an hour or more left open counts as 4 hours at most)
  let shownAt = document.visibilityState === 'visible' ? Date.now() : 0, visitCounted = false;
  function addTime() {
    if (!shownAt) return;
    const s = Math.round(Math.min(Date.now() - shownAt, 4 * 36e5) / 1000); shownAt = 0;
    if (s < 3) return;
    bump('time_s', s); if (!visitCounted) { visitCounted = true; bump('time_n'); }
  }
  // errors: a short version of the message, at most 3 per visit
  let errCount = 0;
  function noteError(msg, file) {
    msg = String(msg || '').replace(/^Uncaught\s+/i, '').trim();
    if (errCount >= 3 || !msg || /^Script error\.?$/i.test(msg) || /ResizeObserver loop/i.test(msg)) return;
    if (file && !/^https?:/i.test(file)) return; // browser add-ons, not the app
    errCount++; bump('errors');
    const k = key(msg).slice(0, 36); if (k) bump('er_' + k);
  }
  addEventListener('error', e => { if (e && e.message) noteError(e.message, e.filename); });
  addEventListener('unhandledrejection', e => { const r = e && e.reason; if (r) noteError(r.message || String(r), ''); });

  addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') shownAt = Date.now(); else { addTime(); flush(); } });
  addEventListener('pagehide', () => { addTime(); flush(); });

  // one entry per phone, and today's "phones" / "new phones" numbers
  async function seePhone() {
    if (!LIVE || !COUNT || (owner && !local.get('count-me', false))) return;
    const today = day(), seen = local.get('seen-' + APP, null);
    if (seen === today) return;
    bump('phones'); if (!seen) bump('new_phones');
    bump('cc_' + country()); bump('ph_' + phoneType());
    // came back a week or more after its first day (counted once per phone)
    let first = local.get('first-' + APP, null);
    if (!first) { first = today; local.set('first-' + APP, first); }
    if (seen && !local.get('back-' + APP, false) && Date.parse(today) - Date.parse(first) >= 7 * 864e5) { bump('came_back'); local.set('back-' + APP, true); }
    local.set('seen-' + APP, today);
    try {
      const { fsM, db, uid } = await fb();
      const data = { last: today, kind: KIND, days: fsM.increment(1) };
      if (!seen) data.first = today;
      await fsM.setDoc(fsM.doc(db, 'apps', APP, 'devices', uid), data, { merge: true });
    } catch (e) { console.warn(e); }
  }

  /* ---------------- messages from the owner: pop-up, banner, switches ---------------- */
  let cfg = local.get('cfg-' + APP, {}), allCfg = local.get('cfg-' + ALL, {});
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
      const g = await fsM.getDoc(fsM.doc(db, 'apps', ALL, 'config', 'main')).catch(() => null);
      if (g) { allCfg = g.exists() ? g.data() : {}; local.set('cfg-' + ALL, allCfg); }
      showBanner(); showNotice();
      document.dispatchEvent(new CustomEvent('ste-config', { detail: cfg }));
    } catch (e) { console.warn(e); }
  }
  function live(x) { return x && x.text && (!x.until || x.until > Date.now()); }
  function showBanner() {
    let b = document.getElementById('ste-banner');
    // this app's own banner wins; otherwise the everywhere banner
    const ban = live(cfg.banner) ? cfg.banner : live(allCfg.banner) ? allCfg.banner : null;
    if (!ban || sessionStorage.getItem('ste-banner-x') === ban.text) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('div'); b.id = 'ste-banner'; b.setAttribute('role', 'status'); document.body.appendChild(b); }
    b.innerHTML = `<span>${esc(ban.text)}</span><button type="button" aria-label="Hide this message">×</button>`;
    b.querySelector('button').onclick = () => { try { sessionStorage.setItem('ste-banner-x', ban.text); } catch (_) {} b.remove(); };
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
  .ste-card.wider{width:min(100%,52rem)}
  .ste-layer.full{padding:0;background:#16131c}
  .ste-layer.full .ste-card{width:min(100%,60rem);height:100dvh;max-height:none;border-radius:0;padding:calc(18px + env(safe-area-inset-top,0px)) 16px 24px}
  .ste-table th[data-sort]{cursor:pointer;text-decoration:underline dotted}
  .ste-table td a{color:inherit}
  .ste-fb{border:1.5px solid #ece5da;border-radius:12px;padding:.6rem .7rem;margin:.5rem 0}
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
    .ste-table th,.ste-table td,.ste-fb{border-color:#3d362e}
    .ste-err{color:#ff8a6a}
  }`;
  document.head.appendChild(css);

  function layer(html, wide) {
    const l = document.createElement('div'); l.className = 'ste-layer' + (wide === 'full' ? ' full' : '');
    l.innerHTML = `<div class="ste-card${wide ? ' wide' : ''}${wide === 'wider' ? ' wider' : ''}" role="dialog" aria-modal="true">${html}</div>`;
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

  async function ownerPanel() {
    // the main site and /owner/ add the all-apps tools (dashboard, everywhere banner, app of the week, feedback, builds)
    let site = [];
    if (SITE_TOOLS) try { site = (await import(new URL('ste-owner-site.js', me.src).href)).default(api); } catch (e) { console.warn('STE: all-apps tools not loaded', e); }
    const own = APP === 'owner' ? [] : [['Stats', statsTab], ['Visitors', visitorsTab], ['Players', playersTab], ['Pop-up', popupTab], ['Banner', bannerTab], ['Switches', switchTab]];
    const tabs = [...site, ...own, ...STE.ownerTabs.map(t => [t.title, t.render]), ['This phone', phoneTab]];
    const title = APP === 'owner' ? 'Owner dashboard' : APP === 'site' ? 'Owner tools: main website' : 'Owner tools: ' + (document.title.split(':')[0] || APP);
    const l = layer(`<div class="ste-top"><h2>${esc(title)}</h2><button class="ste-x" data-x aria-label="Close">×</button></div>
      <div class="ste-tabs" role="tablist">${tabs.map(([t], i) => `<button role="tab" data-t="${i}" aria-selected="${i === 0}">${esc(t)}</button>`).join('')}</div><div data-body></div>`, APP === 'owner' ? 'full' : SITE_TOOLS ? 'wider' : true);
    l.querySelector('[data-x]').onclick = () => { l.remove(); document.dispatchEvent(new Event('ste-owner-closed')); };
    const body = l.querySelector('[data-body]');
    const show = i => { l.querySelectorAll('[data-t]').forEach(b => b.setAttribute('aria-selected', b.dataset.t == i)); body.innerHTML = '<p class="ste-muted">Loading…</p>'; Promise.resolve(tabs[i][1](body, api)).catch(e => { console.warn(e); body.innerHTML = `<p class="ste-err">That couldn't be loaded. ${esc(e && e.code === 'permission-denied' ? 'This phone is no longer unlocked.' : 'Check the internet connection.')}</p>`; }); };
    l.querySelector('[role=tablist]').onclick = e => { const b = e.target.closest('[data-t]'); if (b) show(+b.dataset.t); };
    show(0);
  }
  const api = { fb, APP, ALL, day, daysAgo, esc, num, live, layer, saveConfig, saveConfigFor, getConfig, readDays, feedbackList, feedbackDelete, visitorsHTML };
  async function saveConfig(patch) { return saveConfigFor(APP, patch); }
  async function saveConfigFor(app, patch) {
    const { fsM, db } = await fb();
    await fsM.setDoc(fsM.doc(db, 'apps', app, 'config', 'main'), patch, { merge: true });
    if (app === APP) { Object.assign(cfg, patch); local.set('cfg-' + APP, cfg); }
    if (app === ALL) { Object.assign(allCfg, patch); local.set('cfg-' + ALL, allCfg); }
    showBanner();
    if (app === APP) document.dispatchEvent(new CustomEvent('ste-config', { detail: cfg }));
  }
  async function getConfig(app) {
    const { fsM, db } = await fb();
    const s = await fsM.getDoc(fsM.doc(db, 'apps', app, 'config', 'main'));
    return s.exists() ? s.data() : {};
  }
  async function feedbackList(n) {
    const { fsM, db } = await fb();
    const snap = await fsM.getDocs(fsM.query(fsM.collection(db, 'feedback'), fsM.orderBy('at', 'desc'), fsM.limit(n)));
    return snap.docs.map(d => ({ id: d.id, ...d.data(), at: d.data().at && d.data().at.toMillis ? d.data().at.toMillis() : 0 }));
  }
  async function feedbackDelete(id) { const { fsM, db } = await fb(); await fsM.deleteDoc(fsM.doc(db, 'feedback', id)); }
  async function readDays(n, app = APP) {
    const { fsM, db } = await fb();
    const q = fsM.query(fsM.collection(db, 'apps', app, 'days'), fsM.where(fsM.documentId(), '>=', daysAgo(n - 1)));
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

  /* ---------------- Visitors: one app, or (from ste-owner-site.js) every app together ---------------- */
  const SRC_NAME = { direct: 'No link info (typed in, a bookmark, or a link in WhatsApp or another app)', home_screen: 'Home-screen app',
    android_app: 'Android app', ste_site: 'Your main site or another of your apps', google: 'Google', bing: 'Bing', ai_chat: 'AI chat (ChatGPT etc.)',
    other_site: 'Other websites', email: 'Email', x: 'X (Twitter)', duckduckgo: 'DuckDuckGo' };
  const PH_NAME = { android: 'Android phone', android_tablet: 'Android tablet', iphone: 'iPhone', ipad: 'iPad', windows: 'Windows computer',
    mac: 'Mac', chromebook: 'Chromebook', linux: 'Linux computer', other: 'Other' };
  const words = k => k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  const flag = cc => /^[a-z]{2}$/.test(cc) && cc !== 'zz' ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 127397 + c.charCodeAt(0))) + ' ' : '';
  function countryName(cc) {
    if (cc === 'zz') return 'Unknown';
    try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(cc.toUpperCase()) || cc.toUpperCase(); } catch (_) { return cc.toUpperCase(); }
  }
  function visitorsHTML(dayRows) { // dayRows: [[day, numbers], ...] from one app or many
    const in30 = dayRows.filter(([d]) => d >= daysAgo(29)).map(([, r]) => r);
    const cohort = dayRows.filter(([d]) => d <= daysAgo(7) && d >= daysAgo(36)).map(([, r]) => r);
    const pre = p => { const o = {}; for (const r of in30) for (const [k, v] of Object.entries(r)) if (k.startsWith(p)) o[k.slice(p.length)] = num(o[k.slice(p.length)]) + num(v); return o; };
    const bars = (o, name, n = 15) => {
      const top = Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n), max = top.length ? top[0][1] : 1, all = Object.values(o).reduce((a, v) => a + v, 0) || 1;
      return top.length ? `<table class="ste-table">${top.map(([k, v]) => `<tr><td>${name(k)}</td><td style="width:38%"><div class="ste-bar" style="width:${Math.round(v / max * 100)}%"></div></td><td>${v}</td><td class="ste-muted">${Math.round(v / all * 100)}%</td></tr>`).join('')}</table>` : '<p class="ste-muted">Nothing yet.</p>';
    };
    const secs = sum(in30, 'time_s'), visits = sum(in30, 'time_n'), back = sum(in30, 'came_back'), newer = sum(cohort, 'new_phones'), errs = sum(in30, 'errors');
    const avg = visits ? secs / visits : 0, avgTxt = visits ? `${Math.floor(avg / 60)}m ${String(Math.round(avg % 60)).padStart(2, '0')}s` : '–';
    const hrs = pre('hr_'), hMax = Math.max(1, ...Object.values(hrs));
    const wd = pre('wd_'), WD = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']], wMax = Math.max(1, ...WD.map(([k]) => num(wd[k])));
    return `
      <div class="ste-tiles">
        <div class="ste-tile"><b>${avgTxt}</b><span>Average visit</span></div>
        <div class="ste-tile"><b>${back}</b><span>Phones that came back a week or more later</span></div>
        <div class="ste-tile"><b>${newer ? Math.min(100, Math.round(back / newer * 100)) + '%' : '–'}</b><span>Rough share of new phones that came back${newer ? ` (${newer} new 1 to 5 weeks ago)` : ''}</span></div>
        <div class="ste-tile"><b>${errs}</b><span>Errors (last 30 days)</span></div>
      </div>
      <h3>Countries</h3>${bars(pre('cc_'), k => esc(flag(k) + countryName(k)))}
      <h3>Where they came from</h3>${bars(pre('rf_'), k => esc(k.startsWith('tag_') ? 'Your link tagged "' + k.slice(4).replace(/_/g, ' ') + '"' : SRC_NAME[k] || words(k)))}
      <h3>Phone type</h3>${bars(pre('ph_'), k => esc(PH_NAME[k] || words(k)))}
      <h3>Busiest hours (their own clock)</h3>
      <div style="display:flex;align-items:flex-end;gap:2px;height:80px">${Array.from({ length: 24 }, (_, h) => { const v = num(hrs[String(h).padStart(2, '0')]); return `<div title="${h}:00 to ${h + 1}:00: ${v}" style="flex:1;height:${Math.max(2, Math.round(v / hMax * 100))}%;background:${v ? '#c8743a' : '#ece5da'};border-radius:3px 3px 0 0"></div>`; }).join('')}</div>
      <div style="display:flex;justify-content:space-between;font-size:.75rem" class="ste-muted"><span>midnight</span><span>6am</span><span>noon</span><span>6pm</span><span>11pm</span></div>
      <h3>Busiest days</h3>
      <table class="ste-table">${WD.map(([k, n]) => `<tr><td>${n}</td><td style="width:50%"><div class="ste-bar" style="width:${Math.round(num(wd[k]) / wMax * 100)}%"></div></td><td>${num(wd[k])}</td></tr>`).join('')}</table>
      <h3>Errors</h3>${bars(pre('er_'), k => esc(k.replace(/_/g, ' ')), 12)}
      <p class="ste-muted">All for the last 30 days. Country is a guess from the phone's time-zone setting (no location or IP address is used).
      Counting of these started on 5 Nov 2026. Errors are shortened messages; tell Claude which app and message to look at.</p>`;
  }
  async function visitorsTab(el) { el.innerHTML = visitorsHTML(Object.entries(await readDays(40))); }

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

  /* ---------------- feedback from players (read in the owner tools on the main site) ---------------- */
  function feedback() {
    const l = layer(`<div class="ste-top"><h2>Send feedback</h2><button class="ste-x" data-x aria-label="Close">×</button></div>
      <p class="ste-muted">Ideas, bugs, a game you'd love to see: Ste reads every message. Please don't put personal details in it. If you'd like a reply, email hello@thespectrumtechengine.com instead.</p>
      <label>Your message <textarea data-text maxlength="1000"></textarea></label>
      <p data-msg class="ste-muted"></p>
      <div class="ste-row"><button class="ste-btn go" data-send>Send</button></div>`);
    const msg = l.querySelector('[data-msg]'), send = l.querySelector('[data-send]'), box = l.querySelector('[data-text]');
    l.querySelector('[data-x]').onclick = () => l.remove();
    setTimeout(() => box.focus(), 50);
    send.onclick = async () => {
      const text = box.value.trim(); if (!text) { msg.textContent = 'Write a message first.'; return; }
      if (Date.now() - num(local.get('fb-at', 0)) < 60000) { msg.textContent = 'Thanks! Please wait a minute before sending another.'; return; }
      send.disabled = true; msg.textContent = 'Sending…';
      try {
        const { fsM, db, uid } = await fb();
        await fsM.addDoc(fsM.collection(db, 'feedback'), { text, app: APP, kind: KIND, uid, at: fsM.serverTimestamp() });
        local.set('fb-at', Date.now());
        l.querySelector('.ste-card').innerHTML = `<h2>Thank you!</h2><p>Your message is on its way to Ste.</p><div class="ste-row"><button class="ste-btn go" data-ok>OK</button></div>`;
        l.querySelector('[data-ok]').onclick = () => l.remove();
      } catch (e) { console.warn(e); msg.textContent = "It couldn't be sent. Check the internet connection and try again."; send.disabled = false; }
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
    feedback,
  });
  document.dispatchEvent(new Event('ste-ready'));
  addEventListener('appinstalled', () => bump('installs'));

  // count this open, then load the owner's messages once the app has had its moment
  bump('opens'); bump('opens_' + KIND); seeVisit();
  const start = () => setTimeout(() => { seePhone(); loadConfig(); flush(); }, 1500);
  if (document.readyState === 'complete') start(); else addEventListener('load', start);
})();
