const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setup, teardown, login, csrfToken, postForm, firstRequest, request, DEMO_PASSWORD } = require('./helpers');

const UPLOADS = path.join(__dirname, '..', 'uploads');
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let app, persistence;

before(async () => {
    ({ app, persistence } = await setup());
});

after(teardown);

test('every form on the pages has a CSRF token field', async () => {
    const visitor = request.agent(app);
    for (const page of ['/login', '/register', '/forgot-password', '/reset-password?token=abc']) {
        const res = await visitor.get(page);
        const forms = (res.text.match(/<form[^>]*method="POST"/gi) || []).length;
        const tokens = (res.text.match(/name="_csrf" value="[0-9a-f]{64}"/g) || []).length;
        assert.ok(forms > 0, page);
        assert.equal(tokens, forms, page);
    }
});

test('login without a CSRF token is refused (403)', async () => {
    const res = await request(app).post('/login').type('form').send({ email: 'sara@example.com', password: DEMO_PASSWORD });
    assert.equal(res.status, 403);
    assert.match(res.text, /This form has expired/);
});

test('login with a token from another session is refused (403)', async () => {
    const otherToken = await csrfToken(request.agent(app));
    const agent = request.agent(app);
    await agent.get('/login');
    const res = await agent.post('/login').type('form').send({ email: 'sara@example.com', password: DEMO_PASSWORD, _csrf: otherToken });
    assert.equal(res.status, 403);
});

test('cancel, decision and logout without a token are refused and change nothing', async () => {
    const student = (await login(app, 'sara@example.com')).agent;
    const pending = await firstRequest(persistence, 'sara@example.com', 'Pending');

    assert.equal((await student.post(`/student-cancel/${pending._id}`)).status, 403);
    // a multipart form must not skip the check either
    assert.equal((await student.post(`/student-cancel/${pending._id}`).field('x', '1')).status, 403);
    assert.equal((await persistence.getRequestById(String(pending._id))).status, 'Pending');

    const hod = (await login(app, 'hod@example.com')).agent;
    const decide = await hod.post(`/hod/request/${pending._id}`).type('form').send({ status: 'Approved', _csrf: 'wrong' });
    assert.equal(decide.status, 403);
    assert.equal((await persistence.getRequestById(String(pending._id))).status, 'Pending');

    assert.equal((await student.post('/logout')).status, 403);
    assert.equal((await student.get('/student-dashboard')).status, 200);
});

test('a new request without a token is refused', async () => {
    const student = (await login(app, 'omar@example.com')).agent;
    const before = (await persistence.getRequestsByEmail('omar@example.com')).length;
    const res = await student.post('/student-request').type('form')
        .send({ semester: 'Winter 2025', category: 'Attendance', description: 'CSRF test' });
    assert.equal(res.status, 403);
    assert.equal((await persistence.getRequestsByEmail('omar@example.com')).length, before);
});

test('a picture upload without a token is refused and the file is deleted', async () => {
    const filesBefore = fs.readdirSync(UPLOADS).length;
    const student = (await login(app, 'lina@example.com')).agent;
    const res = await student.post('/upload-profile')
        .attach('profilePic', PNG_HEADER, { filename: 'me.png', contentType: 'image/png' });
    assert.equal(res.status, 403);
    assert.equal((await persistence.getUserByEmail('lina@example.com')).profilePic, undefined);
    assert.equal(fs.readdirSync(UPLOADS).length, filesBefore);
});

test('registering without a token is refused', async () => {
    const res = await request(app).post('/register')
        .field('name', 'No Token').field('email', 'notoken@example.com').field('college', 'IT')
        .field('password', 'Password123').field('confirmPassword', 'Password123');
    assert.equal(res.status, 403);
    assert.equal(await persistence.getUserByEmail('notoken@example.com'), null);
});

test('the same forms work with the token', async () => {
    const student = (await login(app, 'lina@example.com')).agent;
    const pending = await firstRequest(persistence, 'lina@example.com', 'Pending');
    const res = await postForm(student, `/student-cancel/${pending._id}`);
    assert.equal(res.status, 302);
    assert.equal((await persistence.getRequestById(String(pending._id))).status, 'Cancelled');
});
