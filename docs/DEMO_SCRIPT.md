# Demo video script (about 90 seconds)

Before recording: run `npm run demo` and open http://localhost:8000 in a fresh browser window.
The password for every demo account is `Demo@1234`.

Every page after login has the same left menu. Student: **Dashboard**, **New Request**, **My Requests**, **Logout**. Head of Department: **Dashboard**, **Review Requests**, **Logout**. The page that is open is highlighted.

| Time | Screen | What to click / type | What to say (short) |
|---|---|---|---|
| 0:00 | Login | Type `sara@example.com` and `Demo@1234`, click **Login** | "I log in as a student." |
| 0:06 | Student dashboard | Point at the cards (My requests, Pending) and the line "You have 1 new update on your requests." | "The dashboard shows my own requests." |
| 0:11 | Student dashboard | Click **New Request** in the left menu | |
| 0:14 | New Request | Semester **Winter 2025**, Category **Registration**, Description `Please add me to the evening section of Web Technologies 2.` Click **Submit Request** | "I send a request to my Head of Department." |
| 0:26 | My Requests | Point at the message "Request submitted." and the first row: status **Pending** and the **Estimated completion** date | "The app estimates when it will be handled: 15 minutes for each request waiting in the same category, only in working hours, Sunday to Thursday." |
| 0:36 | My Requests | Click **Logout** in the left menu | |
| 0:40 | Login | Type `hod@example.com` and `Demo@1234`, click **Login** | "Now I log in as the Head of Department." |
| 0:45 | HoD dashboard | Point at the Pending / Approved / Rejected cards | "These numbers come from the database." |
| 0:50 | HoD dashboard | Click **Review Requests** in the left menu | |
| 0:53 | Review Requests | Point at the queue cards, then at the first row of Student Requests: Sara Demo, **Registration**, the new description, **Pending**. Click **View** on that row | "Here are all requests, newest first, with a queue for each category." |
| 0:58 | Request Details | Decision: **Approved**. Note: `Added to the evening section.` Click **Process Request** | "I approve it with a note." |
| 1:08 | Review Requests | Point at the message "Request approved." and the first row, which now says **Approved**. Click **Logout** in the left menu | |
| 1:14 | Login | Type `sara@example.com` and `Demo@1234`, click **Login** | "Back as the student." |
| 1:18 | Student dashboard | Point at "You have 2 new updates on your requests." and the red 2 on the bell. Click **View updates** | "I get a badge when my request is decided." |
| 1:23 | My Requests | On the first row (Registration, **Approved**, **New update**), click **View** | |
| 1:26 | Request Details | Point at **Status: Approved** and **Note from HoD** | "I can read the Head of Department's note. Opening it marks it as seen, so the badge goes down by one." |
| 1:30 | | End | |

Notes
- "2 new updates": the demo data already has one approved request Sara has not opened, plus the one approved in this video. After opening the new one the bell shows 1.
- Detail pages have a "Back to ..." link at the top; the browser Back button also works.
- The app name at the top always goes to the dashboard. On a small screen the left menu is behind the menu button at the top left.
- If you record several takes, stop the demo with Ctrl+C and run `npm run demo` again to start with fresh data.
- Wrong passwords are limited to 10 tries per 15 minutes; restarting the demo resets that too.
