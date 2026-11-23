// Legal pages: reading progress, "On this page" (side column on desktop, a collapsible panel on phones),
// copy-link buttons on headings, reading time and a back-to-top button. Everything is built from the
// page's own headings, so editing a document needs no changes here.
(function () {
  const doc = document.querySelector('.lg-doc');
  const main = document.querySelector('.lg-main');
  if (!doc || !main) return;
  const heads = [...doc.querySelectorAll('h2[id]')];

  // reading time
  const meta = doc.querySelector('.lg-meta');
  const mins = Math.max(1, Math.round((doc.innerText || '').split(/\s+/).length / 220));
  if (meta) meta.textContent += ` · ${mins} min read`;

  // progress bar
  const bar = document.createElement('div');
  bar.className = 'lg-progress'; bar.setAttribute('aria-hidden', 'true');
  bar.innerHTML = '<span></span>';
  document.body.prepend(bar);

  // layout: documents + sections beside the text on wide screens
  const docs = document.querySelector('.lg-nav');
  const side = document.createElement('aside');
  side.className = 'lg-side';
  if (docs) side.append(docs);
  let toc = null;
  if (heads.length > 2) {
    toc = document.createElement('nav');
    toc.className = 'lg-toc'; toc.setAttribute('aria-label', 'On this page');
    toc.innerHTML = `<button type="button" class="lg-toc-btn" aria-expanded="false"><span>On this page</span><i aria-hidden="true"></i></button>
      <div class="lg-toc-list">${heads.map((h) => `<a href="#${h.id}">${h.textContent.replace(/\s+/g, ' ').trim()}</a>`).join('')}</div>`;
    side.append(toc);
    toc.querySelector('.lg-toc-btn').addEventListener('click', (e) => {
      const open = toc.classList.toggle('open');
      e.currentTarget.setAttribute('aria-expanded', String(open));
    });
    toc.addEventListener('click', (e) => { if (e.target.closest('.lg-toc-list a')) { toc.classList.remove('open'); toc.querySelector('.lg-toc-btn').setAttribute('aria-expanded', 'false'); } });
  }
  main.classList.add('lg-split');
  main.prepend(side);

  // copy-link buttons
  for (const h of heads) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'lg-anchor'; b.setAttribute('aria-label', 'Copy a link to this section');
    b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
    b.addEventListener('click', async () => {
      const url = `${location.origin}${location.pathname}#${h.id}`;
      try { await navigator.clipboard.writeText(url); b.classList.add('done'); setTimeout(() => b.classList.remove('done'), 1200); } catch (e) { location.hash = h.id; }
    });
    h.append(b);
  }

  // back to top
  const top = document.createElement('button');
  top.type = 'button'; top.className = 'lg-top-btn'; top.setAttribute('aria-label', 'Back to top');
  top.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>';
  top.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  document.body.append(top);

  // progress, back-to-top visibility, current section
  const links = toc ? [...toc.querySelectorAll('.lg-toc-list a')] : [];
  let queued = false;
  function update() {
    queued = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    const p = max > 0 ? Math.min(1, scrollY / max) : 0;
    bar.firstChild.style.transform = `scaleX(${p})`;
    top.classList.toggle('show', scrollY > 600);
    let cur = null;
    for (const h of heads) if (h.getBoundingClientRect().top < 140) cur = h;
    links.forEach((a) => { const on = cur && a.getAttribute('href') === '#' + cur.id; a.classList.toggle('on', !!on); if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
    if (toc) { const label = toc.querySelector('.lg-toc-btn span'); const t = cur ? cur.textContent.replace(/\s+/g, ' ').trim() : 'On this page'; if (label.textContent !== t) label.textContent = t; }
  }
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  addEventListener('resize', update);
  update();
})();
