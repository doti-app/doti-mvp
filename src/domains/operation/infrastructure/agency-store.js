export const FILE_BUCKET = 'doti-files';
const LOCAL_OPERATION_KEY = 'doti-agency-live-v4';
const LEGACY_LOCAL_OPERATION_KEY = 'doti-agency-live-v3';
const LOCAL_FILE_DB_NAME = 'doti-operation-files-v1';
const LOCAL_FILE_STORE = 'files';
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
  'activity_events',
  'client_approval_decisions'
];

let context;
let filePaths = new Map();

/**
 * Provides the authenticated application context to the operation repository.
 * The repository deliberately owns no browser-global auth event or mutable
 * `window` contract; the application composition root supplies it before use.
 * @param {any} authContext
 */
export function configureOperationStore(authContext) {
  context = authContext || null;
}

export function registerOperationFilePath(id, path) {
  if (!id || !path) return;
  filePaths.set(String(id), String(path));
}

export async function waitForOperationContext() {
  if (context) return context;
  throw new Error('A sessão da operação não foi inicializada.');
}

export async function loadAgencyState() {
  const auth = await waitForOperationContext();
  if (auth.localMode) {
    const current = readLocalState(LOCAL_OPERATION_KEY);
    const legacy = current ? null : readLocalState(LEGACY_LOCAL_OPERATION_KEY);
    const loaded = current || legacy;
    if (!loaded) return { version: 4, initialized: false, revision: 0 };
    const normalized = {
      ...loaded,
      version: 4,
      initialized: true,
      revision: Number(loaded.revision || 0)
    };
    indexFilePaths(normalized);
    return normalized;
  }
  const data = await callRpc('load_agency_state');
  const loaded = data || { version: 4, initialized: false, revision: 0 };
  indexFilePaths(loaded);
  return loaded;
}

export async function saveAgencyState(state, expectedRevision) {
  const payload = sanitizeStateForSave(state);
  const auth = await waitForOperationContext();
  if (auth.localMode) {
    const current = readLocalState(LOCAL_OPERATION_KEY);
    const currentRevision = Number(current?.revision || 0);
    if (currentRevision !== Number(expectedRevision || 0)) {
      const error = new Error('Os dados locais foram alterados em outra aba.');
      error.code = '40001';
      throw error;
    }
    const revision = currentRevision + 1;
    localStorage.setItem(LOCAL_OPERATION_KEY, JSON.stringify({
      ...payload,
      version: 4,
      initialized: true,
      revision
    }));
    indexFilePaths(payload);
    return revision;
  }
  const data = await callRpc('save_agency_state', {
    p_state: payload,
    p_expected_revision: expectedRevision
  });
  return Number(data);
}

export async function importLegacyAgencyState(state, fingerprint, counts, expectedRevision = 0) {
  const payload = sanitizeStateForSave(state);
  const auth = await waitForOperationContext();
  if (auth.localMode) return saveAgencyState(payload, expectedRevision);
  const data = await callRpc('import_legacy_state', {
    p_state: payload,
    p_fingerprint: fingerprint,
    p_counts: counts,
    p_expected_revision: expectedRevision
  });
  return Number(data);
}

export async function configureAgencyClientGroup(groupId) {
  const auth = await waitForOperationContext();
  if (auth.localMode) return { groupId, configured: true };
  return callRpc('configure_client_group', { p_group_id: groupId });
}

export function operationRpcHeaders(auth, token) {
  const headers = {
    apikey: auth.supabase.supabaseKey,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  if (auth.supportMode && auth.supportAgency?.id) {
    headers['X-Doti-Agency-Id'] = auth.supportAgency.id;
  }
  return headers;
}

async function callRpc(name, body = {}) {
  const auth = await waitForOperationContext();
  const token = auth.session?.access_token;
  if (!token) throw new Error('Sua sessão expirou. Entre novamente.');
  const response = await fetch(`${auth.supabase.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: operationRpcHeaders(auth, token),
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
    const { supabase, localMode } = await waitForOperationContext();
    if (stopped) return null;
    if (localMode) return null;
    let channel = supabase.channel(`doti-operation-${agencyId}`);
    OPERATION_TABLES.forEach(table => {
      channel = channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table,
        filter: `agency_id=eq.${agencyId}`
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
  const { supabase, profile, localMode } = await waitForOperationContext();
  if (localMode) {
    const path = `local:${id}`;
    await writeLocalFile(String(id), file);
    filePaths.set(String(id), path);
    return path;
  }
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

export async function downloadOperationFile(id, knownPath = '') {
  const { supabase, localMode } = await waitForOperationContext();
  const path = filePaths.get(String(id)) || String(knownPath || '');
  if (!path) return null;
  filePaths.set(String(id), path);
  if (localMode) return readLocalFile(String(id));
  const { data, error } = await supabase.storage.from(FILE_BUCKET).download(path);
  if (error) throw error;
  return data;
}

export async function removeOperationFile(id) {
  const { supabase, localMode } = await waitForOperationContext();
  const path = filePaths.get(String(id));
  if (!path) return;
  if (localMode) {
    await deleteLocalFile(String(id));
    filePaths.delete(String(id));
    return;
  }
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
  const { supabase, profile, localMode } = await waitForOperationContext();
  if (localMode) return { uploadedPaths: [], missing: [] };
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
  const { supabase, localMode } = await waitForOperationContext();
  if (localMode) {
    await Promise.all(paths
      .filter(path => String(path).startsWith('local:'))
      .map(path => deleteLocalFile(String(path).slice(6))));
    return;
  }
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
  (state.clients || []).forEach(client => {
    if (client.logoId && client.logoStoragePath) {
      filePaths.set(String(client.logoId), client.logoStoragePath);
    }
    (client.workspace || []).forEach(block => {
      if (block.fileId && block.storagePath) filePaths.set(String(block.fileId), block.storagePath);
    });
  });
  (state.deliverables || []).forEach(deliverable => {
    (deliverable.attachments || []).forEach(attachment => {
      if (attachment.id && attachment.storagePath) {
        filePaths.set(String(attachment.id), attachment.storagePath);
      }
    });
  });
  attachKnownFilePaths(state);
}

function readLocalState(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch (_) {
    return null;
  }
}

function openLocalFileDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_FILE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(LOCAL_FILE_STORE)) {
        request.result.createObjectStore(LOCAL_FILE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function useLocalFileStore(mode, action) {
  const database = await openLocalFileDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(LOCAL_FILE_STORE, mode);
      const request = action(transaction.objectStore(LOCAL_FILE_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function writeLocalFile(id, file) {
  return useLocalFileStore('readwrite', store => store.put(file, id));
}

function readLocalFile(id) {
  return useLocalFileStore('readonly', store => store.get(id));
}

function deleteLocalFile(id) {
  return useLocalFileStore('readwrite', store => store.delete(id));
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
