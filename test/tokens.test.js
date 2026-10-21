const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const business = require('../business');
const { setup, teardown, login, register, postForm, request } = require('./helpers');

let app, persistence, db;

before(async () => {
    ({ app, persistence } = await setup());
    db = await persistence.connectDB();
});

after(teardown);

/**
 * Run fn and return the link the app printed to the console instead of e-mailing it
 */
async function printedLink(label, fn) {
    const lines = [];
    const log = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
        await fn();
    } finally {
        console.log = log;
    }
    const match = lines.join('\n').match(new RegExp(`${label}: (\\S+)`));
    assert.ok(match, `no ${label} printed`);
    return new URL(match[1]);
}

/**
 * Open the reset link and set a new password
 */
async function resetWith(token, password) {
    return postForm(request.agent(app), '/reset-password', { token, password, confirmPassword: password }, '/login');
}

// ---- password reset links ----

test('only the SHA-256 hash of the reset token is stored', async () => {
    const link = await printedLink('Reset link', () =>
        postForm(request.agent(app), '/forgot-password', { email: 'sara@example.com' }, '/forgot-password'));
    const token = link.searchParams.get('token');
    assert.match(token, /^[0-9a-f]{64}$/);
    // without BASE_URL the links use localhost and PORT (default 8000)
    assert.equal(link.origin + link.pathname, 'http://localhost:8000/reset-password');

    const user = await db.collection('users').findOne({ email: 'sara@example.com' });
    assert.notEqual(user.resetToken, token);
    assert.equal(user.resetToken, business.hashToken(token));
    const hoursLeft = (user.resetTokenExpires - Date.now()) / 3600000;
    assert.ok(hoursLeft > 0.9 && hoursLeft <= 1, `expires in ${hoursLeft} h`);
});

test('a reset link works once; using it again is refused', async () => {
    const token = await business.generateResetToken('omar@example.com');
    const first = await resetWith(token, 'NewPassword1');
    assert.equal(first.status, 302);
    assert.equal((await login(app, 'omar@example.com', 'NewPassword1')).res.headers.location, '/student-dashboard');

    const again = await resetWith(token, 'OtherPassword2');
    assert.equal(again.status, 200);
    assert.match(again.text, /Invalid or expired reset link/);
    assert.match((await login(app, 'omar@example.com', 'OtherPassword2')).res.headers.location, /error/);
});

test('a wrong reset token, or the stored hash itself, is refused', async () => {
    await business.generateResetToken('lina@example.com');
    const user = await db.collection('users').findOne({ email: 'lina@example.com' });

    for (const token of ['0'.repeat(64), user.resetToken, '']) {
        const res = await resetWith(token, 'NewPassword1');
        assert.match(res.text, /Invalid or expired reset link/);
    }
    assert.equal((await login(app, 'lina@example.com')).res.headers.location, '/student-dashboard');
});

test('an expired reset link is refused', async () => {
    const token = await business.generateResetToken('hod@example.com');
    await db.collection('users').updateOne({ email: 'hod@example.com' }, { $set: { resetTokenExpires: new Date(Date.now() - 1000) } });
    const res = await resetWith(token, 'NewPassword1');
    assert.match(res.text, /Invalid or expired reset link/);
    assert.equal((await login(app, 'hod@example.com')).res.headers.location, '/admin-dashboard');
});

test('a password reset ends the sessions that were open before it', async () => {
    const browser1 = (await login(app, 'sara@example.com')).agent;
    const browser2 = (await login(app, 'sara@example.com')).agent;
    assert.equal((await browser1.get('/student-dashboard')).status, 200);
    assert.equal(await db.collection('sessions').countDocuments({ 'session.user.email': 'sara@example.com' }), 2);

    const token = await business.generateResetToken('sara@example.com');
    const res = await resetWith(token, 'NewPassword1');
    assert.match(decodeURIComponent(res.headers.location), /Password updated/);

    assert.equal(await db.collection('sessions').countDocuments({ 'session.user.email': 'sara@example.com' }), 0);
    for (const browser of [browser1, browser2]) {
        const page = await browser.get('/student-dashboard');
        assert.equal(page.status, 302);
        assert.match(page.headers.location, /^\/login/);
    }
    assert.equal((await login(app, 'sara@example.com', 'NewPassword1')).res.headers.location, '/student-dashboard');
});

// ---- e-mail verification links ----

/**
 * Register a new account and return the token from the printed verification link
 */
async function registerAndGetToken(email) {
    const link = await printedLink('Verification link', () => register(request.agent(app), { email }));
    return link.searchParams.get('token');
}

test('a verification link expires after 24 hours and works once', async () => {
    const token = await registerAndGetToken('verify.once@example.com');
    const user = await db.collection('users').findOne({ email: 'verify.once@example.com' });
    const hoursLeft = (user.verificationTokenExpires - Date.now()) / 3600000;
    assert.ok(hoursLeft > 23.9 && hoursLeft <= 24, `expires in ${hoursLeft} h`);

    const first = await request(app).get(`/verify-email?token=${token}`);
    assert.match(decodeURIComponent(first.headers.location), /Email verified/);
    const verified = await db.collection('users').findOne({ email: 'verify.once@example.com' });
    assert.equal(verified.verified, true);
    assert.equal(verified.verificationToken, undefined);

    const again = await request(app).get(`/verify-email?token=${token}`);
    assert.match(decodeURIComponent(again.headers.location), /invalid, has expired or has already been used/);
});

test('an expired verification link is refused and the account stays unverified', async () => {
    const token = await registerAndGetToken('verify.late@example.com');
    await db.collection('users').updateOne({ email: 'verify.late@example.com' },
        { $set: { verificationTokenExpires: new Date(Date.now() - 1000) } });

    const res = await request(app).get(`/verify-email?token=${token}`);
    assert.match(decodeURIComponent(res.headers.location), /invalid, has expired/);
    assert.equal((await db.collection('users').findOne({ email: 'verify.late@example.com' })).verified, false);
});

test('a wrong verification token is refused', async () => {
    await registerAndGetToken('verify.wrong@example.com');
    for (const token of ['nope', '0'.repeat(40)]) {
        const res = await request(app).get(`/verify-email?token=${token}`);
        assert.match(decodeURIComponent(res.headers.location), /invalid/);
    }
    // query operators are not accepted as a token
    const res = await request(app).get('/verify-email?token[$ne]=x');
    assert.match(decodeURIComponent(res.headers.location), /invalid/);
    assert.equal((await db.collection('users').findOne({ email: 'verify.wrong@example.com' })).verified, false);
});
