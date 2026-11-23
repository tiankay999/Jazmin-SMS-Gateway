#!/usr/bin/env node
/**
 * configure-jasmin.mjs
 *
 * Cross-platform bootstrap script that configures Jasmin via jCli (telnet/TCP port 8990):
 *   1. Creates group + user for HTTP API
 *   2. Creates SMPP connector to your provider
 *   3. Starts connector
 *   4. Creates default MT route
 *   5. Persists configuration so it survives restarts
 *
 * Usage:
 *   node scripts/configure-jasmin.mjs
 */

import net from 'node:net';

try {
  process.loadEnvFile();
} catch {
  // If .env is missing or already in environment
}

const JCLI_HOST = process.env.JCLI_HOST || 'localhost';
const JCLI_PORT = parseInt(process.env.JCLI_PORT || '8990', 10);
const JCLI_USER = process.env.JCLI_USER || 'jcliadmin';
const JCLI_PASS = process.env.JCLI_PASS || 'jclipwd';

const JASMIN_USER = process.env.JASMIN_USER || 'qrollix';
const JASMIN_PASSWORD = process.env.JASMIN_PASSWORD || 'change-me-strong-password';
const JASMIN_HTTP_URL = process.env.JASMIN_HTTP_URL || 'http://localhost:1401';
const CONNECTOR_ID = process.env.DEFAULT_CONNECTOR_ID || 'gh_provider';

const SMPP_PROVIDER_HOST = process.env.SMPP_PROVIDER_HOST || 'smpp.your-provider.com';
const SMPP_PROVIDER_PORT = process.env.SMPP_PROVIDER_PORT || '2775';
const SMPP_PROVIDER_USERNAME = process.env.SMPP_PROVIDER_USERNAME || 'your-smpp-username';
const SMPP_PROVIDER_PASSWORD = process.env.SMPP_PROVIDER_PASSWORD || 'your-smpp-password';
const SMPP_PROVIDER_SYSTEM_TYPE = process.env.SMPP_PROVIDER_SYSTEM_TYPE || '';
const SMPP_SOURCE_ADDR = process.env.SMPP_SOURCE_ADDR || 'Qrollix';

console.log(`▶ Connecting to jCli on ${JCLI_HOST}:${JCLI_PORT}...`);

const socket = net.createConnection({ host: JCLI_HOST, port: JCLI_PORT }, () => {
  console.log(`✓ Connected to jCli. Sending configuration...`);
  runCommands();
});

socket.on('error', (err) => {
  console.error(`❌ Connection error: ${err.message}`);
  console.error(`Ensure Jasmin container is running and port ${JCLI_PORT} is accessible.`);
  process.exit(1);
});

socket.on('data', (data) => {
  // Display output from jCli if desired
  const msg = data.toString();
  if (process.env.DEBUG) {
    process.stdout.write(msg);
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendLine(cmd) {
  socket.write(cmd + '\r\n');
  await sleep(150);
}

async function runCommands() {
  try {
    // 1. Authenticate
    await sendLine(JCLI_USER);
    await sleep(400);
    await sendLine(JCLI_PASS);
    await sleep(400);

    // 2. HTTP API Group & User
    await sendLine('group -a');
    await sendLine(`gid ${JASMIN_USER}_grp`);
    await sendLine('ok');

    await sendLine('user -a');
    await sendLine(`uid ${JASMIN_USER}`);
    await sendLine(`gid ${JASMIN_USER}_grp`);
    await sendLine(`username ${JASMIN_USER}`);
    await sendLine(`password ${JASMIN_PASSWORD}`);
    await sendLine('ok');

    // 3. SMPP client connector
    await sendLine('smppccm -a');
    await sendLine(`cid ${CONNECTOR_ID}`);
    await sendLine(`host ${SMPP_PROVIDER_HOST}`);
    await sendLine(`port ${SMPP_PROVIDER_PORT}`);
    await sendLine(`username ${SMPP_PROVIDER_USERNAME}`);
    await sendLine(`password ${SMPP_PROVIDER_PASSWORD}`);
    await sendLine(`systype ${SMPP_PROVIDER_SYSTEM_TYPE}`);
    await sendLine(`src_addr ${SMPP_SOURCE_ADDR}`);
    await sendLine('src_ton 5'); // alphanumeric
    await sendLine('src_npi 0');
    await sendLine('dst_ton 1'); // international
    await sendLine('dst_npi 1');
    await sendLine('bind_to 30');
    await sendLine('elink_interval 30');
    await sendLine('submit_throughput 50');
    await sendLine('ok');

    // 4. Start connector
    await sendLine(`smppccm -1 ${CONNECTOR_ID}`);

    // 5. Default MT route
    await sendLine('mtrouter -a');
    await sendLine('type defaultroute');
    await sendLine(`connector smppc(${CONNECTOR_ID})`);
    await sendLine('rate 0.0');
    await sendLine('ok');

    // 6. Persist
    await sendLine('persist');
    await sleep(600);
    await sendLine('quit');
    await sleep(200);

    socket.end();

    console.log('\n✓ Jasmin successfully configured!\n');
    console.log(`   HTTP API:    ${JASMIN_HTTP_URL}`);
    console.log(`   Username:    ${JASMIN_USER}`);
    console.log(`   Connector:   ${CONNECTOR_ID} → ${SMPP_PROVIDER_HOST}:${SMPP_PROVIDER_PORT}`);
    console.log('\nReady to send SMS.');
  } catch (err) {
    console.error('Error during configuration:', err);
    socket.destroy();
    process.exit(1);
  }
}
