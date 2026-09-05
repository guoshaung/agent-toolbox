import { h, toast } from '../../core/ui.js';
import { iconFor } from '../../core/icons.js';

const FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'active', label: '进行中' },
  { id: 'done', label: '已完成' },
];

const PRIORITIES = [
  { id: 'normal', label: '普通', color: '#8190a8' },
  { id: 'high', label: '重要', color: '#dfa145' },
  { id: 'urgent', label: '紧急', color: '#e46a70' },
];

const todayKey = () => new Date().toISOString().slice(0, 10);
const makeId = () => `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export default {
  id: 'tasks',
  title: '任务',
  icon: 'checkList',
  hint: '任务清单：快速添加、完成、优先级、筛选和拖动排序',

  create(root, ctx) {
    const { config } = ctx;
    let tasks = (config.get('tasks.items', []) || []).map((task) => ({
      id: task.id || makeId(), title: String(task.title || '').trim(), done: Boolean(task.done), priority: task.priority || 'normal', due: task.due || '', createdAt: task.createdAt || Date.now(), completedAt: task.completedAt || 0,
    })).filter((task) => task.title);
    let filter = config.get('tasks.filter', 'all');
    let draggingId = null;

    const countEl = h('span', { class: 'faint tasks__count' });
    const progressEl = h('div', { class: 'tasks__progress' });
    const listEl = h('div', { class: 'tasks__list' });
    const emptyEl = h('div', { class: 'tasks__empty', hidden: true }, iconFor('checkList', 'ui-icon tasks__empty-icon'), h('strong', {}, '还没有任务'), h('span', {}, '在上方输入一个任务，按回车就会出现在这里。'));
    const quickInput = h('input', { class: 'field tasks__quick-input', placeholder: '添加任务，回车创建，例如：读完论文方法部分', maxlength: '160' });
    const quickPriority = h('select', { class: 'field field--sm tasks__priority-select', title: '新任务优先级' }, ...PRIORITIES.map((priority) => h('option', { value: priority.id }, priority.label)));
    const quickDue = h('input', { class: 'field field--sm tasks__due-input', type: 'date', title: '截止日期' });

    function persist() { config.set('tasks.items', tasks); }

    function visibleTasks() {
      if (filter === 'active') return tasks.filter((task) => !task.done);
      if (filter === 'done') return tasks.filter((task) => task.done);
      return tasks;
    }

    function renderStats() {
      const active = tasks.filter((task) => !task.done).length;
      const done = tasks.length - active;
      countEl.textContent = `${active} 项进行中 · ${done} 项已完成`;
      progressEl.style.setProperty('--tasks-progress', tasks.length ? String(done / tasks.length) : '0');
      progressEl.setAttribute('aria-label', `完成 ${done}/${tasks.length}`);
    }

    function addTask() {
      const title = quickInput.value.trim();
      if (!title) return toast('先输入任务内容', 'info');
      tasks = [{ id: makeId(), title, done: false, priority: quickPriority.value, due: quickDue.value, createdAt: Date.now(), completedAt: 0 }, ...tasks];
      quickInput.value = '';
      quickDue.value = '';
      quickInput.focus();
      persist();
      render();
    }

    function toggleTask(task) {
      task.done = !task.done;
      task.completedAt = task.done ? Date.now() : 0;
      persist();
      render();
    }

    function editTask(task) {
      const input = h('input', { class: 'field tasks__edit-input', value: task.title, maxlength: '160' });
      const row = listEl.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`);
      const title = row?.querySelector('.tasks__title');
      if (!row || !title) return;
      title.replaceWith(input);
      input.focus();
      input.select();
      const commit = () => {
        const value = input.value.trim();
        if (value) task.title = value;
        persist();
        render();
      };
      input.addEventListener('blur', commit, { once: true });
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter') input.blur(); if (event.key === 'Escape') { input.value = task.title; input.blur(); } });
    }

    function removeTask(task) {
      tasks = tasks.filter((item) => item.id !== task.id);
      persist();
      render();
    }

    function cyclePriority(task) {
      const index = PRIORITIES.findIndex((priority) => priority.id === task.priority);
      task.priority = PRIORITIES[(index + 1) % PRIORITIES.length].id;
      persist();
      render();
    }

    function reorder(sourceId, targetId) {
      if (!sourceId || !targetId || sourceId === targetId) return;
      const sourceIndex = tasks.findIndex((task) => task.id === sourceId);
      const targetIndex = tasks.findIndex((task) => task.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return;
      const [moved] = tasks.splice(sourceIndex, 1);
      tasks.splice(targetIndex, 0, moved);
      persist();
      render();
    }

    function renderTask(task) {
      const priority = PRIORITIES.find((item) => item.id === task.priority) || PRIORITIES[0];
      const dueText = task.due ? (task.due === todayKey() ? '今天到期' : `截止 ${task.due}`) : '';
      const row = h('article', { class: `tasks__item${task.done ? ' is-done' : ''}`, dataset: { taskId: task.id }, draggable: 'true' },
        h('button', { class: 'tasks__check', title: task.done ? '标记未完成' : '标记完成', onclick: () => toggleTask(task) }, task.done ? '✓' : ''),
        h('div', { class: 'tasks__copy' }, h('div', { class: 'tasks__title', title: '双击编辑任务', ondblclick: () => editTask(task) }, task.title), h('div', { class: 'tasks__meta' }, h('button', { class: 'tasks__priority', style: { color: priority.color }, title: '点击切换优先级', onclick: () => cyclePriority(task) }, `● ${priority.label}`), dueText && h('span', {}, dueText), h('span', { class: 'faint' }, new Date(task.createdAt).toLocaleDateString('zh-CN')))),
        h('button', { class: 'tasks__delete', title: '删除任务', onclick: () => removeTask(task) }, '×'),
      );
      row.addEventListener('dragstart', (event) => { draggingId = task.id; row.classList.add('is-dragging'); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', task.id); });
      row.addEventListener('dragend', () => { draggingId = null; row.classList.remove('is-dragging'); });
      row.addEventListener('dragover', (event) => { event.preventDefault(); row.classList.add('is-drop-target'); });
      row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
      row.addEventListener('drop', (event) => { event.preventDefault(); row.classList.remove('is-drop-target'); reorder(draggingId || event.dataTransfer.getData('text/plain'), task.id); });
      return row;
    }

    function render() {
      const visible = visibleTasks();
      listEl.replaceChildren(...visible.map(renderTask));
      emptyEl.hidden = visible.length > 0;
      renderStats();
      for (const button of filterBar.querySelectorAll('.tasks__filter')) button.classList.toggle('is-active', button.dataset.filter === filter);
    }

    const filterBar = h('div', { class: 'tasks__filters' }, ...FILTERS.map((item) => h('button', { class: `btn btn--sm tasks__filter${item.id === filter ? ' is-active' : ''}`, dataset: { filter: item.id }, onclick: () => { filter = item.id; config.set('tasks.filter', filter); render(); } }, item.label)));
    quickInput.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); addTask(); } });

    root.append(
      h('div', { class: 'bar tasks__bar' }, h('strong', {}, '任务清单'), h('span', { class: 'faint' }, '像列表一样管理今天要做的事'), countEl),
      h('div', { class: 'tasks__body' },
        h('section', { class: 'tasks__main' },
          h('div', { class: 'tasks__composer' }, quickInput, quickPriority, quickDue, h('button', { class: 'btn btn--sm btn--primary', onclick: addTask }, '添加任务')),
          h('div', { class: 'tasks__summary' }, h('span', { class: 'faint' }, '完成进度'), progressEl, filterBar),
          listEl, emptyEl,
        ),
        h('aside', { class: 'tasks__side' },
          h('section', { class: 'card tasks__help' }, h('h3', {}, '使用方式'), h('p', {}, '任务会自动保存到本机。双击任务文字编辑，拖动整行调整顺序，点击圆点完成。'), h('p', { class: 'faint' }, '快捷输入：在输入框回车即可创建；不限制任务数量。')),
          h('section', { class: 'card tasks__today' }, h('h3', {}, '今天'), h('div', { class: 'tasks__today-copy' }, h('strong'), h('span', { class: 'faint' }, '先完成最重要的一项，再继续下一项。'))),
        ),
      ),
    );
    const todayStrong = root.querySelector('.tasks__today-copy strong');
    if (todayStrong) todayStrong.textContent = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
    render();
    return {};
  },
};
