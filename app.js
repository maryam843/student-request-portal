require('dotenv').config();
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { csrfSync } = require('csrf-sync');
const MongoStore = require('connect-mongo');
const business = require('./business');
const path = require('path');
const multer = require('multer');
const app = express();
const hbs = require("hbs");
const persistence = require("./persistence");
const crypto = require('crypto');
const fs = require('fs');


// View Engine Setup
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

const isProduction = process.env.NODE_ENV === 'production';
const port = process.env.PORT || 8000;
// Address of the app in the links that would be e-mailed (verification, password reset)
const baseUrl = (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');

// In production the app runs behind an HTTPS proxy (e.g. a hosting platform): trust its
// X-Forwarded-Proto header so Express knows the request was HTTPS and sends the secure cookie
if (isProduction) {
    app.set('trust proxy', 1);
}

// Security headers. The Content Security Policy only allows scripts, styles and images
// from this server (the CoreUI files are in public/vendors), so an injected <script> or
// onclick="..." does not run. frame-ancestors 'none' stops other sites from showing the
// app in a frame (clickjacking).
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'"],
            imgSrc: ["'self'", "data:"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            // only useful behind HTTPS; on http://localhost it would break the page
            upgradeInsecureRequests: isProduction ? [] : null
        }
    },
    frameguard: { action: 'deny' },
    strictTransportSecurity: isProduction
}));

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
// stringify: false keeps the session as an object, so the sessions of one user can be
// found by e-mail and deleted when the password is reset (persistence.deleteSessionsOfUser).
const sessionStore = MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    dbName: persistence.dbName,
    collectionName: 'sessions',
    stringify: false
});
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        // only sent over HTTPS in production; on http://localhost it must be false or login breaks
        secure: isProduction,
        maxAge: 1000 * 60 * 60 * 2
    }
}));

// CSRF protection: every form gets a secret token that is also kept in the session.
// A POST without the right token (e.g. a form on another website that posts to this
// app with the user's cookie) is refused with 403.
const { csrfSynchronisedProtection, generateToken } = csrfSync({
    size: 32,
    getTokenFromRequest: (req) => req.body && req.body._csrf
});

// Forms with a file are read by Multer inside the route, so their token is checked
// there (checkCsrfAfterUpload). Every other POST is checked here.
const FILE_FORMS = ['/register', '/upload-profile'];

app.use((req, res, next) => {
    // a function, so a token (and a session) is only created when a page shows a form
    res.locals.csrfToken = () => generateToken(req);
    if (FILE_FORMS.includes(req.path)) {
        return next();
    }
    csrfSynchronisedProtection(req, res, next);
});

/**
 * Check the CSRF token of a form with a file (after Multer has read the form);
 * if the token is wrong, delete the uploaded file again
 */
function checkCsrfAfterUpload(req, res, next) {
    csrfSynchronisedProtection(req, res, (err) => {
        if (err && req.file) {
            deleteUpload(req.file.filename);
        }
        next(err);
    });
}

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
// the values of the college list on the register page
const COLLEGES = ["Business", "IT", "Engineering", "General Education", "Health"];
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

/**
 * Allow at most 10 tries per 15 minutes from the same IP address, then show a message
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
    'image/webp': '.webp'
};
const WRONG_IMAGE_TYPE = "Only JPG, PNG or WEBP images are allowed.";

/**
 * The image type from the first bytes of the file ("magic bytes"), or null.
 * The browser sends the type and the file name, but both can be faked.
 */
function imageTypeOf(bytes) {
    if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
    if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    return null;
}

const upload = multer({
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
    fileFilter: function (req, file, cb) {
        const extension = path.extname(file.originalname).toLowerCase();
        const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
        if (ALLOWED_IMAGES[file.mimetype] && allowedExtensions.includes(extension)) {
            cb(null, true);
        } else {
            cb(new Error(WRONG_IMAGE_TYPE));
        }
    }
});

/**
 * Delete a file from the uploads folder (only the file name is used, so it cannot point
 * outside the folder); a file that is already gone is ignored
 */
function deleteUpload(fileName) {
    fs.unlink(path.join(__dirname, 'uploads', path.basename(fileName)), () => {});
}

/**
 * Run the upload and keep the error message (too big, wrong type) instead of crashing.
 * A saved file whose content is not the image type it claims to be is deleted again.
 */
function uploadProfilePic(req, res, next) {
    upload.single('profilePic')(req, res, async (err) => {
        if (err) {
            req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? "The picture must be 2 MB or smaller." : err.message;
        } else if (req.file) {
            const bytes = Buffer.alloc(12);
            try {
                const file = await fs.promises.open(req.file.path, 'r');
                try {
                    await file.read(bytes, 0, 12, 0);
                } finally {
                    await file.close();
                }
            } catch (readError) {
                deleteUpload(req.file.filename);
                return next(readError);
            }
            if (imageTypeOf(bytes) !== req.file.mimetype) {
                deleteUpload(req.file.filename);
                req.file = undefined;
                req.uploadError = "This file is not a real JPG, PNG or WEBP image.";
            }
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
    // public/js/app.js swaps in the data-fallback picture (no inline onerror, see the CSP above)
    const fallback = profilePic ? ` data-fallback="${DEFAULT_AVATAR}"` : '';
    return new hbs.SafeString(
        `<img class="${hbs.Utils.escapeExpression(typeof cssClass === 'string' ? cssClass : '')}" src="${hbs.Utils.escapeExpression(src)}"${sizeAttrs}${fallback} alt="Profile picture">`
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
 * No real emails are sent: print the link to the console instead, as one line
 * (label + link) with blank lines around it, so it is easy to find and copy
 */
function logEmailLink(to, label, link) {
    console.log(`\nEmail to ${to}\n${label}: ${link}\n`);
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
app.post('/upload-profile', requireLogin, uploadProfilePic, checkCsrfAfterUpload, async (req, res) => {
    if (req.uploadError) {
        flash(req, "danger", req.uploadError);
    } else if (!req.file) {
        flash(req, "danger", "Please choose a picture first.");
    } else {
        const user = await persistence.getUserByEmail(req.session.user.email);
        await persistence.updateProfilePic(req.session.user.email, req.file.filename);
        // the old picture is not used any more
        if (user && user.profilePic) {
            deleteUpload(user.profilePic);
        }
        flash(req, "success", "Profile picture updated.");
    }
    res.redirect("/profile");
});


/**
 * Handle user registration
 */
app.post('/register', limitTries('register'), uploadProfilePic, checkCsrfAfterUpload, async (req, res) => {
    const [name, email, password, confirmPassword, college] =
        ['name', 'email', 'password', 'confirmPassword', 'college'].map(field => text(req.body[field]));
    const profilePic = req.file ? req.file.filename : null;

    // show the form again with the error; the typed name, email and college are kept.
    // The uploaded picture is deleted, otherwise it would stay in uploads/ without an account.
    const showForm = (error) => {
        if (req.file) {
            deleteUpload(req.file.filename);
        }
        return res.status(400).render('register', { error, form: { name, email, college } });
    };

    try {
        if (req.uploadError) {
            return showForm(req.uploadError);
        }

        if (!email || !password || !name) {
            return showForm("Please fill in your name, email and password.");
        }

        if (!COLLEGES.includes(college)) {
            return showForm("Please choose a college from the list.");
        }

        if (password !== confirmPassword) {
            return showForm("The passwords do not match.");
        }

        if (password.length < business.PASSWORD_MIN_LENGTH) {
            return showForm(business.PASSWORD_TOO_SHORT);
        }

        const existingUser = await business.getUserByEmail(email);
        if (existingUser) {
            return showForm("This email is already registered.");
        }

        const userData = await business.registerUser(name, email, password, confirmPassword, college, profilePic);

        if (!userData) {
            return showForm("Registration failed. Check the email address and try again, or log in if you already have an account.");
        }

        logEmailLink(userData.email, "Verification link", `${baseUrl}/verify-email?token=${userData.verificationToken}`);

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
        return res.redirect("/register?error=The verification link is invalid, has expired or has already been used.");
    }
    const success = await business.verifyUser(token);
    if (success) {
        res.redirect("/login?msg=Email verified. You can now log in.");
    } else {
        res.redirect("/register?error=The verification link is invalid, has expired or has already been used.");
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
            const resetLink = `${baseUrl}/reset-password?token=${token}`;
            logEmailLink(email, "Reset link", resetLink);
        }
        return res.render('forgot-password', { message });
    } catch (err) {
        console.error("Error generating reset token:", err);
        return res.render('forgot-password', { error: "Something went wrong. Please try again." });
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
            return res.redirect("/login?msg=Password updated. Log in with your new password.");
        }
        return res.render('reset-password', { token, error: result.message });
    } catch (err) {
        console.error("Password reset error:", err);
        return res.render('reset-password', { token, error: "Something went wrong. Please try again." });
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
            return res.redirect("/login?error=Invalid email or password.");
        }

        if (!user.verified) {
            return res.redirect("/login?error=Account not verified. Open the verification link first.");
        }

        // Start a fresh session and remember who is logged in
        req.session.regenerate((err) => {
            if (err) {
                console.error("Error creating session:", err);
                return res.redirect("/login?error=Something went wrong. Please try again.");
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
        return res.redirect("/login?error=Something went wrong. Please try again.");
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
    await renderPage(req, res, "request_form", { title: "New Request", active: "new-request", semesters: business.semesterList(), categories: CATEGORIES, form: {} });
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

    if (!business.semesterList().includes(data.semester) || !CATEGORIES.includes(data.category) || !data.description.trim()) {
        res.status(400);
        return renderPage(req, res, "request_form", {
            title: "New Request", active: "new-request", semesters: business.semesterList(), categories: CATEGORIES, form: data,
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
        categories: CATEGORIES, semesters: business.semesterList(), statuses: STATUSES
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
        const updated = await business.processRequest(req.params.id, status, note);
        if (!updated) {
            // the student cancelled it or it was decided in the meantime; nothing was changed
            const current = await persistence.getRequestById(req.params.id);
            return showError(req, res, 409, `This request was already ${current.status.toLowerCase()}, so it was not changed.`);
        }
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
    if (err.code === 'EBADCSRFTOKEN') {
        return showError(req, res, 403, "This form has expired. Please go back, reload the page and try again.");
    }
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
function start() {
    return persistence.createIndexes()
        .then(() => {
            app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
        })
        .catch((err) => {
            console.error("Could not prepare the database (is MongoDB running? are there duplicate emails?):", err.message);
            process.exit(1);
        });
}

// The tests import the app without starting the server; "npm start" runs this file directly
if (require.main === module) {
    start();
}

module.exports = { app, start, sessionStore };
