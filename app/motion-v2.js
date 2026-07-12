/* =============================================================================
   GoatedBuy · Design Language V2 · Motion runtime  (Stage A / WP-6a)
   -----------------------------------------------------------------------------
   Loaded AFTER app.js. Framework-free: CSS + IntersectionObserver + rAF.
   - Inert until a `.dl-v2` spine skeleton exists in the DOM (guards on every
     lookup), so it is a no-op on legacy pages / Stages A-B.
   - Idempotent: safe to call after every SPA re-render (skips work already done).
   - Reads stage data from window.JOURNEY_STAGES (defined by app.js in Stage B);
     falls back to a built-in copy so this file works standalone.
   - Honours prefers-reduced-motion (parks the parcel at Delivered, no loop).
   Public API:  window.DLV2.initJourneyMotion()   // call after rendering V2 markup
   ========================================================================== */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Fallback stage data — app.js overrides via window.JOURNEY_STAGES (Stage B).
  const FALLBACK_STAGES = [
    { label: "China",     cn: "中国货源", color: "#8A929B", glyph: "M9 15l6-6M8.5 12l-2 2a2.8 2.8 0 004 4l2-2M15.5 12l2-2a2.8 2.8 0 00-4-4l-2 2", detail: "Search platforms and suppliers; paste Taobao, 1688 or Weidian links." },
    { label: "Purchased", cn: "平台代采", color: "#F0503D", glyph: "M5 12.5l4.5 4.5L19 7", detail: "A dedicated agent buys it for you; the seller ships to our China warehouse." },
    { label: "QC",        cn: "入仓质检", color: "#B5741A", glyph: "M11 4a7 7 0 105 12l4 4M11 8v6M8 11h6", detail: "Inspected and photographed on arrival; defects are flagged before shipping." },
    { label: "Warehouse", cn: "仓储",     color: "#2F6BF0", glyph: "M4 20V9l8-4 8 4v11M9 20v-6h6v6", detail: "Approved goods enter 90 days of free storage until you're ready." },
    { label: "Bundle",    cn: "合包",     color: "#2F6BF0", glyph: "M12 4l7 3-7 3-7-3 7-3zM5 11l7 3 7-3M5 15l7 3 7-3", detail: "Combine many separate orders into one smart, lighter parcel." },
    { label: "Air",       cn: "国际空运", color: "#6C4BD6", glyph: "M20 5L5 11l5 2M20 5l-6 15-2-6M20 5l-8 8", detail: "Pick from 700+ routes to 220+ countries; follow live tracking." },
    { label: "Delivered", cn: "送达",     color: "#16915B", glyph: "M4 11l8-7 8 7M6 10v9h12v-9M10 19v-5h4v5", detail: "One dashboard for every order, payment, parcel and message." }
  ];

  function stages() {
    const s = window.JOURNEY_STAGES;
    return Array.isArray(s) && s.length ? s : FALLBACK_STAGES;
  }

  // ---- scroll reveal (harmless if there are no [data-reveal] nodes) ----------
  function initReveal() {
    const els = document.querySelectorAll(".dl-v2 [data-reveal]:not(.is-in)");
    if (!els.length) return;
    if (RM) { els.forEach(el => el.classList.add("is-in")); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
    }, { threshold: 0.16 });
    els.forEach(el => io.observe(el));
  }

  // ---- journey spine: build nodes/details + draw-in + travelling parcel ------
  function initSpine() {
    const track = document.getElementById("spineTrack");
    const prog = document.getElementById("spineProg");
    const parcel = document.getElementById("spineParcel");
    const nodesG = document.getElementById("spineNodes");
    const detailsEl = document.getElementById("spineDetails");
    if (!track || !prog || !parcel || !nodesG || !detailsEl) return; // no spine on this view
    if (nodesG.childElementCount > 0) return;                        // already built (idempotent)

    const STAGES = stages();
    const N = STAGES.length, X0 = 60, X1 = 900, midY = 92, amp = 26;
    const nx = STAGES.map((_, i) => X0 + (X1 - X0) * i / (N - 1));
    const ny = STAGES.map((_, i) => midY + (i % 2 ? amp : -amp) * 0.7 * Math.sin(i * 0.9));
    let d = `M${nx[0]} ${ny[0]}`;
    for (let i = 1; i < N; i++) { const cx = (nx[i - 1] + nx[i]) / 2; d += ` C ${cx} ${ny[i - 1]} ${cx} ${ny[i]} ${nx[i]} ${ny[i]}`; }
    track.setAttribute("d", d); prog.setAttribute("d", d);

    const L = track.getTotalLength();
    prog.style.strokeDasharray = L;
    prog.style.strokeDashoffset = RM ? 0 : L;
    const frac = STAGES.map((_, i) => i / (N - 1));

    STAGES.forEach((s, i) => {
      const x = nx[i], y = ny[i];
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", "node"); g.setAttribute("data-i", i);
      g.innerHTML =
        `<circle class="node-halo" cx="${x}" cy="${y}" r="10" fill="${s.color}"></circle>` +
        `<circle class="node-dot" cx="${x}" cy="${y}" r="9" fill="${s.color}"></circle>` +
        `<g class="node-glyph" transform="translate(${x - 8.4},${y - 8.4}) scale(0.7)"><path d="${s.glyph}"/></g>` +
        `<text class="node-label" x="${x}" y="${y - 24}" text-anchor="middle">${s.label}</text>` +
        `<text class="node-cn" x="${x}" y="${y + 32}" text-anchor="middle">${s.cn}</text>`;
      const halo = g.querySelector(".node-halo");
      if (halo) halo.style.animationDelay = (i * 0.26) + "s";
      nodesG.appendChild(g);
    });

    detailsEl.innerHTML = STAGES.map((s, i) =>
      `<div class="col" data-reveal><div class="k" style="color:${s.color}">${String(i + 1).padStart(2, "0")} ${s.label}</div><div class="d">${s.detail}</div></div>`
    ).join("");

    if (RM) {
      document.querySelectorAll(".dl-v2").forEach(el => el.classList.add("rm"));
      const p = track.getPointAtLength(L);
      parcel.setAttribute("transform", `translate(${p.x},${p.y - 15})`);
      parcel.setAttribute("opacity", "1");
      return;
    }

    const scrollHost = document.querySelector(".dl-v2 .spine-scroll") || track.closest("svg");
    const sio = new IntersectionObserver((entries) => entries.forEach(e => {
      if (e.isIntersecting) { prog.style.strokeDashoffset = 0; sio.disconnect(); travel(); }
    }), { threshold: 0.25 });
    sio.observe(scrollHost);

    function travel() {
      parcel.setAttribute("opacity", "1");
      const seg = 820, dwell = 560, segs = N - 1;
      let start = null, leg = -1;
      const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const place = f => { const p = track.getPointAtLength(Math.max(0, Math.min(1, f)) * L); parcel.setAttribute("transform", `translate(${p.x},${p.y - 15})`); };
      const setActive = i => nodesG.querySelectorAll(".node").forEach(n => n.classList.toggle("active", +n.dataset.i === i));
      const pulse = i => { const h = nodesG.querySelector('.node[data-i="' + i + '"] .node-halo'); if (!h) return; h.style.animation = "none"; void h.getBBox(); h.style.animation = "dlv2-halo 2.1s var(--ease-out) infinite"; };
      setActive(0); pulse(0);
      function frame(ts) {
        if (start === null) start = ts;
        const el = ts - start, cyc = seg + dwell, idx = Math.floor(el / cyc);
        if (idx >= segs) { start = ts; leg = -1; setActive(0); place(0); requestAnimationFrame(frame); return; }
        const w = el % cyc; let f;
        if (w < seg) { f = frac[idx] + (frac[idx + 1] - frac[idx]) * ease(w / seg); }
        else { f = frac[idx + 1]; if (leg !== idx + 1) { leg = idx + 1; setActive(idx + 1); pulse(idx + 1); } }
        place(f); requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }
  }

  function initJourneyMotion() {
    try { initSpine(); } catch (e) { /* never let motion break the app */ }
    try { initReveal(); } catch (e) { }
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      try { window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } }); } catch (e) { }
    }
  }

  window.DLV2 = { initJourneyMotion };

  if (document.readyState !== "loading") initJourneyMotion();
  else document.addEventListener("DOMContentLoaded", initJourneyMotion);
})();
