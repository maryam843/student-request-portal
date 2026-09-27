// Settings of a production server behind an HTTPS proxy; set before the app is loaded
process.env.NODE_ENV = 'production';
process.env.BASE_URL = 'https://portal.example.com/';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, request, DEMO_PASSWORD } = require('./helpers');

let app;

before(async () => {
    ({ app } = await setup());
});

after(teardown);

/**
 * Open a page through the HTTPS proxy (X-Forwarded-Proto: https). The test client does not
 * send Secure cookies over the plain-http test connection, so the cookie is passed by hand.
 * Returns the response, the session cookie and the CSRF token of the page.
 */
async function openPage(path, cookie) {
    const req = request(app).get(path).set('X-Forwarded-Proto', 'https');
    if (cookie) req.set('Cookie', cookie);
    const res = await req;
    const setCookie = (res.headers['set-cookie'] || []).find(c => c.startsWith('connect.sid='));
    return {
        res,
        setCookie,
        cookie: setCookie ? setCookie.split(';')[0] : cookie,
        token: (res.text.match(/name="_csrf" value="([0-9a-f]+)"/) || [])[1]
    };
}

/**
 * Run fn and return what the app printed to the console
 */
async function printed(fn) {
    const lines = [];
    const log = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
        await fn();
    } finally {
        console.log = log;
    }
    return lines.join('\n');
}

test('behind the HTTPS proxy the session cookie is Secure and HSTS is sent', async () => {
    const page = await openPage('/login');
    assert.match(page.setCookie, /; Secure/);
    assert.match(page.setCookie, /HttpOnly/);
    assert.match(page.res.headers['strict-transport-security'], /max-age=/);
    assert.match(page.res.headers['content-security-policy'], /upgrade-insecure-requests/);

    const res = await request(app).post('/login').set('X-Forwarded-Proto', 'https').set('Cookie', page.cookie)
        .type('form').send({ email: 'sara@example.com', password: DEMO_PASSWORD, _csrf: page.token });
    assert.equal(res.headers.location, '/student-dashboard');
    const loginCookie = res.headers['set-cookie'].find(c => c.startsWith('connect.sid='));
    assert.match(loginCookie, /; Secure/);

    const dashboard = await openPage('/student-dashboard', loginCookie.split(';')[0]);
    assert.equal(dashboard.res.status, 200);
});

test('over plain HTTP no session cookie is sent in production', async () => {
    const res = await request(app).get('/login');
    assert.equal(res.headers['set-cookie'], undefined);
});

test('the verification and reset links use BASE_URL', async () => {
    const registerPage = await openPage('/register');
    const out = await printed(async () => {
        const res = await request(app).post('/register').set('X-Forwarded-Proto', 'https').set('Cookie', registerPage.cookie)
            .field('_csrf', registerPage.token).field('name', 'Prod User').field('email', 'prod.user@example.com')
            .field('college', 'IT').field('password', 'Password123').field('confirmPassword', 'Password123');
        assert.equal(res.status, 302);

        const forgotPage = await openPage('/forgot-password');
        await request(app).post('/forgot-password').set('X-Forwarded-Proto', 'https').set('Cookie', forgotPage.cookie)
            .type('form').send({ email: 'sara@example.com', _csrf: forgotPage.token });
    });
    assert.match(out, /Verification link: https:\/\/portal\.example\.com\/verify-email\?token=[0-9a-f]+/);
    assert.match(out, /Reset link: https:\/\/portal\.example\.com\/reset-password\?token=[0-9a-f]{64}/);
});
