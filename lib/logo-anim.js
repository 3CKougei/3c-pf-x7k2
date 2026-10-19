// © 2026 MR Design — 3C日報のログインロゴアニメ（nippo-app/public/logo-anim.js 2026-10-06）を配色だけこちらに合わせて移植
// 3C日報 ログインロゴのアニメーション（2026-10-06）
// 「3C」の文字（普通のフォント） → 「C」が上へ抜け、「3」が上下2つのCにほどける → 3つのCが三角形に並ぶ
// → 内側に寄って組み合い、アプリアイコンと同じガラス（icons/logo-glass-512.png）になる。
//
// 仕組み:
// - 最初の「3C」は SVG の <text>（システムフォント・太字・紫グラデ）。「3」は clipPath で上半分／下半分に割り、3つのパーツにする
// - 各パーツの裏に同じ位置・大きさの「C（円弧のストローク）」を用意し、動き出す最初の 35% でクロスフェード
//   （文字のパーツは C と同じ transform で動くので、途中で形が変わっても位置はずれない）
// - 3つのCは {ang, dist, r, rot, w} を極座標で補間（同じ向きに旋回して集まる）。形は design/icon-ideas/final/render-final.html と同じ
// - 最後はガラスのPNG（design/icon-ideas/final/render-logo-png.html で描いた透明PNG・同じ形）へクロスフェード
// - prefers-reduced-motion の時は動かさず最終形だけ。ロゴをタップするともう一度再生
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const rad = (d) => d * Math.PI / 180;
  const HALF = 43.8;                 // 開き口の半角（度）
  const S = 1.2;                     // アイコンと同じ倍率
  const CX = 256, CY = 256;
  const GLASS_PNG = window.LOGO_GLASS || "img/logo_glass_dark.png";
  // canvas の計測と SVG の描画で同じフォントに解決されるよう、先頭は CSS の汎用名 system-ui（-apple-system は canvas の font 短縮形で解釈されないことがある）
  const FONT_FAMILY = 'system-ui, -apple-system, "Helvetica Neue", "Hiragino Sans", Arial, sans-serif';
  const FONT_WEIGHT = 700;
  const FONT_SIZE = 240;             // SVG 単位（512 の箱の中）。大きすぎると、上へ抜けた C が「3」の上のふくらみと重なる

  // ---- イージング ----
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const span = (t, a, b) => clamp01((t - a) / (b - a));
  const polar = (p) => ({ ...p, cx: CX + Math.cos(rad(p.ang)) * p.dist, cy: CY + Math.sin(rad(p.ang)) * p.dist });

  // ---- 文字の計測（フォントの実際のインクの箱）----
  // measureText の actualBoundingBox* は WebKit だと送り幅をそのまま返す（左0・右=advance）ので、
  // canvas に描いてピクセルを走査し、墨の範囲（左右・上下）を測る
  function measureText() {
    const c = document.createElement("canvas");
    c.width = 640; c.height = 480;
    const g = c.getContext("2d", { willReadFrequently: true });
    const font = `${FONT_WEIGHT} ${FONT_SIZE}px ${FONT_FAMILY}`;
    const ink = (ch) => {
      g.clearRect(0, 0, c.width, c.height);
      g.font = font; g.fillStyle = "#000"; g.textBaseline = "alphabetic";
      const ox = 120, oy = 340;
      g.fillText(ch, ox, oy);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let x0 = c.width, x1 = -1, y0 = c.height, y1 = -1;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        if (d[(y * c.width + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      return { left: x0 - ox, right: x1 + 1 - ox, asc: oy - y0, desc: y1 + 1 - oy, adv: g.measureText(ch).width };
    };
    const i3 = ink("3"), iC = ink("C");
    const adv3C = (() => { g.font = font; return g.measureText("3C").width; })();
    const x0 = CX - adv3C / 2;                                     // 「3C」を送り幅で中央に
    const asc = Math.max(i3.asc, iC.asc), desc = Math.max(i3.desc, iC.desc);
    const baseline = CY + (asc - desc) / 2 + 14;                   // 墨が上下中央より少し下に来る基線（上へ抜けた C と「3」の上端が触れないように）
    const box = (i, x) => ({ left: x + i.left, right: x + i.right, asc: i.asc, desc: i.desc });
    return { x0, xC: x0 + i3.adv, baseline, b3: box(i3, x0), bC: box(iC, x0 + i3.adv) };
  }

  // ---- 3つのCのキーフレーム（時間は秒）----
  // ring0 = 「C」、ring1 = 「3」の下のふくらみ、ring2 = 「3」の上のふくらみ
  // 「3」のふくらみは反転したC（rot=180）。三つ巴では ring1 が rot=120・ring2 が rot=240 なので、回すのは ±60° だけ。「C」は回さない
  function buildKeys(M) {
    const h3 = M.b3.asc + M.b3.desc, top3 = M.baseline - M.b3.asc, cx3 = (M.b3.left + M.b3.right) / 2;
    const hC = M.bC.asc + M.bC.desc, cyC = M.baseline - M.bC.asc + hC / 2, cxC = (M.bC.left + M.bC.right) / 2;
    const w = h3 * 0.165;                                          // 線の太さ（太字の線に寄せる。ふくらみの穴が潰れない範囲）
    const Rb = h3 * 0.285, Rt = h3 * 0.27;                         // 「3」の下・上のふくらみの外径（下が少し大きい。右端と上下端に接する）
    const TEXT = [                                                 // 文字のパーツと同じ位置・大きさのC
      { cx: cxC, cy: cyC, r: hC / 2 - w / 2, rot: 0, w, half: HALF },                      // C
      { cx: M.b3.right - Rb, cy: top3 + h3 - Rb, r: Rb - w / 2, rot: 180, w, half: 48 },   // 3の下のふくらみ
      { cx: M.b3.right - Rt, cy: top3 + Rt, r: Rt - w / 2, rot: 180, w, half: 48 },        // 3の上のふくらみ
    ];
    void cx3;
    const TRI = [                                                  // 3つのCが三角形に広がる（向きはもう三つ巴と同じ）
      { ang: -90, dist: 150, r: 64, rot: 0, w: 42, half: HALF },   // C: 右→上（0→-90。270 と書くと遠回りして下を通る）
      { ang: 30, dist: 150, r: 64, rot: 120, w: 42, half: HALF },  // 3の下: 左下→下を通って右下
      { ang: 150, dist: 150, r: 64, rot: 240, w: 42, half: HALF }, // 3の上: 左上→左下
    ].map(polar);
    // 三つ巴（アイコンと同じ）: 三角形から、各Cが自転しながら中心のまわりを120°回り込んで噛み合う（渦巻き）
    // 三つ巴は120°回しても同じ形なので、隣の席（ang-120）へ回り込み、自分も120°回れば（rot-120）着地の形はアイコンと一致する
    // ほどける時と同じ向き（角度が減る向き＝反時計回り）に回す
    // 自転: 公転と同じ120°だけだと常に同じ面を中心に向ける（月のように自転が見えない）ので、さらに1回転足す（rot−480）
    const FINAL = TRI.map((p) => polar({ ...p, ang: p.ang - 120, rot: p.rot - 120 - 360, dist: 40 * S, r: 70 * S, w: 54 }));
    // 文字の位置も極座標にしておく（TEXT→TRI を同じ向きに旋回させるため）
    // 角度は「そこから TRI の角度へ短い向きで回る」値にする（atan2 は ±180 で返すので、3の上のふくらみが -143° になり 150° へ大回りした事故があった）
    TEXT.forEach((p, i) => {
      p.dist = Math.hypot(p.cx - CX, p.cy - CY);
      let a = Math.atan2(p.cy - CY, p.cx - CX) / Math.PI * 180;
      const target = TRI[i].ang;
      while (a - target > 180) a -= 360;
      while (target - a > 180) a += 360;
      p.ang = a;
    });
    // ring ごとのキー時刻 [文字を出発, 三角形を通過（止まらない）, 着地（3つ同時）]。通過時刻は出発の遅れの4割だけずらし、三角形がほぼ同時に見えるようにする
    const ringKeys = (i) => [
      { t: T_LEAVE + OFF[i], s: TEXT[i] },
      { t: T_TRI + OFF[i] * 0.4, s: TRI[i] },
      { t: T_LAND, s: FINAL[i] },
    ];
    return { TEXT, TRI, FINAL, split: top3 + h3 * 0.5, ringKeys };
  }
  const OFF = [0, 0.14, 0.42];      // ring ごとの出発の遅れ（秒）。Cが先に上へ抜け、3の下が抜けてから、3の上がその跡へ降りる（上が早いと左上でCとぶつかる）
  const T_LEAVE = 1.0;              // 文字が動き出す
  const T_TRI = 2.3;                // 三角形を通過する（止まらず渦へ流れ込む）
  const T_LAND = 3.5;               // 3つ同時に着地
  const T_IN = [0.0, 0.5];          // 文字が現れる区間
  const T_GLASS = [3.42, 3.8];      // 着地（回転が止まる）と同時にガラスのPNGへ切り替わる区間（早いと回転中の C と二重に見える）
  const T_TITLE = [3.65, 4.15];     // 下の「3C日報」が出る区間
  const T_END = 4.3;

  // キーフレームを「止まらずに通過」する補間（Catmull-Rom 接線の Hermite スプライン）。両端の接線は 0＝静止から動き出し、静止へ着地
  const PARAMS = ["ang", "dist", "r", "rot", "w", "half"];
  function makeStateAt(K) {
    const hermite = (p0, p1, m0, m1, u, h) => {
      const u2 = u * u, u3 = u2 * u;
      return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * h * m1;
    };
    function ringAt(t, i) {
      const keys = K.ringKeys(i), n = keys.length - 1;
      if (t <= keys[0].t) return { p: keys[0].s, k: 0, u: 0 };
      if (t >= keys[n].t) return { p: keys[n].s, k: n, u: 1 };
      let j = 0; while (t >= keys[j + 1].t) j++;
      const h = keys[j + 1].t - keys[j].t, u = (t - keys[j].t) / h, o = {};
      for (const key of PARAMS) {
        const p0 = keys[j].s[key], p1 = keys[j + 1].s[key];
        const m0 = j === 0 ? 0 : (p1 - keys[j - 1].s[key]) / (keys[j + 1].t - keys[j - 1].t);
        const m1 = j + 1 === n ? 0 : (keys[j + 2].s[key] - p0) / (keys[j + 2].t - keys[j].t);
        o[key] = hermite(p0, p1, m0, m1, u, h);
      }
      return { p: polar(o), k: j + 1, u };
    }
    return (t) => [0, 1, 2].map((i) => ringAt(t, i));
  }

  // C の中心線（開き口を除いた円弧）のパス
  function arcPath(p) {
    const h = p.half == null ? HALF : p.half;
    const a0 = rad(p.rot + h), a1 = rad(p.rot + 360 - h);
    const x0 = p.cx + p.r * Math.cos(a0), y0 = p.cy + p.r * Math.sin(a0);
    const x1 = p.cx + p.r * Math.cos(a1), y1 = p.cy + p.r * Math.sin(a1);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${p.r.toFixed(2)} ${p.r.toFixed(2)} 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function build(svg) {
    svg.innerHTML = "";
    const M = measureText();
    const K = buildKeys(M);
    const stateAt = makeStateAt(K);
    const defs = el("defs", {}, svg);
    // 文字・Cのグラデーション（既存の .logo と同じ色）
    const g = el("linearGradient", { id: "lg-text", gradientUnits: "userSpaceOnUse", x1: 60, y1: 120, x2: 460, y2: 400 }, defs);
    el("stop", { offset: "0", "stop-color": "#8f5cf7" }, g);
    el("stop", { offset: ".55", "stop-color": "#b078ff" }, g);
    el("stop", { offset: "1", "stop-color": "#d6c3ff" }, g);
    // 「3」を上下に割るクリップ
    const cpTop = el("clipPath", { id: "lg-clip-top" }, defs);
    // 上下のクリップは 2 単位重ねる（ぴったり接すると境界のアンチエイリアスで細い線が見える）
    el("rect", { x: 0, y: 0, width: 512, height: K.split + 1 }, cpTop);
    const cpBot = el("clipPath", { id: "lg-clip-bot" }, defs);
    el("rect", { x: 0, y: K.split - 1, width: 512, height: 512 - K.split + 1 }, cpBot);
    // 文字→C の変形中だけ、ぼかしを山なりにかけて形の違いを溶かす（ring ごとに1つ。使わない時は filter 属性を外す）
    const morphBlur = [0, 1, 2].map((i) => {
      const f = el("filter", { id: "lg-morph" + i, x: "-30%", y: "-30%", width: "160%", height: "160%" }, defs);
      return el("feGaussianBlur", { stdDeviation: 0 }, f);
    });

    // 文字のパーツ（Cと同じ transform で動く）。ring0 = C, ring1 = 3の下, ring2 = 3の上
    const textRoot = el("g", {}, svg);
    const textAttrs = { "font-family": FONT_FAMILY, "font-weight": FONT_WEIGHT, "font-size": FONT_SIZE, fill: "url(#lg-text)" };
    const pieces = [el("g", {}, textRoot), el("g", {}, textRoot), el("g", {}, textRoot)];
    el("text", { ...textAttrs, x: M.xC, y: M.baseline }, pieces[0]).textContent = "C";
    el("text", { ...textAttrs, x: M.x0, y: M.baseline, "clip-path": "url(#lg-clip-bot)" }, pieces[1]).textContent = "3";
    el("text", { ...textAttrs, x: M.x0, y: M.baseline, "clip-path": "url(#lg-clip-top)" }, pieces[2]).textContent = "3";

    // C（円弧）。描く順 2 → 1 → 0
    const ringRoot = el("g", {}, svg);
    const rings = [];
    [2, 1, 0].forEach((i) => { rings[i] = el("path", { fill: "none", "stroke-linecap": "round", stroke: "url(#lg-text)", opacity: 0 }, ringRoot); });

    // 最後のガラス（アイコンと同じレンダラで描いた透明PNG）
    const glass = el("image", { href: GLASS_PNG, x: 0, y: 0, width: 512, height: 512, opacity: 0 }, svg);
    glass.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", GLASS_PNG);

    function draw(t) {
      const st = stateAt(t);
      const inK = easeOut(span(t, T_IN[0], T_IN[1]));
      const glassK = easeInOut(span(t, T_GLASS[0], T_GLASS[1]));
      st.forEach(({ p, k, u }, i) => {
        const p0 = K.TEXT[i];
        // 文字→C のクロスフェード（文字→三角形の区間の最初の 35%）
        const m = k < 1 ? 0 : k === 1 ? u : 1;
        const mp = span(m, 0.0, 0.5);                               // 変形の進み（文字→三角形の区間の最初の 50%）
        const fade = easeInOut(mp);
        const blur = 4 * Math.sin(Math.PI * mp);                    // 変形の真ん中で最大 4（SVG 単位）
        morphBlur[i].setAttribute("stdDeviation", blur.toFixed(2));
        const useBlur = mp > 0 && mp < 1;
        for (const node of [pieces[i], rings[i]]) { if (useBlur) node.setAttribute("filter", `url(#lg-morph${i})`); else node.removeAttribute("filter"); }
        // 文字のパーツ: C と同じ変換（中心へ平行移動・回転・拡大）
        const sc = (p.r + p.w / 2) / (p0.r + p0.w / 2);             // 外径の比で拡大（文字とCの見た目の大きさを合わせる）
        pieces[i].setAttribute("transform", `translate(${p.cx.toFixed(2)} ${p.cy.toFixed(2)}) rotate(${(p.rot - p0.rot).toFixed(2)}) scale(${sc.toFixed(4)}) translate(${(-p0.cx).toFixed(2)} ${(-p0.cy).toFixed(2)})`);
        pieces[i].setAttribute("opacity", String(inK * (1 - fade)));
        rings[i].setAttribute("d", arcPath(p));
        rings[i].setAttribute("stroke-width", String(p.w));
        // 飛んでいる間は少し透けさせて、重なりが層に見えるように。window.__logoDebug で常に薄く出す（文字との位置合わせ確認用）
        rings[i].setAttribute("opacity", String(Math.max(fade * 0.92 * (1 - glassK), window.__logoDebug ? 0.5 : 0)));
      });
      // 出だしは全体をほんの少し拡大しながら現れる
      textRoot.setAttribute("transform", `translate(${CX} ${CY}) scale(${(0.96 + 0.04 * inK).toFixed(4)}) translate(${-CX} ${-CY})`);
      glass.setAttribute("opacity", String(glassK));
    }
    return { draw };
  }

  function init() {
    const wrap = document.getElementById("logo-anim");
    if (!wrap) return;
    const svg = wrap.querySelector("svg");
    const title = wrap.querySelector(".logo-title");
    if (!svg) return;
    const scene = build(svg);
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, start = 0;

    function setTitle(k) {
      if (!title) return;
      title.style.opacity = String(k);
      title.style.transform = `translateY(${(1 - k) * 10}px)`;
    }
    function finish() { scene.draw(T_END); setTitle(1); wrap.classList.add("done"); }
    function play() {
      cancelAnimationFrame(raf);
      wrap.classList.remove("done");
      if (reduce) { finish(); return; }
      start = performance.now();
      const step = (now) => {
        const t = (now - start) / 1000;
        scene.draw(Math.min(t, T_END));
        setTitle(easeOut(span(t, T_TITLE[0], T_TITLE[1])));
        if (t < T_END) raf = requestAnimationFrame(step); else finish();
      };
      scene.draw(0); setTitle(0);
      raf = requestAnimationFrame(step);
    }
    wrap.addEventListener("click", play);
    // ログイン画面が見えた時に再生（ログアウトで戻ってきた時も）
    const view = document.getElementById("view-login");
    let shown = view ? !view.classList.contains("hidden") : true;
    if (shown) play(); else finish();
    if (view && window.MutationObserver) {
      new MutationObserver(() => {
        const now = !view.classList.contains("hidden");
        if (now && !shown) play();
        shown = now;
      }).observe(view, { attributes: true, attributeFilter: ["class"] });
    }
    window.playLogoAnim = play;
    // 検証用: 任意の秒に止める（Playwright でコマ撮りする時に使う）
    window.seekLogoAnim = (t) => { cancelAnimationFrame(raf); scene.draw(Math.min(t, T_END)); setTitle(easeOut(span(t, T_TITLE[0], T_TITLE[1]))); };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
