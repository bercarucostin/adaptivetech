# Material and calendar AI acceptance

Run with separate Admin, Technician A, and Technician B accounts in a
non-production laboratory.

1. As Technician A, ask for current stock, add 5 to one material, subtract 2,
   and set an absolute quantity after reading it. Verify the results are atomic,
   a repeated request key changes stock once, a stale expected quantity fails,
   and stock cannot become negative.
2. As Technician A, create one personal and one shared event. Verify both are
   visible to A and only the shared event is visible to Technician B.
3. As Technician B, update the title/date/description of A's shared event.
   Verify the owner and scope do not change. Verify B cannot read, update, or
   delete A's personal event, and cannot delete A's shared event.
4. As Technician A, move A's own event between personal and shared calendars.
   Verify the UI selector and AI mutation produce the same result.
5. Create or delete an event through AI and retry the same HTTP request. Verify
   only one event is created or deleted. Calendar delete must require an
   unexpired preview.
6. As Admin, edit and delete shared events and adjust stock. As Doctor or
   Dashboard, verify both datasets and mutation RPCs are denied.

Check dates around midnight in Romania and confirm relative dates use
`Europe/Bucharest`.
