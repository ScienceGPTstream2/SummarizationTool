# Group Management

> *Groups are how reviewers share their work with colleagues. A group is a named set of users with roles — once a group exists, a reviewer can share a session or a template with it and every group member gets access. The Group Management page is where groups are created, members are added, and roles are managed.*

**Files:** `components/GroupManagement/GroupManagementPage.tsx`

**Hook:** `hooks/useGroups.ts`

---

## 1. UI sections

| Section | Purpose |
|---|---|
| Group list | All groups the reviewer belongs to, with their role badge |
| Create group button | Opens the create dialog |
| Group detail panel | Expanded view: name, description, member list |
| Add member dialog | Search users by email; set their role before adding |
| Member list | Shows each member's name, email, role, and join date |
| Member actions | Change role, Remove member |
| Edit group dialog | Rename group or update description |
| Delete group button | Owner-only; requires confirmation |

---

## 2. Roles

| Role | Permissions |
|---|---|
| `owner` | Full control: edit group, manage all members, delete group. Only one owner per group (the creator). |
| `admin` | Add/remove members, change member roles (up to admin). Cannot delete the group or change the owner. |
| `member` | View group and shared resources. Cannot manage members. |

Role rules enforced both in the UI (buttons are hidden or disabled based on the reviewer's role) and on the backend (`GroupService`).

---

## 3. Creating a group

```
Reviewer clicks "Create Group"
  │
  ▼
Dialog opens — enter name + optional description
  │
  ▼
POST /api/groups
  Body: { name, description }
  Returns: Group (with reviewer added as owner automatically)
  │
  ▼
Group appears in list with "owner" badge
```

---

## 4. Adding members

```
Owner/admin clicks "Add Member"
  │
  ▼
Search input — type email or name
  │
  GET /api/groups/users/search?q=...
  Returns: [{ id, email, name, image }]
  │
  ▼
Select user + choose role (member / admin)
  │
  ▼
POST /api/groups/{groupId}/members
  Body: { user_id, role }
```

A user must already have an account in the system to be added. Inviting by email address only works if the user has previously logged in.

---

## 5. Changing roles and removing members

```
PUT /api/groups/{groupId}/members/{userId}
  Body: { role: "admin" | "member" }

DELETE /api/groups/{groupId}/members/{userId}
```

Constraints enforced by the backend:
- The owner's role cannot be changed through this endpoint.
- The only owner cannot remove themselves (would leave the group ownerless).
- An admin cannot promote a member to owner.

---

## 6. State (via `useGroups` hook)

```typescript
const {
  groups,           // Group[] — all groups for current user
  loading,
  error,
  fetchGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  addMember,
  updateMemberRole,
  removeMember,
  searchUsers,
} = useGroups();
```

---

## 7. API calls

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/groups` | List reviewer's groups |
| `POST` | `/api/groups` | Create group |
| `GET` | `/api/groups/{id}` | Fetch group with members |
| `PUT` | `/api/groups/{id}` | Update name/description |
| `DELETE` | `/api/groups/{id}` | Delete group |
| `GET` | `/api/groups/{id}/members` | List members |
| `POST` | `/api/groups/{id}/members` | Add member |
| `PUT` | `/api/groups/{id}/members/{userId}` | Change member role |
| `DELETE` | `/api/groups/{id}/members/{userId}` | Remove member |
| `GET` | `/api/groups/users/search` | Search users by email/name |
