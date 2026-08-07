/* bubbleGame.js — a self-contained bubble-pop mini game (canvas), mounted
   into a host element by views.bubbleGame. Deliberately NOT wired into the
   points economy — a mental-break game shouldn't be a way to farm the real
   reward system. High score only, kept in localStorage (not cloud-synced,
   purely a local toy, same tier as form drafts / last-view). */
var BubbleGame = (function () {
  var COLORS = ['#c6ff3a', '#ff5ca8', '#ffe14d', '#7c5cff', '#2fd6c0'];
  var COLS = 8;
  var HS_KEY = 'era:bubbleHighScore';
  var BOMB = 'bomb';
  var BOMB_CHANCE = 0.08; // ~1 in 12 upcoming bubbles — a reward for playing, never pre-placed in the board itself

  function mount(host, onScoreChange) {
    var canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    canvas.style.borderRadius = '16px';
    host.appendChild(canvas);
    var ctx = canvas.getContext('2d');

    // `host` isn't attached to the live document yet at this point — this
    // runs inside views.bubbleGame(), *before* render() appends its return
    // value — so clientWidth would read 0. Sizing is deferred one frame
    // (see requestAnimationFrame(init) below) until layout is real, and
    // canvas.style.width is pinned to that exact px value rather than
    // '100%', so the logical coordinate space used for game math always
    // matches the rendered box 1:1 (a stretch mismatch there previously
    // warped circles into ellipses and threw off aim/collision math).
    var cssWidth = 320, r, rowHeight, visibleRows = 9, dangerRow, cssHeight;

    var grid = []; // grid[row][col] = color string, BOMB, or null
    var score = 0;
    var shots = 0;
    var comboStreak = 0; // consecutive shots in a row that each popped something
    var running = true;
    var current = null; // {x,y,vx,vy,color,moving}
    var nextColor = randomColor();
    var aimAngle = -Math.PI / 2;
    var particles = [];
    var floatingTexts = []; // combo / bomb callouts
    var fallingBubbles = []; // disconnected bubbles animating off the bottom

    function randomColor() { return COLORS[Math.floor(Math.random() * COLORS.length)]; }
    function pickNextColor() { return Math.random() < BOMB_CHANCE ? BOMB : randomColor(); }
    function colsInRow(row) { return row % 2 ? COLS - 1 : COLS; }
    function cellX(row, col) { return r + col * 2 * r + (row % 2 ? r : 0); }
    function cellY(row) { return r + row * rowHeight; }
    function shooterPos() { return { x: cssWidth / 2, y: cssHeight - r * 2 }; }

    function initGrid() {
      grid = [];
      for (var row = 0; row < 5; row++) {
        var cols = colsInRow(row);
        var arr = [];
        for (var c = 0; c < cols; c++) arr.push(randomColor());
        grid.push(arr);
      }
    }

    function spawnShot() {
      current = { x: shooterPos().x, y: shooterPos().y, color: nextColor, moving: false };
      nextColor = pickNextColor();
    }

    // hex neighbor offsets differ depending on whether the row is
    // odd/even (odd rows are visually shifted right by half a bubble)
    function neighbors(row, col) {
      var odd = row % 2 === 1;
      var deltas = odd
        ? [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]]
        : [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]];
      var out = [];
      deltas.forEach(function (d) {
        var rr = row + d[0], cc = col + d[1];
        if (rr < 0 || rr >= grid.length) return;
        if (cc < 0 || cc >= colsInRow(rr)) return;
        out.push([rr, cc]);
      });
      return out;
    }

    function addFloatingText(x, y, text, color) {
      floatingTexts.push({ x: x, y: y, text: text, color: color || '#f2f7ea', life: 45, vy: -0.6 });
    }

    // returns how many bubbles popped (0 = nothing happened, for combo tracking)
    function popGroupAt(row, col) {
      var color = grid[row][col];
      if (!color || color === BOMB) return 0;
      var seen = {}, stack = [[row, col]], group = [];
      seen[row + ',' + col] = true;
      while (stack.length) {
        var cur = stack.pop();
        group.push(cur);
        neighbors(cur[0], cur[1]).forEach(function (n) {
          var key = n[0] + ',' + n[1];
          if (seen[key] || grid[n[0]][n[1]] !== color) return;
          seen[key] = true;
          stack.push(n);
        });
      }
      if (group.length < 3) return 0;
      group.forEach(function (g) {
        spawnParticles(cellX(g[0], g[1]), cellY(g[0], g[1]), color);
        grid[g[0]][g[1]] = null;
      });
      score += group.length * 10;
      dropFloating();
      bumpHighScore();
      onScoreChange && onScoreChange(score);
      return group.length;
    }

    // a wildcard — pops itself plus every immediate neighbor regardless of
    // color. Always "hits" (returns > 0) so it keeps a combo alive.
    function popBomb(row, col) {
      var cells = [[row, col]].concat(neighbors(row, col));
      var popped = 0;
      cells.forEach(function (g) {
        if (grid[g[0]] && grid[g[0]][g[1]]) {
          spawnParticles(cellX(g[0], g[1]), cellY(g[0], g[1]), grid[g[0]][g[1]]);
          grid[g[0]][g[1]] = null;
          popped++;
        }
      });
      score += popped * 12;
      addFloatingText(cellX(row, col), cellY(row, col), 'boom! 💥', '#c6ff3a');
      dropFloating();
      bumpHighScore();
      onScoreChange && onScoreChange(score);
      return Math.max(popped, 1);
    }

    // saved as she plays, not just on game over — this game never really
    // "ends" until the danger line is hit, so waiting for that to save a
    // high score would lose progress the moment she just navigates away.
    function bumpHighScore() {
      var hs = Number(localStorage.getItem(HS_KEY) || 0);
      if (score > hs) localStorage.setItem(HS_KEY, String(score));
    }

    // anything not reachable from the ceiling (row 0) via same-grid
    // neighbors is floating in mid-air and falls off.
    function dropFloating() {
      var reached = {}, queue = [];
      (grid[0] || []).forEach(function (c, i) { if (c) { queue.push([0, i]); reached['0,' + i] = true; } });
      while (queue.length) {
        var cur = queue.shift();
        neighbors(cur[0], cur[1]).forEach(function (n) {
          var key = n[0] + ',' + n[1];
          if (reached[key] || !grid[n[0]][n[1]]) return;
          reached[key] = true;
          queue.push(n);
        });
      }
      var dropped = 0;
      for (var row = 0; row < grid.length; row++) {
        for (var col = 0; col < grid[row].length; col++) {
          if (grid[row][col] && !reached[row + ',' + col]) {
            fallingBubbles.push({ x: cellX(row, col), y: cellY(row, col), vy: 0, color: grid[row][col] });
            grid[row][col] = null;
            dropped++;
          }
        }
      }
      if (dropped) { score += dropped * 15; bumpHighScore(); onScoreChange && onScoreChange(score); }
    }

    function addRow() {
      var cols = colsInRow(0);
      var arr = [];
      for (var c = 0; c < cols; c++) arr.push(randomColor());
      grid.unshift(arr);
    }

    // game-over must track where bubbles actually ARE, not how many row
    // slots the grid array happens to have grown to — popped/dropped rows
    // near the bottom leave behind empty (but still-allocated) rows, and
    // checking array length there ended the game on a board nowhere near
    // the visible danger line.
    function pastDangerLine() {
      for (var row = dangerRow; row < grid.length; row++) {
        if (grid[row].some(function (c) { return c; })) return true;
      }
      return false;
    }

    function triggerGameOver() {
      running = false;
      bumpHighScore();
      onScoreChange && onScoreChange(score);
    }

    function nearestEmptyCell(px, py) {
      var row = Math.max(0, Math.round((py - r) / rowHeight));
      while (grid.length <= row) grid.push(new Array(colsInRow(grid.length)).fill(null));
      var odd = row % 2 === 1;
      var col = Math.round((px - r - (odd ? r : 0)) / (2 * r));
      col = Math.max(0, Math.min(colsInRow(row) - 1, col));
      if (!grid[row][col]) return [row, col];
      var seen = {}, queue = [[row, col]];
      seen[row + ',' + col] = true;
      while (queue.length) {
        var cur = queue.shift();
        if (!grid[cur[0]][cur[1]]) return cur;
        neighbors(cur[0], cur[1]).forEach(function (n) {
          var key = n[0] + ',' + n[1];
          if (seen[key]) return;
          seen[key] = true;
          queue.push(n);
        });
      }
      return [row, col];
    }

    function allCleared() {
      return grid.every(function (row) { return row.every(function (c) { return !c; }); });
    }

    function settle() {
      var cell = nearestEmptyCell(current.x, current.y);
      while (grid.length <= cell[0]) grid.push(new Array(colsInRow(grid.length)).fill(null));
      var placedColor = current.color;
      grid[cell[0]][cell[1]] = placedColor;
      current = null;
      shots++;
      if (shots % 5 === 0) addRow();

      var popped = placedColor === BOMB ? popBomb(cell[0], cell[1]) : popGroupAt(cell[0], cell[1]);
      if (popped) {
        comboStreak++;
        if (comboStreak >= 2) {
          var bonus = (comboStreak - 1) * 15;
          score += bonus;
          bumpHighScore();
          onScoreChange && onScoreChange(score);
          addFloatingText(cellX(cell[0], cell[1]), cellY(cell[0], cell[1]) - r * 1.6, 'combo x' + comboStreak + '! +' + bonus, '#ffe14d');
        }
      } else {
        comboStreak = 0;
      }

      if (pastDangerLine()) triggerGameOver();
      if (running && allCleared()) initGrid();
      if (running) spawnShot();
    }

    function spawnParticles(x, y, color) {
      for (var i = 0; i < 6; i++) {
        particles.push({
          x: x, y: y, color: color === BOMB ? '#c6ff3a' : color,
          vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4 - 1,
          life: 20
        });
      }
    }

    function shoot(targetX, targetY) {
      if (!running || !current || current.moving) return;
      var sp = shooterPos();
      var dx = targetX - sp.x, dy = targetY - sp.y;
      if (dy >= -10) dy = -10; // never aim flat/downward
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var speed = 9;
      current.vx = (dx / len) * speed;
      current.vy = (dy / len) * speed;
      current.moving = true;
    }

    function swapNext() {
      if (!current || current.moving) return;
      var tmp = current.color;
      current.color = nextColor;
      nextColor = tmp;
    }

    // dry-runs the exact same physics as update() below (wall bounces +
    // collision) to draw a real predicted flight path instead of a short
    // static line — the classic bubble-shooter aim guide.
    function simulatePath(angle) {
      var speed = 9;
      var x = shooterPos().x, y = shooterPos().y;
      var vx = Math.cos(angle) * speed, vy = Math.sin(angle) * speed;
      var pts = [{ x: x, y: y }];
      var hitDist = 2 * r * 0.92;
      for (var i = 0; i < 160; i++) {
        x += vx; y += vy;
        if (x - r < 0) { x = r; vx *= -1; }
        if (x + r > cssWidth) { x = cssWidth - r; vx *= -1; }
        pts.push({ x: x, y: y });
        if (y - r <= 0) break;
        var hit = false;
        for (var row = 0; row < grid.length && !hit; row++) {
          for (var col = 0; col < grid[row].length; col++) {
            if (!grid[row][col]) continue;
            var ddx = x - cellX(row, col), ddy = y - cellY(row, col);
            if (ddx * ddx + ddy * ddy < hitDist * hitDist) { hit = true; break; }
          }
        }
        if (hit) break;
      }
      return pts;
    }

    function update() {
      if (particles.length) {
        particles = particles.filter(function (p) {
          p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.life--;
          return p.life > 0;
        });
      }
      if (floatingTexts.length) {
        floatingTexts = floatingTexts.filter(function (t) {
          t.y += t.vy; t.life--;
          return t.life > 0;
        });
      }
      if (fallingBubbles.length) {
        fallingBubbles = fallingBubbles.filter(function (f) {
          f.vy += 0.5; f.y += f.vy;
          return f.y < cssHeight + r * 2;
        });
      }
      if (!current || !current.moving) return;
      current.x += current.vx;
      current.y += current.vy;
      if (current.x - r < 0) { current.x = r; current.vx *= -1; }
      if (current.x + r > cssWidth) { current.x = cssWidth - r; current.vx *= -1; }
      if (current.y - r <= 0) { current.y = r; settle(); return; }
      var hitDist = 2 * r * 0.92;
      for (var row = 0; row < grid.length; row++) {
        for (var col = 0; col < grid[row].length; col++) {
          if (!grid[row][col]) continue;
          var dx = current.x - cellX(row, col), dy = current.y - cellY(row, col);
          if (dx * dx + dy * dy < hitDist * hitDist) { settle(); return; }
        }
      }
    }

    function drawBubble(x, y, color, radius) {
      var rad = radius || r * 0.92;
      if (color === BOMB) {
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fillStyle = '#12160a';
        ctx.fill();
        ctx.lineWidth = Math.max(2, rad * 0.1);
        ctx.strokeStyle = '#c6ff3a';
        ctx.stroke();
        ctx.fillStyle = '#c6ff3a';
        ctx.font = '700 ' + Math.round(rad * 1.1) + 'px Bricolage Grotesque, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✷', x, y + 1);
        return;
      }
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - rad * 0.3, y - rad * 0.3, rad * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.fill();
    }

    function draw() {
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      for (var row = 0; row < grid.length; row++) {
        for (var col = 0; col < grid[row].length; col++) {
          if (grid[row][col]) drawBubble(cellX(row, col), cellY(row, col), grid[row][col]);
        }
      }
      ctx.strokeStyle = 'rgba(255,92,114,.4)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      var dangerY = cellY(dangerRow) + r;
      ctx.moveTo(0, dangerY); ctx.lineTo(cssWidth, dangerY);
      ctx.stroke();
      ctx.setLineDash([]);

      fallingBubbles.forEach(function (f) { drawBubble(f.x, f.y, f.color); });

      particles.forEach(function (p) {
        ctx.globalAlpha = Math.max(0, p.life / 20);
        drawBubble(p.x, p.y, p.color, r * 0.4);
        ctx.globalAlpha = 1;
      });

      var sp = shooterPos();
      if (current && !current.moving && running) {
        var path = simulatePath(aimAngle);
        ctx.strokeStyle = 'rgba(242,247,234,.35)';
        ctx.setLineDash([6, 8]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        path.forEach(function (pt, i) { i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y); });
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (current) drawBubble(current.x, current.y, current.color);
      drawBubble(sp.x + r * 2.6, sp.y, nextColor, r * 0.7);

      floatingTexts.forEach(function (t) {
        ctx.globalAlpha = Math.max(0, t.life / 45);
        ctx.fillStyle = t.color;
        ctx.font = '800 14px Bricolage Grotesque, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(t.text, t.x, t.y);
        ctx.globalAlpha = 1;
      });

      if (!running) {
        ctx.fillStyle = 'rgba(10,13,7,.72)';
        ctx.fillRect(0, 0, cssWidth, cssHeight);
        ctx.fillStyle = '#f2f7ea';
        ctx.font = '700 17px Bricolage Grotesque, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('game over — tap to restart', cssWidth / 2, cssHeight / 2);
      }
    }

    function loop() {
      if (!canvas.isConnected) return; // view got torn down — stop cleanly
      update();
      draw();
      requestAnimationFrame(loop);
    }

    // deferred one frame so `host` has real layout (see note up top) —
    // sizes the canvas, seeds the grid, and only then starts the loop.
    function init() {
      cssWidth = host.clientWidth || 320;
      r = cssWidth / (COLS * 2 + 1);
      rowHeight = r * Math.sqrt(3);
      dangerRow = visibleRows - 1;
      cssHeight = rowHeight * (visibleRows + 2) + r * 4;

      var dpr = window.devicePixelRatio || 1;
      canvas.width = cssWidth * dpr;
      canvas.height = cssHeight * dpr;
      canvas.style.width = cssWidth + 'px';
      canvas.style.height = cssHeight + 'px';
      ctx.scale(dpr, dpr);

      initGrid();
      spawnShot();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(init);

    function pointerPos(e) {
      var rect = canvas.getBoundingClientRect();
      var clientX = e.touches ? e.touches[0].clientX : e.clientX;
      var clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: clientX - rect.left, y: clientY - rect.top };
    }
    canvas.addEventListener('pointermove', function (e) {
      var p = pointerPos(e);
      var sp = shooterPos();
      aimAngle = Math.atan2(p.y - sp.y, p.x - sp.x);
    });
    canvas.addEventListener('pointerdown', function (e) {
      if (!running) { restart(); return; }
      var p = pointerPos(e);
      var sp = shooterPos();
      var nx = sp.x + r * 2.6, ny = sp.y;
      var ndx = p.x - nx, ndy = p.y - ny;
      if (ndx * ndx + ndy * ndy < (r * 0.9) * (r * 0.9)) { swapNext(); return; }
      shoot(p.x, p.y);
    });

    function restart() {
      grid = []; score = 0; shots = 0; comboStreak = 0; running = true;
      particles = []; floatingTexts = []; fallingBubbles = [];
      initGrid();
      spawnShot();
      onScoreChange && onScoreChange(score);
    }

    return {
      restart: restart,
      getScore: function () { return score; },
      getHighScore: function () { return Number(localStorage.getItem(HS_KEY) || 0); }
    };
  }

  return { mount: mount };
})();
