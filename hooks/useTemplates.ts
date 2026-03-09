/**
 * React hooks for template CRUD operations against the backend API.
 */

import { useState, useEffect, useCallback } from "react";
import { getValidToken } from "../utils/authUtils";

// ==========================================
// Types
// ==========================================

export interface TemplateEntity {
  name: string;
  prompt: string;
}

export interface TemplateVariable {
  name: string;
  description?: string;
  default?: string;
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  study_type: string | null;
  scope: string;
  owner_user_id: string | null;
  owner_group_id: string | null;
  system_prompt: string | null;
  entities: TemplateEntity[];
  summary_prompt: string | null;
  variables: TemplateVariable[];
  tags: string[];
  is_immutable: boolean;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  can_edit: boolean | null;
  is_owner: boolean | null;
  group_name?: string | null;
  folder_id?: string | null;
}

export interface TemplateVersion {
  id: string;
  template_id: string;
  version: number;
  system_prompt: string | null;
  entities: TemplateEntity[];
  summary_prompt: string | null;
  variables: TemplateVariable[];
  changed_by: string | null;
  change_summary: string | null;
  created_at: string;
}

export interface TemplatePermission {
  id: string;
  template_id: string;
  user_id: string;
  can_read: boolean;
  can_write: boolean;
  granted_by: string | null;
  created_at: string;
}

export interface CreateTemplateData {
  name: string;
  entities: TemplateEntity[];
  scope?: string;
  owner_group_id?: string;
  description?: string;
  study_type?: string;
  system_prompt?: string;
  summary_prompt?: string;
  variables?: TemplateVariable[];
  tags?: string[];
  is_immutable?: boolean;
  folder_id?: string | null;
}

export interface UpdateTemplateData {
  name?: string;
  description?: string;
  study_type?: string;
  system_prompt?: string;
  entities?: TemplateEntity[];
  summary_prompt?: string;
  variables?: TemplateVariable[];
  tags?: string[];
  is_immutable?: boolean;
  change_summary?: string;
  folder_id?: string | null;
}

export interface TemplateFilters {
  scope?: string;
  study_type?: string;
  search?: string;
  tags?: string;
}

// ==========================================
// API helpers
// ==========================================

async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getValidToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const json = JSON.parse(text);
      message = json.detail || json.message || text;
    } catch {}
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// ==========================================
// useTemplates hook
// ==========================================

export function useTemplates(initialFilters?: TemplateFilters) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TemplateFilters>(initialFilters || {});

  const fetchTemplates = useCallback(
    async (f?: TemplateFilters) => {
      setLoading(true);
      setError(null);
      try {
        const activeFilters = f || filters;
        const params = new URLSearchParams();
        if (activeFilters.scope) params.set("scope", activeFilters.scope);
        if (activeFilters.study_type)
          params.set("study_type", activeFilters.study_type);
        if (activeFilters.search) params.set("search", activeFilters.search);
        if (activeFilters.tags) params.set("tags", activeFilters.tags);
        params.set("limit", "100");

        const qs = params.toString();
        const data = await apiRequest<Template[]>(
          `/templates${qs ? `?${qs}` : ""}`
        );
        setTemplates(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    fetchTemplates();
  }, []);

  const createTemplate = async (
    data: CreateTemplateData
  ): Promise<Template> => {
    const result = await apiRequest<Template>("/templates", {
      method: "POST",
      body: JSON.stringify(data),
    });
    await fetchTemplates();
    return result;
  };

  const updateTemplate = async (
    id: string,
    data: UpdateTemplateData
  ): Promise<Template> => {
    const result = await apiRequest<Template>(`/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    await fetchTemplates();
    return result;
  };

  const deleteTemplate = async (id: string): Promise<void> => {
    await apiRequest<void>(`/templates/${id}`, { method: "DELETE" });
    await fetchTemplates();
  };

  const forkTemplate = async (
    id: string,
    newName?: string
  ): Promise<Template> => {
    const result = await apiRequest<Template>(`/templates/${id}/fork`, {
      method: "POST",
      body: JSON.stringify({ new_name: newName }),
    });
    await fetchTemplates();
    return result;
  };

  const setImmutable = async (
    id: string,
    isImmutable: boolean
  ): Promise<void> => {
    await apiRequest<any>(`/templates/${id}/immutable`, {
      method: "PUT",
      body: JSON.stringify({ is_immutable: isImmutable }),
    });
    await fetchTemplates();
  };

  const changeScope = async (
    id: string,
    newScope: string,
    ownerGroupId?: string
  ): Promise<Template> => {
    const result = await apiRequest<Template>(`/templates/${id}/scope`, {
      method: "PUT",
      body: JSON.stringify({
        new_scope: newScope,
        owner_group_id: ownerGroupId,
      }),
    });
    await fetchTemplates();
    return result;
  };

  return {
    templates,
    loading,
    error,
    filters,
    setFilters,
    fetchTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    forkTemplate,
    setImmutable,
    changeScope,
  };
}

// ==========================================
// useTemplateVersions hook
// ==========================================

export function useTemplateVersions(templateId: string | null) {
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVersions = useCallback(async () => {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<TemplateVersion[]>(
        `/templates/${templateId}/versions`
      );
      setVersions(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    fetchVersions();
  }, [templateId]);

  const revertToVersion = async (version: number): Promise<Template> => {
    if (!templateId) throw new Error("No template selected");
    const result = await apiRequest<Template>(
      `/templates/${templateId}/revert/${version}`,
      { method: "POST" }
    );
    await fetchVersions();
    return result;
  };

  return { versions, loading, error, fetchVersions, revertToVersion };
}
