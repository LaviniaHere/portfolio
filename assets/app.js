// Lavinia 作品集：整站加密。输入密码后，在浏览器里解密页面、图片、视频和试稿。
// 加密参数要和 tools/build_site.mjs 一致：PBKDF2-SHA256 + AES-256-GCM，文件 = 12 字节 iv + 密文 + 16 字节校验。
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  let key = null, man = null;
  const cache = new Map();

  /* ---------- 语言：默认中文，可切换英文 ---------- */
  // 记在本机（localStorage），下次打开还是上次选的；网址加 ?lang=en 可以直接打开英文版。
  const T = {
    zh: {
      https: '请用 https 地址打开本页。', checking: '正在验证…', wrong: '密码不对，请再试一次。',
      fail: '加载失败，请检查网络后重试。', loading: '加载中…', decrypting: '解密中…', loadPlay: '加载并播放',
      copied: '已复制', selectCopy: '已选中，按 Ctrl+C', copy: '复制', player: '视频播放器',
      fab: '随机听一首', fabAria: '随机播放一首我的歌', nowPlaying: '正在播放', close: '收起播放器',
      play: '播放', pause: '暂停', next: '换一首', mark: '仅供作品展示',
      g: {
        echo: ['STARLINE ECHO 主视觉', '海报', '系列排版'], snow: ['月下雪兔 · 全配列', '雪兔元素', '空格键方案'],
        lumina: ['LuminaOS 2.03 · 像素偶像桌面样机'], album: ['专辑《Things That Stay》封面'], sprite: ['粉蓝小精灵'],
      },
      gate: {
        sub: 'AI 影像作品集<br>仅向受邀的面试官与合作方开放，请输入访问密码。', label: '访问密码', ph: '访问密码',
        btn: '进入作品集', foot: '没有密码？请通过投递或合作渠道联系我获取。',
      },
    },
    en: {
      https: 'Please open this page over https.', checking: 'Checking…', wrong: "That password didn't work. Please try again.",
      fail: "Couldn't load. Please check your connection and try again.", loading: 'Loading…', decrypting: 'Decrypting…',
      loadPlay: 'Load & play', copied: 'Copied', selectCopy: 'Selected, press Ctrl+C', copy: 'Copy', player: 'Video player',
      fab: 'Play a song', fabAria: 'Play a random song of mine', nowPlaying: 'Now playing', close: 'Close player',
      play: 'Play', pause: 'Pause', next: 'Next song', mark: 'For portfolio review only',
      g: {
        echo: ['STARLINE ECHO key visual', 'Poster', 'Series layout'], snow: ['Snow Rabbit · full set', 'Snow-rabbit motifs', 'Spacebar options'],
        lumina: ['LuminaOS 2.03 · pixel idol desktop prototype'], album: ['Things That Stay album cover'], sprite: ['Pink & Blue Sprites'],
      },
      gate: {
        sub: 'AI film portfolio<br>Open to invited interviewers and collaborators. Please enter the access password.',
        label: 'Access password', ph: 'Access password', btn: 'Enter portfolio',
        foot: "Don't have a password? Please ask me through the channel where we're in touch.",
      },
    },
  };
  let lang = (() => {
    try {
      const q = new URLSearchParams(location.search).get('lang');
      if (q === 'en' || q === 'zh') return q;
      return localStorage.getItem('lv-lang') === 'en' ? 'en' : 'zh';
    } catch { return 'zh'; }
  })();
  const t = (k) => T[lang][k];
  function applyGate() {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    document.title = lang === 'en' ? 'Lavinia · AI Film Portfolio' : 'Lavinia · AI 影像作品集';
    $$('#gate [data-t]').forEach((el) => { el.innerHTML = T[lang].gate[el.dataset.t]; });
    $$('#gate [data-t-ph]').forEach((el) => { el.placeholder = T[lang].gate[el.dataset.tPh]; });
    const gl = $('.gate-lang');
    gl.textContent = lang === 'en' ? '中文' : 'EN';
    gl.dataset.to = lang === 'en' ? 'zh' : 'en';
    gl.setAttribute('aria-label', lang === 'en' ? '切换到中文' : 'Switch to English');
  }
  // 两种语言的内容页，解密一次后缓存
  const pages = {};
  async function pageHTML(l) {
    const id = l === 'en' && man.pageEn ? man.pageEn : man.page;
    if (!pages[id]) pages[id] = new TextDecoder().decode(await dec(id));
    return pages[id];
  }
  async function renderApp(keepScroll) {
    const y = scrollY;
    songs.forEach((a) => a.pause());
    songs.clear();
    $$('.mp').forEach((m) => m.remove());
    const app = $('#app');
    app.innerHTML = await pageHTML(lang);
    initPage(app);
    renderVault($('#vault-out', app), man.groups);
    if (keepScroll) scrollTo(0, y);
  }
  async function setLang(l) {
    if (l === lang) return;
    lang = l;
    try { localStorage.setItem('lv-lang', l); } catch {}
    applyGate();
    track('切换语言', { 语言: l === 'en' ? '英文' : '中文' });
    if (man) await renderApp(true);
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.lang');
    if (b) setLang(b.dataset.to);
  });

  /* ---------- 访问统计 ---------- */
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
    try { if (window.umami && typeof umami.track === 'function') umami.track(name, { 来源: who || '未标记', ...data }); } catch {}
  }
  // 停留时长：只计页面在前台的时间
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

  /* ---------- 解密 ---------- */
  async function deriveKey(pw) {
    const meta = await (await fetch('data/meta.json', { cache: 'no-store' })).json();
    const salt = Uint8Array.from(atob(meta.salt), (c) => c.charCodeAt(0));
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: meta.iter, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }
  async function dec(id) {
    const res = await fetch(`data/${id}.bin`, { cache: id === 'manifest' ? 'no-store' : 'force-cache' });
    if (!res.ok) throw new Error('missing');
    const buf = new Uint8Array(await res.arrayBuffer());
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12));
  }
  // 页面里写的路径（img/xx.webp）→ 解密后的临时地址
  function url(path) {
    if (!cache.has(path)) {
      const f = man.files[path];
      cache.set(path, f ? dec(f.id).then((b) => URL.createObjectURL(new Blob([b], { type: f.mime }))) : Promise.reject(new Error(path)));
    }
    return cache.get(path);
  }

  /* ---------- 防盗 ---------- */
  const guarded = (el) => el.closest && el.closest('.protect, .lb, .vg-grid, img, video, canvas');
  document.addEventListener('contextmenu', (e) => { if (guarded(e.target)) e.preventDefault(); });
  document.addEventListener('dragstart', (e) => { if (guarded(e.target)) e.preventDefault(); });
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') e.preventDefault(); });
  // 同一时间只放一个：视频和试听互相暂停
  const songs = new Set();
  const pauseOthers = (keep) => {
    $$('video').forEach((v) => { if (v !== keep) v.pause(); });
    songs.forEach((a) => { if (a !== keep) a.pause(); });
  };
  document.addEventListener('play', (e) => pauseOthers(e.target), true);

  /* ---------- 大图查看 ---------- */
  const lb = $('#lb'), stage = $('#lb-stage'), cap = $('#lb-cap');
  let list = [], idx = 0, lastFocus = null;
  async function show() {
    const it = list[idx];
    stage.replaceChildren();
    cap.textContent = it.caption || '';
    $('#lb-prev').hidden = $('#lb-next').hidden = list.length < 2;
    if (it.bitmap) {
      const c = document.createElement('canvas');
      drawMark(c, it.bitmap);
      stage.append(c);
    } else {
      const d = document.createElement('div');
      d.className = 'pic';
      stage.append(d);
      d.style.backgroundImage = `url("${await url(it.path)}")`;
    }
  }
  function openLB(items, i = 0) {
    track('看大图', { 作品: (items[i] && items[i].caption) || '' });
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

  /* ---------- 解锁后的页面行为 ---------- */
  function initPage(app) {
    // 图片：快滚到时再解密
    const io = new IntersectionObserver((ents) => ents.forEach((en) => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      url(en.target.dataset.src).then((u) => { en.target.src = u; }).catch(() => {});
    }), { rootMargin: '800px 0px' });
    $$('img[data-src]', app).forEach((im) => io.observe(im));

    // 导航
    const nav = $('.nav', app);
    const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
    $('#relock', app).addEventListener('click', () => {
      try { sessionStorage.removeItem('lv-pw'); } catch {}
      location.reload();
    });

    // 记录看过哪些部分
    const sio = new IntersectionObserver((ents) => ents.forEach((en) => {
      if (!en.isIntersecting) return;
      const n = en.target.dataset.track;
      if (!seen.has(n)) { seen.add(n); track('看到', { 部分: n }); }
    }), { threshold: 0.35 });
    $$('[data-track]', app).forEach((el) => sio.observe(el));

    // B站播放器（IVORA）
    $$('.video[data-bvid]', app).forEach((box) => $('.play', box).addEventListener('click', () => {
      track('播放视频', { 视频: (box.dataset.name || box.dataset.bvid) + '（B站）' });
      const f = document.createElement('iframe');
      f.src = `https://player.bilibili.com/player.html?bvid=${box.dataset.bvid}&autoplay=1&high_quality=1&danmaku=0`;
      f.allow = 'autoplay; fullscreen'; f.allowFullscreen = true; f.title = t('player');
      box.replaceChildren(f);
    }));
    // 自己的加密视频：点了才解密
    $$('.video[data-video]', app).forEach((box) => $('.play', box).addEventListener('click', async () => {
      track('播放视频', { 视频: box.dataset.video.replace('media/', '') });
      const sp = $('.play span', box); sp.textContent = t('loading');
      const v = document.createElement('video');
      Object.assign(v, { controls: true, autoplay: true, playsInline: true, disablePictureInPicture: true });
      v.setAttribute('controlslist', 'nodownload noplaybackrate');
      v.src = await url(box.dataset.video);
      box.replaceChildren(v);
    }));

    // 原创音乐：一个播放器同时管「音乐区的试听」和「角落的随机播放 + 浮动歌词」
    initPlayer(app);

    // 后台预加载：解锁后先把视频和试听悄悄下好、解好，点播放时就能马上放。
    // 一个接一个地下，不跟图片抢网速；手机开了「省流量」就不预加载。
    const saveData = navigator.connection && navigator.connection.saveData;
    if (!saveData) {
      const media = [
        ...$$('.video[data-video]', app).map((b) => b.dataset.video),
        ...$$('.track[data-audio]', app).map((l) => l.dataset.audio),
      ];
      setTimeout(async () => {
        for (const p of media) { try { await url(p); } catch {} }
      }, 1200);
    }

    // 大图：过程条带、案例主图、更多作品
    $$('.strip', app).forEach((strip) => {
      const lis = $$('li', strip);
      const items = lis.map((li) => ({ path: $('img', li).dataset.src, caption: $('span', li).textContent }));
      lis.forEach((li, i) => {
        li.tabIndex = 0; li.setAttribute('role', 'button');
        li.addEventListener('click', () => openLB(items, i));
        li.addEventListener('keydown', (e) => { if (e.key === 'Enter') openLB(items, i); });
      });
    });
    $$('.case-body > .ph, .hero-media .ph', app).forEach((ph) => {
      ph.style.cursor = 'zoom-in';
      ph.addEventListener('click', () => openLB([{ path: $('img', ph).dataset.src, caption: $('img', ph).alt }]));
    });
    const G = {
      echo: ['echo-1', 'echo-2', 'echo-3'], snow: ['snow-full', 'snow-stick', 'snow-space'],
      lumina: ['lumina'], album: ['album'], sprite: ['sprite'],
    };
    $$('[data-gallery]', app).forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const k = a.dataset.gallery;
      openLB(G[k].map((n, i) => ({ path: `img/${n}.webp`, caption: t('g')[k][i] })));
    }));

    // 复制联系方式
    $$('.copy', app).forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = b.dataset.done || t('copied'); }
      catch {
        const r = document.createRange(); r.selectNodeContents(b.parentNode.querySelector('.sel'));
        getSelection().removeAllRanges(); getSelection().addRange(r); b.textContent = t('selectCopy');
      }
      setTimeout(() => { b.textContent = t('copy'); }, 1800);
    }));
  }

  /* ---------- 音乐播放器：试听 + 随机播放 + 浮动歌词 ---------- */
  // 歌词时间是整首歌里的时间；试听片段从 offset 秒开始截，所以当前唱到 = offset + 片段里播到的秒数。
  function initPlayer(app) {
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const list = $$('.track[data-audio]', app).map((li) => ({
      id: li.dataset.audio.replace(/^media\/|\.m4a$/g, ''), path: li.dataset.audio,
      title: $('b', li).textContent, li, total: $('time', li).textContent,
    }));
    if (!list.length) return;
    const au = new Audio();
    songs.add(au);
    let cur = null, mode = 'list', lyr = null, at = -1;
    const getLyrics = async () => {
      if (!lyr) { try { lyr = await (await fetch(await url('media/lyrics.json'))).json(); } catch { lyr = {}; } }
      return lyr;
    };

    const mp = document.createElement('div');
    mp.className = 'mp paused';
    mp.dataset.state = 'idle';
    mp.innerHTML = `
      <button class="mp-fab" type="button" aria-label="${t('fabAria')}"><span class="mp-note" aria-hidden="true"></span><span>${t('fab')}</span></button>
      <div class="mp-card" role="region" aria-label="${t('nowPlaying')}">
        <div class="mp-top"><span class="mp-eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="mp-title"></span><button class="mp-x" type="button" aria-label="${t('close')}">×</button></div>
        <div class="mp-lyr"><p class="mp-line"></p><p class="mp-next"></p></div>
        <div class="mp-ctl"><button class="mp-pp" type="button" aria-label="${t('play')}"></button><i class="mp-bar"><i></i></i><button class="mp-shuf" type="button">${t('next')}</button></div>
      </div>`;
    document.body.append(mp);
    const $m = (s) => $(s, mp);

    function setLine(force) {
      const L = cur && lyr && lyr[cur.id];
      if (!L || !L.lines.length) { if (force) { $m('.mp-line').textContent = '♪'; $m('.mp-next').textContent = ''; } return; }
      const tt = L.offset + au.currentTime + 0.15;
      let i = -1;
      for (let k = 0; k < L.lines.length && L.lines[k][0] <= tt; k++) i = k;
      if (i === at && !force) return;
      at = i;
      const line = $m('.mp-line');
      line.classList.remove('in');
      void line.offsetWidth; // 重新触发淡入动画
      line.textContent = i >= 0 ? (L.lines[i][1] || '♪') : '♪';
      line.classList.add('in');
      // 有翻译就在下面显示翻译（中文版看英文歌的中文翻译，英文版看中文歌的英文翻译），没有就显示下一句
      const tr = L.tr && L.tr[lang === 'en' ? 'en' : 'zh'];
      const sub = $m('.mp-next');
      if (tr && tr.length) {
        let j = -1;
        for (let k = 0; k < tr.length && tr[k][0] <= tt; k++) j = k;
        sub.textContent = j >= 0 ? tr[j][1] : '';
        sub.classList.add('tr');
      } else {
        sub.textContent = (L.lines[i + 1] && L.lines[i + 1][1]) || '';
        sub.classList.remove('tr');
      }
    }
    function sync() {
      list.forEach((s) => {
        s.li.classList.toggle('playing', s === cur && !au.paused);
        if (s !== cur) { $('.bar i', s.li).style.width = '0'; $('time', s.li).textContent = s.total; }
      });
      mp.classList.toggle('paused', au.paused);
      $m('.mp-pp').setAttribute('aria-label', au.paused ? t('play') : t('pause'));
    }
    async function play(s, how) {
      mode = how;
      mp.dataset.state = 'open';
      if (cur === s) { if (au.paused) au.play().catch(() => {}); else au.pause(); return; }
      cur = s; at = -1;
      s.li.classList.add('loading');
      $m('.mp-title').textContent = s.title;
      $m('.mp-line').textContent = '…';
      $m('.mp-next').textContent = '';
      const [src] = await Promise.all([url(s.path), getLyrics()]);
      s.li.classList.remove('loading');
      if (cur !== s) return; // 等待期间又换了歌
      au.src = src;
      setLine(true);
      au.play().catch(() => {});
      track(how === 'shuffle' ? '随机播放' : '试听', { 歌曲: s.title });
    }
    const shuffle = () => {
      const pool = list.filter((s) => s !== cur);
      play(pool[Math.floor(Math.random() * pool.length)], 'shuffle');
    };
    const seek = (e, bar) => {
      if (!au.duration) return;
      const r = bar.getBoundingClientRect();
      au.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * au.duration;
      setLine(true);
    };

    au.addEventListener('play', () => { pauseOthers(au); sync(); });
    au.addEventListener('pause', sync);
    au.addEventListener('timeupdate', () => {
      if (!cur || !au.duration) return;
      const p = (au.currentTime / au.duration * 100) + '%';
      $('.bar i', cur.li).style.width = p;
      $m('.mp-bar i').style.width = p;
      $('time', cur.li).textContent = fmt(au.duration - au.currentTime);
      setLine();
    });
    au.addEventListener('ended', () => {
      if (mode === 'shuffle') { shuffle(); return; }
      $('.bar i', cur.li).style.width = '0';
      $('time', cur.li).textContent = cur.total;
      sync();
    });

    list.forEach((s) => {
      $('.tp', s.li).addEventListener('click', () => play(s, 'list'));
      $('.bar', s.li).addEventListener('click', (e) => { if (cur === s) seek(e, e.currentTarget); });
    });
    $m('.mp-fab').addEventListener('click', () => {
      if (cur) { mp.dataset.state = 'open'; au.play().catch(() => {}); } else shuffle();
    });
    $m('.mp-pp').addEventListener('click', () => (au.paused ? au.play().catch(() => {}) : au.pause()));
    $m('.mp-shuf').addEventListener('click', shuffle);
    $m('.mp-bar').addEventListener('click', (e) => seek(e, e.currentTarget));
    $m('.mp-x').addEventListener('click', () => { au.pause(); mp.dataset.state = 'idle'; });
  }

  /* ---------- 商业试稿 ---------- */
  function drawMark(canvas, bmp) {
    canvas.width = bmp.width; canvas.height = bmp.height;
    const g = canvas.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const s = Math.max(12, bmp.width / 60);
    g.font = `${s}px sans-serif`;
    {
      const t = T[lang].mark;
      g.save();
      g.fillStyle = 'rgba(255,255,255,.13)';
      g.translate(bmp.width / 2, bmp.height / 2);
      g.rotate(-0.38);
      const w = g.measureText(t).width + s * 6;
      for (let y = -bmp.height; y < bmp.height; y += s * 7) {
        for (let x = -bmp.width - ((y / (s * 7)) % 2) * w / 2; x < bmp.width; x += w) g.fillText(t, x, y);
      }
      g.restore();
    }
    g.fillStyle = 'rgba(255,255,255,.6)';
    g.fillText(`© Lavinia · ${T[lang].mark} · ${new Date().toISOString().slice(0, 10)}`, s, bmp.height - s);
  }
  function renderVault(out, groups) {
    groups.forEach((g) => {
      const sec = document.createElement('section');
      sec.className = 'vg';
      sec.innerHTML = '<div class="vg-head"><h3></h3><p></p></div><div class="vg-grid"></div>';
      const en = lang === 'en';
      $('h3', sec).textContent = (en && g.group_en) || g.group;
      $('p', sec).textContent = (en && g.note_en) || g.note;
      const grid = $('.vg-grid', sec);
      const pics = [];
      g.items.forEach((it) => {
        const box = document.createElement('div');
        box.className = 'vg-item' + (it.kind === 'video' ? ' v' : '');
        box.innerHTML = '<div class="frame"></div><span></span>';
        const caption = (en && it.caption_en) || it.caption;
        $('span', box).textContent = caption;
        const frame = $('.frame', box);
        if (it.kind === 'image') {
          frame.classList.add('loading');
          const c = document.createElement('canvas');
          frame.append(c);
          const entry = { caption, bitmap: null };
          pics.push(entry);
          const io = new IntersectionObserver(([en]) => {
            if (!en.isIntersecting) return;
            io.disconnect();
            dec(it.id).then((b) => createImageBitmap(new Blob([b], { type: it.mime }))).then((bmp) => {
              entry.bitmap = bmp; drawMark(c, bmp); frame.classList.remove('loading');
            });
          }, { rootMargin: '600px 0px' });
          io.observe(frame);
          frame.tabIndex = 0;
          const zoom = () => { const ok = pics.filter((p) => p.bitmap); if (entry.bitmap) openLB(ok, ok.indexOf(entry)); };
          frame.addEventListener('click', zoom);
          frame.addEventListener('keydown', (e) => { if (e.key === 'Enter') zoom(); });
        } else {
          const b = document.createElement('button');
          b.className = 'play';
          b.innerHTML = `<span>${t('loadPlay')}</span>`;
          frame.append(b);
          b.addEventListener('click', async () => {
            $('span', b).textContent = t('decrypting');
            const u = URL.createObjectURL(new Blob([await dec(it.id)], { type: it.mime }));
            const v = document.createElement('video');
            Object.assign(v, { src: u, controls: true, autoplay: true, playsInline: true, disablePictureInPicture: true });
            v.setAttribute('controlslist', 'nodownload noplaybackrate');
            frame.replaceChildren(v);
          });
        }
        grid.append(box);
      });
      out.append(sec);
    });
  }

  /* ---------- 门面页 ---------- */
  const form = $('#lock'), msg = $('#lock-msg'), btn = $('#unlock');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!window.crypto || !crypto.subtle) { msg.textContent = t('https'); return; }
    btn.disabled = true; msg.textContent = t('checking');
    const pw = $('#pw').value;
    try {
      key = await deriveKey(pw);
      man = JSON.parse(new TextDecoder().decode(await dec('manifest')));
      await renderApp(false);
      $('#gate').hidden = true;
      $('#app').hidden = false;
      document.body.classList.add('open');
      if (location.hash) { const t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
      // 同一个标签页里刷新不用重新输密码，关掉标签页就失效
      try { sessionStorage.setItem('lv-pw', pw); } catch {}
      unlocked = true; shownAt = performance.now();
      track('解锁');
    } catch (err) {
      key = null; man = null;
      const wrong = err && err.name === 'OperationError';
      msg.textContent = wrong ? t('wrong') : t('fail');
      if (wrong) { track('密码错误'); try { sessionStorage.removeItem('lv-pw'); } catch {} }
    } finally { btn.disabled = false; }
  });

  applyGate();

  // 刚才在这个标签页解锁过，就自动进入
  try {
    const saved = sessionStorage.getItem('lv-pw');
    if (saved) { $('#pw').value = saved; form.requestSubmit(); }
  } catch {}
})();
