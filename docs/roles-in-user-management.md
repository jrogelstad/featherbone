# Roles in user management — handover

*Written 2026-10-24 by a session that investigated this; rewritten the same
day by the session that built the first three pieces of it. Framework
3.0.0-alpha.2, Job Shop 2.3.0-alpha2.*

**Where this stands.** The tier badge and the instance-administrator grant are
merged (PR #290). Role auto-creation is merged (PR #291). The assigned-roles
tab is open as `feat/roles-in-user-management`. The slide-in roles pane, the
drag, and retiring the Job Shop **Settings → User Accounts** worksheet are
not built.

## What John asked for

Role assignment moves out of the Job Shop **Settings → User Accounts**
worksheet and into the Users screen (`#!/admin`):

- A **role management action** that slides a roles pane in from the right,
  where roles can be dragged onto users.
- The audit pane below the users grid becomes a **two-tab pane**, the second
  tab being the assigned roles of the selected user.
- Roles can be **added** from that tab too, as they can on the user account
  form today, and **removed** from it.
- Once that works, drop the remnants of the old paradigm: the User Accounts
  worksheet in the Job Shop Settings workbook.

John's own sequencing, which this document keeps: build the new path, prove
it, *then* retire the old one.

## Eliminating the User Account form

This is the goal the rest of the document serves, so it is worth being plain
about what "eliminate" costs and in what order it can happen.

The **form** is not the thing to delete. `UserAccount`'s default form `7781
"User Account (Common)"` is module **Common**, `is_default = true`, with twins
at `9728` (UserAccount, Core) and `9743` (Role, Core). Editing `7781` changes
every edition that loads `Common`, not just Job Shop, and the form is what
opens wherever a user account is referenced from a record — not only from the
Settings worksheet. What can go is the **route** to it as an administration
tool: the worksheet in the Settings workbook, and the framework's own `User
Administration` workbook (`"$workbook"._pk 226`, label "Admin", module Core),
which already carries `UserAccounts` and `Roles` sheets and is the second door
to the same paradigm.

What the form does today that the Users screen must do first:

| On the form | On the Users screen |
| --- | --- |
| Create a user account | **Done** — Add user (`createIdentity`) |
| Set a password | **Done** — Password |
| Disable / enable / unlock | **Done** — Status |
| `isSuper` checkbox | **Done** — Instance admin (PR #290) |
| Membership tab: add and remove roles | **`feat/roles-in-user-management`** |
| Contact details (name, phone, email) | **Done** — Edit |
| Force a password change at next sign-in | **Missing, and it is a behaviour difference, not just a missing control.** See below |
| Which instances a person reaches | **Done** — Grant (the form has no equivalent; this is new ground) |

**The password difference is worth being exact about.** Changing somebody's
password *on the form* runs the `UserAccount` before-trigger
(`scripts/services.js`), which sets `changePassword = true` on the instance
profile, so they are made to choose their own at next sign-in.
`admin.setPassword` on the Users screen goes to `manager.setPassword` and
writes the identity's hash in the manager; it never touches
`user_account.change_password`. `database.js` still reads that column at
deserialize and still exposes it as `changePassword`, so the flow is live —
the magic-link path (`server.js`) and `role.js` both use it.

So a password set from the Users screen does **not** force a change, and one
set from the form does. Retiring the form without closing this quietly drops
a security behaviour. It wants a "make them choose a new one" checkbox on the
Password dialog, writing `change_password` on the instance profile, and it is
the last thing to do before the worksheet can go.

**Then** `chore/retire-user-accounts-worksheet`, separately and last, because
removing the worksheet is more than removing a worksheet:

- The sheet's `form` is the token `"D"` — the **default** form. There is no
  custom form to delete.
- **`"$profiles"`** holds per-user saved workbook copies that shadow
  `"$workbook".default_config`. `jsøderlind` has a private 12-sheet copy of
  Settings including the User Accounts sheet. Clearing `default_config` will
  not remove it for him.
- **Do not remove the `membership` property from the feather.** It is the
  storage (see below), and feather properties are a positional child array —
  the known defect where an inserted property takes the displaced one's type
  means a removal is at least as hazardous.
- The worksheet carries a HelpLink to `/help/job-shop-help.html#user-accounts`
  which would be orphaned. The admin screens are not workbooks, so they have
  no help links at all today.
- The workbook golden snapshots will move and must be regenerated locally with
  Job Shop installed — never from a cloud database.

## What is actually there now

**`UserAccount` inherits `Role`.** The feather's `inherits` is literally
`Role`, and `UserAccount` declares no roles property of its own. The
`membership` child array comes from `RoleMembership.parent.childOf =
"membership"` on `Role`, and `UserAccount` picks it up through Postgres table
inheritance — a `user_account` row *is* a `role` row. So the child relation is
**not a remnant to delete; it is the storage.** What can be retired is the
route to it. It is also why `tableoid::regclass::text = 'role'` is how the new
code tells a group role from somebody's account.

**The membership row hangs off the member and names the group.**
`role_membership._parent_role_pk` points at the member (a `user_account` row
or a group `role` row — same inheritance tree), and `role` holds the group's
**name as text**, with no foreign key.

**Live state in `demo`** (read-only, 2026-10-24): 7 live `user_account` rows,
15 group roles (all `is_login` false), 22 `role` rows via inheritance, 31 live
`role_membership` rows. Two `role_membership` rows are orphaned — parent `_pk
10435` was hard-deleted.

## Four things that shaped the design

**1. Direct roles are not effective roles.** Membership nests, and
`tools.memberNames` resolves it with a recursive CTE. In `demo`, `jsøderlind`
has 2 direct roles (`administrator`, `everyone`) and **14 effective**, because
`administrator` is itself a member of the other 13. `mboucher` has 6 and 6.

Showing 2 understates what he can do; offering Remove on all 14 offers 12
buttons that do nothing. **Built as:** the walk carries its first hop with it,
so each role comes back saying how it was come by — `isDirect`, or `via`
naming the direct membership it arrived through. The tab shows inherited ones
in a muted second style with Remove disabled and a title saying which role to
edit instead.

**2. Roles are per-instance; the Users screen is per-organization.**
`role`/`role_membership` live in each instance database; identities live in
the manager with grants to any number of instances. **Built as:** everything
is scoped to the instance the screen is served from, and the tab is labelled
"Roles in \<instance\>" so it says which.

**3. Child CRUD bypasses authorization.** `crud.doUpdate` executes queued
children with `isChild = true` and leaves `isSuperUser` undefined, so every
child-level check short-circuits — `doInsert`'s guard is `if (!isChild &&
isSuperUser === false)`, and `doUpdate`/`doDelete` test `if (isSuperUser ===
false)`, which `undefined` fails. The only gate is `canUpdate` on the parent
user account, so anyone who can update a user account can add any membership
to it, including `administrator`, including to themselves.

**Still true, and not fixed by this work** — it is general to all `parentOf`
children. What the new routes do is not rely on it: they write the row
themselves and audit it. The bypass stops mattering for roles only when the
form's Membership tab is no longer a route to it.

**4. `administrator` is load-bearing and you can lock yourself out.**
`database.js` hard-codes a `role_membership` join against the literal
`'administrator'` to compute the session's `is_admin`, which feeds
`isAdmin`/`canAdminister` in `client/main.js` and gates the ribbon's Settings,
Users and Instances buttons. **Built as:** `setRoleMembership` refuses to take
your own `administrator` away, and says another administrator can.

## What is built

### Merged: the tier badge and the instance-administrator grant (PR #290)

All three ADR-001 tiers were in the infrastructure but only two could be
appointed. `user_account.is_super` — unrestricted inside one instance and
nowhere else — was a checkbox on the User Account form and nothing else.

- The badge is **platform / organization / admin**. It used to say "admin" for
  the organization tier, naming the wider authority with the narrower word.
  "admin" is now the instance tier.
- `setInstanceAdmin` + `POST /:db/admin/identity/instance-admin`, scoped to
  the signed-in instance, audited as
  `identity.instance_admin_granted`/`_revoked`. Refuses an organization or
  platform administrator (both carry the flag already — `setOrgAdmin` raises
  it in every instance the organization owns — so revoking would be undone by
  the appointment behind it), refuses somebody with no live grant to the
  instance, and refuses an organization reached by break-glass. The instance
  write happens before the audit row and in the same transaction, so a flag
  that cannot be written leaves no trail claiming it was.
- `instanceContacts` reads `is_super` alongside the contact details and
  `withContact` puts it on the identity as `isInstanceAdmin`, left
  **undefined** where there is no profile so the screen can tell "no" from
  "not known here".
- The organization and platform buttons were renamed to match the badge's
  vocabulary: "Organization admin"/"Revoke organization", "Platform
  admin"/"Revoke platform".

**Who may appoint one: organization and platform only**, matching
`setOrgAdmin`. This is a judgement, not a requirement — see the open questions.

### Merged: roles named by authorizations are created (PR #291)

Asked directly: are roles created when a feather's or a workbook's
authorizations name them? **They were not, and the two paths failed in
opposite ways.** Proved on a live install before changing anything:

- A feather's authorizations carry `isSilentError`, so a role that is not
  there **drops the grant without a word**. The module installs, the table is
  made, and the privilege it declared is simply absent.
- A workbook's do not, so the same declaration **rejects with `Role "x" not
  found` and fails the whole install**.

Now they are created where they are declared, the way
`services/installer.js` creates a navigation category a package names.
`saveAuthorization` takes `isAutoCreateRole`, set by `saveFeather` and by
`saveWorkbooks` and by nothing else; a grant typed by hand at a record still
refuses, so a misspelling on the Feather form does not quietly become a role.

Two things that work ran into, both worth remembering:

- **The Core bootstrap runs `feathers-bootstrap.json` twice**, once before
  `populate.js` and once after, and on the first pass there is no `everyone`
  and no administrator `user_account` row. Creating the role on that pass does
  not help the grant along — it carries execution into the checks below the
  role lookup, which read `user_account` by way of `tools.isSuperUser`, and
  fails the install. Two different failures came from getting this wrong. So
  auto-creation asks first whether the database has **any** role at all; one
  with none is still being built, and the second pass applies the grant as it
  always did.
- **`populate.js` `checkEveryone` read the role table and then inserted
  `everyone` whatever it found.** It honoured its own check only by the
  accident that nothing created `everyone` earlier. Something does now. Fixed
  to the shape of `createRoleEveryone` beside it, which always honoured its.

### Open: the assigned-roles tab (`feat/roles-in-user-management`)

Steps 1 and 2 of the order below. Rebased onto master after PR #290.

- `identityRoles` + `POST /:db/admin/identity/roles` — the selected person's
  roles in this instance, each marked direct or `via`, plus `available`
  (worked out server-side, so the picker cannot offer something already held
  and then fail on it).
- `setRoleMembership` + `POST /:db/admin/identity/role` — add or remove a
  **direct** membership. Writes `role_membership` itself rather than going
  through `/data` CRUD, for the reasons in point 3 above and because a
  privilege handed out deserves a record, which CRUD does not write. Removal
  is a soft delete, which is what every reader of that table already filters
  on. Audited as `role.membership_granted`/`_revoked`, and only where
  something actually moved.
- Assignment only. The role must exist and be a group role, not somebody's
  account.
- The pane below the users is two tabs, built from the form tab strip
  (`.fb-form-tabs` / `.fb-group-tab`) so it looks like the tabs on a form. The
  roles tab has its own toolbar over its own list — a picker and Add, and a
  Remove that acts on the selected row — the way the platform console's panels
  do rather than a button in every row.

## What is left, in order

3. **The slide-in pane.** Build it as a generic `fb-side-pane`, not
   admin-specific — it will be wanted again for the ribbon work. The page
   needs restructuring into a full-height flex column first; the platform
   console's `.fb-platform-page` is the precedent John already approved.
   Honour `prefers-reduced-motion`, as the dialog slide does.
4. **"Make them choose a new password" on the Password dialog** — writing
   `user_account.change_password` on the instance profile. The last thing the
   form does that the screen does not, and a behaviour difference rather than
   a missing convenience (see above).
5. **`chore/retire-user-accounts-worksheet`**, separately and last.

**On drag and drop.** It is already a house idiom — four hand-rolled
implementations: table-widget column reorder and resize, workbook-page tab
reorder, the ribbon's drag-a-sheet-here-to-delete bin (`fb-rb-drop`), and the
image-upload drop zone. There is no shared abstraction. All four reorder one
list or accept a file — **dragging a record between two lists would be a
first**, and this one grants a privilege, so it wants a snackbar saying what
happened and an audit row, not a silent drop.

Direction matters. Drag is role → user, which is "roll one new role out to
several people". The common case is user → role — onboarding somebody who
needs six roles, which `mboucher` actually is. **So the tab's Add was built
first and drag is the garnish**, and the tab body itself should be the drop
target: far more forgiving than a row in a 40vh scroll box with a sticky
header.

While in the area: `relation-widget.js` wires `ondrop`, `ondragover`,
`ondragenter` and `ondragleave` to handlers that were never defined — the only
definitions sit inside a block comment in `resource-link-relation.js`. Dead
wiring, safe to delete.

## Decisions still needed from John

1. **Who may assign a role?** Built as: **instance administrator and up**,
   because a tenant super user already bypasses authorization inside the
   instance, so refusing them here would be stricter than the form they are
   replacing. One line in `setRoleMembership` either way.
2. **Who may appoint an instance administrator?** Built as: **organization and
   up**, matching `setOrgAdmin`. The argument for loosening it to instance
   administrators is that the User Account form lets a super user set
   `is_super` today, so retiring the form narrows what they can do. The
   argument against is that it lets the tier appoint itself. One line in
   `setInstanceAdmin`.
3. **Audit tab scope** — stays organization-wide "Recent changes", or filters
   to the selected user? Recommended: filter it, with an "all changes" state
   when nothing is selected. `admin_audit` already carries
   `_target_identity_identity_pk`, so this is a small change to
   `manager.auditTrail`, which currently takes only organization and limit.
   Not built; the tab is still organization-wide.
4. **Do the three Membership form tabs go**, or stay one release as the
   fallback?
5. **Should `role_membership` get a foreign key?** `"$auth".role` and
   `role_membership.role` are both name-keyed text with no FK, and `dropRole`
   deletes `"$auth"` rows by role name, so **renaming or deleting a role
   silently breaks authorizations**. The new routes assign only, which avoids
   making this worse, but it is still true.

## Notes for whoever picks this up

- **Push target is `jrogelstad/featherbone`**, and **deliver by branch only** —
  do not write into John's local checkout (he runs several sessions at once
  and the writes collide; see the project skill, PR #289). The device bridge
  is still fine for reading.
- **A local Postgres is worth the ten minutes** for anything touching install
  or authorization. Postgres 16 in `/var/lib/pgtest`, `node install.js
  --manager` then `--instance demo`, and the dev server on 3003; headless
  Chromium and Playwright are already in the cloud container, so the screen
  can be driven and read for real. Both auto-create failures above were found
  that way and would not have been found by reading.
- `npm run test:unit` is 427 pass / **1 pre-existing fail** — the suite's own
  `jslint: every project file` test flags `scripts/dev/load.js` at 24 warnings
  with 0 allowed. That test is the right lint check to use; don't hand-roll
  one. The API suite cannot run in the cloud sandbox for want of Job Shop and
  SupplyChain.
- The lint baseline is per file and only ever lowered. A new warning in a file
  that already has some fails the run, so diff the warnings before and after
  rather than reading the count.
- Both admin screens are absent from `client/clientmin.js`, so anything here
  needs `"debug": true` until that bundle is rebuilt. A `server/` change needs
  a process restart; `debug` only affects how the client is served.
