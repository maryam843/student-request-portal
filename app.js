require('dotenv').config();
const express = require('express');
const session = require('express-session');
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
 * Only let logged-in users through; everybody else goes to the login page
 */
function requireLogin(req, res, next) {
    if (!req.session.user) {
        return res.redirect("/login?error=Please login first.");
    }
    next();
}

/**
 * Only let logged-in users with the given account type through
 */
function requireRole(accountType) {
    return function (req, res, next) {
        if (!req.session.user) {
            return res.redirect("/login?error=Please login first.");
        }
        if (req.session.user.accountType !== accountType) {
            return res.status(403).render("error", { message: "You are not allowed to open this page." });
        }
        next();
    };
}

const port = process.env.PORT || 8000;

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

hbs.registerHelper('formatDate', function(date) {
    const options = { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' };
    return new Date(date).toLocaleDateString('en-US', options);
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
    const user = await business.getUserByEmail(req.session.user.email);
    if (!user) return res.redirect("/login?error=User not found.");

    const dashboard = user.accountType === "department_head" ? "/admin-dashboard" : "/student-dashboard";
    res.render('profile', { user, dashboard, error: text(req.query.error), msg: text(req.query.msg) });
});

/**
 * Handle profile picture upload request (changes the picture of the logged-in user)
 */
app.post('/upload-profile', requireLogin, uploadProfilePic, async (req, res) => {
    if (req.uploadError) {
        return res.redirect(`/profile?error=${encodeURIComponent(req.uploadError)}`);
    }
    if (!req.file) {
        return res.redirect("/profile?error=Please choose a picture first.");
    }
    await persistence.updateProfilePic(req.session.user.email, req.file.filename);
    res.redirect("/profile?msg=Profile picture updated.");
});


/**
 * Handle user registration
 */
app.post('/register', uploadProfilePic, async (req, res) => {
    const [name, email, password, confirmPassword, college, dob, ID, nationality, address, phone] =
        ['name', 'email', 'password', 'confirmPassword', 'college', 'dob', 'ID', 'nationality', 'address', 'phone'].map(field => text(req.body[field]));
    const profilePic = req.file ? req.file.filename : null;

    try {
        if (req.uploadError) {
            return res.send(`
                <div style="color: red; border: 2px solid red; padding: 10px; margin: 10px;">
                    Error: ${req.uploadError}
                </div>
                <a href="/register">Go back to Register</a>
            `);
        }

        if (!email || !password || !name) {
            return res.send(`
                <div style="color: red; border: 2px solid red; padding: 10px; margin: 10px;">
                    Error: Missing required fields. Please fill in all details.
                </div>
                <a href="/register">Go back to Register</a>
            `);
        }

        if (password !== confirmPassword) {
            return res.send(`
                <div style="color: red; border: 2px solid red; padding: 10px; margin: 10px;">
                    Error: Passwords do not match. Please try again.
                </div>
                <a href="/register">Go back to Register</a>
            `);
        }

        const existingUser = await business.getUserByEmail(email);
        if (existingUser) {
            return res.send(`
                <div style="color: red; border: 2px solid red; padding: 10px; margin: 10px;">
                    Error: Email already in use. Please use a different email.
                </div>
                <a href="/register">Go back to Register</a>
            `);
        }

        const userData = await business.registerUser(name, email, password, confirmPassword, college, dob, ID, nationality, address, phone, profilePic);

        if (!userData) {
            return res.send(`
                <div style="color: red; border: 2px solid red; padding: 10px; margin: 10px;">
                    Error: Registration failed. Please try again later.
                </div>
                <a href="/register">Go back to Register</a>
            `);
        }

        logEmailDetails(userData.email, userData.verificationLink);

        return res.send(`
            <div style="color: green; border: 2px solid green; padding: 10px; margin: 10px;">
                ✅ Verification Email sent! Check your console and click on the link to verify your account.
            </div>
        `);
    } catch (error) {
        console.error("Error during registration:", error);
        return res.send(`
            <div style="color: red; border: 2px solid red; padding: 10px; margin: 10px;">
                Error: Something went wrong. Please try again.
            </div>
            <a href="/register">Go back to Register</a>
        `);
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
app.post('/forgot-password', async (req, res) => {
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
app.post('/login', async (req, res) => {
    try {
        const email = text(req.body.email);
        const password = text(req.body.password);
        if (!email || !password) {
            return res.redirect("/login?error=Please enter both email and password.");
        }

        const user = await business.authenticateUser(email, password);
        if (!user) {
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
    const user = await business.getUserByEmail(req.session.user.email);
    if (!user) return res.redirect("/login?error=User not found.");

    const counts = await persistence.getStatusCounts();

    res.render('HOD_homePage', { 
        user,
        email: user.email,
        profilePic: user.profilePic,
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
    const user = await business.getUserByEmail(req.session.user.email);
    if (!user) return res.redirect("/login?error=User not found.");

    const requests = await persistence.getRequestsByEmail(user.email); 
    const badgeCount = requests.filter(r => r.studentNotified === false).length;
    const pendingCount = requests.filter(r => r.status === "Pending").length;

    res.render('STUDENT_homePage', { 
        user,
        email: user.email,
        badgeCount,
        requestCount: requests.length,
        pendingCount,
        profilePic: user.profilePic
    });
});

/**
 * Serve the registration page
 */
app.get("/register", (req, res) => {
    res.render("register", { error: text(req.query.error) });
});

/**
 * Serve the login page (root or /login route)
 */
app.get(["/", "/login"], (req, res) => {
    res.render("login", { error: text(req.query.error), msg: text(req.query.msg) });
});

/**
 * View all student requests
 */
app.get("/student-requests", requireRole("student"), async (req, res) => {
    const email = req.session.user.email;
    const requests = await business.getRequestsByStudent(email);
    res.render("student-requests", { requests, email });
});

/**
 * Render the form for student to submit a request
 */
app.get("/student-request", requireRole("student"), (req, res) => {
    res.render("request_form", { email: req.session.user.email });
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

    if (!data.semester || !data.category || !data.description) {
        return res.status(400).render("error", { message: "Please fill in the semester, category and description." });
    }

    await business.createRequest(data);
    res.redirect("/student-requests");
});

/**
 * Cancel a student request by ID
 */
app.post("/student-cancel/:id", requireRole("student"), async (req, res) => {
    const requestId = req.params.id;
    const email = req.session.user.email;
    if (!persistence.isValidId(requestId)) {
        return res.status(404).render("error", { message: "Request not found." });
    }

    // only cancels the request if it belongs to the logged-in student
    await persistence.cancelRequestById(requestId, email);
    res.redirect("/student-requests");
});

/**
 * View HoD requests with optional filters (category, semester)
 */
app.get('/hod-requests', requireRole("department_head"), async (req, res) => {
    const category = text(req.query.category);
    const semester = text(req.query.semester);
    let query = {};

    if (category) query.category = category;
    if (semester) query.semester = semester;

    try {
        const requests = await persistence.getRequests(query);
        const queues = await persistence.getQueuesWithCountsOut({});
        res.render('hod-requests', { requests, queues });
    } catch (err) {
        console.error(err);
        res.status(500).render("error", { message: "Something went wrong. Please try again." });
    }
});

/**
 * View queue of requests for a specific category
 */
app.get("/hod/queue/:category", requireRole("department_head"), async (req, res) => {
    const category = req.params.category;
    const requests = await persistence.getRequestsByCategory(category, "Pending");

    for (let request of requests) {
        if (!request.studentName && request.studentEmail) {
            request.studentName = request.studentEmail.split('@')[0];
        }
    }

    res.render("hod-queue", { category, requests });
});

/**
 * View details of a single request (HoD)
 */
app.get("/hod/view/:id", requireRole("department_head"), async (req, res) => {
    const requestId = req.params.id;
    if (!persistence.isValidId(requestId)) {
        return res.status(404).render("error", { message: "Request not found." });
    }
    const request = await persistence.getRequestById(requestId);
    if (!request) return res.status(404).render("error", { message: "Request not found." });

    res.render("hod-request", { request });
});

/**
 * Process a request (HoD changes status, adds note)
 */
app.post("/hod/request/:id", requireRole("department_head"), async (req, res) => {
    try {
        const status = text(req.body.status);
        const note = text(req.body.note);
        if (!persistence.isValidId(req.params.id)) {
            return res.status(404).render("error", { message: "Request not found." });
        }
        const request = await persistence.getRequestById(req.params.id);
        if (!request) return res.status(404).render("error", { message: "Request not found." });

        // the only statuses the HoD can set; Pending and Cancelled are set by the system/student
        if (status !== "Approved" && status !== "Rejected") {
            return res.status(400).render("error", { message: "Status must be Approved or Rejected." });
        }
        if (request.status !== "Pending") {
            return res.status(400).render("error", { message: `This request is already ${request.status}.` });
        }

        await business.processRequest(req.params.id, status, note, request.studentEmail);
        res.redirect(`/hod-requests`);
    } catch (error) {
        console.error("Error processing request:", error);
        res.status(500).render("error", { message: "Something went wrong. Please try again." });
    }
});

/**
 * View request as a student and mark it as notified
 */
app.get('/student/request/:id', requireRole("student"), async (req, res) => {
    const requestId = req.params.id;
    if (!persistence.isValidId(requestId)) {
        return res.status(404).render("error", { message: "Request not found." });
    }

    try {
        const request = await persistence.getRequestById(requestId);
        // students can only open their own requests
        if (!request || request.studentEmail !== req.session.user.email) {
            return res.status(404).render("error", { message: "Request not found." });
        }

        if (request.studentNotified === false) {
            await persistence.markRequestAsNotified(requestId);
        }

        res.render('student-request-view', { request });
    } catch (err) {
        console.error("Error viewing student request:", err);
        res.status(500).render("error", { message: "Something went wrong. Please try again." });
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
        res.send("No pending requests.");
    }
});



/**
 * Any other address: show a "page not found" error page
 */
app.use((req, res) => {
    res.status(404).render("error", { message: "Page not found." });
});

/**
 * If a route throws an error, log it and show an error page instead of crashing
 * (Express 5 also sends errors from async routes here)
 */
app.use((err, req, res, next) => {
    console.error("Unexpected error:", err);
    res.status(500).render("error", { message: "Something went wrong. Please try again." });
});

/**
 * Start server on configured port
 */
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
