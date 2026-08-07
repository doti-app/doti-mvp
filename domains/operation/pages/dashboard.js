// @ts-check
import { createOperationPage } from './page.js';
/** @param {() => void} render */
export const createDashboardPage = render => createOperationPage('dashboard', render);
