import assert from 'node:assert/strict';
import test from 'node:test';

class FakeNode {
  constructor() {
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.style = { setProperty(name, value) { this[name] = value; } };
  }
  append(...children) {
    children.forEach(child => {
      child.parentNode = this;
      this.children.push(child);
    });
  }
  appendChild(child) {
    this.append(child);
    return child;
  }
  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  querySelector(selector) {
    const match = node => {
      if (selector.startsWith('.')) return node.className.split(/\s+/).includes(selector.slice(1));
      if (selector === 'input:not([type="checkbox"])') return node.tagName === 'INPUT' && node.attributes.get('type') !== 'checkbox';
      return node.tagName === selector.toUpperCase();
    };
    for (const child of this.children) {
      if (match(child)) return child;
      const nested = child.querySelector?.(selector);
      if (nested) return nested;
    }
    return null;
  }
}

class FakeElement extends FakeNode {
  constructor(tagName) {
    super();
    this.tagName = tagName.toUpperCase();
  }
  focus() { this.focused = true; }
}

class FakeText extends FakeNode {
  constructor(value) {
    super();
    this.textContent = value;
  }
}

globalThis.Node = FakeNode;
const elementsById = new Map();
globalThis.document = {
  body: new FakeElement('body'),
  createElement: tagName => new FakeElement(tagName),
  createTextNode: value => new FakeText(value),
  getElementById: id => elementsById.get(id) || null
};

const { element } = await import('../core/dom.js');
const { createModalService } = await import('../core/modal-service.js');
const { renderDashboardView } = await import('../domains/operation/pages/dashboard-view.js');

test('constrói elementos com texto literal, sem interpretar HTML fornecido', () => {
  const unsafe = '<img src=x onerror=alert(1)>';
  const node = element('section', { className: 'panel' }, unsafe);
  assert.equal(node.className, 'panel');
  assert.equal(node.children[0].textContent, unsafe);
  assert.equal(Object.hasOwn(node, 'innerHTML'), false);
});

test('modal seguro usa nós DOM para título, conteúdo, confirmação e fechamento', () => {
  const root = new FakeElement('main');
  let submitted = 0;
  const service = createModalService({ root });
  const result = service.open({
    title: '<script>não executar</script>',
    body: element('p', { text: 'Conteúdo literal' }),
    onSubmit: () => { submitted += 1; }
  });
  assert.equal(root.querySelector('.doti-modal'), result.modal);
  assert.equal(result.form.children[0].children[0].textContent, '<script>não executar</script>');
  result.form.listeners.get('submit')({ preventDefault() {} });
  assert.equal(submitted, 1);
  assert.equal(root.querySelector('.doti-modal'), null);

  const confirm = service.confirm({ title: 'Excluir?', message: '<b>texto</b>', onConfirm() { submitted += 1; } });
  assert.equal(confirm.children[0].children[2].textContent, '<b>texto</b>');
  confirm.children[0].children[3].children[1].listeners.get('click')();
  assert.equal(submitted, 2);
});

test('dashboard renderiza dados dinâmicos por nós DOM seguros', () => {
  ['todayLabel', 'dashboardHeadline', 'dashboardMetrics', 'attentionList', 'attentionSubtitle', 'recentProjects']
    .forEach(id => elementsById.set(id, new FakeElement('div')));
  const project = { id: 'p-1', client: '<cliente>', name: '<projeto>', due: '2026-08-20', updatedAt: '2026-08-06T12:00:00.000Z' };
  renderDashboardView({
    state: { projects: [project], deliverables: [], clients: [] },
    projectById: () => project,
    clientForProject: () => ({ color: '#ffd400' }),
    currentStep: () => ({ name: 'Aprovação', groupId: 'g-cliente' }),
    overdueDeadline: () => null,
    macroStatus: () => 'approval',
    formatDate: value => value || 'Sem prazo',
    metricHint: () => 'Atualizado agora',
    initials: () => 'CP'
  });
  assert.equal(elementsById.get('dashboardMetrics').children.length, 4);
  const row = elementsById.get('recentProjects').children[0];
  assert.equal(row.children[1].children[0].textContent, '<cliente>');
  assert.equal(row.children[1].children[1].textContent, '<projeto>');
});
