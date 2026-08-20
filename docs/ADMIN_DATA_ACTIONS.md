# Admin data actions

This document defines the destructive-action policy used by the Central AI admin workspace.

## Editable configuration data

The UI exposes edit and, where meaningful, enable/disable and delete actions for:

- Organizations
- Users
- API clients
- Knowledge bases
- Knowledge documents and URL/manual sources
- FAQ entries
- Prompt profiles
- Agent tools
- Customer contact/profile details

Destructive actions require confirmation and are additionally constrained by RLS, Edge Function authorization, foreign keys, or server-side history checks.

## Operational and audit history

The UI intentionally does **not** expose hard delete for:

- Conversation messages
- Conversation history
- Usage logs
- Audit logs
- Agent tool execution history
- Human handoff history

Instead, conversations use close/reopen and handoff requests use claim/resolve/cancel. This preserves traceability and avoids breaking historical usage or audit references.

## Safety rules

- The current user cannot disable or delete their own account.
- The last active Super Admin cannot be disabled, demoted, or deleted.
- Organizations with dependent tenant data cannot be hard deleted; disable them instead.
- Customers with conversation history cannot be hard deleted.
- Agent tools with execution history cannot be hard deleted; disable them instead.
- API keys remain one-time secrets and are never stored in plaintext.
- Agent tool credentials are stored in Supabase Vault.
- Basic Auth stores `username` and `password` as a Vault secret and constructs the `Authorization: Basic ...` header only at execution time.
- Knowledge Storage uses ASCII/UUID object keys; the user-visible original filename is stored separately, allowing Arabic and other Unicode filenames without invalid object keys.

## Invitation flow

User invitations pass an explicit production `redirectTo` URL and the client recognizes Supabase `type=invite` sessions, requiring the invited user to set a password before entering the admin workspace.

The production Supabase Auth URL allow-list should include the deployed application URL so `redirectTo` is accepted by Auth.
