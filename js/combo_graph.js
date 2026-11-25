/**
 * Visual Node-Based Combo Builder (SVG Bezier Wires + Draggable Nodes).
 * Connect: [User Prompt] -> [Routing Policy] -> [Provider A] -> [Provider B]
 */

import { store, ROUTING_POLICIES } from './store.js';
import { escHtml } from './markdown.js';

let selectedComboId = null;
let selectedNodeId = null;
let selectedEdgeIdx = null;
let linkingFromNodeId = null;
let activeKeyHandler = null;
let zoom = 1;
let panX = 0;
let panY = 0;

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function cubicPoint(x1, y1, cx1, cy1, cx2, cy2, x2, y2, t) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  const a = mt2 * mt;
  const b = 3 * mt2 * t;
  const c = 3 * mt * t2;
  const d = t2 * t;
  return {
    x: a * x1 + b * cx1 + c * cx2 + d * x2,
    y: a * y1 + b * cy1 + c * cy2 + d * y2,
  };
}

export function renderComboGraph(container, { onToast, onActivateCombo }) {
  if (!store.state.combos.length) store.createCombo('Smart Default');
  let combo = store.state.combos.find((c) => c.id === selectedComboId) || store.state.combos[0];
  selectedComboId = combo.id;
  linkingFromNodeId = null;

  if (selectedNodeId && !combo.nodes.some((n) => n.id === selectedNodeId)) {
    selectedNodeId = null;
  }
  if (selectedEdgeIdx !== null && (selectedEdgeIdx < 0 || selectedEdgeIdx >= combo.edges.length)) {
    selectedEdgeIdx = null;
  }

  const isActive =
    store.state.activeTarget?.type === 'combo' && store.state.activeTarget?.id === combo.id;

  container.innerHTML = `
    <div class="graph-toolbar">
      <div class="graph-left">
        <select id="combo-select" class="graph-select" aria-label="انتخاب کمبو">
          ${store.state.combos
            .map((c) => `<option value="${c.id}" ${c.id === combo.id ? 'selected' : ''}>🔀 ${escHtml(c.name)}</option>`)
            .join('')}
        </select>
        <button class="btn btn-sm btn-ghost" id="btn-rename-combo" type="button" title="تغییر نام کمبو" aria-label="تغییر نام کمبو">✏️ تغییر نام</button>
        <button class="btn btn-sm btn-ghost" id="btn-new-combo" type="button">+ کمبو جدید</button>
        <button class="btn btn-sm btn-danger" id="btn-del-combo" type="button" ${store.state.combos.length <= 1 ? 'disabled' : ''}>حذف</button>
      </div>
      <div class="graph-right">
        <div class="graph-zoom-group" role="group" aria-label="بزرگنمایی بوم">
          <button class="btn btn-sm btn-ghost" id="btn-zoom-out" type="button" title="کوچک‌نمایی" aria-label="کوچک‌نمایی">−</button>
          <button class="btn btn-sm btn-ghost graph-zoom-val" id="btn-zoom-reset" type="button" title="بازنشانی نما (100%)" aria-label="بازنشانی نما">${Math.round(zoom * 100)}%</button>
          <button class="btn btn-sm btn-ghost" id="btn-zoom-in" type="button" title="بزرگ‌نمایی" aria-label="بزرگ‌نمایی">+</button>
        </div>
        <button class="btn btn-sm btn-ghost" id="btn-auto-layout" type="button" title="چیدمان خودکار نودها">✨ چیدمان خودکار</button>
        <select id="add-node-prov" class="graph-select" aria-label="انتخاب ارائه‌دهنده برای افزودن نود">
          ${store.state.providers.map((p) => `<option value="${p.id}">${escHtml(p.name)} (${p.keys.length} کلید)</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-ghost" id="btn-add-node" type="button">+ افزودن نود</button>
        <button class="btn btn-sm ${isActive ? 'btn-ok' : 'btn-amber'}" id="btn-activate-combo" type="button">
          ${isActive ? '✅ کمبوی فعال' : '⚡ فعال‌سازی در چت'}
        </button>
      </div>
    </div>

    <div class="graph-hint">
      💡 نودها را جابه‌جا کنید یا فضای خالی را برای حرکت بوم بکشید. برای اتصال، از <b>پورت خروجی (●)</b> به <b>پورت ورودی (○)</b> بکشید یا کلیک کنید. برای حذف، روی دکمه <b>×</b> یا کلید <kbd>Delete</kbd> بزنید.
    </div>

    <div class="graph-canvas" id="graph-canvas" dir="ltr" tabindex="0" aria-label="بوم گرافیکی کمبو">
      <div class="graph-stage" id="graph-stage">
        <svg class="graph-svg" id="graph-svg"></svg>
        <div class="graph-edge-controls" id="graph-edge-controls"></div>
        <div class="graph-nodes" id="graph-nodes"></div>
      </div>
    </div>
  `;

  const canvasEl = container.querySelector('#graph-canvas');
  const stageEl = container.querySelector('#graph-stage');
  const svgEl = container.querySelector('#graph-svg');
  const edgeControlsEl = container.querySelector('#graph-edge-controls');
  const nodesEl = container.querySelector('#graph-nodes');
  const zoomResetBtn = container.querySelector('#btn-zoom-reset');

  let previewPathEl = null;

  function applyTransform() {
    stageEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    canvasEl.style.backgroundPosition = `${panX}px ${panY}px`;
    canvasEl.style.backgroundSize = `${22 * zoom}px ${22 * zoom}px`;
    if (zoomResetBtn) zoomResetBtn.textContent = `${Math.round(zoom * 100)}%`;
  }

  function clientToStage(clientX, clientY) {
    const rect = canvasEl.getBoundingClientRect();
    return {
      x: (clientX - rect.left - panX) / zoom,
      y: (clientY - rect.top - panY) / zoom,
    };
  }

  function getPortCenter(nodeId, kind) {
    const sel = kind === 'out' ? `[data-node-id="${nodeId}"] .port-out` : `[data-node-id="${nodeId}"] .port-in`;
    const portEl = nodesEl.querySelector(sel);
    if (!portEl) return null;
    const pRect = portEl.getBoundingClientRect();
    return clientToStage(pRect.left + pRect.width / 2, pRect.top + pRect.height / 2);
  }

  function clearLinkingState() {
    linkingFromNodeId = null;
    nodesEl.querySelectorAll('.port-out').forEach((p) => p.classList.remove('linking'));
    nodesEl.querySelectorAll('.port-in').forEach((p) => p.classList.remove('port-compatible'));
    if (previewPathEl) {
      previewPathEl.remove();
      previewPathEl = null;
    }
  }

  function highlightCompatiblePorts(fromId) {
    nodesEl.querySelectorAll('.port-in').forEach((p) => {
      const toId = p.dataset.portIn;
      const alreadyLinked = combo.edges.some((ed) => ed.from === fromId && ed.to === toId);
      p.classList.toggle('port-compatible', Boolean(fromId && toId !== fromId && !alreadyLinked));
    });
  }

  function updatePreviewWire(fromId, targetX, targetY) {
    const start = getPortCenter(fromId, 'out');
    if (!start) return;
    const dx = Math.max(50, Math.abs(targetX - start.x) * 0.5);
    const d = `M ${start.x} ${start.y} C ${start.x + dx} ${start.y}, ${targetX - dx} ${targetY}, ${targetX} ${targetY}`;
    if (!previewPathEl) {
      previewPathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      previewPathEl.setAttribute('class', 'wire-preview');
      svgEl.appendChild(previewPathEl);
    }
    previewPathEl.setAttribute('d', d);
  }

  function tryConnect(fromId, toId) {
    if (!fromId || !toId) return false;
    if (fromId === toId) {
      onToast?.('اتصال نود به خودش مجاز نیست');
      return false;
    }
    const exists = combo.edges.some((ed) => ed.from === fromId && ed.to === toId);
    if (exists) {
      onToast?.('این اتصال از قبل وجود دارد');
      return false;
    }
    combo.edges.push({ from: fromId, to: toId });
    store.save();
    drawEdges();
    onToast?.('اتصال برقرار شد');
    return true;
  }

  function deleteEdge(idx) {
    if (idx < 0 || idx >= combo.edges.length) return;
    combo.edges.splice(idx, 1);
    if (selectedEdgeIdx === idx) selectedEdgeIdx = null;
    else if (selectedEdgeIdx !== null && selectedEdgeIdx > idx) selectedEdgeIdx -= 1;
    store.save();
    drawEdges();
    onToast?.('اتصال حذف شد');
  }

  function deleteNode(nodeId) {
    const target = combo.nodes.find((n) => n.id === nodeId);
    if (!target || target.type === 'start') return;
    combo.nodes = combo.nodes.filter((n) => n.id !== nodeId);
    combo.edges = combo.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
    if (selectedNodeId === nodeId) selectedNodeId = null;
    selectedEdgeIdx = null;
    clearLinkingState();
    store.save();
    renderNodes();
    drawEdges();
    onToast?.('نود حذف شد');
  }

  function updateSelectionUI() {
    nodesEl.querySelectorAll('.g-node').forEach((el) => {
      el.classList.toggle('selected', el.dataset.nodeId === selectedNodeId);
    });
    svgEl.querySelectorAll('.wire-group').forEach((g) => {
      g.classList.toggle('selected', Number(g.dataset.edgeIdx) === selectedEdgeIdx);
    });
    edgeControlsEl.querySelectorAll('.edge-del-btn').forEach((btn) => {
      btn.classList.toggle('selected', Number(btn.dataset.edgeIdx) === selectedEdgeIdx);
    });
  }

  function drawEdges() {
    const paths = [];
    const controls = [];
    const outgoingOrderMap = new Map();

    // Precompute 1-based priority order for outgoing edges from each node
    for (let i = 0; i < combo.edges.length; i++) {
      const ed = combo.edges[i];
      const list = outgoingOrderMap.get(ed.from) || [];
      list.push(i);
      outgoingOrderMap.set(ed.from, list);
    }

    for (let i = 0; i < combo.edges.length; i++) {
      const edge = combo.edges[i];
      const p1 = getPortCenter(edge.from, 'out');
      const p2 = getPortCenter(edge.to, 'in');
      if (!p1 || !p2) continue;

      const x1 = p1.x;
      const y1 = p1.y;
      const x2 = p2.x;
      const y2 = p2.y;
      const dx = Math.max(55, Math.abs(x2 - x1) * 0.5);
      const cx1 = x1 + dx;
      const cy1 = y1;
      const cx2 = x2 - dx;
      const cy2 = y2;

      const d = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
      const isSelected = selectedEdgeIdx === i;

      paths.push(
        `<g class="wire-group ${isSelected ? 'selected' : ''}" data-edge-idx="${i}">` +
          `<path class="wire-hit" data-edge-idx="${i}" d="${d}" />` +
          `<path class="wire" d="${d}" />` +
          `<path class="wire-flow" d="${d}" />` +
        `</g>`
      );

      // Midpoint delete button
      const mid = cubicPoint(x1, y1, cx1, cy1, cx2, cy2, x2, y2, 0.5);
      controls.push(
        `<button type="button" class="edge-del-btn ${isSelected ? 'selected' : ''}" data-del-edge="${i}" data-edge-idx="${i}" style="left:${mid.x}px;top:${mid.y}px" title="حذف اتصال" aria-label="حذف اتصال">×</button>`
      );

      // Priority badge (#1, #2, #3) on outgoing edges from policy or multi-branch nodes
      const fromNode = combo.nodes.find((n) => n.id === edge.from);
      const siblings = outgoingOrderMap.get(edge.from) || [];
      if (fromNode?.type === 'policy' || siblings.length > 1) {
        const rank = siblings.indexOf(i) + 1;
        const badgePt = cubicPoint(x1, y1, cx1, cy1, cx2, cy2, x2, y2, 0.24);
        controls.push(
          `<span class="edge-priority-badge" style="left:${badgePt.x}px;top:${badgePt.y}px" title="اولویت مسیر #${rank}">#${rank}</span>`
        );
      }
    }

    svgEl.innerHTML = paths.join('');
    if (previewPathEl) svgEl.appendChild(previewPathEl);
    edgeControlsEl.innerHTML = controls.join('');

    svgEl.querySelectorAll('.wire-hit').forEach((p) => {
      p.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
      });
      p.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number(p.dataset.edgeIdx);
        selectedEdgeIdx = idx;
        selectedNodeId = null;
        updateSelectionUI();
        canvasEl.focus({ preventScroll: true });
      });
    });

    edgeControlsEl.querySelectorAll('[data-del-edge]').forEach((btn) => {
      const stopProp = (e) => e.stopPropagation();
      btn.addEventListener('pointerdown', stopProp);
      btn.addEventListener('mousedown', stopProp);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteEdge(Number(btn.dataset.delEdge));
      });
    });
  }

  function renderNodes() {
    nodesEl.innerHTML = combo.nodes
      .map((n) => {
        const isSel = selectedNodeId === n.id;
        if (n.type === 'start') {
          return `
            <div class="g-node node-start ${isSel ? 'selected' : ''}" data-node-id="${n.id}" style="left:${n.x}px;top:${n.y}px">
              <div class="g-node-head">
                <span class="g-node-title">💬 پیام کاربر</span>
              </div>
              <div class="g-node-body">ورودی چت و تصاویر</div>
              <button type="button" class="port port-out" data-port-out="${n.id}" title="کشیدن یا کلیک برای اتصال خروجی" aria-label="پورت خروجی پیام کاربر"></button>
            </div>`;
        }
        if (n.type === 'policy') {
          const curPol = n.policy || combo.policy || 'fallback';
          return `
            <div class="g-node node-policy ${isSel ? 'selected' : ''}" data-node-id="${n.id}" style="left:${n.x}px;top:${n.y}px">
              <button type="button" class="port port-in" data-port-in="${n.id}" title="پورت ورودی" aria-label="پورت ورودی سیاست"></button>
              <div class="g-node-head">
                <span class="g-node-title">🔀 سیاست مسیریابی</span>
                <button type="button" class="node-del" data-del-node="${n.id}" title="حذف نود" aria-label="حذف نود سیاست">×</button>
              </div>
              <div class="g-node-body">
                <select class="node-policy-select" data-policy-node="${n.id}" aria-label="انتخاب سیاست مسیریابی">
                  ${Object.entries(ROUTING_POLICIES)
                    .map(([k, v]) => `<option value="${k}" ${k === curPol ? 'selected' : ''}>${v.labelFa}</option>`)
                    .join('')}
                </select>
              </div>
              <button type="button" class="port port-out" data-port-out="${n.id}" title="کشیدن یا کلیک برای اتصال به ارائه‌دهنده" aria-label="پورت خروجی سیاست"></button>
            </div>`;
        }

        const prov = store.state.providers.find((p) => p.id === n.providerId);
        const activeKeys = prov ? prov.keys.filter((k) => k.status === 'active').length : 0;
        const models = Array.isArray(prov?.models) ? [...prov.models] : [];
        const currentModel = n.model || prov?.defaultModel || models[0] || '';
        if (currentModel && !models.includes(currentModel)) {
          models.unshift(currentModel);
        }

        return `
          <div class="g-node node-provider ${isSel ? 'selected' : ''}" data-node-id="${n.id}" style="left:${n.x}px;top:${n.y}px">
            <button type="button" class="port port-in" data-port-in="${n.id}" title="پورت ورودی" aria-label="پورت ورودی ${escHtml(prov?.name || 'ارائه‌دهنده')}"></button>
            <div class="g-node-head">
              <span class="node-dot" style="background:${escHtml(prov?.color || '#6366f1')}"></span>
              <span class="g-node-title">${escHtml(prov?.name || 'حذف‌شده')}</span>
              <button type="button" class="node-del" data-del-node="${n.id}" title="حذف نود" aria-label="حذف نود ${escHtml(prov?.name || '')}">×</button>
            </div>
            <div class="g-node-body">
              <select class="node-model-select" data-model-node="${n.id}" dir="ltr" aria-label="انتخاب مدل نود" ${!models.length ? 'disabled' : ''}>
                ${
                  models.length
                    ? models
                        .map((m) => `<option value="${escHtml(m)}" ${m === currentModel ? 'selected' : ''}>${escHtml(m)}</option>`)
                        .join('')
                    : '<option value="">مدلی تعریف نشده</option>'
                }
              </select>
              <div class="node-keys-badge ${activeKeys > 0 ? 'ok' : 'warn'}">
                <span class="node-keys-dot" aria-hidden="true"></span>
                <span>${activeKeys} کلید فعال</span>
              </div>
            </div>
            <button type="button" class="port port-out" data-port-out="${n.id}" title="کشیدن یا کلیک برای زنجیره فالبک" aria-label="پورت خروجی ${escHtml(prov?.name || 'ارائه‌دهنده')}"></button>
          </div>`;
      })
      .join('');

    // Node dragging & selection
    nodesEl.querySelectorAll('.g-node').forEach((nodeEl) => {
      const nodeId = nodeEl.dataset.nodeId;
      const nodeObj = combo.nodes.find((x) => x.id === nodeId);

      nodeEl.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button, select, input')) return;
        e.stopPropagation();

        selectedNodeId = nodeId;
        selectedEdgeIdx = null;
        updateSelectionUI();
        canvasEl.focus({ preventScroll: true });

        const startX = e.clientX;
        const startY = e.clientY;
        const origX = nodeObj.x;
        const origY = nodeObj.y;
        nodeEl.setPointerCapture(e.pointerId);

        const onMove = (ev) => {
          nodeObj.x = Math.max(10, Math.round(origX + (ev.clientX - startX) / zoom));
          nodeObj.y = Math.max(10, Math.round(origY + (ev.clientY - startY) / zoom));
          nodeEl.style.left = `${nodeObj.x}px`;
          nodeEl.style.top = `${nodeObj.y}px`;
          drawEdges();
        };
        const onUp = () => {
          nodeEl.removeEventListener('pointermove', onMove);
          nodeEl.removeEventListener('pointerup', onUp);
          nodeEl.removeEventListener('pointercancel', onUp);
          store.save();
        };
        nodeEl.addEventListener('pointermove', onMove);
        nodeEl.addEventListener('pointerup', onUp);
        nodeEl.addEventListener('pointercancel', onUp);
      });
    });

    // Output port: supports BOTH drag-to-connect and click-to-connect
    nodesEl.querySelectorAll('[data-port-out]').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const fromId = btn.dataset.portOut;
        const startClientX = e.clientX;
        const startClientY = e.clientY;
        let dragged = false;

        linkingFromNodeId = fromId;
        nodesEl.querySelectorAll('.port-out').forEach((p) => p.classList.remove('linking'));
        btn.classList.add('linking');
        highlightCompatiblePorts(fromId);

        const onMove = (ev) => {
          if (Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) > 6) {
            dragged = true;
          }
          const pt = clientToStage(ev.clientX, ev.clientY);
          updatePreviewWire(fromId, pt.x, pt.y);
        };

        const onUp = (ev) => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);

          if (dragged) {
            const els = document.elementsFromPoint(ev.clientX, ev.clientY);
            const targetPort = els.find((el) => el.matches?.('[data-port-in]')) ||
              els.map((el) => el.closest?.('[data-port-in]')).find(Boolean);
            if (targetPort) {
              tryConnect(fromId, targetPort.dataset.portIn);
            }
            clearLinkingState();
          } else {
            // Short click: keep click-to-connect mode active
            onToast?.('حالا روی پورت ورودی (○) نود مقصد کلیک کنید');
          }
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      });
    });

    // Input port: click-to-connect target
    nodesEl.querySelectorAll('[data-port-in]').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!linkingFromNodeId) return;
        const toId = btn.dataset.portIn;
        tryConnect(linkingFromNodeId, toId);
        clearLinkingState();
      });
    });

    // Policy dropdown
    nodesEl.querySelectorAll('[data-policy-node]').forEach((sel) => {
      sel.addEventListener('pointerdown', (e) => e.stopPropagation());
      sel.addEventListener('mousedown', (e) => e.stopPropagation());
      sel.addEventListener('change', () => {
        const n = combo.nodes.find((x) => x.id === sel.dataset.policyNode);
        if (n) n.policy = sel.value;
        combo.policy = sel.value;
        store.save();
        onToast?.('سیاست مسیریابی ذخیره شد');
      });
    });

    // Per-node model selector
    nodesEl.querySelectorAll('[data-model-node]').forEach((sel) => {
      sel.addEventListener('pointerdown', (e) => e.stopPropagation());
      sel.addEventListener('mousedown', (e) => e.stopPropagation());
      sel.addEventListener('change', () => {
        const n = combo.nodes.find((x) => x.id === sel.dataset.modelNode);
        if (n) {
          n.model = sel.value;
          store.save();
          onToast?.(`مدل نود به ${sel.value} تغییر کرد`);
        }
      });
    });

    // Delete node buttons (stop pointerdown & mousedown so drag never swallows click)
    nodesEl.querySelectorAll('[data-del-node]').forEach((btn) => {
      const stopProp = (e) => e.stopPropagation();
      btn.addEventListener('pointerdown', stopProp);
      btn.addEventListener('mousedown', stopProp);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteNode(btn.dataset.delNode);
      });
    });

    requestAnimationFrame(drawEdges);
  }

  // Live preview wire during click-to-connect mode
  canvasEl.addEventListener('pointermove', (e) => {
    if (!linkingFromNodeId) return;
    const pt = clientToStage(e.clientX, e.clientY);
    updatePreviewWire(linkingFromNodeId, pt.x, pt.y);
  });

  // Canvas panning & click-empty-to-deselect / cancel linking
  canvasEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.g-node, .edge-del-btn, .wire-hit')) return;
    if (linkingFromNodeId) {
      clearLinkingState();
      return;
    }

    selectedNodeId = null;
    selectedEdgeIdx = null;
    updateSelectionUI();

    const startX = e.clientX;
    const startY = e.clientY;
    const origPanX = panX;
    const origPanY = panY;
    canvasEl.classList.add('panning');
    canvasEl.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      panX = origPanX + (ev.clientX - startX);
      panY = origPanY + (ev.clientY - startY);
      applyTransform();
    };
    const onUp = () => {
      canvasEl.classList.remove('panning');
      canvasEl.removeEventListener('pointermove', onMove);
      canvasEl.removeEventListener('pointerup', onUp);
      canvasEl.removeEventListener('pointercancel', onUp);
    };
    canvasEl.addEventListener('pointermove', onMove);
    canvasEl.addEventListener('pointerup', onUp);
    canvasEl.addEventListener('pointercancel', onUp);
  });

  // Ctrl/Cmd + Wheel zoom on canvas
  canvasEl.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      zoom = clamp(Math.round(zoom * factor * 100) / 100, 0.5, 1.6);
      applyTransform();
    },
    { passive: false }
  );

  // Keyboard shortcuts: Delete/Backspace for selected node or edge, Escape to cancel linking
  if (activeKeyHandler) {
    document.removeEventListener('keydown', activeKeyHandler);
  }
  activeKeyHandler = (e) => {
    if (!document.body.contains(canvasEl)) return;
    const viewEl = canvasEl.closest('.view');
    if (viewEl && !viewEl.classList.contains('active')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === 'Escape') {
      if (linkingFromNodeId) {
        clearLinkingState();
      } else if (selectedNodeId || selectedEdgeIdx !== null) {
        selectedNodeId = null;
        selectedEdgeIdx = null;
        updateSelectionUI();
      }
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedEdgeIdx !== null) {
        e.preventDefault();
        deleteEdge(selectedEdgeIdx);
      } else if (selectedNodeId) {
        const node = combo.nodes.find((n) => n.id === selectedNodeId);
        if (node && node.type !== 'start') {
          e.preventDefault();
          deleteNode(selectedNodeId);
        }
      }
    }
  };
  document.addEventListener('keydown', activeKeyHandler);

  // Auto-layout: Start -> Policy -> Provider columns (handles chained providers cleanly)
  function autoLayout() {
    const starts = combo.nodes.filter((n) => n.type === 'start');
    const policies = combo.nodes.filter((n) => n.type === 'policy');
    const providers = combo.nodes.filter((n) => n.type === 'provider');

    const colMap = new Map();
    starts.forEach((n) => colMap.set(n.id, 0));
    policies.forEach((n) => colMap.set(n.id, 1));

    // Compute depth for provider nodes based on incoming edges
    const visited = new Set();
    const queue = [];
    policies.forEach((p) => queue.push({ id: p.id, col: 1 }));
    if (!policies.length) starts.forEach((s) => queue.push({ id: s.id, col: 0 }));

    while (queue.length) {
      const { id, col } = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      const outgoing = combo.edges.filter((e) => e.from === id);
      for (const ed of outgoing) {
        const target = combo.nodes.find((n) => n.id === ed.to);
        if (!target || target.type !== 'provider') continue;
        const nextCol = Math.max(2, col + 1);
        const prev = colMap.get(target.id);
        if (prev === undefined || nextCol > prev) {
          colMap.set(target.id, nextCol);
        }
        queue.push({ id: target.id, col: nextCol });
      }
    }
    providers.forEach((p) => {
      if (!colMap.has(p.id)) colMap.set(p.id, 2);
    });

    const columns = new Map();
    for (const n of combo.nodes) {
      const col = colMap.get(n.id) ?? 2;
      if (!columns.has(col)) columns.set(col, []);
      columns.get(col).push(n);
    }

    const colWidth = 285;
    const rowHeight = 148;
    const startX = 40;
    const maxRows = Math.max(1, ...Array.from(columns.values()).map((arr) => arr.length));
    const totalHeight = maxRows * rowHeight;

    for (const [col, list] of columns.entries()) {
      const colHeight = list.length * rowHeight;
      const offsetY = Math.max(40, Math.round((totalHeight - colHeight) / 2) + 40);
      list.forEach((n, idx) => {
        n.x = startX + col * colWidth;
        n.y = offsetY + idx * rowHeight;
      });
    }

    zoom = 1;
    panX = 0;
    panY = 0;
    applyTransform();
    store.save();
    renderNodes();
    drawEdges();
    onToast?.('چیدمان خودکار اعمال شد');
  }

  applyTransform();
  renderNodes();

  // Toolbar events
  container.querySelector('#combo-select')?.addEventListener('change', (e) => {
    selectedComboId = e.target.value;
    selectedNodeId = null;
    selectedEdgeIdx = null;
    renderComboGraph(container, { onToast, onActivateCombo });
  });

  container.querySelector('#btn-rename-combo')?.addEventListener('click', () => {
    const nextName = prompt('نام جدید کمبو:', combo.name);
    if (!nextName || !nextName.trim()) return;
    combo.name = nextName.trim();
    store.save();
    renderComboGraph(container, { onToast, onActivateCombo });
    onToast?.('نام کمبو تغییر کرد');
  });

  container.querySelector('#btn-new-combo')?.addEventListener('click', () => {
    const name = prompt('نام کمبوی جدید:', `Combo ${store.state.combos.length + 1}`);
    if (!name) return;
    const c = store.createCombo(name.trim());
    selectedComboId = c.id;
    selectedNodeId = null;
    selectedEdgeIdx = null;
    renderComboGraph(container, { onToast, onActivateCombo });
  });

  container.querySelector('#btn-del-combo')?.addEventListener('click', () => {
    if (store.state.combos.length <= 1) return;
    store.deleteCombo(combo.id);
    selectedComboId = store.state.combos[0]?.id;
    selectedNodeId = null;
    selectedEdgeIdx = null;
    renderComboGraph(container, { onToast, onActivateCombo });
  });

  container.querySelector('#btn-zoom-in')?.addEventListener('click', () => {
    zoom = clamp(Math.round((zoom + 0.1) * 100) / 100, 0.5, 1.6);
    applyTransform();
  });

  container.querySelector('#btn-zoom-out')?.addEventListener('click', () => {
    zoom = clamp(Math.round((zoom - 0.1) * 100) / 100, 0.5, 1.6);
    applyTransform();
  });

  container.querySelector('#btn-zoom-reset')?.addEventListener('click', () => {
    zoom = 1;
    panX = 0;
    panY = 0;
    applyTransform();
  });

  container.querySelector('#btn-auto-layout')?.addEventListener('click', autoLayout);

  container.querySelector('#btn-add-node')?.addEventListener('click', () => {
    const provId = container.querySelector('#add-node-prov').value;
    const prov = store.state.providers.find((p) => p.id === provId);
    const count = combo.nodes.filter((n) => n.type === 'provider').length;
    const newNode = {
      id: store.uid('n'),
      type: 'provider',
      x: 610 + (count % 2) * 30,
      y: 48 + count * 145,
      providerId: provId,
      model: prov?.defaultModel || prov?.models?.[0] || '',
    };
    combo.nodes.push(newNode);
    const policyNode = combo.nodes.find((n) => n.type === 'policy');
    if (policyNode) combo.edges.push({ from: policyNode.id, to: newNode.id });
    store.save();
    renderNodes();
    drawEdges();
  });

  container.querySelector('#btn-activate-combo')?.addEventListener('click', () => {
    onActivateCombo?.(combo.id);
    renderComboGraph(container, { onToast, onActivateCombo });
  });
}
