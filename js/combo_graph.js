/**
 * Visual Node-Based Combo Builder (SVG Bezier Wires + Draggable Nodes).
 * Connect: [User Prompt] ──▶ [Routing Policy] ──▶ [Provider A] ──▶ [Provider B]
 */

import { store, ROUTING_POLICIES } from './store.js';
import { escHtml } from './markdown.js';

let selectedComboId = null;
let linkingFromNodeId = null;

export function renderComboGraph(container, { onToast, onActivateCombo }) {
  if (!store.state.combos.length) store.createCombo('Smart Default');
  let combo = store.state.combos.find((c) => c.id === selectedComboId) || store.state.combos[0];
  selectedComboId = combo.id;

  const isActive =
    store.state.activeTarget?.type === 'combo' && store.state.activeTarget?.id === combo.id;

  container.innerHTML = `
    <div class="graph-toolbar">
      <div class="graph-left">
        <select id="combo-select" class="graph-select">
          ${store.state.combos
            .map((c) => `<option value="${c.id}" ${c.id === combo.id ? 'selected' : ''}>🔀 ${escHtml(c.name)}</option>`)
            .join('')}
        </select>
        <button class="btn btn-sm btn-ghost" id="btn-new-combo">+ کمبو جدید</button>
        <button class="btn btn-sm btn-danger" id="btn-del-combo" ${store.state.combos.length <= 1 ? 'disabled' : ''}>حذف</button>
      </div>
      <div class="graph-right">
        <select id="add-node-prov" class="graph-select">
          ${store.state.providers.map((p) => `<option value="${p.id}">${escHtml(p.name)} (${p.keys.length} کلید)</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-ghost" id="btn-add-node">+ افزودن نود</button>
        <button class="btn btn-sm ${isActive ? 'btn-ok' : 'btn-amber'}" id="btn-activate-combo">
          ${isActive ? '✅ کمبوی فعال' : '⚡ فعال‌سازی در چت'}
        </button>
      </div>
    </div>

    <div class="graph-hint">
      💡 نودها را با ماوس جابه‌جا کنید. برای اتصال، روی <b>پورت خروجی (●)</b> یک نود کلیک کنید و سپس روی <b>پورت ورودی (○)</b> نود مقصد بزنید. برای حذف اتصال روی خط کلیک کنید.
    </div>

    <div class="graph-canvas" id="graph-canvas" dir="ltr">
      <svg class="graph-svg" id="graph-svg"></svg>
      <div class="graph-nodes" id="graph-nodes"></div>
    </div>
  `;

  const canvasEl = container.querySelector('#graph-canvas');
  const svgEl = container.querySelector('#graph-svg');
  const nodesEl = container.querySelector('#graph-nodes');

  function drawEdges() {
    const paths = [];
    for (let i = 0; i < combo.edges.length; i++) {
      const edge = combo.edges[i];
      const fromEl = nodesEl.querySelector(`[data-node-id="${edge.from}"] .port-out`);
      const toEl = nodesEl.querySelector(`[data-node-id="${edge.to}"] .port-in`);
      if (!fromEl || !toEl) continue;

      const cRect = canvasEl.getBoundingClientRect();
      const fRect = fromEl.getBoundingClientRect();
      const tRect = toEl.getBoundingClientRect();

      const x1 = fRect.left - cRect.left + fRect.width / 2;
      const y1 = fRect.top - cRect.top + fRect.height / 2;
      const x2 = tRect.left - cRect.left + tRect.width / 2;
      const y2 = tRect.top - cRect.top + tRect.height / 2;
      const dx = Math.max(50, Math.abs(x2 - x1) * 0.5);

      const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
      paths.push(
        `<path class="wire-hit" data-edge-idx="${i}" d="${d}" />` +
        `<path class="wire" d="${d}" />`
      );
    }
    svgEl.innerHTML = paths.join('');

    svgEl.querySelectorAll('.wire-hit').forEach((p) => {
      p.addEventListener('click', () => {
        const idx = Number(p.dataset.edgeIdx);
        combo.edges.splice(idx, 1);
        store.save();
        drawEdges();
        onToast('اتصال حذف شد');
      });
    });
  }

  function renderNodes() {
    nodesEl.innerHTML = combo.nodes
      .map((n) => {
        if (n.type === 'start') {
          return `
            <div class="g-node node-start" data-node-id="${n.id}" style="left:${n.x}px;top:${n.y}px">
              <div class="g-node-head">💬 پیام کاربر</div>
              <div class="g-node-body">ورودی چت و تصاویر</div>
              <button class="port port-out" data-port-out="${n.id}" title="اتصال خروجی"></button>
            </div>`;
        }
        if (n.type === 'policy') {
          const curPol = n.policy || combo.policy || 'fallback';
          return `
            <div class="g-node node-policy" data-node-id="${n.id}" style="left:${n.x}px;top:${n.y}px">
              <button class="port port-in" data-port-in="${n.id}" title="ورودی"></button>
              <div class="g-node-head">🔀 سیاست مسیریابی</div>
              <div class="g-node-body">
                <select class="node-policy-select" data-policy-node="${n.id}">
                  ${Object.entries(ROUTING_POLICIES)
                    .map(([k, v]) => `<option value="${k}" ${k === curPol ? 'selected' : ''}>${v.labelFa}</option>`)
                    .join('')}
                </select>
              </div>
              <button class="port port-out" data-port-out="${n.id}" title="اتصال به ارائه‌دهنده"></button>
            </div>`;
        }
        const prov = store.state.providers.find((p) => p.id === n.providerId);
        const activeKeys = prov ? prov.keys.filter((k) => k.status === 'active').length : 0;
        return `
          <div class="g-node node-provider" data-node-id="${n.id}" style="left:${n.x}px;top:${n.y}px">
            <button class="port port-in" data-port-in="${n.id}" title="ورودی"></button>
            <div class="g-node-head">
              <span class="node-dot" style="background:${escHtml(prov?.color || '#6366f1')}"></span>
              <span>${escHtml(prov?.name || 'حذف‌شده')}</span>
              <button class="node-del" data-del-node="${n.id}" title="حذف نود">×</button>
            </div>
            <div class="g-node-body">
              <div class="node-model">${escHtml(prov?.defaultModel || '—')}</div>
              <div class="node-keys ${activeKeys > 0 ? 'ok' : 'warn'}">${activeKeys} کلید فعال</div>
            </div>
            <button class="port port-out" data-port-out="${n.id}" title="زنجیره فالبک به بعدی"></button>
          </div>`;
      })
      .join('');

    // Dragging
    nodesEl.querySelectorAll('.g-node').forEach((nodeEl) => {
      const nodeId = nodeEl.dataset.nodeId;
      const nodeObj = combo.nodes.find((x) => x.id === nodeId);

      nodeEl.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button, select, input')) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const origX = nodeObj.x;
        const origY = nodeObj.y;
        nodeEl.setPointerCapture(e.pointerId);

        const onMove = (ev) => {
          nodeObj.x = Math.max(10, origX + (ev.clientX - startX));
          nodeObj.y = Math.max(10, origY + (ev.clientY - startY));
          nodeEl.style.left = `${nodeObj.x}px`;
          nodeEl.style.top = `${nodeObj.y}px`;
          drawEdges();
        };
        const onUp = () => {
          nodeEl.removeEventListener('pointermove', onMove);
          nodeEl.removeEventListener('pointerup', onUp);
          store.save();
        };
        nodeEl.addEventListener('pointermove', onMove);
        nodeEl.addEventListener('pointerup', onUp);
      });
    });

    // Port linking
    nodesEl.querySelectorAll('[data-port-out]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        linkingFromNodeId = btn.dataset.portOut;
        nodesEl.querySelectorAll('.port-out').forEach((p) => p.classList.remove('linking'));
        btn.classList.add('linking');
        onToast('حالا روی پورت ورودی (○) نود مقصد کلیک کنید');
      });
    });

    nodesEl.querySelectorAll('[data-port-in]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const toId = btn.dataset.portIn;
        if (!linkingFromNodeId || linkingFromNodeId === toId) return;
        const exists = combo.edges.some((ed) => ed.from === linkingFromNodeId && ed.to === toId);
        if (!exists) {
          combo.edges.push({ from: linkingFromNodeId, to: toId });
          store.save();
          drawEdges();
          onToast('اتصال برقرار شد');
        }
        linkingFromNodeId = null;
        nodesEl.querySelectorAll('.port-out').forEach((p) => p.classList.remove('linking'));
      });
    });

    // Policy dropdown
    nodesEl.querySelectorAll('[data-policy-node]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const n = combo.nodes.find((x) => x.id === sel.dataset.policyNode);
        if (n) n.policy = sel.value;
        combo.policy = sel.value;
        store.save();
        onToast('سیاست مسیریابی ذخیره شد');
      });
    });

    // Delete provider node
    nodesEl.querySelectorAll('[data-del-node]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.delNode;
        combo.nodes = combo.nodes.filter((n) => n.id !== id);
        combo.edges = combo.edges.filter((e) => e.from !== id && e.to !== id);
        store.save();
        renderNodes();
        drawEdges();
      });
    });

    requestAnimationFrame(drawEdges);
  }

  renderNodes();

  // Toolbar events
  container.querySelector('#combo-select')?.addEventListener('change', (e) => {
    selectedComboId = e.target.value;
    renderComboGraph(container, { onToast, onActivateCombo });
  });

  container.querySelector('#btn-new-combo')?.addEventListener('click', () => {
    const name = prompt('نام کمبوی جدید:', `Combo ${store.state.combos.length + 1}`);
    if (!name) return;
    const c = store.createCombo(name.trim());
    selectedComboId = c.id;
    renderComboGraph(container, { onToast, onActivateCombo });
  });

  container.querySelector('#btn-del-combo')?.addEventListener('click', () => {
    if (store.state.combos.length <= 1) return;
    store.deleteCombo(combo.id);
    selectedComboId = store.state.combos[0]?.id;
    renderComboGraph(container, { onToast, onActivateCombo });
  });

  container.querySelector('#btn-add-node')?.addEventListener('click', () => {
    const provId = container.querySelector('#add-node-prov').value;
    const count = combo.nodes.filter((n) => n.type === 'provider').length;
    const newNode = {
      id: store.uid('n'),
      type: 'provider',
      x: 560 + (count % 2) * 40,
      y: 60 + count * 110,
      providerId: provId,
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
