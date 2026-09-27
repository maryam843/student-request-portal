/**
 * Shared setup for the tests: a temporary in-memory MongoDB with the demo data
 * from scripts/seed.js, and the app loaded without starting the server.
 * Each test file runs in its own process, so each file gets its own database.
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');

const DEMO_PASSWORD = 'Demo@1234';

let mongo;
let loaded;

/**
 * Start MongoDB, add the demo data and load the app
 */
async function setup() {
    mongo = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongo.getUri();
    process.env.SESSION_SECRET = 'test-session-secret';

    const persistence = require('../persistence');
    const { seed } = require('../scripts/seed');
    // seed() prints the demo logins; keep the test output short
    const log = console.log;
    console.log = () => {};
    try {
        await seed();
    } finally {
        console.log = log;
    }
    await persistence.createIndexes();

    loaded = require('../app');
    return { app: loaded.app, persistence };
}

/**
 * Close the database connections and stop MongoDB, so the test process can end
 */
async function teardown() {
    await loaded.sessionStore.close();
    await require('../persistence').closeDB();
    await mongo.stop();
}

/**
 * Log in and return a supertest agent that keeps the session cookie
 */
async function login(app, email, password = DEMO_PASSWORD) {
    const agent = request.agent(app);
    const res = await agent.post('/login').type('form').send({ email, password });
    return { agent, res };
}

/**
 * The first request of a student in the demo data, e.g. firstRequest(db, 'sara@example.com', 'Pending')
 */
async function firstRequest(persistence, studentEmail, status) {
    const db = await persistence.connectDB();
    return db.collection('requests').findOne({ studentEmail, status });
}

module.exports = { setup, teardown, login, firstRequest, request, DEMO_PASSWORD };
