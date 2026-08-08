/// <reference path="../_shared/edge-runtime.d.ts" />
export {};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const LEGACY_PUBLIC_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const LEGACY_ADMIN_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const BOOTSTRAP_TOKEN = Deno.env.get('DOTI_PLATFORM_BOOTSTRAP_TOKEN') || '';

function namedKey(environmentName: string) {
  try {
    const keys = JSON.parse(Deno.env.get(environmentName) || '{}');
    return typeof keys.default === 'string' ? keys.default : '';
  } catch {
    return '';
  }
}

const PUBLIC_KEY = namedKey('SUPABASE_PUBLISHABLE_KEYS') || LEGACY_PUBLIC_KEY;
const ADMIN_KEY = LEGACY_ADMIN_KEY || namedKey('SUPABASE_SECRET_KEYS');
const STAFF_ROLES = new Set(['admin', 'member', 'viewer']);
const CUSTOMER_ROLES = new Set(['admin', 'member', 'viewer', 'client']);

type Staff = {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'member' | 'viewer';
  is_active: boolean;
  avatar_url?: string | null;
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function allowedOrigin(request: Request) {
  const origin = request.headers.get('origin') || '';
  if (
    origin === 'https://doti-mvp.vercel.app'
    || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)
    || /^http:\/\/localhost(?::\d+)?$/i.test(origin)
    || /^http:\/\/127\.0\.0\.1(?::\d+)?$/i.test(origin)
  ) {
    return origin;
  }
  return 'https://doti-mvp.vercel.app';
}

function corsHeaders(request: Request) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(request),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-doti-bootstrap-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store, max-age=0',
    Vary: 'Origin'
  };
}

function json(request: Request, status: number, body: unknown) {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

function adminHeaders(extra: Record<string, string> = {}) {
  const headers: Record<string, string> = {
    apikey: ADMIN_KEY,
    'Content-Type': 'application/json',
    ...extra
  };
  if (ADMIN_KEY.startsWith('eyJ')) {
    headers.Authorization = `Bearer ${ADMIN_KEY}`;
  }
  return headers;
}

async function adminRequest(path: string, options: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: adminHeaders(options.headers as Record<string, string> | undefined)
  });
  const body = response.status === 204
    ? null
    : await response.json().catch(() => null);
  if (!response.ok) {
    throw new HttpError(
      response.status,
      body?.msg || body?.message || body?.error_description || body?.error || 'Falha ao acessar o Supabase.'
    );
  }
  return body;
}

async function adminListAll(path: string) {
  const rows: any[] = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 100000; offset += pageSize) {
    const batch = await adminRequest(path, {
      headers: { Range: `${offset}-${offset + pageSize - 1}` }
    });
    if (!Array.isArray(batch)) throw new HttpError(500, 'Resposta de diretório inválida.');
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

async function authenticatedUser(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    throw new HttpError(401, 'Sessão ausente.');
  }
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: PUBLIC_KEY, Authorization: authorization }
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) {
    throw new HttpError(401, 'Sessão inválida ou expirada.');
  }
  return user;
}

async function staffForUser(userId: string): Promise<Staff> {
  const rows = await adminRequest(
    `/rest/v1/platform_staff?id=eq.${encodeURIComponent(userId)}&select=id,email,full_name,role,is_active,avatar_url&limit=1`
  );
  const staff = rows?.[0];
  if (!staff?.is_active) {
    throw new HttpError(403, 'Este usuário não possui acesso DOT ativo.');
  }
  return staff;
}

function requireAdmin(staff: Staff) {
  if (staff.role !== 'admin') {
    throw new HttpError(403, 'Somente um administrador DOT pode realizar esta ação.');
  }
}

function requiredText(value: unknown, label: string, min = 2, max = 120) {
  const text = String(value || '').trim();
  if (text.length < min || text.length > max) {
    throw new HttpError(400, `${label} deve ter entre ${min} e ${max} caracteres.`);
  }
  return text;
}

function validEmail(value: unknown) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Informe um e-mail válido.');
  }
  return email;
}

function validUuid(value: unknown, label = 'Identificador') {
  const id = String(value || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new HttpError(400, `${label} inválido.`);
  }
  return id;
}

async function audit(
  actorId: string,
  action: string,
  agencyId: string | null = null,
  resourceType: string | null = null,
  resourceId: string | null = null,
  details: Record<string, unknown> = {}
) {
  await adminRequest('/rest/v1/platform_audit_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      actor_id: actorId,
      agency_id: agencyId,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      details
    })
  });
}

async function listAuthUsers() {
  const users: any[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = await adminRequest(`/auth/v1/admin/users?page=${page}&per_page=1000`);
    const batch = Array.isArray(result?.users) ? result.users : [];
    users.push(...batch);
    if (batch.length < 1000) break;
  }
  return users;
}

async function authUserByEmail(email: string) {
  const users = await listAuthUsers();
  return users.find(user => String(user.email || '').toLowerCase() === email) || null;
}

function invitationRedirect(request: Request) {
  return `${allowedOrigin(request).replace(/\/$/, '')}/dot-admin/?mode=invite`;
}

async function createPlatformInvitation(
  request: Request,
  actorId: string | null,
  email: string,
  fullName: string,
  role: string
) {
  const invitationId = crypto.randomUUID();
  await adminRequest('/rest/v1/platform_staff_invitations', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: invitationId,
      email,
      full_name: fullName,
      role,
      invited_by: actorId
    })
  });
  return invitationId;
}

async function bootstrap(request: Request, body: Record<string, unknown>) {
  if (!BOOTSTRAP_TOKEN) {
    throw new HttpError(503, 'O bootstrap do portal DOT não foi configurado.');
  }
  if (request.headers.get('x-doti-bootstrap-token') !== BOOTSTRAP_TOKEN) {
    throw new HttpError(403, 'Token de bootstrap inválido.');
  }
  const existingAdmins = await adminRequest(
    '/rest/v1/platform_staff?role=eq.admin&is_active=eq.true&select=id&limit=1'
  );
  if (existingAdmins.length) {
    throw new HttpError(409, 'O primeiro administrador DOT já foi criado.');
  }

  const email = validEmail(body.email);
  const fullName = requiredText(body.fullName, 'Nome completo');
  const password = String(body.password || '');
  if (password.length < 12) {
    throw new HttpError(400, 'A senha inicial precisa ter pelo menos 12 caracteres.');
  }

  const existingUser = await authUserByEmail(email);
  if (existingUser) {
    await adminRequest('/rest/v1/platform_staff', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: existingUser.id,
        email,
        full_name: fullName,
        role: 'admin',
        is_active: true
      })
    });
    return { created: true, existingAccount: true, userId: existingUser.id };
  }

  const invitationId = await createPlatformInvitation(
    request, null, email, fullName, 'admin'
  );
  try {
    const created = await adminRequest('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          platform_invitation_id: invitationId
        },
        app_metadata: { account_type: 'doti_staff' }
      })
    });
    return { created: true, existingAccount: false, userId: created?.id || created?.user?.id };
  } catch (error) {
    await adminRequest(
      `/rest/v1/platform_staff_invitations?id=eq.${encodeURIComponent(invitationId)}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
    ).catch(() => {});
    throw error;
  }
}

async function overview(staff: Staff) {
  const [agencies, profiles, projects, deliverables, chatbots, rollouts, activities] = await Promise.all([
    adminListAll('/rest/v1/agencies?select=id,name,owner_id,status,created_at,archived_at&order=created_at.desc'),
    adminListAll('/rest/v1/profiles?select=id,agency_id,email,full_name,role,is_active,created_at'),
    adminListAll('/rest/v1/projects?select=id,agency_id,updated_at'),
    adminListAll('/rest/v1/deliverables?select=id,agency_id,status,due_date,updated_at'),
    adminListAll('/rest/v1/chatbots?select=id,agency_id,is_active'),
    adminListAll('/rest/v1/meta_whatsapp_rollouts?select=agency_id,release_stage,sending_enabled,updated_at'),
    adminListAll('/rest/v1/activity_events?select=agency_id,occurred_at&order=occurred_at.desc')
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const profilesByAgency = new Map<string, any[]>();
  const projectsByAgency = new Map<string, any[]>();
  const deliverablesByAgency = new Map<string, any[]>();
  const botsByAgency = new Map<string, any[]>();
  const rolloutByAgency = new Map(rollouts.map((row: any) => [row.agency_id, row]));
  const lastActivityByAgency = new Map<string, string>();

  for (const row of profiles) {
    profilesByAgency.set(row.agency_id, [...(profilesByAgency.get(row.agency_id) || []), row]);
  }
  for (const row of projects) {
    projectsByAgency.set(row.agency_id, [...(projectsByAgency.get(row.agency_id) || []), row]);
  }
  for (const row of deliverables) {
    deliverablesByAgency.set(row.agency_id, [...(deliverablesByAgency.get(row.agency_id) || []), row]);
  }
  for (const row of chatbots) {
    botsByAgency.set(row.agency_id, [...(botsByAgency.get(row.agency_id) || []), row]);
  }
  for (const row of activities) {
    if (!lastActivityByAgency.has(row.agency_id)) {
      lastActivityByAgency.set(row.agency_id, row.occurred_at);
    }
  }

  const agencyRows = agencies.map((agency: any) => {
    const members = profilesByAgency.get(agency.id) || [];
    const agencyProjects = projectsByAgency.get(agency.id) || [];
    const agencyDeliverables = deliverablesByAgency.get(agency.id) || [];
    const agencyBots = botsByAgency.get(agency.id) || [];
    const owner = members.find(member => member.id === agency.owner_id);
    const overdue = agencyDeliverables.filter(item =>
      item.due_date && item.due_date < today && item.status !== 'done'
    ).length;
    const rollout = rolloutByAgency.get(agency.id);
    return {
      id: agency.id,
      name: agency.name,
      status: agency.status,
      ownerId: agency.owner_id,
      ownerName: owner?.full_name || 'Sem proprietário identificado',
      ownerEmail: owner?.email || '',
      memberCount: members.length,
      activeMemberCount: members.filter(member => member.is_active).length,
      projectCount: agencyProjects.length,
      deliverableCount: agencyDeliverables.length,
      overdueCount: overdue,
      botCount: agencyBots.length,
      activeBotCount: agencyBots.filter(bot => bot.is_active).length,
      whatsappStage: rollout?.release_stage || 'disabled',
      whatsappEnabled: Boolean(rollout?.sending_enabled),
      lastActivityAt: lastActivityByAgency.get(agency.id) || null,
      createdAt: agency.created_at,
      archivedAt: agency.archived_at
    };
  });

  return {
    currentStaff: staff,
    summary: {
      agencyCount: agencies.length,
      activeAgencyCount: agencies.filter((agency: any) => agency.status === 'active').length,
      archivedAgencyCount: agencies.filter((agency: any) => agency.status === 'archived').length,
      userCount: profiles.length,
      activeUserCount: profiles.filter((profile: any) => profile.is_active).length,
      projectCount: projects.length,
      overdueCount: agencyRows.reduce((total: number, agency: any) => total + agency.overdueCount, 0),
      activeBotCount: chatbots.filter((bot: any) => bot.is_active).length
    },
    agencies: agencyRows
  };
}

async function listAccounts() {
  const [users, profiles, platformStaff] = await Promise.all([
    listAuthUsers(),
    adminListAll('/rest/v1/profiles?select=id,agency_id,email,full_name,role,is_active,created_at'),
    adminListAll('/rest/v1/platform_staff?select=id,email,full_name,role,is_active,created_at')
  ]);
  const profileById = new Map(profiles.map((row: any) => [row.id, row]));
  const staffById = new Map(platformStaff.map((row: any) => [row.id, row]));
  return users.map(user => {
    const profile = profileById.get(user.id);
    const staff = staffById.get(user.id);
    return {
      id: user.id,
      email: user.email || profile?.email || staff?.email || '',
      fullName: staff?.full_name || profile?.full_name || '',
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at || null,
      emailConfirmedAt: user.email_confirmed_at || null,
      customer: profile ? {
        agencyId: profile.agency_id,
        role: profile.role,
        isActive: profile.is_active
      } : null,
      platform: staff ? { role: staff.role, isActive: staff.is_active } : null
    };
  });
}

async function listStaff() {
  const [staff, invitations] = await Promise.all([
    adminRequest('/rest/v1/platform_staff?select=id,email,full_name,role,is_active,avatar_url,created_at&order=created_at.asc'),
    adminRequest('/rest/v1/platform_staff_invitations?status=eq.pending&select=id,email,full_name,role,expires_at,created_at&order=created_at.desc')
  ]);
  return { staff, invitations };
}

async function inviteStaff(
  request: Request,
  actor: Staff,
  body: Record<string, unknown>
) {
  const email = validEmail(body.email);
  const fullName = requiredText(body.fullName, 'Nome completo');
  const role = String(body.role || 'member');
  if (!STAFF_ROLES.has(role)) throw new HttpError(400, 'Nível DOT inválido.');

  const existingStaff = await adminRequest(
    `/rest/v1/platform_staff?email=ilike.${encodeURIComponent(email)}&select=id,is_active&limit=1`
  );
  if (existingStaff.length) {
    throw new HttpError(409, 'Este e-mail já possui um perfil DOT.');
  }

  const existingUser = await authUserByEmail(email);
  if (existingUser) {
    await adminRequest('/rest/v1/platform_staff', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: existingUser.id,
        email,
        full_name: fullName,
        role,
        is_active: true,
        created_by: actor.id
      })
    });
    await audit(actor.id, 'staff.added_existing_account', null, 'platform_staff', existingUser.id, { role });
    return { message: 'Acesso DOT adicionado à conta existente.', userId: existingUser.id };
  }

  const invitationId = await createPlatformInvitation(
    request, actor.id, email, fullName, role
  );
  try {
    await adminRequest(
      `/auth/v1/invite?redirect_to=${encodeURIComponent(invitationRedirect(request))}`,
      {
        method: 'POST',
        body: JSON.stringify({
          email,
          data: {
            full_name: fullName,
            platform_invitation_id: invitationId
          }
        })
      }
    );
  } catch (error) {
    await adminRequest(
      `/rest/v1/platform_staff_invitations?id=eq.${encodeURIComponent(invitationId)}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
    ).catch(() => {});
    throw error;
  }
  await audit(actor.id, 'staff.invited', null, 'platform_staff_invitations', invitationId, { role });
  return { message: `Convite DOT enviado para ${email}.`, invitationId };
}

async function updateStaff(actor: Staff, body: Record<string, unknown>) {
  const staffId = validUuid(body.staffId, 'Colaborador DOT');
  if (staffId === actor.id) {
    throw new HttpError(409, 'Peça a outro administrador DOT para alterar o seu próprio acesso.');
  }
  const role = body.role == null ? null : String(body.role);
  const isActive = body.isActive == null ? null : Boolean(body.isActive);
  if (role !== null && !STAFF_ROLES.has(role)) {
    throw new HttpError(400, 'Nível DOT inválido.');
  }
  if (role === null && isActive === null) {
    throw new HttpError(400, 'Nenhuma alteração informada.');
  }
  const changes: Record<string, unknown> = {};
  if (role !== null) changes.role = role;
  if (isActive !== null) changes.is_active = isActive;
  await adminRequest(`/rest/v1/platform_staff?id=eq.${encodeURIComponent(staffId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(changes)
  });
  await audit(actor.id, 'staff.updated', null, 'platform_staff', staffId, changes);
  return { message: 'Acesso DOT atualizado.' };
}

async function revokeStaffInvitation(actor: Staff, body: Record<string, unknown>) {
  const invitationId = validUuid(body.invitationId, 'Convite');
  await adminRequest(
    `/rest/v1/platform_staff_invitations?id=eq.${encodeURIComponent(invitationId)}&status=eq.pending`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'revoked' })
    }
  );
  await audit(actor.id, 'staff.invitation_revoked', null, 'platform_staff_invitations', invitationId);
  return { message: 'Convite DOT revogado.' };
}

async function agencyById(agencyId: string) {
  const rows = await adminRequest(
    `/rest/v1/agencies?id=eq.${encodeURIComponent(agencyId)}&select=id,name,owner_id,status,created_at,archived_at&limit=1`
  );
  if (!rows?.[0]) throw new HttpError(404, 'Agência não encontrada.');
  return rows[0];
}

async function recordAgencyEntry(actor: Staff, body: Record<string, unknown>) {
  const agencyId = validUuid(body.agencyId, 'Agência');
  const agency = await agencyById(agencyId);
  if (agency.status !== 'active') {
    throw new HttpError(409, 'Restaure a agência antes de abrir sua operação.');
  }
  await audit(actor.id, 'agency.entered', agencyId, 'agencies', agencyId, { staffRole: actor.role });
  return { agency: { id: agency.id, name: agency.name, status: agency.status } };
}

async function createAgency(
  request: Request,
  actor: Staff,
  body: Record<string, unknown>
) {
  const agencyName = requiredText(body.agencyName, 'Nome da agência');
  const ownerName = requiredText(body.ownerName, 'Nome do proprietário');
  const ownerEmail = validEmail(body.ownerEmail);
  const existingProfile = await adminRequest(
    `/rest/v1/profiles?email=ilike.${encodeURIComponent(ownerEmail)}&select=id,agency_id&limit=1`
  );
  if (existingProfile.length) {
    throw new HttpError(409, 'Este e-mail já pertence a uma agência.');
  }

  const existingUser = await authUserByEmail(ownerEmail);
  let agencyId = '';
  let ownerId = '';
  if (existingUser) {
    ownerId = existingUser.id;
    const agencyRows = await adminRequest('/rest/v1/agencies', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ name: agencyName, owner_id: ownerId })
    });
    agencyId = agencyRows?.[0]?.id;
    await adminRequest('/rest/v1/profiles', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: ownerId,
        agency_id: agencyId,
        email: ownerEmail,
        full_name: ownerName,
        agency_name: agencyName,
        role: 'owner',
        is_active: true
      })
    });
  } else {
    const invited = await adminRequest(
      `/auth/v1/invite?redirect_to=${encodeURIComponent(invitationRedirect(request))}`,
      {
        method: 'POST',
        body: JSON.stringify({
          email: ownerEmail,
          data: { full_name: ownerName, agency_name: agencyName }
        })
      }
    );
    ownerId = invited?.id || invited?.user?.id;
    const profiles = await adminRequest(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(ownerId)}&select=agency_id&limit=1`
    );
    agencyId = profiles?.[0]?.agency_id;
  }
  if (!agencyId || !ownerId) {
    throw new HttpError(500, 'A agência foi criada sem conseguir resolver o proprietário.');
  }
  await audit(actor.id, 'agency.created', agencyId, 'agencies', agencyId, { ownerId });
  return {
    message: existingUser
      ? 'Agência criada na conta existente do proprietário.'
      : 'Agência criada e proprietário convidado.',
    agencyId,
    ownerId
  };
}

async function renameAgency(actor: Staff, body: Record<string, unknown>) {
  const agencyId = validUuid(body.agencyId, 'Agência');
  const name = requiredText(body.name, 'Nome da agência');
  await agencyById(agencyId);
  await Promise.all([
    adminRequest(`/rest/v1/agencies?id=eq.${encodeURIComponent(agencyId)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ name })
    }),
    adminRequest(`/rest/v1/profiles?agency_id=eq.${encodeURIComponent(agencyId)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ agency_name: name })
    })
  ]);
  await audit(actor.id, 'agency.renamed', agencyId, 'agencies', agencyId, { name });
  return { message: 'Agência renomeada.' };
}

async function setAgencyArchived(
  actor: Staff,
  body: Record<string, unknown>,
  archived: boolean
) {
  const agencyId = validUuid(body.agencyId, 'Agência');
  await agencyById(agencyId);
  const changes = archived ? {
    status: 'archived', archived_at: new Date().toISOString(), archived_by: actor.id
  } : {
    status: 'active', archived_at: null, archived_by: null
  };
  await adminRequest(`/rest/v1/agencies?id=eq.${encodeURIComponent(agencyId)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(changes)
  });
  if (archived) {
    await adminRequest(`/rest/v1/meta_whatsapp_rollouts?agency_id=eq.${encodeURIComponent(agencyId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ release_stage: 'disabled', sending_enabled: false })
    }).catch(() => {});
  }
  await audit(
    actor.id,
    archived ? 'agency.archived' : 'agency.restored',
    agencyId,
    'agencies',
    agencyId
  );
  return { message: archived ? 'Agência arquivada.' : 'Agência restaurada.' };
}

async function listAgencyTeam(actor: Staff, agencyId: string) {
  await agencyById(agencyId);
  const [members, invitations, clients] = await Promise.all([
    adminRequest(
      `/rest/v1/profiles?agency_id=eq.${encodeURIComponent(agencyId)}&select=id,email,full_name,avatar_url,role,client_id,is_active,created_at&order=created_at.asc`
    ),
    adminRequest(
      `/rest/v1/team_invitations?agency_id=eq.${encodeURIComponent(agencyId)}&status=eq.pending&select=id,email,full_name,role,client_id,status,expires_at,created_at&order=created_at.desc`
    ),
    adminRequest(
      `/rest/v1/clients?agency_id=eq.${encodeURIComponent(agencyId)}&select=id,name&order=name.asc`
    )
  ]);
  const clientsById = new Map(clients.map((client: { id: string; name: string }) => [client.id, client.name]));
  return {
    members: members.map((member: Record<string, unknown>) => ({
      ...member,
      client_name: clientsById.get(String(member.client_id || '')) || ''
    })),
    invitations: invitations.map((invitation: Record<string, unknown>) => ({
      ...invitation,
      client_name: clientsById.get(String(invitation.client_id || '')) || ''
    })),
    clients,
    currentUserId: actor.id,
    currentRole: actor.role
  };
}

async function inviteAgencyMember(
  request: Request,
  actor: Staff,
  body: Record<string, unknown>
) {
  const agencyId = validUuid(body.agencyId, 'Agência');
  const email = validEmail(body.email);
  const fullName = requiredText(body.fullName, 'Nome completo');
  const role = String(body.role || 'member');
  const clientId = role === 'client' ? validUuid(body.clientId, 'Cliente') : null;
  if (!CUSTOMER_ROLES.has(role)) throw new HttpError(400, 'Nível de acesso inválido.');
  const agency = await agencyById(agencyId);
  if (agency.status !== 'active') throw new HttpError(409, 'A agência está arquivada.');
  if (role === 'client') {
    const clients = await adminRequest(
      `/rest/v1/clients?id=eq.${encodeURIComponent(clientId || '')}&agency_id=eq.${encodeURIComponent(agencyId)}&select=id&limit=1`
    );
    if (!clients.length) throw new HttpError(400, 'O cliente escolhido não pertence a esta agência.');
  }
  const existingProfile = await adminRequest(
    `/rest/v1/profiles?email=ilike.${encodeURIComponent(email)}&select=id,agency_id&limit=1`
  );
  if (existingProfile.length) {
    throw new HttpError(409, 'Este e-mail já pertence a uma agência.');
  }

  const existingUser = await authUserByEmail(email);
  if (existingUser) {
    await adminRequest('/rest/v1/profiles', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: existingUser.id,
        agency_id: agencyId,
        email,
        full_name: fullName,
        agency_name: agency.name,
        role,
        client_id: clientId,
        is_active: true
      })
    });
    await audit(actor.id, 'agency.member_added_existing_account', agencyId, 'profiles', existingUser.id, { role });
    return { message: 'Pessoa adicionada usando a conta existente.' };
  }

  const invitationId = crypto.randomUUID();
  await adminRequest('/rest/v1/team_invitations', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: invitationId,
      agency_id: agencyId,
      email,
      full_name: fullName,
      role,
      client_id: clientId,
      invited_by: actor.id
    })
  });
  try {
    await adminRequest(
      `/auth/v1/invite?redirect_to=${encodeURIComponent(invitationRedirect(request))}`,
      {
        method: 'POST',
        body: JSON.stringify({
          email,
          data: { invitation_id: invitationId, full_name: fullName }
        })
      }
    );
  } catch (error) {
    await adminRequest(`/rest/v1/team_invitations?id=eq.${encodeURIComponent(invitationId)}`, {
      method: 'DELETE', headers: { Prefer: 'return=minimal' }
    }).catch(() => {});
    throw error;
  }
  await audit(actor.id, 'agency.member_invited', agencyId, 'team_invitations', invitationId, { role });
  return { message: `Convite enviado para ${email}.` };
}

async function setAuthActive(memberId: string, isActive: boolean) {
  const staffRows = await adminRequest(
    `/rest/v1/platform_staff?id=eq.${encodeURIComponent(memberId)}&is_active=eq.true&select=id&limit=1`
  );
  if (!isActive && staffRows.length) return;
  await adminRequest(`/auth/v1/admin/users/${encodeURIComponent(memberId)}`, {
    method: 'PUT',
    body: JSON.stringify({ ban_duration: isActive ? 'none' : '876000h' })
  });
}

async function updateAgencyMember(actor: Staff, body: Record<string, unknown>) {
  const agencyId = validUuid(body.agencyId, 'Agência');
  const memberId = validUuid(body.memberId, 'Membro');
  const role = body.role == null ? null : String(body.role);
  const clientId = role === 'client' ? validUuid(body.clientId, 'Cliente') : null;
  const isActive = body.isActive == null ? null : Boolean(body.isActive);
  if (role !== null && !CUSTOMER_ROLES.has(role)) {
    throw new HttpError(400, 'Nível de acesso inválido.');
  }
  if (role === 'client') {
    const clients = await adminRequest(
      `/rest/v1/clients?id=eq.${encodeURIComponent(clientId || '')}&agency_id=eq.${encodeURIComponent(agencyId)}&select=id&limit=1`
    );
    if (!clients.length) throw new HttpError(400, 'O cliente escolhido não pertence a esta agência.');
  }
  const rows = await adminRequest(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(memberId)}&agency_id=eq.${encodeURIComponent(agencyId)}&select=id,role,client_id,is_active&limit=1`
  );
  const member = rows?.[0];
  if (!member) throw new HttpError(404, 'Membro não encontrado.');
  if (member.role === 'owner') {
    throw new HttpError(409, 'Transfira a propriedade antes de alterar este acesso.');
  }
  const changes: Record<string, unknown> = {};
  if (role !== null) {
    changes.role = role;
    changes.client_id = role === 'client' ? clientId : null;
  }
  if (isActive !== null) changes.is_active = isActive;
  if (!Object.keys(changes).length) throw new HttpError(400, 'Nenhuma alteração informada.');
  if (isActive !== null) await setAuthActive(memberId, isActive);
  await adminRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(memberId)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(changes)
  });
  await audit(actor.id, 'agency.member_updated', agencyId, 'profiles', memberId, changes);
  return { message: 'Acesso da agência atualizado.' };
}

async function revokeAgencyInvitation(actor: Staff, body: Record<string, unknown>) {
  const agencyId = validUuid(body.agencyId, 'Agência');
  const invitationId = validUuid(body.invitationId, 'Convite');
  await adminRequest(
    `/rest/v1/team_invitations?id=eq.${encodeURIComponent(invitationId)}&agency_id=eq.${encodeURIComponent(agencyId)}&status=eq.pending`,
    {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'revoked' })
    }
  );
  await audit(actor.id, 'agency.invitation_revoked', agencyId, 'team_invitations', invitationId);
  return { message: 'Convite revogado.' };
}

async function transferOwner(actor: Staff, body: Record<string, unknown>) {
  const agencyId = validUuid(body.agencyId, 'Agência');
  const newOwnerId = validUuid(body.newOwnerId, 'Novo proprietário');
  const result = await adminRequest('/rest/v1/rpc/platform_transfer_agency_owner', {
    method: 'POST',
    body: JSON.stringify({
      p_agency_id: agencyId,
      p_new_owner_id: newOwnerId,
      p_actor_id: actor.id
    })
  });
  return { message: 'Propriedade transferida.', result };
}

async function listAudit() {
  return adminRequest(
    '/rest/v1/platform_audit_events?select=id,actor_id,agency_id,action,resource_type,resource_id,details,occurred_at&order=occurred_at.desc&limit=200'
  );
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request) });
  }
  if (request.method !== 'POST') {
    return json(request, 405, { error: 'Método não permitido.' });
  }
  if (!SUPABASE_URL || !PUBLIC_KEY || !ADMIN_KEY) {
    return json(request, 503, { error: 'A função do portal DOT ainda não foi configurada.' });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '');
    if (action === 'bootstrap') {
      return json(request, 201, await bootstrap(request, body));
    }

    const user = await authenticatedUser(request);
    const staff = await staffForUser(user.id);

    if (action === 'overview') return json(request, 200, await overview(staff));
    if (action === 'list_accounts') return json(request, 200, { accounts: await listAccounts() });
    if (action === 'record_agency_entry') {
      return json(request, 200, await recordAgencyEntry(staff, body));
    }
    if (action === 'agency_team_list') {
      const agencyId = validUuid(body.agencyId, 'Agência');
      return json(request, 200, await listAgencyTeam(staff, agencyId));
    }

    requireAdmin(staff);
    if (action === 'list_staff') return json(request, 200, await listStaff());
    if (action === 'invite_staff') return json(request, 201, await inviteStaff(request, staff, body));
    if (action === 'update_staff') return json(request, 200, await updateStaff(staff, body));
    if (action === 'revoke_staff_invitation') {
      return json(request, 200, await revokeStaffInvitation(staff, body));
    }
    if (action === 'create_agency') return json(request, 201, await createAgency(request, staff, body));
    if (action === 'rename_agency') return json(request, 200, await renameAgency(staff, body));
    if (action === 'archive_agency') {
      return json(request, 200, await setAgencyArchived(staff, body, true));
    }
    if (action === 'restore_agency') {
      return json(request, 200, await setAgencyArchived(staff, body, false));
    }
    if (action === 'agency_team_invite') {
      return json(request, 201, await inviteAgencyMember(request, staff, body));
    }
    if (action === 'agency_team_update_member') {
      return json(request, 200, await updateAgencyMember(staff, body));
    }
    if (action === 'agency_team_revoke_invitation') {
      return json(request, 200, await revokeAgencyInvitation(staff, body));
    }
    if (action === 'transfer_owner') return json(request, 200, await transferOwner(staff, body));
    if (action === 'list_audit') return json(request, 200, { events: await listAudit() });

    throw new HttpError(400, 'Ação administrativa inválida.');
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Não foi possível concluir a operação DOT.';
    return json(request, status, { error: message });
  }
});
