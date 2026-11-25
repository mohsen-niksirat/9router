/**
 * Command Palette (Ctrl/Cmd+K) & Keyboard Shortcuts Modal (Ctrl+/)
 * Accessible, RTL Persian-friendly ES module with fuzzy search and keyboard navigation.
 */

const DEFAULT_SHORTCUTS = [
  { keys: ['Ctrl', 'K'], label: 'جستجو و دستورات' },
  { keys: ['Ctrl', 'Shift', 'O'], label: 'چت جدید' },
  { keys: ['Esc'], label: 'توقف تولید / بستن پنجره' },
  { keys: ['Ctrl', '/'], label: 'راهنمای میانبرها' },
];

function isEditableTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('[contenteditable="true"]'));
}

function normalizeText(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .trim();
}

/**
 * Simple, fast fuzzy scorer. Returns -1 if no match, otherwise a higher score for better matches.
 */
function fuzzyScore(query, text) {
  const q = normalizeText(query);
  if (!q) return 1;
  const t = normalizeText(text);
  if (!t) return -1;

  if (t === q) return 1000;
  if (t.startsWith(q)) return 600 - (t.length - q.length) * 0.1;

  const idx = t.indexOf(q);
  if (idx !== -1) {
    const wordBoundary = idx === 0 || t[idx - 1] === ' ' || t[idx - 1] === '-' || t[idx - 1] === '_';
    return (wordBoundary ? 400 : 250) - idx * 0.5;
  }

  let qi = 0;
  let score = 0;
  let consecutive = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      consecutive++;
      score += 10 + consecutive * 5;
      if (ti === 0 || t[ti - 1] === ' ') score += 12;
    } else {
      consecutive = 0;
    }
  }
  return qi === q.length ? score : -1;
}

function scoreItem(query, item) {
  if (!query || !query.trim()) return 1;
  const titleScore = fuzzyScore(query, item.title);
  const subScore = fuzzyScore(query, item.subtitle);
  const groupScore = fuzzyScore(query, item.group);
  const idScore = fuzzyScore(query, item.id);
  const best = Math.max(
    titleScore >= 0 ? titleScore * 2 : -1,
    subScore >= 0 ? subScore : -1,
    groupScore >= 0 ? groupScore * 0.8 : -1,
    idScore >= 0 ? idScore * 0.6 : -1
  );
  return best;
}

function renderShortcutKeys(keys) {
  const frag = document.createDocumentFragment();
  const list = Array.isArray(keys)
    ? keys
    : String(keys || '')
        .split('+')
        .map((k) => k.trim())
        .filter(Boolean);

  list.forEach((key) => {
    const kbd = document.createElement('kbd');
    kbd.className = 'cmd-kbd';
    kbd.textContent = key;
    frag.appendChild(kbd);
  });
  return frag;
}

/**
 * Create and mount a Command Palette & Keyboard Shortcuts controller.
 *
 * @param {Object} options
 * @param {() => Array<{id: string, group?: string, title: string, subtitle?: string, shortcut?: string|string[], action?: Function}>} [options.getItems]
 * @param {(item: Object) => void} [options.onSelect]
 * @param {Array<{keys: string|string[], label: string}>} [options.shortcuts]
 * @returns {{ open: () => void, close: () => void, toggle: () => void, isOpen: () => boolean, openShortcutsModal: () => void, closeShortcutsModal: () => void, destroy: () => void }}
 */
export function createCommandPalette({ getItems, onSelect, shortcuts } = {}) {
  let paletteOpen = false;
  let shortcutsOpen = false;
  let filteredItems = [];
  let activeIndex = 0;
  let lastFocusedEl = null;

  // ── Command Palette DOM ──────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'cmd-overlay';
  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');

  const dialog = document.createElement('div');
  dialog.className = 'cmd-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'پالت دستورات و جستجوی سریع');

  const header = document.createElement('div');
  header.className = 'cmd-header';

  const searchIcon = document.createElement('span');
  searchIcon.className = 'cmd-search-icon';
  searchIcon.setAttribute('aria-hidden', 'true');
  searchIcon.textContent = '⌕';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cmd-input';
  input.placeholder = 'جستجو در گفتگوها، مدل‌ها و دستورات...';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'cmd-palette-list');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-label', 'جستجو و اجرای دستورات');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'cmd-close-btn';
  closeBtn.setAttribute('aria-label', 'بستن پالت دستورات');
  closeBtn.textContent = 'Esc';

  header.append(searchIcon, input, closeBtn);

  const listEl = document.createElement('div');
  listEl.id = 'cmd-palette-list';
  listEl.className = 'cmd-list';
  listEl.setAttribute('role', 'listbox');
  listEl.setAttribute('aria-label', 'نتایج دستورات');

  const footer = document.createElement('div');
  footer.className = 'cmd-footer';
  footer.innerHTML =
    '<span class="cmd-hint"><kbd class="cmd-kbd">↑</kbd><kbd class="cmd-kbd">↓</kbd> جابه‌جایی</span>' +
    '<span class="cmd-hint"><kbd class="cmd-kbd">Enter</kbd> اجرا</span>' +
    '<span class="cmd-hint"><kbd class="cmd-kbd">Esc</kbd> بستن</span>' +
    '<span class="cmd-hint"><kbd class="cmd-kbd">Ctrl</kbd><kbd class="cmd-kbd">/</kbd> میانبرها</span>';

  dialog.append(header, listEl, footer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // ── Keyboard Shortcuts Modal DOM ─────────────────────────────────────────
  const shortcutsOverlay = document.createElement('div');
  shortcutsOverlay.className = 'cmd-overlay cmd-shortcuts-overlay';
  shortcutsOverlay.hidden = true;
  shortcutsOverlay.setAttribute('aria-hidden', 'true');

  const shortcutsDialog = document.createElement('div');
  shortcutsDialog.className = 'cmd-dialog cmd-shortcuts-dialog';
  shortcutsDialog.setAttribute('role', 'dialog');
  shortcutsDialog.setAttribute('aria-modal', 'true');
  shortcutsDialog.setAttribute('aria-label', 'راهنمای میانبرهای صفحه‌کلید');

  const shortcutsHeader = document.createElement('div');
  shortcutsHeader.className = 'cmd-shortcuts-header';

  const shortcutsTitle = document.createElement('h2');
  shortcutsTitle.className = 'cmd-shortcuts-title';
  shortcutsTitle.textContent = 'میانبرهای صفحه‌کلید';

  const shortcutsCloseBtn = document.createElement('button');
  shortcutsCloseBtn.type = 'button';
  shortcutsCloseBtn.className = 'cmd-close-btn';
  shortcutsCloseBtn.setAttribute('aria-label', 'بستن راهنمای میانبرها');
  shortcutsCloseBtn.textContent = '✕';

  shortcutsHeader.append(shortcutsTitle, shortcutsCloseBtn);

  const shortcutsListEl = document.createElement('div');
  shortcutsListEl.className = 'cmd-shortcuts-list';

  shortcutsDialog.append(shortcutsHeader, shortcutsListEl);
  shortcutsOverlay.appendChild(shortcutsDialog);
  document.body.appendChild(shortcutsOverlay);

  // ── Helpers ──────────────────────────────────────────────────────────────
  function restoreFocus() {
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function' && document.contains(lastFocusedEl)) {
      lastFocusedEl.focus();
    }
    lastFocusedEl = null;
  }

  function renderShortcuts() {
    const entries =
      Array.isArray(shortcuts) && shortcuts.length > 0 ? shortcuts : DEFAULT_SHORTCUTS;
    shortcutsListEl.textContent = '';

    entries.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'cmd-shortcut-row';

      const label = document.createElement('span');
      label.className = 'cmd-shortcut-label';
      label.textContent = entry.label || '';

      const keysWrap = document.createElement('span');
      keysWrap.className = 'cmd-shortcut-keys';
      keysWrap.setAttribute('dir', 'ltr');
      keysWrap.appendChild(renderShortcutKeys(entry.keys));

      row.append(label, keysWrap);
      shortcutsListEl.appendChild(row);
    });
  }

  function updateActiveItem(nextIndex, scrollIntoView = true) {
    if (filteredItems.length === 0) {
      activeIndex = -1;
      input.removeAttribute('aria-activedescendant');
      return;
    }
    activeIndex = (nextIndex + filteredItems.length) % filteredItems.length;
    const optionEls = listEl.querySelectorAll('.cmd-item');
    optionEls.forEach((el, idx) => {
      const isSelected = idx === activeIndex;
      el.classList.toggle('active', isSelected);
      el.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      if (isSelected) {
        input.setAttribute('aria-activedescendant', el.id);
        if (scrollIntoView) {
          el.scrollIntoView({ block: 'nearest' });
        }
      }
    });
  }

  function selectItem(item) {
    if (!item) return;
    close();
    if (typeof item.action === 'function') {
      item.action(item);
    }
    if (typeof onSelect === 'function') {
      onSelect(item);
    }
  }

  function renderList() {
    const rawItems = typeof getItems === 'function' ? getItems() || [] : [];
    const query = input.value;

    const scored = [];
    for (let i = 0; i < rawItems.length; i++) {
      const item = rawItems[i];
      if (!item || !item.title) continue;
      const s = scoreItem(query, item);
      if (s >= 0) {
        scored.push({ item, score: s, order: i });
      }
    }

    if (query.trim()) {
      scored.sort((a, b) => b.score - a.score || a.order - b.order);
    }

    filteredItems = scored.map((entry) => entry.item);
    listEl.textContent = '';

    if (filteredItems.length === 0) {
      activeIndex = -1;
      input.removeAttribute('aria-activedescendant');
      const empty = document.createElement('div');
      empty.className = 'cmd-empty';
      empty.textContent = 'موردی یافت نشد';
      listEl.appendChild(empty);
      return;
    }

    // Group items while preserving order of first appearance
    const groups = new Map();
    filteredItems.forEach((item, flatIdx) => {
      const groupName = item.group || 'دستورات';
      if (!groups.has(groupName)) groups.set(groupName, []);
      groups.get(groupName).push({ item, flatIdx });
    });

    const frag = document.createDocumentFragment();
    groups.forEach((entries, groupName) => {
      const groupEl = document.createElement('div');
      groupEl.className = 'cmd-group';

      const titleEl = document.createElement('div');
      titleEl.className = 'cmd-group-title';
      titleEl.textContent = groupName;
      groupEl.appendChild(titleEl);

      entries.forEach(({ item, flatIdx }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = `cmd-opt-${flatIdx}`;
        btn.className = 'cmd-item';
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', 'false');
        btn.dataset.index = String(flatIdx);

        const main = document.createElement('div');
        main.className = 'cmd-item-main';

        const title = document.createElement('span');
        title.className = 'cmd-item-title';
        title.textContent = item.title;
        main.appendChild(title);

        if (item.subtitle) {
          const sub = document.createElement('span');
          sub.className = 'cmd-item-sub';
          sub.textContent = item.subtitle;
          main.appendChild(sub);
        }

        btn.appendChild(main);

        if (item.shortcut) {
          const kbdWrap = document.createElement('span');
          kbdWrap.className = 'cmd-item-shortcut';
          kbdWrap.setAttribute('dir', 'ltr');
          kbdWrap.appendChild(renderShortcutKeys(item.shortcut));
          btn.appendChild(kbdWrap);
        }

        btn.addEventListener('click', () => {
          selectItem(item);
        });

        groupEl.appendChild(btn);
      });

      frag.appendChild(groupEl);
    });

    listEl.appendChild(frag);
    updateActiveItem(0, false);
  }

  // ── Public API ───────────────────────────────────────────────────────────
  function open() {
    if (shortcutsOpen) closeShortcutsModal(false);
    if (paletteOpen) {
      input.focus();
      return;
    }
    lastFocusedEl = document.activeElement;
    paletteOpen = true;
    input.value = '';
    overlay.hidden = false;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    renderList();
    requestAnimationFrame(() => input.focus());
  }

  function close(shouldRestoreFocus = true) {
    if (!paletteOpen) return;
    paletteOpen = false;
    overlay.classList.remove('open');
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    if (shouldRestoreFocus) restoreFocus();
  }

  function toggle() {
    if (paletteOpen) close();
    else open();
  }

  function isOpen() {
    return paletteOpen || shortcutsOpen;
  }

  function openShortcutsModal() {
    if (paletteOpen) close(false);
    if (shortcutsOpen) return;
    lastFocusedEl = document.activeElement;
    shortcutsOpen = true;
    renderShortcuts();
    shortcutsOverlay.hidden = false;
    shortcutsOverlay.classList.add('open');
    shortcutsOverlay.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => shortcutsCloseBtn.focus());
  }

  function closeShortcutsModal(shouldRestoreFocus = true) {
    if (!shortcutsOpen) return;
    shortcutsOpen = false;
    shortcutsOverlay.classList.remove('open');
    shortcutsOverlay.hidden = true;
    shortcutsOverlay.setAttribute('aria-hidden', 'true');
    if (shouldRestoreFocus) restoreFocus();
  }

  // ── Event Listeners ──────────────────────────────────────────────────────
  input.addEventListener('input', () => {
    renderList();
  });

  input.addEventListener('keydown', (e) => {
    if (!paletteOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      updateActiveItem(activeIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      updateActiveItem(activeIndex - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && filteredItems[activeIndex]) {
        selectItem(filteredItems[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  listEl.addEventListener('mousemove', (e) => {
    const btn = e.target.closest('.cmd-item');
    if (!btn || !listEl.contains(btn)) return;
    const optionEls = Array.from(listEl.querySelectorAll('.cmd-item'));
    const idx = optionEls.indexOf(btn);
    if (idx !== -1 && idx !== activeIndex) {
      updateActiveItem(idx, false);
    }
  });

  closeBtn.addEventListener('click', () => close());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  shortcutsCloseBtn.addEventListener('click', () => closeShortcutsModal());
  shortcutsOverlay.addEventListener('click', (e) => {
    if (e.target === shortcutsOverlay) closeShortcutsModal();
  });

  function onGlobalKeyDown(e) {
    const mod = e.ctrlKey || e.metaKey;
    const isK = e.code === 'KeyK' || (e.key && e.key.toLowerCase() === 'k');
    const isSlash = e.code === 'Slash' || e.key === '/';

    // Ctrl/Cmd+K works everywhere, including inside inputs
    if (mod && !e.altKey && !e.shiftKey && isK) {
      e.preventDefault();
      toggle();
      return;
    }

    // Escape closes whichever modal is open (even when focused inside an input)
    if (e.key === 'Escape') {
      if (paletteOpen) {
        e.preventDefault();
        close();
        return;
      }
      if (shortcutsOpen) {
        e.preventDefault();
        closeShortcutsModal();
        return;
      }
      return;
    }

    // Ignore all other global shortcuts while typing in editable fields
    if (isEditableTarget(e.target)) return;

    // Ctrl/Cmd+/ toggles Keyboard Shortcuts modal
    if (mod && !e.altKey && !e.shiftKey && isSlash) {
      e.preventDefault();
      if (shortcutsOpen) closeShortcutsModal();
      else openShortcutsModal();
    }
  }

  document.addEventListener('keydown', onGlobalKeyDown);

  function destroy() {
    document.removeEventListener('keydown', onGlobalKeyDown);
    overlay.remove();
    shortcutsOverlay.remove();
  }

  return {
    open,
    close,
    toggle,
    isOpen,
    openShortcutsModal,
    closeShortcutsModal,
    destroy,
  };
}
