// @ts-check

/** @param {any} deliverable */
export function currentStep(deliverable) {
  return deliverable.steps[deliverable.stepIndex] || deliverable.steps.at(-1);
}

/** @param {any} deliverable */
export function stepDeadlinesFromCurrent(deliverable) {
  return deliverable.steps
    .map(/** @param {any} step @param {number} index */ (step, index) => ({ step, index, due: step.due || '' }))
    .filter(/** @param {{ index: number, due: string }} item */ item => item.index >= deliverable.stepIndex && item.due);
}

/** @param {any} deliverable */
export function nextStepDeadline(deliverable) {
  const deadlines = stepDeadlinesFromCurrent(deliverable);
  const currentDeadline = deadlines.find(/** @param {{ index: number }} item */ item => item.index === deliverable.stepIndex);
  return currentDeadline || deadlines.sort(/** @param {{ due: string }} a @param {{ due: string }} b */ (a, b) => a.due.localeCompare(b.due))[0] || null;
}

/** @param {any} deliverable @param {(id: string) => any} projectById */
export function effectiveDeadline(deliverable, projectById) {
  const milestone = nextStepDeadline(deliverable);
  if (milestone) return { due: milestone.due, source: 'step', label: milestone.step.name };
  const project = projectById(deliverable.projectId);
  const due = deliverable.due || project?.due || '';
  return due ? { due, source: 'project', label: 'Prazo geral' } : null;
}

/** @param {string} value @param {Date} [today] */
export function dateIsPast(value, today = new Date()) {
  return Boolean(value) && new Date(`${value}T23:59:59`) < today;
}

/** @param {any} project @param {any} deliverable @param {Date} [today] */
export function overdueDeadline(project, deliverable, today = new Date()) {
  if (deliverable.status === 'done') return null;
  const overdueStep = stepDeadlinesFromCurrent(deliverable).find(/** @param {{ due: string }} item */ item => dateIsPast(item.due, today));
  if (overdueStep) return { kind: 'step', due: overdueStep.due, label: overdueStep.step.name };
  const due = deliverable.due || project?.due;
  return dateIsPast(due, today) ? { kind: 'project', due, label: 'Prazo do entregável' } : null;
}

/** @param {any} step @param {any[]} [groups] */
export function isClientActionStep(step, groups = []) {
  return step?.groupId === 'g-cliente'
    || groups.some(group => group.id === step?.groupId && group.isClientGroup === true);
}

/**
 * Manual moves are useful for correcting a card's position, but can never
 * bypass the audited customer approval stage.
 * @param {any} deliverable
 * @param {number} targetIndex
 * @param {any[]} [groups]
 */
export function canMoveDeliverableToStep(deliverable, targetIndex, groups = []) {
  const currentIndex = Number(deliverable?.stepIndex);
  const steps = deliverable?.steps || [];
  if (!Number.isInteger(currentIndex)
    || !Number.isInteger(targetIndex)
    || targetIndex < 0
    || targetIndex >= steps.length
    || targetIndex === currentIndex) return false;
  if (isClientActionStep(steps[currentIndex], groups) || isClientActionStep(steps[targetIndex], groups)) return false;
  return targetIndex < currentIndex
    || !steps.slice(currentIndex + 1, targetIndex + 1).some(step => isClientActionStep(step, groups));
}

/** @param {any} deliverable @param {any[]} [groups] */
export function macroStatus(deliverable, groups = []) {
  if (deliverable.status === 'done') return 'done';
  const step = currentStep(deliverable);
  if (/aprovação|apresentação|revisão interna/i.test(step.name) || isClientActionStep(step, groups) || step.groupId === 'g-coordenacao') return 'approval';
  return deliverable.stepIndex <= 1 ? 'planning' : 'production';
}

/** @param {any} left @param {any} right @param {(deliverable: any) => any} deadlineFor */
export function compareDeliverablesByDate(left, right, deadlineFor) {
  const leftDeadline = deadlineFor(left);
  const rightDeadline = deadlineFor(right);
  if (leftDeadline && rightDeadline && leftDeadline.due !== rightDeadline.due) return leftDeadline.due.localeCompare(rightDeadline.due);
  if (leftDeadline && !rightDeadline) return -1;
  if (!leftDeadline && rightDeadline) return 1;
  return String(left.createdAt || left.id).localeCompare(String(right.createdAt || right.id));
}
