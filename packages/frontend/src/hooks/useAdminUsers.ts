import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  globalRole: 'SUPER_ADMIN' | 'ADMIN' | 'SUPER_USER' | 'STANDARD_USER';
  createdAt: string;
  _count: { memberships: number };
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const res = await api.get<{ users: AdminUser[] }>('/admin/users');
      return res.data.users;
    },
  });
}

export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, globalRole }: { userId: string; globalRole: string }) => {
      const res = await api.put<{ user: AdminUser }>(`/admin/users/${userId}/role`, { globalRole });
      return res.data.user;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: async ({ userId, newPassword }: { userId: string; newPassword: string }) => {
      await api.post(`/admin/users/${userId}/reset-password`, { newPassword });
    },
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      await api.delete(`/admin/users/${userId}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });
}
