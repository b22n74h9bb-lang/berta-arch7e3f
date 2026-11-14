# WP2 — Home Screen PWA versus a dedicated local database

Status: proposal plus a test-branch ledger. This is not on production, and it is not an airplane-mode pass on the owner's iPhone.

Device, as reported by the owner on 13 Nov: iPhone 15 Pro Max, iOS 26.6.1, about 143 GB free. No Mac and no purchase is authorized, so a native iOS app cannot be built or shipped from this environment.

## What the Home Screen app does today

`public/sw.js` caches the application shell (`/`, the manifest, and the two icons). Navigation falls back to that cached page. Requests under `/api/` are not handled, so mission, chat, and AI fail without a network. Settings already says that. The ledger module is in the repo and is not mounted on the mission screen, so a deploy of `main` does not show offline notes.

## Option A — local ledger inside the existing PWA

This branch adds that ledger.

- Notes are written on device first, keyed by account id, and read back after a new store load.
- Each change has an operation id. The same id applied again, including after an acknowledgement, does not create a second note or a second send.
- A stale local revision, a gap in revisions, a concurrent remote edit, and a remote delete stay visible as conflicts. The local note is kept. A remote clock set in the future does not win when its revision is older. Two copies with the same revision and different text or delete state are a conflict too; an identical copy at that revision is ignored. A local edit from another account is an account conflict and does not take the note.
- A publish is a held action. `reconnect` returns pending note operations and the held list separately. It does not send or approve the publish, and a second hold with the same id does not replace the payload.
- Accounts are filtered on read and on export. The app shell does not mount this ledger, and logout does not read it. `clearLastAccount` only removes the pointer; it does not delete notes.
- The serialized ledger refuses a write over 1.5 MB and leaves the previous store untouched. A corrupt JSON value or a `version` other than 1 is rejected and not overwritten. A plaintext save refuses to replace a sealed ledger.
- The mission screen does not open this ledger when the server is down. A revoked session is handled by the existing access gate, not by this module.

Limits, stated plainly: the store is localStorage, not SQLCipher and not IndexedDB. A passphrase seals it with AES-GCM; without one, the notes stay unencrypted and the screen says so. The size cap is UTF-8 bytes. A newer remote edit or delete is kept as a visible conflict instead of replacing the local note. Offline launch still depends on the service worker having cached the shell during an earlier online visit. This branch does not change `sw.js`. There is no background sync, so a saved note is marked on device rather than pending sync. Server tasks, chat, and approvals are unchanged and still need the network. An airplane-mode test on the iPhone has not been run.

## Option B — dedicated iOS app and a local database

A SwiftData or SQLite store on the phone would give file protection, a larger attachment store, and a Files-app export that does not depend on Safari's storage. It needs Xcode, an Apple developer account, and a second client beside this PWA. None of that is available, and no purchase is authorized. It would also not, by itself, pass the sync rules above.

## Recommendation

Keep the owner on the Home Screen PWA. Use this ledger for offline notes and the sync rules, and move the same ledger to IndexedDB only if the 1.5 MB cap or Safari eviction fails a real airplane-mode test. Do not start a native app until that test fails for a reason the PWA cannot fix. Do not treat this branch as the 13 Nov demo. Production stays on `main` until a separate approval.
