const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const LEGACY_PUBLIC_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const LEGACY_ADMIN_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

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
const ROLE_LABELS: Record<string, string> = {
  owner: 'Proprietário',
  admin: 'Administrador',
  member: 'Membro',
  viewer: 'Visualizador'
};

type Profile = {
  id: string;
  agency_id: string;
  email: string;
  full_name: string;
  agency_name: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  is_active: boolean;
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
  ) {
    return origin;
  }
  return 'https://doti-mvp.vercel.app';
}

function corsHeaders(request: Request) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(request),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
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
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new HttpError(
      response.status,
      body?.msg || body?.message || body?.error_description || 'Falha ao acessar o Supabase.'
    );
  }
  return body;
}

async function authenticatedUser(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    throw new HttpError(401, 'Sessão ausente.');
  }
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: PUBLIC_KEY,
      Authorization: authorization
    }
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) {
    throw new HttpError(401, 'Sessão inválida ou expirada.');
  }
  return user;
}

async function profileForUser(userId: string): Promise<Profile> {
  const profiles = await adminRequest(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,agency_id,email,full_name,agency_name,role,is_active&limit=1`
  );
  const profile = profiles?.[0];
  if (!profile?.is_active) {
    throw new HttpError(403, 'Este usuário não possui acesso operacional ativo.');
  }
  return profile;
}

async function managerContext(request: Request) {
  const user = await authenticatedUser(request);
  const profile = await profileForUser(user.id);
  if (!['owner', 'admin'].includes(profile.role)) {
    throw new HttpError(403, 'Você não tem permissão para administrar a equipe.');
  }
  return { user, profile };
}

async function listTeam(profile: Profile) {
  const agencyId = encodeURIComponent(profile.agency_id);
  const [members, invitations] = await Promise.all([
    adminRequest(
      `/rest/v1/profiles?agency_id=eq.${agencyId}&select=id,email,full_name,role,is_active,created_at&order=created_at.asc`
    ),
    adminRequest(
      `/rest/v1/team_invitations?agency_id=eq.${agencyId}&status=eq.pending&select=id,email,full_name,role,status,expires_at,created_at&order=created_at.desc`
    )
  ]);
  return { members, invitations, currentUserId: profile.id, currentRole: profile.role };
}

function invitationRedirect(request: Request) {
  return `${allowedOrigin(request).replace(/\/$/, '')}/dot-admin/?mode=invite`;
}

async function inviteMember(request: Request, profile: Profile, body: Record<string, unknown>) {
  const email = String(body.email || '').trim().toLowerCase();
  const fullName = String(body.fullName || '').trim();
  const role = String(body.role || 'member');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Informe um e-mail válido.');
  }
  if (fullName.length < 2 || fullName.length > 120) {
    throw new HttpError(400, 'Informe o nome completo da pessoa.');
  }
  if (!['admin', 'member', 'viewer'].includes(role)) {
    throw new HttpError(400, 'Nível de acesso inválido.');
  }
  if (profile.role !== 'owner' && role === 'admin') {
    throw new HttpError(403, 'Somente o proprietário pode convidar administradores.');
  }

  const existing = await adminRequest(
    `/rest/v1/profiles?email=ilike.${encodeURIComponent(email)}&select=id,agency_id&limit=1`
  );
  if (existing.length) {
    throw new HttpError(409, 'Este e-mail já possui uma conta no Doti.');
  }

  const invitationId = crypto.randomUUID();
  await adminRequest('/rest/v1/team_invitations', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: invitationId,
      agency_id: profile.agency_id,
      email,
      full_name: fullName,
      role,
      invited_by: profile.id
    })
  });

  try {
    await adminRequest(
      `/auth/v1/invite?redirect_to=${encodeURIComponent(invitationRedirect(request))}`,
      {
        method: 'POST',
        body: JSON.stringify({
          email,
          data: {
            invitation_id: invitationId,
            full_name: fullName
          }
        })
      }
    );
  } catch (error) {
    await adminRequest(
      `/rest/v1/team_invitations?id=eq.${encodeURIComponent(invitationId)}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
    ).catch(() => {});
    throw error;
  }

  return {
    message: `Convite enviado para ${email}.`,
    invitation: { id: invitationId, email, full_name: fullName, role }
  };
}

async function memberInAgency(profile: Profile, memberId: string) {
  const matches = await adminRequest(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(memberId)}&agency_id=eq.${encodeURIComponent(profile.agency_id)}&select=id,email,role,is_active&limit=1`
  );
  const member = matches?.[0];
  if (!member) throw new HttpError(404, 'Membro não encontrado.');
  return member;
}

function assertCanManageMember(profile: Profile, member: { id: string; role: string }, nextRole?: string | null) {
  if (member.id === profile.id) {
    throw new HttpError(400, 'Você não pode alterar o próprio acesso.');
  }
  if (member.role === 'owner') {
    throw new HttpError(403, 'O acesso do proprietário não pode ser alterado.');
  }
  if (profile.role !== 'owner' && (member.role === 'admin' || nextRole === 'admin')) {
    throw new HttpError(403, 'Somente o proprietário pode alterar administradores.');
  }
}

async function setAuthActive(memberId: string, isActive: boolean) {
  await adminRequest(`/auth/v1/admin/users/${encodeURIComponent(memberId)}`, {
    method: 'PUT',
    body: JSON.stringify({ ban_duration: isActive ? 'none' : '876000h' })
  });
}

async function updateMember(profile: Profile, body: Record<string, unknown>) {
  const memberId = String(body.memberId || '');
  const role = body.role == null ? null : String(body.role);
  const isActive = body.isActive == null ? null : Boolean(body.isActive);
  if (!memberId) throw new HttpError(400, 'Membro inválido.');
  if (role !== null && !['admin', 'member', 'viewer'].includes(role)) {
    throw new HttpError(400, 'Nível de acesso inválido.');
  }

  const member = await memberInAgency(profile, memberId);
  assertCanManageMember(profile, member, role);

  const changes: Record<string, unknown> = {};
  if (role !== null) changes.role = role;
  if (isActive !== null) changes.is_active = isActive;
  if (!Object.keys(changes).length) {
    throw new HttpError(400, 'Nenhuma alteração informada.');
  }

  if (isActive !== null) await setAuthActive(memberId, isActive);
  try {
    await adminRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(memberId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(changes)
    });
  } catch (error) {
    if (isActive !== null) await setAuthActive(memberId, !isActive).catch(() => {});
    throw error;
  }

  return {
    message: isActive === false
      ? 'Acesso desativado.'
      : isActive === true
        ? 'Acesso reativado.'
        : `Nível alterado para ${ROLE_LABELS[role || '']}.`
  };
}

async function revokeInvitation(profile: Profile, body: Record<string, unknown>) {
  const invitationId = String(body.invitationId || '');
  if (!invitationId) throw new HttpError(400, 'Convite inválido.');
  const invitations = await adminRequest(
    `/rest/v1/team_invitations?id=eq.${encodeURIComponent(invitationId)}&agency_id=eq.${encodeURIComponent(profile.agency_id)}&status=eq.pending&select=id,email,role&limit=1`
  );
  const invitation = invitations?.[0];
  if (!invitation) throw new HttpError(404, 'Convite pendente não encontrado.');
  if (profile.role !== 'owner' && invitation.role === 'admin') {
    throw new HttpError(403, 'Somente o proprietário pode revogar convites de administradores.');
  }

  const members = await adminRequest(
    `/rest/v1/profiles?agency_id=eq.${encodeURIComponent(profile.agency_id)}&email=ilike.${encodeURIComponent(invitation.email)}&select=id,role&limit=1`
  );
  const member = members?.[0];
  if (member) {
    assertCanManageMember(profile, member);
    await setAuthActive(member.id, false);
    await adminRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(member.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ is_active: false })
    });
  }

  await adminRequest(`/rest/v1/team_invitations?id=eq.${encodeURIComponent(invitationId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'revoked' })
  });
  return { message: 'Convite revogado.' };
}

async function acceptInvitation(request: Request) {
  const user = await authenticatedUser(request);
  const profile = await profileForUser(user.id);
  const invitationId = String(user.user_metadata?.invitation_id || '');
  if (!invitationId) return { accepted: true };

  const invitations = await adminRequest(
    `/rest/v1/team_invitations?id=eq.${encodeURIComponent(invitationId)}&agency_id=eq.${encodeURIComponent(profile.agency_id)}&email=ilike.${encodeURIComponent(user.email)}&status=eq.pending&select=id&limit=1`
  );
  if (!invitations?.length) {
    throw new HttpError(409, 'O convite já foi usado, revogado ou expirou.');
  }
  await adminRequest(`/rest/v1/team_invitations?id=eq.${encodeURIComponent(invitationId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'accepted', accepted_at: new Date().toISOString() })
  });
  return { accepted: true };
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request) });
  }
  if (request.method !== 'POST') {
    return json(request, 405, { error: 'Método não permitido.' });
  }
  if (!SUPABASE_URL || !PUBLIC_KEY || !ADMIN_KEY) {
    return json(request, 503, { error: 'A função administrativa ainda não foi configurada.' });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '');
    if (action === 'accept_invite') {
      return json(request, 200, await acceptInvitation(request));
    }

    const { profile } = await managerContext(request);
    if (action === 'list') return json(request, 200, await listTeam(profile));
    if (action === 'invite') return json(request, 201, await inviteMember(request, profile, body));
    if (action === 'update_member') return json(request, 200, await updateMember(profile, body));
    if (action === 'revoke_invitation') {
      return json(request, 200, await revokeInvitation(profile, body));
    }
    throw new HttpError(400, 'Ação administrativa inválida.');
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Não foi possível administrar a equipe.';
    return json(request, status, { error: message });
  }
});
