# Roles in user management — handover

*Written 2026-10-24, from a session that investigated but did not build this.
Framework 3.0.0-alpha.2, Job Shop 2.3.0-alpha2. Nothing in this document is
built; the only code that landed in that session was ADR-001 revision 5 /
plan item G.5 and the Users-screen tier badge, both of which this work
depends on.*

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

## What is actually there now

**`UserAccount` inherits `Role`.** The feather's `inherits` is literally
`Role`, and `UserAccount` declares no roles property of its own. The
`membership` child array comes from `RoleMembership.parent.childOf =
"membership"` on `Role`, and `UserAccount` picks it up through Postgres table
inheritance — a `user_account` row *is* a `role` row. So the child relation is
**not a remnant to delete; it is the storage.** What can be retired is the
route to it.

**The membership row hangs off the member and names the group.**
`role_membership._parent_role_pk` points at the member (a `user_account` row
or a group `role` row — same inheritance tree), and `role` holds the group's
**name as text**, with no foreign key. Confirmed by the two places that write
it: `server/database.js` `makeProfile` and the provisioning path in
`server/services/admin.js`, both inserting `_parent_role_pk = <the
user_account pk>, role = 'everyone'`.

**Assignment is therefore one small insert**, which is good news for the
build. `role_membership` has **no trigger, no service function and no audit
row**; `grantMembership`/`revokeMembership` are gone from the repo entirely.

**Live state in `demo`** (read-only, 2026-10-24): 7 live `user_account` rows,
15 group roles (all `is_login` false), 22 `role` rows via inheritance, 31 live
`role_membership` rows. The path is populated, not orphaned. Two
`role_membership` rows are orphaned — parent `_pk 10435` was hard-deleted.

## Four things that will shape the design

**1. Direct roles are not effective roles.** Membership nests, and
`tools.memberNames` resolves it with a recursive CTE. In `demo`,
`jsøderlind` has 2 direct roles (`administrator`, `everyone`) and **14
effective**, because `administrator` is itself a member of the other 13.
`mboucher` has 6 direct and 6 effective.

A tab showing 2 for jsøderlind is misleading — he can do everything. Showing
14 is honest but 12 of them cannot be removed from there; you would have to
edit `administrator`. **The tab must show direct memberships as removable and
inherited ones as a muted second group annotated "via administrator".** A
Remove button that silently does nothing is the worst available outcome.

Note also that `memberNames` only adds `'everyone'` when an active,
non-deleted `user_account` row exists for the name.

**2. Roles are per-instance; the Users screen is per-organization.**
`role`/`role_membership` live in each instance database. Identities live in
the manager, with grants to any number of instances — `jtaylor` is granted
both `demo` and `tracker`. So "the assigned roles of the selected user" needs
an instance named on it. **Scope the tab to the instance you are signed in to
and say so in the tab label or pane title.** Showing every instance means
opening pools into each one; not worth it yet.

**3. Child CRUD bypasses authorization.** `crud.doUpdate` executes queued
children with `isChild = true` and leaves `isSuperUser` undefined
(`crud.js:2501-2503`), so every child-level check short-circuits —
`doInsert`'s guard is `if (!isChild && isSuperUser === false)`, and
`doUpdate`/`doDelete` test `if (isSuperUser === false)`, which `undefined`
fails. The only gate is `canUpdate` on the parent user account.

So anyone who can update a user account can add any membership to it,
including `administrator`, including to themselves. Today `everyone` is
read-only on `UserAccount` in `demo` so nobody ordinary can reach it, and
`feather_authorization` has **no row at all for `RoleMembership`**. But grant
`canUpdate` on user accounts to any role — and `human_resource_manager`
exists — and that role can self-promote. It is pre-existing and general to
all `parentOf` children, but roles are where it has teeth.

**This is the argument for audited admin routes over datasource CRUD**, and
it is also why retiring the form's Membership tab stops being a tidiness
question.

**4. `administrator` is load-bearing and you can lock yourself out.**
`database.js:1070` hard-codes a `role_membership` join against the literal
`'administrator'` to compute the session's `is_admin`, which feeds
`isAdmin`/`canAdminister` in `client/main.js:1266-1281` and gates the ribbon's
Settings, Users and Instances buttons. Removing `administrator` from yourself
in the new pane removes your way back to the pane. **Refuse to remove the last
membership that grants the acting user `is_admin`.**

## What I would build, in this order

1. **`feat/roles-in-user-management`** — admin-service routes: list the
   instance's roles, add and remove a *direct* membership, tier-checked and
   written to `admin_audit`. Resolve direct-versus-inherited server side so
   the client does not reimplement the CTE. `admin.js` has no roles endpoint
   today and `that.overview` is the page's only read, returning `{actor,
   audit[], identities[], instance, instances[], organization{},
   organizations[], tier}` — adding `roles[]` there keeps the page's
   one-request shape and its "the server decides what you may see" property.
2. **The two-tab bottom pane.** Reuse the existing form tab strip
   (`.fb-form-tabs` / `.fb-group-tab` / `.fb-group-tab-active`) so it matches
   forms. Tab 1 the audit trail, tab 2 assigned roles with Add and Remove.
3. **The slide-in pane.** Build it as a generic `fb-side-pane`, not
   admin-specific — it will be wanted again for the ribbon work. The page
   needs restructuring into a full-height flex column first; the platform
   console's `.fb-platform-page` is the precedent John already approved.
   Honour `prefers-reduced-motion`, as the dialog slide does.
4. **`chore/retire-user-accounts-worksheet`**, separately and last. See below.

**On drag and drop.** It is already a house idiom — four hand-rolled
implementations: table-widget column reorder and resize, workbook-page tab
reorder, the ribbon's drag-a-sheet-here-to-delete bin (`fb-rb-drop`), and the
image-upload drop zone. There is no shared abstraction; each copies its own
`ondragstart`/`ondragover`/`ondrop` onto its own view model. But all four
reorder one list or accept a file — **dragging a record between two lists
would be a first**, and this one grants a privilege, so it wants a snackbar
saying what happened and an audit row, not a silent drop.

Direction matters. Drag is role → user, which is "roll one new role out to
several people". The common case is user → role — onboarding somebody who
needs six roles, which `mboucher` actually is. **So build the tab's Add first
and treat drag as the garnish**, and make the tab body itself a drop target:
a far more forgiving one than a row in a 40vh scroll box with a sticky header.

While in the area: `relation-widget.js:830-833` wires `ondrop`, `ondragover`,
`ondragenter` and `ondragleave` to handlers that were never defined — the only
definitions sit inside a block comment in `resource-link-relation.js`. Dead
wiring, safe to delete.

**The cheap option, for the record.** `child-table.js` is a reusable to-many
widget — Add, Remove, Undo, Open, Up/Down — and it is exactly what renders the
Membership tab today, with the `role` column fed by the client-side
`roleNames` datalist in `client/models/role.js` (which already filters out
`UserAccount`-type rows, so only group roles are offered). Embedding it in tab
2 would be very little code. It goes through `/data` CRUD though, so: no audit
row, the bypass above, and saving a UserAccount fires `triggersUserAccount`,
which PATCHes `Employee.userAccount` and dereferences `newRec.contact.id`
unguarded. Hand-built plus audited routes is the better trade.

## What retiring the worksheet actually costs

More than the worksheet, and it is why that is its own branch:

- The sheet's `form` is the token `"D"` — the **default** form. There is no
  custom form to delete. The Membership tab lives on form `7781 "User Account
  (Common)"`, module **Common**, `is_default = true`, with twins at form
  `9728` (UserAccount, Core) and `9743` (Role, Core). Remove the sheet and the
  roles grid still appears wherever a user account is opened; edit `7781` and
  you change every edition that loads `Common`, not just Job Shop.
- **`"$profiles"`** holds per-user saved workbook copies that shadow
  `"$workbook".default_config`. `jsøderlind` has a private 12-sheet copy of
  Settings including the User Accounts sheet. Clearing `default_config` will
  not remove it for him.
- The framework's **own** `User Administration` workbook (`"$workbook"._pk
  226`, label "Admin", module Core) already has `UserAccounts` and `Roles`
  sheets. Its `category` is null so it is uncategorised in the ribbon, but it
  is a second door to the same paradigm and arguably the one that conflicts
  with the new screen.
- **Do not remove the `membership` property from the feather.** It is the
  storage, and feather properties are a positional child array — the known
  defect where an inserted property takes the displaced one's type means a
  removal is at least as hazardous.
- The worksheet carries a HelpLink to `/help/job-shop-help.html#user-accounts`
  which would be orphaned. The admin screens are not workbooks, so they have
  no help links at all today.
- The workbook golden snapshots will move and must be regenerated locally with
  Job Shop installed — never from a cloud database.
- `"$auth".role` and `role_membership.role` are both name-keyed text with no
  FK, and `dropRole` deletes `"$auth"` rows by role name. **Renaming or
  deleting a role silently breaks authorizations**, so the pane should assign
  only.

## Decisions still needed from John

1. **Audit tab scope** — stays organization-wide "Recent changes", or filters
   to the selected user? Recommended: filter it, with an "all changes" state
   when nothing is selected. `admin_audit` already carries
   `_target_identity_identity_pk`, so this is a small change to
   `manager.auditTrail`, which currently takes only organization and limit.
2. **Assign only, or create roles too?** Recommended: assignment only. Role
   definition, nesting and authorizations stay on the Role form, for the
   name-keyed-text reason above.
3. **Who may assign?** Now answerable from the tier hierarchy settled in
   ADR-001 revision 5 — platform, organization, instance. Is instance
   administrator and up enough, or organization and up?
4. **Do the three Membership form tabs go**, or stay one release as the
   fallback?

## Notes for whoever picks this up

- **Push target is `jrogelstad/featherbone`**, not the org repo — the fork is
  where the work lives until a release, and the org repo lagged it by 483
  commits on 2026-10-24. Start the session with the fork as its source;
  a session holding `featherbonejs/featherbone` cannot attach it as well,
  because both repos are named `featherbone` and share one checkout path.
- The session that wrote this had no `device_bash`, so local delivery went
  through `device_stage_files` → edit in the cloud → `device_commit_files`
  with `expectedMtimeMs`, re-staging and byte-diffing afterwards. Check the
  tool list first; in-place editing is far cheaper when it is available.
- `npm run test:unit` is 427 pass / **1 pre-existing fail** — the suite's own
  `jslint: every project file` test flags `scripts/dev/load.js` at 24 warnings
  with 0 allowed. That test is the right lint check to use; don't hand-roll
  one. The API suite cannot run in the cloud sandbox for want of Job Shop and
  SupplyChain.
- Both admin screens are absent from `client/clientmin.js`, so anything here
  needs `"debug": true` until that bundle is rebuilt. A `server/` change needs
  a process restart; `debug` only affects how the client is served.
