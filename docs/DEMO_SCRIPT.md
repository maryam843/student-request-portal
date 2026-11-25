# Demo video script (about 2 minutes 30 seconds)

The video has two parts: the core request flow (about 90 seconds) and the account features (about 60 seconds).

Before recording:
- Run `npm run demo` in a terminal window you can switch to during the video. Part 2 copies two links from it.
- Open http://localhost:8000 in a fresh Chrome window next to it.
- The password for every demo account is `Demo@1234`.

Every page after login has the same left menu. Student: **Dashboard**, **New Request**, **My Requests**, **Logout**. Head of Department: **Dashboard**, **Review Requests**, **Logout**. The page that is open is highlighted.

## Part 1: request flow (about 90 seconds)

| Time | Screen | What to click / type | What to say (short) |
|---|---|---|---|
| 0:00 | Login | Type `sara@example.com` and `Demo@1234`, click **Login** | "I log in as a student." |
| 0:06 | Student dashboard | Point at the cards (My requests, Pending) and the line "You have 1 new update on your requests." | "The dashboard shows my own requests." |
| 0:11 | Student dashboard | Click **New Request** in the left menu | |
| 0:14 | New Request | First drop-down: pick any option, Category **Registration**, Description `Please add me to the evening section of Web Technologies 2.` Click **Submit Request** | "I send a request to my Head of Department." |
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

## Part 2: account features (about 60 seconds)

No real emails are sent. The app prints each link in the terminal as one line, for example:

```
Email to ali@example.com
Verification link: http://localhost:8000/verify-email?token=...
```

To copy a link, select it from `http` to the end of the line and copy it (Ctrl+C, or Ctrl+Shift+C in some terminals), then paste it into the Chrome address bar and press Enter.

| Time | Screen | What to click / type | What to say (short) |
|---|---|---|---|
| 1:30 | Request Details | Click **Logout** in the left menu | |
| 1:32 | Login | Click **Register** | "A new student can create an account." |
| 1:34 | Register | Name `Ali Demo`, Email `ali@example.com`, College **Computing and IT**, Password `Demo@1234`, Repeat password `Demo@1234` (the profile picture is optional, leave it empty). Click **Create Account** | |
| 1:44 | Login | Point at "Account created. Open the verification link (printed in the server console), then log in." | "The account must be verified first." |
| 1:47 | Terminal | Switch to the terminal and copy the line **Verification link: ...**. Switch back to Chrome, paste the link in the address bar and press Enter | "In this demo the email is printed in the terminal." |
| 1:54 | Login | Point at "Email verified. You can now log in." Type `ali@example.com` and `Demo@1234`, click **Login** | |
| 1:59 | Student dashboard | Point at "Welcome, Ali Demo", the cards with 0 requests and the grey default avatar at the top right | "A new account starts empty, with a default profile picture." |
| 2:05 | Student dashboard | Click **Logout** in the left menu | |
| 2:07 | Login | Click **Forgot your password?** | "If a student forgets the password..." |
| 2:09 | Forgot Password | Type `ali@example.com`, click **Send Reset Link**. Point at "If this email is registered, a reset link has been sent." | |
| 2:13 | Terminal | Switch to the terminal and copy the line **Reset link: ...**. Paste it in the Chrome address bar and press Enter | "...a reset link is sent." |
| 2:19 | Reset Password | New password `Demo@5678`, Repeat new password `Demo@5678`, click **Reset Password** | |
| 2:24 | Login | Point at "Password updated. Log in with your new password." Type `ali@example.com` and `Demo@5678`, click **Login** | "The new password works." |
| 2:28 | Student dashboard | Point at "Welcome, Ali Demo" | |
| 2:30 | | End | |

## Captions (for a video without sound)

1. A student sends a request to the Head of Department.
2. The app estimates when the request will be handled.
3. The Head of Department sees every request, newest first.
4. The Head of Department approves the request with a note.
5. The student gets a badge and reads the note.
6. A new student registers and verifies the email.
7. New accounts start empty, with a default profile picture.
8. A forgotten password is reset with a one-time link.

## Notes
- "2 new updates": the demo data already has one approved request Sara has not opened, plus the one approved in this video. After opening the new one the bell shows 1.
- Detail pages have a "Back to ..." link at the top; the browser Back button also works.
- The app name at the top always goes to the dashboard. On a small screen the left menu is behind the menu button at the top left.
- For another take, stop the demo with Ctrl+C and run `npm run demo` again. This resets the data, so `ali@example.com` can be registered again and Sara's badge starts at 1.
- Wrong passwords are limited to 10 tries per 15 minutes, and registering or asking for a reset link to 10 per 15 minutes; restarting the demo resets that too.
