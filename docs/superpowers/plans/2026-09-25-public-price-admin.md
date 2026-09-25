# Public Price List Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lab management edits the prices published on `www.flowrisedental.ro` from a browser, without a developer touching HTML and without a deployment.

**Architecture:** One published price list is one JSON document in a new append-only Supabase table. Writes go only through `SECURITY DEFINER` RPCs gated on `is_lab_management(get_flowrise_lab_id())`; the landing page reads the current document anonymously with one `fetch` and renders it through a module shared with the admin panel's preview. The landing page's hand-written rows are deleted and replaced by that render.

**Tech Stack:** Plain browser JavaScript, no build step and no dependencies (the repo has no `package.json`). PostgreSQL/Supabase with RLS. `node --test` for JS tests, `psql` for SQL tests. `@supabase/supabase-js@2` from CDN in the admin panel only.

**Spec:** `docs/superpowers/specs/2026-09-25-public-price-admin-design.md`

## Global Constraints

- No new dependencies, no `package.json`, no build step. New browser files must work from a plain `<script>` tag.
- Every SQL file is idempotent and safe to re-run. That is a repo-wide rule, stated in each schema file's header.
- `node tools/build-db-apply.js` must be re-run after adding any file under `db/schema/`, and `node tools/build-db-apply.js --check` must exit 0.
- `node --test tests/` must pass at the end of every task that touches JS.
- One file per database function, named after the function, under `db/schema/20_functions/`. Tables under `db/schema/10_tables/NN_name.sql`, their policies and function-dependent constraints under `db/schema/30_policies/NN_name.sql`, both using the same `NN` prefix.
- All user-facing copy is Romanian. Exact strings are given in the tasks; do not paraphrase them.
- Amount formatting: integers render bare (`200`), non-integers use a comma (`199,5`). Never `toLocaleString` — it depends on the runtime's ICU build and would make tests environment-dependent.
- The shipped renderer never assigns `innerHTML` and never builds an HTML string. Structure comes from `createElement`, text from `createTextNode`.
- Authorization predicate, everywhere: `is_lab_management(get_flowrise_lab_id())`. Do not introduce a new `role_permissions` flag.

## Review Focus

These are the input classes the spec implies but does not discuss. Each has a test in the task that owns the code.

1. **A price with decimals** (`199.5`) must render `199,5`, not `199.5` or `200` — Task 1.
2. **Item text containing `<`, `&` or `"`** must appear literally on the public page and never become markup — Task 1.
3. **A group with no rows** must render its heading without breaking the page — Task 1.
4. **Supabase unreachable, a non-200 response, or corrupt `localStorage`** must leave the page intact and show the phone-number line rather than throwing — Task 6.
5. **Two managers publishing concurrently** — the second publish must raise and refuse rather than silently overwrite the first — Task 4.

---

### Task 1: Shared renderer and the seed document

The seed document and the renderer are one deliverable because the test that proves the transcription correct is the test that renders it: feed the document to the renderer, compare against today's markup.

**Files:**
- Create: `tests/fixtures/public-prices-2026-09-25.html`
- Create: `tests/fixtures/public-price-list-v1.json`
- Create: `website/shared/price-list.js`
- Create: `tests/app/public-price-render.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `website/shared/price-list.js` exporting `{ priceListTree, mount, formatAmount }` on `globalThis.PriceList` and via `module.exports`.
  - `priceListTree(doc)` → array of vnodes. A vnode is `{tag, cls, children}` or `{text}`.
  - `mount(nodes, container, documentRef)` → replaces `container`'s children with real DOM. `documentRef` defaults to the global `document`; tests pass a stub.
  - `formatAmount(amount)` → string.

- [ ] **Step 1: Extract the two fixtures from the current landing page**

Save this as `extract-seed.js` in a scratch directory — it is a one-time transcription aid and is **not** committed.

```js
const fs = require('node:fs');
const html = fs.readFileSync('website/site/index.html', 'utf8');
const open = html.indexOf('<section class="prices">');
const raw = html.slice(open, html.indexOf('</section>', open));

// Fixture 1: the renderable part of the section, verbatim — everything after the
// static <h2>, minus the closing .wrap div. This is what the page looked like on
// the day it switched to the database, and what the parity test compares against.
const afterH2 = raw.slice(raw.indexOf('</h2>') + 5);
fs.writeFileSync('tests/fixtures/public-prices-2026-09-25.html',
  afterH2.slice(0, afterH2.lastIndexOf('</div>')).trim() + '\n');

// Fixture 2: the same content as the seed document. The file is formatter-wrapped,
// so tags themselves span lines — flatten before matching.
const section = raw.replace(/\s+/g, ' ');
const text = (s) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const introNote = text((section.match(/<p class="note-top">(.*?)<\/p>/) || [, ''])[1]);
const footnote = text((section.match(/<p class="footnote">(.*?)<\/p>/) || [, ''])[1]).replace(/^†\s*/, '');

const groups = [];
for (const block of section.split('<div class="group">').slice(1)) {
  const title = text((block.match(/<h3>(.*?)<\/h3>/) || [, ''])[1]);
  const rows = [];
  for (const li of block.split('<li class="row">').slice(1)) {
    const itemSpan = li.slice(li.indexOf('<span class="item">') + 19, li.indexOf('<span class="leader">'));
    const variantMatch = itemSpan.match(/<span class="variant">(.*?)<\/span>/);
    const variant = variantMatch ? text(variantMatch[1]).replace(/^—\s*/, '') : null;
    const hasFootnote = /<sup class="ref">/.test(itemSpan);
    const item = text(itemSpan
      .replace(/<span class="variant">.*?<\/span>/, '')
      .replace(/<sup class="ref">.*?<\/sup>/, ''));
    const priceMatch = li.match(/<span class="price">\s*([\d.,]+)\s*<span class="cur">(.*?)<\/span>/);
    if (!priceMatch) throw new Error(`No price parsed in row: ${text(li).slice(0, 90)}`);
    const row = { item, amount: Number(String(priceMatch[1]).replace(',', '.')) };
    if (variant) row.variant = variant;
    if (hasFootnote) row.footnote = true;
    rows.push({ row, currency: text(priceMatch[2]) });
  }
  groups.push({ title, rows });
}

const currencies = new Set(groups.flatMap((g) => g.rows.map((r) => r.currency)));
if (currencies.size !== 1) throw new Error(`Expected one currency, found: ${[...currencies].join(', ')}`);

const doc = {
  schema: 1,
  currency: [...currencies][0],
  intro_note: introNote,
  footnote,
  groups: groups.map((g) => ({ title: g.title, rows: g.rows.map((r) => r.row) })),
};
const count = (fn) => doc.groups.reduce((n, g) => n + g.rows.filter(fn).length, 0);
console.log(`groups=${doc.groups.length} rows=${count(() => true)} withVariant=${count((r) => r.variant)} withFootnote=${count((r) => r.footnote)} currency=${doc.currency}`);
fs.writeFileSync('tests/fixtures/public-price-list-v1.json', JSON.stringify(doc, null, 2) + '\n');
```

Run from the repository root: `node <scratch>/extract-seed.js`

Expected output, exactly: `groups=5 rows=33 withVariant=17 withFootnote=5 currency=lei`

If the counts differ, the landing page changed since this plan was written. Stop and reconcile before continuing — every later task assumes these fixtures.

- [ ] **Step 2: Write the failing test**

Create `tests/app/public-price-render.test.js`:

```js
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const {priceListTree,mount,formatAmount}=require('../../website/shared/price-list.js');

const root=path.join(__dirname,'../..');
const seed=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/public-price-list-v1.json'),'utf8'));
const snapshot=fs.readFileSync(path.join(root,'tests/fixtures/public-prices-2026-09-25.html'),'utf8');

// For comparison only. The shipped renderer never builds markup; this walks the
// tree the way a browser would so the fixture can be asserted as a string.
function serialize(nodes){
 return nodes.map(n=>{
  if(n.text!==undefined)return n.text;
  const cls=n.cls?` class="${n.cls}"`:'';
  return `<${n.tag}${cls}>${serialize(n.children)}</${n.tag}>`;
 }).join('');
}
// Whitespace between two tags is formatting; whitespace inside a text run is content.
const normalize=s=>s.replace(/\s+/g,' ').replace(/>\s+</g,'><').trim();

// A DOM small enough to assert against: records how each node was created, so a
// test can prove text went through createTextNode and was never parsed as markup.
function fakeDocument(){
 const make=(tag)=>({tag,className:'',children:[],firstChild:null,
  appendChild(child){this.children.push(child);this.firstChild=this.children[0];return child;},
  removeChild(child){this.children=this.children.filter(c=>c!==child);this.firstChild=this.children[0]||null;return child;}});
 return {createElement:make,createTextNode:(text)=>({text}),make};
}

test('the seed document renders the price section as it stands today',()=>{
 assert.equal(normalize(serialize(priceListTree(seed))),normalize(snapshot));
});

test('a variant is separated from the item text by a space',()=>{
 const tree=priceListTree({currency:'lei',groups:[{title:'G',rows:[{item:'Coroană',variant:'IVOCLAR',amount:1}]}]});
 const item=tree[0].children[1].children[0].children[0].children;
 assert.deepEqual(item.map(n=>n.text!==undefined?n.text:n.tag),['Coroană',' ','span']);
});

test('a footnote row carries the marker before the variant',()=>{
 const tree=priceListTree({currency:'lei',groups:[{title:'G',rows:[{item:'PMMA',variant:'X',amount:1,footnote:true}]}]});
 const item=tree[0].children[1].children[0].children[0].children;
 assert.deepEqual(item.map(n=>n.text!==undefined?n.text:n.cls),['PMMA','ref',' ','variant']);
});

test('decimal amounts use a comma and integers stay bare',()=>{
 assert.equal(formatAmount(200),'200');
 assert.equal(formatAmount(199.5),'199,5');
 assert.equal(formatAmount(199.456),'199,46');
 assert.equal(formatAmount(0),'0');
});

test('a row currency overrides the list currency',()=>{
 const tree=priceListTree({currency:'lei',groups:[{title:'G',rows:[{item:'X',amount:5,currency:'EUR'}]}]});
 const price=tree[0].children[1].children[0].children[2].children;
 assert.equal(price[0].text,'5');
 assert.equal(price[1].children[0].text,'EUR');
});

test('a group with no rows renders its heading and an empty list',()=>{
 const tree=priceListTree({currency:'lei',groups:[{title:'În curând',rows:[]}]});
 assert.equal(tree.length,1);
 assert.equal(tree[0].children[0].children[0].text,'În curând');
 assert.deepEqual(tree[0].children[1].children,[]);
});

test('an absent note renders no paragraph',()=>{
 const tree=priceListTree({currency:'lei',groups:[{title:'G',rows:[]}]});
 assert.deepEqual(tree.map(n=>n.cls),['group']);
});

test('markup in an item name reaches the page as text, never as markup',()=>{
 const doc=fakeDocument();
 const container=doc.make('div');
 mount(priceListTree({currency:'lei',groups:[{title:'G & <b>',rows:[{item:'<script>alert(1)</script> & "x"',amount:1}]}]}),container,doc);
 const heading=container.children[0].children[0];
 const itemSpan=container.children[0].children[1].children[0].children[0];
 assert.equal(heading.children[0].text,'G & <b>');
 assert.equal(itemSpan.children[0].text,'<script>alert(1)</script> & "x"');
});

test('mount replaces whatever was in the container',()=>{
 const doc=fakeDocument();
 const container=doc.make('div');
 container.appendChild(doc.createTextNode('stale'));
 mount(priceListTree({currency:'lei',groups:[{title:'G',rows:[]}]}),container,doc);
 assert.equal(container.children.length,1);
 assert.equal(container.children[0].tag,'div');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/app/public-price-render.test.js`
Expected: FAIL — `Cannot find module '../../website/shared/price-list.js'`

- [ ] **Step 4: Write the renderer**

Create `website/shared/price-list.js`:

```js
// The one renderer for the public price list: the landing page loads it with a
// plain <script> tag, the admin panel's preview calls the same functions, so what
// an admin approves is what a visitor gets. Also require()-able from node --test.
//
// It returns a node tree and mounts that tree with createElement/createTextNode.
// There is deliberately no path in this file that builds an HTML string, so text
// an admin typed can never become markup on a public page.
(function (root) {
  'use strict';

  // 200 -> "200", 199.5 -> "199,5". The comma is written by hand: toLocaleString
  // depends on the runtime's ICU build, which would make tests pass or fail
  // according to how node was compiled.
  function formatAmount(amount) {
    return String(Math.round(Number(amount) * 100) / 100).replace('.', ',');
  }

  function el(tag, cls, children) { return { tag: tag, cls: cls, children: children || [] }; }
  function txt(value) { return { text: String(value) }; }

  function rowTree(row, listCurrency) {
    var item = [txt(row.item)];
    if (row.footnote) item.push(el('sup', 'ref', [txt('†')]));
    if (row.variant) { item.push(txt(' ')); item.push(el('span', 'variant', [txt('— ' + row.variant)])); }
    return el('li', 'row', [
      el('span', 'item', item),
      el('span', 'leader', []),
      el('span', 'price', [
        txt(formatAmount(row.amount)),
        el('span', 'cur', [txt(row.currency || listCurrency)])
      ])
    ]);
  }

  function priceListTree(doc) {
    var listCurrency = (doc && doc.currency) || 'lei';
    var nodes = [];
    if (doc && doc.intro_note) nodes.push(el('p', 'note-top', [txt(doc.intro_note)]));
    ((doc && doc.groups) || []).forEach(function (group) {
      nodes.push(el('div', 'group', [
        el('h3', null, [txt(group.title)]),
        el('ul', 'list', (group.rows || []).map(function (row) { return rowTree(row, listCurrency); }))
      ]));
    });
    if (doc && doc.footnote) {
      nodes.push(el('p', 'footnote', [el('sup', 'ref', [txt('†')]), txt(' ' + doc.footnote)]));
    }
    return nodes;
  }

  function build(node, d) {
    if (node.text !== undefined) return d.createTextNode(node.text);
    var element = d.createElement(node.tag);
    if (node.cls) element.className = node.cls;
    node.children.forEach(function (child) { element.appendChild(build(child, d)); });
    return element;
  }

  function mount(nodes, container, documentRef) {
    var d = documentRef || (typeof document !== 'undefined' ? document : null);
    while (container.firstChild) container.removeChild(container.firstChild);
    nodes.forEach(function (node) { container.appendChild(build(node, d)); });
  }

  var api = { priceListTree: priceListTree, mount: mount, formatAmount: formatAmount };
  root.PriceList = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/app/public-price-render.test.js`
Expected: PASS, 9 tests

- [ ] **Step 6: Commit**

```bash
git add website/shared/price-list.js tests/app/public-price-render.test.js tests/fixtures/public-price-list-v1.json tests/fixtures/public-prices-2026-09-25.html
git commit -m "feat(site): render the public price list from a document"
```

---

### Task 2: The price list table, its policies and its grants

**Files:**
- Create: `db/schema/10_tables/30_public_price_lists.sql`
- Create: `db/schema/30_policies/30_public_price_lists.sql`
- Modify: `db/schema/40_grants.sql` (append)
- Create: `tests/sql/public_price_lists.sql`
- Modify: `db/schema/apply.sql` (regenerated, never edited by hand)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `public.public_price_lists (id uuid, lab_organization_id uuid, document jsonb, is_current boolean, note text, created_by uuid, created_at timestamptz)`. Task 3 adds the `CHECK` that validates `document`; Task 4's RPCs write to this table.

- [ ] **Step 1: Write the failing SQL test**

Create `tests/sql/public_price_lists.sql`. Run after `db/schema/apply.sql` against a disposable Supabase database; every assertion raises and aborts.

```sql
-- Run after db/schema/apply.sql against a disposable Supabase database.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/public_price_lists.sql
begin;

-- Structure ----------------------------------------------------------------
do $$
declare
    v_missing text;
begin
    select string_agg(required.column_name, ', ' order by required.column_name)
      into v_missing
    from (values
        ('id'), ('lab_organization_id'), ('document'), ('is_current'),
        ('note'), ('created_by'), ('created_at')
    ) required(column_name)
    where not exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'public_price_lists'
          and c.column_name = required.column_name
    );
    if v_missing is not null then
        raise exception 'Missing public_price_lists columns: %', v_missing;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1 from pg_class
        where oid = 'public.public_price_lists'::regclass and relrowsecurity
    ) then
        raise exception 'Row level security is not enabled on public_price_lists';
    end if;

    if not exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'public_price_lists_one_current'
          and indexdef ilike '%where is_current%'
    ) then
        raise exception 'A lab must be able to have only one current price list';
    end if;
end $$;

-- Only one current list per lab, enforced by the database ------------------
do $$
declare
    v_lab uuid;
begin
    insert into public.organizations (name, slug, organization_type, active)
    values ('Test Lab', 'test-lab-public-prices', 'lab', true)
    returning id into v_lab;

    insert into public.public_price_lists (lab_organization_id, document, is_current)
    values (v_lab, '{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[]}]}'::jsonb, true);

    begin
        insert into public.public_price_lists (lab_organization_id, document, is_current)
        values (v_lab, '{"schema":1,"currency":"lei","groups":[{"title":"H","rows":[]}]}'::jsonb, true);
        raise exception 'A second current price list was accepted for the same lab';
    exception when unique_violation then
        null;
    end;
end $$;

-- Nobody writes from the browser ------------------------------------------
do $$
declare
    v_role text;
    v_privilege text;
begin
    foreach v_role in array array['anon', 'authenticated'] loop
        foreach v_privilege in array array['INSERT', 'UPDATE', 'DELETE'] loop
            if has_table_privilege(v_role, 'public.public_price_lists', v_privilege) then
                raise exception '% must not hold % on public_price_lists', v_role, v_privilege;
            end if;
        end loop;
        if not has_table_privilege(v_role, 'public.public_price_lists', 'SELECT') then
            raise exception '% must be able to read the current price list', v_role;
        end if;
    end loop;
end $$;

-- An anonymous visitor sees the current list and nothing else -------------
-- The role switch is a statement, not something inside a DO block: SET LOCAL ROLE
-- inside plpgsql does not reliably survive the block, and a test that silently
-- runs as the owner would pass while proving nothing.
insert into public.organizations (id, name, slug, organization_type, active)
values ('00000000-0000-4000-8000-0000000a1101', 'Anon Lab', 'anon-lab-public-prices', 'lab', true);

insert into public.public_price_lists (lab_organization_id, document, is_current)
values
  ('00000000-0000-4000-8000-0000000a1101', '{"schema":1,"currency":"lei","groups":[{"title":"Current","rows":[]}]}'::jsonb, true),
  ('00000000-0000-4000-8000-0000000a1101', '{"schema":1,"currency":"lei","groups":[{"title":"Older","rows":[]}]}'::jsonb, false);

set local role anon;

do $$
declare
    v_visible int;
begin
    select count(*)
      into v_visible
      from public.public_price_lists
     where lab_organization_id = '00000000-0000-4000-8000-0000000a1101';

    if v_visible <> 1 then
        raise exception 'An anonymous visitor saw % price lists, expected exactly the current one', v_visible;
    end if;
end $$;

reset role;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/public_price_lists.sql`
Expected: FAIL — `relation "public.public_price_lists" does not exist`

- [ ] **Step 3: Create the table**

Create `db/schema/10_tables/30_public_price_lists.sql`:

```sql
-- public_price_lists — table, constraints and indexes
-- The versioned price list published on the public landing page. One row per
-- published version; rows are never updated except to move is_current, and never
-- deleted, so the table is its own audit trail.
-- Every statement is idempotent, so the file is safe to re-run.

CREATE TABLE IF NOT EXISTS "public"."public_price_lists" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "lab_organization_id" uuid NOT NULL,
    "document" jsonb NOT NULL,
    "is_current" boolean NOT NULL DEFAULT false,
    "note" text,
    "created_by" uuid,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."public_price_lists" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_price_lists_pkey' AND conrelid = 'public.public_price_lists'::regclass) THEN
        ALTER TABLE "public"."public_price_lists" ADD CONSTRAINT "public_price_lists_pkey" PRIMARY KEY (id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_price_lists_lab_organization_id_fkey' AND conrelid = 'public.public_price_lists'::regclass) THEN
        ALTER TABLE "public"."public_price_lists" ADD CONSTRAINT "public_price_lists_lab_organization_id_fkey" FOREIGN KEY (lab_organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

-- SET NULL rather than CASCADE: a departed employee's profile must never take
-- published price history with it.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_price_lists_created_by_fkey' AND conrelid = 'public.public_price_lists'::regclass) THEN
        ALTER TABLE "public"."public_price_lists" ADD CONSTRAINT "public_price_lists_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS public_price_lists_pkey ON public.public_price_lists USING btree (id);

-- One current list per lab, enforced rather than trusted to the RPC.
CREATE UNIQUE INDEX IF NOT EXISTS public_price_lists_one_current ON public.public_price_lists USING btree (lab_organization_id) WHERE is_current;

CREATE INDEX IF NOT EXISTS public_price_lists_history ON public.public_price_lists USING btree (lab_organization_id, created_at DESC);
```

- [ ] **Step 4: Create the policy**

Create `db/schema/30_policies/30_public_price_lists.sql`:

```sql
-- public_price_lists — RLS policies
-- Every statement is idempotent, so the file is safe to re-run.
--
-- One SELECT policy and no write policy at all. Writes arrive only through
-- publish_public_price_list and set_current_public_price_list, which are
-- SECURITY DEFINER, and 40_grants.sql revokes write privileges from both
-- browser roles as a second, independent barrier.

DROP POLICY IF EXISTS "current public price list is world readable" ON "public"."public_price_lists";

CREATE POLICY "current public price list is world readable" ON "public"."public_price_lists" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING ((is_current OR is_lab_management(lab_organization_id)));
```

- [ ] **Step 5: Revoke the writes**

Append to `db/schema/40_grants.sql`, alongside the existing revokes:

```sql
-- The public price list is written only by publish_public_price_list and
-- set_current_public_price_list, both SECURITY DEFINER. No browser role writes
-- it directly, and anon must not even execute the RPCs.
revoke insert, update, delete on table public.public_price_lists from anon, authenticated;
```

- [ ] **Step 6: Regenerate apply.sql and run the test**

```bash
node tools/build-db-apply.js
node tools/build-db-apply.js --check
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema/apply.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/public_price_lists.sql
```

Expected: `--check` exits 0; both psql runs finish without raising.

- [ ] **Step 7: Commit**

```bash
git add db/schema/10_tables/30_public_price_lists.sql db/schema/30_policies/30_public_price_lists.sql db/schema/40_grants.sql db/schema/apply.sql tests/sql/public_price_lists.sql
git commit -m "feat(db): versioned public price list table"
```

---

### Task 3: Document validation in the database

**Files:**
- Create: `db/schema/20_functions/public_price_document_is_valid.sql`
- Modify: `db/schema/30_policies/30_public_price_lists.sql` (add the CHECK constraint)
- Modify: `tests/sql/public_price_lists.sql` (append the validator block before `rollback;`)
- Modify: `db/schema/apply.sql` (regenerated)

**Interfaces:**
- Consumes: `public.public_price_lists` from Task 2.
- Produces: `public.public_price_document_is_valid(p_document jsonb) returns boolean`, `IMMUTABLE`, usable in a `CHECK`. Task 4's publish RPC calls it; Task 8 mirrors its rules in the browser.

- [ ] **Step 1: Write the failing test**

Insert before `rollback;` in `tests/sql/public_price_lists.sql`:

```sql
-- Document validation ------------------------------------------------------
do $$
declare
    v_case record;
begin
    for v_case in
        select * from (values
            ('{"schema":1,"currency":"lei","intro_note":"","footnote":"","groups":[{"title":"G","rows":[{"item":"X","amount":200}]}]}', true,  'a minimal valid document'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[]}]}',                                      true,  'a group with no rows'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[{"item":"X","amount":199.5,"variant":"IVOCLAR","footnote":true,"currency":"EUR"}]}]}', true, 'every optional field'),
            ('{"schema":2,"currency":"lei","groups":[{"title":"G","rows":[]}]}',                                      false, 'an unknown schema version'),
            ('{"currency":"lei","groups":[{"title":"G","rows":[]}]}',                                                 false, 'a missing schema version'),
            ('{"schema":1,"currency":"lei","groups":[]}',                                                             false, 'no groups'),
            ('{"schema":1,"currency":"lei"}',                                                                         false, 'a missing groups key'),
            ('{"schema":1,"currency":"","groups":[{"title":"G","rows":[]}]}',                                          false, 'an empty currency'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"","rows":[]}]}',                                        false, 'an empty group title'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[]},{"title":"G","rows":[]}]}',               false, 'duplicate group titles'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[{"item":"","amount":1}]}]}',                 false, 'an empty item name'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[{"item":"X","amount":-1}]}]}',               false, 'a negative amount'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[{"item":"X","amount":1.005}]}]}',            false, 'more than two decimals'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[{"item":"X","amount":"200"}]}]}',            false, 'an amount written as text'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[{"item":"X"}]}]}',                           false, 'a row with no amount'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[{"item":"X","amount":1000001}]}]}',          false, 'an implausible amount'),
            ('{"schema":1,"currency":"lei","groups":[{"title":"G","rows":{"item":"X"}}]}',                             false, 'rows that are not an array'),
            ('[]',                                                                                                     false, 'an array instead of an object'),
            ('null',                                                                                                   false, 'a null document')
        ) as t(document, expected, description)
    loop
        if public.public_price_document_is_valid(v_case.document::jsonb) <> v_case.expected then
            raise exception 'Validator verdict wrong for %: expected %', v_case.description, v_case.expected;
        end if;
    end loop;
end $$;

do $$
declare
    v_long_item jsonb := jsonb_build_object(
        'schema', 1, 'currency', 'lei',
        'groups', jsonb_build_array(jsonb_build_object('title', 'G',
            'rows', jsonb_build_array(jsonb_build_object('item', repeat('x', 201), 'amount', 1)))));
    v_many_rows jsonb;
begin
    if public.public_price_document_is_valid(v_long_item) then
        raise exception 'An item name of 201 characters was accepted';
    end if;

    select jsonb_build_object('schema', 1, 'currency', 'lei',
             'groups', jsonb_build_array(jsonb_build_object('title', 'G', 'rows', jsonb_agg(
                 jsonb_build_object('item', 'Row ' || g, 'amount', 1)))))
      into v_many_rows
      from generate_series(1, 201) as g;

    if public.public_price_document_is_valid(v_many_rows) then
        raise exception 'A document with 201 rows was accepted';
    end if;
end $$;

-- The table refuses an invalid document even from a privileged writer -------
do $$
declare
    v_lab uuid;
begin
    insert into public.organizations (name, slug, organization_type, active)
    values ('Check Lab', 'check-lab-public-prices', 'lab', true)
    returning id into v_lab;

    begin
        insert into public.public_price_lists (lab_organization_id, document, is_current)
        values (v_lab, '{"schema":1,"currency":"lei","groups":[]}'::jsonb, false);
        raise exception 'An invalid document was stored';
    exception when check_violation then
        null;
    end;
end $$;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/public_price_lists.sql`
Expected: FAIL — `function public.public_price_document_is_valid(jsonb) does not exist`

- [ ] **Step 3: Write the validator**

Create `db/schema/20_functions/public_price_document_is_valid.sql`:

> **Corrected during execution.** The SQL below is what shipped, not what this
> plan originally specified. Two bugs were found while implementing it, both of
> the same family — jsonb operators returning NULL or serialized text where a
> type error would be expected — and neither was catchable here, since this
> environment cannot execute SQL. First: `jsonb_typeof(key) <> 'array'` silently
> accepts an ABSENT key, because `->` yields SQL NULL, the comparison yields
> NULL, and PL/pgSQL skips a NULL-conditioned branch; a document with no
> `groups`, or a row with no `amount`, was judged valid, and the latter would
> print "NaN lei" on the public page. Fixed with `is distinct from`. Second:
> `->>` returns serialized JSON text for an object or array, so every length
> check accepted non-strings — `{"title":{"a":1}}` passed a 1..80 bound as 8
> characters. Fixed with a `jsonb_typeof` gate before each length check. Also
> `scale()` rejected `1.500`, a legitimate two-decimal price, so precision is
> now checked with `round(v_amount, 2)`. The verdict table in Step 1 gained
> seven cases covering the type gates and a two-group over-cap fixture; see
> `tests/sql/public_price_lists.sql` for what shipped.

```sql
-- Flowrise Supabase function: public.public_price_document_is_valid(p_document jsonb)
-- Structural validation for a published public price list. The browser editor
-- applies the same rules so an admin sees problems inline, but this is the
-- authority: it backs a CHECK constraint, so no client can store a document that
-- fails it.
--
-- IMMUTABLE because it reads nothing but its argument -- which is also what makes
-- it legal in a CHECK constraint.

CREATE OR REPLACE FUNCTION public.public_price_document_is_valid(p_document jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
    v_group jsonb;
    v_row jsonb;
    v_titles text[] := array[]::text[];
    v_title text;
    v_rows int := 0;
    v_amount numeric;
begin
    if p_document is null or jsonb_typeof(p_document) <> 'object' then return false; end if;
    -- The bound is the number 1, not the string "1"; jsonb equality distinguishes them.
    if p_document->'schema' is distinct from '1'::jsonb then return false; end if;

    -- currency: required string, 1..8 characters. `->>` returns text for any jsonb
    -- type (an object, array or number all serialize to some text), so the length
    -- check alone would accept a non-string; the type gate closes that.
    if jsonb_typeof(p_document->'currency') is distinct from 'string' then return false; end if;
    if coalesce(length(p_document->>'currency'), 0) not between 1 and 8 then return false; end if;

    -- the two notes may be absent entirely, but if present must be a string (or
    -- json null, which reads back as empty) and not long
    if p_document ? 'intro_note' then
        if jsonb_typeof(p_document->'intro_note') not in ('string', 'null') then return false; end if;
        if coalesce(length(p_document->>'intro_note'), 0) > 400 then return false; end if;
    end if;

    if p_document ? 'footnote' then
        if jsonb_typeof(p_document->'footnote') not in ('string', 'null') then return false; end if;
        if coalesce(length(p_document->>'footnote'), 0) > 400 then return false; end if;
    end if;

    -- A missing key makes `->` yield SQL NULL, so `jsonb_typeof(NULL) <> 'array'`
    -- is itself NULL -- and a NULL condition silently skips the branch instead
    -- of rejecting the document. `is distinct from` treats a missing key as a
    -- real mismatch, so it is rejected as intended.
    if jsonb_typeof(p_document->'groups') is distinct from 'array' then return false; end if;
    if jsonb_array_length(p_document->'groups') = 0 then return false; end if;

    for v_group in select jsonb_array_elements(p_document->'groups') loop
        if jsonb_typeof(v_group) <> 'object' then return false; end if;

        -- title: required string, 1..80 characters, unique within the document.
        if jsonb_typeof(v_group->'title') is distinct from 'string' then return false; end if;
        v_title := v_group->>'title';
        if coalesce(length(v_title), 0) not between 1 and 80 then return false; end if;
        if v_title = any (v_titles) then return false; end if;
        v_titles := v_titles || v_title;

        if jsonb_typeof(v_group->'rows') is distinct from 'array' then return false; end if;

        for v_row in select jsonb_array_elements(v_group->'rows') loop
            if jsonb_typeof(v_row) <> 'object' then return false; end if;

            v_rows := v_rows + 1;
            if v_rows > 200 then return false; end if;

            -- item: required string, 1..200 characters.
            if jsonb_typeof(v_row->'item') is distinct from 'string' then return false; end if;
            if coalesce(length(v_row->>'item'), 0) not between 1 and 200 then return false; end if;

            -- variant and row currency: optional, but if the key is present at all
            -- it must be a string of valid length -- an explicit null is rejected,
            -- matching the browser mirror and the editor, which deletes the key
            -- instead of ever writing null.
            if v_row ? 'variant' then
                if jsonb_typeof(v_row->'variant') <> 'string' then return false; end if;
                if coalesce(length(v_row->>'variant'), 0) not between 1 and 60 then return false; end if;
            end if;

            if v_row ? 'currency' then
                if jsonb_typeof(v_row->'currency') <> 'string' then return false; end if;
                if coalesce(length(v_row->>'currency'), 0) not between 1 and 8 then return false; end if;
            end if;

            if v_row ? 'footnote' and jsonb_typeof(v_row->'footnote') not in ('boolean', 'null') then
                return false;
            end if;

            if jsonb_typeof(v_row->'amount') is distinct from 'number' then return false; end if;
            v_amount := (v_row->>'amount')::numeric;
            if v_amount < 0 or v_amount > 1000000 then return false; end if;
            -- scale() reports the stored display scale, and jsonb preserves a
            -- literal's trailing zeros, so 1.500 would fail scale(v_amount) > 2
            -- even though it is a legitimate two-decimal price. Compare values
            -- instead, matching the browser's Math.round(amount*100) check.
            if v_amount <> round(v_amount, 2) then return false; end if;
        end loop;
    end loop;

    return true;
end;
$function$
;

-- Security definer: False
-- Return type: boolean
-- Identity arguments: p_document jsonb
```

- [ ] **Step 4: Add the CHECK constraint**

Append to `db/schema/30_policies/30_public_price_lists.sql`:

```sql
-- Function-dependent constraint, so it lives here rather than with the table:
-- the validator must exist before it can be referenced.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_price_lists_document_valid' AND conrelid = 'public.public_price_lists'::regclass) THEN
        ALTER TABLE "public"."public_price_lists" ADD CONSTRAINT "public_price_lists_document_valid" CHECK (public.public_price_document_is_valid(document));
    END IF;
END $$;
```

- [ ] **Step 5: Regenerate, apply and run the test**

```bash
node tools/build-db-apply.js && node tools/build-db-apply.js --check
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema/apply.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/public_price_lists.sql
```

Expected: no exception raised.

- [ ] **Step 6: Commit**

```bash
git add db/schema/20_functions/public_price_document_is_valid.sql db/schema/30_policies/30_public_price_lists.sql db/schema/apply.sql tests/sql/public_price_lists.sql
git commit -m "feat(db): validate the public price document in the database"
```

---

### Task 4: Publishing, restoring and the permission check

> **Corrected during execution.** The SQL below is what shipped. Two defects in
> the original were found by review, both fatal to the task's stated goal and
> neither catchable here, since this environment cannot execute SQL.
> **First:** `revoke execute on function ... from anon` is a no-op. Postgres
> grants EXECUTE on a new function to PUBLIC, and `anon` holds it *through*
> PUBLIC, which a revoke aimed at `anon` never touches — so anon could call the
> publish RPC, and the anon test, expecting `insufficient_privilege` but getting
> `raise_exception` from the gate, would have aborted the whole SQL test file.
> The fix is the repo's paired idiom, `revoke all ... from public, anon` plus an
> explicit `grant execute ... to authenticated` — mandatory, because revoking
> from PUBLIC strips `authenticated` too.
> **Second:** `p_expected_current uuid DEFAULT NULL` admitted a silent
> overwrite. A panel that loaded while no version was current holds a null
> expectation; if its publish waits on a concurrent publish, `EvalPlanQual`
> drops the demoted row and the winner's new row is invisible to the waiter's
> statement snapshot, so the guard compares `''` to `''` and passes — and the next
> statement, with a fresh snapshot, demotes the winner. Fixed with a lab-scoped
> `pg_advisory_xact_lock` in both functions and no defaults on the signature,
> which also removed the first-publish race this plan had accepted and the
> restore race it had not noticed.

**Files:**
- Create: `db/schema/20_functions/may_edit_public_prices.sql`
- Create: `db/schema/20_functions/publish_public_price_list.sql`
- Create: `db/schema/20_functions/set_current_public_price_list.sql`
- Modify: `db/schema/40_grants.sql` (append)
- Modify: `tests/sql/public_price_lists.sql` (append before `rollback;`)
- Modify: `db/schema/apply.sql` (regenerated)

**Interfaces:**
- Consumes: the table from Task 2, `public_price_document_is_valid` from Task 3, and the existing `is_lab_management(uuid)` and `get_flowrise_lab_id()`.
- Produces, all called from the admin panel in Task 9:
  - `may_edit_public_prices() returns boolean`
  - `publish_public_price_list(p_document jsonb, p_note text, p_expected_current uuid) returns uuid` — returns the new version id.
  - `set_current_public_price_list(p_version_id uuid) returns uuid`

A note on what is tested here and what is not: asserting the real manager flow needs an `auth.users` row and a JWT claim inside a test transaction, which is fragile across Supabase versions — the existing `tests/sql/calendar_permissions.sql` avoids it for the same reason. So the gates are asserted against the function definitions, the same way that file does, and the live flow is covered by the acceptance pass in Task 9.

- [ ] **Step 1: Write the failing test**

Insert before `rollback;` in `tests/sql/public_price_lists.sql`:

```sql
-- Publishing contract ------------------------------------------------------
do $$
declare
    v_definition text;
begin
    select pg_get_functiondef('public.publish_public_price_list(jsonb,text,uuid)'::regprocedure)
      into v_definition;

    if v_definition not ilike '%security definer%' then
        raise exception 'publish_public_price_list must be SECURITY DEFINER';
    end if;
    if v_definition not ilike '%is_lab_management%' then
        raise exception 'publish_public_price_list must gate on is_lab_management';
    end if;
    if v_definition not ilike '%public_price_document_is_valid%' then
        raise exception 'publish_public_price_list must validate the document';
    end if;
    if v_definition not ilike '%p_expected_current%' then
        raise exception 'publish_public_price_list must refuse a stale expected version';
    end if;
    if v_definition not ilike '%for update%' then
        raise exception 'publish_public_price_list must lock the current row so two publishes serialize';
    end if;
    if v_definition not ilike '%auth.uid()%' then
        raise exception 'publish_public_price_list must record who published';
    end if;

    select pg_get_functiondef('public.set_current_public_price_list(uuid)'::regprocedure)
      into v_definition;
    if v_definition not ilike '%is_lab_management%' then
        raise exception 'set_current_public_price_list must gate on is_lab_management';
    end if;

    select pg_get_functiondef('public.may_edit_public_prices()'::regprocedure)
      into v_definition;
    if v_definition not ilike '%is_lab_management%'
       or v_definition not ilike '%get_flowrise_lab_id%' then
        raise exception 'may_edit_public_prices must wrap is_lab_management(get_flowrise_lab_id())';
    end if;
end $$;

-- An unauthenticated caller cannot publish or restore ---------------------
-- Role switches are statements: inside a DO block the switch does not reliably
-- hold, and a test that quietly runs as the owner passes while proving nothing.
set local role anon;

do $$
begin
    begin
        perform public.publish_public_price_list(
            '{"schema":1,"currency":"lei","groups":[{"title":"G","rows":[]}]}'::jsonb, null, null);
        raise exception 'An anonymous caller published a price list';
    exception when insufficient_privilege then
        null;
    end;

    begin
        perform public.set_current_public_price_list('00000000-0000-4000-8000-0000000a1101'::uuid);
        raise exception 'An anonymous caller restored a price list';
    exception when insufficient_privilege then
        null;
    end;
end $$;

reset role;

-- A signed-in user who is not lab management gets false, not an error ------
set local role authenticated;

do $$
declare
    v_can boolean;
begin
    select public.may_edit_public_prices() into v_can;
    if v_can then
        raise exception 'may_edit_public_prices answered true with no identity';
    end if;
end $$;

reset role;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/public_price_lists.sql`
Expected: FAIL — `function public.publish_public_price_list(jsonb,text,uuid) does not exist`

- [ ] **Step 3: Write the permission check**

Create `db/schema/20_functions/may_edit_public_prices.sql`:

```sql
-- Flowrise Supabase function: public.may_edit_public_prices()
-- Whether the caller may edit the public price list. A convenience for the admin
-- panel, which needs the answer before it renders an editor; it introduces no new
-- permission concept and role_permissions is untouched.

CREATE OR REPLACE FUNCTION public.may_edit_public_prices()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select coalesce(public.is_lab_management(public.get_flowrise_lab_id()), false);
$function$
;

-- Security definer: True
-- Return type: boolean
-- Identity arguments:
```

- [ ] **Step 4: Write the publish function**

Create `db/schema/20_functions/publish_public_price_list.sql`:

```sql
-- Flowrise Supabase function: public.publish_public_price_list(p_document jsonb, p_note text, p_expected_current uuid)
-- Publishes a new version of the public price list and makes it the current one,
-- in one transaction, so a visitor can never read a half-updated list.
--
-- p_expected_current is the version the editor had loaded. When it no longer
-- matches, the publish raises instead of overwriting: two managers editing at the
-- same time must not lose each other's work silently. A per-lab advisory
-- transaction lock (taken right after the management gate, before either the
-- current row or the document is looked at) is what makes that check race-free:
-- it fully serializes publishes and restores for a lab, so a waiter is never
-- left mid-race with a stale, NULL-defaulting view of "current". The
-- SELECT ... FOR UPDATE that follows is then just the ordinary read of the row
-- to compare against p_expected_current.

CREATE OR REPLACE FUNCTION public.publish_public_price_list(p_document jsonb, p_note text, p_expected_current uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_lab uuid := public.get_flowrise_lab_id();
    v_current uuid;
    v_id uuid;
begin
    if v_lab is null then
        raise exception 'Laboratorul nu este configurat.';
    end if;

    if not public.is_lab_management(v_lab) then
        raise exception 'Doar administratorii sau managerii pot publica prețurile publice.';
    end if;

    -- Serialize every publish and restore for this lab. Without it, a waiter that
    -- acquires the row lock after a concurrent publish commits sees neither the
    -- demoted row nor the new one, and a null expectation then passes a check that
    -- exists precisely to stop one manager overwriting another. With the lock in
    -- place, every race for this lab resolves into the friendly stale-version
    -- message below rather than a raw unique-violation on the one-current index.
    perform pg_advisory_xact_lock(hashtextextended('public_price_lists:' || v_lab::text, 0));

    if not public.public_price_document_is_valid(p_document) then
        raise exception 'Lista de prețuri nu are un format valid.';
    end if;

    select id
      into v_current
      from public.public_price_lists
     where lab_organization_id = v_lab
       and is_current
       for update;

    if coalesce(v_current::text, '') <> coalesce(p_expected_current::text, '') then
        raise exception 'Lista a fost modificată de altcineva. Reîncarcă pagina înainte de a publica.';
    end if;

    update public.public_price_lists
       set is_current = false
     where lab_organization_id = v_lab
       and is_current;

    insert into public.public_price_lists (lab_organization_id, document, is_current, note, created_by)
    values (v_lab, p_document, true, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
    returning id into v_id;

    return v_id;
end;
$function$
;

-- Security definer: True
-- Return type: uuid
-- Identity arguments: p_document jsonb, p_note text, p_expected_current uuid
```

- [ ] **Step 5: Write the restore function**

Create `db/schema/20_functions/set_current_public_price_list.sql`:

```sql
-- Flowrise Supabase function: public.set_current_public_price_list(p_version_id uuid)
-- Restores an earlier published version by making it current again. It does not
-- copy or rewrite the version -- history stays exactly as it was published.

CREATE OR REPLACE FUNCTION public.set_current_public_price_list(p_version_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_lab uuid := public.get_flowrise_lab_id();
    v_exists boolean;
begin
    if v_lab is null then
        raise exception 'Laboratorul nu este configurat.';
    end if;

    if not public.is_lab_management(v_lab) then
        raise exception 'Doar administratorii sau managerii pot modifica prețurile publice.';
    end if;

    -- Serialize every publish and restore for this lab; see publish_public_price_list
    -- for why a raw row lock alone is not enough to make concurrent writers safe.
    perform pg_advisory_xact_lock(hashtextextended('public_price_lists:' || v_lab::text, 0));

    select true
      into v_exists
      from public.public_price_lists
     where id = p_version_id
       and lab_organization_id = v_lab
       for update;

    if not coalesce(v_exists, false) then
        raise exception 'Versiunea cerută nu există.';
    end if;

    update public.public_price_lists
       set is_current = false
     where lab_organization_id = v_lab
       and is_current
       and id <> p_version_id;

    update public.public_price_lists
       set is_current = true
     where id = p_version_id
       and lab_organization_id = v_lab;

    return p_version_id;
end;
$function$
;

-- Security definer: True
-- Return type: uuid
-- Identity arguments: p_version_id uuid
```

- [ ] **Step 6: Keep anon out of the RPCs**

Append to `db/schema/40_grants.sql`:

```sql
-- and restoring are signed-in actions; reading the current list needs no function.
revoke all on function public.publish_public_price_list(jsonb, text, uuid) from public, anon;
grant execute on function public.publish_public_price_list(jsonb, text, uuid) to authenticated;

revoke all on function public.set_current_public_price_list(uuid) from public, anon;
grant execute on function public.set_current_public_price_list(uuid) to authenticated;

revoke all on function public.may_edit_public_prices() from public, anon;
grant execute on function public.may_edit_public_prices() to authenticated;
```

- [ ] **Step 7: Regenerate, apply and run the test**

```bash
node tools/build-db-apply.js && node tools/build-db-apply.js --check
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema/apply.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/public_price_lists.sql
```

Expected: no exception raised.

- [ ] **Step 8: Commit**

```bash
git add db/schema/20_functions/may_edit_public_prices.sql db/schema/20_functions/publish_public_price_list.sql db/schema/20_functions/set_current_public_price_list.sql db/schema/40_grants.sql db/schema/apply.sql tests/sql/public_price_lists.sql
git commit -m "feat(db): publish and restore the public price list"
```

---

### Task 5: Seed the first version

**Files:**
- Create: `db/migrations/20260925_public_price_list_seed.sql`
- Create: `tests/app/public-price-seed.test.js`

**Interfaces:**
- Consumes: `tests/fixtures/public-price-list-v1.json` from Task 1, the table from Task 2, the validator from Task 3.
- Produces: one row in `public_price_lists` with `is_current = true` for the lab resolved by `get_flowrise_lab_id()`.

- [ ] **Step 1: Write the failing test**

The migration embeds the same document as the fixture, and two copies drift. This test is the guard. Create `tests/app/public-price-seed.test.js`:

```js
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const root=path.join(__dirname,'../..');
const fixture=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/public-price-list-v1.json'),'utf8'));
const sql=fs.readFileSync(path.join(root,'db/migrations/20260925_public_price_list_seed.sql'),'utf8');

test('the seed migration embeds exactly the fixture document',()=>{
 const match=sql.match(/\$seed\$([\s\S]*?)\$seed\$/);
 assert.ok(match,'the migration must carry the document in a $seed$ dollar-quoted literal');
 assert.deepEqual(JSON.parse(match[1]),fixture);
});

test('the seed migration is idempotent by construction',()=>{
 assert.match(sql,/where not exists/i,'re-running the migration must not insert a second version');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/app/public-price-seed.test.js`
Expected: FAIL — `ENOENT ... 20260925_public_price_list_seed.sql`

- [ ] **Step 3: Write the migration**

Create `db/migrations/20260925_public_price_list_seed.sql`. Generate the body rather than retyping it:

```bash
node -e '
const fs=require("node:fs");
const doc=fs.readFileSync("tests/fixtures/public-price-list-v1.json","utf8").trim();
const header=`-- Seeds version 1 of the public price list: the list that was hand-written into
-- website/site/index.html up to 2026-09-25, transcribed verbatim so the landing
-- page renders exactly what it rendered before it started reading the database.
--
-- Idempotent: it inserts only when the lab has no price list at all, so a rebuilt
-- database comes up publishing this list while a live one keeps its history.

insert into public.public_price_lists (lab_organization_id, document, is_current, note)
select public.get_flowrise_lab_id(),
       $seed$
`;
const footer=`
$seed$::jsonb,
       true,
       $$Lista inițială, preluată din pagina publicată.$$
where public.get_flowrise_lab_id() is not null
  and not exists (
      select 1 from public.public_price_lists
       where lab_organization_id = public.get_flowrise_lab_id()
  );
`;
fs.writeFileSync("db/migrations/20260925_public_price_list_seed.sql",header+doc+footer);
'
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tests/app/public-price-seed.test.js
```

Expected: PASS, 2 tests

- [ ] **Step 5: Apply the migration and verify the row**

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/20260925_public_price_list_seed.sql
psql "$DATABASE_URL" -c "select jsonb_array_length(document->'groups') as groups, is_current, note from public.public_price_lists where is_current;"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/20260925_public_price_list_seed.sql
psql "$DATABASE_URL" -c "select count(*) from public.public_price_lists;"
```

Expected: the first query shows `groups = 5`, `is_current = t`; after the second (repeat) run the count is still `1`.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/20260925_public_price_list_seed.sql tests/app/public-price-seed.test.js
git commit -m "feat(db): seed the published price list from the live page"
```

---

### Task 6: Reading the list in the browser

**Files:**
- Create: `website/shared/price-list-source.js`
- Create: `tests/app/public-price-source.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (it is deliberately independent of the renderer).
- Produces: `globalThis.PriceListSource` and `module.exports` with `loadPriceList(options)`, where `options` is `{url, key, fetch, storage, onDocument, onUnavailable, cacheKey}` and the return value is a promise resolving to the document actually in hand, or `null`. `onDocument(doc)` may be called twice — once from cache, once from the network — and is not called twice for an unchanged document.

- [ ] **Step 1: Write the failing test**

Create `tests/app/public-price-source.test.js`:

```js
const test=require('node:test');
const assert=require('node:assert/strict');
const {loadPriceList}=require('../../website/shared/price-list-source.js');

const doc=(title)=>({schema:1,currency:'lei',groups:[{title,rows:[]}]});
const okFetch=(body)=>()=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(body)});
const storage=(initial)=>{
 const map=new Map(initial?Object.entries(initial):[]);
 return {getItem:(k)=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:(k)=>map.delete(k),map};
};
const collect=()=>{const seen=[];return {fn:(d)=>seen.push(d),seen};};

test('a fresh visitor renders what the network returns and caches it',async()=>{
 const shown=collect(),failed=collect(),store=storage();
 const got=await loadPriceList({url:'u',key:'k',fetch:okFetch([{id:'v1',document:doc('Net')}]),storage:store,onDocument:shown.fn,onUnavailable:failed.fn});
 assert.deepEqual(got,doc('Net'));
 assert.deepEqual(shown.seen,[doc('Net')]);
 assert.deepEqual(failed.seen,[]);
 assert.deepEqual(JSON.parse(store.map.get('flowrise_public_prices_v1')).document,doc('Net'));
});

test('a returning visitor sees the cache first, then the change',async()=>{
 const shown=collect(),store=storage({flowrise_public_prices_v1:JSON.stringify({document:doc('Cached')})});
 await loadPriceList({url:'u',key:'k',fetch:okFetch([{id:'v2',document:doc('Net')}]),storage:store,onDocument:shown.fn,onUnavailable:collect().fn});
 assert.deepEqual(shown.seen,[doc('Cached'),doc('Net')]);
});

test('an unchanged document does not re-render',async()=>{
 const shown=collect(),store=storage({flowrise_public_prices_v1:JSON.stringify({document:doc('Same')})});
 await loadPriceList({url:'u',key:'k',fetch:okFetch([{id:'v3',document:doc('Same')}]),storage:store,onDocument:shown.fn,onUnavailable:collect().fn});
 assert.deepEqual(shown.seen,[doc('Same')]);
});

test('a stale cache is served when the network is down',async()=>{
 const shown=collect(),failed=collect();
 const store=storage({flowrise_public_prices_v1:JSON.stringify({document:doc('Cached')})});
 const got=await loadPriceList({url:'u',key:'k',fetch:()=>Promise.reject(new Error('offline')),storage:store,onDocument:shown.fn,onUnavailable:failed.fn});
 assert.deepEqual(got,doc('Cached'));
 assert.deepEqual(shown.seen,[doc('Cached')]);
 assert.deepEqual(failed.seen.length,0);
});

test('a first visit with no network reports unavailable and does not throw',async()=>{
 const shown=collect(),failed=collect();
 const got=await loadPriceList({url:'u',key:'k',fetch:()=>Promise.reject(new Error('offline')),storage:storage(),onDocument:shown.fn,onUnavailable:failed.fn});
 assert.equal(got,null);
 assert.deepEqual(shown.seen,[]);
 assert.equal(failed.seen.length,1);
});

test('a non-200 response is a failure, not a document',async()=>{
 const shown=collect(),failed=collect();
 const fetchImpl=()=>Promise.resolve({ok:false,status:503,json:()=>Promise.reject(new Error('not json'))});
 await loadPriceList({url:'u',key:'k',fetch:fetchImpl,storage:storage(),onDocument:shown.fn,onUnavailable:failed.fn});
 assert.deepEqual(shown.seen,[]);
 assert.equal(failed.seen.length,1);
});

test('an empty result is a failure, not an empty page',async()=>{
 const shown=collect(),failed=collect();
 await loadPriceList({url:'u',key:'k',fetch:okFetch([]),storage:storage(),onDocument:shown.fn,onUnavailable:failed.fn});
 assert.deepEqual(shown.seen,[]);
 assert.equal(failed.seen.length,1);
});

test('a corrupt cache is ignored rather than rendered',async()=>{
 const shown=collect(),failed=collect();
 const store=storage({flowrise_public_prices_v1:'{not json'});
 await loadPriceList({url:'u',key:'k',fetch:okFetch([{id:'v4',document:doc('Net')}]),storage:store,onDocument:shown.fn,onUnavailable:failed.fn});
 assert.deepEqual(shown.seen,[doc('Net')]);
});

test('storage that throws does not take the page down',async()=>{
 const shown=collect(),failed=collect();
 const hostile={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');},removeItem(){throw new Error('blocked');}};
 const got=await loadPriceList({url:'u',key:'k',fetch:okFetch([{id:'v5',document:doc('Net')}]),storage:hostile,onDocument:shown.fn,onUnavailable:failed.fn});
 assert.deepEqual(got,doc('Net'));
 assert.deepEqual(shown.seen,[doc('Net')]);
 assert.deepEqual(failed.seen,[]);
});

test('the request asks only for the current list',async()=>{
 const calls=[];
 const fetchImpl=(url,init)=>{calls.push([url,init]);return okFetch([{id:'v6',document:doc('Net')}])();};
 await loadPriceList({url:'https://x.supabase.co/rest/v1/public_price_lists?select=id,document&is_current=eq.true&limit=1',key:'pub-key',fetch:fetchImpl,storage:storage(),onDocument:()=>{},onUnavailable:()=>{}});
 assert.match(calls[0][0],/is_current=eq\.true/);
 assert.equal(calls[0][1].headers.apikey,'pub-key');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/app/public-price-source.test.js`
Expected: FAIL — `Cannot find module '../../website/shared/price-list-source.js'`

- [ ] **Step 3: Write the source module**

Create `website/shared/price-list-source.js`:

```js
// Fetches the current public price list, cache first.
//
// Everything here is injected -- fetch, storage, the callbacks -- because this is
// the one piece of the landing page that can fail in ways a visitor notices, and
// injected collaborators are what make those failures testable without a browser.
(function (root) {
  'use strict';

  var DEFAULT_CACHE_KEY = 'flowrise_public_prices_v1';

  // localStorage throws in a private window and can hold whatever a previous
  // version wrote, so every access is guarded and a bad value is simply absent.
  function readCache(storage, key) {
    try {
      var raw = storage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      var doc = parsed && parsed.document;
      return doc && doc.groups ? doc : null;
    } catch (err) {
      return null;
    }
  }

  function writeCache(storage, key, doc) {
    try {
      storage.setItem(key, JSON.stringify({ document: doc, fetched_at: new Date().toISOString() }));
    } catch (err) {
      // A visitor who blocks site data still gets prices; they just pay for them
      // on every visit.
    }
  }

  function loadPriceList(options) {
    var key = options.cacheKey || DEFAULT_CACHE_KEY;
    var storage = options.storage;
    var cached = readCache(storage, key);

    if (cached) options.onDocument(cached);

    return options.fetch(options.url, {
      headers: { apikey: options.key, accept: 'application/json' }
    })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (rows) {
        var doc = rows && rows[0] && rows[0].document;
        if (!doc || !doc.groups) throw new Error('No current price list');
        if (!cached || JSON.stringify(cached) !== JSON.stringify(doc)) options.onDocument(doc);
        writeCache(storage, key, doc);
        return doc;
      })
      .catch(function (err) {
        if (!cached) options.onUnavailable(err);
        return cached || null;
      });
  }

  var api = { loadPriceList: loadPriceList, CACHE_KEY: DEFAULT_CACHE_KEY };
  root.PriceListSource = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/app/public-price-source.test.js`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add website/shared/price-list-source.js tests/app/public-price-source.test.js
git commit -m "feat(site): fetch the public price list, cache first"
```

---

### Task 7: Wire the landing page

**Files:**
- Modify: `website/site/index.html` (replace the price rows; add two script tags and the loader)
- Modify: `deploy/caddy.Dockerfile`
- Modify: `deploy/README.md`
- Create: `tests/app/public-price-page.test.js`

**Interfaces:**
- Consumes: `PriceList.priceListTree`, `PriceList.mount` (Task 1) and `PriceListSource.loadPriceList` (Task 6), both as browser globals.
- Produces: the live landing page. No JS interface.

- [ ] **Step 1: Write the failing test**

The risk here is a half-done edit: new loader added, old rows left behind, so the page shows both. Create `tests/app/public-price-page.test.js`:

```js
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const html=fs.readFileSync(path.join(__dirname,'../../website/site/index.html'),'utf8');

test('the hand-written price rows are gone',()=>{
 assert.equal(html.includes('<li class="row">'),false,'a hard-coded price row is still in the page');
 assert.equal(/<div class="group">/.test(html),false,'a hard-coded price group is still in the page');
});

test('the price section has a container for the rendered list',()=>{
 assert.match(html,/<div id="priceList"[^>]*><\/div>/);
 assert.match(html,/<h2>Prețuri<\/h2>/,'the static heading stays in the page');
});

test('the page loads the shared renderer and the source module',()=>{
 assert.match(html,/<script src="price-list\.js"><\/script>/);
 assert.match(html,/<script src="price-list-source\.js"><\/script>/);
});

test('the loader names the current list and the publishable key',()=>{
 assert.match(html,/is_current=eq\.true/);
 assert.match(html,/sb_publishable_/);
});

test('the unavailable message names the phone number',()=>{
 assert.match(html,/0766 494 063/);
});

test('the styles the renderer produces are still defined',()=>{
 for(const selector of ['.group','.list','.row','.item','.leader','.price','.note-top','.footnote','sup.ref']){
  assert.ok(html.includes(selector+' {')||html.includes(selector+'{'),`${selector} lost its styling`);
 }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/app/public-price-page.test.js`
Expected: FAIL on the first test — the hand-written rows are still there.

- [ ] **Step 3: Replace the price markup**

In `website/site/index.html`, inside `<section class="prices"><div class="wrap">`, keep `<h2>Prețuri</h2>` and delete everything between it and the closing `</div>` of `.wrap` — that is the `<p class="note-top">`, all five `<div class="group">` blocks and the `<p class="footnote">`. Replace them with:

```html
        <div id="priceList"></div>
```

Leave the `<style>` block completely alone: every class it defines is still produced by the renderer, and `tests/app/public-price-page.test.js` checks that.

- [ ] **Step 4: Add the loader**

At the end of `website/site/index.html`, replace the existing single-line script:

```html
  <script>document.getElementById('y').textContent = new Date().getFullYear();</script>
```

with:

```html
  <script src="price-list.js"></script>
  <script src="price-list-source.js"></script>
  <script>
    document.getElementById('y').textContent = new Date().getFullYear();

    // The price list lives in Supabase so the lab can publish it themselves.
    // One anonymous GET with the publishable key -- no Supabase client library on
    // a page whose whole job is to load fast.
    (function () {
      var container = document.getElementById('priceList');
      var url = 'https://qlynvfltjgjgeipndior.supabase.co/rest/v1/public_price_lists'
        + '?select=id,document&is_current=eq.true&limit=1';

      PriceListSource.loadPriceList({
        url: url,
        key: 'sb_publishable_mjDZLRQbubpv2ZISx-bm0w_Ne0z0aY0',
        fetch: window.fetch.bind(window),
        storage: window.localStorage,
        onDocument: function (doc) {
          PriceList.mount(PriceList.priceListTree(doc), container);
          container.removeAttribute('aria-busy');
        },
        onUnavailable: function () {
          var note = document.createElement('p');
          note.className = 'note-top';
          note.textContent = 'Lista de prețuri se încarcă — dacă nu apare, sună la 0766 494 063.';
          container.appendChild(note);
          container.removeAttribute('aria-busy');
        }
      });
    })();
  </script>
```

Also add `aria-busy="true"` to the container so assistive technology is told the region is still filling:

```html
        <div id="priceList" aria-busy="true"></div>
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
node --test tests/app/public-price-page.test.js
node --test tests/
```

Expected: PASS. The whole suite must stay green — `tests/app/public-price-render.test.js` still compares against the committed HTML fixture, not against the live page, so replacing the markup does not break it.

- [ ] **Step 6: See it in a browser**

```bash
cd website/site && python -m http.server 8080
```

If python is unavailable, any static server will do. Copy `website/shared/price-list.js` and `website/shared/price-list-source.js` next to `index.html` first — that is what the Dockerfile does at build time and what the cPanel upload does by hand. Open `http://localhost:8080/`, and confirm: the list renders identically to the committed fixture, the five `†` rows in the implant group keep their markers, and with the network throttled to offline on a fresh profile the phone-number line appears instead of an empty section.

- [ ] **Step 7: Put the shared module in both site roots**

In `deploy/caddy.Dockerfile`, replace the two `COPY` lines and correct the comment above them, which currently claims the roots share nothing:

```dockerfile
# Two roots, one per hostname. They share exactly one file: the price-list
# renderer, which the landing page uses to draw the published list and the admin
# panel uses to preview it before publishing. Copying it into both roots is what
# keeps the preview honest -- one source, no second copy to drift.
COPY website/site /srv/site
COPY website/app  /srv/app
COPY website/shared/price-list.js        /srv/site/price-list.js
COPY website/shared/price-list-source.js /srv/site/price-list-source.js
COPY website/shared/price-list.js        /srv/app/public-prices/price-list.js
```

- [ ] **Step 8: Write down how the landing page is published**

`deploy/README.md` describes the future cutover but not how today's page is updated. Add this section after "The DNS cutover, when you get to it":

```markdown
## Publishing the landing page before the cutover

`www` and the apex are still served by Hostico from cPanel, so a change to
`website/site/index.html` reaches visitors only when the file is uploaded there.
The prices are no longer part of that: they live in Supabase and are published
from https://app.flowrisedental.ro/public-prices/ without touching this file.

When the page itself changes, upload three files to the cPanel document root:

    index.html
    price-list.js          (from website/shared/)
    price-list-source.js   (from website/shared/)

**Diff before you overwrite.** The repository copy is supposed to be
byte-identical to what Hostico serves, but nothing enforces that, and a
difference means somebody edited the live page directly:

    curl -s https://www.flowrisedental.ro/ > /tmp/live.html
    diff /tmp/live.html website/site/index.html

Reconcile any difference before uploading. After the DNS cutover this section
stops applying: the page is then baked into the Caddy image and publishes with a
redeploy.
```

- [ ] **Step 9: Commit**

```bash
git add website/site/index.html deploy/caddy.Dockerfile deploy/README.md tests/app/public-price-page.test.js
git commit -m "feat(site): the landing page reads its prices from the database"
```

---

### Task 8: The editor's document model

The editing operations are pure functions over the document, separated from the UI so they can be tested without a browser and so the panel's own code stays thin.

**Files:**
- Create: `website/app/public-prices/document.js`
- Create: `tests/app/public-price-document.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `globalThis.PriceDocument` and `module.exports`:
  - `emptyDocument()` → a valid one-group document
  - `validate(doc)` → array of `{path, message}`, empty when valid. Mirrors `public_price_document_is_valid`.
  - `addGroup(doc)`, `removeGroup(doc, gi)`, `moveGroup(doc, gi, delta)`, `renameGroup(doc, gi, title)`
  - `addRow(doc, gi)`, `removeRow(doc, gi, ri)`, `moveRow(doc, gi, ri, delta)`, `updateRow(doc, gi, ri, patch)`
  - `setField(doc, field, value)` for `currency`, `intro_note`, `footnote`
  - Every operation returns a new document and never mutates its argument.

- [ ] **Step 1: Write the failing test**

Create `tests/app/public-price-document.test.js`:

```js
const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../../website/app/public-prices/document.js');

const sample=()=>({schema:1,currency:'lei',intro_note:'N',footnote:'F',groups:[
 {title:'A',rows:[{item:'a1',amount:1},{item:'a2',amount:2}]},
 {title:'B',rows:[{item:'b1',amount:3}]}]});

test('an empty document is valid and publishable',()=>{
 const doc=D.emptyDocument();
 assert.deepEqual(D.validate(doc),[]);
 assert.equal(doc.schema,1);
});

test('operations never mutate their argument',()=>{
 const before=sample();
 const frozen=JSON.stringify(before);
 D.addGroup(before);D.addRow(before,0);D.removeRow(before,0,0);D.moveGroup(before,0,1);
 D.updateRow(before,0,0,{amount:99});D.setField(before,'currency','EUR');
 assert.equal(JSON.stringify(before),frozen);
});

test('a row moves within its group and stops at the edges',()=>{
 assert.deepEqual(D.moveRow(sample(),0,1,-1).groups[0].rows.map(r=>r.item),['a2','a1']);
 assert.deepEqual(D.moveRow(sample(),0,0,-1).groups[0].rows.map(r=>r.item),['a1','a2']);
 assert.deepEqual(D.moveRow(sample(),0,1,1).groups[0].rows.map(r=>r.item),['a1','a2']);
});

test('a group moves and stops at the edges',()=>{
 assert.deepEqual(D.moveGroup(sample(),1,-1).groups.map(g=>g.title),['B','A']);
 assert.deepEqual(D.moveGroup(sample(),0,-1).groups.map(g=>g.title),['A','B']);
 assert.deepEqual(D.moveGroup(sample(),1,1).groups.map(g=>g.title),['A','B']);
});

test('removing and adding rows and groups',()=>{
 assert.deepEqual(D.removeRow(sample(),0,0).groups[0].rows.map(r=>r.item),['a2']);
 assert.equal(D.addRow(sample(),1).groups[1].rows.length,2);
 assert.equal(D.addGroup(sample()).groups.length,3);
 assert.deepEqual(D.removeGroup(sample(),0).groups.map(g=>g.title),['B']);
});

test('an empty variant is dropped rather than stored as an empty string',()=>{
 const doc=D.updateRow(sample(),0,0,{variant:'  '});
 assert.equal('variant' in doc.groups[0].rows[0],false);
 assert.equal(D.updateRow(sample(),0,0,{variant:' IVOCLAR '}).groups[0].rows[0].variant,'IVOCLAR');
});

test('an amount typed as text becomes a number',()=>{
 assert.equal(D.updateRow(sample(),0,0,{amount:'250'}).groups[0].rows[0].amount,250);
 assert.equal(D.updateRow(sample(),0,0,{amount:'199,5'}).groups[0].rows[0].amount,199.5);
});

test('validation mirrors the database rules',()=>{
 const cases=[
  [{schema:1,currency:'lei',groups:[]},'groups'],
  [{schema:1,currency:'',groups:[{title:'A',rows:[]}]},'currency'],
  [{schema:1,currency:'lei',groups:[{title:'',rows:[]}]},'groups.0.title'],
  [{schema:1,currency:'lei',groups:[{title:'A',rows:[]},{title:'A',rows:[]}]},'groups.1.title'],
  [{schema:1,currency:'lei',groups:[{title:'A',rows:[{item:'',amount:1}]}]},'groups.0.rows.0.item'],
  [{schema:1,currency:'lei',groups:[{title:'A',rows:[{item:'x',amount:-1}]}]},'groups.0.rows.0.amount'],
  [{schema:1,currency:'lei',groups:[{title:'A',rows:[{item:'x',amount:1.005}]}]},'groups.0.rows.0.amount'],
  [{schema:1,currency:'lei',groups:[{title:'A',rows:[{item:'x',amount:1000001}]}]},'groups.0.rows.0.amount'],
  [{schema:1,currency:'lei',groups:[{title:'A',rows:[{item:'x',amount:NaN}]}]},'groups.0.rows.0.amount'],
  [{schema:1,currency:'lei',intro_note:'x'.repeat(401),groups:[{title:'A',rows:[]}]},'intro_note'],
  [{schema:1,currency:'lei',groups:[{title:'x'.repeat(81),rows:[]}]},'groups.0.title'],
  [{schema:1,currency:'lei',groups:[{title:'A',rows:[{item:'x'.repeat(201),amount:1}]}]},'groups.0.rows.0.item'],
 ];
 for(const [doc,path] of cases){
  const errors=D.validate(doc);
  assert.ok(errors.some(e=>e.path===path),`expected an error at ${path}, got ${JSON.stringify(errors)}`);
 }
});

test('more than 200 rows is refused',()=>{
 const doc={schema:1,currency:'lei',groups:[{title:'A',rows:Array.from({length:201},(_,i)=>({item:'r'+i,amount:1}))}]};
 assert.ok(D.validate(doc).some(e=>e.path==='groups'));
});

test('a valid document produces no errors',()=>{
 assert.deepEqual(D.validate(sample()),[]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/app/public-price-document.test.js`
Expected: FAIL — `Cannot find module '../../website/app/public-prices/document.js'`

- [ ] **Step 3: Write the document model**

Create `website/app/public-prices/document.js`:

```js
// The editor's document model: every editing operation as a pure function, and a
// validator that mirrors public_price_document_is_valid.
//
// Two copies of the rules is a deliberate trade. The database one is the
// authority and cannot be bypassed; this one exists so an admin sees the problem
// next to the field that caused it instead of a failed publish. When the rules
// change, both change -- the bounds are listed in the spec.
(function (root) {
  'use strict';

  var MAX_ROWS = 200;
  var clone = function (doc) { return JSON.parse(JSON.stringify(doc)); };

  function emptyDocument() {
    return {
      schema: 1,
      currency: 'lei',
      intro_note: '',
      footnote: '',
      groups: [{ title: 'Grup nou', rows: [] }]
    };
  }

  function move(list, index, delta) {
    var target = index + delta;
    if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list;
    var copy = list.slice();
    var held = copy[index];
    copy[index] = copy[target];
    copy[target] = held;
    return copy;
  }

  function addGroup(doc) {
    var next = clone(doc);
    next.groups.push({ title: 'Grup nou', rows: [] });
    return next;
  }

  function removeGroup(doc, gi) {
    var next = clone(doc);
    next.groups.splice(gi, 1);
    return next;
  }

  function moveGroup(doc, gi, delta) {
    var next = clone(doc);
    next.groups = move(next.groups, gi, delta);
    return next;
  }

  function renameGroup(doc, gi, title) {
    var next = clone(doc);
    next.groups[gi].title = String(title);
    return next;
  }

  function addRow(doc, gi) {
    var next = clone(doc);
    next.groups[gi].rows.push({ item: '', amount: 0 });
    return next;
  }

  function removeRow(doc, gi, ri) {
    var next = clone(doc);
    next.groups[gi].rows.splice(ri, 1);
    return next;
  }

  function moveRow(doc, gi, ri, delta) {
    var next = clone(doc);
    next.groups[gi].rows = move(next.groups[gi].rows, ri, delta);
    return next;
  }

  // Amounts arrive from a text input, and a Romanian keyboard types a comma.
  function toAmount(value) {
    if (typeof value === 'number') return value;
    return Number(String(value).trim().replace(',', '.'));
  }

  function updateRow(doc, gi, ri, patch) {
    var next = clone(doc);
    var row = next.groups[gi].rows[ri];

    if ('item' in patch) row.item = String(patch.item);
    if ('amount' in patch) row.amount = toAmount(patch.amount);
    if ('footnote' in patch) {
      if (patch.footnote) row.footnote = true; else delete row.footnote;
    }
    // An empty optional field is absent, not an empty string: the renderer keys
    // off presence, and "" would print a stray dash.
    ['variant', 'currency'].forEach(function (field) {
      if (!(field in patch)) return;
      var text = String(patch[field] === null || patch[field] === undefined ? '' : patch[field]).trim();
      if (text) row[field] = text; else delete row[field];
    });

    return next;
  }

  function setField(doc, field, value) {
    var next = clone(doc);
    next[field] = field === 'currency' ? String(value).trim() : String(value);
    return next;
  }

  function validate(doc) {
    var errors = [];
    var titles = {};
    var rows = 0;
    var add = function (path, message) { errors.push({ path: path, message: message }); };
    var textWithin = function (value, min, max) {
      var length = value === null || value === undefined ? 0 : String(value).length;
      return length >= min && length <= max;
    };

    if (!doc || typeof doc !== 'object') { add('', 'Documentul lipsește.'); return errors; }
    if (doc.schema !== 1) add('schema', 'Versiune de document necunoscută.');
    if (!textWithin(doc.currency, 1, 8)) add('currency', 'Moneda este obligatorie (maximum 8 caractere).');
    if (!textWithin(doc.intro_note || '', 0, 400)) add('intro_note', 'Nota introductivă depășește 400 de caractere.');
    if (!textWithin(doc.footnote || '', 0, 400)) add('footnote', 'Nota de subsol depășește 400 de caractere.');

    if (!Array.isArray(doc.groups) || doc.groups.length === 0) {
      add('groups', 'Lista trebuie să aibă cel puțin un grup.');
      return errors;
    }

    doc.groups.forEach(function (group, gi) {
      if (!textWithin(group.title, 1, 80)) {
        add('groups.' + gi + '.title', 'Titlul grupului este obligatoriu (maximum 80 de caractere).');
      } else if (titles[group.title]) {
        add('groups.' + gi + '.title', 'Două grupuri nu pot avea același titlu.');
      } else {
        titles[group.title] = true;
      }

      if (!Array.isArray(group.rows)) {
        add('groups.' + gi + '.rows', 'Grupul este deteriorat.');
        return;
      }

      group.rows.forEach(function (row, ri) {
        var at = 'groups.' + gi + '.rows.' + ri;
        rows += 1;

        if (!textWithin(row.item, 1, 200)) add(at + '.item', 'Denumirea este obligatorie (maximum 200 de caractere).');
        if ('variant' in row && !textWithin(row.variant, 1, 60)) add(at + '.variant', 'Varianta poate avea maximum 60 de caractere.');
        if ('currency' in row && !textWithin(row.currency, 1, 8)) add(at + '.currency', 'Moneda poate avea maximum 8 caractere.');

        var amount = row.amount;
        if (typeof amount !== 'number' || !isFinite(amount)) {
          add(at + '.amount', 'Prețul trebuie să fie un număr.');
        } else if (amount < 0 || amount > 1000000) {
          add(at + '.amount', 'Prețul trebuie să fie între 0 și 1.000.000.');
        } else if (Math.round(amount * 100) !== amount * 100) {
          add(at + '.amount', 'Prețul poate avea cel mult două zecimale.');
        }
      });
    });

    if (rows > MAX_ROWS) add('groups', 'Lista poate avea cel mult ' + MAX_ROWS + ' de rânduri.');

    return errors;
  }

  var api = {
    emptyDocument: emptyDocument, validate: validate,
    addGroup: addGroup, removeGroup: removeGroup, moveGroup: moveGroup, renameGroup: renameGroup,
    addRow: addRow, removeRow: removeRow, moveRow: moveRow, updateRow: updateRow,
    setField: setField
  };
  root.PriceDocument = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/app/public-price-document.test.js`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add website/app/public-prices/document.js tests/app/public-price-document.test.js
git commit -m "feat(app): document model for the public price editor"
```

---

### Task 9: The admin panel

**Files:**
- Create: `website/app/public-prices/index.html`
- Create: `website/app/public-prices/editor.js`
- Create: `website/app/public-prices/editor.css`
- Create: `tests/acceptance/public-prices.md`
- Note: `website/shared/price-list.js` is served at `public-prices/price-list.js` by the Dockerfile line added in Task 7. For local work, copy it there.

**Interfaces:**
- Consumes: `PriceDocument` (Task 8), `PriceList` (Task 1), the RPCs from Task 4, and the existing `login-with-identifier` edge function and `website/app/supabase-config.js`.
- Produces: the panel. No JS interface.

- [ ] **Step 1: Write the page**

Create `website/app/public-prices/index.html`:

```html
<!doctype html>
<html lang="ro">

<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Prețuri publice — Flowrise Dental</title>
  <link rel="stylesheet" href="editor.css" />
</head>

<body>
  <header class="bar">
    <h1>Prețuri publice</h1>
    <div class="who" id="who" hidden><span id="whoName"></span><button type="button" id="signOut">Ieși</button></div>
  </header>

  <main>
    <section id="signInView">
      <form id="signInForm" class="card" autocomplete="on">
        <h2>Autentificare</h2>
        <label>Nickname sau email<input type="text" id="identifier" name="username" autocomplete="username" required /></label>
        <label>Parolă<input type="password" id="password" name="password" autocomplete="current-password" required /></label>
        <p class="error" id="signInError" hidden></p>
        <button type="submit" id="signInButton">Intră</button>
      </form>
    </section>

    <section id="deniedView" class="card" hidden>
      <h2>Acces restricționat</h2>
      <p>Doar administratorii sau managerii laboratorului pot modifica prețurile publice.</p>
    </section>

    <section id="editorView" hidden>
      <div class="card">
        <h2>Lista publicată</h2>
        <p class="hint">Modificările devin publice abia după ce apeși <strong>Publică</strong>.</p>
        <label>Monedă<input type="text" id="currency" maxlength="8" /></label>
        <label>Notă introductivă<textarea id="introNote" maxlength="400" rows="2"></textarea></label>
        <label>Notă de subsol (marcată cu †)<textarea id="footnote" maxlength="400" rows="2"></textarea></label>
      </div>

      <div id="groups"></div>
      <button type="button" id="addGroup" class="wide">+ Grup nou</button>

      <div class="card">
        <h2>Publicare</h2>
        <ul class="errors" id="errors" hidden></ul>
        <label>Ce s-a schimbat (opțional)<input type="text" id="publishNote" maxlength="200" /></label>
        <div class="actions">
          <button type="button" id="preview">Previzualizează</button>
          <button type="button" id="publish" class="primary">Publică</button>
        </div>
        <p class="status" id="status" hidden></p>
      </div>

      <div class="card" id="previewCard" hidden>
        <h2>Previzualizare</h2>
        <p class="hint">Exact ce vor vedea vizitatorii pe pagina publică.</p>
        <div class="prices"><div id="previewList"></div></div>
      </div>

      <div class="card">
        <h2>Istoric</h2>
        <ul class="history" id="history"></ul>
      </div>
    </section>
  </main>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="../supabase-config.js"></script>
  <script src="price-list.js"></script>
  <script src="document.js"></script>
  <script src="editor.js"></script>
</body>

</html>
```

- [ ] **Step 2: Write the stylesheet**

Create `website/app/public-prices/editor.css`. The `.prices` block at the end is copied from the landing page so the preview looks like the real thing:

```css
:root { color-scheme: light; --line: #d9d4cc; --ink: #2a2724; --muted: #6d6459; --bad: #a3241c; }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: #f6f4f1; }
.bar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 1.25rem; background: #fff; border-bottom: 1px solid var(--line); }
.bar h1 { font-size: 1.1rem; margin: 0; letter-spacing: .02em; }
.who { display: flex; align-items: center; gap: .75rem; color: var(--muted); font-size: .9rem; }
main { max-width: 900px; margin: 0 auto; padding: 1.25rem; display: grid; gap: 1rem; }
.card { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 1rem 1.25rem; display: grid; gap: .75rem; }
.card h2 { font-size: .95rem; margin: 0; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
label { display: grid; gap: .3rem; font-size: .85rem; color: var(--muted); }
input, textarea { font: inherit; color: var(--ink); padding: .5rem .6rem; border: 1px solid var(--line); border-radius: 6px; background: #fff; width: 100%; }
button { font: inherit; padding: .5rem .9rem; border: 1px solid var(--line); border-radius: 6px; background: #fff; cursor: pointer; }
button.primary { background: var(--ink); color: #fff; border-color: var(--ink); }
button.wide { width: 100%; }
button:disabled { opacity: .5; cursor: default; }
.actions { display: flex; gap: .5rem; flex-wrap: wrap; }
.hint { margin: 0; color: var(--muted); font-size: .85rem; }
.error, .errors { color: var(--bad); }
.errors { margin: 0; padding-left: 1.1rem; font-size: .85rem; }
.status { margin: 0; font-size: .85rem; color: var(--muted); }
.group-card { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 1rem 1.25rem; display: grid; gap: .6rem; }
.group-head { display: flex; gap: .5rem; align-items: end; }
.group-head label { flex: 1; }
.row-edit { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 1.4fr) 5.5rem auto auto; gap: .4rem; align-items: center; }
.row-edit .mark { display: flex; align-items: center; gap: .25rem; font-size: .8rem; color: var(--muted); white-space: nowrap; }
.row-edit input[type=checkbox] { width: auto; }
.move { display: flex; gap: .2rem; }
.move button, .row-edit .drop { padding: .35rem .5rem; }
.history { list-style: none; margin: 0; padding: 0; display: grid; gap: .4rem; font-size: .85rem; }
.history li { display: flex; gap: .6rem; align-items: baseline; justify-content: space-between; border-bottom: 1px dashed var(--line); padding-bottom: .4rem; }
.history .when { color: var(--muted); }
.history .live { color: #1d6b3f; font-weight: 600; }
@media (max-width: 640px) { .row-edit { grid-template-columns: 1fr 1fr; } .row-edit .move, .row-edit .drop { grid-column: span 1; } }

/* Copied from website/site/index.html so the preview matches the public page. */
.prices .note-top { color: var(--muted); font-size: .9rem; }
.prices .group { margin-top: 1.25rem; }
.prices .group h3 { font-size: .9rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 0 0 .5rem; }
.prices .list { list-style: none; margin: 0; padding: 0; }
.prices .row { display: flex; align-items: baseline; gap: .5rem; padding: .3rem 0; border-bottom: 1px dotted var(--line); }
.prices .item { flex: 0 1 auto; }
.prices .item .variant { color: var(--muted); font-size: .85em; }
.prices .leader { flex: 1 1 auto; border-bottom: 1px dotted var(--line); }
.prices .price { font-variant-numeric: tabular-nums; white-space: nowrap; }
.prices .price .cur { color: var(--muted); font-size: .8em; margin-left: .2rem; }
.prices sup.ref { color: var(--muted); }
.prices .footnote { color: var(--muted); font-size: .8rem; margin-top: 1rem; }
```

- [ ] **Step 3: Write the editor**

Create `website/app/public-prices/editor.js`:

```js
// The public price editor. Its own login, because the app stores its Supabase
// session in sessionStorage and that does not cross tabs; and its own small
// render loop, because sharing app.js would mean loading 10,000 lines to edit
// thirty-three prices.
(function () {
  'use strict';

  var config = window.FLOWRISE_SUPABASE;
  var client = window.supabase.createClient(config.projectUrl, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, storage: window.sessionStorage }
  });

  var DRAFT_KEY = 'flowrise_public_prices_draft_v1';
  var $ = function (id) { return document.getElementById(id); };

  var state = { doc: null, currentId: null, history: [], dirty: false };

  // ---- view switching ----------------------------------------------------
  function show(view) {
    ['signInView', 'deniedView', 'editorView'].forEach(function (id) { $(id).hidden = id !== view; });
  }

  function status(message, isError) {
    var el = $('status');
    el.textContent = message || '';
    el.hidden = !message;
    el.style.color = isError ? 'var(--bad)' : 'var(--muted)';
  }

  // ---- sign in -----------------------------------------------------------
  $('signInForm').addEventListener('submit', function (event) {
    event.preventDefault();
    var button = $('signInButton');
    var error = $('signInError');
    error.hidden = true;
    button.disabled = true;

    fetch(config.projectUrl + '/functions/v1/' + config.loginFunction, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: config.publishableKey },
      body: JSON.stringify({ identifier: $('identifier').value, password: $('password').value })
    })
      .then(function (response) { return response.json().then(function (body) { return { ok: response.ok, body: body }; }); })
      .then(function (result) {
        if (!result.ok || !result.body || !result.body.email) {
          throw new Error((result.body && result.body.message) || 'Autentificare eșuată.');
        }
        return client.auth.signInWithPassword({ email: result.body.email, password: $('password').value });
      })
      .then(function (result) {
        if (result.error) throw new Error('Nickname/email sau parolă incorectă.');
        return start();
      })
      .catch(function (err) {
        error.textContent = err.message;
        error.hidden = false;
      })
      .then(function () { button.disabled = false; });
  });

  $('signOut').addEventListener('click', function () {
    client.auth.signOut().then(function () { window.location.reload(); });
  });

  // ---- loading -----------------------------------------------------------
  function start() {
    return client.rpc('may_edit_public_prices').then(function (result) {
      if (result.error) throw result.error;
      return client.auth.getUser().then(function (user) {
        $('whoName').textContent = (user.data && user.data.user && user.data.user.email) || '';
        $('who').hidden = false;

        if (!result.data) { show('deniedView'); return null; }
        return loadHistory().then(function () {
          var draft = readDraft();
          if (draft && draft.currentId === state.currentId) {
            state.doc = draft.doc;
            state.dirty = true;
            status('Ai o versiune nepublicată, recuperată din browser.');
          }
          show('editorView');
          render();
        });
      });
    });
  }

  function loadHistory() {
    return client
      .from('public_price_lists')
      .select('id,document,is_current,note,created_at,created_by,profiles:created_by(display_name,username)')
      .order('created_at', { ascending: false })
      .then(function (result) {
        if (result.error) throw result.error;
        state.history = result.data || [];
        var current = state.history.filter(function (row) { return row.is_current; })[0];
        state.currentId = current ? current.id : null;
        if (!state.dirty) state.doc = current ? current.document : window.PriceDocument.emptyDocument();
      });
  }

  // ---- draft persistence -------------------------------------------------
  function readDraft() {
    try {
      var raw = window.localStorage.getItem(DRAFT_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && parsed.doc && parsed.doc.groups ? parsed : null;
    } catch (err) { return null; }
  }

  function writeDraft() {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ doc: state.doc, currentId: state.currentId }));
    } catch (err) { /* a blocked browser just loses the safety net */ }
  }

  function clearDraft() {
    try { window.localStorage.removeItem(DRAFT_KEY); } catch (err) { /* nothing to do */ }
  }

  // ---- editing -----------------------------------------------------------
  function apply(next) {
    state.doc = next;
    state.dirty = true;
    writeDraft();
    render();
  }

  function field(el, handler) {
    // input rather than change: the error list should follow the typing.
    el.addEventListener('input', handler);
  }

  function render() {
    $('currency').value = state.doc.currency || '';
    $('introNote').value = state.doc.intro_note || '';
    $('footnote').value = state.doc.footnote || '';
    renderGroups();
    renderErrors();
    renderHistory();
  }

  function renderGroups() {
    var host = $('groups');
    host.textContent = '';

    state.doc.groups.forEach(function (group, gi) {
      var card = document.createElement('div');
      card.className = 'group-card';

      var head = document.createElement('div');
      head.className = 'group-head';
      head.appendChild(labelled('Titlu grup', textInput(group.title, 80, function (value) {
        apply(window.PriceDocument.renameGroup(state.doc, gi, value));
      })));
      head.appendChild(moveButtons(function (delta) { apply(window.PriceDocument.moveGroup(state.doc, gi, delta)); }));
      head.appendChild(button('Șterge grup', 'drop', function () {
        if (window.confirm('Ștergi grupul "' + group.title + '" și cele ' + group.rows.length + ' rânduri?')) {
          apply(window.PriceDocument.removeGroup(state.doc, gi));
        }
      }));
      card.appendChild(head);

      group.rows.forEach(function (row, ri) { card.appendChild(rowEditor(group, gi, row, ri)); });

      card.appendChild(button('+ Rând', 'wide', function () { apply(window.PriceDocument.addRow(state.doc, gi)); }));
      host.appendChild(card);
    });
  }

  function rowEditor(group, gi, row, ri) {
    var wrap = document.createElement('div');
    wrap.className = 'row-edit';

    wrap.appendChild(textInput(row.item, 200, function (value) {
      apply(window.PriceDocument.updateRow(state.doc, gi, ri, { item: value }));
    }, 'Denumire'));

    wrap.appendChild(textInput(row.variant || '', 60, function (value) {
      apply(window.PriceDocument.updateRow(state.doc, gi, ri, { variant: value }));
    }, 'Material'));

    wrap.appendChild(textInput(String(row.amount), 12, function (value) {
      apply(window.PriceDocument.updateRow(state.doc, gi, ri, { amount: value }));
    }, 'Preț'));

    var mark = document.createElement('span');
    mark.className = 'mark';
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!row.footnote;
    box.addEventListener('change', function () {
      apply(window.PriceDocument.updateRow(state.doc, gi, ri, { footnote: box.checked }));
    });
    mark.appendChild(box);
    mark.appendChild(document.createTextNode('†'));
    wrap.appendChild(mark);

    var tail = document.createElement('span');
    tail.className = 'move';
    tail.appendChild(moveButtons(function (delta) { apply(window.PriceDocument.moveRow(state.doc, gi, ri, delta)); }));
    tail.appendChild(button('×', 'drop', function () { apply(window.PriceDocument.removeRow(state.doc, gi, ri)); }));
    wrap.appendChild(tail);

    return wrap;
  }

  function textInput(value, maxLength, onInput, placeholder) {
    var input = document.createElement('input');
    input.type = 'text';
    input.value = value === null || value === undefined ? '' : String(value);
    input.maxLength = maxLength;
    if (placeholder) input.placeholder = placeholder;
    // No re-render on every keystroke: rebuilding the card would steal focus.
    input.addEventListener('change', function () { onInput(input.value); });
    return input;
  }

  function labelled(text, control) {
    var label = document.createElement('label');
    label.appendChild(document.createTextNode(text));
    label.appendChild(control);
    return label;
  }

  function button(text, className, onClick) {
    var element = document.createElement('button');
    element.type = 'button';
    if (className) element.className = className;
    element.textContent = text;
    element.addEventListener('click', onClick);
    return element;
  }

  function moveButtons(onMove) {
    var wrap = document.createElement('span');
    wrap.className = 'move';
    wrap.appendChild(button('↑', null, function () { onMove(-1); }));
    wrap.appendChild(button('↓', null, function () { onMove(1); }));
    return wrap;
  }

  field($('currency'), function () { apply(window.PriceDocument.setField(state.doc, 'currency', $('currency').value)); });
  field($('introNote'), function () { apply(window.PriceDocument.setField(state.doc, 'intro_note', $('introNote').value)); });
  field($('footnote'), function () { apply(window.PriceDocument.setField(state.doc, 'footnote', $('footnote').value)); });
  $('addGroup').addEventListener('click', function () { apply(window.PriceDocument.addGroup(state.doc)); });

  // ---- validation, preview, publish -------------------------------------
  function renderErrors() {
    var errors = window.PriceDocument.validate(state.doc);
    var list = $('errors');
    list.textContent = '';
    errors.forEach(function (error) {
      var li = document.createElement('li');
      li.textContent = error.path ? error.path + ': ' + error.message : error.message;
      list.appendChild(li);
    });
    list.hidden = errors.length === 0;
    $('publish').disabled = errors.length > 0;
    return errors;
  }

  $('preview').addEventListener('click', function () {
    window.PriceList.mount(window.PriceList.priceListTree(state.doc), $('previewList'));
    $('previewCard').hidden = false;
    $('previewCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('publish').addEventListener('click', function () {
    if (renderErrors().length) return;
    $('publish').disabled = true;
    status('Se publică…');

    client
      .rpc('publish_public_price_list', {
        p_document: state.doc,
        p_note: $('publishNote').value,
        p_expected_current: state.currentId
      })
      .then(function (result) {
        if (result.error) throw result.error;
        state.dirty = false;
        clearDraft();
        $('publishNote').value = '';
        return loadHistory().then(function () {
          render();
          status('Publicat. Pagina publică arată noile prețuri.');
        });
      })
      .catch(function (err) {
        status(err.message || 'Publicarea a eșuat.', true);
        $('publish').disabled = false;
      });
  });

  function renderHistory() {
    var host = $('history');
    host.textContent = '';

    state.history.forEach(function (row) {
      var li = document.createElement('li');
      var left = document.createElement('span');
      var who = row.profiles && (row.profiles.display_name || row.profiles.username);
      var when = new Date(row.created_at).toLocaleString('ro-RO');
      left.appendChild(document.createTextNode(when + (who ? ' · ' + who : '') + (row.note ? ' · ' + row.note : '')));
      left.className = 'when';
      li.appendChild(left);

      if (row.is_current) {
        var live = document.createElement('span');
        live.className = 'live';
        live.textContent = 'publicat';
        li.appendChild(live);
      } else {
        li.appendChild(button('Restaurează', null, function () {
          if (!window.confirm('Faci publică versiunea din ' + when + '?')) return;
          client.rpc('set_current_public_price_list', { p_version_id: row.id })
            .then(function (result) {
              if (result.error) throw result.error;
              state.dirty = false;
              clearDraft();
              return loadHistory().then(function () { render(); status('Versiunea a fost restaurată.'); });
            })
            .catch(function (err) { status(err.message || 'Restaurarea a eșuat.', true); });
        }));
      }

      host.appendChild(li);
    });
  }

  // A reload with a live session should land in the editor, not the login form.
  client.auth.getSession().then(function (result) {
    if (result.data && result.data.session) start().catch(function () { show('signInView'); });
    else show('signInView');
  });
})();
```

- [ ] **Step 4: Copy the shared renderer for local work and serve the app**

```bash
cp website/shared/price-list.js website/app/public-prices/price-list.js
cd website/app && python -m http.server 8081
```

`website/app/public-prices/price-list.js` is a build artifact — the Dockerfile copies it in Task 7's step 7. Do not commit it. Confirm it is ignored or delete it before committing.

- [ ] **Step 5: Verify the panel by hand**

Open `http://localhost:8081/public-prices/`. Work through these, which are the same steps the acceptance document records:

1. Sign in with a lab **manager** account. The editor appears, filled with the 5 groups and 33 rows from the seed.
2. Sign out, sign in with a **technician** account: "Acces restricționat" appears and no editor.
3. Change one price, press **Previzualizează**: the preview shows the new figure and looks like the public page.
4. Clear a group title: an error appears and **Publică** is disabled. Restore it; the error clears.
5. Press **Publică**, then reload `www.flowrisedental.ro` (or the local copy pointed at the same database): the new price is live.
6. Reload the panel mid-edit without publishing: the draft comes back with "Ai o versiune nepublicată".
7. In the history, press **Restaurează** on the previous version: the public page returns to the old price.
8. Open the panel in two tabs, publish from the first, then publish from the second: the second must refuse with "Lista a fost modificată de altcineva."

- [ ] **Step 6: Write the acceptance document**

Create `tests/acceptance/public-prices.md`:

```markdown
# Public price list — acceptance

Run against a database seeded by `db/migrations/20260925_public_price_list_seed.sql`,
with the panel at https://app.flowrisedental.ro/public-prices/ and the landing page
at https://www.flowrisedental.ro/.

Accounts needed: one lab `admin` or `manager`, and one technician.

| # | Step | Expected |
|---|---|---|
| 1 | Sign in as manager | The editor opens with 5 groups and 33 rows |
| 2 | Sign in as technician | "Acces restricționat", no editor |
| 3 | Open the panel signed out | The login form, no price data in the page source |
| 4 | Change a price, press Previzualizează | The preview shows the new figure, styled like the public page |
| 5 | Clear a group title | An error is listed and Publică is disabled |
| 6 | Enter `12,50` as a price and preview | It renders as `12,5` |
| 7 | Publish | The landing page shows the new price after a reload |
| 8 | Reload the panel with unpublished edits | "Ai o versiune nepublicată" and the edits are intact |
| 9 | Restore the previous version from the history | The landing page returns to the previous price |
| 10 | Publish from two tabs, second tab last | The second refuses: "Lista a fost modificată de altcineva." |
| 11 | Load the landing page with JavaScript disabled | The page renders with no price section — accepted, per the spec |
| 12 | Load the landing page offline after one successful visit | Prices still render, from the browser cache |
| 13 | Load the landing page offline on a fresh profile | "Lista de prețuri se încarcă — dacă nu apare, sună la 0766 494 063." |
| 14 | Mark a row's † box and publish | The marker appears on the public page and the footnote paragraph is present |
```

- [ ] **Step 7: Run the whole suite**

```bash
rm -f website/app/public-prices/price-list.js
node --test tests/
node tools/build-db-apply.js --check
```

Expected: all tests pass; `--check` exits 0.

- [ ] **Step 8: Commit**

```bash
git add website/app/public-prices/index.html website/app/public-prices/editor.js website/app/public-prices/editor.css tests/acceptance/public-prices.md
git commit -m "feat(app): admin panel for the public price list"
```

---

## Self-review notes

Recorded so the executor knows these were considered, not missed.

**Spec coverage.** Document shape → Task 1. Storage → Task 2. Authorization → Tasks 2 and 4. Publishing and history → Tasks 4 and 9. Validation → Tasks 3 and 8. Public read path → Task 6. Rendering → Tasks 1 and 7. Failure behavior → Tasks 6 and 7. Admin panel → Tasks 8 and 9. Seeding and visual parity → Tasks 1 and 5. Testing → every task. Deployment → Task 7, step 8.

**Two rule sets, deliberately.** `public_price_document_is_valid` (Task 3) and `PriceDocument.validate` (Task 8) encode the same bounds in different languages. The database one is the authority; the browser one exists so errors appear next to the field. Both cite the spec's Validation section, and a change to the bounds changes both.

**Where the panel's coverage is thin.** Task 9 has no automated tests: it is DOM wiring over two modules that are themselves well covered, and the repo has no browser test harness (no `package.json`, no jsdom). Its verification is the manual pass in step 5 and `tests/acceptance/public-prices.md`. If that trade is not acceptable, the alternative is a `tests/app/public-prices-browser.mjs` fixture generator in the style of the existing `tooth-connections-browser.mjs`, which builds a disposable HTML page for hand-checking — worth adding only if the panel grows.

**Concurrency, honestly.** The stale-publish refusal is asserted against the function definition in Task 4 and exercised by hand in Task 9, step 5.8. A true two-session SQL test needs two connections, which the `begin; … rollback;` harness cannot express.
