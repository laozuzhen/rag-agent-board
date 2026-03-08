const fs = require('fs');
const path = require('path');

const indexHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>任务看板</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <h1><span class="logo">📋</span> 任务看板</h1>
    <div class="header-actions">
      <div class="tabs" id="viewTabs">
        <button class="tab active" data-view="board">看板</button>
        <button class="tab" data-view="agents">代理</button>
        <button class="tab" data-view="stats">统计</button>
      </div>
      <button class="theme-toggle" id="themeToggle" title="切换颜色模式">🌙</button>
    </div>
  </header>

  <div class="project-bar" id="projectBar">
    <select id="projectSelect"><option value="">选择项目...</option></select>
    <select id="agentFilter"><option value="">全部代理</option></select>
    <button id="newProjectBtn">+ 新项目</button>
    <button id="newTaskBtn">+ 新任务</button>
  </div>

  <div class="board" id="boardView"></div>
  <div class="agent-grid hidden" id="agentsView"></div>
  <div class="stats-view hidden" id="statsView"></div>

  <div class="detail-panel" id="detailPanel">
    <button class="btn" id="closeDetail" style="float:right">✕</button>
    <div id="detailContent"></div>
  </div>

  <script src="app.js"></script>
</body>
</html>`;

const targetPath = path.join(__dirname, 'dist', 'dashboard', 'index.html');
fs.writeFileSync(targetPath, indexHtml, 'utf8');
console.log('Written:', targetPath);
