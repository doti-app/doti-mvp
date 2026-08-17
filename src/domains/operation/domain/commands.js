// @ts-check

/** @param {any} state @param {string} action @param {string} detail @param {() => string} createId @param {() => string} now */
export function recordActivity(state, action, detail, createId, now) {
  state.activity.unshift({ id: createId(), action, detail, at: now() });
  state.activity = state.activity.slice(0, 50);
  return state;
}

/**
 * Applies an edited workflow to every active demand that was created from it.
 * Existing demand-step IDs are preserved so approvals and attachments keep
 * their references. Content from a removed step moves to the nearest survivor.
 * Completed demands remain an immutable historical snapshot.
 * @param {any} state
 * @param {any} workflow
 * @param {() => string} createId
 * @param {() => string} now
 */
export function synchronizeActiveDeliverables(state, workflow, createId, now) {
  const deliverables = state.deliverables.filter(item => item.workflowId === workflow.id && item.status !== 'done');
  const newStepIds = new Set(workflow.steps.map(step => step[2]));

  deliverables.forEach(deliverable => {
    const oldSteps = deliverable.steps;
    const currentSourceStepId = oldSteps[deliverable.stepIndex]?.sourceStepId;
    const existingBySource = new Map(oldSteps.map(step => [step.sourceStepId, step]));
    const removedSteps = oldSteps.filter(step => !newStepIds.has(step.sourceStepId));
    const syncedSteps = workflow.steps.map(([name, groupId, sourceStepId]) => {
      const existing = existingBySource.get(sourceStepId);
      return existing
        ? { ...existing, sourceStepId, name, groupId }
        : { id: createId(), sourceStepId, name, groupId, due: '', tasks: [], note: '' };
    });

    removedSteps.forEach(removedStep => {
      if (!syncedSteps.length) return;
      const oldIndex = oldSteps.indexOf(removedStep);
      const target = syncedSteps[Math.min(oldIndex, syncedSteps.length - 1)];
      const existingTaskIds = new Set(target.tasks.map(task => task.id));
      target.tasks.push(...removedStep.tasks.filter(task => !existingTaskIds.has(task.id)));
      if (removedStep.note) target.note = [target.note, `[Migrado de ${removedStep.name}] ${removedStep.note}`].filter(Boolean).join('\n');
      if (!target.due && removedStep.due) target.due = removedStep.due;
    });

    let nextCurrentIndex = syncedSteps.findIndex(step => step.sourceStepId === currentSourceStepId);
    if (nextCurrentIndex < 0) nextCurrentIndex = Math.min(deliverable.stepIndex, syncedSteps.length - 1);
    deliverable.steps = syncedSteps;
    deliverable.stepIndex = Math.max(0, nextCurrentIndex);
    const project = state.projects.find(item => item.id === deliverable.projectId);
    if (project) project.updatedAt = now();
  });

  return deliverables.length;
}
