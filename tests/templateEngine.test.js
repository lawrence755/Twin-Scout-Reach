const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractMergeFields, findMissingFields, renderTemplate } = require('../shared/templateEngine');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

function loadTemplate(filename) {
  return JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, filename), 'utf8'));
}

describe('extractMergeFields', () => {
  test('finds every distinct {{field}} in a string', () => {
    const fields = extractMergeFields('Hi {{agentFirstName}}, re {{propertyAddress}} in {{city}}.');
    assert.deepEqual(fields, ['agentFirstName', 'propertyAddress', 'city']);
  });

  test('does not duplicate a field referenced twice', () => {
    const fields = extractMergeFields('{{senderName}} ... {{senderName}}');
    assert.deepEqual(fields, ['senderName']);
  });
});

describe('findMissingFields', () => {
  test('flags undefined, null, and blank-string values as missing', () => {
    const missing = findMissingFields(['a', 'b', 'c', 'd'], { a: undefined, b: null, c: '   ', d: 'present' });
    assert.deepEqual(missing, ['a', 'b', 'c']);
  });

  test('is empty when everything required is present', () => {
    assert.deepEqual(findMissingFields(['a'], { a: 'x' }), []);
  });
});

describe('renderTemplate', () => {
  test('substitutes every merge field when all required data is present', () => {
    const template = { body: 'Hi {{name}}, about {{address}}.', requiredFields: ['name', 'address'] };
    const rendered = renderTemplate(template, { name: 'Maria', address: '123 Main St' });
    assert.equal(rendered.body, 'Hi Maria, about 123 Main St.');
  });

  test('throws with the specific missing field names, and renders nothing', () => {
    const template = { body: 'Hi {{name}}.', requiredFields: ['name'] };
    assert.throws(
      () => renderTemplate(template, {}),
      (err) => err.missingFields && err.missingFields.includes('name')
    );
  });

  test('renders the subject too when the template has one', () => {
    const template = {
      subject: 'Re: {{address}}',
      body: 'Hi {{name}}.',
      requiredFields: ['name', 'address']
    };
    const rendered = renderTemplate(template, { name: 'Maria', address: '123 Main St' });
    assert.equal(rendered.subject, 'Re: 123 Main St');
  });

  test('throws on a template with no body', () => {
    assert.throws(() => renderTemplate({}, {}));
  });

  ['initial-sms.v1.json', 'followup-sms.v1.json', 'final-sms.v1.json',
   'initial-email.v1.json', 'followup-email.v1.json', 'final-email.v1.json'].forEach((filename) => {
    test(`${filename}: every {{field}} referenced in the body/subject is declared in requiredFields`, () => {
      const template = loadTemplate(filename);
      const referenced = extractMergeFields(template.body).concat(extractMergeFields(template.subject || ''));
      referenced.forEach((field) => {
        assert.ok(
          template.requiredFields.includes(field),
          `${filename} references {{${field}}} but does not list it in requiredFields`
        );
      });
    });

    test(`${filename}: renders successfully with all required fields filled in`, () => {
      const template = loadTemplate(filename);
      const mergeData = {};
      template.requiredFields.forEach((field) => { mergeData[field] = `[${field}]`; });
      assert.doesNotThrow(() => renderTemplate(template, mergeData));
    });

    test(`${filename}: throws when any single required field is missing`, () => {
      const template = loadTemplate(filename);
      template.requiredFields.forEach((missingField) => {
        const mergeData = {};
        template.requiredFields.forEach((field) => {
          if (field !== missingField) mergeData[field] = `[${field}]`;
        });
        assert.throws(() => renderTemplate(template, mergeData));
      });
    });
  });
});
