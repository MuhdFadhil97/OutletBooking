import type {
  AcceptInviteNewAccount,
  InvitationInfo,
  MemberUpdate,
  StaffInvitation,
  StaffInviteInput,
  StaffListResponse,
  StaffMember,
} from '@outletbooking/shared';
import { apiFetch } from '@/lib/api';

// Owner
export const listStaff = () => apiFetch<StaffListResponse>('/staff');
export const inviteStaff = (body: StaffInviteInput) =>
  apiFetch<StaffInvitation>('/staff/invitations', { method: 'POST', json: body });
export const revokeInvitation = (id: number) => apiFetch<null>(`/staff/invitations/${id}`, { method: 'DELETE' });
export const updateMember = (memberId: number, body: MemberUpdate) =>
  apiFetch<StaffMember>(`/staff/${memberId}`, { method: 'PATCH', json: body });

// Invitee (public link)
export const getInvitation = (token: string) => apiFetch<InvitationInfo>(`/invitations/${encodeURIComponent(token)}`);
export const acceptInvitation = (token: string, body: AcceptInviteNewAccount | Record<string, never>) =>
  apiFetch<{ email: string; businessName: string }>(`/invitations/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
    json: body,
  });
