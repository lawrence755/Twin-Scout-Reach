/**
 * GENERATED FILE -- do not hand-edit.
 *
 * Mirrors templates/*.json so Apps Script (which has no filesystem
 * access) can render the same versioned templates Node.js reads
 * directly from disk. Regenerate with `npm run build:apps-script`
 * whenever a template file under templates/ changes.
 */
var TEMPLATES = {
  'final-email': {
    "id": "final-email",
    "channel": "email",
    "version": 1,
    "sequencePosition": 3,
    "subject": "Last note on {{propertyAddress}}",
    "body": "Hi {{agentFirstName}},\n\nThis will be my last note on {{propertyAddress}} unless I hear back. If your seller's situation changes down the road, feel free to reach out -- {{senderPhone}} or {{senderEmail}}.\n\nIf you ever have other Bay Area listings where a seller might want a direct, as-is offer, {{handoffPerson}} on our team is also a good contact.\n\nThanks again for your time,\n{{senderName}}\n{{companyWebsite}}",
    "requiredFields": [
      "agentFirstName",
      "propertyAddress",
      "senderPhone",
      "senderEmail",
      "handoffPerson",
      "senderName",
      "companyWebsite"
    ]
  },
  'final-sms': {
    "id": "final-sms",
    "channel": "sms",
    "version": 1,
    "sequencePosition": 3,
    "body": "Hi {{agentFirstName}}, last check-in on {{propertyAddress}}. If now isn't the right time, no problem -- reply NO and I'll stop here. If you'd like to talk it through, reply YES. Thanks for your time. -- {{senderName}}, {{companyWebsite}}",
    "requiredFields": [
      "agentFirstName",
      "propertyAddress",
      "senderName",
      "companyWebsite"
    ]
  },
  'followup-email': {
    "id": "followup-email",
    "channel": "email",
    "version": 1,
    "sequencePosition": 2,
    "subject": "Following up: {{propertyAddress}}",
    "body": "Hi {{agentFirstName}},\n\nWanted to follow up on my note about {{propertyAddress}} in {{city}}. If your seller has already accepted an offer or isn't interested in a direct sale, that's completely fine -- just let me know and I'll close this out on my end.\n\nIf it's still open, I'm happy to answer any questions about how we work.\n\nThanks,\n{{senderName}}\n{{senderPhone}}\n{{senderEmail}}",
    "requiredFields": [
      "agentFirstName",
      "propertyAddress",
      "city",
      "senderName",
      "senderPhone",
      "senderEmail"
    ]
  },
  'followup-sms': {
    "id": "followup-sms",
    "channel": "sms",
    "version": 1,
    "sequencePosition": 2,
    "body": "Hi {{agentFirstName}}, following up on {{propertyAddress}} in {{city}}. Still checking whether your seller has interest in a direct offer -- no pressure either way. Reply YES to keep talking or NO and I'll close this out. -- {{senderName}}",
    "requiredFields": [
      "agentFirstName",
      "propertyAddress",
      "city",
      "senderName"
    ]
  },
  'initial-email': {
    "id": "initial-email",
    "channel": "email",
    "version": 1,
    "sequencePosition": 1,
    "subject": "Interest in {{propertyAddress}}, {{city}}",
    "body": "Hi {{agentFirstName}},\n\nMy name is {{senderName}} with {{companyWebsite}}. We're a local Bay Area home buying company, and I came across your listing at {{propertyAddress}} in {{city}}.\n\nWe work directly with homeowners who want a straightforward, as-is sale, and I wanted to check whether your seller would be open to discussing a direct offer alongside anything else you're currently evaluating.\n\nWe've been buying homes in the Bay Area for {{yearsInBusiness}}, and you can see feedback from past sellers here: {{googleReviewLink}}.\n\nIf this could be useful for your seller, I'd welcome a short call. If not, no problem at all -- just let me know and I won't follow up further.\n\nThanks for your time,\n{{senderName}}\n{{senderPhone}}\n{{senderEmail}}\n{{companyWebsite}}",
    "requiredFields": [
      "agentFirstName",
      "senderName",
      "companyWebsite",
      "propertyAddress",
      "city",
      "yearsInBusiness",
      "googleReviewLink",
      "senderPhone",
      "senderEmail"
    ]
  },
  'initial-sms': {
    "id": "initial-sms",
    "channel": "sms",
    "version": 1,
    "sequencePosition": 1,
    "body": "Hi {{agentFirstName}}, this is {{senderName}} with {{companyWebsite}} -- we buy homes directly in the Bay Area and noticed {{propertyAddress}} in {{city}}. Would your seller be open to a direct, as-is offer alongside anything else on the table? Reply YES if you'd like details, or NO if it's not a fit.",
    "requiredFields": [
      "agentFirstName",
      "senderName",
      "companyWebsite",
      "propertyAddress",
      "city"
    ]
  },
};
