require('dotenv').config();
const express = require('express');
const business = require('./business');
const path = require('path');
const multer = require('multer');
const app = express();
const hbs = require("hbs");
const cookieParser = require('cookie-parser');
const persistence = require("./persistence");
const crypto = require('crypto');


// View Engine Setup
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// Middleware Setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(cookieParser());

app.use((req, res, next) => {
    if (!req.cookies.csrfToken) {
        const token = crypto.randomBytes(32).toString('hex');
        res.cookie('csrfToken', token, { httpOnly: true });
    }
    next();
});

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
     * Rename uploaded file with timestamp prefix
     */
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

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
 * Handle profile picture upload request
 */
app.post('/upload-profile', upload.single('profilePic'), async (req, res) => {
    try {
        const profilePicPath = req.file ? `/uploads/${req.file.filename}` : null;
        res.render('success', { imagePath: profilePicPath });
    } catch (err) {
        console.error(err);
        res.status(500).send('Upload failed');
    }
});


/**
 * Handle user registration
 */
app.post('/register', upload.single('profilePic'), async (req, res) => {
    const { name, email, password, confirmPassword, accountType, college, dob, ID, nationality, address, phone } = req.body;
    const profilePic = req.file ? req.file.filename : null;

    try {
        if (!email || !password || !name || !accountType) {
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

        const userData = await business.registerUser(name, email, password, confirmPassword, accountType, college, dob, ID, nationality, address, phone, profilePic);

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
    const { token } = req.query;
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
    res.send(`
        <h2>Forgot Password</h2>
        <form action="/forgot-password" method="POST">
            <label>Email:</label><br>
            <input type="email" name="email" required /><br><br>
            <button type="submit">Send Reset Link</button>
        </form>
    `);
});

/**
 * Handle forgot password logic and generate reset token
 */
app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await business.getUserByEmail(email);
        if (!user) {
            return res.send(`<p>User not found. <a href="/forgot-password">Try again</a></p>`);
        }
        const token = await business.generateResetToken(email);
        const resetLink = `http://localhost:8000/reset-password?token=${token}`;
        console.log(`Password Reset Link: ${resetLink}`);
        return res.send(`<p>✅ Password reset link sent! (Check console)</p>`);
    } catch (err) {
        console.error("Error generating reset token:", err);
        return res.send(`<p>Error occurred. Try again later.</p>`);
    }
});

/**
 * Render password reset form
 */
app.get('/reset-password', (req, res) => {
    const { token } = req.query;
    if (!token) {
        return res.send("Invalid or expired token");
    }
    res.send(`
        <h2>Reset Password</h2>
        <form action="/reset-password" method="POST">
            <input type="hidden" name="token" value="${token}" />
            <label>New Password:</label><br>
            <input type="password" name="password" required /><br><br>
            <label>Confirm Password:</label><br>
            <input type="password" name="confirmPassword" required /><br><br>
            <button type="submit">Reset Password</button>
        </form>
    `);
});

/**
 * Handle password reset update
 */
app.post('/reset-password', async (req, res) => {
    const { token, password, confirmPassword } = req.body;
    if (password !== confirmPassword) {
        return res.send(`<p>Passwords do not match. <a href="/reset-password?token=${token}">Try again</a></p>`);
    }
    try {
        const success = await business.resetPassword(token, password);
        if (success) {
            return res.send(`<p>✅ Password updated! <a href="/login">Login</a></p>`);
        } else {
            return res.send(`<p>❌ Invalid or expired token. <a href="/forgot-password">Request again</a></p>`);
        }
    } catch (err) {
        console.error("Password reset error:", err);
        return res.send(`<p>Error updating password. Try again.</p>`);
    }
});

/**
 * Handle user login authentication
 */
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
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

        // Redirect based on account type
        if (user.accountType === "department_head") {
            return res.redirect(`/admin-dashboard?email=${user.email}`);
        } else {
            return res.redirect(`/student-dashboard?email=${user.email}`);
        }
    } catch (error) {
        console.error("Error during login:", error);
        return res.redirect("/login?error=Something went wrong. Please try again later.");
    }
});

/**
 * Admin dashboard route
 * Renders the HoD (Head of Department) homepage if a valid email is provided
 */
app.get("/admin-dashboard", async (req, res) => {
    const { email } = req.query;
    if (!email) return res.redirect("/login?error=Please login first.");

    const user = await business.getUserByEmail(email);
    if (!user) return res.redirect("/login?error=User not found.");

    res.render('HOD_homePage', { 
        user,
        email: user.email,
        profilePic: user.profilePic
    });
});

/**
 * Student dashboard route
 * Renders student dashboard with badge count of unnotified requests
 */
app.get('/student-dashboard', async (req, res) => {
    const { email } = req.query;
    if (!email) return res.redirect("/login?error=Please login first.");

    const user = await business.getUserByEmail(email);
    if (!user) return res.redirect("/login?error=User not found.");

    const requests = await persistence.getRequestsByEmail(user.email); 
    const badgeCount = requests.filter(r => r.studentNotified === false).length;

    res.render('STUDENT_homePage', { 
        user,
        email: user.email,
        badgeCount,
        profilePic: user.profilePic
    });
});

/**
 * Serve the registration page
 */
app.get("/register", (req, res) => {
    res.render("register");
});

/**
 * Serve the login page (root or /login route)
 */
app.get(["/", "/login"], (req, res) => {
    res.render("login");
});

/**
 * View all student requests
 */
app.get("/student-requests", async (req, res) => {
    const email = req.query.email;
    if (!email) return res.status(400).send("Missing email in request.");

    const requests = await business.getRequestsByStudent(email);
    res.render("student-requests", { requests, email });
});

/**
 * Render the form for student to submit a request
 */
app.get("/student-request", (req, res) => {
    const email = req.query.email;
    if (!email) return res.redirect("/login");

    res.render("request_form", { email });
});

/**
 * Submit a new student request
 */
app.post("/student-request", async (req, res) => {
    const studentEmail = req.body.email;
    const studentName = await persistence.getStudentNameByEmail(studentEmail);

    const data = {
        studentEmail,
        studentName,
        semester: req.body.semester,
        category: req.body.category,
        description: req.body.description
    };

    await business.createRequest(data);
    res.redirect(`/student-requests?email=${studentEmail}`);
});

/**
 * Cancel a student request by ID
 */
app.post("/student-cancel/:id", async (req, res) => {
    const requestId = req.params.id;
    const email = req.body.email;

    await persistence.cancelRequestById(requestId, email);
    res.redirect(`/student-requests?email=${email}`);
});

/**
 * View HoD requests with optional filters (category, semester)
 */
app.get('/hod-requests', async (req, res) => {
    const { category, semester } = req.query;
    let query = {};

    if (category) query.category = category;
    if (semester) query.semester = semester;

    try {
        const requests = await persistence.getRequests(query);
        const queues = await persistence.getQueuesWithCountsOut({});
        res.render('hod-requests', { requests, queues });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});

/**
 * View queue of requests for a specific category
 */
app.get("/hod/queue/:category", async (req, res) => {
    const category = req.params.category;
    const requests = await persistence.getRequestsByCategory(category, "Pending");

    for (let request of requests) {
        if (!request.studentName && request.studentEmail) {
            request.studentName = request.studentEmail.split('@')[0];
        }
    }

    const queues = await persistence.getQueuesWithCounts({});
    res.render("hod-queue", { category, requests, queues });
});

/**
 * View details of a single request (HoD)
 */
app.get("/hod/view/:id", async (req, res) => {
    const requestId = req.params.id;
    const request = await persistence.getRequestById(requestId);
    if (!request) return res.status(404).send("Request not found");

    res.render("hod-request", { request });
});

/**
 * Process a request (HoD changes status, adds note)
 */
app.post("/hod/request/:id", async (req, res) => {
    try {
        const { status, note } = req.body;
        const request = await persistence.getRequestById(req.params.id);
        if (!request) return res.status(404).send("Request not found");

        await business.processRequest(req.params.id, status, note, request.studentEmail);
        res.redirect(`/hod-requests`);
    } catch (error) {
        console.error("Error processing request:", error);
        res.status(500).send("Error processing request");
    }
});

/**
 * View request as a student and mark it as notified
 */
app.get('/student/request/:id', async (req, res) => {
    const requestId = req.params.id;

    try {
        const request = await persistence.getRequestById(requestId);
        if (!request) return res.status(404).send("Request not found");

        if (request.studentNotified === false) {
            await persistence.markRequestAsNotified(requestId);
        }

        res.render('student-request-view', { request });
    } catch (err) {
        console.error("Error viewing student request:", err);
        res.status(500).send("Server error");
    }
});

/**
 * Get a random pending request (for HoD)
 */
app.get("/hod/random", async (req, res) => {
    const request = await persistence.getRandomPendingRequest();
    if (request) {
        res.redirect(`/hod/view/${request._id}`);
    } else {
        res.send("No pending requests.");
    }
});



/**
 * Rating submission route with CSRF protection
 */
app.post('/rate', (req, res) => {
    const tokenFromForm = req.body.csrfToken;
    const tokenFromCookie = req.cookies.csrfToken;

    if (tokenFromForm !== tokenFromCookie) {
        return res.status(403).send('CSRF token mismatch');
    }

    const rating = req.body.rating;
    res.send('Thanks for your rating!');
});

/**
 * Render rating form with CSRF token
 */
app.get('/rate', (req, res) => {
    const csrfToken = req.cookies.csrfToken;
    res.render('rate_form', { csrfToken });
});

/**
 * Start server on configured port
 */
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
