/**
 * React hook for group management operations against the backend API.
 */

import { useState, useEffect, useCallback } from "react";
import { getValidToken } from "../utils/authUtils";

// ==========================================
// Types
// ==========================================

export interface Group {
    id: string;
    name: string;
    description: string | null;
    created_by: string;
    created_at: string;
    updated_at: string;
    member_count?: number;
    user_role?: string;
}

export interface GroupMember {
    user_id: string;
    email?: string;
    display_name?: string;
    avatar_url?: string;
    role: string;
    joined_at: string;
}

export interface GroupDetail extends Group {
    members: GroupMember[];
}

export interface CreateGroupData {
    name: string;
    description?: string;
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
        } catch { }
        throw new Error(message);
    }

    if (res.status === 204) return undefined as T;
    return res.json();
}

// ==========================================
// useGroups hook
// ==========================================

export function useGroups() {
    const [groups, setGroups] = useState<Group[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchGroups = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await apiRequest<Group[]>("/groups");
            setGroups(data);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchGroups();
    }, []);

    const createGroup = async (data: CreateGroupData): Promise<Group> => {
        const result = await apiRequest<Group>("/groups", {
            method: "POST",
            body: JSON.stringify(data),
        });
        await fetchGroups();
        return result;
    };

    const getGroupDetail = async (id: string): Promise<GroupDetail> => {
        return apiRequest<GroupDetail>(`/groups/${id}`);
    };

    const updateGroup = async (
        id: string,
        data: Partial<CreateGroupData>
    ): Promise<Group> => {
        const result = await apiRequest<Group>(`/groups/${id}`, {
            method: "PUT",
            body: JSON.stringify(data),
        });
        await fetchGroups();
        return result;
    };

    const deleteGroup = async (id: string): Promise<void> => {
        await apiRequest<void>(`/groups/${id}`, { method: "DELETE" });
        await fetchGroups();
    };

    const addMember = async (
        groupId: string,
        userId: string,
        role: string = "member"
    ): Promise<void> => {
        await apiRequest<any>(`/groups/${groupId}/members`, {
            method: "POST",
            body: JSON.stringify({ user_id: userId, role }),
        });
    };

    const updateMemberRole = async (
        groupId: string,
        userId: string,
        role: string
    ): Promise<void> => {
        await apiRequest<any>(`/groups/${groupId}/members/${userId}`, {
            method: "PUT",
            body: JSON.stringify({ role }),
        });
    };

    const removeMember = async (
        groupId: string,
        userId: string
    ): Promise<void> => {
        await apiRequest<void>(`/groups/${groupId}/members/${userId}`, {
            method: "DELETE",
        });
    };

    const searchUsers = async (
        query: string,
        groupId?: string
    ): Promise<UserSearchResult[]> => {
        const params = new URLSearchParams({ q: query });
        if (groupId) params.append("group_id", groupId);
        return apiRequest<UserSearchResult[]>(
            `/groups/users/search?${params.toString()}`
        );
    };

    return {
        groups,
        loading,
        error,
        fetchGroups,
        createGroup,
        getGroupDetail,
        updateGroup,
        deleteGroup,
        addMember,
        updateMemberRole,
        removeMember,
        searchUsers,
    };
}

export interface UserSearchResult {
    user_id: string;
    display_name?: string;
    email?: string;
    avatar_url?: string;
}
