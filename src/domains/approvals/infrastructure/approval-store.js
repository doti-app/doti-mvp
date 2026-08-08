const LOCAL_OPERATION_KEY = 'doti-agency-live-v4';

/** @param {unknown} value */
function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function readLocalState() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_OPERATION_KEY) || 'null');
  } catch (_) {
    return null;
  }
}

/** @param {any} state */
function localClientGroupIds(state) {
  return new Set((state?.groups || [])
    .filter(group => group.isClientGroup === true
      || group.id === 'g-cliente'
      || normalized(group.name) === 'cliente / atendimento')
    .map(group => group.id));
}

/** @param {any} step */
function isAdjustmentStep(step) {
  return /\bajustes?\b/.test(normalized(step?.name));
}

/** @param {any} state @param {any} auth */
function localQueue(state, auth) {
  const clientGroupIds = localClientGroupIds(state);
  const projectsById = new Map((state?.projects || []).map(project => [project.id, project]));
  const clientsById = new Map((state?.clients || []).map(client => [client.id, client]));
  const isClient = auth.profile.role === 'client';
  const items = (state?.deliverables || [])
    .filter(deliverable => deliverable.status !== 'done')
    .map(deliverable => {
      const project = projectsById.get(deliverable.projectId);
      const client = clientsById.get(project?.clientId);
      const step = deliverable.steps?.[deliverable.stepIndex];
      if (!project || !client || !step || !clientGroupIds.has(step.groupId)) return null;
      if (isClient && project.clientId !== auth.profile.client_id) return null;
      return {
        id: deliverable.id,
        clientId: client.id,
        clientName: client.name,
        projectId: project.id,
        projectName: project.name,
        projectDue: project.due,
        deliverableId: deliverable.id,
        deliverableName: deliverable.name,
        category: deliverable.category,
        color: deliverable.color,
        stepId: step.id,
        stepName: step.name,
        stepPosition: deliverable.stepIndex,
        due: step.due || deliverable.due || project.due,
        note: step.note || deliverable.note || '',
        links: deliverable.links || [],
        attachments: deliverable.attachments || [],
        history: deliverable.approvalDecisions || []
      };
    })
    .filter(Boolean)
    .sort((left, right) => String(left.due || '9999').localeCompare(String(right.due || '9999')));
  return {
    items,
    role: auth.profile.role,
    canDecide: ['owner', 'admin', 'client'].includes(auth.profile.role)
  };
}

/** @param {any} error */
function requestError(error) {
  const message = error?.message || 'Não foi possível acessar as aprovações.';
  const result = new Error(message);
  result.code = error?.code || '';
  return result;
}

/** @param {any} auth */
export function createApprovalStore(auth) {
  return {
    async load() {
      if (auth.localMode) {
        return localQueue(readLocalState() || {}, auth);
      }
      const { data, error } = await auth.supabase.rpc('load_client_approval_queue');
      if (error) throw requestError(error);
      return data || { items: [], role: auth.profile.role, canDecide: false };
    },

    /** @param {{ deliverableId: string, stepId: string, decision: 'approved' | 'rejected', comment: string }} input */
    async decide(input) {
      if (!auth.localMode) {
        const { data, error } = await auth.supabase.rpc('submit_client_approval', {
          p_deliverable_id: input.deliverableId,
          p_step_id: input.stepId,
          p_decision: input.decision,
          p_comment: input.comment
        });
        if (error) throw requestError(error);
        return data;
      }

      const state = readLocalState();
      if (!state) throw new Error('A operação local ainda não foi inicializada.');
      if (!['owner', 'admin', 'client'].includes(auth.profile.role)) {
        throw new Error('Você não tem permissão para decidir esta aprovação.');
      }
      const deliverable = state.deliverables?.find(item => item.id === input.deliverableId);
      const project = state.projects?.find(item => item.id === deliverable?.projectId);
      const step = deliverable?.steps?.[deliverable.stepIndex];
      if (!deliverable || deliverable.status === 'done' || step?.id !== input.stepId) {
        throw new Error('Esta aprovação não está mais pendente. Atualize a página.');
      }
      if (auth.profile.role === 'client' && project?.clientId !== auth.profile.client_id) {
        throw new Error('Esta aprovação não pertence ao seu cliente.');
      }
      const comment = String(input.comment || '').trim();
      if (input.decision === 'rejected' && !comment) {
        throw new Error('Explique os ajustes necessários antes de reprovar.');
      }
      const nextStepIsAdjustment = isAdjustmentStep(deliverable.steps?.[deliverable.stepIndex + 1]);
      const target = input.decision === 'rejected'
        ? (nextStepIsAdjustment ? deliverable.stepIndex + 1 : deliverable.stepIndex - 1)
        : deliverable.stepIndex + 1 + (nextStepIsAdjustment ? 1 : 0);
      if (input.decision === 'rejected' && target < 0) {
        throw new Error('Não existe uma etapa anterior para receber os ajustes.');
      }
      deliverable.approvalDecisions ||= [];
      deliverable.approvalDecisions.unshift({
        id: crypto.randomUUID(),
        stepId: step.id,
        decision: input.decision,
        comment,
        fromStepPosition: deliverable.stepIndex,
        toStepPosition: target < deliverable.steps.length ? target : null,
        decidedBy: auth.profile.full_name,
        decidedByRole: auth.profile.role,
        decidedAt: new Date().toISOString()
      });
      if (input.decision === 'rejected') {
        deliverable.stepIndex = target;
        deliverable.status = 'active';
        const returnedStep = deliverable.steps[target];
        returnedStep.tasks ||= [];
        if (!returnedStep.tasks.some(task => !task.done && task.title === 'Aplicar ajustes solicitados na aprovação')) {
          returnedStep.tasks.push({
            id: crypto.randomUUID(),
            title: 'Aplicar ajustes solicitados na aprovação',
            done: false
          });
        }
        deliverable.note = [deliverable.note, `Ajustes solicitados:\n${comment}`].filter(Boolean).join('\n\n');
      } else if (target >= deliverable.steps.length) {
        deliverable.status = 'done';
      } else {
        deliverable.stepIndex = target;
      }
      state.revision = Number(state.revision || 0) + 1;
      localStorage.setItem(LOCAL_OPERATION_KEY, JSON.stringify(state));
      return { success: true, decision: input.decision };
    },

    async download(attachment) {
      if (auth.localMode) return null;
      const { data, error } = await auth.supabase.storage
        .from('doti-files')
        .download(attachment.storagePath);
      if (error) throw requestError(error);
      return data;
    }
  };
}
