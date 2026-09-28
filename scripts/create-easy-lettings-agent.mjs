#!/usr/bin/env node
/**
 * Create + test Easy Lettings Birmingham agent via local convocore-mcp stdio.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'fs';

const MCP_DIR = '/Users/Apple/Documents/GitHub/convocore-mcp';
const ORIGIN = 'https://easylettingsbirmingham.co.uk';
const LOGO =
  'https://easylettingsbirmingham.co.uk/wp-content/uploads/2019/06/easy-lettings-birmingham-logo-150x150.png';

function parse(result) {
  const text = result?.content?.find((p) => p?.type === 'text')?.text;
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractScrape(res) {
  const pageMeta = res?.data?.page?.data?.page || {};
  const sr = res?.data?.page?.data?.content?.scrapeResponse || {};
  return {
    success: !!res?.success,
    title: sr?.metadata?.title || pageMeta.title || null,
    markdown: sr.markdown || '',
    html: sr.html || '',
    imageUrl: pageMeta.imageUrl || LOGO,
    urls: sr.urlsDiscovered || [],
  };
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [`${MCP_DIR}/dist/index.js`],
    env: {
      ...process.env,
      WORKSPACE_SECRET: process.env.WORKSPACE_SECRET,
      CONVOCORE_API_REGION: process.env.CONVOCORE_API_REGION || 'eu-gcp',
    },
    stderr: 'inherit',
  });
  const client = new Client({ name: 'easy-lettings-create', version: '1.0.0' });
  await client.connect(transport);
  const call = async (name, args) => {
    process.stderr.write(`\n>> ${name}\n`);
    return parse(await client.callTool({ name, arguments: args }));
  };

  const urls = [
    `${ORIGIN}/`,
    `${ORIGIN}/contact-us/`,
    `${ORIGIN}/about-us/`,
    `${ORIGIN}/our-services/`,
    `${ORIGIN}/tenants/prospective-tenant-information/`,
    `${ORIGIN}/tenants/general-faqs/`,
    `${ORIGIN}/tenants/student-faqs/`,
    `${ORIGIN}/property-list/?department=residential-lettings&marketing_flag=67`,
    `${ORIGIN}/property-list/?department=residential-lettings&marketing_flag=81`,
    `${ORIGIN}/property-list/?department=residential-lettings&marketing_flag=77`,
    `${ORIGIN}/property-list/?department=residential-sales`,
    `${ORIGIN}/cookie-policy/`,
  ];

  // Phase 1 — scrape (MCP)
  const pages = [];
  for (const url of urls) {
    try {
      const res = await call('scrape_url', { urls: [url], mode: 'scrape', useProxy: false });
      const p = extractScrape(res);
      pages.push({ url, ...p });
      process.stderr.write(`   scraped ${url} title=${p.title} md=${p.markdown.length}\n`);
    } catch (e) {
      pages.push({ url, success: false, error: String(e.message || e), markdown: '' });
      process.stderr.write(`   FAIL ${url}: ${e.message}\n`);
    }
  }
  fs.writeFileSync('/tmp/el-pages.json', JSON.stringify(pages.map(({ markdown, html, ...r }) => ({ ...r, mdLen: markdown?.length || 0 })), null, 2));

  const contact = pages.find((p) => p.url.includes('contact-us')) || pages[0];
  const about = pages.find((p) => p.url.includes('about')) || {};
  const factsBlob = pages
    .filter((p) => (p.markdown || '').length > 400)
    .map((p) => `### SOURCE: ${p.url}\n# ${p.title || ''}\n${p.markdown.slice(0, 4500)}`)
    .join('\n\n---\n\n')
    .slice(0, 28000);

  // Voices — British English google-live / ultravox
  let voiceConfig = {
    speechGen: { provider: 'google-live', voiceId: 'Aoede' },
  };
  try {
    const voices = await call('search_voices', {
      providers: 'google-live',
      accent: 'british',
      language: 'en-GB',
      limit: 20,
    });
    fs.writeFileSync('/tmp/el-voices.json', JSON.stringify(voices, null, 2));
    const list = voices?.data?.voices || voices?.voices || voices?.data || [];
    const arr = Array.isArray(list) ? list : [];
    const pick =
      arr.find((v) => /british|uk|english/i.test(JSON.stringify(v))) || arr[0];
    if (pick) {
      const voiceId = pick.voiceId || pick.id || pick.name;
      if (voiceId) {
        voiceConfig = {
          speechGen: {
            provider: pick.provider || 'google-live',
            voiceId: String(voiceId),
          },
        };
      }
    }
  } catch (e) {
    process.stderr.write(`voice search soft-fail: ${e.message}\n`);
  }

  const systemPrompt = `You are the official AI assistant for Easy Lettings Birmingham Ltd — a local lettings and estate agency in Selly Oak / Birmingham, United Kingdom.

## Business identity
- Legal name: Easy Lettings Birmingham Ltd
- Trading as: Easy Lettings / Easy Lettings Birmingham
- Address: 545 Bristol Road, Selly Oak, Birmingham, B29 6AU, United Kingdom
- Phone: 0121 472 6969 (+44 121 472 6969)
- Email: sales@easylettingsbirmingham.co.uk
- Website: https://easylettingsbirmingham.co.uk/
- Contact page: https://easylettingsbirmingham.co.uk/contact-us/
- Google Maps rating context: well-reviewed local agency (~4.2★, hundreds of reviews) — do not invent exact live review counts.

## Opening hours
- Monday–Friday: 9:30am – 7:00pm
- Saturday: 10:00am – 4:00pm
- Sunday: emergencies only (out-of-hours callers should listen to the voicemail for the emergency number)

## Who you serve
1) Prospective tenants (students, professionals, families)
2) Landlords seeking lettings / property management
3) People interested in residential sales listings

## Core services (from public site navigation)
- Student lettings (all properties + recently let)
- Residential lettings — family lettings & professional lettings
- Residential sales — currently available / under offer / recently sold
- Landlord services & payments support
- Tenant information: FAQs, maintenance, utilities/bills, rent payments, holding fee & deposits, documents/forms
- Property alerts / locations coverage around Birmingham (esp. Selly Oak / student areas)

## How to help
- Be warm, professional, clear, and UK-English.
- Answer with concrete office facts (address, hours, phone, email) when asked.
- For property availability, rents, specific listings, or viewing slots: guide users to the relevant property-list pages on the website and/or collect their requirements, then capture a lead so staff can follow up. Do NOT invent live rents, fees, deposits, EPC ratings, or availability.
- Prefer linking users to real site sections when helpful:
  - Contact: https://easylettingsbirmingham.co.uk/contact-us/
  - About: https://easylettingsbirmingham.co.uk/about-us/
  - Student lettings lists and residential lettings lists via the Property Lists menu on the website
- If you show UI cards/buttons, only use real URLs from the website.

## Lead capture (required)
When a visitor shows buying/letting/landlord intent (want a viewing, valuation, management quote, student housing search, callback):
1) Ask for name + phone and/or email (and optional preferred call time / area / bedrooms / move-in timing).
2) Render the built-in lead form when available.
3) Confirm the team will follow up using sales@easylettingsbirmingham.co.uk / 0121 472 6969.

## Boundaries
- Do not invent legal advice, Right to Rent outcomes, or guaranteed offers.
- Do not pretend to be a human staff member in-person; you are the website AI assistant for Easy Lettings Birmingham.
- If unsure, say so and offer the phone/email or contact page.
- Never claim WhatsApp live-chat exists on the site unless confirmed.

## Scraped reference notes (may be truncated; prefer verified facts above)
${factsBlob.slice(0, 12000)}
`;

  const createArgs = {
    title: 'Easy Lettings Birmingham Assistant',
    description:
      'Website AI assistant for Easy Lettings Birmingham — student & residential lettings, landlord services, and sales enquiries in Selly Oak / Birmingham.',
    systemPrompt,
    primaryColor: '#1F4E79',
    widgetImageUrl: contact.imageUrl || LOGO,
    sourceUrl: `${ORIGIN}/contact-us/`,
    createKbUrlDoc: true,
    themeType: 'light',
    defaultLanguage: 'en',
    proactiveMessage:
      'Hi! I can help with lettings, student housing, landlord services, or sales at Easy Lettings Birmingham. What are you looking for?',
    voiceConfig,
    ownerNotifyEmails: ['sales@easylettingsbirmingham.co.uk'],
    requestId: 'easy-lettings-birmingham-v1',
  };

  const created = await call('create_agent_from_template', createArgs);
  fs.writeFileSync('/tmp/el-created.json', JSON.stringify(created, null, 2));

  const agent =
    created?.data?.agent ||
    created?.agent ||
    created?.data ||
    {};
  const agentId =
    created?.data?.agentId ||
    agent?.ID ||
    agent?.id ||
    created?.agentId;

  if (!agentId) {
    console.log(JSON.stringify({ error: 'no agentId', created }, null, 2));
    await client.close();
    process.exit(1);
  }

  const prototypeUrl =
    created?.prototypeUrl ||
    created?.data?.prototypeUrl ||
    `https://app.convocore.ai/eu/prototype/${agentId}`;

  process.stderr.write(`\nCREATED agentId=${agentId}\nprototype=${prototypeUrl}\n`);

  // Phase 4 — KB ingest more URLs
  const kbUrls = [
    `${ORIGIN}/contact-us/`,
    `${ORIGIN}/about-us/`,
    `${ORIGIN}/our-services/`,
    `${ORIGIN}/tenants/general-faqs/`,
    `${ORIGIN}/tenants/student-faqs/`,
    `${ORIGIN}/tenants/prospective-tenant-information/`,
  ];
  try {
    const kb = await call('create_kb_from_urls', {
      agentId,
      urls: kbUrls,
      mode: 'per_url',
      name: 'Easy Lettings site',
      refreshRate: 'never',
      scrapeContent: true,
    });
    fs.writeFileSync('/tmp/el-kb.json', JSON.stringify(kb, null, 2));
  } catch (e) {
    process.stderr.write(`KB soft-fail: ${e.message}\n`);
  }

  // Phase 6 — multi-turn interact tests
  const turns = [
    { label: 'greeting', message: 'start' },
    { label: 'hours', message: 'What are your opening hours?' },
    { label: 'address', message: 'Where is your office and what is the phone number?' },
    { label: 'student', message: 'I am a student looking for a house share in Selly Oak for September.' },
    { label: 'followup', message: 'Do you also help with bills included properties?' },
    { label: 'oos', message: 'Can you file my UK tax return?' },
    {
      label: 'lead',
      message:
        'I want a landlord valuation callback. My name is Alex Test, email alex.test+easylettings@example.com, phone 07123456789.',
    },
    { label: 'rephrase', message: 'Remind me again what time you open on Saturdays?' },
  ];

  let conversationId = undefined;
  const transcript = [];
  for (const t of turns) {
    try {
      const convoId = conversationId || `el-test-${Date.now()}`;
      if (!conversationId) conversationId = convoId;
      const r = await call('interact_with_agent', {
        agentId,
        prompt: t.message,
        convoId,
      });
      conversationId =
        r?.convoId ||
        r?.data?.convoId ||
        r?.conversationId ||
        conversationId;
      const assistant =
        r?.assistantText ||
        r?.data?.assistantText ||
        r?.reply ||
        r?.data?.reply ||
        r?.uiEngineSummary ||
        r?.data?.uiEngineSummary ||
        JSON.stringify(r).slice(0, 800);
      transcript.push({
        label: t.label,
        user: t.message,
        assistant: typeof assistant === 'string' ? assistant.slice(0, 1200) : assistant,
      });
      process.stderr.write(`   turn ${t.label}: ${String(assistant).slice(0, 160).replace(/\n/g, ' ')}\n`);
    } catch (e) {
      transcript.push({ label: t.label, user: t.message, error: e.message });
      process.stderr.write(`   turn ${t.label} FAIL: ${e.message}\n`);
    }
  }

  let autoTest = null;
  try {
    autoTest = await call('run_agent_auto_test', { agentId, config: { testMode: 'full', maxTurns: 8 } });
  } catch (e) {
    autoTest = { error: e.message };
  }

  let embed = null;
  try {
    embed = await call('get_website_embed_code', { agentId, mode: 'popup-bottom-right' });
  } catch (e) {
    embed = { error: e.message };
  }

  const out = {
    agentId,
    prototypeUrl,
    voiceConfig,
    createSummary: {
      success: created?.success,
      message: created?.message,
      modelIdUsed: created?.modelIdUsed || created?.data?.modelIdUsed,
      webSearchTool: created?.webSearchTool || created?.data?.webSearchTool,
    },
    transcript,
    autoTest,
    embedHtmlPreview: embed?.html?.slice?.(0, 400) || embed,
    pagesScraped: pages.map((p) => ({ url: p.url, title: p.title, mdLen: (p.markdown || '').length, ok: p.success !== false })),
  };
  fs.writeFileSync('/tmp/el-final-report.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
