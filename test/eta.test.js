// The estimated completion time uses the server's local time; the tests use Qatar time
process.env.TZ = 'Asia/Qatar';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateEstimatedCompletionTime } = require('../business');

// 5 January 2025 is a Sunday (month 0 = January)
const at = (day, hour, minute = 0) => new Date(2025, 0, day, hour, minute);
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
    ['Sunday 10:00, 40 in queue (10 hours): Monday 12:00', at(SUN, 10), 40, at(MON, 12)]
];

for (const [description, sent, queue, expected] of cases) {
    test(`ETA: ${description}`, () => {
        const estimate = calculateEstimatedCompletionTime(queue, 15, sent);
        assert.equal(estimate.toString(), expected.toString());
    });
}

test('ETA: does not change the date that is passed in', () => {
    const sent = at(SUN, 16, 50);
    calculateEstimatedCompletionTime(1, 15, sent);
    assert.equal(sent.getTime(), at(SUN, 16, 50).getTime());
});
