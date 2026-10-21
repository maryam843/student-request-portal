const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, login, request } = require('./helpers');

let app;

before(async () => {
    ({ app } = await setup());
});

after(teardown);

test('the 11th wrong login within 15 minutes is refused with 429', async () => {
    for (let i = 1; i <= 10; i++) {
        const { res } = await login(app, 'hod@example.com', 'wrong-password');
        assert.equal(res.status, 302, `try ${i}`);
        assert.match(decodeURIComponent(res.headers.location), /Invalid email or password/, `try ${i}`);
    }

    const { res } = await login(app, 'hod@example.com', 'wrong-password');
    assert.equal(res.status, 429);
    assert.match(res.text, /Too many tries/);

    // the limit is per address, so the right password is also refused until the time is over
    const right = await login(app, 'hod@example.com');
    assert.equal(right.res.status, 429);
    assert.equal((await request(app).get('/login')).status, 200);
});
