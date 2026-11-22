import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * Structural & Dirty-Dozen Security Contract Verification for firestore.rules
 */
const rules = fs.readFileSync('firestore.rules', 'utf8');

// 1. Verify Global Default-Deny Catch-All
assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);

// 2. Verify Verified Email Enforcement in isAdmin and writes
assert.match(rules, /request\.auth\.token\.email_verified == true/);

// 3. Verify Strict Path ID Guard on all single-doc paths
for (const pathVar of ['userId', 'workspaceId', 'recordId', 'packId', 'requestId', 'docId', 'accountId']) {
  assert.ok(rules.includes(`isValidId(${pathVar})`), `Missing isValidId guard for ${pathVar}`);
}

// 4. Verify No Blanket Reads and Query Enforcer on list rules
assert.doesNotMatch(rules, /allow read:\s*if isSignedIn\(\)/);
assert.doesNotMatch(rules, /allow list:\s*if isSignedIn\(\)/);
assert.match(rules, /allow list: if isVerified\(\) &&\s*\(resource\.data\.ownerUid == request\.auth\.uid \|\| isAdmin\(\)\)/);
assert.match(rules, /match \/vendor_portal\/\{docId\}/);
assert.match(rules, /match \/vendor_billing_docs\/\{docId\}/);
assert.match(rules, /match \/vendor_accounts\/\{accountId\}/);

// 5. Verify Master Gate exists() + get() on subcollection /records
assert.match(rules, /match \/records\/\{recordId\}/);
assert.match(rules, /exists\(\/databases\/\$\(database\)\/documents\/workspaces\/\$\(workspaceId\)\)/);

// 6. Verify PII split collection for users/{userId}/private/{docId}
assert.match(rules, /match \/private\/\{docId\}/);

// 7. Verify Array Bound & Type Checking on deliverables & billing items
assert.match(rules, /data\.deliverables\.size\(\) <= 20/);
assert.match(rules, /data\.deliverables\[0\] is string/);
assert.match(rules, /data\.items\.size\(\) <= 50/);
assert.match(rules, /data\.items\[0\] is map/);

// 8. Verify Server Timestamp & Immutable Fields Enforcement
assert.match(rules, /incoming\(\)\.createdAt == request\.time/);
assert.match(rules, /incoming\(\)\.updatedAt == request\.time/);
assert.match(rules, /incoming\(\)\.createdAt == existing\(\)\.createdAt/);
assert.match(rules, /incoming\(\)\.ownerUid == existing\(\)\.ownerUid/);

// 9. Verify Terminal State Lock on b2b_requests
assert.match(rules, /existing\(\)\.status != 'convertie'/);

console.log('firestore.rules Dirty-Dozen contract checks passed.');
