const crypto = require('crypto');
const bcrypt = require('bcrypt');
const persistence = require('./persistence');

// bcrypt cost factor: each +1 doubles the time needed to hash (and to guess) a password
const BCRYPT_ROUNDS = 10;

// Shortest password allowed when registering or resetting a password
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_TOO_SHORT = `The password must be at least ${PASSWORD_MIN_LENGTH} characters long.`;

/**
 * Registers a new user after validating inputs, hashing the password with bcrypt,
 * and generating a verification token. Stores the user in the database
 * and returns the verification link.
 */
async function registerUser(username, email, password, repeatPassword, college, profilePic) {
    if (!password || password !== repeatPassword) return false;
    if (password.length < PASSWORD_MIN_LENGTH) return false;

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
        return { success: false, message: "The passwords do not match." };
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
        return { success: false, message: PASSWORD_TOO_SHORT };
    }

    const user = await persistence.getUserByResetToken(token);
    if (!user) {
        return { success: false, message: "Invalid or expired reset link. Please request a new one." };
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await persistence.updatePassword(user.email, hashedPassword);

    return { success: true, message: "Password reset successful." };
}

/**
 * Retrieves a user object from the database by email.
 */
async function getUserByEmail(email) {
    return await persistence.getUserByEmail(email);
}

// Qatar weekend: Friday (5) and Saturday (6) in JavaScript's getDay()
const WEEKEND_DAYS = [5, 6];

/**
 * True between 9am and 5pm, Sunday to Thursday.
 */
function isWorkingTime(date) {
    const hour = date.getHours();
    return !WEEKEND_DAYS.includes(date.getDay()) && hour >= 9 && hour < 17;
}

/**
 * Moves the date to the next 9am (the same day if it is a working day before 9am).
 */
function moveToNextWorkingStart(date) {
    if (!WEEKEND_DAYS.includes(date.getDay()) && date.getHours() < 9) {
        date.setHours(9, 0, 0, 0);
    } else {
        date.setHours(9, 0, 0, 0);
        date.setDate(date.getDate() + 1);
    }
}

/**
 * Calculates estimated request completion time based on queue size and working hours
 * (9am-5pm, Sunday to Thursday). Each request already in the queue adds baseMinutes.
 * Uses the server's local time.
 */
function calculateEstimatedCompletionTime(countInQueue, baseMinutes = 15, now = new Date()) {
    let minutesToAdd = countInQueue * baseMinutes;
    let estimated = new Date(now.getTime());

    // a request sent outside working hours waits until the next working time
    while (!isWorkingTime(estimated)) {
        moveToNextWorkingStart(estimated);
    }

    while (minutesToAdd > 0) {
        if (isWorkingTime(estimated)) {
            estimated.setMinutes(estimated.getMinutes() + 1);
            minutesToAdd--;
        } else {
            moveToNextWorkingStart(estimated);
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
    PASSWORD_MIN_LENGTH,
    PASSWORD_TOO_SHORT,
    registerUser,
    authenticateUser,
    verifyUser,
    getUserByEmail,
    generateResetToken,
    resetPassword,
    createRequest,
    processRequest,
    calculateEstimatedCompletionTime,
    getRequestsByStudent
};
