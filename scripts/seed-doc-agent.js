/**
 * Idempotent seeder for predefined agents.
 *
 * Reads every JSON manifest in packages/api/src/agents/predefined/ and
 * upserts it into the agents collection by `id` — safe to re-run on every
 * deploy. Exits non-zero on any failure so deploy scripts can gate on it.
 *
 * Usage (inside the app container or repo root with deps installed):
 *   node scripts/seed-doc-agent.js
 */
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const db = require('~/models');
const { runAsSystem } = require('@librechat/data-schemas');

const PREDEFINED_DIR = path.resolve(
  __dirname,
  '..',
  'packages',
  'api',
  'src',
  'agents',
  'predefined',
);

const seedAgents = async () => {
  const manifests = fs.readdirSync(PREDEFINED_DIR).filter((name) => name.endsWith('.json'));
  if (manifests.length === 0) {
    throw new Error(`No agent manifests found in ${PREDEFINED_DIR}`);
  }

  for (const manifest of manifests) {
    const agentData = JSON.parse(fs.readFileSync(path.join(PREDEFINED_DIR, manifest), 'utf8'));
    if (!agentData.id) {
      throw new Error(`Manifest ${manifest} is missing required "id" field`);
    }

    const existingAgent = await db.getAgent({ id: agentData.id });
    if (existingAgent) {
      console.log(`Updating agent ${agentData.name} (${agentData.id})...`);
      await db.updateAgent({ id: agentData.id }, agentData);
    } else {
      console.log(`Creating agent ${agentData.name} (${agentData.id})...`);
      await db.createAgent(agentData);
    }
  }

  console.log(`Seed completed: ${manifests.length} agent manifest(s) processed.`);
};

const run = async () => {
  const mongoURI = process.env.MONGO_URI || 'mongodb://mongodb:27017/LibreChat';
  console.log(`Connecting to ${mongoURI.replace(/\/\/[^@]*@/, '//<credentials>@')}...`);
  await mongoose.connect(mongoURI);
  console.log('Connected to MongoDB. Running seed...');
  try {
    await runAsSystem(seedAgents);
  } finally {
    await mongoose.connection.close();
    console.log('Connection closed.');
  }
};

run().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
