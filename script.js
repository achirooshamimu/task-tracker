const STORAGE_KEY = "taskflow-records-v2";
const today = () => new Date().toISOString().slice(0, 10);
const makeId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2);
const formatDateTime = (value) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const starterState = {
  tasks: [],
  habits: [
    {
      id: makeId(),
      name: "Drink enough water",
      icon: "💧",
      completedDates: [],
    },
    {
      id: makeId(),
      name: "Read for 20 minutes",
      icon: "📚",
      completedDates: [],
    },
    { id: makeId(), name: "Move your body", icon: "🏃", completedDates: [] },
  ],
};

let state =
  JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || starterState;
let activeFilter = "all";
let openTimeline = null;
let editingTaskId = null;
let historyHabitId = null;
let pendingTaskHighlight = null;
let pendingHabitHighlight = null;

const escapeHTML = (value) =>
  String(value).replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character],
  );

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeTask(task) {
  const createdAt = task.createdAt || new Date().toISOString();
  return {
    id: task.id || makeId(),
    title: task.title || "Untitled task",
    priority: task.priority || "normal",
    done: Boolean(task.done),
    createdAt,
    completedAt: task.completedAt || null,
    dueDate: task.dueDate || null,
    reminded: Boolean(task.reminded),
    history:
      Array.isArray(task.history) && task.history.length
        ? task.history
        : [{ type: "created", at: createdAt, label: "Task created" }],
  };
}

state.tasks = state.tasks.map(normalizeTask);

function showToast(message, tone = "success") {
  let container = document.querySelector("#toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${tone}`;
  toast.innerHTML = `<span>${tone === "success" ? "✓" : "!"}</span><p>${escapeHTML(message)}</p>`;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add("toast-visible"), 10);
  setTimeout(() => {
    toast.classList.remove("toast-visible");
    setTimeout(() => toast.remove(), 250);
  }, 3600);
}

async function notifyCompletion(taskTitle) {
  showToast(`Task completed: ${taskTitle}`);
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      return;
    }
  }
  if (Notification.permission === "granted") {
    new Notification("TaskFlow — Task completed", {
      body: taskTitle,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="%236b4eff"/><text x="50" y="68" text-anchor="middle" font-size="60" fill="white">✓</text></svg>',
    });
  }
}

function addHistory(task, type, label) {
  task.history.push({ type, label, at: new Date().toISOString() });
}

function timelineHTML(task) {
  return `<div class="task-timeline ${openTimeline === task.id ? "timeline-open" : ""}">
    <button class="timeline-toggle" data-timeline="${task.id}" type="button">${openTimeline === task.id ? "Hide timeline" : "View timeline"}</button>
    <div class="timeline-events">
      ${task.history
        .slice()
        .reverse()
        .map(
          (event) =>
            `<div class="timeline-event"><span class="timeline-dot"></span><div><strong>${escapeHTML(event.label)}</strong><small>${formatDateTime(event.at)}</small></div></div>`,
        )
        .join("")}
    </div>
  </div>`;
}

function dueMeta(dueDate) {
  if (!dueDate) return "";
  const [y, m, d] = dueDate.split("-").map(Number);
  const due = new Date(y, m - 1, d);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const diffDays = Math.round((due - startOfToday) / 86400000);
  const label = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(due);
  if (diffDays < 0)
    return `<span class="due overdue">⚠ Overdue · ${escapeHTML(label)}</span>`;
  if (diffDays === 0) return `<span class="due due-today">Due today</span>`;
  if (diffDays === 1)
    return `<span class="due due-tomorrow">Due tomorrow</span>`;
  return `<span class="due">Due ${escapeHTML(label)}</span>`;
}

function getStreak(habit) {
  let count = 0;
  const date = new Date();
  while (habit.completedDates.includes(date.toISOString().slice(0, 10))) {
    count++;
    date.setDate(date.getDate() - 1);
  }
  return count;
}
function monthCalendarHTML(habit) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(now);
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const doneCount = habit.completedDates.filter((d) =>
    d.startsWith(monthPrefix),
  ).length;
  const todayStr = today();
  let cells = "";
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${monthPrefix}-${String(day).padStart(2, "0")}`;
    const isDone = habit.completedDates.includes(dateStr);
    const isFuture = dateStr > todayStr;
    cells += `<span class="cal-day${isDone ? " cal-done" : ""}${isFuture ? " cal-future" : ""}" title="${dateStr}">${day}</span>`;
  }
  return `<div class="habit-history">
    <div class="habit-history-head"><strong>${escapeHTML(monthLabel)}</strong><small>${doneCount}/${daysInMonth} days done</small></div>
    <div class="cal-grid">${cells}</div>
  </div>`;
}
function taskEditFormHTML(task) {
  return `<form class="task-edit-form" data-edit-form="${task.id}">
    <input class="edit-title" value="${escapeHTML(task.title)}" required>
    <input class="edit-due" type="date" value="${task.dueDate || ""}" aria-label="Due date">
    <select class="edit-priority" aria-label="Priority">
      <option value="normal"${task.priority === "normal" ? " selected" : ""}>Normal</option>
      <option value="high"${task.priority === "high" ? " selected" : ""}>High</option>
      <option value="low"${task.priority === "low" ? " selected" : ""}>Low</option>
    </select>
    <div class="edit-actions">
      <button type="submit" class="primary-button">Save</button>
      <button type="button" class="secondary-button" data-cancel-edit="${task.id}">Cancel</button>
    </div>
  </form>`;
}
function taskItemHTML(task, highlightId) {
  if (task.id === editingTaskId) {
    return `<article class="task editing">${taskEditFormHTML(task)}</article>`;
  }
  return `<article class="task ${task.done ? "done" : ""} ${task.id === highlightId ? "task-new" : ""}">
    <button class="check ${task.done ? "checked" : ""}" data-task="${task.id}" type="button" aria-label="Complete task">${task.done ? "✓" : ""}</button>
    <span class="priority ${task.priority}"></span>
    <div class="task-main"><div class="task-title">${escapeHTML(task.title)}</div><div class="task-meta">${task.priority} priority · Added ${formatDateTime(task.createdAt)}${task.done && task.completedAt ? " · Completed " + formatDateTime(task.completedAt) : ""}${!task.done && task.dueDate ? " · " + dueMeta(task.dueDate) : ""}</div></div>
    <div class="task-actions">
      <button class="ghost-mini" data-edit-task="${task.id}" type="button">Edit</button>
      <button class="delete" data-delete-task="${task.id}" type="button">Delete</button>
    </div>
    ${timelineHTML(task)}
  </article>`;
}
function groupTasksByMonth(tasks) {
  const groups = {};
  tasks.forEach((task) => {
    const isoForGrouping =
      task.done && task.completedAt ? task.completedAt : task.createdAt;
    const d = new Date(isoForGrouping);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(task);
  });
  return Object.keys(groups)
    .sort((a, b) => b.localeCompare(a))
    .map((key) => {
      const [y, m] = key.split("-").map(Number);
      const label = new Intl.DateTimeFormat(undefined, {
        month: "long",
        year: "numeric",
      }).format(new Date(y, m - 1, 1));
      return { key, label, tasks: groups[key] };
    });
}
function animateMetric(selector, newValue) {
  const el = document.querySelector(selector);
  const from = parseInt(el.textContent, 10) || 0;
  if (from === newValue) return;
  const duration = 320;
  const start = performance.now();
  el.classList.remove("metric-bump");
  void el.offsetWidth;
  el.classList.add("metric-bump");
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = Math.round(from + (newValue - from) * eased);
    el.textContent = value;
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = newValue;
  }
  requestAnimationFrame(step);
}

function render() {
  const taskHighlight = pendingTaskHighlight;
  const habitHighlight = pendingHabitHighlight;
  pendingTaskHighlight = null;
  pendingHabitHighlight = null;

  let tasks = state.tasks;
  if (activeFilter === "active") tasks = tasks.filter((task) => !task.done);
  if (activeFilter === "done") tasks = tasks.filter((task) => task.done);

  document.querySelector("#visibleCount").textContent =
    `${tasks.length} item${tasks.length === 1 ? "" : "s"}`;
  const taskGroups = groupTasksByMonth(tasks);
  document.querySelector("#taskList").innerHTML = tasks.length
    ? taskGroups
        .map(
          (group) => `
    <div class="month-group">
      <div class="month-heading"><span>${escapeHTML(group.label)}</span><small>${group.tasks.length} item${group.tasks.length === 1 ? "" : "s"}</small></div>
      <div class="month-items">${group.tasks.map((task) => taskItemHTML(task, taskHighlight)).join("")}</div>
    </div>`,
        )
        .join("")
    : '<div class="empty">No tasks here yet. Add one above to get started.</div>';

  const completed = state.tasks.filter((task) => task.done).length;
  animateMetric("#totalTasks", state.tasks.length);
  animateMetric("#completedTasks", completed);

  const date = today();
  const doneHabits = state.habits.filter((habit) =>
    habit.completedDates.includes(date),
  ).length;
  const percentage = state.habits.length
    ? Math.round((doneHabits / state.habits.length) * 100)
    : 0;
  animateMetric("#habitCount", state.habits.length);
  animateMetric("#todayHabits", doneHabits);
  document.querySelector("#habitProgress").textContent = `${percentage}%`;
  document.querySelector("#habitProgressText").textContent =
    `${doneHabits} of ${state.habits.length}`;
  document.querySelector("#habitBar").style.width = `${percentage}%`;

  document.querySelector("#habitList").innerHTML = state.habits.length
    ? state.habits
        .map((habit) => {
          const checked = habit.completedDates.includes(date);
          const historyOpen = historyHabitId === habit.id;
          return `<article class="habit ${habit.id === habitHighlight ? "task-new" : ""}">
      <span class="habit-emoji">${habit.icon || "✨"}</span>
      <div class="habit-main">
        <div class="habit-name">${escapeHTML(habit.name)}</div>
        <div class="habit-meta"><span class="streak">🔥 ${getStreak(habit)} day streak</span> · <button class="timeline-toggle" data-habit-history="${habit.id}" type="button">${historyOpen ? "Hide history" : "View history"}</button></div>
        ${historyOpen ? monthCalendarHTML(habit) : ""}
      </div>
      <button class="check habit-action ${checked ? "checked" : ""}" data-habit="${habit.id}" type="button">${checked ? "✓" : ""}</button>
      <button class="delete" data-delete-habit="${habit.id}" type="button">×</button>
    </article>`;
        })
        .join("")
    : '<div class="empty">No habits yet. Add one below.</div>';

  save();
}

const notificationButton = document.querySelector("#enableNotifications");
function updateNotificationButton() {
  if (!notificationButton) return;
  if (!("Notification" in window)) {
    notificationButton.textContent = "Reminders unavailable";
    notificationButton.disabled = true;
    return;
  }
  if (Notification.permission === "granted") {
    notificationButton.textContent = "🔔 Reminders on";
    notificationButton.classList.add("is-enabled");
  } else {
    notificationButton.textContent = "🔔 Enable deadline reminders";
    notificationButton.classList.remove("is-enabled");
  }
}
if (notificationButton) {
  updateNotificationButton();
  notificationButton.addEventListener("click", async () => {
    if (!("Notification" in window))
      return showToast("This browser does not support notifications.", "error");
    const permission = await Notification.requestPermission();
    showToast(
      permission === "granted"
        ? "Reminders enabled — you'll be notified the day before a task is due."
        : "Notifications were not enabled.",
      permission === "granted" ? "success" : "error",
    );
    updateNotificationButton();
    if (permission === "granted") checkDeadlineReminders();
  });
}
async function remindDeadline(task) {
  const dueToday = task.dueDate === today();
  const when = dueToday ? "today" : "tomorrow";
  showToast(`Reminder: "${task.title}" is due ${when}.`, "error");
  if (!("Notification" in window) || Notification.permission !== "granted")
    return;
  new Notification("TaskFlow — Deadline reminder", {
    body: `"${task.title}" is due ${when}.`,
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="%23ed9851"/><text x="50" y="68" text-anchor="middle" font-size="55" fill="white">⏰</text></svg>',
  });
}

function checkDeadlineReminders() {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  let changed = false;
  state.tasks.forEach((task) => {
    if (task.done || !task.dueDate || task.reminded) return;
    const [y, m, d] = task.dueDate.split("-").map(Number);
    const due = new Date(y, m - 1, d);
    const diffDays = Math.round((due - startOfToday) / 86400000);
    if (diffDays === 1 || diffDays === 0) {
      remindDeadline(task);
      task.reminded = true;
      changed = true;
    }
  });
  if (changed) save();
}

document.querySelector("#todayLabel").textContent = new Intl.DateTimeFormat(
  undefined,
  { weekday: "long", month: "long", day: "numeric", year: "numeric" },
).format(new Date());

document.querySelector("#taskForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector("#taskInput");
  const dueInput = document.querySelector("#dueDateInput");
  const now = new Date().toISOString();
  const newTask = {
    id: makeId(),
    title: input.value.trim(),
    priority: document.querySelector("#priorityInput").value,
    done: false,
    createdAt: now,
    completedAt: null,
    dueDate: dueInput.value || null,
    reminded: false,
    history: [{ type: "created", at: now, label: "Task created" }],
  };
  state.tasks.unshift(newTask);
  pendingTaskHighlight = newTask.id;
  input.value = "";
  dueInput.value = "";
  showToast(
    newTask.dueDate
      ? "Task added — reminder set for the day before it's due."
      : "Task added to your list.",
  );
  render();
  input.focus();
});

document.querySelector("#habitForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector("#habitInput");
  const newHabit = {
    id: makeId(),
    name: input.value.trim(),
    icon: [][state.habits.length % 5],
    completedDates: [],
  };
  state.habits.push(newHabit);
  pendingHabitHighlight = newHabit.id;
  input.value = "";
  showToast("Habit added.");
  render();
});
document.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-edit-form]");
  if (!form) return;
  event.preventDefault();
  const id = form.dataset.editForm;
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  const newTitle = form.querySelector(".edit-title").value.trim();
  const newDue = form.querySelector(".edit-due").value || null;
  const newPriority = form.querySelector(".edit-priority").value;
  if (newTitle) task.title = newTitle;
  if (task.dueDate !== newDue) task.reminded = false;
  task.dueDate = newDue;
  task.priority = newPriority;
  addHistory(task, "edited", "Task edited");
  editingTaskId = null;
  showToast("Task updated.");
  render();
});
function removeWithAnimation(el, mutate) {
  if (!el) {
    mutate();
    render();
    return;
  }
  el.classList.add("item-exit");
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    mutate();
    render();
  };
  el.addEventListener("animationend", finish, { once: true });
  setTimeout(finish, 260);
}

document.addEventListener("click", async (event) => {
  const filter = event.target.closest("[data-filter]");
  if (filter) {
    activeFilter = filter.dataset.filter;
    document
      .querySelectorAll(".filter")
      .forEach((button) =>
        button.classList.toggle("active", button === filter),
      );
    render();
    return;
  }
  const timeline = event.target.closest("[data-timeline]");
  if (timeline) {
    openTimeline =
      openTimeline === timeline.dataset.timeline
        ? null
        : timeline.dataset.timeline;
    render();
    return;
  }
  const editButton = event.target.closest("[data-edit-task]");
  if (editButton) {
    editingTaskId =
      editingTaskId === editButton.dataset.editTask
        ? null
        : editButton.dataset.editTask;
    render();
    return;
  }
  const cancelEdit = event.target.closest("[data-cancel-edit]");
  if (cancelEdit) {
    editingTaskId = null;
    render();
    return;
  }
  const habitHistory = event.target.closest("[data-habit-history]");
  if (habitHistory) {
    historyHabitId =
      historyHabitId === habitHistory.dataset.habitHistory
        ? null
        : habitHistory.dataset.habitHistory;
    render();
    return;
  }
  const taskButton = event.target.closest("[data-task]");
  if (taskButton) {
    const task = state.tasks.find(
      (item) => item.id === taskButton.dataset.task,
    );
    task.done = !task.done;
    const now = new Date().toISOString();
    if (task.done) {
      task.completedAt = now;
      addHistory(task, "completed", "Task completed");
    } else {
      task.completedAt = null;
      addHistory(task, "reopened", "Task reopened");
    }
    render();
    if (task.done) await notifyCompletion(task.title);
    return;
  }
  const deleteTask = event.target.closest("[data-delete-task]");
  if (deleteTask) {
    const id = deleteTask.dataset.deleteTask;
    removeWithAnimation(deleteTask.closest(".task"), () => {
      state.tasks = state.tasks.filter((task) => task.id !== id);
      showToast("Task deleted.");
    });
    return;
  }
  const habitButton = event.target.closest("[data-habit]");
  if (habitButton) {
    const habit = state.habits.find(
      (item) => item.id === habitButton.dataset.habit,
    );
    const date = today();
    const index = habit.completedDates.indexOf(date);
    index < 0
      ? habit.completedDates.push(date)
      : habit.completedDates.splice(index, 1);
    render();
    return;
  }
  const deleteHabit = event.target.closest("[data-delete-habit]");
  if (deleteHabit) {
    const id = deleteHabit.dataset.deleteHabit;
    removeWithAnimation(deleteHabit.closest(".habit"), () => {
      state.habits = state.habits.filter((habit) => habit.id !== id);
      showToast("Habit deleted.");
    });
  }
});

render();
checkDeadlineReminders();
setInterval(checkDeadlineReminders, 30 * 60 * 1000);
