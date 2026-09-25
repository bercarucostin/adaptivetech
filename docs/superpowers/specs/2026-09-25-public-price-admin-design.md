# Public Price List Administration Design

## Goal

Lab management changes the prices published on `www.flowrisedental.ro` without a
developer editing HTML and without a deployment. A published change reaches
visitors on their next page load, and every state the public has ever seen stays
recoverable.

## Where things actually run

`flowrisedental.ro` and `www` resolve to `188.241.222.18` — Hostico shared
hosting, cPanel. `app.` and `n8n.` resolve to `91.99.207.92`, the Hetzner box
behind Caddy. The landing page is therefore a static file uploaded to cPanel, and
`website/site/index.html` is a hand-kept copy of it. The `http://www.{$SITE_DOMAIN}`
block in `deploy/Caddyfile` is configuration staged for a DNS cutover that has not
happened.

Prices reach the page through a browser fetch, which behaves identically on
Apache today and on Caddy afterwards. Nothing here rewrites a file on the web
host, because after the cutover the landing page is baked into the Caddy image
and no admin can rewrite it.

The DNS cutover remains separate work and is not a prerequisite.

## What is editable

Everything the price section displays: group headings and their order, the rows
inside each group and their order, and per row the item name, an optional
material variant, the amount and an optional `†` marker. Also the list currency,
the introductory note and the footnote text.

Nothing else on the landing page is editable — not the hero, the tagline, the
contact channels or the footer.

## The document

One published price list is one JSON document:

    {
      "schema": 1,
      "currency": "lei",
      "intro_note": "Prețurile sunt exprimate în lei, per element, dacă nu se specifică altfel.",
      "footnote": "La elementele prin înșurubare, PMMA și zirconiu, se adaugă costul elementelor din titan.",
      "groups": [
        {
          "title": "Lucrări pe dinte natural",
          "rows": [
            { "item": "Coroană ceramică stratificată, suport metalic CR-CO",
              "variant": "IVOCLAR", "amount": 200, "footnote": false }
          ]
        }
      ]
    }

`variant` is optional; when present the renderer prefixes it with `—` exactly as
the current markup does. A row may carry its own `currency`, otherwise the list
currency applies. `footnote: true` emits the `†` marker after the item name, the
convention four rows already use. Display order is array order, so reordering
requires no ordering column and no bookkeeping across rows.

## Storage

`public.public_price_lists` holds one row per published version:
`id`, `lab_organization_id` referencing `organizations`, `document jsonb`,
`is_current boolean`, `note text` recording what changed, `created_by`
referencing `profiles` so the history can name the publisher, and `created_at`.

A partial unique index on `lab_organization_id` where `is_current` guarantees one
current list per lab. Rows are never updated except to clear or set `is_current`,
and never deleted, so the version history is the audit trail.

The existing `lab_public_offers` table is deliberately left alone. It is flat, has
no grouping or ordering, and its visibility is tied to `lab_profiles.visibility`
and clinic relationships — it serves the lab-directory side, not the marketing
page.

## Authorization

Writes require `is_lab_management(get_flowrise_lab_id())`: membership role `admin`
or `manager` in the lab organization, membership active, profile active. The same
predicate gates the RPCs and decides whether the panel renders an editor.

Reading the current list is open to `anon`. The list is already printed on a
public web page, so this exposes nothing new; the publishable key is already
public in `website/app/supabase-config.js`. Reading earlier versions requires
management.

The row-level policy is a single `SELECT` policy to `anon` and `authenticated`
permitting `is_current OR is_lab_management(lab_organization_id)`. There is no
client-side write policy at all: `db/schema/40_grants.sql` revokes `insert`,
`update` and `delete` on the table from `anon` and `authenticated`, matching how
that file already treats `lab_work_orders`. Every write therefore arrives through
a `SECURITY DEFINER` RPC.

## Publishing and history

`publish_public_price_list(p_document jsonb, p_note text, p_expected_current uuid)`
asserts management, validates the document, inserts the new version and moves
`is_current` in one transaction. When `p_expected_current` does not match the
current version, it raises instead of overwriting: two managers editing at once
lose nothing silently.

`set_current_public_price_list(p_version_id uuid)` restores an earlier version
under the same gate. Restoring does not copy or rewrite the version — it only
moves `is_current`.

`may_edit_public_prices()` returns whether the caller may edit. It wraps
`is_lab_management(get_flowrise_lab_id())` and introduces no new permission
concept; `role_permissions` is unchanged.

## Validation

`public_price_document_is_valid(jsonb)` enforces the document's shape in the
database, and the editor enforces the same rules in the browser so the admin sees
problems inline rather than as a failed publish:

- `schema` equals 1.
- `groups` is a non-empty array; each `title` is non-empty and at most 80
  characters; titles are unique within the document.
- each group's `rows` is an array; a group may be empty, which renders as a
  heading with no rows.
- `item` is non-empty and at most 200 characters; `variant`, when present, is at
  most 60.
- `amount` is a number, at least 0, at most 1000000, with at most two decimals.
- `currency`, per row or per list, is 1 to 8 characters.
- `intro_note` and `footnote` are at most 400 characters each and may be empty,
  in which case that paragraph is not rendered.
- at most 200 rows across the document.

The database check is the authority. A document that fails it cannot be published
by any client.

## The public read path

The landing page issues one anonymous request for the current document —
`select=document,id` filtered on `is_current`, with the publishable key — using
plain `fetch`. The page loads no Supabase library: one `GET` does not justify
shipping a client to every visitor.

Rendering is cache-first. A successful fetch stores the document in
`localStorage`; a returning visitor sees prices immediately from that cache while
the fetch revalidates in the background, and the section re-renders only if the
document changed.

## Rendering

The price section keeps its heading and loses its hand-written rows, gaining an
empty container the renderer fills. Every CSS class in the existing markup —
`group`, `list`, `row`, `item`, `variant`, `leader`, `price`, `cur`, `note-top`,
`footnote`, `ref` — is produced exactly as it reads today, so the stylesheet is
untouched.

`website/shared/price-list.js` is the single renderer, used by the landing page
and by the panel's preview, so what an admin approves is what a visitor gets.
`deploy/caddy.Dockerfile` copies it into both site roots; its comment stating the
two roots share nothing stops being true and is corrected there.

The renderer builds nodes with `createElement` and `textContent` and never
assigns `innerHTML`. Structure comes from code, text from the database, so
admin-entered text cannot inject markup into the public page.

## Failure behavior

When the fetch fails and no cached document exists, the section renders a single
line naming the phone number — "Lista de prețuri se încarcă — dacă nu apare,
sună la 0766 494 063." The page stays intact and still converts; it is only less
informative. A stale cache is preferred over that message, on the grounds that
last week's prices serve a visitor better than no prices.

With JavaScript disabled there are no prices. This is accepted, and recorded
below.

## The admin panel

A self-contained page at `app.flowrisedental.ro/public-prices/`: `index.html`,
`editor.js` and a small `editor.css`. It shares no code with `app.js` and adds
nothing to it. The app's 9,300-line `styles.css` is bound to the app shell and is
not reused.

Sign-in is the panel's own form, calling the deployed `login-with-identifier`
edge function, so management uses the same nickname and password as the platform.
The app stores its Supabase session in `sessionStorage`, which does not cross
tabs, so the panel authenticates independently by design rather than relying on
an existing session.

After sign-in, `may_edit_public_prices()` decides between the editor and a plain
refusal message.

The editor presents groups as cards that can be renamed, moved and deleted, each
holding rows with item name, variant, amount, a `†` checkbox and move and delete
controls; plus fields for the list currency, the intro note and the footnote.
Reordering uses move-up and move-down controls rather than dragging: fewer
failure modes and usable on a phone.

Publishing is preceded by a preview rendered through the shared renderer and
carries an optional note describing the change. The panel then lists the version
history — who published, when, with what note — and offers restore on any
earlier version.

The in-progress document is kept in `localStorage`, so a refresh or an expired
session does not discard unsaved work.

## Seeding and visual parity

Version 1 is transcribed from the current markup: five groups, every row, both
notes, and the four rows carrying `†`. A test feeds that document through the
renderer and asserts the result matches today's markup, which is what guarantees
the page looks unchanged the moment it starts fetching.

Before the landing page is uploaded, the live cPanel file is diffed against
`website/site/index.html`. They are supposed to be identical; a difference means
the live page drifted and must be reconciled before it is overwritten.

## Testing

`tests/sql/public_price_lists.sql` covers the security boundary and the
publishing rules: `anon` reads the current list and nothing else; `anon` and a
non-management authenticated user cannot write at all; a manager can publish; the
validator rejects each malformed shape above; the one-current index holds; a
stale `p_expected_current` raises; restore moves `is_current`.

`tests/app/public-price-render.test.js` asserts the renderer reproduces today's
markup from the seed document, and covers the variant prefix, the `†` marker, the
per-row currency fallback, an empty group and an absent note.

`tests/app/public-price-document.test.js` covers validation and the editor's pure
functions for adding, moving, removing and normalizing.

`tests/acceptance/public-prices.md` records the manual pass: sign in as a
manager, edit, preview, publish, confirm `www` shows the change, restore the
previous version.

## Deployment

Apply the schema with `db/schema/apply.sql`, regenerated by
`node tools/build-db-apply.js`. Version 1 is inserted by
`db/migrations/20260925_public_price_list_seed.sql`, idempotent like every other
file there, so a rebuilt database comes up already publishing today's list rather
than an empty price section. Redeploy the Caddy image so
the panel is reachable. Diff and then upload `index.html` and `price-list.js` to
cPanel. `deploy/README.md` gains that upload step, which it does not describe
today.

## Accepted limits

- No prices without JavaScript, and Google must render JavaScript to index them.
- Group headings and note text become admin-editable, so a careless edit can make
  the page read oddly. The preview is the guard; the schema does not constrain
  wording.
- The landing page and the panel live on different hosts until the cutover, so
  publishing the page remains a manual upload while publishing prices does not.

## Out of scope

The DNS cutover. The app's internal contract prices under "Configurare admin",
which are a different dataset with different rules. `lab_public_offers`. Multiple
languages. Scheduling a price change for a future date.
