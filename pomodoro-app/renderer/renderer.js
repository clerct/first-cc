// ============================================================
// Pomodoro Timer - Renderer Process
// ============================================================

// ---- Storage Helper ----
// Primary: file-based persistence via IPC (survives Electron restarts reliably).
// Fallback: localStorage (when IPC is unavailable or fails).
const Storage = {
  _key: 'pomodoro-data',

  getDefault() {
    return {
      settings: {
        workDuration: 25,
        shortBreakDuration: 5,
        longBreakDuration: 15,
        longBreakInterval: 4,
        alwaysOnTop: true,
      },
      tasks: [],
      sessions: [],
      currentTaskId: null,
      completedPomodoros: 0,
    };
  },

  _mergeDefaults(data) {
    const defaults = this.getDefault();
    data.settings = { ...defaults.settings, ...(data.settings || {}) };
    data.tasks = data.tasks || [];
    data.sessions = data.sessions || [];
    data.currentTaskId = data.currentTaskId || null;
    data.completedPomodoros = typeof data.completedPomodoros === 'number'
      ? data.completedPomodoros : defaults.completedPomodoros;
    return data;
  },

  async load() {
    // 1) Try IPC file-based storage (most reliable in Electron)
    try {
      const data = await window.electronAPI?.loadData();
      if (data && typeof data === 'object') {
        return this._mergeDefaults(data);
      }
    } catch { /* fall through */ }

    // 2) Fallback to localStorage
    try {
      const raw = localStorage.getItem(this._key);
      const data = raw ? JSON.parse(raw) : null;
      if (data && typeof data === 'object') {
        return this._mergeDefaults(data);
      }
    } catch { /* fall through */ }

    return this.getDefault();
  },

  async save(data) {
    // Save to both backends for maximum safety
    try {
      await window.electronAPI?.saveData(data);
    } catch { /* ignore */ }
    try {
      localStorage.setItem(this._key, JSON.stringify(data));
    } catch { /* ignore */ }
  },
};

// ---- App State ----
const state = {
  // Timer
  mode: 'work', // 'work' | 'shortBreak' | 'longBreak'
  timeLeft: 25 * 60, // seconds
  totalTime: 25 * 60,
  isRunning: false,
  completedPomodoros: 0, // in current cycle
  timerInterval: null,

  // Data
  data: Storage.load(),
};

// ---- DOM References ----
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  modeText: $('#mode-text'),
  sessionCount: $('#session-count'),
  timerMinutes: $('#timer-minutes'),
  timerSeconds: $('#timer-seconds'),
  timerDisplay: $('#timer-display'),
  timerContainer: $('#timer-container'),
  progressBar: $('#progress-bar'),
  btnStart: $('#btn-start'),
  btnPause: $('#btn-pause'),
  btnReset: $('#btn-reset'),
  btnSkip: $('#btn-skip'),
  btnMinimize: $('#btn-minimize'),
  btnClose: $('#btn-close'),
  currentTaskName: $('#current-task-name'),
  statToday: $('#stat-today'),
  statWeek: $('#stat-week'),
  statTotal: $('#stat-total'),
  taskInput: $('#task-input'),
  taskList: $('#task-list'),
  btnAddTask: $('#btn-add-task'),
  btnToggleTasks: $('#btn-toggle-tasks'),
  taskBody: $('#task-body'),
  btnToggleSettings: $('#btn-toggle-settings'),
  settingsBody: $('#settings-body'),
  settingWork: $('#setting-work'),
  settingShortBreak: $('#setting-short-break'),
  settingLongBreak: $('#setting-long-break'),
  settingInterval: $('#setting-interval'),
  settingOnTop: $('#setting-ontop'),
};

// ---- Audio Feedback ----
const AudioFeedback = {
  _ctx: null,

  _getContext() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this._ctx;
  },

  playBeep(frequency = 800, duration = 200) {
    try {
      const ctx = this._getContext();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration / 1000);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + duration / 1000);
    } catch {
      // Silently fail if audio not available
    }
  },

  playComplete() {
    // Play three ascending beeps
    setTimeout(() => this.playBeep(523, 150), 0);   // C5
    setTimeout(() => this.playBeep(659, 150), 150);  // E5
    setTimeout(() => this.playBeep(784, 300), 300);  // G5
  },
};

// ---- Timer Functions ----
function getModeDuration(mode) {
  const s = state.data.settings;
  switch (mode) {
    case 'work': return s.workDuration * 60;
    case 'shortBreak': return s.shortBreakDuration * 60;
    case 'longBreak': return s.longBreakDuration * 60;
    default: return 25 * 60;
  }
}

function getModeLabel(mode) {
  switch (mode) {
    case 'work': return '专注工作';
    case 'shortBreak': return '短休息';
    case 'longBreak': return '长休息';
    default: return '';
  }
}

function getNextMode() {
  if (state.mode === 'work') {
    const interval = state.data.settings.longBreakInterval;
    if ((state.completedPomodoros + 1) % interval === 0) {
      return 'longBreak';
    }
    return 'shortBreak';
  }
  return 'work';
}

function updateTimerDisplay() {
  const m = Math.floor(state.timeLeft / 60);
  const s = state.timeLeft % 60;
  dom.timerMinutes.textContent = String(m).padStart(2, '0');
  dom.timerSeconds.textContent = String(s).padStart(2, '0');
}

function updateProgressRing() {
  const circumference = 2 * Math.PI * 90; // ~565.49
  const progress = state.timeLeft / state.totalTime;
  const offset = circumference * (1 - progress);
  dom.progressBar.style.strokeDashoffset = offset;

  // Update color based on mode
  let color;
  switch (state.mode) {
    case 'work': color = '#E53935'; break;
    case 'shortBreak': color = '#4CAF50'; break;
    case 'longBreak': color = '#42A5F5'; break;
  }
  dom.progressBar.style.stroke = color;
}

function updateModeUI() {
  dom.modeText.textContent = getModeLabel(state.mode);
  let color;
  switch (state.mode) {
    case 'work': color = '#FF6B6B'; break;
    case 'shortBreak': color = '#81C784'; break;
    case 'longBreak': color = '#90CAF9'; break;
  }
  dom.modeText.style.color = color;
  dom.sessionCount.textContent = `🍅 × ${state.completedPomodoros}`;
}

function switchMode(newMode) {
  state.mode = newMode;
  state.totalTime = getModeDuration(newMode);
  state.timeLeft = state.totalTime;
  updateModeUI();
  updateTimerDisplay();
  updateProgressRing();
}

function tick() {
  if (!state.isRunning) return;

  if (state.timeLeft > 0) {
    state.timeLeft--;
    updateTimerDisplay();
    updateProgressRing();
    // Update tray tooltip
    const m = Math.floor(state.timeLeft / 60);
    const s = state.timeLeft % 60;
    const label = getModeLabel(state.mode);
    window.electronAPI?.setTrayTooltip(`番茄钟 - ${label} ${m}:${String(s).padStart(2, '0')}`);
  }

  if (state.timeLeft <= 0) {
    completeSession();
  }
}

function completeSession() {
  stopTimer();

  // Record completion
  if (state.mode === 'work') {
    state.completedPomodoros++;
    state.data.completedPomodoros = state.completedPomodoros;
    dom.sessionCount.textContent = `🍅 × ${state.completedPomodoros}`;

    // Record session
    const today = new Date().toISOString().split('T')[0];
    state.data.sessions.push({
      date: today,
      taskId: state.data.currentTaskId,
      type: 'work',
      duration: Math.floor(state.totalTime / 60),
    });

    // Increment task pomodoro count
    if (state.data.currentTaskId) {
      const task = state.data.tasks.find((t) => t.id === state.data.currentTaskId);
      if (task) {
        task.pomodoros = (task.pomodoros || 0) + 1;
      }
    }
  }

  Storage.save(state.data);

  // Notify
  const nextMode = getNextMode();
  AudioFeedback.playComplete();
  window.electronAPI?.showNotification({
    title: '番茄钟',
    body: `${getModeLabel(state.mode)} 完成！接下来：${getModeLabel(nextMode)}`,
  });

  // Update stats
  updateStats();

  // Auto-switch to next mode
  switchMode(nextMode);
  updateTaskList();
}

function startTimer() {
  if (state.timeLeft <= 0) {
    // Reset timer if it ended
    state.totalTime = getModeDuration(state.mode);
    state.timeLeft = state.totalTime;
    updateTimerDisplay();
    updateProgressRing();
  }
  state.isRunning = true;
  dom.timerContainer.classList.add('running');
  dom.btnStart.style.display = 'none';
  dom.btnPause.style.display = '';
  window.electronAPI?.setTrayTooltip('番茄钟 - 运行中...');
  state.timerInterval = setInterval(tick, 1000);
}

function pauseTimer() {
  state.isRunning = false;
  dom.timerContainer.classList.remove('running');
  dom.btnStart.style.display = '';
  dom.btnPause.style.display = 'none';
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  window.electronAPI?.setTrayTooltip('番茄钟 - 已暂停');
}

function resetTimer() {
  pauseTimer();
  state.timeLeft = getModeDuration(state.mode);
  state.totalTime = state.timeLeft;
  updateTimerDisplay();
  updateProgressRing();
  window.electronAPI?.setTrayTooltip('番茄钟 - 准备开始');
}

function skipSession() {
  pauseTimer();
  const nextMode = getNextMode();
  switchMode(nextMode);
  window.electronAPI?.setTrayTooltip('番茄钟 - 准备开始');
}

function stopTimer() {
  state.isRunning = false;
  dom.timerContainer.classList.remove('running');
  dom.btnStart.style.display = '';
  dom.btnPause.style.display = 'none';
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

// ---- Task Functions ----
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function addTask(title) {
  const task = {
    id: generateId(),
    title: title.trim(),
    completed: false,
    pomodoros: 0,
  };
  state.data.tasks.push(task);
  Storage.save(state.data);
  updateTaskList();
}

function deleteTask(id) {
  state.data.tasks = state.data.tasks.filter((t) => t.id !== id);
  if (state.data.currentTaskId === id) {
    state.data.currentTaskId = null;
    updateCurrentTaskDisplay();
  }
  Storage.save(state.data);
  updateTaskList();
}

function toggleTaskComplete(id) {
  const task = state.data.tasks.find((t) => t.id === id);
  if (task) {
    task.completed = !task.completed;
    Storage.save(state.data);
    updateTaskList();
  }
}

function setCurrentTask(id) {
  state.data.currentTaskId = id;
  Storage.save(state.data);
  updateCurrentTaskDisplay();
  updateTaskList();
}

function updateCurrentTaskDisplay() {
  if (state.data.currentTaskId) {
    const task = state.data.tasks.find((t) => t.id === state.data.currentTaskId);
    dom.currentTaskName.textContent = task ? task.title : '未选择任务';
    dom.currentTaskName.style.color = '#90CAF9';
  } else {
    dom.currentTaskName.textContent = '未选择任务';
    dom.currentTaskName.style.color = '#6A6A80';
  }
}

function updateTaskList() {
  const tasks = state.data.tasks;
  dom.taskList.innerHTML = '';

  tasks.forEach((task) => {
    const li = document.createElement('li');
    li.className = 'task-item';
    if (task.completed) li.classList.add('completed');
    if (task.id === state.data.currentTaskId) li.classList.add('active');

    li.innerHTML = `
      <div class="task-checkbox" data-action="toggle" data-id="${task.id}">
        ${task.completed ? '✓' : ''}
      </div>
      <span class="task-title" data-action="select" data-id="${task.id}">${escapeHtml(task.title)}</span>
      <span class="task-pomos">🍅 ${task.pomodoros || 0}</span>
      <button class="task-delete" data-action="delete" data-id="${task.id}">✕</button>
    `;

    li.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      const id = e.target.dataset.id;
      if (!action || !id) return;

      switch (action) {
        case 'toggle':
          toggleTaskComplete(id);
          break;
        case 'select':
          setCurrentTask(id);
          break;
        case 'delete':
          deleteTask(id);
          break;
      }
    });

    dom.taskList.appendChild(li);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Stats Functions ----
function updateStats() {
  const sessions = state.data.sessions;
  const today = new Date().toISOString().split('T')[0];

  // Today's count
  const todayCount = sessions.filter((s) => s.date === today && s.type === 'work').length;

  // This week's count
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const weekStart = startOfWeek.toISOString().split('T')[0];
  const weekCount = sessions.filter(
    (s) => s.date >= weekStart && s.date <= today && s.type === 'work'
  ).length;

  // Total count
  const totalCount = sessions.filter((s) => s.type === 'work').length;

  dom.statToday.textContent = todayCount;
  dom.statWeek.textContent = weekCount;
  dom.statTotal.textContent = totalCount;
}

// ---- Settings Functions ----
function applySettings() {
  const s = state.data.settings;
  dom.settingWork.value = s.workDuration;
  dom.settingShortBreak.value = s.shortBreakDuration;
  dom.settingLongBreak.value = s.longBreakDuration;
  dom.settingInterval.value = s.longBreakInterval;
  dom.settingOnTop.checked = s.alwaysOnTop;

  window.electronAPI?.setAlwaysOnTop(s.alwaysOnTop);
}

function saveSettings() {
  state.data.settings.workDuration = parseInt(dom.settingWork.value) || 25;
  state.data.settings.shortBreakDuration = parseInt(dom.settingShortBreak.value) || 5;
  state.data.settings.longBreakDuration = parseInt(dom.settingLongBreak.value) || 15;
  state.data.settings.longBreakInterval = parseInt(dom.settingInterval.value) || 4;
  state.data.settings.alwaysOnTop = dom.settingOnTop.checked;

  // Clamp values
  const s = state.data.settings;
  s.workDuration = Math.max(1, Math.min(60, s.workDuration));
  s.shortBreakDuration = Math.max(1, Math.min(30, s.shortBreakDuration));
  s.longBreakDuration = Math.max(1, Math.min(60, s.longBreakDuration));
  s.longBreakInterval = Math.max(1, Math.min(10, s.longBreakInterval));

  Storage.save(state.data);
  applySettings();

  // Reset timer with new durations
  resetTimer();
}

// ---- Event Bindings ----
dom.btnStart.addEventListener('click', startTimer);
dom.btnPause.addEventListener('click', pauseTimer);
dom.btnReset.addEventListener('click', resetTimer);
dom.btnSkip.addEventListener('click', skipSession);

dom.btnMinimize.addEventListener('click', () => {
  window.electronAPI?.minimizeToTray();
});

dom.btnClose.addEventListener('click', () => {
  window.electronAPI?.closeApp();
});

dom.btnAddTask.addEventListener('click', () => {
  const title = dom.taskInput.value.trim();
  if (title) {
    addTask(title);
    dom.taskInput.value = '';
  }
});

dom.taskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const title = dom.taskInput.value.trim();
    if (title) {
      addTask(title);
      dom.taskInput.value = '';
    }
  }
});

dom.btnToggleTasks.addEventListener('click', () => {
  const hidden = dom.taskBody.style.display === 'none';
  dom.taskBody.style.display = hidden ? '' : 'none';
  dom.btnToggleTasks.textContent = hidden ? '▲' : '▼';
});

dom.btnToggleSettings.addEventListener('click', () => {
  const hidden = dom.settingsBody.style.display === 'none';
  dom.settingsBody.style.display = hidden ? '' : 'none';
  dom.btnToggleSettings.textContent = hidden ? '▲' : '▼';
});

// Settings change listeners
['change', 'input'].forEach((eventType) => {
  dom.settingWork.addEventListener(eventType, saveSettings);
  dom.settingShortBreak.addEventListener(eventType, saveSettings);
  dom.settingLongBreak.addEventListener(eventType, saveSettings);
  dom.settingInterval.addEventListener(eventType, saveSettings);
  dom.settingOnTop.addEventListener('change', saveSettings);
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return; // Don't capture when typing
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      if (state.isRunning) {
        pauseTimer();
      } else {
        startTimer();
      }
      break;
    case 'KeyR':
      if (e.ctrlKey) break;
      resetTimer();
      break;
    case 'KeyS':
      if (e.ctrlKey) break;
      skipSession();
      break;
  }
});

// ---- Initialization ----
async function init() {
  state.data = await Storage.load();
  applySettings();

  const workDuration = state.data.settings.workDuration * 60;
  state.mode = 'work';
  state.totalTime = workDuration;
  state.timeLeft = workDuration;
  state.completedPomodoros = state.data.completedPomodoros || 0;

  updateTimerDisplay();
  updateProgressRing();
  updateModeUI();
  updateTaskList();
  updateCurrentTaskDisplay();
  updateStats();
}

init();
