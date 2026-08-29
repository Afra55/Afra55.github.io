(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const STORAGE_KEY = "devtools-minigames-v1";
  const GAME_IDS = ["2048", "snake", "flappy", "mole"];

  let root = null;
  let canvas = null;
  let ctx = null;
  let hudEl = null;
  let hintEl = null;
  let overlayEl = null;
  let tabBtns = [];
  let inited = false;
  let activeId = "2048";
  let raf = 0;
  let running = false;
  let keyHandler = null;
  let pointerHandler = null;
  let resizeObserver = null;  let bestScores = { "2048": 0, snake: 0, flappy: 0, mole: 0 };

  function loadScores() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.best && typeof data.best === "object") {
        for (const id of GAME_IDS) {
          if (Number.isFinite(data.best[id])) bestScores[id] = Math.max(0, Math.floor(data.best[id]));
        }
      }
      if (typeof data.last === "string" && GAME_IDS.includes(data.last)) activeId = data.last;
    } catch (_) {}
  }

  function saveScores() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ best: bestScores, last: activeId })
      );
    } catch (_) {}
  }

  function bumpBest(id, score) {
    const n = Math.max(0, Math.floor(Number(score) || 0));
    if (n > (bestScores[id] || 0)) {
      bestScores[id] = n;
      saveScores();
    }
  }

  function sizeCanvas() {
    if (!canvas || !ctx) return { w: 300, h: 300, dpr: 1 };
    const box = canvas.parentElement?.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(260, Math.floor(box?.width || 320));
    const h = Math.max(280, Math.min(Math.floor(w * 1.05), Math.floor(window.innerHeight * 0.52)));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h, dpr };
  }

  function setHud(html) {
    if (hudEl) hudEl.innerHTML = html;
  }

  function setHint(text) {
    if (hintEl) hintEl.textContent = text;
  }

  function showOverlay(title, sub, actionLabel) {
    if (!overlayEl) return;
    overlayEl.hidden = false;
    overlayEl.innerHTML = `<strong>${title}</strong><span>${sub || ""}</span><button type="button" class="primary-btn" id="minigames-retry">${actionLabel || "再来一局"}</button>`;
    overlayEl.querySelector("#minigames-retry")?.addEventListener("click", () => {
      overlayEl.hidden = true;
      startActiveGame();
    }, { once: true });
  }

  function hideOverlay() {
    if (overlayEl) overlayEl.hidden = true;
  }

  // —— 2048 ——
  const G2048 = (() => {
    let grid = [];
    let score = 0;
    let over = false;
    let won = false;

    function emptyGrid() {
      return Array.from({ length: 4 }, () => Array(4).fill(0));
    }

    function randCell() {
      const empty = [];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!grid[r][c]) empty.push([r, c]);
      if (!empty.length) return;
      const [r, c] = empty[Math.floor(Math.random() * empty.length)];
      grid[r][c] = Math.random() < 0.9 ? 2 : 4;
    }

    function slide(line) {
      const nums = line.filter((v) => v);
      const out = [];
      for (let i = 0; i < nums.length; i++) {
        if (nums[i] && nums[i] === nums[i + 1]) {
          const v = nums[i] * 2;
          out.push(v);
          score += v;
          i++;
        } else out.push(nums[i] || 0);
      }
      while (out.length < 4) out.push(0);
      return out;
    }

    function move(dir) {
      if (over) return false;
      const old = JSON.stringify(grid);
      if (dir === "left") {
        for (let r = 0; r < 4; r++) grid[r] = slide(grid[r]);
      } else if (dir === "right") {
        for (let r = 0; r < 4; r++) grid[r] = slide(grid[r].slice().reverse()).reverse();
      } else if (dir === "up") {
        for (let c = 0; c < 4; c++) {
          const col = [grid[0][c], grid[1][c], grid[2][c], grid[3][c]];
          const next = slide(col);
          for (let r = 0; r < 4; r++) grid[r][c] = next[r];
        }
      } else if (dir === "down") {
        for (let c = 0; c < 4; c++) {
          const col = [grid[0][c], grid[1][c], grid[2][c], grid[3][c]].reverse();
          const next = slide(col).reverse();
          for (let r = 0; r < 4; r++) grid[r][c] = next[r];
        }
      }
      if (JSON.stringify(grid) === old) return false;
      randCell();
      checkEnd();
      return true;
    }

    function canMove() {
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        if (!grid[r][c]) return true;
        if (c < 3 && grid[r][c] === grid[r][c + 1]) return true;
        if (r < 3 && grid[r][c] === grid[r + 1][c]) return true;
      }
      return false;
    }

    function checkEnd() {
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        if (grid[r][c] >= 2048) won = true;
      }
      if (!canMove()) over = true;
    }

    function tileColor(v) {
      const map = {
        0: ["#cdc1b4", "#776e65"],
        2: ["#eee4da", "#776e65"],
        4: ["#ede0c8", "#776e65"],
        8: ["#f2b179", "#f9f6f2"],
        16: ["#f59563", "#f9f6f2"],
        32: ["#f67c5f", "#f9f6f2"],
        64: ["#f65e3b", "#f9f6f2"],
        128: ["#edcf72", "#f9f6f2"],
        256: ["#edcc61", "#f9f6f2"],
        512: ["#edc850", "#f9f6f2"],
        1024: ["#edc53f", "#f9f6f2"],
        2048: ["#edc22e", "#f9f6f2"],
      };
      return map[v] || ["#3c3a32", "#f9f6f2"];
    }

    function draw() {
      const { w, h } = sizeCanvas();
      const pad = 12;
      const size = Math.min(w, h) - pad * 2;
      const cell = size / 4;
      const ox = (w - size) / 2;
      const oy = (h - size) / 2;
      ctx.fillStyle = "#bbada0";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#faf8ef";
      roundRect(ctx, ox - 4, oy - 4, size + 8, size + 8, 8);
      ctx.fill();
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const v = grid[r][c];
          const [bg, fg] = tileColor(v);
          const x = ox + c * cell + 4;
          const y = oy + r * cell + 4;
          ctx.fillStyle = bg;
          roundRect(ctx, x, y, cell - 8, cell - 8, 6);
          ctx.fill();
          if (v) {
            ctx.fillStyle = fg;
            ctx.font = `700 ${v >= 1024 ? cell * 0.28 : cell * 0.36}px system-ui,sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(String(v), x + (cell - 8) / 2, y + (cell - 8) / 2);
          }
        }
      }
      setHud(`<span>得分 <strong class="mono">${score}</strong></span><span>最佳 <strong class="mono">${bestScores["2048"]}</strong></span>`);
      if (over) {
        bumpBest("2048", score);
        showOverlay(won ? "达成 2048！" : "无路可走", `得分 ${score}`, "再来一局");
      }
    }

    function onKey(e) {
      const map = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
      if (!map[e.key]) return;
      e.preventDefault();
      if (move(map[e.key])) draw();
    }

    let touchStart = null;
    function onPointer(e) {
      if (e.type === "pointerdown") {
        touchStart = { x: e.clientX, y: e.clientY };
      } else if (e.type === "pointerup" && touchStart) {
        const dx = e.clientX - touchStart.x;
        const dy = e.clientY - touchStart.y;
        touchStart = null;
        if (Math.hypot(dx, dy) < 24) return;
        const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
        if (move(dir)) draw();
      }
    }

    return {
      id: "2048",
      hint: "方向键或滑动合并数字，合成 2048 即胜。",
      start() {
        grid = emptyGrid();
        score = 0;
        over = false;
        won = false;
        hideOverlay();
        randCell();
        randCell();
        draw();
      },
      stop() {},
      onKey,
      onPointer,
    };
  })();

  // —— 贪吃蛇 ——
  const Snake = (() => {
    let cols = 20;
    let rows = 20;
    let snake = [];
    let dir = { x: 1, y: 0 };
    let nextDir = { x: 1, y: 0 };
    let food = { x: 5, y: 5 };
    let score = 0;
    let alive = true;
    let tick = 0;
    let speed = 8;

    function placeFood() {
      for (let i = 0; i < 200; i++) {
        const x = Math.floor(Math.random() * cols);
        const y = Math.floor(Math.random() * rows);
        if (!snake.some((s) => s.x === x && s.y === y)) {
          food = { x, y };
          return;
        }
      }
    }

    function resetGrid(w, h) {
      cols = Math.max(12, Math.floor(w / 16));
      rows = Math.max(14, Math.floor(h / 16));
    }

    function step() {
      if (!alive) return;
      dir = nextDir;
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
      if (head.x < 0 || head.y < 0 || head.x >= cols || head.y >= rows) {
        alive = false;
        bumpBest("snake", score);
        showOverlay("撞墙了", `长度 ${score + 3}`, "再来一局");
        return;
      }
      if (snake.some((s) => s.x === head.x && s.y === head.y)) {
        alive = false;
        bumpBest("snake", score);
        showOverlay("咬到自己", `长度 ${score + 3}`, "再来一局");
        return;
      }
      snake.unshift(head);
      if (head.x === food.x && head.y === food.y) {
        score += 1;
        if (score % 4 === 0 && speed > 5) speed -= 0.4;
        placeFood();
      } else snake.pop();
    }

    function draw() {
      const { w, h } = sizeCanvas();
      resetGrid(w, h);
      const cell = Math.min(w / cols, h / rows);
      const ox = (w - cell * cols) / 2;
      const oy = (h - cell * rows) / 2;
      ctx.fillStyle = "#1a2332";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#243044";
      for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
        if ((x + y) % 2) ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
      }
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(ox + food.x * cell + cell / 2, oy + food.y * cell + cell / 2, cell * 0.32, 0, Math.PI * 2);
      ctx.fill();
      snake.forEach((s, i) => {
        ctx.fillStyle = i === 0 ? "#4ade80" : "#22c55e";
        roundRect(ctx, ox + s.x * cell + 1, oy + s.y * cell + 1, cell - 2, cell - 2, 4);
        ctx.fill();
      });
      setHud(`<span>长度 <strong class="mono">${score + 3}</strong></span><span>最佳 <strong class="mono">${bestScores.snake + 3}</strong></span>`);
    }

    function loop() {
      tick += 1;
      if (tick % Math.max(4, Math.round(speed)) === 0) step();
      draw();
      if (alive) raf = requestAnimationFrame(loop);
    }

    function setDir(x, y) {
      if (snake.length > 1 && x === -dir.x && y === -dir.y) return;
      nextDir = { x, y };
    }

    function onKey(e) {
      const map = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (!map[e.key]) return;
      e.preventDefault();
      setDir(map[e.key][0], map[e.key][1]);
    }

    let touchStart = null;
    function onPointer(e) {
      if (e.type === "pointerdown") touchStart = { x: e.clientX, y: e.clientY };
      else if (e.type === "pointerup" && touchStart) {
        const dx = e.clientX - touchStart.x;
        const dy = e.clientY - touchStart.y;
        touchStart = null;
        if (Math.hypot(dx, dy) < 20) return;
        if (Math.abs(dx) > Math.abs(dy)) setDir(dx > 0 ? 1 : -1, 0);
        else setDir(0, dy > 0 ? 1 : -1);
      }
    }

    return {
      id: "snake",
      hint: "方向键或滑动控制蛇头，吃红点变长；撞墙或自身结束。",
      start() {
        hideOverlay();
        snake = [{ x: 4, y: 10 }, { x: 3, y: 10 }, { x: 2, y: 10 }];
        dir = { x: 1, y: 0 };
        nextDir = { x: 1, y: 0 };
        score = 0;
        speed = 8;
        tick = 0;
        alive = true;
        placeFood();
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(loop);
      },
      stop() {
        alive = false;
        cancelAnimationFrame(raf);
      },
      onKey,
      onPointer,
    };
  })();

  // —— Flappy ——
  const Flappy = (() => {
    let bird = { y: 0, vy: 0 };
    let pipes = [];
    let score = 0;
    let alive = true;
    let t = 0;
    let gap = 110;
    let pipeW = 52;

    function resetPipes(w) {
      pipes = [];
      for (let i = 0; i < 4; i++) {
        pipes.push({ x: w + i * 180, gapY: 80 + Math.random() * 120, scored: false });
      }
    }

    function flap() {
      if (!alive) return;
      bird.vy = -5.2;
    }

    function step(w, h) {
      t += 1;
      bird.vy += 0.28;
      bird.y += bird.vy;
      const ground = h - 48;
      if (bird.y < 24) {
        bird.y = 24;
        bird.vy = 0;
      }
      if (bird.y > ground - 16) {
        alive = false;
        bumpBest("flappy", score);
        showOverlay("坠落了", `穿过 ${score} 根管道`, "再来一局");
      }
      for (const p of pipes) {
        p.x -= 2.4;
        if (!p.scored && p.x + pipeW < w * 0.28) {
          p.scored = true;
          score += 1;
        }
        const bx = w * 0.28;
        const by = bird.y;
        if (bx + 14 > p.x && bx - 14 < p.x + pipeW) {
          if (by - 14 < p.gapY || by + 14 > p.gapY + gap) {
            alive = false;
            bumpBest("flappy", score);
            showOverlay("撞管了", `穿过 ${score} 根管道`, "再来一局");
          }
        }
      }
      while (pipes[0].x < -pipeW) {
        pipes.shift();
        const last = pipes[pipes.length - 1];
        pipes.push({ x: last.x + 180, gapY: 60 + Math.random() * (h - gap - 120), scored: false });
      }
    }

    function draw() {
      const { w, h } = sizeCanvas();
      step(w, h);
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#7dd3fc");
      grad.addColorStop(1, "#e0f2fe");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#86efac";
      ctx.fillRect(0, h - 48, w, 48);
      ctx.fillStyle = "#22c55e";
      for (const p of pipes) {
        ctx.fillRect(p.x, 0, pipeW, p.gapY);
        ctx.fillRect(p.x, p.gapY + gap, pipeW, h);
      }
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(w * 0.28, bird.y, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(w * 0.28 + 6, bird.y - 3, 3, 0, Math.PI * 2);
      ctx.fill();
      setHud(`<span>穿过 <strong class="mono">${score}</strong></span><span>最佳 <strong class="mono">${bestScores.flappy}</strong></span>`);
      if (alive) raf = requestAnimationFrame(draw);
    }

    function onKey(e) {
      if (e.key === " " || e.key === "ArrowUp") {
        e.preventDefault();
        flap();
      }
    }

    function onPointer(e) {
      if (e.type === "pointerdown") {
        e.preventDefault();
        flap();
      }
    }

    return {
      id: "flappy",
      hint: "点击或空格振翅，穿过绿色管道缝隙。",
      start() {
        hideOverlay();
        const { w, h } = sizeCanvas();
        bird = { y: h * 0.45, vy: 0 };
        score = 0;
        alive = true;
        t = 0;
        resetPipes(w);
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(draw);
      },
      stop() {
        alive = false;
        cancelAnimationFrame(raf);
      },
      onKey,
      onPointer,
    };
  })();

  // —— 打地鼠 ——
  const Mole = (() => {
    const HOLES = 9;
    let moles = Array(HOLES).fill(false);
    let timeLeft = 30;
    let score = 0;
    let misses = 0;
    let playing = false;
    let lastSpawn = 0;
    let lastTick = 0;

    function spawn(now) {
      if (now - lastSpawn < 420) return;
      lastSpawn = now;
      const free = [];
      for (let i = 0; i < HOLES; i++) if (!moles[i]) free.push(i);
      if (!free.length) return;
      moles[free[Math.floor(Math.random() * free.length)]] = true;
      window.setTimeout(() => {
        for (let i = 0; i < HOLES; i++) {
          if (moles[i]) {
            moles[i] = false;
            misses += 1;
          }
        }
      }, 780 + Math.random() * 400);
    }

    function drawGrid(w, h) {
      const cols = 3;
      const pad = 16;
      const size = Math.min((w - pad * 2) / cols, (h - 80) / cols);
      const ox = (w - size * cols) / 2;
      const oy = (h - size * cols) / 2 + 10;
      ctx.fillStyle = "#3f2e1f";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < HOLES; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const x = ox + c * size;
        const y = oy + r * size;
        ctx.fillStyle = "#2a1c12";
        ctx.beginPath();
        ctx.ellipse(x + size / 2, y + size * 0.62, size * 0.34, size * 0.14, 0, 0, Math.PI * 2);
        ctx.fill();
        if (moles[i]) {
          ctx.fillStyle = "#8B5E3C";
          ctx.beginPath();
          ctx.ellipse(x + size / 2, y + size * 0.48, size * 0.28, size * 0.34, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#111";
          ctx.beginPath();
          ctx.arc(x + size / 2 - size * 0.08, y + size * 0.42, size * 0.04, 0, Math.PI * 2);
          ctx.arc(x + size / 2 + size * 0.08, y + size * 0.42, size * 0.04, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.strokeRect(x + 4, y + 4, size - 8, size - 8);
      }
      return { ox, oy, size, cols };
    }

    function loop(now) {
      if (!playing) return;
      if (now - lastTick >= 1000) {
        lastTick = now;
        timeLeft -= 1;
        if (timeLeft <= 0) {
          playing = false;
          bumpBest("mole", score);
          showOverlay("时间到", `得分 ${score}（失误 ${misses}）`, "再来一局");
          draw();
          return;
        }
      }
      spawn(now);
      draw();
      raf = requestAnimationFrame(loop);
    }

    function draw() {
      const { w, h } = sizeCanvas();
      drawGrid(w, h);
      setHud(`<span>得分 <strong class="mono">${score}</strong></span><span>剩余 <strong class="mono">${timeLeft}s</strong></span><span>最佳 <strong class="mono">${bestScores.mole}</strong></span>`);
    }

    function hitAt(x, y) {
      const { w, h } = sizeCanvas();
      const cols = 3;
      const pad = 16;
      const size = Math.min((w - pad * 2) / cols, (h - 80) / cols);
      const ox = (w - size * cols) / 2;
      const oy = (h - size * cols) / 2 + 10;
      for (let i = 0; i < HOLES; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const hx = ox + c * size;
        const hy = oy + r * size;
        if (x >= hx && x <= hx + size && y >= hy && y <= hy + size) {
          if (moles[i]) {
            moles[i] = false;
            score += 1;
          } else {
            misses += 1;
            score = Math.max(0, score - 1);
          }
          draw();
          return;
        }
      }
    }

    function onPointer(e) {
      if (!playing || e.type !== "pointerdown") return;
      const rect = canvas.getBoundingClientRect();
      hitAt(e.clientX - rect.left, e.clientY - rect.top);
    }

    return {
      id: "mole",
      hint: "30 秒内点击冒头的地鼠；打空扣 1 分。",
      start() {
        hideOverlay();
        moles = Array(HOLES).fill(false);
        timeLeft = 30;
        score = 0;
        misses = 0;
        playing = true;
        lastSpawn = 0;
        lastTick = performance.now();
        draw();
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(loop);
      },
      stop() {
        playing = false;
        cancelAnimationFrame(raf);
      },
      onKey() {},
      onPointer,
    };
  })();

  const GAMES = {
    "2048": G2048,
    snake: Snake,
    flappy: Flappy,
    mole: Mole,
  };

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function detachHandlers() {
    if (keyHandler) {
      document.removeEventListener("keydown", keyHandler);
      keyHandler = null;
    }
    if (pointerHandler && canvas) {
      canvas.removeEventListener("pointerdown", pointerHandler);
      canvas.removeEventListener("pointerup", pointerHandler);
      pointerHandler = null;
    }
  }

  function attachHandlers(game) {
    detachHandlers();
    keyHandler = (e) => game.onKey?.(e);
    document.addEventListener("keydown", keyHandler);
    pointerHandler = (e) => game.onPointer?.(e);
    if (canvas) {
      canvas.addEventListener("pointerdown", pointerHandler);
      canvas.addEventListener("pointerup", pointerHandler);
    }
  }

  function stopActiveGame() {
    cancelAnimationFrame(raf);
    GAMES[activeId]?.stop?.();
    detachHandlers();
    running = false;
  }

  function startActiveGame() {
    const game = GAMES[activeId];
    if (!game || !canvas) return;
    stopActiveGame();
    running = true;
    setHint(game.hint || "");
    attachHandlers(game);
    game.start();
  }

  function switchGame(id) {
    if (!GAME_IDS.includes(id) || id === activeId) return;
    activeId = id;
    saveScores();
    tabBtns.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.game === id));
    startActiveGame();
  }

  function bindTabs() {
    tabBtns = Array.from(root?.querySelectorAll("[data-game]") || []);
    tabBtns.forEach((btn) => {
      btn.addEventListener("click", () => switchGame(btn.dataset.game));
    });
  }

  function isMinigamesRoute() {
    const raw = String(location.hash || "").replace(/^#/, "").trim();
    return raw.split(/[/?]/)[0] === "minigames";
  }

  function ensureMinigames() {
    if (inited) {
      if (running) startActiveGame();
      return;
    }
    root = $("#minigames");
    if (!root || root.dataset.bound) return;
    root.dataset.bound = "1";
    canvas = $("#minigames-canvas");
    ctx = canvas?.getContext("2d");
    hudEl = $("#minigames-hud");
    hintEl = $("#minigames-hint");
    overlayEl = $("#minigames-overlay");
    loadScores();
    bindTabs();
    tabBtns.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.game === activeId));
    inited = true;
    startActiveGame();
  }

  function onRoute(ev) {
    const tool = ev?.detail?.tool || (isMinigamesRoute() ? "minigames" : "");
    if (tool === "minigames") ensureMinigames();
    else stopActiveGame();
  }

  window.addEventListener("devtools:route", onRoute);
  if (isMinigamesRoute()) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", ensureMinigames, { once: true });
    } else {
      ensureMinigames();
    }
  }
})();
