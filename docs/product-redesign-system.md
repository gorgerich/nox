# Nox Product Redesign System

Status: planning baseline before UI implementation.

Goal: evolve Nox into a more useful, information-dense, daily messenger while preserving its current calm premium identity. This is not a Telegram clone. Nox should borrow proven messenger workflows, but keep its own visual language: restrained surfaces, compact glass only where useful, Inter typography, blue as action/status accent, low-noise hierarchy.

## Product Direction

Nox is a private messenger for people who open the app many times per day. The product must feel immediate, clear, secure, and calm.

Design target:

- Faster: primary workflows must be reachable in one tap from the expected context.
- More informative: each list row must answer who, what, when, and whether action is required.
- More scalable: the UI must work for 10 chats and for 500 chats without becoming noisy.
- More coherent: the same material, spacing, motion, and status rules must be shared across contacts, calls, chats, profiles, settings, onboarding, media, and admin surfaces.

Non-goals:

- Do not visually copy Telegram.
- Do not add decorative gradients, ambient blobs, or heavy shadows.
- Do not turn the app into an enterprise dashboard.
- Do not use motion that makes the task slower.

## Complete CJM

| Journey Stage | User Goal | Current Friction | Product System Fix |
| --- | --- | --- | --- |
| Install / open invite | Understand what Nox is and join safely | Auth and join exist, but onboarding has weak hierarchy between login, invite, recovery, and trust | One account-entry system: login first, invite join secondary but visible, recovery always visible, concise security copy |
| Create profile | Create login, password, username, avatar | Username step exists, but profile identity is not connected to later contact discoverability | Treat username/display name/avatar/bio as one identity setup flow, with clear “visible to others” labels |
| First app entry | Know what to do with an empty messenger | Empty states exist per screen but are local and inconsistent | Empty-state component system with one primary action and one secondary explanation |
| Find a person | Search, invite, accept request, open chat | Search and invite are split between plus menu, search page, contacts, and incoming request cards | Global “people flow”: search existing user, invite new user, requests, recent contacts |
| Daily triage | Scan chats quickly, see urgent/unread/muted/pinned | Chat list improved but still screen-specific; category names are technical | Dense chat list with clear unread, status, muted, pinned, draft, typing, media preview, and context filters |
| Open dialog | Enter chat immediately and know state | Route loading/cache work exists, but perceived transition has been fragile | Cache-first content and zero decorative loaders; keep visible old list only until chat shell is ready, not as a separate screen |
| Reply / send | Type, attach, voice/video note, edit/reply | Composer has many features, but actions are local and can feel crowded | Single composer system: attach left, input center, smart capture/send right, pending status near message not button |
| Consume media | View photo/video/round video, save/share | Media viewer works but has old uppercase/footer style and isolated controls | One media viewer language: dark immersive overlay, top close/save, compact file identity, gestures later |
| Call | Start or answer audio/video, stay connected | Call UI and background behavior have been touched; controls need product-level consistency | Call surface shares same overlay/control sizing, tap-to-hide chrome, clear network/battery state |
| Manage profile | Update avatar, name, username, bio, theme, devices, cache, security | Profile is feature-rich but has card density and hierarchy drift | Settings IA: identity, devices, appearance, security, data/cache, notifications, admin if available |
| Handle notifications | Subscribe, understand muted/unread/requests | Push is a card in profile; notification state is not visible in daily flows | Notification system visible where relevant: chat mute, request badge, push status in settings |
| Admin / governance | Track users, invites, recovery, audit | Admin exists but visual language is older and dense in a different way | Admin keeps utility density, but uses same list, segment, status badge, and action sheet primitives |

## Section Audit

### Contacts

Current UX problems: contacts are a plain list with a large header and no embedded search, request state, or invite context. Opening a contact creates/opens chat, which is correct, but the user cannot manage many contacts efficiently.

Missing functionality: fast search/filter, grouped recent/favorites, contact request status, invite entry point, contact rename/remove surface.

Information architecture issues: contacts, incoming requests, invite, and user discovery are split across chats/new, plus menu, contacts, and search.

Navigation issues: a user looking for “people” may bounce between contacts, chats search, and new chat.

Visual hierarchy issues: all contacts have equal weight; there is no distinction between online/recent/favorite/requested.

Scalability issues: with 100+ contacts, the flat list becomes slow to scan.

Mobile ergonomics issues: contact actions require row tap and network wait; no right-edge quick actions.

### Calls

Current UX problems: call history is functional but sparse. It shows direction and status, but the next action is not obvious enough.

Missing functionality: call back, video call back, missed-call grouping, call quality/network hints, background-call continuity affordance.

Information architecture issues: calls are isolated from chat history and user profile context.

Navigation issues: info action opens chat, but the row itself does not clearly choose between profile/chat/callback.

Visual hierarchy issues: missed calls should be visually stronger than normal completed calls.

Scalability issues: long call history needs grouping by day and repeated-caller collapsing.

Mobile ergonomics issues: the most likely action after a missed call is call back; it should be one thumb tap.

### Chats

Current UX problems: chat list is the core screen and already improved, but header, filters, plus menu, search entry, and row density are still not governed by one product system.

Missing functionality: custom folders later, archive visibility, stronger pinned/muted/important states, bulk management, stable instant-open behavior.

Information architecture issues: current folders All/Personal/Important/Unread are technical filters, not durable user contexts.

Navigation issues: plus menu mixes search, group creation, and invite; search is a separate dock action and a field, which can feel duplicated.

Visual hierarchy issues: unread, pinned, muted, draft, typing, message status, and request state need one priority order.

Scalability issues: for 100+ chats, four simple filters are not enough; search and pinned/recent grouping must carry more load.

Mobile ergonomics issues: row tap is good, swipe actions are useful, but top actions still consume attention.

### Search

Current UX problems: search page exists and has recent people/history, but search is mostly chat-local and list-local.

Missing functionality: unified results across chats, people, messages, media, links, and commands; clear “recent queries” management.

Information architecture issues: chat search, user search, message search, and contact discovery are separate concepts.

Navigation issues: search button in dock must always communicate scope: global search from main screens, chat search inside chat.

Visual hierarchy issues: recent people and recent queries should be clearly separated from live results.

Scalability issues: with many messages, results need grouping by type and recency.

Mobile ergonomics issues: focus should be immediate, keyboard safe-area should not hide tabs/results, cancel should be reachable.

### Profile

Current UX problems: profile is feature-rich and visually pleasant, but it uses large vertical spacing and mixes identity, settings, notifications, cache, security, and admin entry without a sharper hierarchy.

Missing functionality: profile completeness hints, clearer account visibility, per-device trust status, compact admin entry.

Information architecture issues: profile is both “my identity” and “settings root”; this is valid, but needs visible grouping.

Navigation issues: sub-screens replace main state inside one component; back behavior must feel native and predictable.

Visual hierarchy issues: avatar/name dominate more than daily settings need after first setup.

Scalability issues: more settings will make the main page too long unless grouped into compact rows.

Mobile ergonomics issues: dangerous actions and cache actions are low in scroll; they need strong grouping, not more size.

### Settings

Current UX problems: settings live inside profile, but each sub-screen can drift visually.

Missing functionality: notification details, privacy, data/cache, devices, security recovery, appearance previews, admin entry.

Information architecture issues: settings need consistent hierarchy: Account, Privacy/Security, Notifications, Data, Appearance, Admin.

Navigation issues: nested settings should use one header/back pattern, not local variants.

Visual hierarchy issues: primary rows should be compact; destructive/security actions should be visually grouped.

Scalability issues: as settings grow, one long list becomes hard; use grouped sections and search later.

Mobile ergonomics issues: toggles/actions must be right aligned and thumb reachable.

### Navigation

Current UX problems: bottom dock is compact and fixed, but the separate search circle and tab active state can steal width and focus.

Missing functionality: badges per tab, stateful search scope, contextual action handoff from dock to current screen.

Information architecture issues: primary nav is correct: Contacts, Calls, Chats, Profile. Search is a global action, not a tab.

Navigation issues: chat room hides dock correctly; secondary surfaces need consistent back stacks.

Visual hierarchy issues: active tab should be visible but not oversized; badges should signal requests/missed/unread.

Scalability issues: more primary tabs should not be added; deep features must live inside sections.

Mobile ergonomics issues: dock height should remain compact and fixed above safe area.

### Onboarding

Current UX problems: login/join/recovery are functional but still feel like forms rather than a trust-building messenger entry.

Missing functionality: clearer invite link handling, username availability feedback, password criteria, recovery path clarity.

Information architecture issues: login, join, forgot, reset are separate routes but need one visual/account-entry system.

Navigation issues: switching between login and join should preserve invite code when present.

Visual hierarchy issues: invite join and forgot password must be visible without competing with the main CTA.

Scalability issues: future onboarding steps need a stepper system.

Mobile ergonomics issues: fields should stay above keyboard with stable CTA placement.

### Empty States

Current UX problems: empty states exist but are screen-specific and sometimes verbose.

Missing functionality: per-state primary action, secondary action, and reason: no contacts, no calls, no chats, no search results, no media, no notifications.

Information architecture issues: empty states should teach where the feature belongs without explaining the whole product.

Navigation issues: every empty state should move the user to the next natural action.

Visual hierarchy issues: icons should be quiet, not decorative hero art.

Scalability issues: empty state must collapse once partial content exists.

Mobile ergonomics issues: primary action should sit in thumb zone when the state fills the screen.

### Notifications

Current UX problems: push subscription exists in profile, mute exists in chats/profile, unread exists in chat list, but the system is not unified.

Missing functionality: notification permission state, muted chat list, push troubleshooting, request count, missed call count.

Information architecture issues: notification settings belong in settings, but notification signals belong in dock/list rows.

Navigation issues: tapping a notification should deep-link into chat/call/request with context.

Visual hierarchy issues: unread/muted/mentions/missed calls need different visual weights.

Scalability issues: high-volume chats require mute/priority controls.

Mobile ergonomics issues: notification actions should be reachable from row swipe/profile, not buried.

### Chat Detail Screen

Current UX problems: chat detail has strong features, but the shell can still show transitional blank/cache states and local variations in headers/profile/media.

Missing functionality: local chat search UI, jump to unread, pinned message treatment, day separators, compact error/retry states.

Information architecture issues: chat detail contains messages, profile access, calls, search, media, disappearing messages; these need a stable action hierarchy.

Navigation issues: header tap opens profile; top right has call/video/more. This is good and should be universal.

Visual hierarchy issues: message content should dominate; header/composer must feel lighter.

Scalability issues: thousands of messages need virtualized list behavior and stable media placeholders.

Mobile ergonomics issues: composer, scroll-to-bottom, voice/video note controls must stay thumb-friendly.

### Message Composer

Current UX problems: composer is feature rich but uses menus and multiple states that can feel complex under thumb.

Missing functionality: upload progress per message, retry, cancel upload, one-tap media preview, long-press capture path later.

Information architecture issues: attach, text, emoji, capture/send are correct, but state changes need one predictable model.

Navigation issues: attachment preview should not feel like leaving the chat.

Visual hierarchy issues: send/capture should be the only strong control; emoji/attach are secondary.

Scalability issues: many media attachments need a horizontal tray.

Mobile ergonomics issues: right button must switch between capture/send without moving layout.

### Media Viewer

Current UX problems: media viewer works but visual language is old: uppercase file title/footer and generic black overlay.

Missing functionality: swipe between media, save/share, zoom, scrubbing, round-video inline expansion rules.

Information architecture issues: viewer should be a chat sub-surface, not a separate branded page.

Navigation issues: tap to show/hide controls, close/save at top, gestures later.

Visual hierarchy issues: media must dominate; chrome should fade.

Scalability issues: shared media library needs tabs/grid/list consistency.

Mobile ergonomics issues: close/save must be reachable and not conflict with OS safe areas.

## Information Architecture Map

```text
Nox
├─ Auth
│  ├─ Login
│  ├─ Join by invite
│  ├─ Forgot password
│  └─ Reset password
├─ Main app
│  ├─ Chats
│  │  ├─ Chat list
│  │  ├─ Global search
│  │  ├─ New direct chat
│  │  ├─ Invite person
│  │  ├─ Create group
│  │  └─ Archive
│  ├─ Chat detail
│  │  ├─ Messages
│  │  ├─ Composer
│  │  ├─ Attachments/media preview
│  │  ├─ Voice/video notes
│  │  ├─ Calls
│  │  ├─ Chat search
│  │  ├─ Partner profile
│  │  └─ Group profile
│  ├─ Contacts
│  │  ├─ Contact list
│  │  ├─ Requests
│  │  ├─ Add/search person
│  │  └─ Invite person
│  ├─ Calls
│  │  ├─ Call history
│  │  ├─ Missed calls
│  │  └─ Active/incoming call overlay
│  └─ Profile / Settings
│     ├─ My profile
│     ├─ Devices
│     ├─ Appearance
│     ├─ Security/recovery
│     ├─ Data and cache
│     ├─ Notifications
│     └─ Admin panel, role gated
└─ System
   ├─ Push subscription
   ├─ Realtime/socket state
   ├─ E2EE device/key state
   ├─ Local message/media cache
   └─ Admin audit/invites/recovery
```

## Navigation Map

Primary navigation:

- Contacts: people, requests, invite, start direct chat.
- Calls: missed/recent calls and call-back.
- Chats: daily command center, unread/recent/pinned, plus actions.
- Profile: identity, settings, devices, security, data/cache, admin.
- Search: global action from main dock, not a primary destination tab.

Secondary navigation:

- Chat header back returns to chat list.
- Chat header avatar/title opens partner/group profile.
- Chat top actions: audio call, video call, more.
- More menu in chat: disappearing messages, later clear/search/mute if context needs it.
- Profile sub-screens use one internal back header.
- Bottom sheets handle destructive or contextual actions.

Navigation rules:

- Do not add new primary tabs.
- Do not hide critical actions inside decorative cards.
- One screen = one primary job.
- Search scope must be obvious: global on main screens, in-chat inside chat.
- Destructive actions require confirmation and clear context.

## Feature Map

| Domain | Features Now | Needed System-Level Upgrade |
| --- | --- | --- |
| Account | login, invite join, reset password, profile edit | unified account-entry flow, clearer trust copy, username feedback |
| Contacts | list, open direct chat | contacts search, requests/invite grouping, quick contact management |
| Chats | list, filters, swipe actions, invites, groups | dense priority model, scalable folders later, stable instant open |
| Messages | send/edit/reply/delete, receipts, drafts, reactions | unified pending/retry status, compact error states |
| Media | attachments, encrypted media, viewer, video notes | consistent media chrome, progress, inline round-video rules |
| Calls | audio/video, history, overlay | background continuity, compact controls, missed-call urgency |
| Search | chat search page, history | unified global search across people/chats/messages/media |
| Profile | avatar/name/username/bio, settings | compact settings IA, notification/data/security coherence |
| Security | E2EE devices, recovery, admin controls | small clear trust indicators, not noisy technical blocks |
| Admin | users, invites, recovery, audit | same component language, denser status-first tables/lists |

## Screen Map

| Screen | Primary Job | Primary Info | Primary Actions | Density Target |
| --- | --- | --- | --- | --- |
| Login | enter existing account | product identity, login/password | login, join, forgot | all actions visible above fold |
| Join | create account by invite | step, invite code, login/password/username | next, create, back | no more than 3 fields per step |
| Chats | daily triage | 9-11 chat rows, unread, status, time | open, search, new, swipe actions | 30-50% more useful rows than card layout |
| Search | find anything fast | recent people, recent queries, typed results | open result, clear history, cancel | keyboard-safe content |
| Contacts | find/manage people | contact rows, online/recent/request state | open chat, invite, search | 10-12 rows visible |
| Calls | handle recent calls | missed/recent/duration/time | call back, open chat/profile | missed calls visually stronger |
| Chat detail | conversation | messages, status, pinned/typing | send, attach, call, profile | chrome under 18% of viewport |
| Partner profile | understand/manage person | avatar, status, actions, username, bio, media | call, video, mute, more, edit | profile header compact after hero |
| Group profile | understand/manage group | avatar, title, members, media | add members, edit title, style | members and media easy to scan |
| Profile | manage self/settings | avatar/name, grouped settings, push | edit, settings, logout/admin | main settings visible without long scroll |
| Settings sub-screen | change one group | rows/forms specific to group | save/toggle/destructive | consistent header/back |
| Media viewer | inspect/save media | media itself | close, save/share, play | chrome fades behind media |
| Call overlay | talk | remote/local media, call state | mute, camera, speaker, end, flip | controls compact, tap-to-hide |
| Admin | manage system | users/invites/recovery/security/audit | act, filter, refresh | dense but same visual system |

## Component Inventory

Core shell:

- App screen container
- Main content safe-area container
- Compact bottom dock
- Dock badge
- Context header
- Back header

Lists:

- Person row
- Chat row
- Call row
- Settings row
- Admin status row
- Section hairline divider
- Empty state
- Loading/cache frame

Actions:

- Icon button
- Primary CTA
- Secondary pill
- Destructive button
- Swipe action
- Bottom sheet action row
- Context menu item

Inputs:

- Search field
- Text field
- Password field
- Composer text area
- Attachment tray
- Segmented control/filter rail

Communication:

- Message bubble
- Message status glyph
- Reply/edit preview
- Typing indicator
- Upload/progress status
- Toast/error banner

Media:

- Image tile
- Video tile
- Round video note
- Voice player
- Media viewer chrome
- Avatar viewer
- Avatar cropper

Profile/settings:

- Profile hero
- Action button grid
- Info card
- Shared media tabs
- Settings group
- Device/security row

Motion/material:

- Press scale
- Sheet enter/exit
- Menu fade/scale
- Row swipe reveal
- Dock active transition
- Media viewer zoom
- Glass surface primitive

## Visual System Rules

- Glass is allowed only for dock, composer, sheets, sticky chrome, search field, and selected overlays.
- Rows must not have hard shadows. Use hairlines, subtle tint, and state markers.
- Accent blue means action, active, read, online, or primary CTA. Do not use it as decoration.
- Header hierarchy should fit inside compact safe-area chrome.
- Main lists should avoid large cards; use full-width rows unless content is a repeated card grid.
- Motion duration: 150-220ms for task UI; 240-300ms only for media viewer/sheet transitions.
- Animate transform and opacity only unless the component is isolated and measured.

## Status Priority Model

Chat row priority, highest first:

1. Incoming request / blocked / unavailable state.
2. Unread messages and mentions.
3. Draft.
4. Typing.
5. Last outgoing message delivery state: sent, delivered, read.
6. Muted/pinned/archived.
7. Normal last message preview.

Call row priority:

1. Missed call.
2. Active/incoming/resumable call.
3. Failed/declined.
4. Completed outgoing/incoming.

Profile/settings priority:

1. Security or recovery action required.
2. Push disabled or device trust problem.
3. Cache/storage issue.
4. Cosmetic preferences.

## Category Recommendation

Do not blindly implement Work/Family/Projects/Clients/AI/Communities yet. The data model does not appear to have user-defined folders/labels. Adding fake categories would create dead UI.

Short term:

- Keep current filters but rename mentally as activity lenses: All, Direct, Pinned, Unread.
- Show counts only where they reduce scanning, not everywhere.
- Keep self chat pinned/first if useful.

Medium term:

- Add user-defined Spaces/Folders only when the data model supports labels and membership rules.
- Suggested defaults after model support: People, Groups, Pinned, Unread, Archived.
- Optional user-created folders: Work, Family, Projects, Clients, Communities.

## Scalability Recommendations

- Chat list must support 500+ chats with stable row height, cached list paint, and no decorative per-row surfaces.
- Search must become the primary scale tool: recent people, recent queries, typed results grouped by chats/messages/media/links.
- Contacts need search and possibly alphabet grouping.
- Calls need day grouping and missed-call emphasis.
- Media grids need lazy loading and stable aspect-ratio placeholders.
- Settings need grouped sections with predictable row patterns.
- Admin needs filters/search before it grows past small-team use.

## Mobile-First Recommendations

- Primary tap targets: 40-44px for icon controls; rows 56-64px depending content.
- Keep bottom dock compact and fixed above safe-area.
- Keep composer one-line at rest and stable while switching send/capture state.
- Keep destructive actions in sheets/confirmations, not accidental row taps.
- Keep search reachable from thumb zone and focused instantly.
- Avoid page-load choreography; use cache-first real content, then reconcile.
- Never let OS safe areas overlap headers/composer/call controls.

## Implementation Plan

### Phase 1: Product Shell Foundation

- Consolidate shared primitives in `src/app/globals.css`: screen, headers, rows, glass, dock, sheets, buttons, search, empty states.
- Normalize bottom dock sizing, badges, active state, and fixed safe-area behavior.
- Remove old visual leftovers that contradict the product system.

### Phase 2: Main Daily Screens

- Redesign Chats, Contacts, Calls with the same row system.
- Align empty states, loading states, badges, and row status priority.
- Keep all existing data logic intact.

### Phase 3: Search and People Flow

- Unify search page structure: recent people, recent queries, grouped live results.
- Align plus menu: find person, create group, invite person with distinct jobs.
- Add contacts/search/request surfaces to the same IA.

### Phase 4: Chat Detail and Composer

- Normalize chat header, composer, message bubbles, delivery/pending/retry, media placeholders.
- Make media send/progress visible near the message, not in the composer button.
- Keep cache-first open behavior and avoid separate blank/loading screens.

### Phase 5: Profiles, Settings, Admin

- Align partner/group/my profile with the same profile hero, action grid, info card, shared media tabs.
- Rebuild settings groups into compact rows.
- Bring admin panel onto the same component language without reducing utility.

### Phase 6: Calls and Media Viewer

- Compact call overlay controls.
- Tap-to-hide call chrome.
- Align media viewer with dark immersive chrome and save/share controls.
- Keep WebRTC logic untouched unless a call-specific bug requires a scoped fix.

### Phase 7: Verification

- Run `npx tsc --noEmit -p tsconfig.json`.
- Run `npx eslint <changed files>`.
- Run `npm run build` before push when code changed.
- Use local browser screenshots for main screens: login, chats, search, contacts, calls, chat detail, profile, partner profile, group profile, media viewer, call overlay if possible.

## Acceptance Criteria

- Users see 30-50% more useful information on list screens without feeling crowded.
- Chat list tells who/what/when/status in under one second.
- Search feels like a first-class workflow, not a secondary form.
- Contacts/calls/profile/settings/admin feel like the same product.
- Bottom dock is compact, fixed, and visually quiet.
- No hard shadows between rows.
- No generic decorative gradients or ambient blobs.
- No uppercase-heavy control language.
- No route loading screen that appears as a separate blank product state during normal chat opening.
- Existing messaging, calls, E2EE, invites, admin, and cache logic remain intact.
