import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Project, EnvConfig, ProjectMember, RequirementDoc } from '../types';

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await api.get<{ projects: Project[] }>('/projects');
      return res.data.projects;
    },
  });
}

export function useProject(slug: string | undefined) {
  return useQuery({
    queryKey: ['project', slug],
    queryFn: async () => {
      const res = await api.get<{ projects: Project[] }>('/projects');
      const project = res.data.projects.find((p) => p.slug === slug);
      if (!project) throw new Error(`Project "${slug}" not found`);
      return project;
    },
    enabled: !!slug,
    staleTime: 1000 * 30,
  });
}

export function useProjectById(id: string | undefined) {
  return useQuery({
    queryKey: ['project-by-id', id],
    queryFn: async () => {
      const res = await api.get<{ project: Project }>(`/projects/${id}`);
      return res.data.project;
    },
    enabled: !!id,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      baseUrl?: string;
      color?: string;
    }) => {
      const res = await api.post<{ project: Project }>('/projects', data);
      return res.data.project;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useUpdateProject(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<Project>) => {
      const res = await api.put<{ project: Project }>(`/projects/${projectId}`, data);
      return res.data.project;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['project-by-id', projectId] });
    },
  });
}

export function useDeleteProject(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (confirmName: string) => {
      await api.delete(`/projects/${projectId}`, { data: { confirmName } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useProjectEnvConfigs(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-envs', projectId],
    queryFn: async () => {
      const res = await api.get<{ envs: EnvConfig[] }>(`/projects/${projectId}/envs`);
      return res.data.envs;
    },
    enabled: !!projectId,
  });
}

export function useCreateEnvConfig(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      name: string;
      baseUrl: string;
      username?: string;
      password?: string;
      isDefault?: boolean;
    }) => {
      const res = await api.post<{ env: EnvConfig }>(`/projects/${projectId}/envs`, data);
      return res.data.env;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-envs', projectId] });
    },
  });
}

export function useUpdateEnvConfig(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      baseUrl?: string;
      username?: string | null;
      password?: string | null;
      isDefault?: boolean;
    }) => {
      const res = await api.put<{ env: EnvConfig }>(`/projects/${projectId}/envs/${id}`, data);
      return res.data.env;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-envs', projectId] });
    },
  });
}

export function useDeleteEnvConfig(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/projects/${projectId}/envs/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-envs', projectId] });
    },
  });
}

export function useProjectMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-members', projectId],
    queryFn: async () => {
      const res = await api.get<{ members: ProjectMember[] }>(`/projects/${projectId}/members`);
      return res.data.members;
    },
    enabled: !!projectId,
  });
}

export function useAddMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, role }: { email: string; role: string }) => {
      const res = await api.post<{ member: ProjectMember }>(`/projects/${projectId}/members`, { email, role });
      return res.data.member;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project-members', projectId] });
    },
  });
}

export function useRemoveMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      await api.delete(`/projects/${projectId}/members/${userId}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project-members', projectId] });
    },
  });
}

export function useUpdateMemberRole(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await api.put<{ member: ProjectMember }>(`/projects/${projectId}/members/${userId}`, { role });
      return res.data.member;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project-members', projectId] });
    },
  });
}

export function useRequirementDocs(projectId: string | undefined) {
  return useQuery({
    queryKey: ['req-docs', projectId],
    queryFn: async () => {
      const res = await api.get<{ docs: RequirementDoc[] }>(`/projects/${projectId}/req-docs`);
      return res.data.docs;
    },
    enabled: !!projectId,
  });
}

export function useUploadReqDoc(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post<{ doc: RequirementDoc }>(
        `/projects/${projectId}/req-docs`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return res.data.doc;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['req-docs', projectId] });
    },
  });
}

export function useToggleReqDoc(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      await api.patch(`/projects/${projectId}/req-docs/${id}`, { isActive });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['req-docs', projectId] });
    },
  });
}

export function useDeleteReqDoc(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/projects/${projectId}/req-docs/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['req-docs', projectId] });
    },
  });
}

export interface UserSearchResult {
  id: string;
  name: string;
  email: string;
}

export function useUserSearch(projectId: string, query: string) {
  return useQuery({
    queryKey: ['user-search', projectId, query],
    queryFn: async () => {
      if (!projectId || query.trim().length < 2) return [];
      const res = await api.get<{ users: UserSearchResult[] }>(
        `/projects/${projectId}/users/search`,
        { params: { q: query.trim() } },
      );
      return res.data.users;
    },
    enabled: !!projectId && query.trim().length >= 2,
    staleTime: 10_000,
  });
}
