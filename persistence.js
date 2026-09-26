const { MongoClient, ObjectId } = require("mongodb");
const uri = process.env.MONGODB_URI;
const dbName = "course_management";
let client;

/**
 * Establishes a connection to the database.
 * @returns {Promise} Resolves with the database client.
 */
async function connectDB() {
    if (!client) {
        if (!uri) {
            throw new Error("MONGODB_URI is not set. Copy .env.example to .env and fill it in.");
        }
        client = new MongoClient(uri);
        await client.connect();
    }
    return client.db(dbName);
}

/**
 * Checks that an id from a link is a real MongoDB id (24 hex characters)
 * before it is used in a query.
 * @param {string} id - The id to check.
 * @returns {boolean} True if the id can be used.
 */
function isValidId(id) {
    return typeof id === 'string' && /^[0-9a-f]{24}$/i.test(id);
}

/**
 * Validates user credentials by email.
 * @param {string} email - The email of the user to validate.
 * @returns {Promise} Resolves with user data or false if not found.
 */
async function validateCredentials(email) {
    const db = await connectDB();
    const user = await db.collection('users').findOne({ email });
    return user || false;
}

/**
 * Registers a new user.
 * @param {Object} user - The user data to insert.
 * @returns {Promise} Resolves with true if inserted successfully, otherwise false.
 */
async function createRegistration(user) {
    try {
        const db = await connectDB();
        const result = await db.collection('users').insertOne(user);
        return result.acknowledged && result.insertedId ? true : false;
    } catch {
        return false;
    }
}

/**
 * Fetches user data by email.
 * @param {string} email - The email of the user to fetch.
 * @returns {Promise} Resolves with the user data.
 */
async function getUserByEmail(email) {
    const db = await connectDB();
    return await db.collection('users').findOne({ email: email.toLowerCase() });
}

/**
 * Stores a password reset token for a user.
 * @param {string} email - The email of the user.
 * @param {string} token - The reset token.
 * @param {Date} expiresAt - The expiration date of the token.
 * @returns {Promise} Resolves once the token is stored.
 */
async function storeResetToken(email, token, expiresAt) {
    const db = await connectDB();
    await db.collection('users').updateOne(
      { email },
      {
        $set: {
          resetToken: token,
          resetTokenExpires: expiresAt,
        },
      }
    );
}

/**
 * Updates user approval status.
 * @param {string} email - The email of the user.
 * @returns {Promise} Resolves once the approval status is updated.
 */
async function updateApproval(email) {
    const db = await connectDB();
    await db.collection('users').updateOne(
        { email },
        { $set: { verified: true } }
    );
}

/**
 * Updates a session or creates a new one.
 * @param {Object} sd - Session data.
 * @returns {Promise} Resolves once the session is updated or created.
 */
async function updateSession(sd) {
    const db = await connectDB();
    await db.collection('sessions').deleteMany({
        expires_at: { $lt: new Date() }
    });
    const existingSession = await db.collection('sessions').findOne({ key: sd.key });
    if (existingSession) {
        await db.collection('sessions').updateOne(
            { key: sd.key },
            { $set: { data: sd.data, expires_at: new Date(sd.expiry) } }
        );
    } else {
        await db.collection('sessions').insertOne({
            key: sd.key,
            data: sd.data,
            expires_at: new Date(sd.expiry)
        });
    }
}

/**
 * Stores a new session.
 * @param {Object} session - The session data to store.
 * @returns {Promise} Resolves once the session is stored.
 */
async function storeSession(session) {
    const db = await connectDB();
    await db.collection('sessions').insertOne(session);
}

/**
 * Fetches a session by its key.
 * @param {string} sessionKey - The key of the session to fetch.
 * @returns {Promise} Resolves with the session data.
 */
async function getSession(sessionKey) {
    const db = await connectDB();
    return await db.collection('sessions').findOne({ key: sessionKey });
}

/**
 * Deletes a session by its key.
 * @param {string} sessionKey - The key of the session to delete.
 * @returns {Promise} Resolves once the session is deleted.
 */
async function deleteSession(sessionKey) {
    const db = await connectDB();
    await db.collection('sessions').deleteOne({ key: sessionKey });
}

/**
 * Verifies a user token and updates the user as verified.
 * @param {string} token - The token to verify.
 * @returns {Promise} Resolves with true if successful, otherwise false.
 */
async function verifyUserToken(token) {
    try {
        const db = await connectDB();
        const user = await db.collection('users').findOne({ verificationToken: token });
        if (!user) return false;
        await db.collection('users').updateOne(
            { verificationToken: token },
            { $set: { verified: true }, $unset: { verificationToken: "" } }
        );
        return true;
    } catch {
        return false;
    }
}

/**
 * Fetches student data by email.
 * @param {string} email - The email of the student to fetch.
 * @returns {Promise} Resolves with the student data.
 */
async function getStudentByEmail(email) {
    const db = await connectDB();
    return await db.collection("users").findOne({ email: email });
}

/**
 * Updates the user's password.
 * @param {string} email - The email of the user.
 * @param {string} passwordHash - The new bcrypt password hash.
 * @returns {Promise} Resolves once the password is updated.
 */
async function updatePassword(email, passwordHash) {
    const db = await connectDB();
    await db.collection('users').updateOne(
        { email: email },
        {
            $set: {
                passwordHash: passwordHash
            },
            $unset: {
                salt: "",
                resetToken: "",
                resetTokenExpires: ""
            }
        }
    );
}

/**
 * Inserts a new request.
 * @param {Object} request - The request data to insert.
 * @returns {Promise} Resolves with the insert result.
 */
async function insertRequest(request) {
    const db = await connectDB();
    return await db.collection("requests").insertOne(request);
}

/**
 * Fetches all requests for a student by email.
 * @param {string} email - The email of the student.
 * @returns {Promise} Resolves with an array of requests.
 */
async function getRequestsByStudent(email) {
    const db = await connectDB();
    return await db.collection("requests").find({ studentEmail: email }).toArray();
}

/**
 * Fetches requests filtered by semester for a student.
 * @param {string} email - The email of the student.
 * @param {string} semester - The semester to filter by.
 * @returns {Promise} Resolves with an array of requests.
 */
async function getRequestsBySemester(email, semester) {
    const db = await connectDB();
    return await db.collection("requests").find({ studentEmail: email, semester }).toArray();
}

/**
 * Cancels a request by its ID and student email.
 * @param {string} requestId - The ID of the request to cancel.
 * @param {string} email - The email of the student.
 * @returns {Promise} Resolves with the update result.
 */
async function cancelRequestById(requestId, email) {
    const db = await connectDB();
    return await db.collection("requests").updateOne(
        { _id: new ObjectId(requestId), studentEmail: email, status: "Pending" },
        { $set: { status: "Cancelled" } }
    );
}

/**
 * Gets the count of pending requests by category.
 * @param {string} category - The category of the requests.
 * @returns {Promise} Resolves with the count of pending requests.
 */
async function getPendingCountByCategory(category) {
    const db = await connectDB();
    return await db.collection("requests").countDocuments({ category, status: "Pending" });
}

/**
 * Fetches all queues and their counts.
 * @param {Object} filter - The filter to apply to the requests.
 * @returns {Promise} Resolves with an array of queue counts.
 */
async function getQueuesWithCounts(filter = { status: 'Pending' }) {
    const db = await connectDB();
    const matchStage = { $match: filter };
    return await db.collection("requests").aggregate([
        matchStage,
        {
            $group: {
                _id: "$category",
                count: { $sum: 1 }
            }
        },
        { $sort: { _id: 1 } }
    ]).toArray();
}

/**
 * Fetches requests by category.
 * @param {string} category - The category of the requests.
 * @returns {Promise} Resolves with an array of requests.
 */
async function getRequestsByCategory(category) {
    const db = await connectDB();
    return await db.collection("requests").find({ category, status: "Pending" }).sort({ timestamp: 1 }).toArray();
}

/**
 * Fetches a single request by its ID.
 * @param {string} requestId - The ID of the request.
 * @returns {Promise} Resolves with the request data.
 */
async function getRequestById(requestId) {
    const db = await connectDB();
    return await db.collection("requests").findOne({ _id: new ObjectId(requestId) });
}

/**
 * Resolves or rejects a request.
 * @param {string} id - The ID of the request.
 * @param {string} status - The status to update to.
 * @param {string} note - The note to include.
 * @returns {Promise} Resolves with the update result.
 */
async function updateRequestStatus(id, status, note) {
    const db = await connectDB();
    return await db.collection("requests").updateOne(
        { _id: new ObjectId(id) },
        { $set: { status, note, resolvedAt: new Date(), studentNotified: false } }
    );
}

/**
 * Fetches a random pending request.
 * @returns {Promise} Resolves with the random request data.
 */
async function getRandomPendingRequest() {
    const db = await connectDB();
    const result = await db.collection("requests").aggregate([
        { $match: { status: "Pending" } },
        { $sample: { size: 1 } }
    ]).toArray();
    return result[0] || null;
}

/**
 * Fetches requests by student email.
 * @param {string} email - The email of the student.
 * @returns {Promise} Resolves with an array of requests.
 */
async function getRequestsByEmail(email) {
    const db = await connectDB();
    const collection = db.collection('requests');
    const requests = await collection.find({ studentEmail: email }).toArray();
    return requests;
}

/**
 * Fetches a student's name by their email.
 * @param {string} email - The email of the student.
 * @returns {Promise} Resolves with the student's name or "Unknown Student".
 */
async function getStudentNameByEmail(email) {
    const db = await connectDB();
    const user = await db.collection("users").findOne({ email });
    return user?.username || "Unknown Student";
}

/**
 * Fetches requests with a filter.
 * @param {Object} filter - The filter to apply to the requests.
 * @returns {Promise} Resolves with an array of requests.
 */
async function getRequests(filter = {}) {
    const db = await connectDB();
    return await db.collection("requests").find(filter).toArray();
}

/**
 * Marks a request as notified.
 * @param {string} requestId - The ID of the request to mark.
 * @returns {Promise} Resolves once the request is marked as notified.
 */
async function markRequestAsNotified(requestId) {
    const db = await connectDB();
    await db.collection("requests").updateOne(
        { _id: new ObjectId(requestId) },
        { $set: { studentNotified: true } }
    );
}

/**
 * Fetches all queues with their total and pending counts.
 * @returns {Promise} Resolves with the queue counts.
 */
async function getQueuesWithCountsOut() {
    const db = await connectDB();
    return await db.collection("requests").aggregate([
        {
            $group: {
                _id: "$category",
                total: { $sum: 1 },
                pending: {
                    $sum: {
                        $cond: [{ $eq: ["$status", "Pending"] }, 1, 0]
                    }
                }
            }
        },
        { $sort: { _id: 1 } }
    ]).toArray();
}

module.exports = {
    dbName,
    connectDB,
    isValidId,
    validateCredentials,
    createRegistration,
    updateApproval,
    updateSession,
    getSession,
    deleteSession,
    getUserByEmail,
    verifyUserToken,
    storeSession,
    storeResetToken,
    insertRequest,
    updatePassword,
    getRequests,
    getRequestsByStudent,
    getRequestsBySemester,
    cancelRequestById,
    getPendingCountByCategory,
    getQueuesWithCounts,
    getRequestsByCategory,
    getRequestById,
    updateRequestStatus,
    getRandomPendingRequest,
    getRequestsByEmail,
    getStudentNameByEmail,
    markRequestAsNotified,
    getQueuesWithCountsOut,
    getStudentByEmail
};
