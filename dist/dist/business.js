const crypto = require('crypto');
const persistence = require('./persistence');
const { connectDB } = require('./persistence');

/**
 * Registers a new user by validating inputs, hashing the password, and saving the user to the database.
 * @param {string} username - The username of the new user.
 * @param {string} email - The email address of the new user.
 * @param {string} password - The password chosen by the new user.
 * @param {string} repeatPassword - The confirmation password to ensure both passwords match.
 * @param {string} accountType - The type of account (e.g., 'student', 'admin').
 * @returns {Object|boolean} - Returns an object with the email and verification link on success, or false on failure.
 */
async function registerUser(username, email, password, repeatPassword, accountType) {
    // Ensure accountType is provided
    if (!accountType) {
        return false;
    }

    // Ensure password is valid and of sufficient length
    if (!password) {
        return false;
    }

    // Ensure repeatPassword matches password
    if (password !== repeatPassword) {
        return false;
    }

    // Ensure email format is valid
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return false;
    }

    const existingUser = await persistence.getUserByEmail(email);
    if (existingUser) {
        return false; // Return early if the email exists
    }

    try {
        // Hash the password using crypto
        const salt = crypto.randomBytes(16).toString('hex'); // Generate a salt
        const hashedPassword = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');

        // Generate a verification token
        let verificationToken = crypto.randomBytes(20).toString('hex');

        // Create new user object
        let newUser = {
            username,
            email: email.toLowerCase(),
            passwordHash: hashedPassword,
            salt: salt, // Store the salt
            accountType: accountType,
            verified: false,
            verificationToken,
        };

        // Save the user to the database
        await persistence.createRegistration(newUser);

        // Return success with verification link
        return {
            email,
            verificationLink: `http://localhost:3000/verify-email?token=${verificationToken}`
        };
    } catch (error) {
        return false;
    }
}

/**
 * Verifies a user by checking the provided token.
 * @param {string} token - The verification token sent to the user.
 * @returns {boolean} - Returns true if the token is valid and the user is verified, otherwise false.
 */
async function verifyUser(token) {
    return await persistence.verifyUserToken(token);
}

/**
 * Authenticates a user by checking the email and password combination.
 * @param {string} email - The email address of the user.
 * @param {string} password - The password entered by the user.
 * @returns {Object|boolean} - Returns the user object if authentication is successful, otherwise false.
 */
async function authenticateUser(email, password) {
    const user = await persistence.getUserByEmail(email);
    if (!user) {
        return false;
    }

    // Compare the provided password with the stored hash
    const hashedPassword = crypto.pbkdf2Sync(password, user.salt, 1000, 64, 'sha512').toString('hex');
    if (hashedPassword !== user.passwordHash) {
        return false;
    }

    return user;
}

/**
 * Creates a new session for an authenticated user.
 * @param {Object} user - The authenticated user object.
 * @returns {string} - The session key for the new session.
 */
async function createSession(user) {
    const sessionKey = crypto.randomUUID();  // Unique session key using UUID
    const sessionData = {
        key: sessionKey,
        userId: user._id,  // Use the user's ID from the database
        created_at: new Date(),
        expiry: new Date(Date.now() + 1000 * 60 * 30) // Session expiry in 30 minutes
    };
    await persistence.storeSession(sessionData); // Store session in database
    return sessionKey;  // Return the session key to be used in the app
}


/**
 * Retrieves a user from the database by their email.
 * @param {string} email - The email address of the user.
 * @returns {Object|null} - Returns the user object if found, otherwise null.
 */
async function getUserByEmail(email) {
    const db = await connectDB();
    return await db.collection('users').findOne({ email: email.toLowerCase() }); // Convert to lowercase for consistency
}

module.exports = {
    registerUser,
    authenticateUser,
    createSession,
    verifyUser,
    getUserByEmail,
};
