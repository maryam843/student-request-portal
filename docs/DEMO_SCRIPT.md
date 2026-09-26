# Demo video script (about 90 seconds)

Before recording: run `npm run demo` and open http://localhost:8000 in a fresh browser window.
The password for every demo account is `Demo@1234`.

| Time | Screen | What to click / type | What to say (short) |
|---|---|---|---|
| 0:00 | Login | Type `sara@example.com` and `Demo@1234`, click **Login** | "I log in as a student." |
| 0:08 | Student dashboard | Point at the cards (my requests, pending) and the "1 new update" line | "The dashboard shows my own requests." |
| 0:13 | Student dashboard | Click **New Request** in the left menu | |
| 0:16 | New request form | Semester **Winter 2025**, Category **Registration**, Description `Please add me to the evening section of Web Technologies 2.` Click **Submit Request** | "I send a request to my Head of Department." |
| 0:28 | My Requests | Point at the new row (last row): status **Pending** and the **Estimated Resolution By** date | "The app estimates when it will be handled: 15 minutes for each request waiting in the same category, only in working hours, Sunday to Thursday." |
| 0:38 | My Requests | Click **Back to HomePage**, then the round avatar at the top right, then **Logout** | |
| 0:43 | Login | Type `hod@example.com` and `Demo@1234`, click **Login** | "Now I log in as the Head of Department." |
| 0:48 | HoD dashboard | Point at the Pending / Approved / Rejected cards | "These numbers come from the database." |
| 0:53 | HoD dashboard | Click **Review requests** | |
| 0:56 | Student requests | Scroll to the bottom of the Student Request List; on Sara Demo's new **Registration / Pending** row click **View** | "Here are all requests, with queues per category." |
| 1:02 | Request details | Change Status: **Approved**. Note: `Added to the evening section.` Click **Process Request** | "I approve it with a note." |
| 1:12 | Student requests | The row now says **Approved**. Click **Back to Dashboard** at the top, then **Logout** in the left menu | |
| 1:17 | Login | Type `sara@example.com` and `Demo@1234`, click **Login** | "Back as the student." |
| 1:21 | Student dashboard | Point at "You have 2 new updates" and the red number on the bell. Click **Click here!** | "I get a badge when my request is decided." |
| 1:25 | My Requests | On the Registration row with the **New update** label and status **Approved**, click **View** | |
| 1:28 | Request details | Point at **Status: Approved** and **Note from HoD** | "I can read the Head of Department's note. Opening it marks it as seen, so the badge goes down by one." |
| 1:30 | | End | |

Notes
- "2 new updates": the demo data already has one approved request Sara has not opened, plus the one approved in this video. After opening the new one the dashboard shows "1 new update".
- If you record several takes, stop the demo with Ctrl+C and run `npm run demo` again to start with fresh data.
- Wrong passwords are limited to 10 tries per 15 minutes; restarting the demo resets that too.
