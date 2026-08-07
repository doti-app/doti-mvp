// @ts-check
import { createOperationPage } from './page.js';
/** @param {() => void} render */
export const createWorkflowsPage = render => createOperationPage('fluxos', render);
