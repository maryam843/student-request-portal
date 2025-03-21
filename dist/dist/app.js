const express = require('express');
const business = require('./business');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Serve only the "dist" directory
app.use(express.static(__dirname));

/**
 * Logs the details of the email sent, including the recipient and the verification link.
 * @param {string} to - The recipient's email address.
 * @param {string} verificationLink - The verification link sent to the user.
 */
function logEmailDetails(to, verificationLink) {
    console.log("---------------------------------");
    console.log("Email Sent:");
    console.log(`To: ${to}`);
    console.log(`Verification Link:\n${verificationLink}`);
    console.log("---------------------------------\n");
}

/**
 * Handles user registration by validating input data, checking for existing users, and sending a verification email.
 * @param {Object} req - The request object containing the user input data.
 * @param {Object} res - The response object used to send the response to the client.
 */
app.post('/register', async (req, res) => {
    const { name, email, password, confirmPassword, accountType } = req.body;
    try {
        // Validate input fields
        if (!email || !password || !name || !accountType) {
            return res.send(`
                <div style="color: red; border: 2px solid red; padding: 10px; margin: 10px;">
                    Error: Missing required fields. Please fill in all details.
                </div>
                <a href="/register">Go back to Register</a>
            `);
        }

        // Ensure passwords match
        if (password !== confirmPassword) {
            return res.send(`
                <div style="color: red; border: 2px solid red; padding: 10px; margin: 10px;">
                    Error: Passwords do not match. Please try again.
                </div>
                <a href="/register">Go back to Register</a>
            `);
        }

        // Check if the email is already registered
        const existingUser = await business.getUserByEmail(email);
        if (existingUser) {
            return res.send(`
                <div style="color: red; border: 2px solid red; padding: 10px; margin: 10px;">
                    Error: Email already in use. Please use a different email.
                </div>
                <a href="/register">Go back to Register</a>
            `);
        }

        // Register new user
        const userData = await business.registerUser(name, email, password, confirmPassword, accountType);

        if (!userData) {
            return res.send(`
                <div style="color: red; border: 2px solid red; padding: 10px; margin: 10px;">
                    Error: Registration failed. Please try again later.
                </div>
                <a href="/register">Go back to Register</a>
            `);
        }

        // Log email details
        logEmailDetails(userData.email, userData.verificationLink);

        // Respond with success message
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
 * Verifies the user's email using the provided token from the verification link.
 * @param {Object} req - The request object containing the verification token.
 * @param {Object} res - The response object used to send the response to the client.
 */
app.get("/verify-email", async (req, res) => {
    const { token } = req.query;
    if (!token) {
        return res.redirect("/register.html?error=Error while verifying your email, please try again.");
    }
    const success = await business.verifyUser(token);
    if (success) {
        res.redirect("/login.html?msg=Email verified! Please login to continue.");
    } else {
        res.redirect("/register.html?error=Error while verifying your email, please try again.");
    }
});

/**
 * Renders the login page for users to enter their credentials.
 * @param {Object} req - The request object.
 * @param {Object} res - The response object used to send the login page to the client.
 */
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, "login.html"));
});

/**
 * Handles user login by validating the credentials and creating a session.
 * @param {Object} req - The request object containing the login data.
 * @param {Object} res - The response object used to send the response to the client.
 */
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.redirect("/login.html?error=Missing email or password");
        }

        // Authenticate user
        const user = await business.authenticateUser(email, password);

        if (!user) {
            return res.redirect("/login.html?error=Invalid credentials");
        }

        if (!user.verified) {
            return res.redirect("/login.html?error=Account not verified. Check your email.");
        }
        // Dsiplay User details
        console.log("User authenticated:", user);
        console.log("---------------------------------");
        // Create session
        const sessionKey = await business.createSession(user);
        console.log("Session created:", sessionKey);
        console.log("*******************************************");
        
        // Check accountType and redirect accordingly
        if (user.accountType === "department_head") {
            return res.redirect("/admin-dashboard");
        } else {
            return res.redirect("/student-dashboard");
        }
    } catch (error) {
        console.error("Error during login:", error);
        return res.redirect("/login.html?error=Something went wrong, please try again.");
    }
});

/**
 * Renders the admin dashboard for department heads.
 * @param {Object} req - The request object.
 * @param {Object} res - The response object used to send the admin dashboard to the client.
 */
app.get("/admin-dashboard", (req, res) => {
    res.sendFile(path.join(__dirname, "hod.html"));
});

/**
 * Renders the student dashboard for regular users.
 * @param {Object} req - The request object.
 * @param {Object} res - The response object used to send the student dashboard to the client.
 */
app.get("/student-dashboard", (req, res) => {
    res.sendFile(path.join(__dirname, "home.html"));
});

/**
 * Renders the registration page for new users.
 * @param {Object} req - The request object.
 * @param {Object} res - The response object used to send the registration page to the client.
 */
app.get("/register", (req, res) => {
    res.sendFile(path.join(__dirname, "register.html"));
});

/**
 * Renders the login page or redirects to the login page if the user accesses the root path.
 * @param {Object} req - The request object.
 * @param {Object} res - The response object used to send the login page to the client.
 */
app.get(["/", "/login"], (req, res) => {
    res.sendFile(path.join(__dirname, "login.html"));
});

// Start the server
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
