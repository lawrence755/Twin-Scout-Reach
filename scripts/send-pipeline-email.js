#!/usr/bin/env node
/**
 * Sends ONE real outreach email rendered from the live message template
 * (templates/initial-email.v2.json) -- the exact same render the
 * automated pipeline uses -- to a chosen recipient, on demand. A manual
 * way to see/verify the real pipeline email land in an inbox without
 * going through the queue / approval / do-not-automate gates.
 *
 * Sends a REAL email via Gmail (from SENDER_EMAIL). It calls the Gmail
 * client directly, so it does NOT depend on ENABLE_EMAIL_SENDING -- that
 * flag only gates the automated queue path.
 *
 *   npm run email:send-pipeline
 *       -> sends to the default recipient below.
 *   RECIPIENT=name@domain.com AGENT_FIRST_NAME=Name npm run email:send-pipeline
 *       -> override recipient / greeting / property.
 */
const config = require('../src/config');
const { renderTemplate } = require('../shared/templateEngine');
const gmailClient = require('../src/gmail/gmailClient');
const initialEmailTemplate = require('../templates/initial-email.v2.json');

const RECIPIENT = process.env.RECIPIENT || 'juan@twinhomebuyer.com';
const AGENT_FIRST_NAME = process.env.AGENT_FIRST_NAME || 'Juan';
const LEAD_ADDRESS = (process.env.LEAD_ADDRESS || '100 Palm Avenue').trim();
const LEAD_CITY = process.env.LEAD_CITY || 'San Carlos';

async function main() {
  const mergeData = {
    senderName: config.sender.name,
    senderPhone: config.sender.phone,
    senderEmail: config.sender.email,
    handoffPerson: config.sender.handoffPerson,
    companyWebsite: config.sender.companyWebsite,
    yearsInBusiness: config.sender.yearsInBusiness,
    googleReviewLink: config.sender.googleReviewLink,
    agentFirstName: AGENT_FIRST_NAME,
    propertyAddress: LEAD_ADDRESS,
    city: LEAD_CITY
  };

  const rendered = renderTemplate(initialEmailTemplate, mergeData);

  console.log('--- Rendered from ' + initialEmailTemplate.id + '.v' + initialEmailTemplate.version + ' ---');
  console.log('To:      ' + RECIPIENT);
  console.log('From:    ' + config.sender.email);
  console.log('Subject: ' + rendered.subject);
  console.log('');
  console.log(rendered.body);
  console.log('-------------------------------------------');

  await gmailClient.sendEmail({ to: RECIPIENT, subject: rendered.subject, body: rendered.body });
  console.log('\nSENT to ' + RECIPIENT + '.');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
