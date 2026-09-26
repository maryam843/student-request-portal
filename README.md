# Student Request Portal

This is a web app I built for INFS 3201 (Web Technologies 2) at UDST in 2025. Students send requests (course advice, attendance, registration or major change) to their Head of Department, who reviews them in queues and approves or rejects them. In 2026 I went back to it to fix security problems and clean up the code.

## Demo

<!-- demo video goes here -->

The steps I follow in the video are in [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

| Student dashboard | Head of Department dashboard |
|---|---|
| ![Student dashboard](docs/screenshots/student-dashboard.png) | ![Head of Department dashboard](docs/screenshots/hod-dashboard.png) |

## Features

Student:
- Register, verify the email and log in (the verification link is printed in the server console)
- Submit a request. It gets an estimated completion time: 15 minutes for every request already waiting in the same category, counted only from 9am to 5pm, Sunday to Thursday
- See my requests, open one to read the Head of Department's note, and cancel requests that are still pending
- A badge shows decisions I have not opened yet
- Profile page where I can change my picture (users without one get a grey default avatar)
- Forgot / reset password (the reset link is printed in the server console)

Head of Department:
- Dashboard with the number of pending, approved and rejected requests
- List of all requests, newest first, with filters by category, semester and status
- A queue for each category, and a button that picks a random pending request
- Approve or reject a request with a note

Both roles:
- The same left menu on every page after login, with the open page highlighted; on a phone it opens from the menu button
- Detail pages have a "Back to ..." link, and a short message confirms each action (for example "Request submitted.")

## Tech stack

Node.js, Express, MongoDB, Handlebars and the CoreUI 4 admin template (Bootstrap 5). I also use express-session for logins, bcrypt for passwords, Multer for uploads and express-rate-limit. The code is in three files: `app.js` (routes), `business.js` (logic) and `persistence.js` (database).

## How to run

You only need Node.js 18 or newer.

```bash
npm install
npm run demo
```

Then open http://localhost:8000. `npm run demo` starts a temporary MongoDB in memory, adds demo data and starts the app, so you do not need to install MongoDB or create a `.env` file. The first time, it downloads MongoDB, so it needs an internet connection and can take a minute. Press Ctrl+C to stop it; the demo data is deleted.

Demo logins (made-up accounts; the password for all of them is `Demo@1234`):

| Role | Email |
|---|---|
| Head of Department | hod@example.com |
| Student | sara@example.com |
| Student | omar@example.com |
| Student | lina@example.com |

The normal way, with your own MongoDB:

```bash
npm install
cp .env.example .env    # Windows: copy .env.example .env; then fill in MONGODB_URI and SESSION_SECRET
npm run seed            # adds the demo data (deletes the users and requests in that database)
npm start
```

## What I fixed in 2026

- Moved the database password out of the code into a `.env` file and removed it from the git history
- The server now only shares the `public/` folder, not the whole project
- Real login sessions and a role check on every page, instead of the email in the URL
- New accounts are always students
- Passwords are hashed with bcrypt instead of SHA-256
- Uploads: only images, up to 2 MB
- Form and URL values must be plain text, and a bad link shows an error page instead of crashing the server
- Login, register and forgot password are limited to 10 tries per 15 minutes
- A unique index on the user email in MongoDB
- Fixed the password reset, the login messages, broken HTML and the made-up numbers on the Head of Department dashboard
- Removed personal fields I did not need (date of birth, ID, nationality, address, phone)
- Removed the unused template pages, demo content and code

## Limitations

- No real emails are sent; the links are printed in the server console
- No automated tests; I tested it by hand
- No CSRF tokens (the login cookie uses `SameSite=Lax`)
- Times use the server's local time

## Credits

Built for INFS 3201 (Web Technologies 2) at UDST (Winter 2025) on the CoreUI 4 admin template (MIT). Security fixes and bug fixes added in 2026.

My code is under the MIT License (see [LICENSE](LICENSE)); the CoreUI files keep their own MIT license.
