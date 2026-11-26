/**
 * One-command local demo: npm run demo
 *
 * Starts a temporary MongoDB in memory (mongodb-memory-server), fills it
 * with the demo data from seed.js and starts the app on http://localhost:8000.
 * Nothing needs to be installed except Node.js, and no .env file is needed.
 * All data is lost when you stop the demo (Ctrl+C).
 *
 * The first run downloads a MongoDB server binary (about 86 MB, once),
 * so it needs an internet connection and can take a minute.
 */
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');

async function startDemo() {
    console.log("Starting a temporary in-memory MongoDB (the first run downloads MongoDB, please wait)...");
    const mongo = await MongoMemoryServer.create();

    // These settings are only for this demo process; they win over a .env file
    process.env.MONGODB_URI = mongo.getUri();
    process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
    process.env.PORT = '8000';

    // Required only now, so they read the settings above
    const { seed } = require('./seed');
    await seed();

    console.log("\nOpen http://localhost:8000 and log in with one of the accounts above.");
    console.log("Press Ctrl+C to stop the demo (the demo data is deleted).\n");
    await require('../app').start();

    process.on('SIGINT', async () => {
        await mongo.stop();
        process.exit(0);
    });
}

startDemo().catch(err => {
    console.error("The demo could not start:", err.message);
    process.exit(1);
});
