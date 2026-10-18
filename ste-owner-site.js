/* =========================================================
   STE Owner: the all-apps tools, shown in the owner panel on the main site
   and on the owner dashboard page (thespectrumtechengine.com/owner/).
   ste-owner.js loads this file only when the owner panel opens there.

   New apps appear here by themselves: the list comes from the APPS list
   in the main site's index.html. Only if an app's data-app id is different
   from its web address does it need adding to OWNER_ID below.
   ========================================================= */
const OWNER_ID = { 'erdints-extreme-trucking': 'edunts-extreme-trucking' }; // web address -> data-app id
const GH = 'SpectrumTechEngine';
// apps whose Android app isn't built by their own public repo's android-apk.yml
const BUILD_NOTE = {
  'prescription-meditation': 'Its Android app is on the website, not in GitHub Releases.',
};
// apps kept off the main site's list (shared by link only) but still tracked here
const HIDDEN_APPS = [
  { name: 'Plate Pal', emoji: '🍽️', status: 'live', link: 'https://thespectrumtechengine.com/plate-pal/',
    apk: 'https://github.com/SpectrumTechEngine/plate-pal/releases/latest/download/plate-pal.apk', hidden: true },
  { name: 'Due Date', emoji: '🍼', status: 'live', link: 'https://thespectrumtechengine.com/due-date/', hidden: true },
];

/* ---------------- the app list, straight from the site ---------------- */
let appsP = null;
function siteApps() {
  if (!appsP) appsP = (async () => {
    let list = typeof APPS !== 'undefined' ? APPS : null; // on the main site the list is already on the page
    if (!list) {
      const html = await (await fetch('/index.html', { cache: 'no-cache' })).text();
      const m = html.match(/const APPS = (\[[\s\S]*?\n {2}\]);/);
      if (!m) throw new Error("The app list wasn't found in index.html");
      list = Function('"use strict"; return ' + m[1])();
    }
    return list.concat(HIDDEN_APPS).map(a => {
      const path = (new URL(a.link, location.origin).pathname.split('/').filter(Boolean)[0] || '');
      return { ...a, repo: path, path: path.toLowerCase(), id: OWNER_ID[path.toLowerCase()] || path.toLowerCase() };
    });
  })().catch(e => { appsP = null; throw e; });
  return appsP;
}

const until = u => u ? 'until ' + new Date(u).toLocaleString('en-IE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'until you take it down';
const when = ms => new Date(ms).toLocaleString('en-IE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/* ---------------- All apps: every app's numbers side by side ---------------- */
let sortBy = 'opens7';
async function dashboard(el, api) {
  const { esc, num, daysAgo, day } = api;
  const apps = (await siteApps()).filter(a => a.status === 'live');
  const rows = [{ name: 'Main website', emoji: '🏠', id: 'site', link: '/' }, ...apps];
  const data = await Promise.all(rows.map(a => api.readDays(30, a.id).catch(() => ({}))));
  const from = { today: day(), d7: daysAgo(6), d30: daysAgo(29) };
  const stats = rows.map((a, i) => {
    const days = Object.entries(data[i] || {});
    const s = (f, since) => days.reduce((t, [d, r]) => t + (d >= since ? num(r[f]) : 0), 0);
    return { a, today: s('opens', from.today), opens7: s('opens', from.d7), plays7: s('plays', from.d7), phones7: s('phones', from.d7), new7: s('new_phones', from.d7), opens30: s('opens', from.d30) };
  });
  const COLS = [['today', 'Opens today'], ['opens7', 'Opens 7d'], ['plays7', 'Plays 7d'], ['phones7', 'Phones 7d*'], ['new7', 'New 7d'], ['opens30', 'Opens 30d']];
  const total = f => stats.reduce((t, r) => t + r[f], 0);
  const draw = () => {
    const sorted = [...stats].sort((x, y) => y[sortBy] - x[sortBy]);
    el.innerHTML = `
      <div class="ste-tiles">
        <div class="ste-tile"><b>${total('today')}</b><span>Opens today, all apps</span></div>
        <div class="ste-tile"><b>${total('opens7')}</b><span>Opens, last 7 days</span></div>
        <div class="ste-tile"><b>${total('new7')}</b><span>New phones, last 7 days</span></div>
        <div class="ste-tile"><b>${total('opens30')}</b><span>Opens, last 30 days</span></div>
      </div>
      <h3>Each app (tap a heading to sort)</h3>
      <div class="ste-scroll"><table class="ste-table">
        <tr><th>App</th>${COLS.map(([k, t]) => `<th data-sort="${k}">${sortBy === k ? '▼ ' : ''}${t}</th>`).join('')}</tr>
        ${sorted.map(r => `<tr><td><a href="${esc(r.a.link)}">${esc(r.a.emoji || '')} ${esc(r.a.name)}</a></td>${COLS.map(([k]) => `<td>${r[k]}</td>`).join('')}</tr>`).join('')}
        <tr><th>All apps</th>${COLS.map(([k]) => `<th>${total(k)}</th>`).join('')}</tr>
      </table></div>
      <p class="ste-muted">* A phone used on 3 different days counts 3 times. Your own unlocked phone isn't counted.
      For one app's full details, open it and tap its logo 5 times.</p>`;
    el.querySelectorAll('[data-sort]').forEach(th => th.onclick = () => { sortBy = th.dataset.sort; draw(); });
  };
  draw();
}

/* ---------------- Everywhere banner: one strip across the top of every app ---------------- */
async function everywhere(el, api) {
  const { esc, num } = api;
  const b = (await api.getConfig(api.ALL)).banner || {};
  const on = api.live(b);
  el.innerHTML = `<p class="ste-muted">A strip across the top of <b>every</b> app at once, e.g. "Leaderboards are down for maintenance tonight". If an app has its own banner, that one shows there instead.</p>
    <label>Banner text <input data-text maxlength="140" value="${esc(on ? b.text : '')}"></label>
    <label>Show it for <select data-hours><option value="2">2 hours</option><option value="24" selected>1 day</option><option value="168">7 days</option><option value="0">Until I take it down</option></select></label>
    <div class="ste-row"><button class="ste-btn go" data-on>Show on every app</button><button class="ste-btn danger" data-off>Take it down</button></div>
    <p data-msg class="ste-muted">${on ? 'Showing now, ' + until(b.until) + '.' : 'No everywhere banner showing.'}</p>`;
  const msg = el.querySelector('[data-msg]');
  el.querySelector('[data-on]').onclick = async () => {
    const text = el.querySelector('[data-text]').value.trim(); if (!text) { msg.textContent = 'Write the banner text first.'; return; }
    const h = num(el.querySelector('[data-hours]').value), u = h ? Date.now() + h * 36e5 : 0;
    await api.saveConfigFor(api.ALL, { banner: { text, until: u } });
    msg.textContent = 'Showing on every app, ' + until(u) + '. People see it the next time they open an app.';
  };
  el.querySelector('[data-off]').onclick = async () => { await api.saveConfigFor(api.ALL, { banner: null }); msg.textContent = 'Everywhere banner taken down.'; };
}

/* ---------------- App of the week: pinned to the top of the main site ---------------- */
async function spotlight(el, api) {
  const { esc, num } = api;
  const [apps, cfg] = await Promise.all([siteApps(), api.getConfig('site')]);
  const s = cfg.spotlight || {}, on = s.path && (!s.until || s.until > Date.now());
  const live = apps.filter(a => a.status === 'live' && !a.hidden); // hidden apps never go on the main site
  el.innerHTML = `<p class="ste-muted">Pins one app to the top of its list on the main site, with a gold "App of the week" glow and a link under the big logo.</p>
    <label>Which app <select data-app>${live.map(a => `<option value="${esc(a.path)}"${on && s.path === a.path ? ' selected' : ''}>${esc(a.emoji)} ${esc(a.name)}</option>`).join('')}</select></label>
    <label>For how long <select data-days><option value="7" selected>7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="0">Until I take it down</option></select></label>
    <div class="ste-row"><button class="ste-btn go" data-on>Make it app of the week</button><button class="ste-btn danger" data-off>Remove</button></div>
    <p data-msg class="ste-muted">${on ? `Now: ${esc((apps.find(a => a.path === s.path) || {}).name || s.path)}, ${until(s.until)}.` : 'No app of the week right now.'}</p>`;
  const msg = el.querySelector('[data-msg]');
  el.querySelector('[data-on]').onclick = async () => {
    const path = el.querySelector('[data-app]').value, d = num(el.querySelector('[data-days]').value), u = d ? Date.now() + d * 864e5 : 0;
    await api.saveConfigFor('site', { spotlight: { path, until: u } });
    msg.textContent = `Done: ${(apps.find(a => a.path === path) || {}).name}, ${until(u)}. Visitors see it the next time they open the site.`;
  };
  el.querySelector('[data-off]').onclick = async () => { await api.saveConfigFor('site', { spotlight: null }); msg.textContent = 'Removed. The site goes back to its normal order.'; };
}

/* ---------------- Feedback inbox ---------------- */
async function inbox(el, api) {
  const { esc } = api;
  const [items, apps] = await Promise.all([api.feedbackList(100), siteApps().catch(() => [])]);
  const name = id => id === 'site' ? 'Main website' : id === 'owner' ? 'Owner page' : ((apps.find(a => a.id === id) || {}).name || id);
  const KIND = { web: 'website', installed: 'installed web app', apk: 'Android app' };
  if (!items.length) { el.innerHTML = '<p class="ste-muted">No feedback yet. Players send it with the "Send feedback" button at the bottom of the main site.</p>'; return; }
  el.innerHTML = `<p class="ste-muted">${items.length} message${items.length === 1 ? '' : 's'}, newest first${items.length === 100 ? ' (showing the latest 100)' : ''}. Delete them once you've read them.</p>
    ${items.map(f => `<div class="ste-fb" data-id="${esc(f.id)}">
      <p class="ste-muted">${f.at ? esc(when(f.at)) : 'just now'} · from ${esc(name(f.app))}${KIND[f.kind] ? ' (' + KIND[f.kind] + ')' : ''}</p>
      <p class="ste-pre">${esc(f.text)}</p>
      <div class="ste-row"><button class="ste-btn danger" data-del>Delete</button></div></div>`).join('')}`;
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const box = b.closest('[data-id]'); b.disabled = true;
    try { await api.feedbackDelete(box.dataset.id); box.remove(); } catch (e) { b.disabled = false; b.textContent = "Couldn't delete, try again"; }
  });
}

/* ---------------- Android builds: the latest build of each app on GitHub ---------------- */
async function builds(el, api, fresh) {
  const { esc } = api;
  const apps = (await siteApps()).filter(a => a.status === 'live' && a.apk);
  let cache = null; try { cache = JSON.parse(localStorage.getItem('ste-builds') || 'null'); } catch (_) {}
  let res, limited = false;
  if (!fresh && cache && Date.now() - cache.at < 15 * 60000) res = cache.res;
  else {
    res = await Promise.all(apps.map(async a => {
      if (BUILD_NOTE[a.path]) return { note: BUILD_NOTE[a.path] };
      try {
        const r = await fetch(`https://api.github.com/repos/${GH}/${a.repo}/actions/workflows/android-apk.yml/runs?per_page=1&branch=main`);
        if (r.status === 404) return { note: 'No Android build in its public repo (it may be built from a private one).' };
        if (r.status === 403 || r.status === 429) { limited = true; return { note: 'GitHub says "too many checks", try again in an hour.' }; }
        const run = ((await r.json()).workflow_runs || [])[0];
        if (!run) return { note: 'No builds yet.' };
        return { status: run.status, result: run.conclusion, at: Date.parse(run.updated_at || run.created_at), url: run.html_url };
      } catch (_) { return { note: "Couldn't reach GitHub." }; }
    }));
    if (!limited) try { localStorage.setItem('ste-builds', JSON.stringify({ at: Date.now(), res })); } catch (_) {}
  }
  const label = r => r.note ? `<span class="ste-muted">${esc(r.note)}</span>`
    : r.status !== 'completed' ? '⏳ Building now'
    : r.result === 'success' ? '✅ Built OK' : r.result === 'failure' ? '❌ <b>Failed</b>' : esc(r.result || r.status);
  el.innerHTML = `<p class="ste-muted">The last Android build of each app. Every push to GitHub makes a new one.</p>
    <div class="ste-scroll"><table class="ste-table"><tr><th>App</th><th>Last build</th><th>Result</th></tr>
    ${apps.map((a, i) => { const r = res[i] || {}; return `<tr><td>${esc(a.emoji)} ${esc(a.name)}</td><td>${r.at ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(when(r.at))}</a>` : ''}</td><td>${label(r)}</td></tr>`; }).join('')}
    </table></div>
    <div class="ste-row"><button class="ste-btn" data-again>Check again</button></div>
    <p class="ste-muted">GitHub allows about 3 checks an hour from one phone, so results are kept for 15 minutes.</p>`;
  el.querySelector('[data-again]').onclick = () => { el.innerHTML = '<p class="ste-muted">Checking…</p>'; builds(el, api, true); };
}

export default api => [
  ['All apps', el => dashboard(el, api)],
  ['Everywhere banner', el => everywhere(el, api)],
  ['App of the week', el => spotlight(el, api)],
  ['Feedback', el => inbox(el, api)],
  ['Builds', el => builds(el, api)],
];
