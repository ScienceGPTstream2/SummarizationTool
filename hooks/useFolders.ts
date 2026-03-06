/**
 * useFolders – React hook for template folder CRUD operations.
 */

import { useState, useCallback } from "react";
import { getValidToken } from "../utils/authUtils";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Folder {
    id: string;
    name: string;
    scope: string;
    owner_user_id: string | null;
    owner_group_id: string | null;
    parent_id: string | null;
    created_by: string | null;
    created_at: string;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useFolders() {
    const [folders, setFolders] = useState<Folder[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const apiRequest = useCallback(
        async (path: string, options: RequestInit = {}) => {
            const token = await getValidToken();
            const res = await fetch(path, {
                ...options,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                    ...(options.headers || {}),
                },
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.detail || `Request failed: ${res.status}`);
            }
            if (res.status === 204) return null;
            return res.json();
        },
        []
    );

    /** Fetch folders for a given scope and optional parent. */
    const fetchFolders = useCallback(
        async (scope: string, parentId?: string | null, ownerGroupId?: string | null) => {
            setLoading(true);
            setError(null);
            try {
                const params = new URLSearchParams({ scope });
                if (parentId) params.set("parent_id", parentId);
                if (ownerGroupId) params.set("owner_group_id", ownerGroupId);
                const data: Folder[] = await apiRequest(`/api/templates/folders?${params.toString()}`);
                setFolders(data);
                return data;
            } catch (err: any) {
                setError(err.message);
                return [];
            } finally {
                setLoading(false);
            }
        },
        [apiRequest]
    );

    /** Create a new folder. Returns the created folder. */
    const createFolder = useCallback(
        async (
            name: string,
            scope: string,
            parentId?: string | null,
            ownerGroupId?: string | null
        ): Promise<Folder | null> => {
            try {
                const folder: Folder = await apiRequest("/api/templates/folders", {
                    method: "POST",
                    body: JSON.stringify({
                        name,
                        scope,
                        parent_id: parentId ?? null,
                        owner_group_id: ownerGroupId ?? null,
                    }),
                });
                setFolders((prev) => [...prev, folder]);
                return folder;
            } catch (err: any) {
                setError(err.message);
                return null;
            }
        },
        [apiRequest]
    );

    /** Rename a folder in-place. */
    const renameFolder = useCallback(
        async (folderId: string, newName: string): Promise<Folder | null> => {
            try {
                const folder: Folder = await apiRequest(`/api/templates/folders/${folderId}`, {
                    method: "PATCH",
                    body: JSON.stringify({ name: newName }),
                });
                setFolders((prev) => prev.map((f) => (f.id === folderId ? folder : f)));
                return folder;
            } catch (err: any) {
                setError(err.message);
                return null;
            }
        },
        [apiRequest]
    );

    /** Delete a folder. Fails if not empty. */
    const deleteFolder = useCallback(
        async (folderId: string): Promise<boolean> => {
            try {
                await apiRequest(`/api/templates/folders/${folderId}`, { method: "DELETE" });
                setFolders((prev) => prev.filter((f) => f.id !== folderId));
                return true;
            } catch (err: any) {
                setError(err.message);
                return false;
            }
        },
        [apiRequest]
    );

    return {
        folders,
        loading,
        error,
        fetchFolders,
        /** Immediately clear the folder list (e.g. before navigating to a new context). */
        clearFolders: useCallback(() => setFolders([]), []),
        createFolder,
        renameFolder,
        deleteFolder,
    };
}
