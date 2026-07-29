export const FILE_BUCKET = 'doti-files';
const OPERATION_TABLES = [
  'agency_groups',
  'workflows',
  'workflow_steps',
  'clients',
  'client_workspace_blocks',
  'projects',
  'deliverables',
  'deliverable_steps',
  'step_tasks',
  'deliverable_links',
  'files',
  'activity_events'
];

let context;
let filePaths = new Map();

export async function waitForOperationContext() {
  if (context) return context;
  if (window.dotiAuthContext) {
    context = window.dotiAuthContext;
    return context;
  }
  context = await new Promise(resolve => {
    window.addEventListener('doti:auth-ready', event => resolve(event.detail), { once: true });
  });
  return context;
}

export async function loadAgencyState() {
  const data = await callRpc('load_agency_state');
  const loaded = data || { version: 4, initialized: false, revision: 0 };
  indexFilePaths(loaded);
  return loaded;
}

export async function saveAgencyState(state, expectedRevision) {
  const payload = sanitizeStateForSave(state);
  const data = await callRpc('save_agency_state', {
    p_state: payload,
    p_expected_revision: expectedRevision
  });
  return Number(data);
}

export async function importLegacyAgencyState(state, fingerprint, counts, expectedRevision = 0) {
  const payload = sanitizeStateForSave(state);
  const data = await callRpc('import_legacy_state', {
    p_state: payload,
    p_fingerprint: fingerprint,
    p_counts: counts,
    p_expected_revision: expectedRevision
  });
  return Number(data);
}

async function callRpc(name, body = {}) {
  const auth = await waitForOperationContext();
  const token = auth.session?.access_token;
  if (!token) throw new Error('Sua sessão expirou. Entre novamente.');
  const response = await fetch(`${auth.supabase.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: auth.supabase.supabaseKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.message || 'Não foi possível acessar a operação compartilhada.');
    error.code = result?.code || '';
    error.details = result?.details || '';
    error.hint = result?.hint || '';
    throw error;
  }
  return result;
}

export function subscribeToAgencyChanges(agencyId, onChange) {
  let timer;
  let stopped = false;
  const start = async () => {
    const { supabase } = await waitForOperationContext();
    if (stopped) return null;
    let channel = supabase.channel(`doti-operation-${agencyId}`);
    OPERATION_TABLES.forEach(table => {
      channel = channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table
      }, payload => {
        clearTimeout(timer);
        timer = setTimeout(() => onChange(payload), 450);
      });
    });
    return channel.subscribe();
  };
  let channelPromise = start();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    const channel = await channelPromise;
    if (!channel) return;
    const { supabase } = await waitForOperationContext();
    await supabase.removeChannel(channel);
  };
}

export async function uploadOperationFile(id, file) {
  const { supabase, profile } = await waitForOperationContext();
  const path = filePaths.get(String(id))
    || `${profile.agency_id}/files/${id}/${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from(FILE_BUCKET).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type || 'application/octet-stream',
    upsert: true
  });
  if (error) throw error;
  filePaths.set(String(id), path);
  return path;
}

export async function downloadOperationFile(id) {
  const { supabase } = await waitForOperationContext();
  const path = filePaths.get(String(id));
  if (!path) return null;
  const { data, error } = await supabase.storage.from(FILE_BUCKET).download(path);
  if (error) throw error;
  return data;
}

export async function removeOperationFile(id) {
  const { supabase } = await waitForOperationContext();
  const path = filePaths.get(String(id));
  if (!path) return;
  const { error } = await supabase.storage.from(FILE_BUCKET).remove([path]);
  if (error) throw error;
  filePaths.delete(String(id));
}

export function attachKnownFilePaths(state) {
  state.clients.forEach(client => {
    if (client.logoId && filePaths.has(String(client.logoId))) {
      client.logoStoragePath = filePaths.get(String(client.logoId));
    }
    (client.workspace || []).forEach(block => {
      if (block.fileId && filePaths.has(String(block.fileId))) {
        block.storagePath = filePaths.get(String(block.fileId));
      }
    });
  });
  state.deliverables.forEach(deliverable => {
    (deliverable.attachments || []).forEach(attachment => {
      if (filePaths.has(String(attachment.id))) {
        attachment.storagePath = filePaths.get(String(attachment.id));
      }
    });
  });
  return state;
}

export async function legacyFingerprint(state) {
  const canonical = stableStringify(state);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function canonicalizeLegacyState(source) {
  const state = structuredClone(source);
  const maps = {
    groups: new Map(),
    workflows: new Map(),
    workflowSteps: new Map(),
    clients: new Map(),
    projects: new Map(),
    deliverables: new Map(),
    deliverableSteps: new Map(),
    files: new Map()
  };
  const mapId = (map, value) => {
    if (!value) return '';
    if (!map.has(String(value))) map.set(String(value), crypto.randomUUID());
    return map.get(String(value));
  };

  state.groups = (state.groups || []).map(group => ({
    ...group,
    id: mapId(maps.groups, group.id)
  }));
  state.workflows = (state.workflows || []).map(workflow => ({
    ...workflow,
    id: mapId(maps.workflows, workflow.id),
    steps: (workflow.steps || []).map(([name, groupId, stepId]) => [
      name,
      mapId(maps.groups, groupId),
      mapId(maps.workflowSteps, stepId)
    ])
  }));
  state.clients = (state.clients || []).map(client => ({
    ...client,
    id: mapId(maps.clients, client.id),
    logoId: client.logoId ? mapId(maps.files, client.logoId) : '',
    workspace: (client.workspace || []).map(block => ({
      ...block,
      id: crypto.randomUUID(),
      fileId: block.fileId ? mapId(maps.files, block.fileId) : block.fileId
    }))
  }));
  state.projects = (state.projects || []).map(project => ({
    ...project,
    id: mapId(maps.projects, project.id),
    clientId: mapId(maps.clients, project.clientId)
  }));
  state.deliverables = (state.deliverables || []).map(deliverable => ({
    ...deliverable,
    id: mapId(maps.deliverables, deliverable.id),
    projectId: mapId(maps.projects, deliverable.projectId),
    workflowId: mapId(maps.workflows, deliverable.workflowId),
    steps: (deliverable.steps || []).map(step => ({
      ...step,
      id: mapId(maps.deliverableSteps, step.id),
      sourceStepId: mapId(maps.workflowSteps, step.sourceStepId),
      groupId: mapId(maps.groups, step.groupId),
      tasks: (step.tasks || []).map(task => ({ ...task, id: crypto.randomUUID() }))
    })),
    links: (deliverable.links || []).map(link => ({
      ...link,
      id: crypto.randomUUID(),
      stepId: link.stepId ? mapId(maps.deliverableSteps, link.stepId) : ''
    })),
    attachments: (deliverable.attachments || []).map(file => ({
      ...file,
      legacyId: file.id,
      id: mapId(maps.files, file.id)
    }))
  }));
  state.activity = (state.activity || []).map(event => ({ ...event, id: crypto.randomUUID() }));
  state.version = 4;
  return { state, fileIdMap: maps.files };
}

export function legacyCounts(state) {
  return {
    clients: state.clients?.length || 0,
    projects: state.projects?.length || 0,
    deliverables: state.deliverables?.length || 0,
    workflows: state.workflows?.length || 0,
    tasks: (state.deliverables || []).reduce(
      (total, deliverable) => total + (deliverable.steps || []).reduce(
        (stepTotal, step) => stepTotal + (step.tasks?.length || 0),
        0
      ),
      0
    ),
    files: (state.clients || []).reduce(
      (total, client) => total + (client.logoId ? 1 : 0)
        + (client.workspace || []).filter(block => block.fileId).length,
      0
    ) + (state.deliverables || []).reduce(
      (total, deliverable) => total + (deliverable.attachments?.length || 0),
      0
    )
  };
}

export async function uploadLegacyFiles(state, fileIdMap, resolveLegacyFile, fingerprint) {
  const { supabase, profile } = await waitForOperationContext();
  const uploadedPaths = [];
  const missing = [];
  const upload = async (legacyId, currentId, metadata) => {
    const file = await resolveLegacyFile(legacyId).catch(() => null);
    if (!file) {
      missing.push(metadata.name || legacyId);
      return '';
    }
    const path = `${profile.agency_id}/imports/${fingerprint}/${currentId}/${safeFileName(file.name || metadata.name)}`;
    const { error } = await supabase.storage.from(FILE_BUCKET).upload(path, file, {
      cacheControl: '3600',
      contentType: file.type || metadata.type || metadata.mimeType || 'application/octet-stream',
      upsert: false
    });
    if (error) throw error;
    uploadedPaths.push(path);
    filePaths.set(String(currentId), path);
    return path;
  };

  try {
    for (const client of state.clients) {
      const legacyLogoId = findLegacyId(fileIdMap, client.logoId);
      if (legacyLogoId) {
        client.logoStoragePath = await upload(legacyLogoId, client.logoId, {
          name: 'logo',
          type: 'image/*'
        });
        if (!client.logoStoragePath) client.logoId = '';
      }
      for (const block of client.workspace || []) {
        if (!block.fileId) continue;
        const legacyId = findLegacyId(fileIdMap, block.fileId);
        block.storagePath = await upload(legacyId, block.fileId, block);
        if (!block.storagePath) block.fileId = '';
      }
      client.workspace = (client.workspace || []).filter(
        block => !['image', 'pdf'].includes(block.type) || Boolean(block.fileId)
      );
    }
    for (const deliverable of state.deliverables) {
      const available = [];
      for (const attachment of deliverable.attachments || []) {
        const legacyId = attachment.legacyId || findLegacyId(fileIdMap, attachment.id);
        attachment.storagePath = await upload(legacyId, attachment.id, attachment);
        delete attachment.legacyId;
        if (attachment.storagePath) available.push(attachment);
      }
      deliverable.attachments = available;
    }
    return { uploadedPaths, missing };
  } catch (error) {
    if (uploadedPaths.length) {
      await supabase.storage.from(FILE_BUCKET).remove(uploadedPaths).catch(() => {});
    }
    throw error;
  }
}

export async function removeStoragePaths(paths) {
  if (!paths.length) return;
  const { supabase } = await waitForOperationContext();
  const { error } = await supabase.storage.from(FILE_BUCKET).remove(paths);
  if (error) throw error;
}

function sanitizeStateForSave(input) {
  const state = attachKnownFilePaths(structuredClone(input));
  const workflowIds = new Set((state.workflows || []).map(workflow => workflow.id));
  state.version = 4;
  state.deliverables = (state.deliverables || []).map(deliverable => ({
    ...deliverable,
    workflowId: workflowIds.has(deliverable.workflowId) ? deliverable.workflowId : ''
  }));
  delete state.files;
  delete state.initialized;
  delete state.legacyImported;
  delete state.revision;
  return state;
}

function indexFilePaths(state) {
  filePaths = new Map();
  (state.files || []).forEach(file => {
    if (file.id && file.storagePath) filePaths.set(String(file.id), file.storagePath);
  });
  attachKnownFilePaths(state);
}

function findLegacyId(map, currentId) {
  for (const [legacyId, mappedId] of map.entries()) {
    if (mappedId === currentId) return legacyId;
  }
  return '';
}

function safeFileName(name = 'arquivo') {
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'arquivo';
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
