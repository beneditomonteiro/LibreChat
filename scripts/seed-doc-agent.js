const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const db = require('~/models');
const { runAsSystem } = require('@librechat/data-schemas');

const seedAgent = async () => {
  try {
    const manifestPath = path.resolve(__dirname, '..', 'packages', 'api', 'src', 'agents', 'predefined', 'doc-generator.json');
    const agentData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    
    console.log(`Searching for agent: ${agentData.id}...`);
    const existingAgent = await db.getAgent({ id: agentData.id });
    if (existingAgent) {
      console.log(`Agent ${agentData.name} (${agentData.id}) already exists. Updating...`);
      await db.updateAgent({ id: agentData.id }, agentData);
    } else {
      console.log(`Creating agent ${agentData.name}...`);
      await db.createAgent(agentData);
    }
    
    console.log('Seed completed successfully!');
  } catch (error) {
    console.error('Seed failed:', error);
  }
};

const run = async () => {
  const mongoURI = process.env.MONGO_URI || 'mongodb://mongodb:27017/LibreChat';
  console.log(`Connecting to ${mongoURI}...`);
  await mongoose.connect(mongoURI);
  console.log('Connected to MongoDB. Running seed...');
  await runAsSystem(seedAgent);
  await mongoose.connection.close();
  console.log('Connection closed.');
};

run();
