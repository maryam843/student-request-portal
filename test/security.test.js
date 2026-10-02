const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, login, firstRequest, request } = require('./helpers');

let app, persistence;

before(async () => {
    ({ app, persistence } = await setup());
});

after(teardown);

test('pages send a Content Security Policy and block framing', async () => {
    const res = await request(app).get('/login');
    const csp = res.headers['content-security-policy'];
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /script-src-attr 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-powered-by'], undefined);
});

/**
 * Inline scripts and event handlers would be blocked by the CSP, so no page may use them
 */
function assertNoInlineScripts(html, path) {
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${path} has an inline <script>`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${path} has an inline event handler`);
    assert.doesNotMatch(html, /\sstyle\s*=/i, `${path} has an inline style`);
}

test('no page uses inline scripts, event handlers or styles', async () => {
    for (const path of ['/login', '/register', '/forgot-password', '/reset-password?token=abc', '/no-such-page']) {
        const res = await request(app).get(path);
        assertNoInlineScripts(res.text, path);
    }

    const pending = await firstRequest(persistence, 'sara@example.com', 'Pending');
    const student = (await login(app, 'sara@example.com')).agent;
    for (const path of ['/student-dashboard', '/student-requests', '/student-request', `/student/request/${pending._id}`, '/profile']) {
        const res = await student.get(path);
        assert.equal(res.status, 200, path);
        assertNoInlineScripts(res.text, path);
    }

    const hod = (await login(app, 'hod@example.com')).agent;
    for (const path of ['/admin-dashboard', '/hod-requests', '/hod/queue/Attendance', `/hod/view/${pending._id}`, '/profile']) {
        const res = await hod.get(path);
        assert.equal(res.status, 200, path);
        assertNoInlineScripts(res.text, path);
    }
});

test('a missing profile photo falls back to the default avatar without inline script', async () => {
    const db = await persistence.connectDB();
    await db.collection('users').updateOne({ email: 'omar@example.com' }, { $set: { profilePic: 'missing.png' } });
    const { agent } = await login(app, 'omar@example.com');
    const res = await agent.get('/profile');
    assert.match(res.text, /src="\/uploads\/missing.png"[^>]*data-fallback="\/img\/avatar-default.svg"/);
    assert.match(res.text, /<script src="\/js\/app.js"><\/script>/);
});

test('outside production the session cookie is httpOnly and SameSite=Lax but not Secure (http://localhost)', async () => {
    const { res } = await login(app, 'sara@example.com');
    const cookie = res.headers['set-cookie'].find(c => c.startsWith('connect.sid='));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.doesNotMatch(cookie, /Secure/);
    assert.equal(res.headers['strict-transport-security'], undefined);
});
