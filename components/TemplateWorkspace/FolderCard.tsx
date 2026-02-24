/**
 * FolderCard – visual card for a template folder.
 * Shows folder name with rename/delete actions in a ⋮ menu.
 */

import { useState } from "react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Folder, MoreVertical, Pencil, Trash2, Check, X } from "lucide-react";
import type { Folder as FolderType } from "../../hooks/useFolders";

interface FolderCardProps {
  folder: FolderType;
  onClick: (folder: FolderType) => void;
  onRename: (folder: FolderType, newName: string) => Promise<void>;
  onDelete: (folder: FolderType) => Promise<void>;
  canManage?: boolean; // whether the current user can rename/delete
}

export function FolderCard({
  folder,
  onClick,
  onRename,
  onDelete,
  canManage = true,
}: FolderCardProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState(folder.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleRenameSubmit = async () => {
    if (!renameName.trim() || renameName.trim() === folder.name) {
      setRenaming(false);
      setRenameName(folder.name);
      return;
    }
    setBusy(true);
    await onRename(folder, renameName.trim());
    setBusy(false);
    setRenaming(false);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleRenameSubmit();
    if (e.key === "Escape") {
      setRenaming(false);
      setRenameName(folder.name);
    }
  };

  const handleDeleteConfirm = async () => {
    setBusy(true);
    await onDelete(folder);
    setBusy(false);
    setConfirmDelete(false);
  };

  return (
    <>
      <Card
        className="group relative border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer bg-gradient-to-br from-gray-50 to-white"
        onClick={() => !renaming && onClick(folder)}
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            {/* Folder icon */}
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
              <Folder className="h-5 w-5 text-amber-600" />
            </div>

            {/* Name / rename input */}
            <div
              className="flex-1 min-w-0"
              onClick={(e) => renaming && e.stopPropagation()}
            >
              {renaming ? (
                <div
                  className="flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Input
                    autoFocus
                    value={renameName}
                    onChange={(e) => setRenameName(e.target.value)}
                    onKeyDown={handleRenameKeyDown}
                    className="h-7 text-sm"
                    disabled={busy}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRenameSubmit();
                    }}
                    disabled={busy}
                  >
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenaming(false);
                      setRenameName(folder.name);
                    }}
                    disabled={busy}
                  >
                    <X className="h-3.5 w-3.5 text-gray-500" />
                  </Button>
                </div>
              ) : (
                <p className="text-sm font-semibold text-gray-800 truncate">
                  {folder.name}
                </p>
              )}
            </div>

            {/* Actions menu */}
            {canManage && !renaming && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  asChild
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onClick={(e) => e.stopPropagation()}
                >
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenameName(folder.name);
                      setRenaming(true);
                    }}
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(true);
                    }}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder "{folder.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This folder must be empty before it can be deleted. Templates
              inside must be moved first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={handleDeleteConfirm}
              disabled={busy}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
