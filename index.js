import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import boltPkg from '@slack/bolt';
const { App } = boltPkg;

const APP_NAME = process.env.APP_NAME || 'invoice-review-incoming';
const DATA_DIR = path.join(process.cwd(), 'data');
const SUPPLIERS_FILE = path.join(DATA_DIR, 'suppliers.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SUPPLIERS_FILE)) {
    const envSeed = (process.env.SUPPLIERS || 'OHC,Bospeed,TDD,CZD')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    fs.writeFileSync(SUPPLIERS_FILE, JSON.stringify({ suppliers: envSeed }, null, 2));
  }
}
function loadSuppliers() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(SUPPLIERS_FILE, 'utf8');
    const json = JSON.parse(raw);
    return Array.isArray(json.suppliers) ? json.suppliers : [];
  } catch {
    return [];
  }
}
function saveSuppliers(suppliers) {
  ensureDataDir();
  const unique = Array.from(new Set(suppliers.map(s => s.trim()).filter(Boolean)));
  fs.writeFileSync(SUPPLIERS_FILE, JSON.stringify({ suppliers: unique }, null, 2));
  return unique;
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN, // xapp- (App-level) with connections:write
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  port: process.env.PORT || 3000
});

/**
 * /invoice-review  → opens modal with supplier dropdown
 */
app.command('/invoice-review', async ({ ack, body, client }) => {
  await ack();
  const suppliers = loadSuppliers();
  const options = suppliers.map(s => ({ text: { type: 'plain_text', text: s }, value: s }));

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'invoice_review_submit',
      title: { type: 'plain_text', text: 'Invoice Review' },
      submit: { type: 'plain_text', text: 'Continue' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'supplier_block',
          label: { type: 'plain_text', text: 'Supplier' },
          element: {
            type: 'static_select',
            action_id: 'supplier_select',
            placeholder: { type: 'plain_text', text: 'Choose a supplier' },
            options
          }
        },
        {
          type: 'input',
          optional: true,
          block_id: 'notes_block',
          label: { type: 'plain_text', text: 'Notes (optional)' },
          element: { type: 'plain_text_input', action_id: 'notes_input', multiline: true }
        }
      ]
    }
  });
});

/**
 * Handle modal submit
 */
app.view('invoice_review_submit', async ({ ack, body, view, client }) => {
  await ack();
  const supplier = view.state.values.supplier_block?.supplier_select?.selected_option?.value;
  const notes = view.state.values.notes_block?.notes_input?.value || '';
  const user = body.user.id;

  await client.chat.postEphemeral({
    channel: body.team?.id || (body.view?.private_metadata || '') || undefined,
    user,
    text: `✅ Received invoice review request for *${supplier || 'N/A'}*.\nNotes: ${notes || '_none_'}`.trim()
  }).catch(() => { /* If no channel context, silently ignore */ });
});

/**
 * /invoice-help  → show available commands
 */
app.command('/invoice-help', async ({ ack, respond }) => {
  await ack();
  await respond({
    response_type: 'ephemeral',
    text:
`*Invoice Review Bot — Commands*
• \`/invoice-review\` — open the review modal (choose supplier)
• \`/invoice-supplier-add <Name>\` — add a supplier (persists to data/suppliers.json)
• \`/invoice-suppliers\` — list current suppliers`
  });
});

/**
 * /invoice-supplier-add <Name>  → persist a new supplier
 */
app.command('/invoice-supplier-add', async ({ ack, respond, command }) => {
  await ack();
  const name = (command.text || '').trim();
  if (!name) {
    return respond({ response_type: 'ephemeral', text: '⚠️ Usage: `/invoice-supplier-add <Name>`' });
  }
  const updated = saveSuppliers([...loadSuppliers(), name]);
  await respond({ response_type: 'ephemeral', text: `✅ Added supplier *${name}*.\nCurrent: ${updated.join(', ')}` });
});

/**
 * /invoice-suppliers  → list suppliers
 */
app.command('/invoice-suppliers', async ({ ack, respond }) => {
  await ack();
  const list = loadSuppliers();
  await respond({ response_type: 'ephemeral', text: `Suppliers: ${list.length ? list.join(', ') : 'none'}` });
});

app.error((err) => {
  console.error('⚠️ App error:', err);
});

(async () => {
  await app.start();
  console.log(`✅ ${APP_NAME} running on port ${process.env.PORT || 3000}`);
})();