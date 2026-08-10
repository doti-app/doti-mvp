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

/** @param {unknown} value */
function normalizedStepName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** @param {any} step */
function isAdjustmentStep(step) {
  return /\bajustes?\b/.test(normalizedStepName(step?.name));
}

/**
 * A rejected client approval can send the work to an immediately following
 * “Ajustes” stage. Once that work is complete, it must be submitted for a new
 * client decision instead of continuing to the final-delivery stage.
 *
 * @param {any} deliverable
 * @param {any[]} [groups]
 */
export function requiresClientReapprovalAfterCurrentStep(deliverable, groups = []) {
  const currentIndex = Number(deliverable?.stepIndex);
  const steps = deliverable?.steps || [];
  if (!Number.isInteger(currentIndex) || currentIndex < 1 || !isAdjustmentStep(steps[currentIndex])) return false;

  const approvalStep = steps[currentIndex - 1];
  if (!isClientActionStep(approvalStep, groups)) return false;

  const latestDecision = [...(deliverable?.approvalDecisions || [])]
    .filter(decision => decision?.stepId === approvalStep.id)
    .sort((left, right) => String(right?.decidedAt || '').localeCompare(String(left?.decidedAt || '')))[0];

  return latestDecision?.decision === 'rejected'
    && Number(latestDecision?.fromStepPosition) === currentIndex - 1
    && Number(latestDecision?.toStepPosition) === currentIndex;
}

/**
 * Returns the next stage after completing the current stage. Adjustments that
 * came from a client rejection return to the protected client-approval stage.
 *
 * @param {any} deliverable
 * @param {any[]} [groups]
 */
export function nextStepIndexAfterCompletion(deliverable, groups = []) {
  return requiresClientReapprovalAfterCurrentStep(deliverable, groups)
    ? Number(deliverable.stepIndex) - 1
    : Number(deliverable.stepIndex) + 1;
}

/**
 * Manual moves may withdraw work from a pending client approval so unfinished
 * material is no longer visible to the client. They can never enter or pass
 * the audited customer approval stage.
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
  if (isClientActionStep(steps[targetIndex], groups)) return false;
  if (isClientActionStep(steps[currentIndex], groups)) return targetIndex < currentIndex;
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
