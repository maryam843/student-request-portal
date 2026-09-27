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
    if (loaded) await loaded.sessionStore.close();
    await require('../persistence').closeDB();
    if (mongo) await mongo.stop();
}

/**
 * The CSRF token from the hidden _csrf field of a page the agent opens
 * (default: the login page for visitors, the profile page for logged-in users)
 */
async function csrfToken(agent, page = '/login') {
    const res = await agent.get(page);
    const match = res.text.match(/name="_csrf" value="([0-9a-f]+)"/);
    if (!match) throw new Error(`No CSRF token on ${page} (status ${res.status})`);
    return match[1];
}

/**
 * Send a form like the browser does: open a page to get the CSRF token, then POST with it
 */
async function postForm(agent, url, data = {}, tokenPage = '/profile') {
    const _csrf = await csrfToken(agent, tokenPage);
    return agent.post(url).type('form').send({ ...data, _csrf });
}

/**
 * Log in and return a supertest agent that keeps the session cookie
 */
async function login(app, email, password = DEMO_PASSWORD) {
    const agent = request.agent(app);
    const res = await postForm(agent, '/login', { email, password }, '/login');
    return { agent, res };
}

/**
 * Fill in and send the register form (multipart, like the browser); fields can be
 * changed with overrides, e.g. register(agent, { password: 'short' })
 */
async function register(agent, overrides = {}, picture = null) {
    const fields = {
        name: 'New Student',
        email: 'new.student@example.com',
        college: 'IT',
        password: 'Password123',
        confirmPassword: 'Password123',
        ...overrides
    };
    const _csrf = await csrfToken(agent, '/register');
    let req = agent.post('/register').field('_csrf', _csrf);
    for (const [name, value] of Object.entries(fields)) {
        req = req.field(name, value);
    }
    if (picture) {
        req = req.attach('profilePic', picture.content, { filename: picture.filename, contentType: picture.contentType });
    }
    return req;
}

/**
 * The first request of a student in the demo data, e.g. firstRequest(db, 'sara@example.com', 'Pending')
 */
async function firstRequest(persistence, studentEmail, status) {
    const db = await persistence.connectDB();
    return db.collection('requests').findOne({ studentEmail, status });
}

module.exports = { setup, teardown, login, register, csrfToken, postForm, firstRequest, request, DEMO_PASSWORD };
