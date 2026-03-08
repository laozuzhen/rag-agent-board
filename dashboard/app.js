// Agent Board - Dashboard App (zh-CN)
(function () {
  const API = "/agent-board/api";
  const COLUMNS = ["backlog", "todo", "doing", "review", "done", "failed"];
  const COL_LABELS = {
    backlog: "积压",
    todo: "待办",
    doing: "进行中",
    review: "评审中",
    done: "已完成",
    failed: "失败",
  };
  const PRIORITY_LABELS = {
    low: "低",
    medium: "中",
    high: "高",
    urgent: "紧急",
  };

  let state = {
    projects: [],
    tasks: [],
    agents: [],
    currentProject: null,
    currentView: "board",
    filterAgent: null,
  };

  const themeToggle = document.getElementById("themeToggle");
  const projectSelect = document.getElementById("projectSelect");
  const agentFilter = document.getElementById("agentFilter");
  const detailPanel = document.getElementById("detailPanel");
  const detailContent = document.getElementById("detailContent");

  let draggedId = null;
  let threadInterval = null;
  let currentDetailTaskId = null;

  function esc(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function formatPriority(priority) {
    return PRIORITY_LABELS[priority] || priority || "未设置";
  }

  function formatColumn(column) {
    return COL_LABELS[column] || column || "未知";
  }

  function formatDuration(ms) {
    if (!ms) return "无";
    const mins = Math.floor(ms / 60000);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs} 小时 ${mins % 60} 分钟`;
    return `${mins} 分钟`;
  }

  function initTheme() {
    const saved = localStorage.getItem("ab-theme");
    if (saved === "dark" || (!saved && matchMedia("(prefers-color-scheme: dark)").matches)) {
      document.documentElement.setAttribute("data-theme", "dark");
      themeToggle.textContent = "\u2600";
    }
  }

  themeToggle.addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    document.documentElement.setAttribute("data-theme", isDark ? "light" : "dark");
    themeToggle.textContent = isDark ? "\u263E" : "\u2600";
    localStorage.setItem("ab-theme", isDark ? "light" : "dark");
  });

  async function api(path, opts) {
    const res = await fetch(API + path, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    return res.json();
  }

  async function loadProjects() {
    state.projects = await api("/projects");
    renderProjectSelect();
    if (state.projects.length && !state.currentProject) {
      state.currentProject = state.projects[0].id;
    }
  }

  async function loadTasks() {
    if (!state.currentProject) {
      state.tasks = [];
      return;
    }
    state.tasks = await api(`/tasks?projectId=${state.currentProject}`);
  }

  async function loadAgents() {
    state.agents = await api("/agents");
  }

  async function refresh() {
    await Promise.all([loadProjects(), loadAgents()]);
    await loadTasks();
    render();
  }

  function renderProjectSelect() {
    if (!state.projects.length) {
      projectSelect.innerHTML = '<option value="">暂无项目</option>';
      return;
    }
    projectSelect.innerHTML = state.projects
      .map((project) => {
        const selected = project.id === state.currentProject ? "selected" : "";
        return `<option value="${project.id}" ${selected}>${esc(project.name)}</option>`;
      })
      .join("");
  }

  function renderAgentFilter() {
    const assignees = [...new Set(state.tasks.map((task) => task.assignee).filter(Boolean))].sort();
    agentFilter.innerHTML =
      '<option value="">全部代理</option>' +
      assignees
        .map((assignee) => {
          const selected = assignee === state.filterAgent ? "selected" : "";
          return `<option value="${assignee}" ${selected}>${esc(assignee)}</option>`;
        })
        .join("");
  }

  projectSelect.addEventListener("change", async () => {
    state.currentProject = projectSelect.value || null;
    await loadTasks();
    render();
  });

  agentFilter.addEventListener("change", () => {
    state.filterAgent = agentFilter.value || null;
    render();
  });

  document.getElementById("viewTabs").addEventListener("click", (event) => {
    const target = event.target;
    if (!target.classList.contains("tab")) return;
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
    target.classList.add("active");
    state.currentView = target.dataset.view;
    render();
  });

  function render() {
    const boardView = document.getElementById("boardView");
    const agentsView = document.getElementById("agentsView");
    const statsView = document.getElementById("statsView");

    boardView.classList.add("hidden");
    agentsView.classList.add("hidden");
    statsView.classList.add("hidden");

    if (state.currentView === "board") {
      boardView.classList.remove("hidden");
      renderAgentFilter();
      renderBoard();
      return;
    }

    if (state.currentView === "agents") {
      agentsView.classList.remove("hidden");
      renderAgents();
      return;
    }

    statsView.classList.remove("hidden");
    renderStats();
  }

  async function renderStats() {
    const view = document.getElementById("statsView");
    view.innerHTML = '<div style="padding:24px;color:var(--text-muted)">正在加载统计...</div>';
    const stats = await api("/stats");

    const statusBars = Object.entries(stats.byStatus || {})
      .map(([status, count]) => {
        const width = Math.max(5, (count / Math.max(stats.totalTasks, 1)) * 100);
        return `<div class="stat-bar"><span class="stat-label">${formatColumn(status)}</span><div class="stat-fill" style="width:${width}%;background:var(--col-${status},#666)"></div><span class="stat-val">${count}</span></div>`;
      })
      .join("");

    const agentRows = (stats.agentStats || [])
      .map((agent) => `
        <tr>
          <td><strong>${esc(agent.agentId)}</strong></td>
          <td>${agent.totalTasks}</td>
          <td>${agent.completed}</td>
          <td>${agent.failed}</td>
          <td>${agent.inProgress}</td>
          <td>${formatDuration(agent.avgDurationMs)}</td>
          <td>${(agent.completionRate * 100).toFixed(0)}%</td>
        </tr>`)
      .join("");

    const oldest = stats.oldestDoingTask;
    const alertHtml =
      oldest && oldest.ageMs > 7_200_000
        ? `<div class="stat-alert">任务卡住: "${esc(oldest.title)}"（${esc(oldest.assignee)}）已持续 ${formatDuration(oldest.ageMs)}</div>`
        : "";

    view.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-number">${stats.totalTasks}</div>
          <div class="stat-title">任务总数</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${(stats.completionRate * 100).toFixed(0)}%</div>
          <div class="stat-title">完成率</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${formatDuration(stats.avgDurationMs)}</div>
          <div class="stat-title">平均耗时</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${stats.byStatus?.failed || 0}</div>
          <div class="stat-title">失败数</div>
        </div>
      </div>
      ${alertHtml}
      <h3 style="margin:24px 0 12px">状态分布</h3>
      <div class="stat-bars">${statusBars}</div>
      <h3 style="margin:24px 0 12px">代理表现</h3>
      <table class="stats-table">
        <thead><tr><th>代理</th><th>总数</th><th>完成</th><th>失败</th><th>进行中</th><th>平均耗时</th><th>完成率</th></tr></thead>
        <tbody>${agentRows || '<tr><td colspan="7">暂无代理数据</td></tr>'}</tbody>
      </table>
    `;
  }

  function getFilteredTasksForColumn(column) {
    let tasks = state.tasks.filter((task) => task.column === column);
    if (state.filterAgent) {
      tasks = tasks.filter((task) => task.assignee === state.filterAgent);
    }
    return tasks;
  }

  function renderBoard() {
    const board = document.getElementById("boardView");
    board.innerHTML = COLUMNS.map((column) => {
      const tasks = getFilteredTasksForColumn(column);
      return `
        <div class="column" data-col="${column}">
          <div class="column-header">
            <span><span class="dot" style="background:var(--col-${column})"></span>${formatColumn(column)}</span>
            <span class="count">${tasks.length}</span>
          </div>
          <div class="column-body" data-col="${column}">
            ${tasks.map(renderCard).join("")}
            <button class="add-task-btn" data-col="${column}">+ 新建任务</button>
          </div>
        </div>`;
    }).join("");

    board.querySelectorAll(".card").forEach(initDrag);
    board.querySelectorAll(".column-body").forEach(initDrop);
    board.querySelectorAll(".card").forEach((card) => {
      card.addEventListener("click", (event) => {
        if (event.defaultPrevented) return;
        openDetail(card.dataset.id);
      });
    });
    board.querySelectorAll(".add-task-btn").forEach((button) => {
      button.addEventListener("click", () => showTaskModal(button.dataset.col));
    });
  }

  function getUnresolvedDeps(task) {
    if (!task.dependencies || !task.dependencies.length) return [];
    return task.dependencies
      .map((depId) => state.tasks.find((candidate) => candidate.id === depId))
      .filter((candidate) => candidate && candidate.column !== "done");
  }

  function renderCard(task) {
    const priorityClass = `badge-priority-${task.priority}`;
    const tags = (task.tags || []).map((tag) => `<span class="badge badge-tag">${esc(tag)}</span>`).join("");
    const comments = (task.comments || []).length
      ? `<span class="card-comments">${task.comments.length} 条评论</span>`
      : "";

    const blockers = getUnresolvedDeps(task);
    const lockHtml = blockers.length
      ? `<span class="badge badge-locked" title="阻塞于: ${blockers.map((blocker) => esc(blocker.title)).join(", ")}">阻塞 ${blockers.length} 项依赖</span>`
      : "";

    let overdueClass = "";
    let deadlineHtml = "";
    if (task.deadline) {
      const deadlineDate = new Date(task.deadline);
      const isOverdue = deadlineDate < new Date() && task.column !== "done";
      overdueClass = isOverdue ? "card-overdue" : "";
      deadlineHtml = `<span class="badge badge-deadline ${isOverdue ? "badge-overdue" : ""}">${isOverdue ? "逾期" : "截止"} ${deadlineDate.toLocaleDateString("zh-CN")}</span>`;
    }

    return `
      <div class="card ${overdueClass} ${blockers.length ? "card-blocked" : ""}" draggable="true" data-id="${task.id}">
        <div class="card-title">${lockHtml ? `${lockHtml} ` : ""}${esc(task.title)}</div>
        ${task.description ? `<div class="card-desc">${esc(task.description)}</div>` : ""}
        <div class="card-meta">
          ${task.assignee ? `<span class="badge badge-assignee">${esc(task.assignee)}</span>` : ""}
          <span class="badge ${priorityClass}">${formatPriority(task.priority)}</span>
          ${tags}
          ${deadlineHtml}
          ${comments}
        </div>
      </div>`;
  }

  function renderAgents() {
    const view = document.getElementById("agentsView");
    if (!state.agents.length) {
      view.innerHTML = '<div style="padding:24px;color:var(--text-muted)">暂无已注册代理，可通过 API 注册。</div>';
      return;
    }

    view.innerHTML = state.agents
      .map((agent) => {
        const taskCount = state.tasks.filter((task) => task.assignee === agent.id).length;
        const statusLabel = agent.status === "online" ? "在线" : "离线";
        return `
          <div class="agent-card">
            <h3>${esc(agent.name)}</h3>
            <div class="role">${esc(agent.role)} &middot; ${statusLabel} &middot; ${taskCount} 个任务</div>
            <div class="caps">${(agent.capabilities || []).map((cap) => `<span class="badge badge-tag">${esc(cap)}</span>`).join("")}</div>
          </div>`;
      })
      .join("");
  }

  function initDrag(card) {
    card.addEventListener("dragstart", (event) => {
      draggedId = card.dataset.id;
      card.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      draggedId = null;
    });
  }

  function initDrop(colBody) {
    colBody.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      colBody.classList.add("drag-over");
    });
    colBody.addEventListener("dragleave", () => {
      colBody.classList.remove("drag-over");
    });
    colBody.addEventListener("drop", async (event) => {
      event.preventDefault();
      colBody.classList.remove("drag-over");
      if (!draggedId) return;
      await api(`/tasks/${draggedId}/move`, {
        method: "POST",
        body: JSON.stringify({ column: colBody.dataset.col }),
      });
      await loadTasks();
      render();
    });
  }

  document.getElementById("closeDetail").addEventListener("click", () => {
    detailPanel.classList.remove("open");
    if (threadInterval) {
      clearInterval(threadInterval);
      threadInterval = null;
    }
    currentDetailTaskId = null;
  });

  function renderThread(comments) {
    const threadEl = document.getElementById("threadMessages");
    if (!threadEl) return;
    if (!comments.length) {
      threadEl.innerHTML = '<div class="thread-empty">暂无评论，开始讨论吧。</div>';
      return;
    }
    threadEl.innerHTML = comments
      .map((comment) => `
        <div class="thread-msg">
          <div class="thread-msg-header">
            <span class="thread-msg-author">${esc(comment.author)}</span>
            <span class="thread-msg-time">${new Date(comment.at).toLocaleString("zh-CN")}</span>
          </div>
          <div class="thread-msg-text">${esc(comment.text)}</div>
        </div>`)
      .join("");
    threadEl.scrollTop = threadEl.scrollHeight;
  }

  async function refreshThread(taskId) {
    try {
      const comments = await api(`/tasks/${taskId}/comments`);
      if (currentDetailTaskId === taskId) renderThread(comments);
    } catch {
      // ignore polling errors
    }
  }

  function openDetail(taskId) {
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    currentDetailTaskId = taskId;

    detailContent.innerHTML = `
      <h2>${esc(task.title)}</h2>
      <div class="detail-field"><label>状态</label><div class="value"><span class="badge" style="background:var(--col-${task.column});color:#fff">${formatColumn(task.column)}</span></div></div>
      <div class="detail-field"><label>负责人</label><div class="value">${esc(task.assignee || "未分配")}</div></div>
      <div class="detail-field"><label>优先级</label><div class="value"><span class="badge badge-priority-${task.priority}">${formatPriority(task.priority)}</span></div></div>
      <div class="detail-field"><label>描述</label><div class="value">${esc(task.description || "暂无描述")}</div></div>
      <div class="detail-field"><label>标签</label><div class="value">${(task.tags || []).map((tag) => `<span class="badge badge-tag">${esc(tag)}</span>`).join(" ") || "无"}</div></div>
      <div class="detail-field"><label>创建者</label><div class="value">${esc(task.createdBy || "未知")}</div></div>
      <div class="detail-field"><label>创建时间</label><div class="value">${new Date(task.createdAt).toLocaleString("zh-CN")}</div></div>
      <div class="thread-panel">
        <label>讨论串（${(task.comments || []).length}）</label>
        <div class="thread-messages" id="threadMessages"></div>
        <div class="thread-input">
          <input type="text" id="commentAuthor" placeholder="作者" class="thread-author-input">
          <div class="thread-send-row">
            <input type="text" id="commentText" placeholder="输入评论..." class="thread-text-input">
            <button class="btn btn-primary" id="addCommentBtn">发送</button>
          </div>
        </div>
      </div>
    `;

    renderThread(task.comments || []);

    async function sendComment() {
      const author = document.getElementById("commentAuthor").value.trim();
      const text = document.getElementById("commentText").value.trim();
      if (!author || !text) return;
      document.getElementById("commentText").value = "";
      await api(`/tasks/${taskId}/comments`, {
        method: "POST",
        body: JSON.stringify({ author, text }),
      });
      await refreshThread(taskId);
      await loadTasks();
    }

    document.getElementById("addCommentBtn").addEventListener("click", sendComment);
    document.getElementById("commentText").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendComment();
      }
    });

    if (threadInterval) clearInterval(threadInterval);
    threadInterval = setInterval(() => refreshThread(taskId), 10_000);

    detailPanel.classList.add("open");
  }

  function showModal(html) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal">${html}</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) overlay.remove();
    });
    return overlay;
  }

  document.getElementById("newProjectBtn").addEventListener("click", () => {
    const overlay = showModal(`
      <h2>新建项目</h2>
      <label>名称</label>
      <input type="text" id="modalProjName" autofocus>
      <label>负责人</label>
      <input type="text" id="modalProjOwner" placeholder="例如：agency">
      <label>描述</label>
      <textarea id="modalProjDesc"></textarea>
      <div class="modal-actions">
        <button class="btn" id="modalCancel">取消</button>
        <button class="btn btn-primary" id="modalConfirm">创建</button>
      </div>
    `);

    overlay.querySelector("#modalCancel").addEventListener("click", () => overlay.remove());
    overlay.querySelector("#modalConfirm").addEventListener("click", async () => {
      const name = overlay.querySelector("#modalProjName").value.trim();
      if (!name) return;
      const project = await api("/projects", {
        method: "POST",
        body: JSON.stringify({
          name,
          owner: overlay.querySelector("#modalProjOwner").value.trim() || "未知",
          description: overlay.querySelector("#modalProjDesc").value.trim(),
        }),
      });
      state.currentProject = project.id;
      overlay.remove();
      await refresh();
    });
  });

  function showTaskModal(column) {
    if (!state.currentProject) return;
    const overlay = showModal(`
      <h2>新建任务</h2>
      <label>标题</label>
      <input type="text" id="modalTaskTitle" autofocus>
      <label>描述</label>
      <textarea id="modalTaskDesc"></textarea>
      <label>负责人</label>
      <input type="text" id="modalTaskAssignee">
      <label>优先级</label>
      <select id="modalTaskPriority">
        <option value="medium" selected>中</option>
        <option value="low">低</option>
        <option value="high">高</option>
        <option value="urgent">紧急</option>
      </select>
      <label>标签（逗号分隔）</label>
      <input type="text" id="modalTaskTags" placeholder="seo, audit">
      <div class="modal-actions">
        <button class="btn" id="modalCancel">取消</button>
        <button class="btn btn-primary" id="modalConfirm">创建</button>
      </div>
    `);

    overlay.querySelector("#modalCancel").addEventListener("click", () => overlay.remove());
    overlay.querySelector("#modalConfirm").addEventListener("click", async () => {
      const title = overlay.querySelector("#modalTaskTitle").value.trim();
      if (!title) return;
      const tags = overlay.querySelector("#modalTaskTags").value.trim();
      await api("/tasks", {
        method: "POST",
        body: JSON.stringify({
          projectId: state.currentProject,
          title,
          description: overlay.querySelector("#modalTaskDesc").value.trim(),
          assignee: overlay.querySelector("#modalTaskAssignee").value.trim(),
          priority: overlay.querySelector("#modalTaskPriority").value,
          tags: tags ? tags.split(",").map((tag) => tag.trim()).filter(Boolean) : [],
          column: column || "backlog",
        }),
      });
      overlay.remove();
      await loadTasks();
      render();
    });
  }

  document.getElementById("newTaskBtn").addEventListener("click", () => showTaskModal("backlog"));

  initTheme();
  refresh();

  setInterval(async () => {
    await loadTasks();
    if (state.currentView === "board") renderBoard();
  }, 5_000);
})();
