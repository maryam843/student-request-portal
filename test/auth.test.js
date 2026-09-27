const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { setup, teardown, login, request, DEMO_PASSWORD } = require('./helpers');

let app, persistence;

before(async () => {
    ({ app, persistence } = await setup());
});

after(teardown);

/**
 * Where a redirect goes, with %20 etc. decoded so the message is readable
 */
function location(res) {
    return decodeURIComponent(res.headers.location);
}

/**
 * The session id from the Set-Cookie header of a response (or null)
 */
function sessionCookie(res) {
    const cookie = (res.headers['set-cookie'] || []).find(c => c.startsWith('connect.sid='));
    return cookie ? cookie.split(';')[0] : null;
}

test('login with the right password opens the dashboard for the account type', async () => {
    const student = await login(app, 'sara@example.com');
    assert.equal(student.res.status, 302);
    assert.equal(student.res.headers.location, '/student-dashboard');
    const page = await student.agent.get('/student-dashboard');
    assert.equal(page.status, 200);
    assert.match(page.text, /Welcome, Sara Demo/);

    const hod = await login(app, 'hod@example.com');
    assert.equal(hod.res.headers.location, '/admin-dashboard');
});

test('login with a wrong password or unknown email fails', async () => {
    const wrong = await login(app, 'sara@example.com', 'wrong-password');
    assert.equal(wrong.res.status, 302);
    assert.match(location(wrong.res), /^\/login\?error=Invalid/);
    assert.equal(sessionCookie(wrong.res), null);

    const unknown = await login(app, 'nobody@example.com');
    assert.match(location(unknown.res), /^\/login\?error=Invalid/);

    const page = await wrong.agent.get('/student-dashboard');
    assert.equal(page.status, 302);
    assert.match(location(page), /^\/login/);
});

test('a user who has not verified the email cannot log in', async () => {
    const db = await persistence.connectDB();
    await db.collection('users').insertOne({
        username: 'Unverified Demo',
        email: 'unverified@example.com',
        passwordHash: await bcrypt.hash(DEMO_PASSWORD, 4),
        accountType: 'student',
        verified: false,
        college: 'IT'
    });

    const { res, agent } = await login(app, 'unverified@example.com');
    assert.match(location(res), /^\/login\?error=Account not verified/);
    const page = await agent.get('/student-dashboard');
    assert.equal(page.status, 302);
});

test('logout deletes the session', async () => {
    const { agent } = await login(app, 'sara@example.com');
    const db = await persistence.connectDB();
    const sessionsBefore = await db.collection('sessions').countDocuments();

    const res = await agent.post('/logout');
    assert.equal(res.status, 302);
    assert.match(location(res), /^\/login\?msg=You have been logged out/);
    assert.equal(await db.collection('sessions').countDocuments(), sessionsBefore - 1);

    const page = await agent.get('/student-dashboard');
    assert.equal(page.status, 302);
    assert.match(location(page), /^\/login/);
});

test('logging in gives a new session id and the old one stops working', async () => {
    const first = await login(app, 'omar@example.com');
    const oldCookie = sessionCookie(first.res);
    assert.ok(oldCookie);

    // log in again in the same browser (same cookie) as another user
    const second = await first.agent.post('/login').type('form').send({ email: 'lina@example.com', password: DEMO_PASSWORD });
    const newCookie = sessionCookie(second);
    assert.ok(newCookie);
    assert.notEqual(newCookie, oldCookie);

    const withOldCookie = await request(app).get('/student-dashboard').set('Cookie', oldCookie);
    assert.equal(withOldCookie.status, 302);
    assert.match(location(withOldCookie), /^\/login/);
});
