# Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Default-Deny Catch-All**: Every path not explicitly matched under `/databases/{database}/documents` denies all reads and writes.
2. **Verified Identity Required**: Every read/write requires `request.auth != null && request.auth.token.email_verified == true`.
3. **Strict PII Isolation**: User email PII lives exclusively in `/users/{userId}/private/{docId}`, readable/writable only by `isOwner(userId) || isAdmin()`.
4. **Master Gate on Subcollections**: Every operation on `/workspaces/{workspaceId}/records/{recordId}` verifies existence and ownership (`ownerUid == request.auth.uid || isAdmin()`) of the parent `/workspaces/{workspaceId}` document via `get()`.
5. **Immutable Ownership & Timestamps**: `id`, `ownerUid`, `workspaceId`, and `createdAt` cannot be modified after creation; `createdAt == request.time` on create and `updatedAt == request.time` on create/update.
6. **Admin Privilege Protection**: Non-admin users cannot self-assign `role: 'admin'`, modify `/b2b_packs/{packId}`, or read/modify another user's `/workspaces`, `/b2b_requests`, or `/users/{otherId}/private`.
7. **Secure List Queries**: Every `allow list` rule evaluates `resource.data.ownerUid == request.auth.uid || isAdmin()` without performing `get()` or `exists()` lookups.
8. **Terminal State Locking**: Once a `b2b_requests` document reaches `status == 'convertie'`, non-admin users cannot update it.

## 2. The "Dirty Dozen" Payloads (All Expected: `PERMISSION_DENIED`)
1. **Unauthenticated Workspace Read**: `get(/workspaces/ws_1)` with `auth = null`.
2. **Unverified Email Spoof Admin**: Write to `/b2b_packs/pack_essentiel` with `auth.token.email = 'oudakarim.lunacerame@gmail.com'`, `email_verified = false`.
3. **Self-Assigned Admin Role**: Create `/users/u1` with `role: 'admin'` by non-admin `u1`.
4. **Shadow Field Injection (Ghost Field)**: Create `/workspaces/ws_1` including extra field `isVerified: true`.
5. **Identity Spoofing on Workspace Create**: Create `/workspaces/ws_1` with `ownerUid: 'other_uid'` while signed in as `'u1'`.
6. **Cross-Tenant PII Read**: `get(/users/u2/private/profile)` signed in as non-admin `'u1'`.
7. **Orphaned Subcollection Record**: Create `/workspaces/missing_ws/records/rec_1` when parent workspace does not exist.
8. **ID Poisoning (Invalid Characters / Length)**: Create `/workspaces/bad$id!` with non-alphanumeric ID.
9. **Immutable Field Tampering**: Update `/workspaces/ws_1` changing `ownerUid` or `createdAt`.
10. **Client Timestamp Spoofing**: Create `/workspaces/ws_1` with `createdAt` set in the past instead of `request.time`.
11. **Unbounded Array / Invalid Deliverable Type**: Create `/b2b_packs/pack_x` with `deliverables: [123]` or `deliverables.size() > 20` (and as non-admin).
12. **Blanket List Scraping**: `list(/workspaces)` without `where('ownerUid', '==', uid)` by non-admin `'u1'`.
