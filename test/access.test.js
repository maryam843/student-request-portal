const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, login, firstRequest } = require('./helpers');

let app, persistence;

before(async () => {
    ({ app, persistence } = await setup());
});

after(teardown);

test('pages for logged-in users send visitors to the login page', async () => {
    const { request } = require('./helpers');
    for (const path of ['/student-dashboard', '/admin-dashboard', '/hod-requests', '/student-requests', '/profile']) {
        const res = await request(app).get(path);
        assert.equal(res.status, 302, path);
        assert.match(res.headers.location, /^\/login/, path);
    }
});

test('a student cannot open the Head of Department pages', async () => {
    const { agent } = await login(app, 'sara@example.com');
    const pending = await firstRequest(persistence, 'omar@example.com', 'Pending');
    for (const path of ['/admin-dashboard', '/hod-requests', '/hod/queue/Attendance', `/hod/view/${pending._id}`, '/hod/random']) {
        const res = await agent.get(path);
        assert.equal(res.status, 403, path);
    }

    const decide = await agent.post(`/hod/request/${pending._id}`).type('form').send({ status: 'Approved', note: '' });
    assert.equal(decide.status, 403);
    const after = await persistence.getRequestById(String(pending._id));
    assert.equal(after.status, 'Pending');
});

test('the Head of Department cannot open the student pages', async () => {
    const { agent } = await login(app, 'hod@example.com');
    const pending = await firstRequest(persistence, 'sara@example.com', 'Pending');
    for (const path of ['/student-dashboard', '/student-requests', '/student-request', `/student/request/${pending._id}`]) {
        const res = await agent.get(path);
        assert.equal(res.status, 403, path);
    }
    const cancel = await agent.post(`/student-cancel/${pending._id}`);
    assert.equal(cancel.status, 403);
});

test("a student cannot open or cancel another student's request", async () => {
    const { agent } = await login(app, 'sara@example.com');
    const omars = await firstRequest(persistence, 'omar@example.com', 'Pending');

    const view = await agent.get(`/student/request/${omars._id}`);
    assert.equal(view.status, 404);
    assert.doesNotMatch(view.text, new RegExp(omars.description));

    await agent.post(`/student-cancel/${omars._id}`);
    const after = await persistence.getRequestById(String(omars._id));
    assert.equal(after.status, 'Pending');
});

test('a student can open and cancel their own pending request', async () => {
    const { agent } = await login(app, 'lina@example.com');
    const own = await firstRequest(persistence, 'lina@example.com', 'Pending');

    const view = await agent.get(`/student/request/${own._id}`);
    assert.equal(view.status, 200);

    const cancel = await agent.post(`/student-cancel/${own._id}`);
    assert.equal(cancel.status, 302);
    const after = await persistence.getRequestById(String(own._id));
    assert.equal(after.status, 'Cancelled');
});

test('an invalid request id shows "not found" (404), not a server error', async () => {
    const student = (await login(app, 'sara@example.com')).agent;
    const hod = (await login(app, 'hod@example.com')).agent;

    assert.equal((await student.get('/student/request/not-an-id')).status, 404);
    assert.equal((await student.post('/student-cancel/not-an-id')).status, 404);
    assert.equal((await hod.get('/hod/view/not-an-id')).status, 404);
    assert.equal((await hod.post('/hod/request/not-an-id').type('form').send({ status: 'Approved' })).status, 404);
    // a valid id that does not exist
    assert.equal((await hod.get('/hod/view/0123456789abcdef01234567')).status, 404);
});
