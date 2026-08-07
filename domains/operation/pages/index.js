// @ts-check

import { createClientsPage } from './clients.js';
import { createDashboardPage } from './dashboard.js';
import { createDemandsPage } from './demands.js';
import { createVirgulinhaDomain } from './virgulinha.js';
import { createWorkflowsPage } from './workflows.js';

/** @param {{ dashboard: () => void, demands: () => void, workflows: () => void, clients: () => void, virgulinha: () => void }} renderers */
export function createOperationPages(renderers) {
  const pages = new Map([
    ['dashboard', createDashboardPage(renderers.dashboard)],
    ['demandas', createDemandsPage(renderers.demands)],
    ['fluxos', createWorkflowsPage(renderers.workflows)],
    ['clientes', createClientsPage(renderers.clients)],
    ['virgulinha', createVirgulinhaDomain(renderers.virgulinha)]
  ]);
  let activeId = '';
  return {
    /** @param {string} id */
    show(id) {
      if (activeId && activeId !== id) pages.get(activeId)?.unmount();
      activeId = id;
      pages.get(id)?.render();
    },
    renderAll() {
      pages.forEach(page => page.render());
    },
    ids: () => [...pages.keys()]
  };
}
