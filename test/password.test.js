const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const business = require('../business');
const { setup, teardown, login, register, postForm, request } = require('./helpers');

let app, persistence;

before(async () => {
    ({ app, persistence } = await setup());
});

after(teardown);

test('registering with a password shorter than 8 characters is refused', async () => {
    const res = await register(request.agent(app), { email: 'short@example.com', password: 'Abc@123', confirmPassword: 'Abc@123' });
    assert.equal(res.status, 400);
    assert.match(res.text, /The password must be at least 8 characters long/);
    assert.equal(await persistence.getUserByEmail('short@example.com'), null);
});

test('registering with an 8-character password works', async () => {
    const res = await register(request.agent(app), { email: 'eight@example.com', password: 'Abcd@123', confirmPassword: 'Abcd@123' });
    assert.equal(res.status, 302);
    assert.ok(await persistence.getUserByEmail('eight@example.com'));
});

test('the business layer also refuses a short password', async () => {
    const result = await business.registerUser('Short', 'short2@example.com', 'short', 'short', 'IT', null);
    assert.equal(result, false);
    const reset = await business.resetPassword('any-token', 'short', 'short');
    assert.deepEqual(reset, { success: false, message: business.PASSWORD_TOO_SHORT });
});

test('resetting to a short password is refused and the old password still works', async () => {
    const token = await business.generateResetToken('omar@example.com');
    const agent = request.agent(app);
    const res = await postForm(agent, '/reset-password', { token, password: 'Ab@12', confirmPassword: 'Ab@12' }, '/login');
    assert.equal(res.status, 200);
    assert.match(res.text, /The password must be at least 8 characters long/);

    const { res: loginRes } = await login(app, 'omar@example.com');
    assert.equal(loginRes.headers.location, '/student-dashboard');
});

test('the demo password Demo@1234 still works', async () => {
    const { res } = await login(app, 'hod@example.com', 'Demo@1234');
    assert.equal(res.headers.location, '/admin-dashboard');
});
