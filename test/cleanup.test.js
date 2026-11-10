const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const business = require('../business');
const { setup, teardown, login, register, csrfToken, postForm, request } = require('./helpers');

const UPLOADS = path.join(__dirname, '..', 'uploads');
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PICTURE = { content: PNG_HEADER, filename: 'me.png', contentType: 'image/png' };

let app, persistence;
let filesBefore;

before(async () => {
    ({ app, persistence } = await setup());
    filesBefore = new Set(fs.readdirSync(UPLOADS));
});

after(async () => {
    for (const file of newFiles()) fs.unlinkSync(path.join(UPLOADS, file));
    await teardown();
});

function newFiles() {
    return fs.readdirSync(UPLOADS).filter(file => !filesBefore.has(file));
}

/**
 * Register quietly (the app prints the verification link)
 */
async function quietRegister(overrides, picture) {
    const log = console.log;
    console.log = () => {};
    try {
        return await register(request.agent(app), overrides, picture);
    } finally {
        console.log = log;
    }
}

test('a failed registration deletes the uploaded picture', async () => {
    const mismatch = await quietRegister({ email: 'fail1@example.com', confirmPassword: 'Different123' }, PICTURE);
    assert.equal(mismatch.status, 400);
    assert.match(mismatch.text, /The passwords do not match/);

    // an email that is already registered gets the normal answer, but no account and no picture
    const taken = await quietRegister({ email: 'sara@example.com' }, PICTURE);
    assert.equal(taken.status, 302);

    // the email check is case-insensitive
    const takenUpper = await quietRegister({ email: 'SARA@example.com' }, PICTURE);
    assert.equal(takenUpper.status, 302);
    assert.equal(await persistence.getUserByEmail('sara@example.com').then(u => u.username), 'Sara Demo');

    // give the async file deletes a moment
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(newFiles(), []);
});

test('a successful registration keeps the picture', async () => {
    const res = await quietRegister({ email: 'withpic@example.com' }, PICTURE);
    assert.equal(res.status, 302);
    const user = await persistence.getUserByEmail('withpic@example.com');
    assert.deepEqual(newFiles(), [user.profilePic]);
    fs.unlinkSync(path.join(UPLOADS, user.profilePic));
});

test('a college that is not in the list is refused', async () => {
    for (const college of ['Hacking', '', 'IT ']) {
        const res = await quietRegister({ email: 'college@example.com', college });
        assert.equal(res.status, 400, college);
        assert.match(res.text, /Please choose a college from the list/);
    }
    assert.equal(await persistence.getUserByEmail('college@example.com'), null);
});

test('registering the same email twice is caught by the unique index too', async () => {
    const first = await business.registerUser('Twice', 'twice@example.com', 'Password123', 'Password123', 'IT', null);
    assert.ok(first);
    const second = await business.registerUser('Twice', 'twice@example.com', 'Password123', 'Password123', 'IT', null);
    assert.equal(second, false);
});

test('the requests collection has the indexes the student pages and HoD queues use', async () => {
    const db = await persistence.connectDB();
    const keys = (await db.collection('requests').indexes()).map(index => JSON.stringify(index.key));
    assert.ok(keys.includes(JSON.stringify({ studentEmail: 1, status: 1 })), keys.join(' '));
    assert.ok(keys.includes(JSON.stringify({ status: 1, category: 1 })), keys.join(' '));

    // the HoD queue query is answered from the index, not by reading every request
    const plan = await db.collection('requests').find({ category: 'Attendance', status: 'Pending' }).explain();
    assert.match(JSON.stringify(plan.queryPlanner.winningPlan), /IXSCAN/);
});

test('registering a used email answers exactly like a new one and e-mails the owner instead', async () => {
    const printed = [];
    const log = console.log;
    console.log = (...args) => printed.push(args.join(' '));
    let fresh, taken;
    try {
        fresh = await register(request.agent(app), { email: 'brand.new@example.com' });
        taken = await register(request.agent(app), { email: 'omar@example.com' });
    } finally {
        console.log = log;
    }
    assert.equal(fresh.status, 302);
    assert.equal(taken.status, fresh.status);
    assert.equal(taken.headers.location, fresh.headers.location);
    assert.equal(taken.text, fresh.text);
    assert.match(decodeURIComponent(taken.headers.location), /Account created/);

    const output = printed.join('\n');
    assert.match(output, /Email to brand\.new@example\.com\nVerification link: /);
    assert.match(output, /Email to omar@example\.com\nYou already have an account\. Log in, or reset your password here: .*\/forgot-password/);
    // the existing account is unchanged and not marked unverified
    const omar = await persistence.getUserByEmail('omar@example.com');
    assert.equal(omar.username, 'Omar Demo');
    assert.equal(omar.verified, true);
});

test('a database error while registering is logged and shown as a general error', async () => {
    const { Collection } = require('mongodb');
    const insertOne = Collection.prototype.insertOne;
    const logged = [];
    const consoleError = console.error;
    // any error that is not a duplicate email (code 11000), e.g. the database is not reachable
    Collection.prototype.insertOne = async () => { throw Object.assign(new Error('database not reachable'), { code: 6 }); };
    console.error = (...args) => logged.push(args.join(' '));
    let res;
    try {
        await assert.rejects(business.registerUser('Down', 'down@example.com', 'Password123', 'Password123', 'IT', null), /database not reachable/);
        res = await register(request.agent(app), { email: 'down@example.com' });
    } finally {
        Collection.prototype.insertOne = insertOne;
        console.error = consoleError;
    }
    assert.match(res.text, /Something went wrong. Please try again/);
    assert.doesNotMatch(res.text, /already/);
    assert.ok(logged.some(line => /database not reachable/.test(line)), 'the error is logged');
    assert.equal(await persistence.getUserByEmail('down@example.com'), null);
});

test('a new profile picture deletes the old file', async () => {
    const { agent } = await login(app, 'omar@example.com');
    const upload = async () => {
        const _csrf = await csrfToken(agent, '/profile');
        await agent.post('/upload-profile').field('_csrf', _csrf).attach('profilePic', PNG_HEADER, { filename: 'me.png', contentType: 'image/png' });
        return (await persistence.getUserByEmail('omar@example.com')).profilePic;
    };
    const first = await upload();
    // file names start with the time in ms; make sure the second one is different
    await new Promise(resolve => setTimeout(resolve, 5));
    const second = await upload();
    assert.notEqual(first, second);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(newFiles(), [second]);
});

test('the semesters are generated from the current year', () => {
    assert.deepEqual(business.semesterList(2026), [
        'Winter 2024', 'Spring 2024', 'Fall 2024',
        'Winter 2025', 'Spring 2025', 'Fall 2025',
        'Winter 2026', 'Spring 2026', 'Fall 2026',
        'Winter 2027', 'Spring 2027', 'Fall 2027'
    ]);
});

test('the demo data only uses semesters the form offers this year', async () => {
    const db = await persistence.connectDB();
    const semesters = await db.collection('requests').distinct('semester');
    const year = new Date().getFullYear();
    assert.deepEqual(semesters.sort(), [`Fall ${year - 2}`, `Spring ${year - 1}`, `Winter ${year - 1}`]);
    for (const semester of semesters) {
        assert.ok(business.semesterList().includes(semester), semester);
    }
});

test('the request form offers this year and refuses unknown semesters', async () => {
    const year = new Date().getFullYear();
    const { agent } = await login(app, 'lina@example.com');
    const form = await agent.get('/student-request');
    assert.match(form.text, new RegExp(`value="Fall ${year}"`));
    assert.match(form.text, new RegExp(`value="Winter ${year + 1}"`));

    const res = await postForm(agent, '/student-request', { semester: 'Fall 1999', category: 'Attendance', description: 'Old semester' });
    assert.equal(res.status, 400);
    const ok = await postForm(agent, '/student-request', { semester: `Fall ${year}`, category: 'Attendance', description: 'This year' });
    assert.equal(ok.status, 302);
});

test('SimpleBar and the old icon images are gone; the pages use CoreUI icons', async () => {
    for (const file of ['/vendors/simplebar/js/simplebar.min.js', '/css/vendors/simplebar.css', '/img/icons/college.jpeg', '/img/icons/profile.png']) {
        assert.equal((await request(app).get(file)).status, 404, file);
    }
    const registerPage = await request(app).get('/register');
    assert.doesNotMatch(registerPage.text, /simplebar|img\/icons/);
    assert.match(registerPage.text, /free\.svg#cil-institution/);
    assert.match(registerPage.text, /free\.svg#cil-image/);
    assert.doesNotMatch((await request(app).get('/login')).text, /simplebar/);
});
