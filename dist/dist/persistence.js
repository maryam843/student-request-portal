const { MongoClient } = require("mongodb");

/**
 * MongoDB connection URI and database name.
 */
const uri = process.env.MONGODB_URI;
const dbName = "course_management";

let client;

/**
 * Connects to the MongoDB database.
 * @returns {Promise<Db>} The connected database object.
 */
async function connectDB() {
    if (!client) {
        client = new MongoClient(uri);
        await client.connect();
    }
    return client.db(dbName);
}

/**
 * Validates user credentials by email.
 * @param {string} email - The user's email.
 * @returns {Promise<Object|boolean>} The user object if valid, otherwise false.
 */
async function validateCredentials(email) {
    const db = await connectDB();
    const user = await db.collection('users').findOne({ email });
    return user || false;
}

/**
 * Registers a new user in the database.
 * @param {Object} user - The user object to be stored.
 * @returns {Promise<boolean>} True if registration is successful, false otherwise.
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
 * Retrieves a user by email.
 * @param {string} email - The user's email.
 * @returns {Promise<Object|null>} The user object if found, otherwise null.
 */
async function getUserByEmail(email) {
    const db = await connectDB();
    return await db.collection('users').findOne({ email: email.toLowerCase() });
}


/**
 * Updates user verification status.
 * @param {string} email - The user's email.
 */
async function updateApproval(email) {
    const db = await connectDB();
    await db.collection('users').updateOne(
        { email },
        { $set: { verified: true } }
    );
}

/**
 * Updates or creates a session.
 * @param {Object} sd - Session data.
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
 * Stores a session in the database.
 * @param {Object} session - The session object to be stored.
 */
async function storeSession(session) {
    const db = await connectDB();
    await db.collection('sessions').insertOne(session);
}

/**
 * Retrieves a session by key.
 * @param {string} sessionKey - The session key.
 * @returns {Promise<Object|null>} The session object if found, otherwise null.
 */
async function getSession(sessionKey) {
    const db = await connectDB();
    return await db.collection('sessions').findOne({ key: sessionKey });
}

/**
 * Deletes a session by key.
 * @param {string} sessionKey - The session key to be deleted.
 */
async function deleteSession(sessionKey) {
    const db = await connectDB();
    await db.collection('sessions').deleteOne({ key: sessionKey });
}

/**
 * Verifies a user's token.
 * @param {string} token - The verification token.
 * @returns {Promise<boolean>} True if the user is verified, false otherwise.
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

module.exports = {
    connectDB,
    validateCredentials,
    createRegistration,
    updateApproval,
    updateSession,
    getSession,
    deleteSession,
    getUserByEmail,
    verifyUserToken,
    storeSession
};
