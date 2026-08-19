/// <reference path="../_shared/edge-runtime.d.ts" />
export {};

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
  viewer: 'Visualizador',
  client: 'Cliente da agência'
};

type Profile = {
  id: string;
  agency_id: string;
  client_id: string | null;
  email: string;
  full_name: string;
  agency_name: string;
  role: 'owner' | 'admin' | 'member' | 'viewer' | 'client';
  is_active: boolean;
  avatar_url: string | null;
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
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,agency_id,client_id,email,full_name,agency_name,role,is_active,avatar_url&limit=1`
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

async function updateProfile(request: Request, body: Record<string, unknown>) {
  const user = await authenticatedUser(request);
  const profile = await profileForUser(user.id);
  const fullName = String(body.fullName || '').trim();
  const avatarUrl = String(body.avatarUrl || '').trim();

  if (fullName.length < 2 || fullName.length > 120) {
    throw new HttpError(400, 'Informe um nome com 2 a 120 caracteres.');
  }
  const presetAvatar = /^\/assets\/avatars-users\/avatar-(0[1-9]|[12][0-9]|30)\.png$/.test(avatarUrl);
  const storedAvatar = new RegExp(`^profile-avatar:${user.id.toLowerCase()}:\\d{1,16}$`, 'i').test(avatarUrl);
  if (avatarUrl && !presetAvatar && !storedAvatar) {
    throw new HttpError(400, 'Escolha um avatar válido.');
  }

  await adminRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      full_name: fullName,
      avatar_url: avatarUrl
    })
  });

  return {
    profile: {
      ...profile,
      full_name: fullName,
      avatar_url: avatarUrl
    }
  };
}

async function listTeam(profile: Profile) {
  const agencyId = encodeURIComponent(profile.agency_id);
  const [members, invitations, clients, groups, memberGroups, invitationGroups] = await Promise.all([
    adminRequest(
      `/rest/v1/profiles?agency_id=eq.${agencyId}&select=id,email,full_name,avatar_url,role,client_id,is_active,created_at&order=created_at.asc`
    ),
    adminRequest(
      `/rest/v1/team_invitations?agency_id=eq.${agencyId}&status=eq.pending&select=id,email,full_name,role,client_id,status,expires_at,created_at&order=created_at.desc`
    ),
    adminRequest(
      `/rest/v1/clients?agency_id=eq.${agencyId}&select=id,name&order=name.asc`
    ),
    adminRequest(
      `/rest/v1/agency_groups?agency_id=eq.${agencyId}&select=id,name&order=position.asc`
    ),
    adminRequest(
      `/rest/v1/profile_group_responsibilities?agency_id=eq.${agencyId}&select=profile_id,group_id`
    ),
    adminRequest(
      `/rest/v1/invitation_group_responsibilities?agency_id=eq.${agencyId}&select=invitation_id,group_id`
    )
  ]);
  const clientsById = new Map(clients.map((client: { id: string; name: string }) => [client.id, client.name]));
  const groupIdsByMember = new Map<string, string[]>();
  memberGroups.forEach((assignment: { profile_id: string; group_id: string }) => {
    const assigned = groupIdsByMember.get(assignment.profile_id) || [];
    assigned.push(assignment.group_id);
    groupIdsByMember.set(assignment.profile_id, assigned);
  });
  const groupIdsByInvitation = new Map<string, string[]>();
  invitationGroups.forEach((assignment: { invitation_id: string; group_id: string }) => {
    const assigned = groupIdsByInvitation.get(assignment.invitation_id) || [];
    assigned.push(assignment.group_id);
    groupIdsByInvitation.set(assignment.invitation_id, assigned);
  });
  return {
    members: members.map((member: Record<string, unknown>) => ({
      ...member,
      client_name: clientsById.get(String(member.client_id || '')) || '',
      group_ids: groupIdsByMember.get(String(member.id)) || []
    })),
    invitations: invitations.map((invitation: Record<string, unknown>) => ({
      ...invitation,
      client_name: clientsById.get(String(invitation.client_id || '')) || '',
      group_ids: groupIdsByInvitation.get(String(invitation.id)) || []
    })),
    clients,
    groups,
    currentUserId: profile.id,
    currentRole: profile.role
  };
}

function normalizedGroupIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))];
}

async function validatedGroupIds(profile: Profile, role: string, value: unknown) {
  if (role === 'client') return [];
  const groupIds = normalizedGroupIds(value);
  if (!groupIds.length) throw new HttpError(400, 'Escolha pelo menos um grupo responsável.');
  if (groupIds.some(groupId => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(groupId))) {
    throw new HttpError(400, 'Um dos grupos escolhidos é inválido.');
  }
  const groups = await adminRequest(
    `/rest/v1/agency_groups?agency_id=eq.${encodeURIComponent(profile.agency_id)}&id=in.(${groupIds.join(',')})&select=id`
  );
  if (groups.length !== groupIds.length) {
    throw new HttpError(400, 'Um dos grupos escolhidos não pertence a esta agência.');
  }
  return groupIds;
}

async function replaceMemberGroups(profile: Profile, memberId: string, groupIds: string[]) {
  await adminRequest('/rest/v1/rpc/replace_profile_group_responsibilities', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      p_agency_id: profile.agency_id,
      p_profile_id: memberId,
      p_group_ids: groupIds
    })
  });
}

function invitationRedirect(request: Request) {
  return `${allowedOrigin(request).replace(/\/$/, '')}/dot-admin/?mode=invite`;
}

function recoveryRedirect(request: Request) {
  return `${allowedOrigin(request).replace(/\/$/, '')}/dot-admin/?mode=reset`;
}

async function refreshInvitationExpiry(invitationId: string) {
  await adminRequest(`/rest/v1/team_invitations?id=eq.${encodeURIComponent(invitationId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    })
  });
}

async function inviteMember(request: Request, profile: Profile, body: Record<string, unknown>) {
  const email = String(body.email || '').trim().toLowerCase();
  const fullName = String(body.fullName || '').trim();
  const role = String(body.role || 'member');
  const clientId = role === 'client' ? String(body.clientId || '') : '';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Informe um e-mail válido.');
  }
  if (fullName.length < 2 || fullName.length > 120) {
    throw new HttpError(400, 'Informe o nome completo da pessoa.');
  }
  if (!['admin', 'member', 'viewer', 'client'].includes(role)) {
    throw new HttpError(400, 'Nível de acesso inválido.');
  }
  if (profile.role !== 'owner' && role === 'admin') {
    throw new HttpError(403, 'Somente o proprietário pode convidar administradores.');
  }
  if (role === 'client') {
    if (!clientId) throw new HttpError(400, 'Escolha o cliente deste acesso.');
    const clients = await adminRequest(
      `/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&agency_id=eq.${encodeURIComponent(profile.agency_id)}&select=id&limit=1`
    );
    if (!clients.length) throw new HttpError(400, 'O cliente escolhido não pertence a esta agência.');
  }
  const groupIds = await validatedGroupIds(profile, role, body.groupIds);

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
      client_id: clientId || null,
      invited_by: profile.id
    })
  });

  try {
    if (groupIds.length) {
      await adminRequest('/rest/v1/invitation_group_responsibilities', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(groupIds.map(groupId => ({
          agency_id: profile.agency_id,
          invitation_id: invitationId,
          group_id: groupId
        })))
      });
    }
  } catch (error) {
    await adminRequest(
      `/rest/v1/team_invitations?id=eq.${encodeURIComponent(invitationId)}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
    ).catch(() => {});
    throw error;
  }

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
    invitation: { id: invitationId, email, full_name: fullName, role, client_id: clientId || null, group_ids: groupIds }
  };
}

async function memberInAgency(profile: Profile, memberId: string) {
  const matches = await adminRequest(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(memberId)}&agency_id=eq.${encodeURIComponent(profile.agency_id)}&select=id,email,role,client_id,is_active&limit=1`
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
  const platformAccess = await adminRequest(
    `/rest/v1/platform_staff?id=eq.${encodeURIComponent(memberId)}&is_active=eq.true&select=id&limit=1`
  ).catch(() => []);
  if (!isActive && platformAccess.length) return;
  await adminRequest(`/auth/v1/admin/users/${encodeURIComponent(memberId)}`, {
    method: 'PUT',
    body: JSON.stringify({ ban_duration: isActive ? 'none' : '876000h' })
  });
}

async function updateMember(profile: Profile, body: Record<string, unknown>) {
  const memberId = String(body.memberId || '');
  const role = body.role == null ? null : String(body.role);
  const clientId = role === 'client' ? String(body.clientId || '') : null;
  const isActive = body.isActive == null ? null : Boolean(body.isActive);
  const groupIdsProvided = Array.isArray(body.groupIds);
  if (!memberId) throw new HttpError(400, 'Membro inválido.');
  if (role !== null && !['admin', 'member', 'viewer', 'client'].includes(role)) {
    throw new HttpError(400, 'Nível de acesso inválido.');
  }

  const member = await memberInAgency(profile, memberId);
  assertCanManageMember(profile, member, role);
  const effectiveRole = role || member.role;

  if (role === 'client') {
    if (!clientId) throw new HttpError(400, 'Escolha o cliente deste acesso.');
    const clients = await adminRequest(
      `/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&agency_id=eq.${encodeURIComponent(profile.agency_id)}&select=id&limit=1`
    );
    if (!clients.length) throw new HttpError(400, 'O cliente escolhido não pertence a esta agência.');
  }
  const groupIds = groupIdsProvided || role === 'client' || (member.role === 'client' && role !== null)
    ? await validatedGroupIds(profile, effectiveRole, body.groupIds)
    : null;

  const changes: Record<string, unknown> = {};
  if (role !== null) {
    changes.role = role;
    changes.client_id = role === 'client' ? clientId : null;
  }
  if (isActive !== null) changes.is_active = isActive;
  if (!Object.keys(changes).length && groupIds === null) {
    throw new HttpError(400, 'Nenhuma alteração informada.');
  }

  if (isActive !== null) await setAuthActive(memberId, isActive);
  try {
    if (Object.keys(changes).length) {
      await adminRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(memberId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(changes)
      });
    }
    if (groupIds !== null) await replaceMemberGroups(profile, memberId, groupIds);
  } catch (error) {
    if (isActive !== null) await setAuthActive(memberId, !isActive).catch(() => {});
    throw error;
  }

  return {
    message: isActive === false
      ? 'Acesso desativado.'
      : isActive === true
        ? 'Acesso reativado.'
        : groupIdsProvided && role === null
          ? 'Grupos responsáveis atualizados.'
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

async function resendInvitation(request: Request, profile: Profile, body: Record<string, unknown>) {
  const invitationId = String(body.invitationId || '');
  if (!invitationId) throw new HttpError(400, 'Convite inválido.');
  const invitations = await adminRequest(
    `/rest/v1/team_invitations?id=eq.${encodeURIComponent(invitationId)}&agency_id=eq.${encodeURIComponent(profile.agency_id)}&status=eq.pending&select=id,email,full_name,role,client_id&limit=1`
  );
  const invitation = invitations?.[0];
  if (!invitation) throw new HttpError(404, 'Convite pendente não encontrado.');
  if (profile.role !== 'owner' && invitation.role === 'admin') {
    throw new HttpError(403, 'Somente o proprietário pode reenviar convites de administradores.');
  }

  const members = await adminRequest(
    `/rest/v1/profiles?agency_id=eq.${encodeURIComponent(profile.agency_id)}&email=ilike.${encodeURIComponent(invitation.email)}&select=id&limit=1`
  );

  if (members?.length) {
    await adminRequest(
      `/auth/v1/recover?redirect_to=${encodeURIComponent(recoveryRedirect(request))}`,
      {
        method: 'POST',
        body: JSON.stringify({ email: invitation.email })
      }
    );
    await refreshInvitationExpiry(invitation.id);
    return { message: `Novo link para criar a senha enviado para ${invitation.email}.` };
  }

  await adminRequest(
    `/auth/v1/invite?redirect_to=${encodeURIComponent(invitationRedirect(request))}`,
    {
      method: 'POST',
      body: JSON.stringify({
        email: invitation.email,
        data: {
          invitation_id: invitation.id,
          full_name: invitation.full_name
        }
      })
    }
  );
  await refreshInvitationExpiry(invitation.id);
  return { message: `Novo convite enviado para ${invitation.email}.` };
}

async function acceptInvitation(request: Request) {
  const user = await authenticatedUser(request);
  const profile = await profileForUser(user.id);
  const email = String(user.email || '').trim().toLowerCase();
  if (!email) throw new HttpError(400, 'O e-mail da conta autenticada não está disponível.');

  const invitations = await adminRequest(
    `/rest/v1/team_invitations?agency_id=eq.${encodeURIComponent(profile.agency_id)}&email=ilike.${encodeURIComponent(email)}&status=eq.pending&select=id&order=created_at.desc&limit=1`
  );
  const invitationId = String(invitations?.[0]?.id || '');
  if (!invitationId) return { accepted: true, updated: false };

  await adminRequest(`/rest/v1/team_invitations?id=eq.${encodeURIComponent(invitationId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'accepted', accepted_at: new Date().toISOString() })
  });
  return { accepted: true, updated: true };
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
    if (action === 'update_profile') {
      return json(request, 200, await updateProfile(request, body));
    }

    const { profile } = await managerContext(request);
    if (action === 'list') return json(request, 200, await listTeam(profile));
    if (action === 'invite') return json(request, 201, await inviteMember(request, profile, body));
    if (action === 'update_member') return json(request, 200, await updateMember(profile, body));
    if (action === 'resend_invitation') return json(request, 200, await resendInvitation(request, profile, body));
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
