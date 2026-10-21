// The estimated completion time uses Qatar time (UTC+3, no daylight saving time) on any server
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('path');
const { calculateEstimatedCompletionTime } = require('../business');

// 5 January 2025 is a Sunday; the times are Qatar times
const at = (day, hour, minute = 0) => new Date(Date.UTC(2025, 0, day, hour - 3, minute));
const SUN = 5, MON = 6, THU = 9, FRI = 10, NEXT_SUN = 12;

/**
 * [description, when the request is sent, requests already in the queue, expected estimate]
 */
const cases = [
    ['Sunday 10:00, empty queue: done right away', at(SUN, 10), 0, at(SUN, 10)],
    ['Sunday 16:50, 1 in queue: continues on Monday morning', at(SUN, 16, 50), 1, at(MON, 9, 5)],
    ['Thursday 16:55, 1 in queue: skips the weekend', at(THU, 16, 55), 1, at(NEXT_SUN, 9, 10)],
    ['Friday 12:00, 2 in queue: starts on Sunday 9:00', at(FRI, 12), 2, at(NEXT_SUN, 9, 30)],
    ['Sunday 07:00, empty queue: waits until 9:00', at(SUN, 7), 0, at(SUN, 9)],
    ['Sunday 10:00, 40 in queue (10 hours): Monday 12:00', at(SUN, 10), 40, at(MON, 12)],
    ['Saturday 23:30, 1 in queue: Sunday 9:15', at(FRI + 1, 23, 30), 1, at(NEXT_SUN, 9, 15)]
];

for (const [description, sent, queue, expected] of cases) {
    test(`ETA: ${description}`, () => {
        const estimate = calculateEstimatedCompletionTime(queue, 15, sent);
        assert.equal(estimate.toISOString(), expected.toISOString());
    });
}

test('ETA: does not change the date that is passed in', () => {
    const sent = at(SUN, 16, 50);
    calculateEstimatedCompletionTime(1, 15, sent);
    assert.equal(sent.getTime(), at(SUN, 16, 50).getTime());
});

test('ETA: the result is the same whatever the time zone of the server', () => {
    const business = path.join(__dirname, '..', 'business.js');
    const code = `const { calculateEstimatedCompletionTime: eta } = require(${JSON.stringify(business)});
        console.log([${cases.map(([, sent, queue]) => `eta(${queue}, 15, new Date(${sent.getTime()})).toISOString()`).join(', ')}].join(' '));`;
    const expected = cases.map(([, , , result]) => result.toISOString()).join(' ');
    for (const TZ of ['UTC', 'Asia/Qatar', 'America/New_York', 'Asia/Tokyo']) {
        const output = execFileSync(process.execPath, ['-e', code], { env: { ...process.env, TZ } }).toString().trim();
        assert.equal(output, expected, TZ);
    }
});
