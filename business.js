const crypto = require('crypto');
const bcrypt = require('bcrypt');
const persistence = require('./persistence');

// bcrypt cost factor: each +1 doubles the time needed to hash (and to guess) a password
const BCRYPT_ROUNDS = 10;
const { connectDB } = require('./persistence');

/**
 * Registers a new user after validating inputs, hashing the password with bcrypt,
 * and generating a verification token. Stores the user in the database
 * and returns the verification link.
 */
async function registerUser(username, email, password, repeatPassword, college, dob, ID, nationality, address, phone, profilePic) {
    if (!password || password !== repeatPassword) return false;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return false;

    const existingUser = await persistence.getUserByEmail(email);
    if (existingUser) return false;

    try {
        const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const verificationToken = crypto.randomBytes(20).toString('hex');

        const newUser = {
            username,
            email: email.toLowerCase(),
            passwordHash: hashedPassword,
            // everyone who registers is a student; the HoD account is created by scripts/seed.js
            accountType: "student",
            verified: false,
            verificationToken,
            college,
            dob,
            ID,
            nationality,
            address,
            phone,
            profilePic
        };

        await persistence.createRegistration(newUser);

        return {
            email,
            verificationLink: `http://localhost:8000/verify-email?token=${verificationToken}`
        };
    } catch (error) {
        return false;
    }
}

/**
 * Verifies a user by matching the verification token with a stored record.
 */
async function verifyUser(token) {
    return await persistence.verifyUserToken(token);
}

/**
 * Authenticates a user by checking the input password against the stored bcrypt hash.
 */
async function authenticateUser(email, password) {
    const user = await persistence.getUserByEmail(email);
    if (!user) return null;

    const matches = await bcrypt.compare(password, user.passwordHash);
    return matches ? user : null;
}

/**
 * Generates a secure token for password reset and stores it in the database with expiry.
 */
async function generateResetToken(email) {
    email = email.toLowerCase();
    const user = await persistence.getUserByEmail(email);
    if (!user) {
        throw new Error('No user found with that email');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60);
    await persistence.storeResetToken(email, token, expiresAt);

    return token;
}

/**
 * Resets a user's password using a valid token. Hashes and stores the new password.
 * Returns { success, message } so the caller can show the right message.
 */
async function resetPassword(token, newPassword, repeatPassword) {
    if (!newPassword || newPassword !== repeatPassword) {
        return { success: false, message: "Passwords do not match or are empty." };
    }

    const user = await persistence.getUserByResetToken(token);
    if (!user) {
        return { success: false, message: "Invalid or expired reset token." };
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await persistence.updatePassword(user.email, hashedPassword);

    return { success: true, message: "Password reset successful." };
}

/**
 * Creates a new session for a user with a unique session key and stores it in the database.
 */
async function createSession(user) {
    const sessionKey = crypto.randomUUID();
    const sessionData = {
        key: sessionKey,
        userId: user._id,
        created_at: new Date(),
        expiry: new Date(Date.now() + 1000 * 60 * 30)
    };
    await persistence.storeSession(sessionData);
    return sessionKey;
}

/**
 * Retrieves a user object from the database by email.
 */
async function getUserByEmail(email) {
    const db = await connectDB();
    return await db.collection('users').findOne({ email: email.toLowerCase() });
}

/**
 * Calculates estimated request completion time based on queue size and working hours (9am–5pm).
 */
function calculateEstimatedCompletionTime(countInQueue, baseMinutes = 15) {
    const now = new Date();
    let minutesToAdd = countInQueue * baseMinutes;
    let estimated = new Date(now.getTime());

    while (minutesToAdd > 0) {
        let hour = estimated.getHours();
        if (hour >= 9 && hour < 17) {
            estimated.setMinutes(estimated.getMinutes() + 1);
            minutesToAdd--;
        } else {
            estimated.setHours(9, 0, 0, 0);
            estimated.setDate(estimated.getDate() + 1);
        }
    }

    return estimated;
}

/**
 * Creates a student request and calculates an estimated completion time.
 * Inserts the request into the database with default "Pending" status.
 */
async function createRequest(data) {
    const count = await persistence.getPendingCountByCategory(data.category);
    const estimate = calculateEstimatedCompletionTime(count);
    const request = {
        ...data,
        status: "Pending",
        timestamp: new Date(),
        estimatedCompletion: estimate
    };

    await persistence.insertRequest(request);
    return request;
}

/**
 * Updates the request status and adds a note.
 * Intended for HoD or admin processing of student requests.
 */
async function processRequest(requestId, status, note, studentEmail) {
    await persistence.updateRequestStatus(requestId, status, note);
}

/**
 * Retrieves all requests submitted by a student using their email.
 */
async function getRequestsByStudent(email) {
    if (!email) {
        throw new Error('Email is required to fetch student requests.');
    }
    const requests = await persistence.getRequestsByEmail(email);
    return requests;
}

module.exports = {
    registerUser,
    authenticateUser,
    createSession,
    verifyUser,
    getUserByEmail,
    generateResetToken,
    resetPassword,
    createRequest,
    processRequest,
    calculateEstimatedCompletionTime,
    getRequestsByStudent
};
