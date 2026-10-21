/**
 * Fills the database with demo data: 1 Head of Department, 3 students
 * and 15 requests in all categories and statuses. All names and emails are
 * made up ("... Demo", @example.com); they are not real people.
 *
 * For the demo video: every student has Pending requests the HoD can approve,
 * and sara@example.com has one approved request she has not opened yet, so
 * her dashboard shows the "New update" badge.
 *
 * WARNING: this deletes all existing users, requests and sessions in the
 * database from MONGODB_URI. Only run it on a local/demo database.
 *
 * Usage: npm run seed   (npm run demo also uses it)
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const persistence = require('../persistence');
const business = require('../business');

const DEMO_PASSWORD = 'Demo@1234';

const users = [
    { username: 'Dr. Demo HoD', email: 'hod@example.com', accountType: 'department_head', college: 'IT' },
    { username: 'Sara Demo', email: 'sara@example.com', accountType: 'student', college: 'IT' },
    { username: 'Omar Demo', email: 'omar@example.com', accountType: 'student', college: 'Business' },
    { username: 'Lina Demo', email: 'lina@example.com', accountType: 'student', college: 'Engineering' }
];

// Semesters relative to the current year, so they stay in business.semesterList()
// (in 2026: "Winter 2025", "Spring 2025" and "Fall 2024")
const year = new Date().getFullYear();
const WINTER = `Winter ${year - 1}`;
const SPRING = `Spring ${year - 1}`;
const LAST_FALL = `Fall ${year - 2}`;

// [student email, semester, category, description, status, note, days ago]
const requests = [
    ['sara@example.com', WINTER, 'Course Advice', 'Which elective fits a data science track?', 'Pending', '', 1],
    ['sara@example.com', WINTER, 'Registration', 'Please add me to the full section of INFS 3201.', 'Approved', 'Added to section 2.', 6],
    ['sara@example.com', SPRING, 'Attendance', 'I missed two classes because of a medical appointment.', 'Rejected', 'Please send the medical note first.', 9],
    ['sara@example.com', SPRING, 'Major Change', 'I would like to move from IT to Data Science.', 'Cancelled', '', 12],
    ['sara@example.com', WINTER, 'Attendance', 'Late arrival because of a bus delay.', 'Pending', '', 0],
    ['omar@example.com', WINTER, 'Registration', 'Time clash between two of my courses.', 'Pending', '', 2],
    ['omar@example.com', WINTER, 'Course Advice', 'Can I take Web Technologies 2 before Databases?', 'Pending', '', 1],
    ['omar@example.com', LAST_FALL, 'Major Change', 'Switching from Business to IT.', 'Approved', 'Approved. Please meet your new advisor.', 30],
    ['omar@example.com', SPRING, 'Attendance', 'Absent during a family emergency.', 'Approved', 'Excused.', 5],
    ['omar@example.com', WINTER, 'Registration', 'Request to drop one course after the deadline.', 'Rejected', 'The deadline has passed.', 4],
    ['lina@example.com', WINTER, 'Course Advice', 'Which courses should I take next semester?', 'Pending', '', 3],
    ['lina@example.com', WINTER, 'Registration', 'Please open an extra lab section.', 'Pending', '', 2],
    ['lina@example.com', SPRING, 'Attendance', 'Missed a quiz because of a university event.', 'Approved', 'Excused, quiz will be rescheduled.', 7],
    ['lina@example.com', WINTER, 'Major Change', 'Thinking about moving to Engineering.', 'Pending', '', 1],
    ['lina@example.com', LAST_FALL, 'Course Advice', 'Is a summer course possible for me?', 'Cancelled', '', 40]
];

async function seed() {
    const db = await persistence.connectDB();
    await db.collection('users').deleteMany({});
    await db.collection('requests').deleteMany({});
    await db.collection('sessions').deleteMany({});

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    for (const user of users) {
        await db.collection('users').insertOne({ ...user, passwordHash, verified: true });
    }

    const names = Object.fromEntries(users.map(u => [u.email, u.username]));
    const pendingPerCategory = {};
    for (const [studentEmail, semester, category, description, status, note, daysAgo] of requests) {
        const timestamp = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
        const count = pendingPerCategory[category] || 0;
        const request = {
            studentEmail,
            studentName: names[studentEmail],
            semester,
            category,
            description,
            status,
            timestamp,
            estimatedCompletion: business.calculateEstimatedCompletionTime(count, 15, timestamp)
        };
        if (status === 'Pending') {
            pendingPerCategory[category] = count + 1;
        }
        if (status === 'Approved' || status === 'Rejected') {
            request.note = note;
            request.resolvedAt = new Date(timestamp.getTime() + 24 * 60 * 60 * 1000);
            // the most recent decisions are still "unread" so the student sees the badge
            request.studentNotified = daysAgo > 6;
        }
        await persistence.insertRequest(request);
    }

    console.log(`Seeded ${users.length} users and ${requests.length} requests.`);
    console.log(`Demo logins (password for all: ${DEMO_PASSWORD}):`);
    users.forEach(u => console.log(`  ${u.accountType.padEnd(15)} ${u.email}`));
}

module.exports = { seed };

// Run by itself with "npm run seed" (scripts/demo.js calls seed() instead)
if (require.main === module) {
    seed()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('Seeding failed:', err.message);
            process.exit(1);
        });
}
