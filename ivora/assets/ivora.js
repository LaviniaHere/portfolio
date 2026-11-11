// IVORA：输入密码后在浏览器里解密页面、图片和视频（PBKDF2-SHA256 + AES-256-GCM）。
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  let key = null, man = null;
  const cache = new Map();

  /* 访问统计 */
  const who = (() => {
    try { return ((new URLSearchParams(location.search).get('s') || '').match(/^[a-z0-9]{4,12}$/) || [''])[0]; }
    catch { return ''; }
  })();
  const CFG = window.LAVINIA_CONFIG || {};
  if (CFG.umamiId) {
    const s = document.createElement('script');
    s.defer = true; s.src = CFG.umamiSrc; s.dataset.websiteId = CFG.umamiId;
    document.head.append(s);
  }
  function track(name, data = {}) {
    try { if (window.umami && typeof umami.track === 'function') umami.track(name, { 页面: 'IVORA', 来源: who || '未标记', ...data }); } catch {}
  }
  let shownAt = 0, activeMs = 0, unlocked = false;
  const seen = new Set();
  const flushTime = () => { if (shownAt) { activeMs += performance.now() - shownAt; shownAt = 0; } };
  function report() {
    if (!unlocked) return;
    flushTime();
    track('离开', { 停留秒数: Math.round(activeMs / 1000), 看过: [...seen].join('、') || '只看了开头' });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') report();
    else if (unlocked) shownAt = performance.now();
  });
  addEventListener('pagehide', report);

  /* 解密 */
  // 每个密码各有一个钥匙槽：用密码解开槽，得到内容钥匙 + 到期时间（到期时间和钥匙一起加密，改不了）
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function deriveKey(pw) {
    const meta = await (await fetch('data/meta.json', { cache: 'no-store' })).json();
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    let expired = false;
    for (const s of meta.slots) {
      const k = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(s.salt), iterations: meta.iter, hash: 'SHA-256' }, base,
        { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      const w = b64(s.key);
      let raw;
      try { raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: w.slice(0, 12) }, k, w.slice(12))); }
      catch { continue; }
      const exp = Number(new DataView(raw.buffer).getBigUint64(32));
      if (exp && Date.now() > exp) { expired = true; continue; }
      return crypto.subtle.importKey('raw', raw.slice(0, 32), 'AES-GCM', false, ['decrypt']);
    }
    const e = new Error(expired ? 'expired' : 'wrong'); e.name = expired ? 'Expired' : 'OperationError'; throw e;
  }
  async function dec(id) {
    const res = await fetch(`data/${id}.bin`, { cache: id === 'manifest' ? 'no-store' : 'force-cache' });
    if (!res.ok) throw new Error('missing');
    const buf = new Uint8Array(await res.arrayBuffer());
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12));
  }
  function url(path) {
    if (!cache.has(path)) {
      const f = man.files[path];
      cache.set(path, f ? dec(f.id).then((b) => URL.createObjectURL(new Blob([b], { type: f.mime }))) : Promise.reject(new Error(path)));
    }
    return cache.get(path);
  }

  /* 防盗：作品区域禁右键、拖拽、Ctrl+S */
  const guarded = (el) => el.closest && el.closest('.protect, .lb, img, video');
  document.addEventListener('contextmenu', (e) => { if (guarded(e.target)) e.preventDefault(); });
  document.addEventListener('dragstart', (e) => { if (guarded(e.target)) e.preventDefault(); });
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') e.preventDefault(); });

  /* 大图（用背景图显示，不给能直接另存的 img） */
  const lb = $('#lb'), stage = $('#lb-stage'), cap = $('#lb-cap');
  let list = [], idx = 0, lastFocus = null;
  async function show() {
    const it = list[idx];
    stage.replaceChildren();
    cap.textContent = it.caption || '';
    $('#lb-prev').hidden = $('#lb-next').hidden = list.length < 2;
    const d = document.createElement('div');
    d.className = 'pic';
    stage.append(d);
    d.style.backgroundImage = `url("${await url(it.path)}")`;
  }
  function openLB(items, i = 0) {
    track('看大图', { 图: (items[i] && items[i].caption) || '' });
    list = items; idx = i; lastFocus = document.activeElement;
    lb.hidden = false; document.body.style.overflow = 'hidden';
    show(); $('#lb-x').focus();
  }
  function closeLB() {
    lb.hidden = true; stage.replaceChildren(); document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }
  const step = (d) => { idx = (idx + d + list.length) % list.length; show(); };
  $('#lb-x').addEventListener('click', closeLB);
  $('#lb-prev').addEventListener('click', () => step(-1));
  $('#lb-next').addEventListener('click', () => step(1));
  lb.addEventListener('click', (e) => { if (e.target === lb || e.target === stage) closeLB(); });
  document.addEventListener('keydown', (e) => {
    if (lb.hidden) return;
    if (e.key === 'Escape') closeLB();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });

  function initPage(app) {
    // 图片：快滚到时再解密
    const io = new IntersectionObserver((ents) => ents.forEach((en) => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      url(en.target.dataset.src).then((u) => {
        en.target.onload = () => en.target.classList.add('on');
        en.target.src = u;
      }).catch(() => {});
    }), { rootMargin: '900px 0px' });
    $$('img[data-src]', app).forEach((im) => io.observe(im));

    const nav = $('.nav', app);
    const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
    $('#relock', app).addEventListener('click', () => {
      try { sessionStorage.removeItem('iv-pw'); } catch {}
      location.reload();
    });

    const sio = new IntersectionObserver((ents) => ents.forEach((en) => {
      if (!en.isIntersecting) return;
      const n = en.target.dataset.track;
      if (!seen.has(n)) { seen.add(n); track('看到', { 部分: n }); }
    }), { threshold: 0.3 });
    $$('[data-track]', app).forEach((el) => sio.observe(el));

    // 成片：点了才解密
    $$('.video[data-video]', app).forEach((box) => $('.play', box).addEventListener('click', async () => {
      track('播放视频', { 视频: 'IVORA TVC' });
      const sp = $('.play span', box); sp.textContent = '加载中…';
      const v = document.createElement('video');
      Object.assign(v, { controls: true, autoplay: true, playsInline: true, disablePictureInPicture: true });
      v.setAttribute('controlslist', 'nodownload noplaybackrate');
      v.src = await url(box.dataset.video);
      box.replaceChildren(v);
    }));

    // 大图：同一组图可以左右翻
    $$('.gallery', app).forEach((g) => {
      const figs = $$('.ph', g).filter((f) => getComputedStyle(f).display !== 'none');
      const items = figs.map((f) => ({ path: $('img', f).dataset.src, caption: $('img', f).alt }));
      figs.forEach((f, i) => f.addEventListener('click', () => openLB(items, i)));
    });
    $$('.zoom', app).forEach((f) => f.addEventListener('click', () =>
      openLB([{ path: $('img', f).dataset.src, caption: $('img', f).alt }])));
  }

  /* 门面页 */
  const form = $('#lock'), msg = $('#lock-msg'), btn = $('#unlock');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!window.crypto || !crypto.subtle) { msg.textContent = '请用 https 地址打开本页。'; return; }
    btn.disabled = true; msg.textContent = '正在验证…';
    const pw = $('#pw').value;
    try {
      key = await deriveKey(pw);
      man = JSON.parse(new TextDecoder().decode(await dec('manifest')));
      const app = $('#app');
      app.innerHTML = new TextDecoder().decode(await dec(man.page));
      $('#gate').hidden = true;
      app.hidden = false;
      initPage(app);
      if (location.hash) { const t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
      try { sessionStorage.setItem('iv-pw', pw); } catch {}
      unlocked = true; shownAt = performance.now();
      track('解锁');
    } catch (err) {
      key = null; man = null;
      const expired = err && err.name === 'Expired';
      const wrong = expired || (err && err.name === 'OperationError');
      msg.textContent = expired ? '这个访问密码已过期，如需查看请联系我获取新密码。'
        : wrong ? '密码不对，请再试一次。' : '加载失败，请检查网络后重试。';
      if (wrong) { track('密码错误'); try { sessionStorage.removeItem('iv-pw'); } catch {} }
    } finally { btn.disabled = false; }
  });
  try {
    const saved = sessionStorage.getItem('iv-pw');
    if (saved) { $('#pw').value = saved; form.requestSubmit(); }
  } catch {}
})();
