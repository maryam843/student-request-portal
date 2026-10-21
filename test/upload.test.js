const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setup, teardown, login, csrfToken } = require('./helpers');

const UPLOADS = path.join(__dirname, '..', 'uploads');
// the 8 bytes every PNG file starts with
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let app, persistence;
let filesBefore;

before(async () => {
    ({ app, persistence } = await setup());
    filesBefore = new Set(fs.readdirSync(UPLOADS));
});

after(async () => {
    // remove the pictures these tests uploaded
    for (const file of fs.readdirSync(UPLOADS)) {
        if (!filesBefore.has(file)) fs.unlinkSync(path.join(UPLOADS, file));
    }
    await teardown();
});

/**
 * Files in uploads/ that were not there before the tests
 */
function newFiles() {
    return fs.readdirSync(UPLOADS).filter(file => !filesBefore.has(file));
}

async function profilePicOf(email) {
    return (await persistence.getUserByEmail(email)).profilePic;
}

test('a file that is not an image is rejected', async () => {
    const { agent } = await login(app, 'sara@example.com');
    const _csrf = await csrfToken(agent, '/profile');
    const res = await agent.post('/upload-profile')
        .field('_csrf', _csrf)
        .attach('profilePic', Buffer.from('<script>alert(1)</script>'), { filename: 'photo.html', contentType: 'text/html' });
    assert.equal(res.status, 302);

    const page = await agent.get('/profile');
    assert.match(page.text, /Only JPG, PNG or WEBP images are allowed/);
    assert.equal(await profilePicOf('sara@example.com'), undefined);
    assert.deepEqual(newFiles(), []);
});

test('an image with a wrong extension is rejected', async () => {
    const { agent } = await login(app, 'sara@example.com');
    const _csrf = await csrfToken(agent, '/profile');
    await agent.post('/upload-profile')
        .field('_csrf', _csrf)
        .attach('profilePic', PNG_HEADER, { filename: 'photo.svg', contentType: 'image/png' });
    const page = await agent.get('/profile');
    assert.match(page.text, /Only JPG, PNG or WEBP images are allowed/);
    assert.deepEqual(newFiles(), []);
});

test('a text file named x.png with the PNG type is rejected and deleted', async () => {
    const { agent } = await login(app, 'sara@example.com');
    const _csrf = await csrfToken(agent, '/profile');
    const res = await agent.post('/upload-profile')
        .field('_csrf', _csrf)
        .attach('profilePic', Buffer.from('this is plain text, not an image\n'), { filename: 'x.png', contentType: 'image/png' });
    assert.equal(res.status, 302);

    const page = await agent.get('/profile');
    assert.match(page.text, /This file is not a real JPG, PNG or WEBP image/);
    assert.equal(await profilePicOf('sara@example.com'), undefined);
    assert.deepEqual(newFiles(), []);
});

test('a JPEG sent as a PNG and a GIF are rejected', async () => {
    const { agent } = await login(app, 'sara@example.com');
    const files = [
        [Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), 'photo.png', 'image/png', /This file is not a real JPG, PNG or WEBP image/],
        [Buffer.from('GIF89a'), 'photo.gif', 'image/gif', /Only JPG, PNG or WEBP images are allowed/]
    ];
    for (const [content, filename, contentType, message] of files) {
        const _csrf = await csrfToken(agent, '/profile');
        await agent.post('/upload-profile').field('_csrf', _csrf).attach('profilePic', content, { filename, contentType });
        const page = await agent.get('/profile');
        assert.match(page.text, message, filename);
    }
    assert.equal(await profilePicOf('sara@example.com'), undefined);
    assert.deepEqual(newFiles(), []);
});

test('an image larger than 2 MB is rejected', async () => {
    const { agent } = await login(app, 'sara@example.com');
    const _csrf = await csrfToken(agent, '/profile');
    const big = Buffer.concat([PNG_HEADER, Buffer.alloc(2 * 1024 * 1024)]);
    const res = await agent.post('/upload-profile')
        .field('_csrf', _csrf)
        .attach('profilePic', big, { filename: 'big.png', contentType: 'image/png' });
    assert.equal(res.status, 302);

    const page = await agent.get('/profile');
    assert.match(page.text, /The picture must be 2 MB or smaller/);
    assert.equal(await profilePicOf('sara@example.com'), undefined);
    assert.deepEqual(newFiles(), []);
});

test('a small PNG is accepted and saved under a random name', async () => {
    const { agent } = await login(app, 'sara@example.com');
    const _csrf = await csrfToken(agent, '/profile');
    await agent.post('/upload-profile')
        .field('_csrf', _csrf)
        .attach('profilePic', PNG_HEADER, { filename: 'me.png', contentType: 'image/png' });

    const page = await agent.get('/profile');
    assert.match(page.text, /Profile picture updated/);
    const saved = await profilePicOf('sara@example.com');
    assert.match(saved, /^\d+-[0-9a-f]{16}\.png$/);
    assert.deepEqual(newFiles(), [saved]);
});
