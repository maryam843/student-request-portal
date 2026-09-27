const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, login, postForm, firstRequest } = require('./helpers');

let app, persistence;

before(async () => {
    ({ app, persistence } = await setup());
});

after(teardown);

test('the Head of Department can approve a pending request with a note', async () => {
    const hod = (await login(app, 'hod@example.com')).agent;
    const pending = await firstRequest(persistence, 'omar@example.com', 'Pending');
    const res = await postForm(hod, `/hod/request/${pending._id}`, { status: 'Approved', note: 'OK' });
    assert.equal(res.status, 302);
    const after = await persistence.getRequestById(String(pending._id));
    assert.equal(after.status, 'Approved');
    assert.equal(after.note, 'OK');
    assert.equal(after.studentNotified, false);
});

test('only Approved or Rejected can be set', async () => {
    const hod = (await login(app, 'hod@example.com')).agent;
    const pending = await firstRequest(persistence, 'lina@example.com', 'Pending');
    for (const status of ['Cancelled', 'Pending', '']) {
        const res = await postForm(hod, `/hod/request/${pending._id}`, { status });
        assert.equal(res.status, 400);
    }
    assert.equal((await persistence.getRequestById(String(pending._id))).status, 'Pending');
});

test('a request the student cancelled cannot be approved afterwards', async () => {
    const student = (await login(app, 'sara@example.com')).agent;
    const hod = (await login(app, 'hod@example.com')).agent;
    const pending = await firstRequest(persistence, 'sara@example.com', 'Pending');

    // the HoD opens the request while it is still pending ...
    const page = await hod.get(`/hod/view/${pending._id}`);
    assert.match(page.text, /Process Request/);

    // ... the student cancels it ...
    await postForm(student, `/student-cancel/${pending._id}`);

    // ... and then the HoD sends the decision
    const res = await postForm(hod, `/hod/request/${pending._id}`, { status: 'Approved', note: 'Too late' });
    assert.equal(res.status, 409);
    assert.match(res.text, /This request was already cancelled, so it was not changed/);

    const after = await persistence.getRequestById(String(pending._id));
    assert.equal(after.status, 'Cancelled');
    assert.equal(after.note, undefined);
});

test('a decided request cannot be decided again', async () => {
    const hod = (await login(app, 'hod@example.com')).agent;
    const approved = await firstRequest(persistence, 'omar@example.com', 'Approved');
    const res = await postForm(hod, `/hod/request/${approved._id}`, { status: 'Rejected', note: 'Changed my mind' });
    assert.equal(res.status, 409);
    assert.equal((await persistence.getRequestById(String(approved._id))).status, 'Approved');
});

test('two decisions sent at the same time: only one is saved', async () => {
    const hod1 = (await login(app, 'hod@example.com')).agent;
    const hod2 = (await login(app, 'hod@example.com')).agent;
    const pending = await firstRequest(persistence, 'lina@example.com', 'Pending');
    const results = await Promise.all([
        postForm(hod1, `/hod/request/${pending._id}`, { status: 'Approved' }),
        postForm(hod2, `/hod/request/${pending._id}`, { status: 'Rejected' })
    ]);
    assert.deepEqual(results.map(r => r.status).sort(), [302, 409]);
});
