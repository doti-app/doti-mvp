// @ts-check

import { append, element, replaceChildren } from '../../../shared/dom.js';
import { createMetricIcon } from './metric-icons.js';

/**
 * Safe renderer for the dashboard. All user-controlled values are assigned to
 * textContent or style properties, never interpolated into an HTML string.
 * @param {{
 *   state: any,
 *   projectById: (id: string) => any,
 *   clientForProject: (project: any) => any,
 *   currentStep: (deliverable: any) => any,
 *   overdueDeadline: (project: any, deliverable: any) => any,
 *   macroStatus: (deliverable: any) => string,
 *   formatDate: (value: string) => string,
 *   metricHint: (label: string, value: number) => string,
 *   initials: (value: string) => string
 * }} context
 */
export function renderDashboardView(context) {
  const { state } = context;
  const today = new Date();
  const active = state.deliverables.filter(item => item.status !== 'done');
  const approvals = active.filter(item => context.macroStatus(item) === 'approval');
  const overdue = active.map(item => ({ item, deadline: context.overdueDeadline(context.projectById(item.projectId), item) })).filter(entry => entry.deadline);
  const completed = state.deliverables.filter(item => item.status === 'done');
  const headline = document.getElementById('dashboardHeadline');
  const metrics = document.getElementById('dashboardMetrics');
  const attentionList = document.getElementById('attentionList');
  const attentionSubtitle = document.getElementById('attentionSubtitle');
  const recent = document.getElementById('recentProjects');

  document.getElementById('todayLabel').textContent = today
    .toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
    .toUpperCase();
  headline.textContent = active.length
    ? `${active.length} ${active.length === 1 ? 'entregável está em andamento' : 'entregáveis estão em andamento'}.`
    : 'Nenhuma demanda cadastrada. Crie seu primeiro projeto para começar.';

  const metricData = [
    [createMetricIcon('projects'), state.projects.length, 'Projetos', 'yellow'],
    [createMetricIcon('active'), active.length, 'Em andamento', 'blue'],
    [createMetricIcon('approval'), approvals.length, 'Em aprovação', 'violet'],
    ['✓', completed.length, 'Concluídos', 'green']
  ];
  replaceChildren(metrics, ...metricData.map(([icon, value, label, color]) => {
    const iconNode = element('span', { className: `metric-icon ${color}` });
    append(iconNode, icon);
    const copy = element('div');
    append(copy,
      element('small', { text: String(label) }),
      element('strong', { text: String(value) }),
      element('em', { text: context.metricHint(String(label), Number(value)) })
    );
    return element('article', {}, iconNode, copy);
  }));

  const attention = [
    ...overdue.map(({ item, deadline }) => ({ item, type: 'Atrasado', className: 'danger', detail: `${deadline.label} · ${context.formatDate(deadline.due)}` })),
    ...approvals.filter(item => !overdue.some(entry => entry.item.id === item.id)).map(item => ({ item, type: 'Aprovação', className: 'warning', detail: context.currentStep(item).name }))
  ];
  attentionSubtitle.textContent = attention.length
    ? `${attention.length} ${attention.length === 1 ? 'item encontrado' : 'itens encontrados'}`
    : 'Nenhuma pendência no momento';
  if (!attention.length) {
    replaceChildren(attentionList, emptyState(
      'Tudo em ordem',
      state.projects.length ? 'Não há prazos vencidos nem aprovações pendentes.' : 'As pendências aparecerão aqui quando você iniciar um projeto.',
      '✓'
    ));
  } else {
    replaceChildren(attentionList, ...attention.slice(0, 6).map(entry => {
      const project = context.projectById(entry.item.projectId);
      const button = element('button', { className: 'attention-row', attributes: { type: 'button', 'data-open-deliverable': entry.item.id } });
      const copy = element('div');
      append(copy,
        element('strong', { text: entry.item.name }),
        element('small', { text: `${project?.client || ''} · ${entry.detail}` })
      );
      append(button,
        element('i', { className: entry.className }),
        copy,
        element('span', { text: `${entry.type} →` })
      );
      return button;
    }));
  }

  const projects = [...state.projects].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()).slice(0, 5);
  if (!projects.length) {
    const empty = emptyState('Nenhum projeto ainda', 'Crie um projeto e acompanhe o progresso por aqui.', '□');
    empty.append(element('button', { className: 'primary-btn', text: 'Criar primeiro projeto', attributes: { type: 'button', 'data-create-project': true } }));
    replaceChildren(recent, empty);
  } else {
    replaceChildren(recent, ...projects.map(project => projectRow(project, context)));
  }
}

/** @param {any} project @param {any} context */
function projectRow(project, context) {
  const deliverables = context.state.deliverables.filter(item => item.projectId === project.id);
  const client = context.clientForProject(project);
  const completed = deliverables.filter(item => item.status === 'done').length;
  const progress = deliverables.length ? Math.round(completed / deliverables.length * 100) : 0;
  const row = element('article', { className: 'project-row', attributes: { 'data-open-project': project.id } });
  const clientNode = element('div', { className: 'project-client' });
  clientNode.style.setProperty('--client-color', client?.color || '#fff0a3');
  clientNode.append(element('span', { text: context.initials(project.client) }));
  if (client?.logoId) clientNode.append(element('img', { attributes: { 'data-client-logo': client.logoId, alt: '', hidden: true } }));
  const main = element('div', { className: 'project-main' });
  append(main,
    element('small', { text: project.client }),
    element('strong', { text: project.name }),
    element('span', { text: `${deliverables.length} ${deliverables.length === 1 ? 'entregável' : 'entregáveis'} · prazo ${context.formatDate(project.due)}` })
  );
  const services = element('div', { className: 'project-services' });
  deliverables.forEach(deliverable => services.append(element('span', { className: `tag ${deliverable.color}`, text: deliverable.category })));
  const progressNode = element('div', { className: 'project-progress' });
  const bar = element('span');
  const fill = element('i');
  fill.style.width = `${progress}%`;
  bar.append(fill);
  append(progressNode, bar, element('b', { text: `${progress}%` }));
  append(row, clientNode, main, services, progressNode);
  return row;
}

/** @param {string} title @param {string} message @param {string} icon */
function emptyState(title, message, icon) {
  return element('div', { className: 'empty-state' },
    element('span', { text: icon }),
    element('strong', { text: title }),
    element('p', { text: message })
  );
}
