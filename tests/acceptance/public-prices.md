# Public price list — acceptance

Run against a database seeded by `db/migrations/20260925_public_price_list_seed.sql`,
with the panel at https://app.flowrisedental.ro/public-prices/ and the landing page
at https://www.flowrisedental.ro/.

Accounts needed: one lab `admin` or `manager`, and one technician.

Step 1 has no fallback: the panel's own login is the only door into the editor,
with no alternate path if it fails. Confirm step 1 works before attempting any
other step in this document.

| # | Step | Expected |
|---|---|---|
| 1 | Sign in as manager | The editor opens with 5 groups and 33 rows. Confirm this succeeds before attempting any other step below — the login path has no fallback. |
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
