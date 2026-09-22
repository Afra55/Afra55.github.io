(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, EBind } = K;
  const escapeHtml = P.escapeHtml;

  const VS = [0, 1];
  // 面板 id 用的小写后缀（interp-params-a），lane 键是大写 A/B；选择器必须小写
  const lc = (l) => String(l).toLowerCase();

  function bezierY(x1, y1, x2, y2, x) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    let t = x === 0 ? 0 : x === 1 ? 1 : x;
    for (let i = 0; i < 8; i++) {
      const xest = ((ax * t + bx) * t + cx) * t;
      const dx = 3 * ax * t * t + 2 * bx * t + cx;
      if (Math.abs(dx) < 1e-6) break;
      t -= (xest - x) / dx;
      t = Math.max(0, Math.min(1, t));
    }
    return ((ay * t + by) * t + cy) * t;
  }

  function bounceOut(t) {
    if (t < 1 / 2.75) return 7.5625 * t * t;
    if (t < 2 / 2.75) {
      t -= 1.5 / 2.75;
      return 7.5625 * t * t + 0.75;
    }
    if (t < 2.5 / 2.75) {
      t -= 2.25 / 2.75;
      return 7.5625 * t * t + 0.9375;
    }
    t -= 2.625 / 2.75;
    return 7.5625 * t * t + 0.984375;
  }

  function springVal(t, z, k) {
    const zeta = Math.max(0.001, Math.min(0.999, Number(z) || 0.5));
    const omega0 = Math.sqrt(Math.max(1, Number(k) || 200)) * 0.5;
    const omgD = omega0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * omega0 * t) * (Math.cos(omgD * t) + (zeta * omega0 / omgD) * Math.sin(omgD * t));
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  const INTERPOLATORS = [
    {
      id: "linear", name: "LinearInterpolator", cn: "线性",
      params: [],
      calc: (t) => t,
      java: () => "new LinearInterpolator()",
      kotlin: () => "LinearInterpolator()",
      clazz: "LinearInterpolator",
      desc: "匀速：进度与时间成正比，无加速/减速，最直接。",
    },
    {
      id: "accdec", name: "AccelerateDecelerateInterpolator", cn: "加减速（缓入缓出）",
      params: [], calc: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
      java: () => "new AccelerateDecelerateInterpolator()",
      kotlin: () => "AccelerateDecelerateInterpolator()",
      clazz: "AccelerateDecelerateInterpolator",
      desc: "缓入缓出：开始慢、中间快、结尾慢，最常用的平滑动画。",
    },
    {
      id: "accelerate", name: "AccelerateInterpolator", cn: "加速",
      params: [{ key: "factor", label: "factor", min: 0.2, max: 5, step: 0.1, def: 1, desc: "加速强度，越大起步越慢、后段越猛。" }],
      calc: (t, p) => Math.pow(t, num(p.factor)),
      java: (p) => `new AccelerateInterpolator(${fmt(p.factor)})`,
      kotlin: (p) => `AccelerateInterpolator(${fmt(p.factor)})`,
      clazz: "AccelerateInterpolator", desc: "加速：移出/离场，起步慢，随时间加快。factor 越大越明显。",
    },
    {
      id: "decelerate", name: "DecelerateInterpolator", cn: "减速",
      params: [{ key: "factor", label: "factor", min: 0.2, max: 5, step: 0.1, def: 1, desc: "减速强度，越大收尾越慢。" }],
      calc: (t, p) => 1 - Math.pow(1 - t, num(p.factor)),
      java: (p) => `new DecelerateInterpolator(${fmt(p.factor)})`,
      kotlin: (p) => `DecelerateInterpolator(${fmt(p.factor)})`,
      clazz: "DecelerateInterpolator", desc: "减速：进场，快速起步，到结尾慢慢停下。factor 越大越慢。",
    },
    {
      id: "overshoot", name: "OvershootInterpolator", cn: "超调",
      params: [{ key: "tension", label: "tension", min: 0, max: 6, step: 0.1, def: 2, desc: "超调力量，越大冲得越过头再回弹。" }],
      calc: (t, p) => { const s = num(p.tension); const tt = t - 1; return tt * tt * ((s + 1) * tt + s) + 1; },
      java: (p) => `new OvershootInterpolator(${fmt(p.tension)})`,
      kotlin: (p) => `OvershootInterpolator(${fmt(p.tension)})`,
      clazz: "OvershootInterpolator", desc: "超调：冲到目标后回弹一下（先过头再回来），tension 越大越弹。",
    },
    {
      id: "anticipate", name: "AnticipateInterpolator", cn: "回退",
      params: [{ key: "tension", label: "tension", min: 0, max: 6, step: 0.1, def: 2, desc: "回退力量，越大后退越深。" }],
      calc: (t, p) => { const s = num(p.tension); return t * t * ((s + 1) * t - s); },
      java: (p) => `new AnticipateInterpolator(${fmt(p.tension)})`,
      kotlin: (p) => `AnticipateInterpolator(${fmt(p.tension)})`,
      clazz: "AnticipateInterpolator", desc: "回退：先往反方向退一下再前进，像「预备动作」。",
    },
    {
      id: "anticipateOvershoot", name: "AnticipateOvershootInterpolator", cn: "回退+超调",
      params: [{ key: "tension", label: "tension", min: 0, max: 6, step: 0.1, def: 2, desc: "组合力度，越大回退更深、过头更远。" }],
      calc: (t, p) => {
        const s = num(p.tension) * 1.70158;
        if (t < 0.5) { const a = 2 * t; return 0.5 * a * a * ((s + 1) * a - s); }
        const a = 2 * t - 2; return 0.5 * (a * a * ((s + 1) * a + s) + 2);
      },
      java: (p) => `new AnticipateOvershootInterpolator(${fmt(p.tension)})`,
      kotlin: (p) => `AnticipateOvershootInterpolator(${fmt(p.tension)})`,
      clazz: "AnticipateOvershootInterpolator", desc: "回退+超调：先退再冲过头，张力十足。",
    },
    {
      id: "bounce", name: "BounceInterpolator", cn: "弹跳", params: [],
      calc: (t) => bounceOut(t),
      java: () => "new BounceInterpolator()", kotlin: () => "BounceInterpolator()",
      clazz: "BounceInterpolator", desc: "弹跳：像球落地一样弹跳几次（在地面附近）。",
    },
    {
      id: "cycle", name: "CycleInterpolator", cn: "循环正弦",
      params: [{ key: "cycles", label: "cycles", min: 0.1, max: 5, step: 0.1, def: 1, desc: "往返次数，1 次=正弦一整个来回。" }],
      calc: (t, p) => Math.sin(2 * num(p.cycles) * Math.PI * t),
      java: (p) => `new CycleInterpolator(${fmt(p.cycles)})`,
      kotlin: (p) => `CycleInterpolator(${fmt(p.cycles)})`,
      clazz: "CycleInterpolator", desc: "循环正弦：在目标附近来回摆动，可用于抖动/呼吸。",
    },
    {
      id: "path", name: "PathInterpolator", cn: "贝塞尔路径",
      params: [
        { key: "x1", label: "x1", min: 0, max: 1, step: 0.01, def: 0.4 },
        { key: "y1", label: "y1", min: -1, max: 2, step: 0.01, def: 0 },
        { key: "x2", label: "x2", min: 0, max: 1, step: 0.01, def: 0.2 },
        { key: "y2", label: "y2", min: -1, max: 2, step: 0.01, def: 1 },
      ],
      calc: (t, p) => bezierY(num(p.x1), num(p.y1), num(p.x2), num(p.y2), t),
      java: (p) => `new PathInterpolator(${fmt(p.x1)}, ${fmt(p.y1)}, ${fmt(p.x2)}, ${fmt(p.y2)})`,
      kotlin: (p) => `PathInterpolator(${fmt(p.x1)}f, ${fmt(p.y1)}f, ${fmt(p.x2)}f, ${fmt(p.y2)}f)`,
      clazz: "PathInterpolator", desc: "贝塞尔路径：用两个控制点定义完整动画曲线（y 可 >1 表示超调）。",
    },
    {
      id: "fastOutSlowIn", name: "FastOutSlowInInterpolator", cn: "快进慢出",
      params: [], calc: (t) => bezierY(0.4, 0, 0.2, 1, t),
      java: () => "new FastOutSlowInInterpolator()", kotlin: () => "FastOutSlowInInterpolator()",
      clazz: "FastOutSlowInInterpolator", desc: "快进慢出：Material 常驻过渡，先快后慢，顺滑结束。",
    },
    {
      id: "linearOutSlowIn", name: "LinearOutSlowInInterpolator", cn: "线性出·慢入",
      params: [], calc: (t) => bezierY(0, 0, 0.4, 1, t),
      java: () => "new LinearOutSlowInInterpolator()", kotlin: () => "LinearOutSlowInInterpolator()",
      clazz: "LinearOutSlowInInterpolator", desc: "线性出·慢入：匀速伴随缓慢收尾，接近自然停止。",
    },
    {
      id: "fastOutLinearIn", name: "FastOutLinearInInterpolator", cn: "快出·线性入",
      params: [], calc: (t) => bezierY(0.4, 0, 1, 1, t),
      java: () => "new FastOutLinearInInterpolator()", kotlin: () => "FastOutLinearInInterpolator()",
      clazz: "FastOutLinearInInterpolator", desc: "快出·线性入：快速起步后匀速，末尾收束。",
    },
    {
      id: "spring", name: "SpringAnimation", cn: "弹簧(物理)",
      params: [
        { key: "stiffness", label: "stiffness", min: 20, max: 2000, step: 20, def: 200, desc: "刚度：越大越硬、越快达到目标。" },
        { key: "dampingRatio", label: "dampingRatio", min: 0.05, max: 1, step: 0.01, def: 0.5, desc: "阻尼比：越小振得越久（接近 0 则停在目标即回弹）。" },
      ],
      calc: (t, p) => springVal(t, num(p.dampingRatio), num(p.stiffness)),
      java: (p) => `SpringAnimation anim = new SpringAnimation(view, SpringAnimation.TRANSLATION_Y, 0f);\n    anim.getSpring().setStiffness(${fmt(p.stiffness)}f);\n    anim.getSpring().setDampingRatio(${fmt(p.dampingRatio)}f);\n    anim.start();`,
      kotlin: (p) => `SpringAnimation(view, SpringAnimation.TRANSLATION_Y, 0f).apply {\n    spring.stiffness = ${fmt(p.stiffness)}f\n    spring.dampingRatio = ${fmt(p.dampingRatio)}f\n    start()\n}`,
      clazz: "SpringAnimation", desc: "弹簧(物理)：用刚度+阻尼比模拟真实弹簧，回弹自然（androidx.dynamicanimation）。",
    },
  ];

  function fmt(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "0f";
    const s = String(Math.round(n * 1000) / 1000);
    return s.indexOf(".") >= 0 ? `${s}f` : `${s}f`;
  }

  const byId = Object.fromEntries(INTERPOLATORS.map((x) => [x.id, x]));
  const byClazz = Object.fromEntries(INTERPOLATORS.map((x) => [x.clazz, x]));

  const lanes = {
    A: { type: "fastOutSlowIn", params: {} },
    B: { type: "overshoot", params: { tension: 2 } },
  };
  const compareOn = false;
  const best = Object.create(null);
  let animating = false;
  let animRaf = 0;

  const stateRef = {
    duration: 600,
    lang: "java",
    active: "A",
    compareOn,
    favorites: [],
  };
  try { stateRef.favorites = JSON.parse(localStorage.getItem("devtools-interp-fav-v1") || "[]") || []; } catch (_) {}

  const PRESETS = [
    { name: "Material 常驻过渡", type: "fastOutSlowIn", params: {} },
    { name: "Material 入口(快)", type: "fastOutLinearIn", params: {} },
    { name: "离场(快进慢出)", type: "decelerate", params: { factor: 1.2 } },
    { name: "闪入闪出", type: "accelerate", params: { factor: 2 } },
    { name: "弹性超调", type: "overshoot", params: { tension: 2 } },
    { name: "预备后落地", type: "anticipateOvershoot", params: { tension: 2 } },
    { name: "落地弹跳", type: "bounce", params: {} },
    { name: "呼吸循环", type: "cycle", params: { cycles: 1 } },
    { name: "柔和弹簧", type: "spring", params: { stiffness: 200, dampingRatio: 0.5 } },
    { name: "轻弹弹簧", type: "spring", params: { stiffness: 500, dampingRatio: 0.3 } },
    { name: "贝塞尔曲线", type: "path", params: { x1: 0.4, y1: -0.4, x2: 0.2, y2: 1.6 } },
  ];

  function defParams(tool) {
    const o = {};
    (tool?.params || []).forEach((p) => { o[p.key] = p.def; });
    return o;
  }

  function lane(l) {
    return lanes[l];
  }

  function activeLane() {
    return stateRef.active;
  }

  function toolOf(l) {
    return byId[lane(l).type] || INTERPOLATORS[0];
  }

  function getParam(l, key) {
    const tool = toolOf(l);
    const d = tool.params.find((p) => p.key === key);
    const v = lane(l).params[key];
    return v == null ? d?.def : v;
  }

  function setLaneType(l, id) {
    const tool = byId[id];
    if (!tool) return;
    lane(l).type = id;
    lane(l).params = { ...defParams(tool), ...(lane(l).params || {}) };
  }

  // ---- param inputs ----
  function paramInputs(l) {
    const tool = toolOf(l);
    if (!tool.params.length) {
      return `<p class="hint tight">该插值器没有可调参数，切换上方类型即可对比曲线。</p>`;
    }
    return tool.params
      .map((pp) => {
        const val = getParam(l, pp.key);
        return `<label class="interp-param"><span class="hint tight">${escapeHtml(pp.label)}</span>
          <span class="interp-param-controls">
            <input class="interp-range" type="range" min="${pp.min}" max="${pp.max}" step="${pp.step}"
              data-lane="${l}" data-key="${pp.key}" value="${val}" aria-label="${escapeHtml(pp.label)}" />
            <input class="mono meta-input interp-number" type="number" step="${pp.step}"
              data-lane="${l}" data-key="${pp.key}" value="${val}" aria-label="${escapeHtml(pp.label)} 数值" />
          </span>
          <span class="hint tight">${escapeHtml(pp.desc || "")}</span></label>`;
      })
      .join("");
  }

  function laneDesc(l) {
    const tool = toolOf(l);
    const cls = tool.name;
    return `<div class="interp-desc-body"><strong>${escapeHtml(tool.cn)}</strong> · <code>${escapeHtml(cls)}</code><p>${escapeHtml(tool.desc)}</p></div>`;
  }

  function refreshLane(l) {
    const laneEl = $(`#interp-params-${lc(l)}`);
    if (laneEl) laneEl.innerHTML = paramInputs(l);
    const descEl = $(`#interp-desc-${lc(l)}`);
    if (descEl) descEl.innerHTML = laneDesc(l);
    const classEl = $(`#interp-class-${lc(l)}`);
    if (classEl) classEl.textContent = toolOf(l).name;
    syncTypeSelect(l);
    drawCurve();
    refreshCode();
  }

  function syncTypeSelect(l) {
    const sel = $(`#interp-type-${lc(l)}`);
    if (!sel) return;
    sel.value = lane(l).type;
    $$(`#interp-preset option`).forEach(() => {});
  }

  function fillTypeOptions() {
    ["A", "B"].forEach((l) => {
      const sel = $(`#interp-type-${lc(l)}`);
      if (!sel) return;
      const cur = lane(l).type;
      sel.innerHTML = INTERPOLATORS.map((i) => `<option value="${i.id}">${escapeHtml(i.cn)} · ${escapeHtml(i.name)}</option>`).join("");
      sel.value = cur;
    });
  }

  // ---- curve ----
  function sampleCurve(l) {
    const tool = toolOf(l);
    const pts = [];
    for (let i = 0; i <= 160; i++) {
      const t = i / 160;
      pts.push({ t, y: tool.calc(t, lane(l).params) });
    }
    return pts;
  }

  function drawCurve() {
    const svg = $("#interp-curve");
    if (!svg) return;
    const W = 420, H = 240, pad = 24;
    const lan = activeLane();
    const lans = stateRef.compareOn ? ["A", "B"] : [lan];
    let ymin = 0, ymax = 1;
    const curves = lans.map((l) => ({ l, pts: sampleCurve(l) }));
    curves.forEach((c) => {
      c.pts.forEach((pt) => {
        if (pt.y < ymin) ymin = pt.y;
        if (pt.y > ymax) ymax = pt.y;
      });
    });
    const range = Math.max(0.0001, ymax - ymin);
    const ypad = range * 0.12;
    ymin -= ypad; ymax += ypad;

    const xAt = (t) => pad + t * (W - 2 * pad);
    const yAt = (y) => H - pad - ((y - ymin) / (ymax - ymin)) * (H - 2 * pad);

    const grid0 = ymin, grid1 = ymax;
    const gridYs = [];
    for (let g = Math.ceil(grid0); g <= Math.floor(grid1); g++) gridYs.push(g);

    let path = "";
    curves.forEach((c) => {
      let d = "";
      c.pts.forEach((pt, i) => {
        const X = xAt(pt.t), Y = yAt(pt.y);
        d += (i === 0 ? `M ${X} ${Y}` : ` L ${X} ${Y}`);
      });
      path += `<path class="interp-curve-line${c.l === "B" ? " is-b" : " is-a"}" d="${d}" fill="none" stroke-width="2.4" />`;
    });

    const grid = gridYs.map((gY) => `<line x1="${pad}" y1="${yAt(gY)}" x2="${W - pad}" y2="${yAt(gY)}" class="interp-grid" /><text x="${pad - 4}" y="${yAt(gY) + 4}" class="interp-y-label">${gY}</text>`).join("");
    const zeroY = yAt(0);
    svg.innerHTML =
      `<rect x="0" y="0" width="${W}" height="${H}" class="interp-curve-bg" />` +
      grid +
      `<line x1="${pad}" y1="${zeroY}" x2="${W - pad}" y2="${zeroY}" class="interp-axis" />` +
      `<line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H - pad}" class="interp-axis" />` +
      path +
      `<circle id="interp-curve-dot-a" cx="${xAt(0)}" cy="${yAt(0)}" r="5" class="interp-curve-dot is-a" />` +
      (stateRef.compareOn ? `<circle id="interp-curve-dot-b" cx="${xAt(0)}" cy="${yAt(0)}" r="5" class="interp-curve-dot is-b" />` : "");
    // repaint dot positions is handled by preview
    return { xAt, yAt };
  }

  let mapped = null;
  function refreshCurve() {
    mapped = drawCurve();
  }

  // ---- preview ----
  function lanePoint(l) {
    const tool = toolOf(l);
    return { pts: sampleCurve(l), tool, params: lane(l).params };
  }

  function resetDots() {
    setDot("A", 0, 0);
    if (stateRef.compareOn || !$("#interp-lane-b").hidden) setDot("B", 0, 0);
    setVal("A", 0);
    if (stateRef.compareOn || !$("#interp-lane-b").hidden) setVal("B", 0);
  }

  function setDot(l, t, y) {
    const dot = $(`#interp-dot-${lc(l)}`);
    if (!dot) return;
    if (mapped) {
      dot.setAttribute("cx", mapped.xAt(t));
      dot.setAttribute("cy", mapped.yAt(y));
    }
  }

  function setVal(l, y) {
    const el = $(`#interp-val-${lc(l)}`);
    if (el) el.textContent = (Math.round(y * 100) / 100).toFixed(2);
    const row = $(`#interp-preview-row-${lc(l)}`) || $(`#interp-preview [data-lane="${l}"]`);
    if (row) {
      const dot = row.querySelector(".interp-preview-dot");
      if (dot) dot.style.left = `${Math.min(100, Math.max(0, y * 100))}%`;
    }
  }

  function play() {
    if (animating) { cancelAnimationFrame(animRaf); animating = true; }
    const dur = Math.max(120, Number($("#interp-duration")?.value) || 600);
    const start = performance.now();
    const lans = stateRef.compareOn ? ["A", "B"] : [activeLane()];
    const snap = lans.map((l) => ({ l, pts: lanePoint(l) }));
    animating = true;
    const step = (now) => {
      const el = Math.min(1, (now - start) / dur);
      snap.forEach((s) => {
        const idx = Math.min(s.pts.pts.length - 1, Math.round(el * (s.pts.pts.length - 1)));
        const pt = s.pts.pts[idx];
        setDot(s.l, pt.t, pt.y);
        setVal(s.l, pt.y);
      });
      if (el < 1) animRaf = requestAnimationFrame(step);
      else { animating = false; }
    };
    animRaf = requestAnimationFrame(step);
  }

  // ---- codegen ----
  function refreshCode() {
    const el = $("#interp-code");
    if (!el) return;
    el.value = generateCode(activeLane());
  }

  function generateCode(l) {
    const tool = toolOf(l);
    const p = lane(l).params;
    const body = stateRef.lang === "kotlin" ? tool.kotlin(p) : tool.java(p);
    if (tool.id === "spring") {
      return stateRef.lang === "kotlin"
        ? `// import androidx.dynamicanimation.animation.SpringAnimation\nval view: View = ...\nval anim = ${body.trim()}\n// 调节：anim.spring.stiffness / anim.spring.dampingRatio`
        : `// import androidx.dynamicanimation.animation.SpringAnimation\nView view = ...;\n${body.trim()}`;
    }
    const start = stateRef.lang === "kotlin"
      ? `val animator = ValueAnimator.ofFloat(0f, 1f)\nanimator.duration = ${stateRef.duration}L\nanimator.interpolator = ${body}`
      : `ValueAnimator animator = ValueAnimator.ofFloat(0f, 1f);\nanimator.setDuration(${stateRef.duration});\nanimator.setInterpolator(${body});`;
    return `${start}\nanimator.start();`;
  }

  // ---- JSON ----
  function snapshot() {
    const l = activeLane();
    return { name: toolOf(l).name, type: lane(l).type, params: { ...lane(l).params }, duration: Number($("#interp-duration")?.value) || 600 };
  }

  function exportJson() {
    return JSON.stringify(snapshot(), null, 2);
  }

  function importJson(text) {
    const o = JSON.parse(text);
    if (!o || !o.type) throw new Error("JSON 缺少 type");
    setLaneType(activeLane(), o.type);
    lane(activeLane()).params = { ...defParams(byId[o.type]), ...(o.params || {}) };
    if (o.duration) $("#interp-duration").value = o.duration;
    refreshLane(activeLane());
    toast("已导入 JSON");
  }

  function download(name, text) {
    const blob = new Blob([text], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return Promise.resolve();
  }

  // ---- favorites / presets ----
  function renderFavs() {
    const list = $("#interp-fav-list");
    if (!list) return;
    list.innerHTML = stateRef.favorites.length
      ? stateRef.favorites.map((f, i) => `<div class="interp-fav-item"><button type="button" class="ghost-btn interp-fav-load" data-idx="${i}">${escapeHtml(f.name || "未命名")}</button><button type="button" class="ghost-btn" data-fav-del="${i}">删除</button></div>`).join("")
      : `<span class="hint tight">暂无收藏</span>`;
  }

  function renderPresets() {
    const sel = $("#interp-preset");
    if (!sel) return;
    sel.value = "";
  }

  function addFavorite() {
    const s = snapshot();
    const name = prompt("收藏名称：", s.name);
    if (!name) return;
    s.name = name;
    stateRef.favorites.push(s);
    saveFavs();
    renderFavs();
    toast("已收藏当前参数");
  }

  function saveFavs() {
    try { localStorage.setItem("devtools-interp-fav-v1", JSON.stringify(stateRef.favorites)); } catch (_) {}
  }

  // ---- binding ----
  bindPanel("interpolator", () => {
    fillTypeOptions();
    ["A", "B"].forEach((l) => {
      const tool = byId[lane(l).type] || INTERPOLATORS[0];
      lane(l).params = { ...defParams(tool), ...(lane(l).params || {}) };
      refreshLane(l);
    });

    $$("#interp-lane-b, #interp-preview-row-b").forEach((el) => { el.hidden = !stateRef.compareOn; });

    $("#interp-type-a")?.addEventListener("change", (e) => { setLaneType("A", e.target.value); drawCurve(); refreshLane("A"); resetDots(); });
    $("#interp-type-b")?.addEventListener("change", (e) => { setLaneType("B", e.target.value); drawCurve(); refreshLane("B"); resetDots(); });

    document.addEventListener("input", (e) => {
      const inp = e.target.closest?.(".interp-param input[data-key]");
      if (!inp) return;
      const l = inp.dataset.lane;
      const key = inp.dataset.key;
      const n = Number(inp.value);
      lane(l).params[key] = Number.isFinite(n) ? n : getParam(l, key);
      // 滑杆与数值框双向同步
      const wrap = inp.closest(".interp-param");
      if (wrap) {
        wrap.querySelectorAll("input[data-key]").forEach((o) => {
          if (o !== inp) o.value = inp.value;
        });
      }
      drawCurve();
      resetDots();
      if (activeLane() === l) refreshCode();
    });

    $("#interp-duration")?.addEventListener("change", () => refreshCode());

    $("#interp-compar")?.addEventListener("click", () => {
      stateRef.compareOn = true;
      $("#interp-lane-b").hidden = false;
      $("#interp-preview-row-b").hidden = false;
      $("#interp-play").textContent = "播放 A+B";
      refreshLane("B");
      refreshCurve();
      resetDots();
    });
    $("#interp-rm-b")?.addEventListener("click", () => {
      stateRef.compareOn = false;
      $("#interp-lane-b").hidden = true;
      $("#interp-preview-row-b").hidden = true;
      $("#interp-play").textContent = "播放 A";
      refreshCurve();
      resetDots();
    });

    $("#interp-play")?.addEventListener("click", play);
    $("#interp-reset")?.addEventListener("click", () => { resetDots(); toast("已归零"); });

    $("#interp-lang")?.addEventListener("change", (e) => { stateRef.lang = e.target.value; refreshCode(); });
    $("#interp-copy-code")?.addEventListener("click", () => {
      copyText($("#interp-code")?.value || "").then(() => toast("代码已复制")).catch(() => toast("复制失败"));
    });
    $("#interp-copy-json")?.addEventListener("click", () => copyText(exportJson()).then(() => toast("JSON 已复制")).catch(() => toast("复制失败")));
    $("#interp-export-json")?.addEventListener("click", () => download("interpolator.json", exportJson()));
    $("#interp-import-json")?.addEventListener("click", () => {
      const file = $("#interp-import-file");
      if (file) file.click();
    });
    $("#interp-import-file")?.addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try { importJson(String(r.result)); } catch (err) { setError($("#interp-error"), err.message || String(err)); }
      };
      r.readAsText(f);
      e.target.value = "";
    });

    $("#interp-preset")?.addEventListener("change", (e) => {
      const preset = PRESETS.find((x) => x.name === e.target.value);
      if (!preset) return;
      setLaneType(activeLane(), preset.type);
      lane(activeLane()).params = { ...defParams(byId[preset.type]), ...(preset.params || {}) };
      refreshLane(activeLane());
      resetDots();
    });

    $("#interp-fav")?.addEventListener("click", addFavorite);
    $("#interp-fav-exprt")?.addEventListener("click", () => {
      const s = snapshot();
      s.name = prompt("收藏名称：", s.name) || s.name;
      stateRef.favorites.push(s);
      saveFavs();
      renderFavs();
      toast("已收藏并本地保存");
    });
    $("#interp-fav-list")?.addEventListener("click", (e) => {
      const load = e.target.closest?.(".interp-fav-load");
      const del = e.target.closest?.("[data-fav-del]");
      if (load) {
        const idx = Number(load.dataset.idx);
        const f = stateRef.favorites[idx];
        if (f) {
          setLaneType(activeLane(), f.type);
          lane(activeLane()).params = { ...f.params || {} };
          refreshLane(activeLane());
          toast(`已载入「${f.name}」`);
        }
      } else if (del != null) {
        stateRef.favorites.splice(Number(del.dataset.favDel), 1);
        saveFavs();
        renderFavs();
      }
    });
    $("#interp-lane-b")?.addEventListener("click", (e) => {
      if (e.target.closest?.("select")) return;
      stateRef.active = "B";
      refreshCurve();
      refreshCode();
    });
    $("#interp-type-a")?.addEventListener("click", () => { stateRef.active = "A"; refreshCurve(); refreshCode(); });

    const presetSel = $("#interp-preset");
    if (presetSel) {
      presetSel.innerHTML = `<option value="">— 选择预设 —</option>` + PRESETS.map((p) => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join("");
    }

    renderPresets();
    renderFavs();
    refreshCurve();
    refreshCode();
    resetDots();
    bindFavClick();
  });

  function bindFavClick() { /* keep DOM ready */ }

  window.DevToolsExtraBoot = window.DevToolsExtraBoot || {};
  window.DevToolsExtraBoot["interpolator"] = () => { try { refreshCurve(); } catch (_) {} };
})();
