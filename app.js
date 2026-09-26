require('dotenv').config();
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const MongoStore = require('connect-mongo');
const business = require('./business');
const path = require('path');
const multer = require('multer');
const app = express();
const hbs = require("hbs");
const persistence = require("./persistence");
const crypto = require('crypto');


// View Engine Setup
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// Middleware Setup
// "simple" parsing: ?email[$ne]=x stays a plain text key and does not become a MongoDB operator
app.set('query parser', 'simple');
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// Browsers ask for /favicon.ico by default; the app's icon is an SVG
app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));

if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is not set. Copy .env.example to .env and fill it in.");
}

// Login sessions: the browser only gets a random session id in a cookie,
// the session data (who is logged in) is stored in MongoDB.
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        dbName: persistence.dbName,
        collectionName: 'sessions'
    }),
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 2
    }
}));

/**
 * Return the value only if it is plain text (not an array or object), otherwise ""
 */
function text(value) {
    return typeof value === 'string' ? value : "";
}

/**
 * The dashboard address for a logged-in user's account type
 */
function dashboardFor(user) {
    return user.accountType === "department_head" ? "/admin-dashboard" : "/student-dashboard";
}

/**
 * Pages for logged-in users must not be kept in the browser cache, otherwise the
 * Back button shows them again after logout (and can show an old list)
 */
function noCache(res) {
    res.set('Cache-Control', 'no-store');
}

// The choices in the request form and in the HoD filters
const CATEGORIES = ["Course Advice", "Attendance", "Registration", "Major Change"];
const SEMESTERS = ["Fall 2023", "Fall 2024", "Fall 2025", "Spring 2023", "Spring 2024", "Spring 2025", "Winter 2023", "Winter 2024", "Winter 2025"];
const STATUSES = ["Pending", "Approved", "Rejected", "Cancelled"];

// Left menu for each account type; "key" marks the menu item of the page that is open
const MENUS = {
    student: [
        { key: "dashboard", label: "Dashboard", href: "/student-dashboard", icon: "cil-speedometer" },
        { key: "new-request", label: "New Request", href: "/student-request", icon: "cil-pencil" },
        { key: "my-requests", label: "My Requests", href: "/student-requests", icon: "cil-list-rich" }
    ],
    department_head: [
        { key: "dashboard", label: "Dashboard", href: "/admin-dashboard", icon: "cil-speedometer" },
        { key: "review", label: "Review Requests", href: "/hod-requests", icon: "cil-task" }
    ]
};

/**
 * Keep a short message to show once on the next page (e.g. "Request submitted.")
 */
function flash(req, type, message) {
    req.session.flash = { type, text: message };
}

/**
 * Render a page for the logged-in user inside the shared layout (left menu, top bar with
 * avatar, back link and the message saved with flash())
 */
async function renderPage(req, res, view, data) {
    const sessionUser = req.session.user;
    const currentUser = (await business.getUserByEmail(sessionUser.email)) || sessionUser;
    const isStudent = sessionUser.accountType === "student";
    const badgeCount = isStudent ? await persistence.countUnreadDecisions(sessionUser.email) : 0;
    const message = req.session.flash;
    delete req.session.flash;

    res.render(view, {
        layout: "layouts/app",
        currentUser,
        isStudent,
        badgeCount,
        dashboard: dashboardFor(sessionUser),
        menu: (MENUS[sessionUser.accountType] || []).map(item => ({ ...item, active: item.key === data.active })),
        flash: message,
        ...data
    });
}

/**
 * Show the error page: inside the shared layout for a logged-in user, on its own otherwise
 */
async function showError(req, res, status, message) {
    res.status(status);
    if (req.session && req.session.user) {
        return renderPage(req, res, "error", { title: "Error", message });
    }
    res.render("error", { layout: "layouts/plain", title: "Error", message });
}

/**
 * Only let logged-in users through; everybody else goes to the login page
 */
function requireLogin(req, res, next) {
    noCache(res);
    if (!req.session.user) {
        return res.redirect("/login?error=Please log in first.");
    }
    next();
}

/**
 * Only let logged-in users with the given account type through
 */
function requireRole(accountType) {
    return function (req, res, next) {
        noCache(res);
        if (!req.session.user) {
            return res.redirect("/login?error=Please log in first.");
        }
        if (req.session.user.accountType !== accountType) {
            return showError(req, res, 403, "You are not allowed to open this page.");
        }
        next();
    };
}

const port = process.env.PORT || 8000;

/**
 * Allow at most 10 tries per 15 minutes from the same IP address, then show a friendly message
 * on the same page. Used on login, register and forgot password to slow down password guessing
 * and spam. For login only failed attempts count.
 */
function limitTries(view, onlyCountFailures = false) {
    return rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 10,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        skipSuccessfulRequests: onlyCountFailures,
        requestWasSuccessful: (req, res) => !res.locals.failedAttempt,
        handler: (req, res) => {
            res.status(429).render(view, { error: "Too many tries. Please wait 15 minutes and try again." });
        }
    });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
    /**
     * Set upload destination for Multer
     */
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, 'uploads'));
    },
    /**
     * Rename uploaded file to a timestamp + random name (the original name is not used)
     */
    filename: function (req, file, cb) {
        const extension = ALLOWED_IMAGES[file.mimetype];
        cb(null, Date.now() + '-' + crypto.randomBytes(8).toString('hex') + extension);
    }
});

// Only these image types are accepted (no SVG/HTML, which could contain scripts)
const ALLOWED_IMAGES = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp'
};

const upload = multer({
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
    fileFilter: function (req, file, cb) {
        const extension = path.extname(file.originalname).toLowerCase();
        const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        if (ALLOWED_IMAGES[file.mimetype] && allowedExtensions.includes(extension)) {
            cb(null, true);
        } else {
            cb(new Error("Only JPG, PNG, GIF or WEBP images are allowed."));
        }
    }
});

/**
 * Run the upload and keep the error message (too big, wrong type) instead of crashing
 */
function uploadProfilePic(req, res, next) {
    upload.single('profilePic')(req, res, (err) => {
        if (err) {
            req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? "The picture must be 2 MB or smaller." : err.message;
        }
        next();
    });
}

// Handlebars Helpers
hbs.registerHelper('eq', function (a, b) {
    return a === b;
});

// Picture shown for users without a profile photo (and when a photo file is missing)
const DEFAULT_AVATAR = '/img/avatar-default.svg';

/**
 * Profile picture address: the uploaded photo, or the default avatar
 */
hbs.registerHelper('avatarSrc', function (profilePic) {
    return profilePic ? '/uploads/' + profilePic : DEFAULT_AVATAR;
});

/**
 * An <img> with the profile picture that switches to the default avatar if the photo cannot be loaded
 */
hbs.registerHelper('avatar', function (profilePic, cssClass, size) {
    const src = profilePic ? '/uploads/' + profilePic : DEFAULT_AVATAR;
    const sizeAttrs = typeof size === 'number' ? ` width="${size}" height="${size}"` : '';
    return new hbs.SafeString(
        `<img class="${hbs.Utils.escapeExpression(typeof cssClass === 'string' ? cssClass : '')}" src="${hbs.Utils.escapeExpression(src)}"${sizeAttrs} alt="Profile picture" onerror="this.onerror=null;this.src='${DEFAULT_AVATAR}'">`
    );
});

// CoreUI badge colour for each request status
const STATUS_CLASSES = { Pending: "bg-warning text-dark", Approved: "bg-success", Rejected: "bg-danger", Cancelled: "bg-secondary" };

hbs.registerHelper('statusClass', function (status) {
    return STATUS_CLASSES[status] || "bg-secondary";
});

hbs.registerHelper('formatDate', function(date) {
    const options = { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    return new Date(date).toLocaleString('en-US', options);
});

/**
 * Log email details to console (e.g., verification or reset links)
 */
function logEmailDetails(to, verificationLink) {
    console.log("---------------------------------");
    console.log("Email Sent:");
    console.log(`To: ${to}`);
    console.log(`Verification Link:\n${verificationLink}`);
    console.log("---------------------------------\n");
}


/**
 * Show the profile page of the logged-in user
 */
app.get('/profile', requireLogin, async (req, res) => {
    await renderPage(req, res, 'profile', { title: "My Profile" });
});

/**
 * Handle profile picture upload request (changes the picture of the logged-in user)
 */
app.post('/upload-profile', requireLogin, uploadProfilePic, async (req, res) => {
    if (req.uploadError) {
        flash(req, "danger", req.uploadError);
    } else if (!req.file) {
        flash(req, "danger", "Please choose a picture first.");
    } else {
        await persistence.updateProfilePic(req.session.user.email, req.file.filename);
        flash(req, "success", "Profile picture updated.");
    }
    res.redirect("/profile");
});


/**
 * Handle user registration
 */
app.post('/register', limitTries('register'), uploadProfilePic, async (req, res) => {
    const [name, email, password, confirmPassword, college] =
        ['name', 'email', 'password', 'confirmPassword', 'college'].map(field => text(req.body[field]));
    const profilePic = req.file ? req.file.filename : null;

    // show the form again with the error; the typed name, email and college are kept
    const showForm = (error) => res.status(400).render('register', { error, form: { name, email, college } });

    try {
        if (req.uploadError) {
            return showForm(req.uploadError);
        }

        if (!email || !password || !name) {
            return showForm("Please fill in your name, email and password.");
        }

        if (password !== confirmPassword) {
            return showForm("The passwords do not match.");
        }

        const existingUser = await business.getUserByEmail(email);
        if (existingUser) {
            return showForm("This email is already registered.");
        }

        const userData = await business.registerUser(name, email, password, confirmPassword, college, profilePic);

        if (!userData) {
            return showForm("Registration failed. Check the email address and try again.");
        }

        logEmailDetails(userData.email, userData.verificationLink);

        return res.redirect("/login?msg=Account created. Open the verification link (printed in the server console), then log in.");
    } catch (error) {
        console.error("Error during registration:", error);
        return showForm("Something went wrong. Please try again.");
    }
});


/**
 * Handle email verification request
 */
app.get("/verify-email", async (req, res) => {
    const token = text(req.query.token);
    if (!token) {
        return res.redirect("/register?error=Error while verifying your email, please try again.");
    }
    const success = await business.verifyUser(token);
    if (success) {
        res.redirect("/login?msg=Email verified! Please login to continue.");
    } else {
        res.redirect("/register?error=Error while verifying your email, please try again.");
    }
});

/**
 * Render forgot password form
 */
app.get('/forgot-password', (req, res) => {
    res.render('forgot-password');
});

/**
 * Handle forgot password logic and generate reset token
 */
app.post('/forgot-password', limitTries('forgot-password'), async (req, res) => {
    const email = text(req.body.email).toLowerCase();
    // Same message whether the email exists or not, so nobody can test which emails are registered
    const message = "If this email is registered, a reset link has been sent. (Demo: the link is printed in the server console.)";
    try {
        const user = await business.getUserByEmail(email);
        if (user) {
            const token = await business.generateResetToken(email);
            const resetLink = `http://localhost:${port}/reset-password?token=${token}`;
            console.log(`Password Reset Link: ${resetLink}`);
        }
        return res.render('forgot-password', { message });
    } catch (err) {
        console.error("Error generating reset token:", err);
        return res.render('forgot-password', { error: "Error occurred. Try again later." });
    }
});

/**
 * Render password reset form (the token is escaped by Handlebars)
 */
app.get('/reset-password', (req, res) => {
    const token = text(req.query.token);
    if (!token) {
        return res.render('forgot-password', { error: "Invalid or expired reset link. Please request a new one." });
    }
    res.render('reset-password', { token });
});

/**
 * Handle password reset update
 */
app.post('/reset-password', async (req, res) => {
    const token = text(req.body.token);
    const password = text(req.body.password);
    const confirmPassword = text(req.body.confirmPassword);
    try {
        const result = await business.resetPassword(token, password, confirmPassword);
        if (result.success) {
            return res.redirect("/login?msg=Password updated! Please login with your new password.");
        }
        return res.render('reset-password', { token, error: result.message });
    } catch (err) {
        console.error("Password reset error:", err);
        return res.render('reset-password', { token, error: "Error updating password. Try again." });
    }
});

/**
 * Handle user login authentication
 */
app.post('/login', limitTries('login', true), async (req, res) => {
    try {
        const email = text(req.body.email);
        const password = text(req.body.password);
        if (!email || !password) {
            return res.redirect("/login?error=Please enter both email and password.");
        }

        const user = await business.authenticateUser(email, password);
        if (!user) {
            res.locals.failedAttempt = true;
            return res.redirect("/login?error=Invalid email or password. Please check and try again.");
        }

        if (!user.verified) {
            return res.redirect("/login?error=Account not verified. Please check your email.");
        }

        // Start a fresh session and remember who is logged in
        req.session.regenerate((err) => {
            if (err) {
                console.error("Error creating session:", err);
                return res.redirect("/login?error=Something went wrong. Please try again later.");
            }
            req.session.user = {
                email: user.email,
                username: user.username,
                accountType: user.accountType
            };
            // Redirect based on account type
            if (user.accountType === "department_head") {
                return res.redirect("/admin-dashboard");
            } else {
                return res.redirect("/student-dashboard");
            }
        });
    } catch (error) {
        console.error("Error during login:", error);
        return res.redirect("/login?error=Something went wrong. Please try again later.");
    }
});

/**
 * Log out: delete the session and go back to the login page
 */
app.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect("/login?msg=You have been logged out.");
    });
});

/**
 * Admin dashboard route
 * Renders the HoD (Head of Department) homepage for the logged-in HoD
 */
app.get("/admin-dashboard", requireRole("department_head"), async (req, res) => {
    const counts = await persistence.getStatusCounts();

    await renderPage(req, res, 'HOD_homePage', {
        title: "Dashboard",
        heading: `Welcome, ${req.session.user.username}`,
        active: "dashboard",
        pendingCount: counts.Pending || 0,
        approvedCount: counts.Approved || 0,
        rejectedCount: counts.Rejected || 0
    });
});

/**
 * Student dashboard route
 * Renders student dashboard with badge count of unnotified requests
 */
app.get('/student-dashboard', requireRole("student"), async (req, res) => {
    const requests = await persistence.getRequestsByEmail(req.session.user.email);

    await renderPage(req, res, 'STUDENT_homePage', {
        title: "Dashboard",
        heading: `Welcome, ${req.session.user.username}`,
        active: "dashboard",
        requestCount: requests.length,
        pendingCount: requests.filter(r => r.status === "Pending").length
    });
});

/**
 * Serve the registration page
 */
app.get("/register", (req, res) => {
    res.render("register", { error: text(req.query.error), form: {} });
});

/**
 * Serve the login page (root or /login route); a logged-in user goes to their dashboard
 */
app.get(["/", "/login"], (req, res) => {
    if (req.session.user) {
        return res.redirect(dashboardFor(req.session.user));
    }
    res.render("login", { error: text(req.query.error), msg: text(req.query.msg) });
});

/**
 * View all student requests
 */
app.get("/student-requests", requireRole("student"), async (req, res) => {
    const requests = await business.getRequestsByStudent(req.session.user.email);
    await renderPage(req, res, "student-requests", { title: "My Requests", active: "my-requests", requests });
});

/**
 * Render the form for student to submit a request
 */
app.get("/student-request", requireRole("student"), async (req, res) => {
    await renderPage(req, res, "request_form", { title: "New Request", active: "new-request", semesters: SEMESTERS, categories: CATEGORIES, form: {} });
});

/**
 * Submit a new student request
 */
app.post("/student-request", requireRole("student"), async (req, res) => {
    const studentEmail = req.session.user.email;
    const studentName = await persistence.getStudentNameByEmail(studentEmail);

    const data = {
        studentEmail,
        studentName,
        semester: text(req.body.semester),
        category: text(req.body.category),
        description: text(req.body.description)
    };

    if (!SEMESTERS.includes(data.semester) || !CATEGORIES.includes(data.category) || !data.description.trim()) {
        res.status(400);
        return renderPage(req, res, "request_form", {
            title: "New Request", active: "new-request", semesters: SEMESTERS, categories: CATEGORIES, form: data,
            flash: { type: "danger", text: "Please choose a semester and a category and write a description." }
        });
    }

    await business.createRequest(data);
    flash(req, "success", "Request submitted.");
    res.redirect("/student-requests");
});

/**
 * Cancel a student request by ID
 */
app.post("/student-cancel/:id", requireRole("student"), async (req, res) => {
    const requestId = req.params.id;
    const email = req.session.user.email;
    if (!persistence.isValidId(requestId)) {
        return showError(req, res, 404, "Request not found.");
    }

    // only cancels the request if it belongs to the logged-in student and is still pending
    const result = await persistence.cancelRequestById(requestId, email);
    if (result.modifiedCount === 1) {
        flash(req, "success", "Request cancelled.");
    }
    res.redirect("/student-requests");
});

/**
 * View HoD requests with optional filters (category, semester)
 */
app.get('/hod-requests', requireRole("department_head"), async (req, res) => {
    const filters = {
        category: text(req.query.category),
        semester: text(req.query.semester),
        status: text(req.query.status)
    };
    const query = {};
    if (filters.category) query.category = filters.category;
    if (filters.semester) query.semester = filters.semester;
    if (filters.status) query.status = filters.status;

    const requests = await withStudentPictures(await persistence.getRequests(query));
    const queues = await persistence.getQueuesWithCountsOut();
    await renderPage(req, res, 'hod-requests', {
        title: "Review Requests", active: "review", requests, queues, filters,
        categories: CATEGORIES, semesters: SEMESTERS, statuses: STATUSES
    });
});

/**
 * Add each student's profile picture to their requests (as studentPic) for the avatars in the lists
 */
async function withStudentPictures(requests) {
    const pictures = await persistence.getProfilePicsByEmails([...new Set(requests.map(r => r.studentEmail))]);
    return requests.map(r => ({ ...r, studentPic: pictures[r.studentEmail] || null }));
}

/**
 * View queue of requests for a specific category
 */
app.get("/hod/queue/:category", requireRole("department_head"), async (req, res) => {
    const category = req.params.category;
    if (!CATEGORIES.includes(category)) {
        return showError(req, res, 404, "Queue not found.");
    }
    const requests = await withStudentPictures(await persistence.getRequestsByCategory(category));

    for (let request of requests) {
        if (!request.studentName && request.studentEmail) {
            request.studentName = request.studentEmail.split('@')[0];
        }
    }

    await renderPage(req, res, "hod-queue", {
        title: `Queue: ${category}`, active: "review", category, requests,
        backLink: { href: "/hod-requests", label: "Review Requests" }
    });
});

/**
 * View details of a single request (HoD)
 */
app.get("/hod/view/:id", requireRole("department_head"), async (req, res) => {
    const requestId = req.params.id;
    if (!persistence.isValidId(requestId)) {
        return showError(req, res, 404, "Request not found.");
    }
    const request = await persistence.getRequestById(requestId);
    if (!request) return showError(req, res, 404, "Request not found.");

    const [withPicture] = await withStudentPictures([request]);
    await renderPage(req, res, "hod-request", {
        title: "Request Details", active: "review", request, studentPic: withPicture.studentPic,
        backLink: { href: "/hod-requests", label: "Review Requests" }
    });
});

/**
 * Process a request (HoD changes status, adds note)
 */
app.post("/hod/request/:id", requireRole("department_head"), async (req, res) => {
    try {
        const status = text(req.body.status);
        const note = text(req.body.note);
        if (!persistence.isValidId(req.params.id)) {
            return showError(req, res, 404, "Request not found.");
        }
        const request = await persistence.getRequestById(req.params.id);
        if (!request) return showError(req, res, 404, "Request not found.");

        // the only statuses the HoD can set; Pending and Cancelled are set by the system/student
        if (status !== "Approved" && status !== "Rejected") {
            return showError(req, res, 400, "Status must be Approved or Rejected.");
        }
        if (request.status !== "Pending") {
            return showError(req, res, 400, `This request is already ${request.status}.`);
        }

        await business.processRequest(req.params.id, status, note, request.studentEmail);
        flash(req, "success", `Request ${status.toLowerCase()}.`);
        res.redirect(`/hod-requests`);
    } catch (error) {
        console.error("Error processing request:", error);
        await showError(req, res, 500, "Something went wrong. Please try again.");
    }
});

/**
 * View request as a student and mark it as notified
 */
app.get('/student/request/:id', requireRole("student"), async (req, res) => {
    const requestId = req.params.id;
    if (!persistence.isValidId(requestId)) {
        return showError(req, res, 404, "Request not found.");
    }

    try {
        const request = await persistence.getRequestById(requestId);
        // students can only open their own requests
        if (!request || request.studentEmail !== req.session.user.email) {
            return showError(req, res, 404, "Request not found.");
        }

        if (request.studentNotified === false) {
            await persistence.markRequestAsNotified(requestId);
        }

        await renderPage(req, res, 'student-request-view', {
            title: "Request Details", active: "my-requests", request,
            backLink: { href: "/student-requests", label: "My Requests" }
        });
    } catch (err) {
        console.error("Error viewing student request:", err);
        await showError(req, res, 500, "Something went wrong. Please try again.");
    }
});

/**
 * Get a random pending request (for HoD)
 */
app.get("/hod/random", requireRole("department_head"), async (req, res) => {
    const request = await persistence.getRandomPendingRequest();
    if (request) {
        res.redirect(`/hod/view/${request._id}`);
    } else {
        flash(req, "info", "There are no pending requests.");
        res.redirect("/hod-requests");
    }
});



/**
 * Any other address: show a "page not found" error page
 */
app.use(async (req, res) => {
    await showError(req, res, 404, "Page not found.");
});

/**
 * If a route throws an error, log it and show an error page instead of crashing
 * (Express 5 also sends errors from async routes here)
 */
app.use(async (err, req, res, next) => {
    console.error("Unexpected error:", err);
    try {
        await showError(req, res, 500, "Something went wrong. Please try again.");
    } catch {
        res.status(500).render("error", { layout: "layouts/plain", title: "Error", message: "Something went wrong. Please try again." });
    }
});

/**
 * Create the database indexes, then start the server on the configured port
 */
persistence.createIndexes()
    .then(() => {
        app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
    })
    .catch((err) => {
        console.error("Could not prepare the database (is MongoDB running? are there duplicate emails?):", err.message);
        process.exit(1);
    });
