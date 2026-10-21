const crypto = require('crypto');
const bcrypt = require('bcrypt');
const persistence = require('./persistence');

// bcrypt cost factor: each +1 doubles the time needed to hash (and to guess) a password
const BCRYPT_ROUNDS = 10;

// Shortest password allowed when registering or resetting a password
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_TOO_SHORT = `The password must be at least ${PASSWORD_MIN_LENGTH} characters long.`;

// A verification link works for 24 hours, a password reset link for 1 hour
const VERIFICATION_TOKEN_HOURS = 24;
const RESET_TOKEN_HOURS = 1;

/**
 * SHA-256 of a token. Only the hash of a reset or verification token is stored, so someone
 * who can read the database (or a backup) cannot use the links that are still valid.
 */
function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Registers a new user after validating inputs, hashing the password with bcrypt,
 * and generating a verification token. Stores the user in the database
 * and returns the email and the verification token (app.js builds the link).
 */
async function registerUser(username, email, password, repeatPassword, college, profilePic) {
    if (!password || password !== repeatPassword) return false;
    if (password.length < PASSWORD_MIN_LENGTH) return false;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return false;

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
            // the link gets the token, the database only its hash
            verificationToken: hashToken(verificationToken),
            verificationTokenExpires: new Date(Date.now() + VERIFICATION_TOKEN_HOURS * 60 * 60 * 1000),
            college,
            profilePic
        };

        // fails (false) if the email is already registered: users.email has a unique index
        const created = await persistence.createRegistration(newUser);
        if (!created) return false;

        return {
            email,
            verificationToken
        };
    } catch (error) {
        return false;
    }
}

/**
 * Verifies a user by matching the hash of the verification token with a stored record
 * (only if the link is not older than 24 hours).
 */
async function verifyUser(token) {
    return await persistence.verifyUserToken(hashToken(token));
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
    const expiresAt = new Date(Date.now() + RESET_TOKEN_HOURS * 60 * 60 * 1000);
    // the link gets the token, the database only its hash
    await persistence.storeResetToken(email, hashToken(token), expiresAt);

    return token;
}

/**
 * Resets a user's password using a valid token. Hashes and stores the new password
 * and deletes all login sessions of the user.
 * Returns { success, message } so the caller can show the right message.
 */
async function resetPassword(token, newPassword, repeatPassword) {
    if (!newPassword || newPassword !== repeatPassword) {
        return { success: false, message: "The passwords do not match." };
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
        return { success: false, message: PASSWORD_TOO_SHORT };
    }

    const user = token ? await persistence.getUserByResetToken(hashToken(token)) : null;
    if (!user) {
        return { success: false, message: "Invalid or expired reset link. Please request a new one." };
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await persistence.updatePassword(user.email, hashedPassword);
    // log the user out everywhere; the reset page then sends them to the login page
    await persistence.deleteSessionsOfUser(user.email);

    return { success: true, message: "Password reset successful." };
}

/**
 * Retrieves a user object from the database by email.
 */
async function getUserByEmail(email) {
    return await persistence.getUserByEmail(email);
}

/**
 * The semesters students can choose and the HoD can filter by: from two years ago to next
 * year, in the order they happen, e.g. in 2026: "Winter 2024", "Spring 2024", "Fall 2024", ..., "Fall 2027".
 */
function semesterList(year = new Date().getFullYear()) {
    const semesters = [];
    for (let y = year - 2; y <= year + 1; y++) {
        semesters.push(`Winter ${y}`, `Spring ${y}`, `Fall ${y}`);
    }
    return semesters;
}

// Working hours are Qatar time, whatever the time zone of the server
const TIME_ZONE = 'Asia/Qatar';
// Qatar weekend: Friday (5) and Saturday (6), counted like JavaScript's getDay()
const WEEKEND_DAYS = [5, 6];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const qatarFormat = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
});

/**
 * The date and time of a moment in Qatar, e.g. { year: 2025, month: 1, day: 5, hour: 9, weekday: 0, ... }
 */
function qatarTime(date) {
    const parts = Object.fromEntries(qatarFormat.formatToParts(date).map(p => [p.type, p.value]));
    return {
        year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
        hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
        weekday: WEEKDAYS.indexOf(parts.weekday)
    };
}

/**
 * The moment when the clock in Qatar shows this date and time (month 1 = January;
 * a day past the end of the month moves to the next month, like Date.UTC)
 */
function fromQatarTime(year, month, day, hour, minute = 0) {
    const asUtc = Date.UTC(year, month - 1, day, hour, minute);
    const shown = qatarTime(new Date(asUtc));
    const offset = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute) - asUtc;
    return new Date(asUtc - offset);
}

/**
 * True between 9am and 5pm Qatar time, Sunday to Thursday.
 */
function isWorkingTime(date) {
    const { hour, weekday } = qatarTime(date);
    return !WEEKEND_DAYS.includes(weekday) && hour >= 9 && hour < 17;
}

/**
 * The next 9am in Qatar (the same day if it is a working day before 9am).
 */
function nextWorkingStart(date) {
    const t = qatarTime(date);
    const sameDay = !WEEKEND_DAYS.includes(t.weekday) && t.hour < 9;
    return fromQatarTime(t.year, t.month, sameDay ? t.day : t.day + 1, 9);
}

/**
 * Calculates estimated request completion time based on queue size and working hours
 * (9am-5pm Qatar time, Sunday to Thursday). Each request already in the queue adds baseMinutes.
 */
function calculateEstimatedCompletionTime(countInQueue, baseMinutes = 15, now = new Date()) {
    let minutesToAdd = countInQueue * baseMinutes;
    let estimated = new Date(now.getTime());

    // a request sent outside working hours waits until the next working time
    while (!isWorkingTime(estimated)) {
        estimated = nextWorkingStart(estimated);
    }

    while (minutesToAdd > 0) {
        if (isWorkingTime(estimated)) {
            estimated = new Date(estimated.getTime() + 60 * 1000);
            minutesToAdd--;
        } else {
            estimated = nextWorkingStart(estimated);
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
 * Updates the request status and adds a note (Head of Department decision).
 * Returns false if the request was no longer Pending (already cancelled or decided).
 */
async function processRequest(requestId, status, note) {
    const result = await persistence.updateRequestStatus(requestId, status, note);
    return result.matchedCount === 1;
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
    TIME_ZONE,
    hashToken,
    registerUser,
    authenticateUser,
    verifyUser,
    getUserByEmail,
    generateResetToken,
    resetPassword,
    createRequest,
    processRequest,
    semesterList,
    calculateEstimatedCompletionTime,
    getRequestsByStudent
};
